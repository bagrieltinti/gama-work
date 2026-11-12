import { Hono } from "hono";
import { createAuth } from "./auth";
import { isFullName, normalizeFullName } from "../lib/validation";
import { isPlatformAdminEmail } from "./lib";
import type { AppEnv } from "./types";
import workspaceRoutes from "./routes/workspaces";
import inviteRoutes from "./routes/invites";
import clientRoutes from "./routes/clients";
import taskRoutes from "./routes/tasks";
import templateRoutes from "./routes/templates";
import platformAdminRoutes from "./routes/platform-admin";
import fileRoutes from "./routes/files";
import { driveOAuthRoutes, workspaceDriveRoutes } from "./routes/drive";

const app = new Hono<AppEnv>();

app.use("/api/*", async (c, next) => {
  const path = c.req.path;
  const publicInvitePreview = c.req.method === "GET" && /^\/api\/invites\/[a-f0-9]{64}$/i.test(path);
  if (path.startsWith("/api/auth/") || path === "/api/config" || publicInvitePreview) {
    await next();
    return;
  }

  const auth = createAuth(c.env, c.req.raw);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: "Entre na sua conta para continuar." }, 401);
  }
  c.set("user", {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });
  const accountStatus = await c.env.DB.prepare("SELECT status FROM platform_user_status WHERE user_id = ? LIMIT 1")
    .bind(session.user.id).first<{ status: string }>();
  if (accountStatus?.status === "suspended") {
    return c.json({ error: "O acesso desta conta à plataforma está suspenso." }, 403);
  }
  await next();
});

app.get("/api/config", (c) =>
  c.json({ googleEnabled: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET) }),
);

app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  if (c.req.method === "POST" && c.req.path === "/api/auth/sign-up/email") {
    try {
      const body = await c.req.raw.clone().json() as { password?: unknown; name?: unknown };
      const name = normalizeFullName(body.name);
      if (!isFullName(name)) return c.json({ message: "Informe seu nome e sobrenome para criar a conta." }, 400);
      const password = typeof body.password === "string" ? body.password : "";
      const strong = password.length >= 12
        && /[a-z]/.test(password)
        && /[A-Z]/.test(password)
        && /\d/.test(password)
        && /[^A-Za-z0-9]/.test(password);
      if (!strong) return c.json({ message: "Use pelo menos 12 caracteres, com letras maiúsculas e minúsculas, número e símbolo." }, 400);
    } catch {
      return c.json({ message: "Não foi possível validar a senha informada." }, 400);
    }
  }
  return createAuth(c.env, c.req.raw).handler(c.req.raw);
});
app.route("/api/workspaces", workspaceRoutes);
app.route("/api/invites", inviteRoutes);
app.route("/api/workspaces/:workspaceId/clients", clientRoutes);
app.route("/api/workspaces/:workspaceId/tasks", taskRoutes);
app.route("/api/workspaces/:workspaceId/templates", templateRoutes);
app.route("/api/workspaces/:workspaceId/files", fileRoutes);
app.route("/api/workspaces/:workspaceId/drive", workspaceDriveRoutes);
app.route("/api/drive", driveOAuthRoutes);
app.route("/api/platform-admin", platformAdminRoutes);

app.get("/api/me", async (c) => {
  const user = c.get("user");
  return c.json({ user, isPlatformAdmin: isPlatformAdminEmail(c.env, user.email) });
});

app.notFound((c) => c.json({ error: "Rota não encontrada." }, 404));
app.onError((error, c) => {
  console.error(JSON.stringify({ message: "request failed", path: c.req.path, error: error.message }));
  return c.json({ error: "Não foi possível concluir essa ação agora." }, 500);
});

export default app;
