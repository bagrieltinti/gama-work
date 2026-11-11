import { Hono } from "hono";
import type { AppEnv } from "../types";
import { currentUser, hashText } from "../lib";

const routes = new Hono<AppEnv>();

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
