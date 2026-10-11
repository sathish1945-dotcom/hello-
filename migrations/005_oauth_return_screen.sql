-- ModelMesh Production Schema Migration 005
-- Adds return_screen and pending_action to modelmesh_oauth_states for originating screen restoration
ALTER TABLE modelmesh_oauth_states
  ADD COLUMN IF NOT EXISTS return_screen TEXT,
  ADD COLUMN IF NOT EXISTS pending_action TEXT;
