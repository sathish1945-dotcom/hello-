-- Migration 007: Admin Daily Tasks, Promotions, Consent Preferences and Tamper-Protected Audit Logs
-- Applied for Hello founder admin workflows and user consent controls

CREATE TABLE IF NOT EXISTS admin_daily_tasks (
    id TEXT PRIMARY KEY,
    created_by TEXT NOT NULL REFERENCES modelmesh_users(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    description VARCHAR(500),
    language VARCHAR(20) NOT NULL DEFAULT 'all',
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    link TEXT,
    allow_participation BOOLEAN NOT NULL DEFAULT true,
    allow_dismiss BOOLEAN NOT NULL DEFAULT true,
    allow_reminder BOOLEAN NOT NULL DEFAULT false,
    spoken_reminder_text VARCHAR(300),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_tasks_status ON admin_daily_tasks(status);

CREATE TABLE IF NOT EXISTS admin_promotions (
    id TEXT PRIMARY KEY,
    created_by TEXT NOT NULL REFERENCES modelmesh_users(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    description VARCHAR(500),
    label VARCHAR(20) NOT NULL CHECK (label IN ('Sponsored', 'Advertisement')),
    destination_url TEXT NOT NULL,
    format VARCHAR(20) NOT NULL DEFAULT 'card' CHECK (format IN ('card', 'spoken', 'both')),
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'preview', 'approved', 'scheduled', 'paused', 'archived')),
    spoken_text VARCHAR(300),
    max_frequency_per_day INTEGER NOT NULL DEFAULT 1 CHECK (max_frequency_per_day >= 1 AND max_frequency_per_day <= 5),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_promos_status ON admin_promotions(status);

CREATE TABLE IF NOT EXISTS user_task_interactions (
    user_id TEXT NOT NULL REFERENCES modelmesh_users(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES admin_daily_tasks(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'viewed',
    reminder_enabled BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, task_id)
);

CREATE TABLE IF NOT EXISTS user_promotion_preferences (
    user_id TEXT PRIMARY KEY REFERENCES modelmesh_users(id) ON DELETE CASCADE,
    spoken_promotions_opt_in BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tamper-Protected Append-Only Admin Audit Log
CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    actor_email VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL,
    target_id TEXT NOT NULL,
    target_type VARCHAR(50) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_timestamp ON admin_audit_logs(timestamp DESC);

-- Trigger to strictly forbid UPDATE or DELETE operations on audit logs (Genuine Tamper Protection)
CREATE OR REPLACE FUNCTION prevent_audit_log_alteration()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'admin_audit_logs is strictly append-only. Modification and deletion are forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_admin_audit_logs ON admin_audit_logs;
CREATE TRIGGER trg_protect_admin_audit_logs
BEFORE UPDATE OR DELETE ON admin_audit_logs
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_log_alteration();

-- RLS Enforcement
ALTER TABLE admin_daily_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_task_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_promotion_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- User interactions and preferences policies (strict user ownership)
CREATE POLICY user_interactions_policy ON user_task_interactions
    FOR ALL
    USING (auth.uid()::text = user_id OR auth.role() = 'service_role' OR current_user IN ('postgres', 'authenticated_app_role'))
    WITH CHECK (auth.uid()::text = user_id OR auth.role() = 'service_role' OR current_user IN ('postgres', 'authenticated_app_role'));

CREATE POLICY user_promo_prefs_policy ON user_promotion_preferences
    FOR ALL
    USING (auth.uid()::text = user_id OR auth.role() = 'service_role' OR current_user IN ('postgres', 'authenticated_app_role'))
    WITH CHECK (auth.uid()::text = user_id OR auth.role() = 'service_role' OR current_user IN ('postgres', 'authenticated_app_role'));

-- Explicit runtime database grants: revoke direct client access, grant backend service_role
REVOKE ALL ON admin_daily_tasks FROM anon;
REVOKE ALL ON admin_promotions FROM anon;
REVOKE ALL ON admin_audit_logs FROM anon;

GRANT ALL ON admin_daily_tasks TO service_role;
GRANT ALL ON admin_promotions TO service_role;
GRANT ALL ON user_task_interactions TO service_role;
GRANT ALL ON user_promotion_preferences TO service_role;
GRANT ALL ON admin_audit_logs TO service_role;
