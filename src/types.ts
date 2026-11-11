export type WorkspaceRole = "owner" | "admin" | "collaborator";
export type ClientStatus = "active" | "paused" | "discontinued";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  icon: string;
  accent_color: string;
  role: WorkspaceRole;
  client_count?: number;
}

export interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  product: string;
  status: ClientStatus;
  is_fidelized: number;
  responsible_user_id: string | null;
  responsible_name?: string | null;
  next_followup_at: number | null;
  notes: string;
  updated_at: number;
  last_interaction_at?: number | null;
}

export interface Interaction {
  id: string;
  channel: string;
  summary: string;
  next_action: string;
  happened_at: number;
  actor_name: string;
}

export interface JourneyTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  stages_json: string;
  is_active: number;
}

export interface ClientJourney {
  id: string;
  template_id: string | null;
  template_name: string;
  stages_json: string;
  status: "active" | "completed" | "paused";
  updated_at: number;
}

export interface Task {
  id: string;
  client_id: string | null;
  title: string;
  details: string;
  kind: "task" | "appointment";
  status: "open" | "in_progress" | "done";
  due_at: number | null;
  start_at: number | null;
  end_at: number | null;
  is_shared: number;
  assigned_user_id: string | null;
  assigned_name?: string | null;
  created_by: string;
  client_name?: string | null;
}

export interface Member {
  user_id: string;
  role: WorkspaceRole;
  joined_at: number;
  name: string;
  email: string;
  image?: string | null;
}

export interface Invitation {
  id: string;
  email: string;
  role: Exclude<WorkspaceRole, "owner">;
  expires_at?: number;
  expiresAt?: number;
  accepted_at?: number | null;
  url?: string;
  deliveryMethod?: "account" | "link";
}

export interface ReceivedInvitation extends Invitation {
  workspace_id: string;
  workspace_name: string;
  workspace_icon: string;
  workspace_accent_color: string;
  invited_by_name: string;
  created_at: number;
}

export interface GuestSeatSummary {
  active: number;
  pending: number;
  included: number;
  used: number;
  additional: number;
}
