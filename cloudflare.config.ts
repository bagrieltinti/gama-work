import { bindings, defineConfig, type InferEnv, type UnwrapConfig } from "cf/config";

const worker = {
  name: "gama-work",
  compatibilityDate: "2026-11-11",
  compatibilityFlags: ["nodejs_compat"],
  entrypoint: "./src/worker/index.ts",
  env: {
    DB: bindings.d1({ name: "gama-work-db", id: "1f723c9d-a5b8-4284-af76-73daabf7ccad" }),
    INITIAL_OWNER_EMAIL: bindings.text("empresa@agenciagama.com.br"),
    INITIAL_ADMIN_EMAILS: bindings.secret(),
    BETTER_AUTH_SECRET: bindings.secret(),
    GOOGLE_CLIENT_ID: bindings.secret(),
    GOOGLE_CLIENT_SECRET: bindings.secret(),
  },
  assets: {
    notFoundHandling: "single-page-application" as const,
    runWorkerFirst: ["/api/*"],
  },
  observability: {
    enabled: true,
    logs: { enabled: true, headSamplingRate: 1 },
    traces: { enabled: true, headSamplingRate: 0.01 },
  },
};

export type WorkerEnv = InferEnv<UnwrapConfig<typeof worker>>;

export default defineConfig({ worker });
