import type { WorkerEnv } from "../../cloudflare.config";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const OAUTH_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const VERSION_LIMIT = 50;

export interface DriveConnection {
  workspace_id: string;
  connected_by: string;
  google_email: string;
  root_folder_id: string;
  workspace_folder_id: string;
  trash_folder_id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  access_token_expires_at: number;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  headRevisionId?: string;
  parents?: string[];
  modifiedTime?: string;
}

export class DriveApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "DriveApiError";
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function encryptionKey(env: WorkerEnv): Promise<CryptoKey> {
  if (!env.BETTER_AUTH_SECRET) throw new Error("A chave de segurança da plataforma não está configurada.");
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.BETTER_AUTH_SECRET), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("gama-work-drive-token-v1"), info: new TextEncoder().encode("oauth-refresh-token") },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptDriveSecret(env: WorkerEnv, value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(env), new TextEncoder().encode(value));
  return `${encodeBase64(iv)}.${encodeBase64(new Uint8Array(encrypted))}`;
}

async function decryptDriveSecret(env: WorkerEnv, value: string): Promise<string> {
  const [ivText, encryptedText] = value.split(".");
  if (!ivText || !encryptedText) throw new Error("A conexão com o Google Drive precisa ser refeita.");
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeBase64(ivText) },
    await encryptionKey(env),
    decodeBase64(encryptedText),
  );
  return new TextDecoder().decode(clear);
}

export async function getDriveConnection(db: WorkerEnv["DB"], workspaceId: string): Promise<DriveConnection | null> {
  return db.prepare("SELECT * FROM workspace_drive_connections WHERE workspace_id = ? LIMIT 1")
    .bind(workspaceId).first<DriveConnection>();
}

async function refreshAccessToken(env: WorkerEnv, connection: DriveConnection): Promise<string> {
  const refreshToken = await decryptDriveSecret(env, connection.refresh_token_encrypted);
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID ?? "",
    client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const result = await response.json() as { access_token?: string; expires_in?: number; refresh_token?: string; error?: string };
  if (!response.ok || !result.access_token) {
    throw new DriveApiError(401, "A autorização do Google Drive expirou. A proprietária precisa conectar novamente a conta.");
  }
  const refreshTokenEncrypted = result.refresh_token
    ? await encryptDriveSecret(env, result.refresh_token)
    : connection.refresh_token_encrypted;
  const expiresAt = Date.now() + Math.max(60, result.expires_in ?? 3600) * 1000;
  await env.DB.prepare(
    "UPDATE workspace_drive_connections SET access_token_encrypted = ?, refresh_token_encrypted = ?, access_token_expires_at = ?, updated_at = ? WHERE workspace_id = ?",
  ).bind(await encryptDriveSecret(env, result.access_token), refreshTokenEncrypted, expiresAt, Date.now(), connection.workspace_id).run();
  return result.access_token;
}

export async function getDriveAccessToken(env: WorkerEnv, connection: DriveConnection, forceRefresh = false): Promise<string> {
  if (!forceRefresh && connection.access_token_encrypted && connection.access_token_expires_at > Date.now() + 60_000) {
    return decryptDriveSecret(env, connection.access_token_encrypted);
  }
  return refreshAccessToken(env, connection);
}

export async function driveFetch(env: WorkerEnv, connection: DriveConnection, input: string, init: RequestInit = {}): Promise<Response> {
  const send = async (token: string) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
  let response = await send(await getDriveAccessToken(env, connection));
  if (response.status === 401) response = await send(await getDriveAccessToken(env, connection, true));
  return response;
}

export async function driveJson<T>(env: WorkerEnv, connection: DriveConnection, url: string, init: RequestInit = {}): Promise<T> {
  const response = await driveFetch(env, connection, url, init);
  if (!response.ok) throw await driveError(response);
  return response.json() as Promise<T>;
}

export async function driveApiJson<T>(env: WorkerEnv, connection: DriveConnection, path: string, init: RequestInit = {}): Promise<T> {
  return driveJson<T>(env, connection, `${DRIVE_API}${path}`, init);
}

export async function createDriveFolder(
  env: WorkerEnv,
  connection: DriveConnection,
  name: string,
  parentId: string,
  appProperties: Record<string, string>,
): Promise<DriveFile> {
  return driveApiJson<DriveFile>(env, connection, "/files?fields=id,name,mimeType,parents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId], appProperties }),
  });
}

export async function ensureDriveFolder(
  env: WorkerEnv,
  connection: DriveConnection,
  name: string,
  parentId: string | null,
  propertyKey: string,
  propertyValue: string,
): Promise<DriveFile> {
  const queryParts = [`name = '${name.replaceAll("'", "\\'")}'`, `mimeType = '${FOLDER_MIME}'`, "trashed = false", `appProperties has { key='${propertyKey}' and value='${propertyValue.replaceAll("'", "\\'")}' }`];
  if (parentId) queryParts.push(`'${parentId.replaceAll("'", "\\'")}' in parents`);
  const params = new URLSearchParams({ q: queryParts.join(" and "), pageSize: "10", fields: "files(id,name,mimeType,parents)" });
  const listed = await driveApiJson<{ files?: DriveFile[] }>(env, connection, `/files?${params}`);
  if (listed.files?.[0]) return listed.files[0];
  return createDriveFolder(env, connection, name, parentId ?? "root", { [propertyKey]: propertyValue, gamaWork: "true" });
}

export async function driveUpload(
  env: WorkerEnv,
  connection: DriveConnection,
  options: { name: string; mimeType: string; bytes: Uint8Array; parentId?: string; fileId?: string; pinRevision?: boolean },
): Promise<DriveFile> {
  const query = new URLSearchParams({
    uploadType: "resumable",
    fields: "id,name,mimeType,size,headRevisionId,parents,modifiedTime",
  });
  if (options.pinRevision) query.set("keepRevisionForever", "true");
  const metadata: Record<string, unknown> = { name: options.name, mimeType: options.mimeType };
  if (options.parentId) metadata.parents = [options.parentId];
  const path = options.fileId ? `/files/${encodeURIComponent(options.fileId)}` : "/files";
  const startResponse = await driveFetch(env, connection, `${DRIVE_UPLOAD_API}${path}?${query}`, {
    method: options.fileId ? "PATCH" : "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": options.mimeType,
      "X-Upload-Content-Length": String(options.bytes.byteLength),
    },
    body: JSON.stringify(metadata),
  });
  if (!startResponse.ok) throw await driveError(startResponse);
  const sessionUrl = startResponse.headers.get("Location");
  if (!sessionUrl) throw new DriveApiError(502, "O Google Drive não iniciou o envio do arquivo.");
  const latestConnection = await getDriveConnection(env.DB, connection.workspace_id) ?? connection;
  const uploadBytes = new Uint8Array(options.bytes.byteLength);
  uploadBytes.set(options.bytes);
  const finishResponse = await fetch(sessionUrl, {
    method: "PUT",
    headers: { "Authorization": `Bearer ${await getDriveAccessToken(env, latestConnection)}`, "Content-Type": options.mimeType, "Content-Length": String(options.bytes.byteLength) },
    body: uploadBytes.buffer,
  });
  if (!finishResponse.ok) throw await driveError(finishResponse);
  const saved = await finishResponse.json() as DriveFile;
  if (saved.headRevisionId) return saved;
  return driveApiJson<DriveFile>(env, connection, `/files/${encodeURIComponent(saved.id)}?fields=id,name,mimeType,size,headRevisionId,parents,modifiedTime`);
}

async function driveError(response: Response): Promise<DriveApiError> {
  let message = "O Google Drive não conseguiu salvar o arquivo.";
  try {
    const body = await response.json() as { error?: { message?: string; errors?: Array<{ reason?: string }> } };
    const reason = body.error?.errors?.[0]?.reason;
    if (reason === "storageQuotaExceeded") message = "O Google Drive da proprietária está sem espaço. Libere espaço na conta conectada ou escolha outra conta Google.";
    else if (response.status === 401) message = "A autorização do Google Drive expirou. A proprietária precisa conectar novamente a conta.";
    else if (response.status === 429 || reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") message = "O Google Drive limitou temporariamente esta operação. Tente novamente em alguns instantes.";
    else if (body.error?.message) message = body.error.message.slice(0, 250);
  } catch { /* Mantém a mensagem segura padrão. */ }
  return new DriveApiError(response.status, message);
}

export async function downloadDriveFile(env: WorkerEnv, connection: DriveConnection, fileId: string, revisionId?: string): Promise<Response> {
  const path = revisionId
    ? `/files/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(revisionId)}?alt=media`
    : `/files/${encodeURIComponent(fileId)}?alt=media`;
  return driveFetch(env, connection, `${DRIVE_API}${path}`);
}

export async function updateDriveFileMetadata(
  env: WorkerEnv,
  connection: DriveConnection,
  fileId: string,
  patch: Record<string, unknown>,
  parents?: { add?: string; remove?: string },
): Promise<DriveFile> {
  const query = new URLSearchParams({ fields: "id,name,mimeType,size,headRevisionId,parents,modifiedTime" });
  if (parents?.add) query.set("addParents", parents.add);
  if (parents?.remove) query.set("removeParents", parents.remove);
  return driveApiJson<DriveFile>(env, connection, `/files/${encodeURIComponent(fileId)}?${query}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
  });
}

export async function deleteDriveFile(env: WorkerEnv, connection: DriveConnection, fileId: string): Promise<void> {
  const response = await driveFetch(env, connection, `${DRIVE_API}/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw await driveError(response);
}

export async function pinDriveRevision(env: WorkerEnv, connection: DriveConnection, fileId: string, revisionId: string, keepForever: boolean): Promise<void> {
  await driveApiJson(env, connection, `/files/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(revisionId)}?fields=id,keepForever`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keepForever }),
  });
}

export async function pruneDriveVersions(env: WorkerEnv, connection: DriveConnection, fileId: string, db: WorkerEnv["DB"]): Promise<void> {
  const old = await db.prepare(
    "SELECT id, object_key AS revision_id FROM workspace_file_versions WHERE file_id = ? ORDER BY version_number DESC LIMIT 1000 OFFSET ?",
  ).bind(fileId, VERSION_LIMIT).all<{ id: string; revision_id: string }>();
  for (const version of old.results) {
    try { await pinDriveRevision(env, connection, fileId, version.revision_id, false); } catch { /* Drive pode já ter removido uma revisão antiga. */ }
    await db.prepare("DELETE FROM workspace_file_versions WHERE id = ?").bind(version.id).run();
  }
}

export function driveScope(): string { return OAUTH_SCOPE; }
export function driveFolderMimeType(): string { return FOLDER_MIME; }
export function driveApiBase(): string { return DRIVE_API; }
export function googleUserInfoUrl(): string { return GOOGLE_USERINFO; }
export function googleTokenUrl(): string { return TOKEN_URL; }
