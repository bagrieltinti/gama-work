import { Hono } from "hono";
import type { AppEnv, WorkspaceFile } from "../types";
import { currentUser, fieldText, getWorkspaceAccess, readJson } from "../lib";

const routes = new Hono<AppEnv>();
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const WORKSPACE_QUOTA_BYTES = 1024 * 1024 * 1024;
const now = () => Date.now();

type Folder = { id: string; workspace_id: string; parent_folder_id: string | null; name: string; created_at: number; updated_at: number };
type Version = { id: string; file_id: string; version_number: number; size: number; content_type: string; created_at: number; created_by: string; created_by_name?: string };

function cleanFilename(value: string): string {
  const name = value.replace(/[\\/\0\r\n]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+$/, "").slice(0, 180);
  return name || "arquivo";
}

function fileKey(workspaceId: string, fileId: string, version: number, versionId: string) {
  return `workspaces/${workspaceId}/files/${fileId}/v${version}/${versionId}`;
}

async function authorizeWorkspace(c: import("hono").Context<AppEnv>, workspaceId: string) {
  const access = await getWorkspaceAccess(c, workspaceId);
  if (!access) return { error: c.json({ error: "Este espaço não está disponível para sua conta." }, 404) };
  return { access };
}

async function fileForWorkspace(c: import("hono").Context<AppEnv>, workspaceId: string, fileId: string, includeDeleted = false) {
  return c.env.DB.prepare(
    `SELECT * FROM workspace_files WHERE id = ? AND workspace_id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"} LIMIT 1`,
  ).bind(fileId, workspaceId).first<WorkspaceFile & { object_key: string }>();
}

async function validFolder(c: import("hono").Context<AppEnv>, workspaceId: string, folderId: string | null) {
  if (!folderId) return true;
  return Boolean(await c.env.DB.prepare("SELECT id FROM workspace_file_folders WHERE id = ? AND workspace_id = ? LIMIT 1").bind(folderId, workspaceId).first());
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

async function quotaExceeded(c: import("hono").Context<AppEnv>, workspaceId: string, incomingSize: number) {
  const result = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(size), 0) AS used FROM workspace_file_versions WHERE workspace_id = ?",
  ).bind(workspaceId).first<{ used: number }>();
  return (result?.used ?? 0) + incomingSize > WORKSPACE_QUOTA_BYTES;
}

async function readUpload(c: import("hono").Context<AppEnv>) {
  const announcedSize = Number(c.req.header("content-length"));
  if (Number.isFinite(announcedSize) && announcedSize > MAX_FILE_BYTES) return null;
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  return bytes.byteLength <= MAX_FILE_BYTES ? bytes : null;
}

routes.get("/", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
  const folderId = fieldText(c.req.query("folderId"), 80) || null;
  const query = fieldText(c.req.query("q"), 120);
  if (!(await validFolder(c, workspaceId, folderId))) return c.json({ error: "Esta pasta não está disponível." }, 404);

  const folders = query ? { results: [] } : await c.env.DB.prepare(
    `SELECT id, workspace_id, parent_folder_id, name, created_at, updated_at
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
  const [usage, activeFiles] = await Promise.all([
    c.env.DB.prepare("SELECT COALESCE(SUM(size), 0) AS used FROM workspace_file_versions WHERE workspace_id = ?").bind(workspaceId).first<{ used: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM workspace_files WHERE workspace_id = ? AND deleted_at IS NULL").bind(workspaceId).first<{ count: number }>(),
  ]);
  return c.json({ folders: folders.results, files: files.results, folderTree: folderTree.results, currentFolder, breadcrumbs: query ? [] : await folderTrail(c, workspaceId, folderId), usage: { bytes: usage?.used ?? 0, files: activeFiles?.count ?? 0, limitBytes: WORKSPACE_QUOTA_BYTES } });
});

routes.get("/trash", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
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
  const body = await readJson(c);
  const name = cleanFilename(fieldText(body.name, 180));
  const parentId = fieldText(body.parentFolderId, 80) || null;
  if (!fieldText(body.name, 180)) return c.json({ error: "Informe um nome para a pasta." }, 400);
  if (!(await validFolder(c, workspaceId, parentId))) return c.json({ error: "A pasta de destino não está disponível." }, 404);
  const id = crypto.randomUUID();
  const time = now();
  await c.env.DB.prepare(
    `INSERT INTO workspace_file_folders (id, workspace_id, parent_folder_id, name, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, workspaceId, parentId, name, currentUser(c).id, time, time).run();
  return c.json({ folder: { id, workspace_id: workspaceId, parent_folder_id: parentId, name, created_at: time, updated_at: time } }, 201);
});

routes.patch("/folders/:folderId", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const folderId = c.req.param("folderId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
  const body = await readJson(c);
  const name = cleanFilename(fieldText(body.name, 180));
  if (!fieldText(body.name, 180)) return c.json({ error: "Informe um nome para a pasta." }, 400);
  const result = await c.env.DB.prepare(
    "UPDATE workspace_file_folders SET name = ?, updated_at = ? WHERE id = ? AND workspace_id = ?",
  ).bind(name, now(), folderId, workspaceId).run();
  if (!result.meta.changes) return c.json({ error: "Pasta não encontrada." }, 404);
  return c.json({ ok: true });
});

routes.delete("/folders/:folderId", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const folderId = c.req.param("folderId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
  const [children, files] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM workspace_file_folders WHERE workspace_id = ? AND parent_folder_id = ?").bind(workspaceId, folderId).first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM workspace_files WHERE workspace_id = ? AND folder_id = ? AND deleted_at IS NULL").bind(workspaceId, folderId).first<{ count: number }>(),
  ]);
  if ((children?.count ?? 0) || (files?.count ?? 0)) return c.json({ error: "Mova ou exclua o conteúdo antes de remover esta pasta." }, 409);
  const result = await c.env.DB.prepare("DELETE FROM workspace_file_folders WHERE id = ? AND workspace_id = ?").bind(folderId, workspaceId).run();
  if (!result.meta.changes) return c.json({ error: "Pasta não encontrada." }, 404);
  return c.json({ ok: true });
});

routes.post("/", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
  const bytes = await readUpload(c);
  if (!bytes) return c.json({ error: "O arquivo ultrapassa o limite de 20 MB." }, 413);
  const originalName = fieldText(c.req.header("x-file-name"), 700);
  let name = "";
  try { name = cleanFilename(decodeURIComponent(originalName)); } catch { name = cleanFilename(originalName); }
  const contentType = fieldText(c.req.header("content-type"), 120) || "application/octet-stream";
  const folderId = fieldText(c.req.header("x-folder-id"), 80) || null;
  if (!(await validFolder(c, workspaceId, folderId))) return c.json({ error: "A pasta de destino não está disponível." }, 404);
  if (await quotaExceeded(c, workspaceId, bytes.byteLength)) return c.json({ error: "Este espaço atingiu o limite beta de 1 GB de arquivos e versões." }, 413);
  const user = currentUser(c);
  const id = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const time = now();
  const objectKey = fileKey(workspaceId, id, 1, versionId);
  await c.env.FILES.put(objectKey, bytes, { httpMetadata: { contentType: "application/octet-stream" } });
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO workspace_files (id, workspace_id, folder_id, name, content_type, size, object_key, current_version, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      ).bind(id, workspaceId, folderId, name, contentType, bytes.byteLength, objectKey, user.id, user.id, time, time),
      c.env.DB.prepare(
        `INSERT INTO workspace_file_versions (id, file_id, workspace_id, version_number, object_key, size, content_type, created_by, created_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      ).bind(versionId, id, workspaceId, objectKey, bytes.byteLength, contentType, user.id, time),
    ]);
  } catch (issue) {
    await c.env.FILES.delete(objectKey);
    throw issue;
  }
  return c.json({ file: { id, workspace_id: workspaceId, folder_id: folderId, name, content_type: contentType, size: bytes.byteLength, current_version: 1, created_by: user.id, updated_by: user.id, created_at: time, updated_at: time, deleted_at: null } }, 201);
});

routes.patch("/:fileId", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const fileId = c.req.param("fileId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
  const file = await fileForWorkspace(c, workspaceId, fileId);
  if (!file) return c.json({ error: "Arquivo não encontrado." }, 404);
  const body = await readJson(c);
  const name = body.name === undefined ? file.name : cleanFilename(fieldText(body.name, 180));
  const folderId = body.folderId === undefined ? file.folder_id : fieldText(body.folderId, 80) || null;
  if (!name) return c.json({ error: "Informe um nome para o arquivo." }, 400);
  if (!(await validFolder(c, workspaceId, folderId))) return c.json({ error: "A pasta de destino não está disponível." }, 404);
  await c.env.DB.prepare("UPDATE workspace_files SET name = ?, folder_id = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
    .bind(name, folderId, now(), fileId, workspaceId).run();
  return c.json({ ok: true });
});

routes.get("/:fileId", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const fileId = c.req.param("fileId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
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
  const file = await fileForWorkspace(c, workspaceId, fileId);
  if (!file) return c.json({ error: "Arquivo não encontrado." }, 404);
  const baseVersion = Number(c.req.query("baseVersion"));
  if (!Number.isInteger(baseVersion) || baseVersion < 1) return c.json({ error: "A versão-base do arquivo é inválida." }, 400);
  if (baseVersion !== file.current_version) return c.json({ error: "Outra pessoa salvou uma versão mais recente. Atualize o documento antes de substituir o arquivo." }, 409);
  const bytes = await readUpload(c);
  if (!bytes) return c.json({ error: "O arquivo ultrapassa o limite de 20 MB." }, 413);
  if (await quotaExceeded(c, workspaceId, bytes.byteLength)) return c.json({ error: "Este espaço atingiu o limite beta de 1 GB de arquivos e versões." }, 413);
  const user = currentUser(c);
  const version = file.current_version + 1;
  const versionId = crypto.randomUUID();
  const objectKey = fileKey(workspaceId, fileId, version, versionId);
  const contentType = fieldText(c.req.header("content-type"), 120) || file.content_type;
  const time = now();
  await c.env.FILES.put(objectKey, bytes, { httpMetadata: { contentType: "application/octet-stream" } });
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO workspace_file_versions (id, file_id, workspace_id, version_number, object_key, size, content_type, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(versionId, fileId, workspaceId, version, objectKey, bytes.byteLength, contentType, user.id, time),
      c.env.DB.prepare(
        `UPDATE workspace_files SET size = ?, content_type = ?, object_key = ?, current_version = ?, updated_by = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ? AND current_version = ? AND deleted_at IS NULL`,
      ).bind(bytes.byteLength, contentType, objectKey, version, user.id, time, fileId, workspaceId, baseVersion),
    ]);
    const updated = await fileForWorkspace(c, workspaceId, fileId);
    if (updated?.current_version !== version) {
      await c.env.FILES.delete(objectKey);
      await c.env.DB.prepare("DELETE FROM workspace_file_versions WHERE id = ?").bind(versionId).run();
      return c.json({ error: "Outra pessoa salvou uma versão mais recente. Seu conteúdo não substituiu as alterações dela." }, 409);
    }
  } catch (issue) {
    await c.env.FILES.delete(objectKey);
    const latest = await fileForWorkspace(c, workspaceId, fileId);
    if (latest && latest.current_version !== baseVersion) {
      return c.json({ error: "Outra pessoa salvou uma versão mais recente. Seu conteúdo não substituiu as alterações dela." }, 409);
    }
    throw issue;
  }
  return c.json({ ok: true, version, name: file.name, size: bytes.byteLength });
});

routes.get("/:fileId/versions", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const fileId = c.req.param("fileId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
  if (!(await fileForWorkspace(c, workspaceId, fileId, true))) return c.json({ error: "Arquivo não encontrado." }, 404);
  const result = await c.env.DB.prepare(
    `SELECT v.id, v.file_id, v.version_number, v.size, v.content_type, v.created_at, v.created_by, u.name AS created_by_name
     FROM workspace_file_versions v LEFT JOIN user u ON u.id = v.created_by
     WHERE v.file_id = ? AND v.workspace_id = ? ORDER BY v.version_number DESC LIMIT 50`,
  ).bind(fileId, workspaceId).all<Version>();
  return c.json({ versions: result.results });
});

routes.get("/:fileId/content", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const fileId = c.req.param("fileId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
  const file = await fileForWorkspace(c, workspaceId, fileId);
  if (!file) return c.json({ error: "Arquivo não encontrado." }, 404);
  const versionNumber = Number(c.req.query("version")) || file.current_version;
  const version = await c.env.DB.prepare(
    "SELECT object_key, size, content_type FROM workspace_file_versions WHERE file_id = ? AND workspace_id = ? AND version_number = ? LIMIT 1",
  ).bind(fileId, workspaceId, versionNumber).first<{ object_key: string; size: number; content_type: string }>();
  if (!version) return c.json({ error: "Versão não encontrada." }, 404);
  const object = await c.env.FILES.get(version.object_key);
  if (!object) return c.json({ error: "O conteúdo deste arquivo não foi encontrado no armazenamento." }, 410);
  const inlineName = encodeURIComponent(file.name).replaceAll("'", "%27");
  return new Response(object.body, { headers: {
    "Content-Type": "application/octet-stream",
    "Content-Length": String(version.size),
    "Content-Disposition": `attachment; filename*=UTF-8''${inlineName}`,
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
  const file = await fileForWorkspace(c, workspaceId, fileId, true);
  if (!file || file.deleted_at) return c.json({ error: "Arquivo não encontrado." }, 404);
  const oldVersion = await c.env.DB.prepare(
    "SELECT object_key, size, content_type FROM workspace_file_versions WHERE file_id = ? AND workspace_id = ? AND version_number = ? LIMIT 1",
  ).bind(fileId, workspaceId, versionNumber).first<{ object_key: string; size: number; content_type: string }>();
  if (!oldVersion) return c.json({ error: "Versão não encontrada." }, 404);
  if (await quotaExceeded(c, workspaceId, oldVersion.size)) return c.json({ error: "Este espaço atingiu o limite beta de 1 GB de arquivos e versões." }, 413);
  const source = await c.env.FILES.get(oldVersion.object_key);
  if (!source) return c.json({ error: "O conteúdo desta versão não foi encontrado no armazenamento." }, 410);
  const user = currentUser(c);
  const nextVersion = file.current_version + 1;
  const versionId = crypto.randomUUID();
  const key = fileKey(workspaceId, fileId, nextVersion, versionId);
  const time = now();
  await c.env.FILES.put(key, source.body, { httpMetadata: { contentType: "application/octet-stream" } });
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO workspace_file_versions (id, file_id, workspace_id, version_number, object_key, size, content_type, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(versionId, fileId, workspaceId, nextVersion, key, oldVersion.size, oldVersion.content_type, user.id, time),
    c.env.DB.prepare(
      `UPDATE workspace_files SET size = ?, content_type = ?, object_key = ?, current_version = ?, updated_by = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    ).bind(oldVersion.size, oldVersion.content_type, key, nextVersion, user.id, time, fileId, workspaceId),
  ]);
  return c.json({ ok: true, version: nextVersion });
});

routes.delete("/:fileId", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const fileId = c.req.param("fileId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
  if (c.req.query("permanent") === "true") {
    const file = await fileForWorkspace(c, workspaceId, fileId, true);
    if (!file || !file.deleted_at) return c.json({ error: "Mova o arquivo para a lixeira antes de excluí-lo permanentemente." }, 404);
    const versions = await c.env.DB.prepare("SELECT object_key FROM workspace_file_versions WHERE file_id = ? AND workspace_id = ?")
      .bind(fileId, workspaceId).all<{ object_key: string }>();
    if (versions.results.length) await c.env.FILES.delete(versions.results.map((version: { object_key: string }) => version.object_key));
    await c.env.DB.prepare("DELETE FROM workspace_files WHERE id = ? AND workspace_id = ?").bind(fileId, workspaceId).run();
    return c.json({ ok: true, permanentlyDeleted: true });
  }
  const result = await c.env.DB.prepare("UPDATE workspace_files SET deleted_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL")
    .bind(now(), now(), fileId, workspaceId).run();
  if (!result.meta.changes) return c.json({ error: "Arquivo não encontrado." }, 404);
  return c.json({ ok: true });
});

routes.post("/:fileId/restore-trash", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const fileId = c.req.param("fileId") ?? "";
  const { error } = await authorizeWorkspace(c, workspaceId);
  if (error) return error;
  const file = await fileForWorkspace(c, workspaceId, fileId, true);
  if (!file || !file.deleted_at) return c.json({ error: "Arquivo não encontrado na lixeira." }, 404);
  const result = await c.env.DB.prepare("UPDATE workspace_files SET deleted_at = NULL, updated_at = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NOT NULL")
    .bind(now(), fileId, workspaceId).run();
  if (!result.meta.changes) return c.json({ error: "Arquivo não encontrado na lixeira." }, 404);
  return c.json({ ok: true });
});

export default routes;
