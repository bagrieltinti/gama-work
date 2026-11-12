import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { authSchema } from "../database/schema";
import type { WorkerEnv } from "../../cloudflare.config";
import { isFullName, normalizeFullName } from "../lib/validation";

export function createAuth(env: WorkerEnv, request: Request) {
  const origin = new URL(request.url).origin;
  const googleClientId = env.GOOGLE_CLIENT_ID;
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET;
  const socialProviders = googleClientId && googleClientSecret
    ? {
        google: {
          clientId: googleClientId,
          clientSecret: googleClientSecret,
          prompt: "select_account" as const,
        },
      }
    : {};

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
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    socialProviders,
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const name = normalizeFullName(user.name);
            if (!isFullName(name)) {
              throw new APIError("BAD_REQUEST", {
                message: "Informe seu nome e sobrenome para criar a conta.",
              });
            }
            const email = user.email.trim().toLowerCase();
            return { data: { ...user, email, name } };
          },
        },
      },
    },
  });
}
