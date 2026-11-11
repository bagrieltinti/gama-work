import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { authSchema } from "../database/schema";
import type { WorkerEnv } from "../../cloudflare.config";

export function createAuth(env: WorkerEnv, request: Request) {
  const origin = new URL(request.url).origin;
  const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

  return betterAuth({
    appName: "Gama Work",
    baseURL: origin,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [origin],
    database: drizzleAdapter(drizzle(env.DB), {
      provider: "sqlite",
      schema: authSchema,
      camelCase: false,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
    },
    socialProviders: googleEnabled
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            prompt: "select_account",
          },
        }
      : {},
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const email = user.email.trim().toLowerCase();
            const initialOwner = env.INITIAL_OWNER_EMAIL.trim().toLowerCase();
            if (email === initialOwner) return { data: { ...user, email } };

            const invitation = await env.DB.prepare(
              `SELECT id FROM workspace_invites
               WHERE lower(email) = ? AND accepted_at IS NULL AND expires_at > ?
               LIMIT 1`,
            )
              .bind(email, Date.now())
              .first<{ id: string }>();

            if (!invitation) {
              throw new APIError("FORBIDDEN", {
                message: "Para criar uma conta, use o e-mail de um convite ativo do espaço.",
              });
            }

            return { data: { ...user, email } };
          },
        },
      },
    },
  });
}
