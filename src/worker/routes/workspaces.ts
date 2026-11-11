import { Hono } from "hono";
import type { AppEnv, WorkspaceRole } from "../types";
import { currentUser, fieldColor, fieldEmail, fieldRole, fieldText, getWorkspaceAccess, isOwner, readJson, randomToken, hashText } from "../lib";

const routes = new Hono<AppEnv>();

const starterTemplates = [
  {
    name: "Mentoria — jornada inicial",
    category: "Mentoria",
    description: "Modelo de partida editável. Ajuste as etapas ao processo real antes de aplicar.",
    stages: ["Boas-vindas", "Diagnóstico", "Plano de ação", "Acompanhamento", "Encerramento"],
  },
  {
    name: "Raio X — análise inicial",
    category: "Raio X",
    description: "Modelo de partida editável. Ajuste as etapas ao processo real antes de aplicar.",
    stages: ["Entrada", "Coleta de informações", "Análise", "Devolutiva", "Próximos passos"],
  },
  {
    name: "Processo personalizável",
    category: "Geral",
    description: "Estrutura genérica para adaptar a outros produtos, equipes e situações.",
    stages: ["Solicitação", "Execução", "Revisão", "Entrega"],
  },
];

routes.get("/", async (c) => {
  const user = currentUser(c);
  const result = await c.env.DB.prepare(
    `SELECT w.id, w.name, w.description, w.icon, w.accent_color, w.updated_at,
            m.role,
            (SELECT COUNT(*) FROM clients cl WHERE cl.workspace_id = w.id) AS client_count
     FROM workspaces w
     INNER JOIN workspace_members m ON m.workspace_id = w.id
     WHERE m.user_id = ?
     ORDER BY w.name COLLATE NOCASE`,
  )
    .bind(user.id)
    .all();
  return c.json({ workspaces: result.results });
});

routes.post("/", async (c) => {
  const user = currentUser(c);
  const body = await readJson(c);
  const name = fieldText(body.name, 80);
  if (!name) return c.json({ error: "Dê um nome ao espaço." }, 400);

  const existingOwner = await c.env.DB.prepare(
    "SELECT 1 AS yes FROM workspace_members WHERE user_id = ? AND role = 'owner' LIMIT 1",
  )
    .bind(user.id)
    .first<{ yes: number }>();
  const isInitialOwner = user.email.toLowerCase() === c.env.INITIAL_OWNER_EMAIL.toLowerCase();
  if (!existingOwner && !isInitialOwner) {
    return c.json({ error: "A criação de espaços está disponível para proprietárias de um espaço." }, 403);
  }
  const workspaceBefore = await c.env.DB.prepare("SELECT 1 AS yes FROM workspaces LIMIT 1").first<{ yes: number }>();
  const isFirstWorkspace = !workspaceBefore && isInitialOwner;

  const id = crypto.randomUUID();
  const now = Date.now();
  const description = fieldText(body.description, 280);
  const icon = fieldText(body.icon, 32) || "briefcase";
  const color = fieldColor(body.accentColor);
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO workspaces (id, name, description, icon, accent_color, owner_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, name, description, icon, color, user.id, now, now),
    c.env.DB.prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)`,
    ).bind(id, user.id, now),
    ...starterTemplates.map((template) =>
      c.env.DB.prepare(
        `INSERT INTO journey_templates
         (id, workspace_id, name, category, description, stages_json, is_active, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), id, template.name, template.category, template.description, JSON.stringify(template.stages), user.id, now, now),
    ),
  ];
  await c.env.DB.batch(statements);

  const bootstrapAdminInvites: Array<{ email: string; url: string }> = [];
  if (isFirstWorkspace) {
    const adminEmails = [...new Set((c.env.INITIAL_ADMIN_EMAILS || "").split(/[\n,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
    for (const email of adminEmails) {
      if (email === user.email.toLowerCase()) continue;
      const existingUser = await c.env.DB.prepare("SELECT id FROM user WHERE lower(email) = ? LIMIT 1")
        .bind(email)
        .first<{ id: string }>();
      if (existingUser) {
        await c.env.DB.prepare(
          `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
           SELECT ?, ?, 'admin', ? WHERE NOT EXISTS
           (SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?)`,
        ).bind(id, existingUser.id, Date.now(), id, existingUser.id).run();
        continue;
      }

      const existingInvite = await c.env.DB.prepare(
        "SELECT 1 AS yes FROM workspace_invites WHERE workspace_id = ? AND lower(email) = ? AND accepted_at IS NULL AND expires_at > ? LIMIT 1",
      ).bind(id, email, Date.now()).first<{ yes: number }>();
      if (existingInvite) continue;

      const token = randomToken();
      const nowInvite = Date.now();
      await c.env.DB.prepare(
        `INSERT INTO workspace_invites (id, workspace_id, email, role, token_hash, invited_by, expires_at, created_at)
         VALUES (?, ?, ?, 'admin', ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), id, email, await hashText(token), user.id, nowInvite + 7 * 24 * 60 * 60 * 1000, nowInvite).run();
      bootstrapAdminInvites.push({ email, url: new URL(`/join/${token}`, c.req.url).toString() });
    }
  }

  return c.json({
    workspace: { id, name, description, icon, accent_color: color, role: "owner" },
    bootstrapAdminInvites,
  }, 201);
});

routes.get("/:workspaceId", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const access = await getWorkspaceAccess(c, workspaceId);
  if (!access) return c.json({ error: "Este espaço não está disponível para sua conta." }, 404);
  const workspace = await c.env.DB.prepare(
    `SELECT id, name, description, icon, accent_color, owner_user_id, created_at, updated_at
     FROM workspaces WHERE id = ? LIMIT 1`,
  )
    .bind(workspaceId)
    .first();
  return c.json({ workspace: { ...workspace, role: access.role } });
});

routes.patch("/:workspaceId", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const access = await getWorkspaceAccess(c, workspaceId);
  if (!access) return c.json({ error: "Este espaço não está disponível para sua conta." }, 404);
  if (!isOwner(access)) return c.json({ error: "Somente a proprietária pode personalizar o espaço." }, 403);

  const body = await readJson(c);
  const name = fieldText(body.name, 80);
  if (!name) return c.json({ error: "O nome do espaço é obrigatório." }, 400);
  const description = fieldText(body.description, 280);
  const icon = fieldText(body.icon, 32) || "briefcase";
  const accentColor = fieldColor(body.accentColor);
  await c.env.DB.prepare(
    `UPDATE workspaces SET name = ?, description = ?, icon = ?, accent_color = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(name, description, icon, accentColor, Date.now(), workspaceId)
    .run();
  return c.json({ workspace: { id: workspaceId, name, description, icon, accent_color: accentColor } });
});

routes.get("/:workspaceId/members", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const access = await getWorkspaceAccess(c, workspaceId);
  if (!access) return c.json({ error: "Este espaço não está disponível para sua conta." }, 404);
  const rows = await c.env.DB.prepare(
    `SELECT m.user_id, m.role, m.joined_at, u.name, u.email, u.image
     FROM workspace_members m INNER JOIN user u ON u.id = m.user_id
     WHERE m.workspace_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name COLLATE NOCASE`,
  )
    .bind(workspaceId)
    .all();
  return c.json({ members: rows.results });
});

routes.patch("/:workspaceId/members/:userId", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const targetId = c.req.param("userId") ?? "";
  const user = currentUser(c);
  const access = await getWorkspaceAccess(c, workspaceId);
  if (!access) return c.json({ error: "Este espaço não está disponível para sua conta." }, 404);
  if (!isOwner(access)) return c.json({ error: "Somente a proprietária pode alterar os papéis." }, 403);

  const body = await readJson(c);
  const nextRole = fieldRole(body.role);
  if (!nextRole) return c.json({ error: "Papel inválido." }, 400);
  if (targetId === user.id) return c.json({ error: "Escolha outra pessoa para alterar o papel." }, 400);

  const target = await c.env.DB.prepare(
    "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ? LIMIT 1",
  )
    .bind(workspaceId, targetId)
    .first<{ role: WorkspaceRole }>();
  if (!target) return c.json({ error: "Pessoa não encontrada neste espaço." }, 404);

  if (nextRole === "owner") {
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE workspace_members SET role = 'admin' WHERE workspace_id = ? AND user_id = ? AND role = 'owner'",
      ).bind(workspaceId, user.id),
      c.env.DB.prepare(
        "UPDATE workspace_members SET role = 'owner' WHERE workspace_id = ? AND user_id = ?",
      ).bind(workspaceId, targetId),
      c.env.DB.prepare(
        "UPDATE workspaces SET owner_user_id = ?, updated_at = ? WHERE id = ?",
      ).bind(targetId, now, workspaceId),
    ]);
    return c.json({ ok: true, transferred: true });
  }

  await c.env.DB.prepare(
    "UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?",
  )
    .bind(nextRole, workspaceId, targetId)
    .run();
  return c.json({ ok: true, role: nextRole });
});

routes.delete("/:workspaceId/members/:userId", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const targetId = c.req.param("userId") ?? "";
  const user = currentUser(c);
  const access = await getWorkspaceAccess(c, workspaceId);
  if (!access) return c.json({ error: "Este espaço não está disponível para sua conta." }, 404);
  if (!isOwner(access)) return c.json({ error: "Somente a proprietária pode remover pessoas." }, 403);
  if (targetId === user.id) return c.json({ error: "Transfira a propriedade antes de sair deste espaço." }, 400);

  await c.env.DB.prepare(
    "DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND role != 'owner'",
  )
    .bind(workspaceId, targetId)
    .run();
  return c.json({ ok: true });
});

routes.get("/:workspaceId/invites", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const access = await getWorkspaceAccess(c, workspaceId);
  if (!access) return c.json({ error: "Este espaço não está disponível para sua conta." }, 404);
  if (!isOwner(access)) return c.json({ error: "Somente a proprietária pode consultar os convites." }, 403);
  const result = await c.env.DB.prepare(
    `SELECT id, email, role, expires_at, accepted_at, created_at
     FROM workspace_invites WHERE workspace_id = ? AND accepted_at IS NULL AND expires_at > ?
     ORDER BY created_at DESC`,
  )
    .bind(workspaceId, Date.now())
    .all();
  return c.json({ invitations: result.results });
});

routes.post("/:workspaceId/invites", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const user = currentUser(c);
  const access = await getWorkspaceAccess(c, workspaceId);
  if (!access) return c.json({ error: "Este espaço não está disponível para sua conta." }, 404);
  if (!isOwner(access)) return c.json({ error: "Os convites são enviados pela proprietária do espaço." }, 403);

  const body = await readJson(c);
  const email = fieldEmail(body.email);
  const role = body.role === "admin" ? "admin" : body.role === "collaborator" ? "collaborator" : null;
  if (!email) return c.json({ error: "Informe um e-mail válido." }, 400);
  if (!role) return c.json({ error: "Escolha Administrador ou Colaborador." }, 400);

  const member = await c.env.DB.prepare(
    `SELECT 1 AS yes FROM workspace_members m INNER JOIN user u ON u.id = m.user_id
     WHERE m.workspace_id = ? AND lower(u.email) = ? LIMIT 1`,
  )
    .bind(workspaceId, email)
    .first<{ yes: number }>();
  if (member) return c.json({ error: "Essa pessoa já participa do espaço." }, 409);

  const pending = await c.env.DB.prepare(
    "SELECT id FROM workspace_invites WHERE workspace_id = ? AND lower(email) = ? AND accepted_at IS NULL AND expires_at > ? LIMIT 1",
  )
    .bind(workspaceId, email, Date.now())
    .first<{ id: string }>();
  if (pending) return c.json({ error: "Já existe um convite ativo para esse e-mail." }, 409);

  const token = randomToken();
  const inviteId = crypto.randomUUID();
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  await c.env.DB.prepare(
    `INSERT INTO workspace_invites (id, workspace_id, email, role, token_hash, invited_by, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(inviteId, workspaceId, email, role, await hashText(token), user.id, expiresAt, Date.now())
    .run();

  const url = new URL(`/join/${token}`, c.req.url).toString();
  return c.json({ invitation: { id: inviteId, email, role, expiresAt, url } }, 201);
});

routes.delete("/:workspaceId/invites/:inviteId", async (c) => {
  const workspaceId = c.req.param("workspaceId") ?? "";
  const inviteId = c.req.param("inviteId") ?? "";
  const access = await getWorkspaceAccess(c, workspaceId);
  if (!access) return c.json({ error: "Este espaço não está disponível para sua conta." }, 404);
  if (!isOwner(access)) return c.json({ error: "Somente a proprietária pode cancelar convites." }, 403);
  await c.env.DB.prepare(
    "DELETE FROM workspace_invites WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL",
  )
    .bind(inviteId, workspaceId)
    .run();
  return c.json({ ok: true });
});

export default routes;
