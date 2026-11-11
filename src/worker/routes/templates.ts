import { Hono } from "hono";
import type { AppEnv } from "../types";
import { canManage, currentUser, fieldText, getWorkspaceAccess, readJson } from "../lib";

const routes = new Hono<AppEnv>();

function stagesFrom(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const stages = value.slice(0, 30).map((item) => fieldText(item, 120)).filter(Boolean);
  return stages.length ? stages : null;
}

routes.get("/", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const access = await getWorkspaceAccess(c, workspaceId);
  if (!access) return c.json({ error: "Este espaço não está disponível para sua conta." }, 404);
  const rows = await c.env.DB.prepare(
    `SELECT id, name, category, description, stages_json, is_active, created_by, created_at, updated_at
     FROM journey_templates WHERE workspace_id = ? ORDER BY is_active DESC, name COLLATE NOCASE`,
  )
    .bind(workspaceId)
    .all();
  return c.json({ templates: rows.results });
});

routes.post("/", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const user = currentUser(c);
  const access = await getWorkspaceAccess(c, workspaceId);
  if (!access) return c.json({ error: "Este espaço não está disponível para sua conta." }, 404);
  if (!canManage(access)) return c.json({ error: "Somente a proprietária ou uma administradora pode gerenciar modelos." }, 403);
  const body = await readJson(c);
  const name = fieldText(body.name, 100);
  const stages = stagesFrom(body.stages);
  if (!name || !stages) return c.json({ error: "Informe um nome e ao menos uma etapa." }, 400);
  const id = crypto.randomUUID();
  const time = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO journey_templates (id, workspace_id, name, category, description, stages_json, is_active, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  )
    .bind(id, workspaceId, name, fieldText(body.category, 60) || "Geral", fieldText(body.description, 500), JSON.stringify(stages), user.id, time, time)
    .run();
  return c.json({ template: { id, name, category: fieldText(body.category, 60) || "Geral", description: fieldText(body.description, 500), stages } }, 201);
});

routes.patch("/:templateId", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const templateId = c.req.param("templateId") ?? "";
  const access = await getWorkspaceAccess(c, workspaceId);
  if (!access) return c.json({ error: "Este espaço não está disponível para sua conta." }, 404);
  if (!canManage(access)) return c.json({ error: "Somente a proprietária ou uma administradora pode gerenciar modelos." }, 403);
  const body = await readJson(c);
  const name = fieldText(body.name, 100);
  const stages = stagesFrom(body.stages);
  if (!name || !stages) return c.json({ error: "Informe um nome e ao menos uma etapa." }, 400);
  const active = body.isActive === false ? 0 : 1;
  const result = await c.env.DB.prepare(
    `UPDATE journey_templates SET name = ?, category = ?, description = ?, stages_json = ?, is_active = ?, updated_at = ?
     WHERE id = ? AND workspace_id = ?`,
  )
    .bind(name, fieldText(body.category, 60) || "Geral", fieldText(body.description, 500), JSON.stringify(stages), active, Date.now(), templateId, workspaceId)
    .run();
  if (!result.meta.changes) return c.json({ error: "Modelo não encontrado." }, 404);
  return c.json({ ok: true });
});

routes.delete("/:templateId", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const templateId = c.req.param("templateId") ?? "";
  const access = await getWorkspaceAccess(c, workspaceId);
  if (!access) return c.json({ error: "Este espaço não está disponível para sua conta." }, 404);
  if (!canManage(access)) return c.json({ error: "Somente a proprietária ou uma administradora pode gerenciar modelos." }, 403);
  await c.env.DB.prepare("UPDATE journey_templates SET is_active = 0, updated_at = ? WHERE id = ? AND workspace_id = ?")
    .bind(Date.now(), templateId, workspaceId).run();
  return c.json({ ok: true });
});

export default routes;
