import { Hono } from "hono";
import type { AppEnv } from "../types";
import { currentUser, hashText, readJson } from "../lib";

const routes = new Hono<AppEnv>();

routes.get("/received", async (c) => {
  const user = currentUser(c);
  const result = await c.env.DB.prepare(
    `SELECT i.id, i.workspace_id, i.email, i.role, i.expires_at, i.created_at,
            w.name AS workspace_name, w.icon AS workspace_icon, w.accent_color AS workspace_accent_color,
            inviter.name AS invited_by_name
     FROM workspace_invites i
     INNER JOIN workspaces w ON w.id = i.workspace_id
     INNER JOIN user inviter ON inviter.id = i.invited_by
     WHERE lower(i.email) = ? AND i.accepted_at IS NULL AND i.expires_at > ?
     ORDER BY i.created_at DESC`,
  )
    .bind(user.email.toLowerCase(), Date.now())
    .all();
  return c.json({ invitations: result.results });
});

routes.post("/received/:inviteId/respond", async (c) => {
  const user = currentUser(c);
  const inviteId = c.req.param("inviteId") ?? "";
  const body = await readJson(c);
  const action = body.action === "accept" || body.action === "decline" ? body.action : null;
  if (!action) return c.json({ error: "Escolha aceitar ou recusar o convite." }, 400);

  const invite = await c.env.DB.prepare(
    `SELECT id, workspace_id FROM workspace_invites
     WHERE id = ? AND lower(email) = ? AND accepted_at IS NULL AND expires_at > ? LIMIT 1`,
  )
    .bind(inviteId, user.email.toLowerCase(), Date.now())
    .first<{ id: string; workspace_id: string }>();
  if (!invite) return c.json({ error: "Este convite expirou, já foi respondido ou não pertence à sua conta." }, 404);

  if (action === "decline") {
    const deleted = await c.env.DB.prepare(
      `DELETE FROM workspace_invites
       WHERE id = ? AND lower(email) = ? AND accepted_at IS NULL AND expires_at > ?`,
    )
      .bind(inviteId, user.email.toLowerCase(), Date.now())
      .run();
    if (!deleted.meta.changes) return c.json({ error: "Este convite já foi respondido." }, 409);
    return c.json({ ok: true, action: "declined" });
  }

  const now = Date.now();
  const updated = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE workspace_invites SET accepted_at = ?
       WHERE id = ? AND lower(email) = ? AND accepted_at IS NULL AND expires_at > ?`,
    ).bind(now, inviteId, user.email.toLowerCase(), now),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, joined_at)
       SELECT workspace_id, ?, role, ? FROM workspace_invites
       WHERE id = ? AND accepted_at = ?`,
    ).bind(user.id, now, inviteId, now),
  ]);
  if (!updated[0]?.meta?.changes) return c.json({ error: "Este convite já foi respondido." }, 409);
  return c.json({ ok: true, action: "accepted", workspaceId: invite.workspace_id });
});

routes.get("/:token", async (c) => {
  const token = c.req.param("token") ?? "";
  if (!/^[a-f0-9]{64}$/i.test(token)) return c.json({ error: "Este convite não é válido." }, 404);
  const invite = await c.env.DB.prepare(
    `SELECT i.email, i.role, i.expires_at, w.id AS workspace_id, w.name AS workspace_name,
            w.icon, w.accent_color
     FROM workspace_invites i INNER JOIN workspaces w ON w.id = i.workspace_id
     WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.expires_at > ? LIMIT 1`,
  )
    .bind(await hashText(token), Date.now())
    .first();
  if (!invite) return c.json({ error: "Este convite expirou ou já foi usado." }, 404);
  return c.json({ invitation: invite });
});

routes.post("/:token/accept", async (c) => {
  const user = currentUser(c);
  const token = c.req.param("token") ?? "";
  if (!/^[a-f0-9]{64}$/i.test(token)) return c.json({ error: "Este convite não é válido." }, 404);
  const invite = await c.env.DB.prepare(
    `SELECT id, workspace_id, email, role, expires_at, accepted_at
     FROM workspace_invites WHERE token_hash = ? LIMIT 1`,
  )
    .bind(await hashText(token))
    .first<{
      id: string;
      workspace_id: string;
      email: string;
      role: "admin" | "collaborator";
      expires_at: number;
      accepted_at: number | null;
    }>();
  if (!invite || invite.accepted_at || invite.expires_at <= Date.now()) {
    return c.json({ error: "Este convite expirou ou já foi usado." }, 404);
  }
  if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
    return c.json({ error: "Entre com o e-mail para o qual o convite foi enviado." }, 403);
  }

  const existingMember = await c.env.DB.prepare(
    "SELECT 1 AS yes FROM workspace_members WHERE workspace_id = ? AND user_id = ? LIMIT 1",
  )
    .bind(invite.workspace_id, user.id)
    .first<{ yes: number }>();
  if (!existingMember) {
    await c.env.DB.prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)`,
    )
      .bind(invite.workspace_id, user.id, invite.role, Date.now())
      .run();
  }
  await c.env.DB.prepare(
    "UPDATE workspace_invites SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL",
  )
    .bind(Date.now(), invite.id)
    .run();

  return c.json({ ok: true, workspaceId: invite.workspace_id });
});

export default routes;
