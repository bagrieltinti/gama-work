import { Hono } from "hono";
import { createAuth } from "./auth";
import type { AppEnv } from "./types";
import workspaceRoutes from "./routes/workspaces";
import inviteRoutes from "./routes/invites";
import clientRoutes from "./routes/clients";
import taskRoutes from "./routes/tasks";
import templateRoutes from "./routes/templates";

const app = new Hono<AppEnv>();

app.use("/api/*", async (c, next) => {
  const path = c.req.path;
  const publicInvitePreview = c.req.method === "GET" && /^\/api\/invites\/[^/]+$/.test(path);
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
  await next();
});

app.get("/api/config", (c) =>
  c.json({ googleEnabled: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET) }),
);

app.on(["GET", "POST"], "/api/auth/*", (c) => createAuth(c.env, c.req.raw).handler(c.req.raw));
app.route("/api/workspaces", workspaceRoutes);
app.route("/api/invites", inviteRoutes);
app.route("/api/workspaces/:workspaceId/clients", clientRoutes);
app.route("/api/workspaces/:workspaceId/tasks", taskRoutes);
app.route("/api/workspaces/:workspaceId/templates", templateRoutes);

app.get("/api/me", (c) => c.json({ user: c.get("user") }));

app.notFound((c) => c.json({ error: "Rota não encontrada." }, 404));
app.onError((error, c) => {
  console.error(JSON.stringify({ message: "request failed", path: c.req.path, error: error.message }));
  return c.json({ error: "Não foi possível concluir essa ação agora." }, 500);
});

export default app;
