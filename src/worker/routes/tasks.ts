import { Hono } from "hono";
import type { AppEnv } from "../types";
import { currentUser, fieldText, getWorkspaceAccess, readJson } from "../lib";

const routes = new Hono<AppEnv>();

function dateValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function memberOr404(c: import("hono").Context<AppEnv>, workspaceId: string) {
  const access = await getWorkspaceAccess(c, workspaceId);
  if (!access) return null;
  return access;
}

routes.get("/", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const user = currentUser(c);
  const access = await memberOr404(c, workspaceId);
  if (!access) return c.json({ error: "Este espaço não está disponível para sua conta." }, 404);
  const from = dateValue(c.req.query("from"));
  const to = dateValue(c.req.query("to"));
  const filters = ["t.workspace_id = ?", "(t.is_shared = 1 OR t.created_by = ? OR t.assigned_user_id = ?)"];
  const params: Array<string | number> = [workspaceId, user.id, user.id];
  if (from !== null) {
    filters.push("COALESCE(t.start_at, t.due_at) >= ?");
    params.push(from);
  }
  if (to !== null) {
    filters.push("COALESCE(t.start_at, t.due_at) < ?");
    params.push(to);
  }
  const result = await c.env.DB.prepare(
    `SELECT t.id, t.client_id, t.title, t.details, t.kind, t.status, t.due_at, t.start_at, t.end_at,
            t.is_shared, t.assigned_user_id, t.created_by, t.created_at, t.updated_at,
            cl.name AS client_name, u.name AS assigned_name
     FROM tasks t LEFT JOIN clients cl ON cl.id = t.client_id
     LEFT JOIN user u ON u.id = t.assigned_user_id
     WHERE ${filters.join(" AND ")} ORDER BY COALESCE(t.start_at, t.due_at), t.created_at LIMIT 1000`,
  )
    .bind(...params)
    .all();
  return c.json({ tasks: result.results });
});

routes.post("/", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const user = currentUser(c);
  const access = await memberOr404(c, workspaceId);
  if (!access) return c.json({ error: "Este espaço não está disponível para sua conta." }, 404);
  const body = await readJson(c);
  const title = fieldText(body.title, 140);
  if (!title) return c.json({ error: "Dê um nome à tarefa ou ao compromisso." }, 400);
  const kind = body.kind === "appointment" ? "appointment" : "task";
  const status = body.status === "done" || body.status === "in_progress" ? body.status : "open";
  const isShared = body.isShared !== false;
  const clientId = fieldText(body.clientId, 80) || null;
  if (clientId) {
    const client = await c.env.DB.prepare("SELECT id FROM clients WHERE id = ? AND workspace_id = ? LIMIT 1")
      .bind(clientId, workspaceId).first<{ id: string }>();
    if (!client) return c.json({ error: "O cliente escolhido não pertence a este espaço." }, 400);
  }
  const requestedAssignee = fieldText(body.assignedUserId, 80);
  const assignedId = isShared ? requestedAssignee || user.id : user.id;
  if (assignedId !== user.id) {
    const member = await c.env.DB.prepare("SELECT 1 AS yes FROM workspace_members WHERE workspace_id = ? AND user_id = ? LIMIT 1")
      .bind(workspaceId, assignedId).first<{ yes: number }>();
    if (!member) return c.json({ error: "A pessoa responsável precisa participar deste espaço." }, 400);
  }
  const id = crypto.randomUUID();
  const time = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO tasks (id, workspace_id, client_id, title, details, kind, status, due_at, start_at, end_at,
                        is_shared, assigned_user_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, workspaceId, clientId, title, fieldText(body.details, 2000), kind, status,
      dateValue(body.dueAt), dateValue(body.startAt), dateValue(body.endAt),
      isShared ? 1 : 0, assignedId, user.id, time, time,
    )
    .run();
  return c.json({ task: { id, title, kind, status, is_shared: isShared ? 1 : 0, assigned_user_id: assignedId } }, 201);
});

routes.patch("/:taskId", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const taskId = c.req.param("taskId") ?? "";
  const user = currentUser(c);
  const access = await memberOr404(c, workspaceId);
  if (!access) return c.json({ error: "Este espaço não está disponível para sua conta." }, 404);
  const task = await c.env.DB.prepare(
    "SELECT id, is_shared, created_by, assigned_user_id FROM tasks WHERE id = ? AND workspace_id = ? LIMIT 1",
  )
    .bind(taskId, workspaceId)
    .first<{ id: string; is_shared: number; created_by: string; assigned_user_id: string | null }>();
  if (!task) return c.json({ error: "Tarefa não encontrada." }, 404);
  const privateOwner = task.created_by === user.id || task.assigned_user_id === user.id;
  if (!task.is_shared && !privateOwner) return c.json({ error: "Este item pessoal não está disponível para sua conta." }, 404);

  const body = await readJson(c);
  const title = fieldText(body.title, 140);
  if (!title) return c.json({ error: "O título é obrigatório." }, 400);
  const status = body.status === "done" || body.status === "in_progress" ? body.status : "open";
  const kind = body.kind === "appointment" ? "appointment" : "task";
  const clientId = fieldText(body.clientId, 80) || null;
  if (clientId) {
    const client = await c.env.DB.prepare("SELECT id FROM clients WHERE id = ? AND workspace_id = ? LIMIT 1")
      .bind(clientId, workspaceId).first<{ id: string }>();
    if (!client) return c.json({ error: "O cliente escolhido não pertence a este espaço." }, 400);
  }
  const isShared = body.isShared !== false;
  await c.env.DB.prepare(
    `UPDATE tasks SET client_id = ?, title = ?, details = ?, kind = ?, status = ?, due_at = ?, start_at = ?, end_at = ?, is_shared = ?, updated_at = ?
     WHERE id = ? AND workspace_id = ?`,
  )
    .bind(
      clientId, title, fieldText(body.details, 2000), kind, status, dateValue(body.dueAt),
      dateValue(body.startAt), dateValue(body.endAt), isShared ? 1 : 0, Date.now(), taskId, workspaceId,
    )
    .run();
  return c.json({ ok: true });
});

routes.delete("/:taskId", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const taskId = c.req.param("taskId") ?? "";
  const user = currentUser(c);
  const access = await memberOr404(c, workspaceId);
  if (!access) return c.json({ error: "Este espaço não está disponível para sua conta." }, 404);
  const task = await c.env.DB.prepare(
    "SELECT id, is_shared, created_by, assigned_user_id FROM tasks WHERE id = ? AND workspace_id = ? LIMIT 1",
  )
    .bind(taskId, workspaceId)
    .first<{ id: string; is_shared: number; created_by: string; assigned_user_id: string | null }>();
  if (!task) return c.json({ error: "Tarefa não encontrada." }, 404);
  const canDelete = task.created_by === user.id || access.role === "owner" || access.role === "admin";
  if (!task.is_shared && task.created_by !== user.id && task.assigned_user_id !== user.id) {
    return c.json({ error: "Este item pessoal não está disponível para sua conta." }, 404);
  }
  if (!canDelete) return c.json({ error: "Você só pode remover itens criados por você." }, 403);
  await c.env.DB.prepare("DELETE FROM tasks WHERE id = ? AND workspace_id = ?").bind(taskId, workspaceId).run();
  return c.json({ ok: true });
});

export default routes;
