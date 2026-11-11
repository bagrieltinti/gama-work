import { Hono } from "hono";
import type { AppEnv } from "../types";
import { canManage, currentUser, csvEscape, fieldEmail, fieldText, getWorkspaceAccess, readJson } from "../lib";

const routes = new Hono<AppEnv>();
const statuses = new Set(["active", "paused", "discontinued"]);
const now = () => Date.now();

function dateValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function accessFor(c: import("hono").Context<AppEnv>, workspaceId: string) {
  const access = await getWorkspaceAccess(c, workspaceId);
  if (!access) return { error: c.json({ error: "Este espaço não está disponível para sua conta." }, 404) };
  return { access };
}

routes.get("/export.json", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const { access, error } = await accessFor(c, workspaceId);
  if (error) return error;
  if (!canManage(access)) return c.json({ error: "Somente a proprietária ou uma administradora pode exportar os dados." }, 403);

  const [workspace, clients, interactions, tasks, templates, journeys] = await Promise.all([
    c.env.DB.prepare("SELECT id, name, description, icon, accent_color, created_at, updated_at FROM workspaces WHERE id = ?").bind(workspaceId).first(),
    c.env.DB.prepare("SELECT * FROM clients WHERE workspace_id = ? ORDER BY created_at").bind(workspaceId).all(),
    c.env.DB.prepare("SELECT * FROM interactions WHERE workspace_id = ? ORDER BY happened_at").bind(workspaceId).all(),
    c.env.DB.prepare("SELECT * FROM tasks WHERE workspace_id = ? ORDER BY created_at").bind(workspaceId).all(),
    c.env.DB.prepare("SELECT * FROM journey_templates WHERE workspace_id = ? ORDER BY created_at").bind(workspaceId).all(),
    c.env.DB.prepare("SELECT * FROM client_journeys WHERE workspace_id = ? ORDER BY created_at").bind(workspaceId).all(),
  ]);
  const exportedAt = now();
  return c.json({
    schemaVersion: 1,
    exportedAt,
    workspace,
    clients: clients.results,
    interactions: interactions.results,
    tasks: tasks.results,
    journeyTemplates: templates.results,
    clientJourneys: journeys.results,
  });
});

routes.get("/export.csv", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const { access, error } = await accessFor(c, workspaceId);
  if (error) return error;
  if (!canManage(access)) return c.json({ error: "Somente a proprietária ou uma administradora pode exportar os dados." }, 403);
  const rows = await c.env.DB.prepare(
    `SELECT name, email, phone, product, status, is_fidelized, next_followup_at, notes, created_at, updated_at
     FROM clients WHERE workspace_id = ? ORDER BY name COLLATE NOCASE`,
  )
    .bind(workspaceId)
    .all<Record<string, unknown>>();
  const headers = ["name", "email", "phone", "product", "status", "is_fidelized", "next_followup_at", "notes", "created_at", "updated_at"];
  const csv = [headers.map(csvEscape).join(","), ...rows.results.map((row: Record<string, unknown>) => headers.map((key) => csvEscape(row[key])).join(","))].join("\r\n");
  return new Response(`\ufeff${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gama-work-${workspaceId}-clientes.csv"`,
    },
  });
});

routes.get("/", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const { error } = await accessFor(c, workspaceId);
  if (error) return error;
  const rows = await c.env.DB.prepare(
    `SELECT cl.id, cl.name, cl.email, cl.phone, cl.product, cl.status, cl.is_fidelized,
            cl.responsible_user_id, cl.next_followup_at, cl.notes, cl.created_at, cl.updated_at,
            u.name AS responsible_name,
            (SELECT MAX(i.happened_at) FROM interactions i WHERE i.workspace_id = cl.workspace_id AND i.client_id = cl.id) AS last_interaction_at
     FROM clients cl LEFT JOIN user u ON u.id = cl.responsible_user_id
     WHERE cl.workspace_id = ? ORDER BY COALESCE(cl.next_followup_at, 0), cl.name COLLATE NOCASE LIMIT 500`,
  )
    .bind(workspaceId)
    .all();
  return c.json({ clients: rows.results });
});

routes.post("/import", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const user = currentUser(c);
  const { access, error } = await accessFor(c, workspaceId);
  if (error) return error;
  if (!canManage(access)) return c.json({ error: "Somente a proprietária ou uma administradora pode importar dados." }, 403);

  const body = await readJson(c);
  const records = Array.isArray(body.records) ? body.records.slice(0, 500) : [];
  if (!records.length) return c.json({ error: "Não há clientes válidos para importar." }, 400);
  const time = now();
  const statements = records.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const name = fieldText(row.name, 120);
    if (!name) return [];
    const email = fieldEmail(row.email) || null;
    const phone = fieldText(row.phone, 80) || null;
    const product = fieldText(row.product, 100);
    const status = statuses.has(String(row.status)) ? String(row.status) : "active";
    const isFidelized = row.isFidelized === true || row.isFidelized === 1 ? 1 : 0;
    return [c.env.DB.prepare(
      `INSERT OR IGNORE INTO clients
       (id, workspace_id, name, email, phone, product, status, is_fidelized, responsible_user_id, next_followup_at, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), workspaceId, name, email, phone, product, status, isFidelized,
      user.id, null, fieldText(row.notes, 2000), time, time,
    )];
  });
  if (!statements.length) return c.json({ error: "Os registros não têm nomes de cliente válidos." }, 400);
  await c.env.DB.batch(statements);
  return c.json({ imported: statements.length, maxRecords: 500 });
});

routes.post("/", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const user = currentUser(c);
  const { error } = await accessFor(c, workspaceId);
  if (error) return error;
  const body = await readJson(c);
  const name = fieldText(body.name, 120);
  if (!name) return c.json({ error: "Informe o nome do cliente." }, 400);
  const email = fieldEmail(body.email) || null;
  const status = statuses.has(String(body.status)) ? String(body.status) : "active";
  const id = crypto.randomUUID();
  const time = now();
  try {
    await c.env.DB.prepare(
      `INSERT INTO clients
       (id, workspace_id, name, email, phone, product, status, is_fidelized, responsible_user_id, next_followup_at, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id, workspaceId, name, email, fieldText(body.phone, 80) || null,
        fieldText(body.product, 100), status, body.isFidelized === true ? 1 : 0,
        fieldText(body.responsibleUserId, 80) || user.id,
        dateValue(body.nextFollowupAt), fieldText(body.notes, 2000), time, time,
      )
      .run();
  } catch (error) {
    if (email) return c.json({ error: "Já existe um cliente com esse e-mail neste espaço." }, 409);
    throw error;
  }
  return c.json({ client: { id, name, email, status, product: fieldText(body.product, 100) } }, 201);
});

routes.get("/:clientId", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const clientId = c.req.param("clientId") ?? "";
  const { error } = await accessFor(c, workspaceId);
  if (error) return error;
  const client = await c.env.DB.prepare(
    `SELECT cl.*, u.name AS responsible_name FROM clients cl
     LEFT JOIN user u ON u.id = cl.responsible_user_id
     WHERE cl.id = ? AND cl.workspace_id = ? LIMIT 1`,
  )
    .bind(clientId, workspaceId)
    .first();
  if (!client) return c.json({ error: "Cliente não encontrado." }, 404);
  const [interactions, journeys] = await Promise.all([
    c.env.DB.prepare(
      `SELECT i.id, i.channel, i.summary, i.next_action, i.happened_at, i.actor_user_id, u.name AS actor_name
       FROM interactions i INNER JOIN user u ON u.id = i.actor_user_id
       WHERE i.workspace_id = ? AND i.client_id = ? ORDER BY i.happened_at DESC LIMIT 100`,
    ).bind(workspaceId, clientId).all(),
    c.env.DB.prepare(
      `SELECT id, template_id, template_name, stages_json, status, created_at, updated_at
       FROM client_journeys WHERE workspace_id = ? AND client_id = ? ORDER BY created_at DESC`,
    ).bind(workspaceId, clientId).all(),
  ]);
  return c.json({ client, interactions: interactions.results, journeys: journeys.results });
});

routes.patch("/:clientId", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const clientId = c.req.param("clientId") ?? "";
  const { error } = await accessFor(c, workspaceId);
  if (error) return error;
  const body = await readJson(c);
  const existing = await c.env.DB.prepare("SELECT id FROM clients WHERE id = ? AND workspace_id = ? LIMIT 1")
    .bind(clientId, workspaceId).first<{ id: string }>();
  if (!existing) return c.json({ error: "Cliente não encontrado." }, 404);
  const name = fieldText(body.name, 120);
  if (!name) return c.json({ error: "Informe o nome do cliente." }, 400);
  const email = fieldEmail(body.email) || null;
  const status = statuses.has(String(body.status)) ? String(body.status) : "active";
  try {
    await c.env.DB.prepare(
      `UPDATE clients SET name = ?, email = ?, phone = ?, product = ?, status = ?, is_fidelized = ?,
       responsible_user_id = ?, next_followup_at = ?, notes = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    )
      .bind(
        name, email, fieldText(body.phone, 80) || null, fieldText(body.product, 100), status,
        body.isFidelized === true || body.isFidelized === 1 ? 1 : 0,
        fieldText(body.responsibleUserId, 80) || null, dateValue(body.nextFollowupAt),
        fieldText(body.notes, 2000), now(), clientId, workspaceId,
      )
      .run();
  } catch (error) {
    if (email) return c.json({ error: "Já existe um cliente com esse e-mail neste espaço." }, 409);
    throw error;
  }
  return c.json({ ok: true });
});

routes.post("/:clientId/interactions", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const clientId = c.req.param("clientId") ?? "";
  const user = currentUser(c);
  const { error } = await accessFor(c, workspaceId);
  if (error) return error;
  const client = await c.env.DB.prepare("SELECT id FROM clients WHERE id = ? AND workspace_id = ? LIMIT 1")
    .bind(clientId, workspaceId).first<{ id: string }>();
  if (!client) return c.json({ error: "Cliente não encontrado." }, 404);
  const body = await readJson(c);
  const summary = fieldText(body.summary, 2000);
  if (!summary) return c.json({ error: "Escreva um resumo do atendimento." }, 400);
  const id = crypto.randomUUID();
  const happenedAt = dateValue(body.happenedAt) ?? now();
  await c.env.DB.prepare(
    `INSERT INTO interactions (id, workspace_id, client_id, actor_user_id, channel, summary, next_action, happened_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, workspaceId, clientId, user.id, fieldText(body.channel, 40) || "other", summary,
      fieldText(body.nextAction, 500), happenedAt, now())
    .run();
  if (body.nextFollowupAt) {
    await c.env.DB.prepare("UPDATE clients SET next_followup_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
      .bind(dateValue(body.nextFollowupAt), now(), clientId, workspaceId).run();
  }
  return c.json({ interaction: { id, summary, channel: fieldText(body.channel, 40), happened_at: happenedAt } }, 201);
});

routes.post("/:clientId/journeys", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const clientId = c.req.param("clientId") ?? "";
  const user = currentUser(c);
  const { error } = await accessFor(c, workspaceId);
  if (error) return error;
  const body = await readJson(c);
  const templateId = fieldText(body.templateId, 80);
  const [client, template] = await Promise.all([
    c.env.DB.prepare("SELECT id FROM clients WHERE id = ? AND workspace_id = ? LIMIT 1").bind(clientId, workspaceId).first(),
    c.env.DB.prepare("SELECT id, name, stages_json FROM journey_templates WHERE id = ? AND workspace_id = ? AND is_active = 1 LIMIT 1").bind(templateId, workspaceId).first<{ id: string; name: string; stages_json: string }>(),
  ]);
  if (!client) return c.json({ error: "Cliente não encontrado." }, 404);
  if (!template) return c.json({ error: "Modelo não encontrado." }, 404);
  const id = crypto.randomUUID();
  const time = now();
  await c.env.DB.prepare(
    `INSERT INTO client_journeys (id, workspace_id, client_id, template_id, template_name, stages_json, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
  )
    .bind(id, workspaceId, clientId, template.id, template.name, template.stages_json, user.id, time, time)
    .run();
  return c.json({ journey: { id, templateId, templateName: template.name, stages: JSON.parse(template.stages_json), status: "active" } }, 201);
});

routes.patch("/:clientId/journeys/:journeyId", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const clientId = c.req.param("clientId") ?? "";
  const journeyId = c.req.param("journeyId") ?? "";
  const { error } = await accessFor(c, workspaceId);
  if (error) return error;
  const body = await readJson(c);
  const stages = Array.isArray(body.stages) ? body.stages.slice(0, 30) : null;
  const status = body.status === "completed" || body.status === "paused" ? body.status : "active";
  if (!stages || stages.some((stage) => typeof stage !== "string" && (!stage || typeof stage !== "object"))) {
    return c.json({ error: "Etapas inválidas." }, 400);
  }
  await c.env.DB.prepare(
    `UPDATE client_journeys SET stages_json = ?, status = ?, updated_at = ?
     WHERE id = ? AND client_id = ? AND workspace_id = ?`,
  )
    .bind(JSON.stringify(stages), status, now(), journeyId, clientId, workspaceId)
    .run();
  return c.json({ ok: true });
});

export default routes;
