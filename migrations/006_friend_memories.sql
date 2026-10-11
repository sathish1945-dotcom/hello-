-- Migration 006: Private Friend Memories Table
-- References modelmesh_users(id TEXT) with strict ON DELETE CASCADE
-- Enables RLS and denies direct client access (anon/authenticated) to enforce server-side authenticated ownership

CREATE TABLE IF NOT EXISTS friend_memories (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id TEXT NOT NULL REFERENCES modelmesh_users(id) ON DELETE CASCADE,
  memory_key VARCHAR(100) NOT NULL,
  memory_value VARCHAR(500) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_friend_memories_user_key UNIQUE (user_id, memory_key)
);

-- Ensure foreign key constraint exists if table already existed prior to migration
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_friend_memories_user'
  ) THEN
    ALTER TABLE friend_memories
    DROP CONSTRAINT IF EXISTS friend_memories_user_id_fkey,
    ADD CONSTRAINT fk_friend_memories_user
    FOREIGN KEY (user_id) REFERENCES modelmesh_users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_friend_memories_user_id ON friend_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_friend_memories_updated_at ON friend_memories(updated_at);

-- Trigger to automatically update updated_at on edits
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_friend_memories_updated_at ON friend_memories;
CREATE TRIGGER trg_friend_memories_updated_at
BEFORE UPDATE ON friend_memories
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

-- Security: Enable RLS and restrict direct Data API access
ALTER TABLE friend_memories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON friend_memories FROM anon, authenticated;
GRANT ALL ON friend_memories TO service_role;
