import { Hono } from "hono";
import type { AppEnv } from "../types";
import { currentUser, getWorkspaceAccess, hashText, isOwner, randomToken } from "../lib";
import {
  createDriveFolder,
  driveApiBase,
  driveFolderMimeType,
  driveJson,
  driveScope,
  encryptDriveSecret,
  ensureDriveFolder,
  getDriveConnection,
  googleTokenUrl,
  googleUserInfoUrl,
  type DriveConnection,
} from "../drive-storage";

const workspaceRoutes = new Hono<AppEnv>();
const oauthRoutes = new Hono<AppEnv>();
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const ROOT_NAME = "gama-work-files";

function callbackUrl(c: import("hono").Context<AppEnv>) {
  const url = new URL(c.req.url);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return `${url.origin}/api/drive/callback`;
  return `${c.env.APP_PUBLIC_URL.replace(/\/$/, "")}/api/drive/callback`;
}

function workspaceUrl(c: import("hono").Context<AppEnv>, status: string) {
  const requestUrl = new URL(c.req.url);
  const origin = requestUrl.hostname === "localhost" || requestUrl.hostname === "127.0.0.1"
    ? requestUrl.origin
    : c.env.APP_PUBLIC_URL;
  const url = new URL("/acesso/equipe", origin);
  url.searchParams.set("drive", status);
  return `${url.pathname}${url.search}`;
}

workspaceRoutes.get("/", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const access = await getWorkspaceAccess(c, workspaceId);
  if (!access) return c.json({ error: "Este espaço não está disponível para sua conta." }, 404);
  const connection = await getDriveConnection(c.env.DB, workspaceId);
  const owner = await c.env.DB.prepare("SELECT owner_user_id FROM workspaces WHERE id = ? LIMIT 1")
    .bind(workspaceId).first<{ owner_user_id: string }>();
  const connectedBy = connection ? await c.env.DB.prepare("SELECT name FROM user WHERE id = ? LIMIT 1")
    .bind(connection.connected_by).first<{ name: string }>() : null;
  return c.json({
    available: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
    connected: Boolean(connection),
    isOwner: isOwner(access),
    ownerConnected: connection?.connected_by === owner?.owner_user_id,
    googleEmail: isOwner(access) ? connection?.google_email ?? null : null,
    connectedByName: connectedBy?.name ?? null,
    folderName: ROOT_NAME,
  });
});

workspaceRoutes.post("/connect", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const access = await getWorkspaceAccess(c, workspaceId);
  if (!access) return c.json({ error: "Este espaço não está disponível para sua conta." }, 404);
  if (!isOwner(access)) return c.json({ error: "Somente a proprietária pode conectar o Google Drive deste espaço." }, 403);
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) {
    return c.json({ error: "A conexão Google ainda não está configurada na plataforma." }, 503);
  }
  const existing = await getDriveConnection(c.env.DB, workspaceId);
  const state = randomToken();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  await c.env.DB.prepare("DELETE FROM drive_oauth_states WHERE expires_at < ? OR consumed_at IS NOT NULL").bind(Date.now()).run();
  await c.env.DB.prepare("INSERT INTO drive_oauth_states (state_hash, workspace_id, user_id, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await hashText(state), workspaceId, currentUser(c).id, expiresAt).run();
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(c),
    response_type: "code",
    scope: `openid email ${driveScope()}`,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent select_account",
    login_hint: existing?.google_email || currentUser(c).email,
    state,
  });
  return c.json({ authorizationUrl: `${GOOGLE_AUTH_URL}?${params}` });
});

oauthRoutes.get("/callback", async (c) => {
  const state = c.req.query("state") ?? "";
  const stateRow = state ? await c.env.DB.prepare(
    "SELECT state_hash, workspace_id, user_id, expires_at FROM drive_oauth_states WHERE state_hash = ? AND consumed_at IS NULL LIMIT 1",
  ).bind(await hashText(state)).first<{ state_hash: string; workspace_id: string; user_id: string; expires_at: number }>() : null;
  if (!stateRow || stateRow.expires_at < Date.now() || stateRow.user_id !== currentUser(c).id) {
    return c.redirect(workspaceUrl(c, "invalid"), 303);
  }
  const consumed = await c.env.DB.prepare("UPDATE drive_oauth_states SET consumed_at = ? WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?")
    .bind(Date.now(), stateRow.state_hash, Date.now()).run();
  if (!consumed.meta.changes) return c.redirect(workspaceUrl(c, "invalid"), 303);
  if (c.req.query("error")) return c.redirect(workspaceUrl(c, "cancelled"), 303);
  const code = c.req.query("code");
  if (!code || !c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) return c.redirect(workspaceUrl(c, "error"), 303);

  const owner = await c.env.DB.prepare("SELECT owner_user_id, name FROM workspaces WHERE id = ? LIMIT 1")
    .bind(stateRow.workspace_id).first<{ owner_user_id: string; name: string }>();
  if (!owner || owner.owner_user_id !== currentUser(c).id) return c.redirect(workspaceUrl(c, "owner_changed"), 303);

  try {
    const tokenResponse = await fetch(googleTokenUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: c.env.GOOGLE_CLIENT_ID,
        client_secret: c.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: callbackUrl(c),
        grant_type: "authorization_code",
      }),
    });
    const tokens = await tokenResponse.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
    if (!tokenResponse.ok || !tokens.access_token) return c.redirect(workspaceUrl(c, "token_error"), 303);
    if (tokens.scope && !tokens.scope.split(/\s+/).includes(driveScope())) {
      await fetch(GOOGLE_REVOKE_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: tokens.access_token }) });
      return c.redirect(workspaceUrl(c, "scope_missing"), 303);
    }

    const userInfoResponse = await fetch(googleUserInfoUrl(), { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const googleUser = await userInfoResponse.json() as { email?: string; email_verified?: boolean };
    if (!userInfoResponse.ok || !googleUser.email || googleUser.email_verified === false) {
      await fetch(GOOGLE_REVOKE_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: tokens.access_token }) });
      return c.redirect(workspaceUrl(c, "account_error"), 303);
    }
    const googleEmail = googleUser.email.toLowerCase();
    const previous = await getDriveConnection(c.env.DB, stateRow.workspace_id);
    if (previous && previous.google_email.toLowerCase() !== googleEmail) {
      await fetch(GOOGLE_REVOKE_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: tokens.access_token }) });
      return c.redirect(workspaceUrl(c, "account_mismatch"), 303);
    }

    const previousOwnerConnection = await c.env.DB.prepare(
      "SELECT root_folder_id, refresh_token_encrypted FROM workspace_drive_connections WHERE connected_by = ? AND lower(google_email) = ? LIMIT 1",
    ).bind(currentUser(c).id, googleEmail).first<{ root_folder_id: string; refresh_token_encrypted: string }>();
    const connection: DriveConnection = {
      workspace_id: stateRow.workspace_id,
      connected_by: currentUser(c).id,
      google_email: googleEmail,
      root_folder_id: previous?.root_folder_id ?? previousOwnerConnection?.root_folder_id ?? "",
      workspace_folder_id: previous?.workspace_folder_id ?? "",
      trash_folder_id: previous?.trash_folder_id ?? "",
      access_token_encrypted: await encryptDriveSecret(c.env, tokens.access_token),
      refresh_token_encrypted: tokens.refresh_token
        ? await encryptDriveSecret(c.env, tokens.refresh_token)
        : previous?.refresh_token_encrypted ?? previousOwnerConnection?.refresh_token_encrypted ?? "",
      access_token_expires_at: Date.now() + Math.max(60, tokens.expires_in ?? 3600) * 1000,
    };
    if (!connection.refresh_token_encrypted) {
      await fetch(GOOGLE_REVOKE_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: tokens.access_token }) });
      return c.redirect(workspaceUrl(c, "refresh_token_missing"), 303);
    }

    if (!connection.root_folder_id) {
      const params = new URLSearchParams({ q: `name='${ROOT_NAME}' and mimeType='${driveFolderMimeType()}' and trashed=false and appProperties has { key='gamaWorkRoot' and value='root' }`, pageSize: "10", fields: "files(id,name)" });
      const roots = await driveJson<{ files?: Array<{ id: string; name: string }> }>(c.env, connection, `${driveApiBase()}/files?${params}`);
      connection.root_folder_id = roots.files?.[0]?.id ?? (await createDriveFolder(c.env, connection, ROOT_NAME, "root", { gamaWork: "true", gamaWorkRoot: "root" })).id;
    }
    const workspaceFolder = previous?.workspace_folder_id
      ? { id: previous.workspace_folder_id }
      : await ensureDriveFolder(c.env, connection, owner.name.slice(0, 90), connection.root_folder_id, "workspaceId", stateRow.workspace_id);
    connection.workspace_folder_id = workspaceFolder.id;
    const trashFolder = previous?.trash_folder_id
      ? { id: previous.trash_folder_id }
      : await ensureDriveFolder(c.env, connection, ".lixeira", connection.workspace_folder_id, "workspaceTrash", stateRow.workspace_id);
    connection.trash_folder_id = trashFolder.id;

    const time = Date.now();
    await c.env.DB.prepare(
      `INSERT INTO workspace_drive_connections
       (workspace_id, connected_by, google_email, root_folder_id, workspace_folder_id, trash_folder_id, access_token_encrypted, refresh_token_encrypted, access_token_expires_at, connected_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET connected_by = excluded.connected_by, google_email = excluded.google_email,
       root_folder_id = excluded.root_folder_id, workspace_folder_id = excluded.workspace_folder_id, trash_folder_id = excluded.trash_folder_id,
       access_token_encrypted = excluded.access_token_encrypted, refresh_token_encrypted = excluded.refresh_token_encrypted,
       access_token_expires_at = excluded.access_token_expires_at, updated_at = excluded.updated_at`,
    ).bind(stateRow.workspace_id, currentUser(c).id, googleEmail, connection.root_folder_id, connection.workspace_folder_id, connection.trash_folder_id,
      connection.access_token_encrypted, connection.refresh_token_encrypted, connection.access_token_expires_at, time, time).run();
    return c.redirect(workspaceUrl(c, "connected"), 303);
  } catch (error) {
    console.error(JSON.stringify({ message: "Google Drive connection failed", workspaceId: stateRow.workspace_id, error: error instanceof Error ? error.message : String(error) }));
    return c.redirect(workspaceUrl(c, "error"), 303);
  }
});

export { oauthRoutes as driveOAuthRoutes, workspaceRoutes as workspaceDriveRoutes };
