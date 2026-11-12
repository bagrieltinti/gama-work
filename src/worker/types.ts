import type { Context } from "hono";
import type { WorkerEnv } from "../../cloudflare.config";

export type WorkspaceRole = "owner" | "admin" | "collaborator";

export interface WorkspaceFile {
  id: string;
  workspace_id: string;
  folder_id: string | null;
  name: string;
  content_type: string;
  size: number;
  current_version: number;
  created_by: string;
  updated_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

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
