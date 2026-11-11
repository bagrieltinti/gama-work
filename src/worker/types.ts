import type { Context } from "hono";
import type { WorkerEnv } from "../../cloudflare.config";

export type WorkspaceRole = "owner" | "admin" | "collaborator";

export interface AppUser {
  id: string;
  email: string;
  name: string;
}

export type AppEnv = {
  Bindings: WorkerEnv;
  Variables: { user: AppUser };
};

export type AppContext = Context<AppEnv>;
