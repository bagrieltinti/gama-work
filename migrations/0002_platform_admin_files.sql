CREATE TABLE IF NOT EXISTS platform_user_status (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')) DEFAULT 'active',
  reason TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_workspace_status (
  workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')) DEFAULT 'active',
  reason TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_admin_audit (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS platform_admin_audit_created_idx ON platform_admin_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS platform_admin_audit_target_idx ON platform_admin_audit(target_type, target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workspace_file_folders (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_folder_id TEXT REFERENCES workspace_file_folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS workspace_file_folders_parent_idx ON workspace_file_folders(workspace_id, parent_folder_id, name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS workspace_files (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES workspace_file_folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  object_key TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES user(id),
  updated_by TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS workspace_files_folder_idx ON workspace_files(workspace_id, folder_id, deleted_at, name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS workspace_files_updated_idx ON workspace_files(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS workspace_file_versions (
  id TEXT PRIMARY KEY NOT NULL,
  file_id TEXT NOT NULL REFERENCES workspace_files(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  size INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL,
  UNIQUE(file_id, version_number)
);
CREATE INDEX IF NOT EXISTS workspace_file_versions_file_idx ON workspace_file_versions(file_id, version_number DESC);
