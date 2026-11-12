import type { Context } from "hono";
import type { AppContext, AppEnv, AppUser, WorkspaceRole } from "./types";

export interface WorkspaceAccess {
  role: WorkspaceRole;
}

export function platformAdminEmails(env: AppEnv["Bindings"]): Set<string> {
  return new Set((env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(/[;,\n]/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean));
}

export function isPlatformAdminEmail(env: AppEnv["Bindings"], email: string): boolean {
  return platformAdminEmails(env).has(email.trim().toLowerCase());
}

export async function requirePlatformAdmin(c: AppContext): Promise<boolean> {
  return isPlatformAdminEmail(c.env, c.get("user").email);
}

export async function getWorkspaceAccess(
  c: AppContext,
  workspaceId: string,
): Promise<WorkspaceAccess | null> {
  const user = c.get("user");
  const row = await c.env.DB.prepare(
    `SELECT m.role FROM workspace_members m
     LEFT JOIN platform_workspace_status s ON s.workspace_id = m.workspace_id
     WHERE m.workspace_id = ? AND m.user_id = ? AND COALESCE(s.status, 'active') = 'active' LIMIT 1`,
  )
    .bind(workspaceId, user.id)
    .first<{ role: WorkspaceRole }>();
  return row ?? null;
}

export function canManage(access: WorkspaceAccess | null): boolean {
  return access?.role === "owner" || access?.role === "admin";
}

export function isOwner(access: WorkspaceAccess | null): boolean {
  return access?.role === "owner";
}

export async function readJson(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    const value = await c.req.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function fieldText(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function fieldEmail(value: unknown): string {
  const email = fieldText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export function fieldColor(value: unknown, fallback = "#F65A1E"): string {
  const color = fieldText(value, 7);
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color.toUpperCase() : fallback;
}

export function fieldRole(value: unknown): WorkspaceRole | null {
  return value === "owner" || value === "admin" || value === "collaborator" ? value : null;
}

export async function hashText(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function csvEscape(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function currentUser(c: AppContext): AppUser {
  return c.get("user");
}
