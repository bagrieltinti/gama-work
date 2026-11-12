ALTER TABLE workspace_file_folders ADD COLUMN drive_folder_id TEXT;
ALTER TABLE workspace_files ADD COLUMN drive_head_revision_id TEXT;
ALTER TABLE workspace_files ADD COLUMN write_lock TEXT;
ALTER TABLE workspace_files ADD COLUMN write_lock_at INTEGER;
ALTER TABLE workspace_file_versions ADD COLUMN drive_revision_id TEXT;

CREATE TABLE IF NOT EXISTS workspace_drive_connections (
  workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connected_by TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  google_email TEXT NOT NULL,
  root_folder_id TEXT NOT NULL,
  workspace_folder_id TEXT NOT NULL,
  trash_folder_id TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  access_token_expires_at INTEGER NOT NULL,
  connected_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS workspace_drive_connections_owner_idx ON workspace_drive_connections(connected_by, google_email);

CREATE TABLE IF NOT EXISTS drive_oauth_states (
  state_hash TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS drive_oauth_states_expiry_idx ON drive_oauth_states(expires_at);
