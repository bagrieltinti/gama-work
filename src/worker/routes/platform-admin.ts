import { Hono } from "hono";
import type { AppEnv } from "../types";
import { currentUser, fieldText, isPlatformAdminEmail, readJson, requirePlatformAdmin } from "../lib";

const routes = new Hono<AppEnv>();
const now = () => Date.now();

async function authorize(c: import("hono").Context<AppEnv>) {
  if (await requirePlatformAdmin(c)) return null;
  return c.json({ error: "Esta área é restrita à administração da plataforma." }, 403);
}

async function recordAudit(
  c: import("hono").Context<AppEnv>,
  action: string,
  targetType: "user" | "workspace",
  targetId: string,
  details: Record<string, unknown>,
) {
  await c.env.DB.prepare(
    `INSERT INTO platform_admin_audit (id, actor_user_id, action, target_type, target_id, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), currentUser(c).id, action, targetType, targetId, JSON.stringify(details), now()).run();
}

routes.get("/overview", async (c) => {
  const denied = await authorize(c);
  if (denied) return denied;
  const [users, workspaces, activeWorkspaces, clients, files, recent] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM user").first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM workspaces").first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM workspaces w LEFT JOIN platform_workspace_status s ON s.workspace_id = w.id WHERE COALESCE(s.status, 'active') = 'active'").first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM clients").first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM workspace_files WHERE deleted_at IS NULL").first<{ count: number }>(),
    c.env.DB.prepare(
      `SELECT a.id, a.action, a.target_type, a.target_id, a.details_json, a.created_at, u.name AS actor_name, u.email AS actor_email
       FROM platform_admin_audit a LEFT JOIN user u ON u.id = a.actor_user_id
       ORDER BY a.created_at DESC LIMIT 12`,
    ).all(),
  ]);
  return c.json({
    stats: {
      users: users?.count ?? 0,
      workspaces: workspaces?.count ?? 0,
      activeWorkspaces: activeWorkspaces?.count ?? 0,
      clients: clients?.count ?? 0,
      files: files?.count ?? 0,
    },
    recent: recent.results,
  });
});

routes.get("/users", async (c) => {
  const denied = await authorize(c);
  if (denied) return denied;
  const query = fieldText(c.req.query("q"), 120).toLowerCase();
  const result = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.created_at,
            COALESCE(s.status, 'active') AS status, COALESCE(s.reason, '') AS reason, s.updated_at AS status_updated_at,
            (SELECT COUNT(*) FROM workspace_members m WHERE m.user_id = u.id) AS workspace_count,
            (SELECT COUNT(*) FROM workspaces w WHERE w.owner_user_id = u.id) AS owned_workspace_count
     FROM user u LEFT JOIN platform_user_status s ON s.user_id = u.id
     WHERE lower(u.name) LIKE ? OR lower(u.email) LIKE ?
     ORDER BY u.created_at DESC LIMIT 200`,
  ).bind(`%${query}%`, `%${query}%`).all();
  return c.json({ users: result.results });
});

routes.get("/workspaces", async (c) => {
  const denied = await authorize(c);
  if (denied) return denied;
  const query = fieldText(c.req.query("q"), 120).toLowerCase();
  const result = await c.env.DB.prepare(
    `SELECT w.id, w.name, w.description, w.created_at, u.name AS owner_name, u.email AS owner_email,
            COALESCE(s.status, 'active') AS status, COALESCE(s.reason, '') AS reason,
            (SELECT COUNT(*) FROM workspace_members m WHERE m.workspace_id = w.id) AS member_count,
            (SELECT COUNT(*) FROM clients cl WHERE cl.workspace_id = w.id) AS client_count,
            (SELECT COUNT(*) FROM workspace_files f WHERE f.workspace_id = w.id AND f.deleted_at IS NULL) AS file_count
     FROM workspaces w INNER JOIN user u ON u.id = w.owner_user_id
     LEFT JOIN platform_workspace_status s ON s.workspace_id = w.id
     WHERE lower(w.name) LIKE ? OR lower(u.name) LIKE ? OR lower(u.email) LIKE ?
     ORDER BY w.created_at DESC LIMIT 200`,
  ).bind(`%${query}%`, `%${query}%`, `%${query}%`).all();
  return c.json({ workspaces: result.results });
});

routes.get("/audit", async (c) => {
  const denied = await authorize(c);
  if (denied) return denied;
  const limit = Math.max(1, Math.min(100, Number(c.req.query("limit")) || 50));
  const result = await c.env.DB.prepare(
    `SELECT a.id, a.action, a.target_type, a.target_id, a.details_json, a.created_at, u.name AS actor_name, u.email AS actor_email
     FROM platform_admin_audit a LEFT JOIN user u ON u.id = a.actor_user_id
     ORDER BY a.created_at DESC LIMIT ?`,
  ).bind(limit).all();
  return c.json({ entries: result.results });
});

routes.patch("/users/:userId/status", async (c) => {
  const denied = await authorize(c);
  if (denied) return denied;
  const userId = c.req.param("userId") ?? "";
  const actor = currentUser(c);
  if (userId === actor.id) return c.json({ error: "Você não pode alterar o próprio acesso por esta tela." }, 400);
  const body = await readJson(c);
  const status = body.status === "suspended" ? "suspended" : body.status === "active" ? "active" : "";
  if (!status) return c.json({ error: "Selecione uma situação válida." }, 400);
  const target = await c.env.DB.prepare("SELECT id, email FROM user WHERE id = ? LIMIT 1").bind(userId).first<{ id: string; email: string }>();
  if (!target) return c.json({ error: "Conta não encontrada." }, 404);
  if (isPlatformAdminEmail(c.env, target.email)) {
    return c.json({ error: "O acesso administrativo principal não pode ser suspenso por esta ação." }, 403);
  }
  const reason = fieldText(body.reason, 240);
  const time = now();
  await c.env.DB.prepare(
    `INSERT INTO platform_user_status (user_id, status, reason, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET status = excluded.status, reason = excluded.reason, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(userId, status, status === "suspended" ? reason : "", actor.id, time).run();
  if (status === "suspended") await c.env.DB.prepare("DELETE FROM session WHERE user_id = ?").bind(userId).run();
  await recordAudit(c, status === "suspended" ? "user_suspended" : "user_reactivated", "user", userId, { email: target.email, reason });
  return c.json({ ok: true, status });
});

routes.patch("/workspaces/:workspaceId/status", async (c) => {
  const denied = await authorize(c);
  if (denied) return denied;
  const workspaceId = c.req.param("workspaceId") ?? "";
  const body = await readJson(c);
  const status = body.status === "suspended" ? "suspended" : body.status === "active" ? "active" : "";
  if (!status) return c.json({ error: "Selecione uma situação válida." }, 400);
  const target = await c.env.DB.prepare("SELECT id, name FROM workspaces WHERE id = ? LIMIT 1").bind(workspaceId).first<{ id: string; name: string }>();
  if (!target) return c.json({ error: "Espaço não encontrado." }, 404);
  const actor = currentUser(c);
  const reason = fieldText(body.reason, 240);
  const time = now();
  await c.env.DB.prepare(
    `INSERT INTO platform_workspace_status (workspace_id, status, reason, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id) DO UPDATE SET status = excluded.status, reason = excluded.reason, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(workspaceId, status, status === "suspended" ? reason : "", actor.id, time).run();
  await recordAudit(c, status === "suspended" ? "workspace_suspended" : "workspace_reactivated", "workspace", workspaceId, { name: target.name, reason });
  return c.json({ ok: true, status });
});

export default routes;
