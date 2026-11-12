import { Hono } from "hono";
import type { AppEnv, WorkspaceFile } from "../types";
import { currentUser, fieldText, getWorkspaceAccess, readJson } from "../lib";
import {
  deleteDriveFile,
  downloadDriveFile,
  driveApiJson,
  driveUpload,
  getDriveConnection,
  pruneDriveVersions,
  updateDriveFileMetadata,
  type DriveConnection,
  type DriveFile,
  DriveApiError,
} from "../drive-storage";

const routes = new Hono<AppEnv>();
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const VERSION_LIMIT = 50;
const now = () => Date.now();

type Folder = { id: string; workspace_id: string; parent_folder_id: string | null; name: string; created_at: number; updated_at: number; drive_folder_id: string };
type Version = { id: string; file_id: string; version_number: number; size: number; content_type: string; created_at: number; created_by: string; created_by_name?: string; drive_revision_id: string };
type StoredFile = WorkspaceFile & { object_key: string; drive_head_revision_id: string | null; write_lock: string | null; write_lock_at: number | null };

function cleanFilename(value: string): string {
  const name = value.replace(/[\\/\0\r\n]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+$/, "").slice(0, 180);
  return name || "arquivo";
}

function fileForWorkspace(c: import("hono").Context<AppEnv>, workspaceId: string, fileId: string, includeDeleted = false) {
  return c.env.DB.prepare(
    `SELECT * FROM workspace_files WHERE id = ? AND workspace_id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"} LIMIT 1`,
  ).bind(fileId, workspaceId).first<StoredFile>();
}

async function workspaceDrive(c: import("hono").Context<AppEnv>, workspaceId: string): Promise<DriveConnection | null> {
  return getDriveConnection(c.env.DB, workspaceId);
}

async function authorizeWorkspace(c: import("hono").Context<AppEnv>, workspaceId: string) {
  const access = await getWorkspaceAccess(c, workspaceId);
  if (!access) return { error: c.json({ error: "Este espaço não está disponível para sua conta." }, 404) };
  return { access };
}

async function validFolder(c: import("hono").Context<AppEnv>, workspaceId: string, folderId: string | null) {
  if (!folderId) return true;
  return Boolean(await c.env.DB.prepare("SELECT id FROM workspace_file_folders WHERE id = ? AND workspace_id = ? LIMIT 1").bind(folderId, workspaceId).first());
}

async function folderForWorkspace(c: import("hono").Context<AppEnv>, workspaceId: string, folderId: string | null) {
  if (!folderId) return null;
  return c.env.DB.prepare("SELECT id, drive_folder_id FROM workspace_file_folders WHERE id = ? AND workspace_id = ? LIMIT 1")
    .bind(folderId, workspaceId).first<{ id: string; drive_folder_id: string }>();
}

async function folderTrail(c: import("hono").Context<AppEnv>, workspaceId: string, folderId: string | null) {
  const trail: Array<{ id: string; name: string }> = [];
  let current = folderId;
  for (let depth = 0; current && depth < 24; depth += 1) {
    const folder = await c.env.DB.prepare(
      "SELECT id, name, parent_folder_id FROM workspace_file_folders WHERE id = ? AND workspace_id = ? LIMIT 1",
    ).bind(current, workspaceId).first<{ id: string; name: string; parent_folder_id: string | null }>();
    if (!folder) break;
    trail.unshift({ id: folder.id, name: folder.name });
    current = folder.parent_folder_id;
  }
  return trail;
}

async function workspaceUsage(c: import("hono").Context<AppEnv>, workspaceId: string) {
  const [usage, activeFiles] = await Promise.all([
    c.env.DB.prepare("SELECT COALESCE(SUM(size), 0) AS used FROM workspace_file_versions WHERE workspace_id = ?").bind(workspaceId).first<{ used: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM workspace_files WHERE workspace_id = ? AND deleted_at IS NULL").bind(workspaceId).first<{ count: number }>(),
  ]);
  return { bytes: usage?.used ?? 0, files: activeFiles?.count ?? 0 };
}

async function parentDriveId(c: import("hono").Context<AppEnv>, workspaceId: string, connection: DriveConnection, folderId: string | null) {
  const folder = await folderForWorkspace(c, workspaceId, folderId);
  return folder?.drive_folder_id ?? connection.workspace_folder_id;
}

async function appendRemoteVersion(
  c: import("hono").Context<AppEnv>,
  connection: DriveConnection,
  file: StoredFile,
  bytes: Uint8Array,
  contentType: string,
  actorId: string,
  baseVersion: number,
) {
  const lockId = crypto.randomUUID();
  const time = now();
  const claim = await c.env.DB.prepare(
    `UPDATE workspace_files SET write_lock = ?, write_lock_at = ?
     WHERE id = ? AND workspace_id = ? AND current_version = ? AND (write_lock IS NULL OR write_lock_at < ?)`,
  ).bind(lockId, time, file.id, file.workspace_id, baseVersion, time - 10 * 60 * 1000).run();
  if (!claim.meta.changes) return c.json({ error: "Outra pessoa está salvando este arquivo ou há uma versão mais recente. Atualize e tente novamente." }, 409);

  try {
    const latest = await driveApiJson<DriveFile>(c.env, connection, `/files/${encodeURIComponent(file.object_key)}?fields=id,name,size,headRevisionId`);
    if (file.drive_head_revision_id && latest.headRevisionId !== file.drive_head_revision_id) {
      return c.json({ error: "O arquivo foi alterado diretamente no Google Drive. Recarregue o documento antes de salvar." }, 409);
    }
    const nextVersion = baseVersion + 1;
    const saved = await driveUpload(c.env, connection, {
      fileId: file.object_key,
      name: file.name,
      mimeType: contentType,
      bytes,
      pinRevision: true,
    });
    const revisionId = saved.headRevisionId;
    if (!revisionId) throw new Error("O Google Drive não retornou a revisão do arquivo.");
    const versionId = crypto.randomUUID();
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO workspace_file_versions (id, file_id, workspace_id, version_number, object_key, drive_revision_id, size, content_type, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(versionId, file.id, file.workspace_id, nextVersion, revisionId, revisionId, bytes.byteLength, contentType, actorId, time),
      c.env.DB.prepare(
        `UPDATE workspace_files SET size = ?, content_type = ?, drive_head_revision_id = ?, current_version = ?, updated_by = ?, updated_at = ?, write_lock = NULL, write_lock_at = NULL
         WHERE id = ? AND workspace_id = ? AND current_version = ? AND write_lock = ?`,
      ).bind(bytes.byteLength, contentType, revisionId, nextVersion, actorId, time, file.id, file.workspace_id, baseVersion, lockId),
    ]);
    if (!results[1]?.meta?.changes) {
      await c.env.DB.prepare("DELETE FROM workspace_file_versions WHERE id = ?").bind(versionId).run();
      return c.json({ error: "O arquivo mudou durante o salvamento. Atualize antes de continuar." }, 409);
    }
    await pruneDriveVersions(c.env, connection, file.id, c.env.DB);
    return c.json({ ok: true, version: nextVersion, name: file.name, size: bytes.byteLength });
  } finally {
    await c.env.DB.prepare("UPDATE workspace_files SET write_lock = NULL, write_lock_at = NULL WHERE id = ? AND workspace_id = ? AND write_lock = ?")
      .bind(file.id, file.workspace_id, lockId).run();
  }
}

function encodeFilename(name: string) { return encodeURIComponent(name).replaceAll("'", "%27"); }

routes.get("/", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
  const connection = await workspaceDrive(c, workspaceId);
  if (!connection) return c.json({ driveConnected: false, folders: [], files: [], folderTree: [], currentFolder: null, breadcrumbs: [], usage: { ...(await workspaceUsage(c, workspaceId)), limitBytes: null } });
  const folderId = fieldText(c.req.query("folderId"), 80) || null;
  const query = fieldText(c.req.query("q"), 120);
  if (!(await validFolder(c, workspaceId, folderId))) return c.json({ error: "Esta pasta não está disponível." }, 404);

  const folders = query ? { results: [] as Folder[] } : await c.env.DB.prepare(
    `SELECT id, workspace_id, parent_folder_id, name, created_at, updated_at, drive_folder_id
     FROM workspace_file_folders WHERE workspace_id = ? AND parent_folder_id IS ? ORDER BY name COLLATE NOCASE LIMIT 300`,
  ).bind(workspaceId, folderId).all<Folder>();
  const files = query
    ? await c.env.DB.prepare(
        `SELECT id, workspace_id, folder_id, name, content_type, size, current_version, created_by, updated_by, created_at, updated_at, deleted_at
         FROM workspace_files WHERE workspace_id = ? AND deleted_at IS NULL AND lower(name) LIKE ? ORDER BY name COLLATE NOCASE LIMIT 300`,
      ).bind(workspaceId, `%${query.toLowerCase()}%`).all<WorkspaceFile>()
    : await c.env.DB.prepare(
        `SELECT id, workspace_id, folder_id, name, content_type, size, current_version, created_by, updated_by, created_at, updated_at, deleted_at
         FROM workspace_files WHERE workspace_id = ? AND folder_id IS ? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE LIMIT 300`,
      ).bind(workspaceId, folderId).all<WorkspaceFile>();
  const currentFolder = folderId ? await c.env.DB.prepare(
    "SELECT id, name, parent_folder_id FROM workspace_file_folders WHERE id = ? AND workspace_id = ? LIMIT 1",
  ).bind(folderId, workspaceId).first() : null;
  const folderTree = await c.env.DB.prepare(
    "SELECT id, parent_folder_id, name FROM workspace_file_folders WHERE workspace_id = ? ORDER BY name COLLATE NOCASE LIMIT 1000",
  ).bind(workspaceId).all<{ id: string; parent_folder_id: string | null; name: string }>();
  return c.json({ driveConnected: true, folders: folders.results, files: files.results, folderTree: folderTree.results, currentFolder, breadcrumbs: query ? [] : await folderTrail(c, workspaceId, folderId), usage: { ...(await workspaceUsage(c, workspaceId)), limitBytes: null } });
});

routes.get("/trash", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
  if (!(await workspaceDrive(c, workspaceId))) return c.json({ error: "Conecte o Google Drive para acessar os arquivos compartilhados." }, 409);
  const rows = await c.env.DB.prepare(
    `SELECT id, workspace_id, folder_id, name, content_type, size, current_version, created_by, updated_by, created_at, updated_at, deleted_at
     FROM workspace_files WHERE workspace_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 300`,
  ).bind(workspaceId).all<WorkspaceFile>();
  return c.json({ files: rows.results });
});

routes.post("/folders", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
  const connection = await workspaceDrive(c, workspaceId);
  if (!connection) return c.json({ error: "A proprietária precisa conectar o Google Drive antes de criar pastas compartilhadas." }, 409);
  const body = await readJson(c);
  const rawName = fieldText(body.name, 180);
  const name = cleanFilename(rawName);
  const parentId = fieldText(body.parentFolderId, 80) || null;
  if (!rawName) return c.json({ error: "Informe um nome para a pasta." }, 400);
  if (!(await validFolder(c, workspaceId, parentId))) return c.json({ error: "A pasta de destino não está disponível." }, 404);
  const parentDrive = await parentDriveId(c, workspaceId, connection, parentId);
  const id = crypto.randomUUID();
  const driveFolder = await driveApiJson<DriveFile>(c.env, connection, "/files?fields=id,name,mimeType,parents", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentDrive], appProperties: { gamaWork: "true", workspaceId, folderId: id } }),
  });
  const user = currentUser(c);
  const time = now();
  try {
    await c.env.DB.prepare(
      `INSERT INTO workspace_file_folders (id, workspace_id, parent_folder_id, name, created_by, created_at, updated_at, drive_folder_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, workspaceId, parentId, name, user.id, time, time, driveFolder.id).run();
  } catch (issue) {
    await deleteDriveFile(c.env, connection, driveFolder.id);
    throw issue;
  }
  return c.json({ folder: { id, workspace_id: workspaceId, parent_folder_id: parentId, name, created_at: time, updated_at: time } }, 201);
});

routes.patch("/folders/:folderId", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const folderId = c.req.param("folderId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
  const connection = await workspaceDrive(c, workspaceId);
  if (!connection) return c.json({ error: "A proprietária precisa conectar o Google Drive para editar pastas compartilhadas." }, 409);
  const body = await readJson(c);
  const rawName = fieldText(body.name, 180);
  const name = cleanFilename(rawName);
  if (!rawName) return c.json({ error: "Informe um nome para a pasta." }, 400);
  const folder = await c.env.DB.prepare("SELECT drive_folder_id FROM workspace_file_folders WHERE id = ? AND workspace_id = ? LIMIT 1")
    .bind(folderId, workspaceId).first<{ drive_folder_id: string }>();
  if (!folder) return c.json({ error: "Pasta não encontrada." }, 404);
  await updateDriveFileMetadata(c.env, connection, folder.drive_folder_id, { name });
  await c.env.DB.prepare("UPDATE workspace_file_folders SET name = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
    .bind(name, now(), folderId, workspaceId).run();
  return c.json({ ok: true });
});

routes.delete("/folders/:folderId", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const folderId = c.req.param("folderId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
  const connection = await workspaceDrive(c, workspaceId);
  if (!connection) return c.json({ error: "A proprietária precisa conectar o Google Drive para remover pastas compartilhadas." }, 409);
  const [children, files, folder] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM workspace_file_folders WHERE workspace_id = ? AND parent_folder_id = ?").bind(workspaceId, folderId).first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM workspace_files WHERE workspace_id = ? AND folder_id = ?").bind(workspaceId, folderId).first<{ count: number }>(),
    c.env.DB.prepare("SELECT drive_folder_id FROM workspace_file_folders WHERE workspace_id = ? AND id = ? LIMIT 1").bind(workspaceId, folderId).first<{ drive_folder_id: string }>(),
  ]);
  if (!folder) return c.json({ error: "Pasta não encontrada." }, 404);
  if ((children?.count ?? 0) || (files?.count ?? 0)) return c.json({ error: "Mova ou exclua o conteúdo antes de remover esta pasta." }, 409);
  await deleteDriveFile(c.env, connection, folder.drive_folder_id);
  await c.env.DB.prepare("DELETE FROM workspace_file_folders WHERE id = ? AND workspace_id = ?").bind(folderId, workspaceId).run();
  return c.json({ ok: true });
});

routes.post("/", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
  const connection = await workspaceDrive(c, workspaceId);
  if (!connection) return c.json({ error: "A proprietária precisa conectar o Google Drive antes de enviar arquivos compartilhados." }, 409);
  const announcedSize = Number(c.req.header("content-length"));
  if (Number.isFinite(announcedSize) && announcedSize > MAX_FILE_BYTES) return c.json({ error: "O arquivo ultrapassa o limite de 20 MB." }, 413);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > MAX_FILE_BYTES) return c.json({ error: "O arquivo ultrapassa o limite de 20 MB." }, 413);
  const originalName = fieldText(c.req.header("x-file-name"), 700);
  let name = "";
  try { name = cleanFilename(decodeURIComponent(originalName)); } catch { name = cleanFilename(originalName); }
  const contentType = fieldText(c.req.header("content-type"), 120) || "application/octet-stream";
  const folderId = fieldText(c.req.header("x-folder-id"), 80) || null;
  if (!(await validFolder(c, workspaceId, folderId))) return c.json({ error: "A pasta de destino não está disponível." }, 404);
  const parentId = await parentDriveId(c, workspaceId, connection, folderId);
  const user = currentUser(c);
  const id = crypto.randomUUID();
  const time = now();
  const saved = await driveUpload(c.env, connection, { name, mimeType: contentType, bytes, parentId, pinRevision: true });
  if (!saved.headRevisionId) {
    await deleteDriveFile(c.env, connection, saved.id);
    return c.json({ error: "O Google Drive não confirmou a versão inicial do arquivo." }, 502);
  }
  const versionId = crypto.randomUUID();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO workspace_files (id, workspace_id, folder_id, name, content_type, size, object_key, drive_head_revision_id, current_version, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      ).bind(id, workspaceId, folderId, name, contentType, bytes.byteLength, saved.id, saved.headRevisionId, user.id, user.id, time, time),
      c.env.DB.prepare(
        `INSERT INTO workspace_file_versions (id, file_id, workspace_id, version_number, object_key, drive_revision_id, size, content_type, created_by, created_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      ).bind(versionId, id, workspaceId, saved.headRevisionId, saved.headRevisionId, bytes.byteLength, contentType, user.id, time),
    ]);
  } catch (issue) {
    await deleteDriveFile(c.env, connection, saved.id);
    throw issue;
  }
  return c.json({ file: { id, workspace_id: workspaceId, folder_id: folderId, name, content_type: contentType, size: bytes.byteLength, current_version: 1, created_by: user.id, updated_by: user.id, created_at: time, updated_at: time, deleted_at: null } }, 201);
});

routes.patch("/:fileId", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const fileId = c.req.param("fileId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
  const connection = await workspaceDrive(c, workspaceId);
  if (!connection) return c.json({ error: "A proprietária precisa conectar o Google Drive para organizar arquivos compartilhados." }, 409);
  const file = await fileForWorkspace(c, workspaceId, fileId);
  if (!file) return c.json({ error: "Arquivo não encontrado." }, 404);
  const body = await readJson(c);
  const rawName = body.name === undefined ? file.name : fieldText(body.name, 180);
  const name = cleanFilename(rawName);
  const folderId = body.folderId === undefined ? file.folder_id : fieldText(body.folderId, 80) || null;
  if (!name) return c.json({ error: "Informe um nome para o arquivo." }, 400);
  if (!(await validFolder(c, workspaceId, folderId))) return c.json({ error: "A pasta de destino não está disponível." }, 404);
  const oldParent = await parentDriveId(c, workspaceId, connection, file.folder_id);
  const newParent = await parentDriveId(c, workspaceId, connection, folderId);
  await updateDriveFileMetadata(c.env, connection, file.object_key, { name }, oldParent === newParent ? undefined : { add: newParent, remove: oldParent });
  await c.env.DB.prepare("UPDATE workspace_files SET name = ?, folder_id = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
    .bind(name, folderId, now(), fileId, workspaceId).run();
  return c.json({ ok: true });
});

routes.get("/:fileId", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const fileId = c.req.param("fileId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
  if (!(await workspaceDrive(c, workspaceId))) return c.json({ error: "Conecte o Google Drive para acessar este arquivo compartilhado." }, 409);
  const file = await c.env.DB.prepare(
    `SELECT id, workspace_id, folder_id, name, content_type, size, current_version, created_by, updated_by, created_at, updated_at, deleted_at
     FROM workspace_files WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL LIMIT 1`,
  ).bind(fileId, workspaceId).first<WorkspaceFile>();
  return file ? c.json({ file }) : c.json({ error: "Arquivo não encontrado." }, 404);
});

routes.put("/:fileId/content", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const fileId = c.req.param("fileId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
  const connection = await workspaceDrive(c, workspaceId);
  if (!connection) return c.json({ error: "A proprietária precisa conectar o Google Drive antes de salvar arquivos compartilhados." }, 409);
  const file = await fileForWorkspace(c, workspaceId, fileId);
  if (!file) return c.json({ error: "Arquivo não encontrado." }, 404);
  const baseVersion = Number(c.req.query("baseVersion"));
  if (!Number.isInteger(baseVersion) || baseVersion < 1) return c.json({ error: "A versão-base do arquivo é inválida." }, 400);
  if (baseVersion !== file.current_version) return c.json({ error: "Outra pessoa salvou uma versão mais recente. Atualize o documento antes de substituir o arquivo." }, 409);
  const announcedSize = Number(c.req.header("content-length"));
  if (Number.isFinite(announcedSize) && announcedSize > MAX_FILE_BYTES) return c.json({ error: "O arquivo ultrapassa o limite de 20 MB." }, 413);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > MAX_FILE_BYTES) return c.json({ error: "O arquivo ultrapassa o limite de 20 MB." }, 413);
  const contentType = fieldText(c.req.header("content-type"), 120) || file.content_type;
  return appendRemoteVersion(c, connection, file, bytes, contentType, currentUser(c).id, baseVersion);
});

routes.get("/:fileId/versions", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const fileId = c.req.param("fileId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
  if (!(await workspaceDrive(c, workspaceId))) return c.json({ error: "Conecte o Google Drive para acessar o histórico de versões." }, 409);
  if (!(await fileForWorkspace(c, workspaceId, fileId, true))) return c.json({ error: "Arquivo não encontrado." }, 404);
  const result = await c.env.DB.prepare(
    `SELECT v.id, v.file_id, v.version_number, v.size, v.content_type, v.created_at, v.created_by, v.drive_revision_id, u.name AS created_by_name
     FROM workspace_file_versions v LEFT JOIN user u ON u.id = v.created_by
     WHERE v.file_id = ? AND v.workspace_id = ? ORDER BY v.version_number DESC LIMIT ?`,
  ).bind(fileId, workspaceId, VERSION_LIMIT).all<Version>();
  return c.json({ versions: result.results });
});

routes.get("/:fileId/content", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const fileId = c.req.param("fileId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
  const connection = await workspaceDrive(c, workspaceId);
  if (!connection) return c.json({ error: "Conecte o Google Drive para acessar arquivos compartilhados." }, 409);
  const file = await fileForWorkspace(c, workspaceId, fileId);
  if (!file) return c.json({ error: "Arquivo não encontrado." }, 404);
  if (file.write_lock && (file.write_lock_at ?? 0) > now() - 10 * 60 * 1000) return c.json({ error: "Este arquivo está sendo salvo. Tente novamente em instantes." }, 409);
  const versionNumber = Number(c.req.query("version")) || file.current_version;
  const version = await c.env.DB.prepare(
    "SELECT drive_revision_id, size, content_type FROM workspace_file_versions WHERE file_id = ? AND workspace_id = ? AND version_number = ? LIMIT 1",
  ).bind(fileId, workspaceId, versionNumber).first<{ drive_revision_id: string; size: number; content_type: string }>();
  if (!version) return c.json({ error: "Versão não encontrada." }, 404);
  const response = await downloadDriveFile(c.env, connection, file.object_key, version.drive_revision_id);
  if (!response.ok) return c.json({ error: response.status === 404 ? "Esta revisão não está mais disponível no Google Drive." : "Não foi possível baixar o arquivo do Google Drive." }, response.status === 404 ? 410 : 502);
  return new Response(response.body, { headers: {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeFilename(file.name)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  } });
});

routes.post("/:fileId/restore/:versionNumber", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const fileId = c.req.param("fileId") ?? "";
  const versionNumber = Number(c.req.param("versionNumber"));
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
  const connection = await workspaceDrive(c, workspaceId);
  if (!connection) return c.json({ error: "Conecte o Google Drive para restaurar versões." }, 409);
  const file = await fileForWorkspace(c, workspaceId, fileId, true);
  if (!file || file.deleted_at) return c.json({ error: "Arquivo não encontrado." }, 404);
  const oldVersion = await c.env.DB.prepare(
    "SELECT drive_revision_id, size, content_type FROM workspace_file_versions WHERE file_id = ? AND workspace_id = ? AND version_number = ? LIMIT 1",
  ).bind(fileId, workspaceId, versionNumber).first<{ drive_revision_id: string; size: number; content_type: string }>();
  if (!oldVersion) return c.json({ error: "Versão não encontrada." }, 404);
  const oldContent = await downloadDriveFile(c.env, connection, file.object_key, oldVersion.drive_revision_id);
  if (!oldContent.ok) return c.json({ error: "O Google Drive não disponibilizou esta revisão para restauração." }, 410);
  const bytes = new Uint8Array(await oldContent.arrayBuffer());
  return appendRemoteVersion(c, connection, file, bytes, oldVersion.content_type, currentUser(c).id, file.current_version);
});

routes.delete("/:fileId", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const fileId = c.req.param("fileId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
  const connection = await workspaceDrive(c, workspaceId);
  if (!connection) return c.json({ error: "Conecte o Google Drive para organizar arquivos compartilhados." }, 409);
  if (c.req.query("permanent") === "true") {
    const file = await fileForWorkspace(c, workspaceId, fileId, true);
    if (!file || !file.deleted_at) return c.json({ error: "Mova o arquivo para a lixeira antes de excluí-lo permanentemente." }, 404);
    await deleteDriveFile(c.env, connection, file.object_key);
    await c.env.DB.prepare("DELETE FROM workspace_files WHERE id = ? AND workspace_id = ?").bind(fileId, workspaceId).run();
    return c.json({ ok: true, permanentlyDeleted: true });
  }
  const file = await fileForWorkspace(c, workspaceId, fileId);
  if (!file) return c.json({ error: "Arquivo não encontrado." }, 404);
  const oldParent = await parentDriveId(c, workspaceId, connection, file.folder_id);
  await updateDriveFileMetadata(c.env, connection, file.object_key, {}, { add: connection.trash_folder_id, remove: oldParent });
  const time = now();
  const result = await c.env.DB.prepare("UPDATE workspace_files SET deleted_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL")
    .bind(time, time, fileId, workspaceId).run();
  if (!result.meta.changes) return c.json({ error: "Arquivo não encontrado." }, 404);
  return c.json({ ok: true });
});

routes.post("/:fileId/restore-trash", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const fileId = c.req.param("fileId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
  const connection = await workspaceDrive(c, workspaceId);
  if (!connection) return c.json({ error: "Conecte o Google Drive para restaurar arquivos." }, 409);
  const file = await fileForWorkspace(c, workspaceId, fileId, true);
  if (!file || !file.deleted_at) return c.json({ error: "Arquivo não encontrado na lixeira." }, 404);
  const targetParent = await parentDriveId(c, workspaceId, connection, file.folder_id);
  await updateDriveFileMetadata(c.env, connection, file.object_key, {}, { add: targetParent, remove: connection.trash_folder_id });
  const result = await c.env.DB.prepare("UPDATE workspace_files SET deleted_at = NULL, updated_at = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NOT NULL")
    .bind(now(), fileId, workspaceId).run();
  if (!result.meta.changes) return c.json({ error: "Arquivo não encontrado na lixeira." }, 404);
  return c.json({ ok: true });
});

routes.onError((error, c) => {
  if (error instanceof DriveApiError) {
    const status = error.status === 401 ? 409 : error.status === 403 ? 507 : error.status === 429 ? 429 : 502;
    return c.json({ error: error.message }, status);
  }
  console.error(JSON.stringify({ message: "Drive files request failed", path: c.req.path, error: error instanceof Error ? error.message : String(error) }));
  return c.json({ error: "Não foi possível concluir esta ação agora." }, 500);
});

export default routes;
