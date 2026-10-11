import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { getDatabaseUrl } from './env.ts';
import type {
  DBUser,
  DBProviderConnection,
  DBOAuthState,
  ConnectionOptions,
  DBAdminDailyTask,
  DBAdminPromotion,
  DBUserTaskInteraction,
  DBUserPromotionPreference,
  DBEmergencyKillswitch,
  DBAdminAuditEvent,
} from './db.ts';
import type { Chat, ChatMessage, IntegrationProvider, AuditLogEntry, FriendMemory } from '../types/index.ts';

// Each query uses PostgreSQL as the source of truth. Never cache user data or
// acknowledge a write before it commits: function instances do not share memory.
export class PostgresDatabase {
  private pool?: pg.Pool;

  async checkHealth() {
    await this.rows(`SELECT 1 FROM modelmesh_users, modelmesh_chats, modelmesh_messages,
      modelmesh_provider_connections, modelmesh_oauth_states LIMIT 0`);
  }

  private getPool() {
    if (this.pool) return this.pool;
    const value = getDatabaseUrl();
    if (!value) throw new Error('DATABASE_URL is required');
    const url = new URL(value);
    for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
    const certPath = path.resolve(process.cwd(), 'certs/supabase-ca.pem');
    this.pool = new pg.Pool({
      connectionString: url.toString(),
      ssl: { rejectUnauthorized: true, ...(fs.existsSync(certPath) ? { ca: fs.readFileSync(certPath, 'utf8') } : {}) },
      max: 3,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 10000,
      allowExitOnIdle: true,
    });
    this.pool.on('error', (error) => console.error('[DB pool]', error.name));
    return this.pool;
  }

  private async rows<T>(sql: string, values: unknown[] = [], isRetry = false): Promise<T[]> {
    try {
      const result = await this.getPool().query(sql, values);
      return result.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) =>
        [key, value instanceof Date ? value.toISOString() : value]))) as T[];
    } catch (err: any) {
      // If serverless cold start dropped connection or timed out, reset pool and retry once
      const isTransient = !isRetry && (
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT' ||
        err.code === '57P01' || // admin_shutdown
        err.code === '08006' || // connection_failure
        err.code === '08001' || // sqlclient_unable_to_establish_sqlconnection
        err.message?.includes('Connection terminated') ||
        err.message?.includes('timeout')
      );
      if (isTransient) {
        console.warn('[DB] Retrying transient query failure:', err.code || err.message);
        if (this.pool) {
          try { await this.pool.end(); } catch {}
          this.pool = undefined;
        }
        return this.rows<T>(sql, values, true);
      }
      throw err;
    }
  }

  async findUserByEmail(email: string) {
    return (await this.rows<DBUser>('SELECT * FROM modelmesh_users WHERE lower(email) = lower($1) LIMIT 1', [email]))[0];
  }
  async findUserById(id: string) {
    return (await this.rows<DBUser>('SELECT * FROM modelmesh_users WHERE id = $1', [id]))[0];
  }
  async createUser(user: Omit<DBUser, 'id' | 'created_at'>) {
    return (await this.rows<DBUser>(
      `INSERT INTO modelmesh_users (id,email,name,password_hash,auth_provider)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [crypto.randomUUID(), user.email.trim().toLowerCase(), user.name, user.password_hash || null, user.auth_provider || 'email']))[0];
  }
  async getProviderConnection(userId: string, provider: IntegrationProvider = 'openrouter') {
    return (await this.rows<DBProviderConnection>(
      `SELECT * FROM modelmesh_provider_connections WHERE user_id=$1 AND provider=$2 AND connection_status='connected'`, [userId, provider]))[0];
  }
  async getAnyProviderConnection(userId: string, provider: IntegrationProvider = 'openrouter') {
    return (await this.rows<DBProviderConnection>('SELECT * FROM modelmesh_provider_connections WHERE user_id=$1 AND provider=$2', [userId, provider]))[0];
  }
  async saveProviderConnection(userId: string, provider: IntegrationProvider, encryptedCredential: string, status: 'connected' | 'disconnected' | 'error' = 'connected', options: ConnectionOptions = {}) {
    return (await this.rows<DBProviderConnection>(
      `INSERT INTO modelmesh_provider_connections (id,user_id,provider,encrypted_credential,connection_status,provider_account_id,account_username,scopes,encrypted_refresh_token,token_expiry,metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (user_id,provider) DO UPDATE SET
       encrypted_credential=EXCLUDED.encrypted_credential, connection_status=EXCLUDED.connection_status,
       provider_account_id=COALESCE(EXCLUDED.provider_account_id,modelmesh_provider_connections.provider_account_id),
       account_username=COALESCE(EXCLUDED.account_username,modelmesh_provider_connections.account_username),
       scopes=COALESCE(EXCLUDED.scopes,modelmesh_provider_connections.scopes),
       encrypted_refresh_token=COALESCE(EXCLUDED.encrypted_refresh_token,modelmesh_provider_connections.encrypted_refresh_token),
       token_expiry=COALESCE(EXCLUDED.token_expiry,modelmesh_provider_connections.token_expiry),
       metadata=COALESCE(EXCLUDED.metadata,modelmesh_provider_connections.metadata),
       updated_at=NOW() RETURNING *`, [crypto.randomUUID(),userId,provider,encryptedCredential,status,
       options.providerAccountId || null,options.accountUsername || null,options.scopes || null,
       options.encryptedRefreshToken || null,options.tokenExpiry || null,options.metadata ? JSON.stringify(options.metadata) : null]))[0];
  }
  async disconnectProvider(userId: string, provider: IntegrationProvider) {
    return (await this.rows(`UPDATE modelmesh_provider_connections SET connection_status='disconnected',
      encrypted_credential=NULL, encrypted_refresh_token=NULL, updated_at=NOW() WHERE user_id=$1 AND provider=$2 RETURNING id`, [userId,provider])).length > 0;
  }
  async getAllProviderConnections(userId: string) {
    return this.rows<DBProviderConnection>('SELECT * FROM modelmesh_provider_connections WHERE user_id=$1', [userId]);
  }
  async createAuditLog(entry: Omit<AuditLogEntry, 'id' | 'created_at'>) {
    return (await this.rows<AuditLogEntry>(`INSERT INTO modelmesh_audit_logs
      (id,user_id,provider,action,resource,permission_level,status,approval_status,details)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [crypto.randomUUID(),entry.user_id,entry.provider,entry.action,entry.resource || null,
       entry.permission_level,entry.status,entry.approval_status || null,entry.details ? JSON.stringify(entry.details) : null]))[0];
  }
  async getAuditLogs(userId: string) {
    return this.rows<AuditLogEntry>('SELECT * FROM modelmesh_audit_logs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [userId]);
  }
  async saveOAuthState(state: string, codeVerifier: string, userId: string, returnScreen?: string, pendingAction?: string) {
    try {
      await this.rows(`INSERT INTO modelmesh_oauth_states (state,code_verifier,user_id,expires_at,return_screen,pending_action)
        VALUES ($1,$2,$3,NOW()+INTERVAL '10 minutes',$4,$5)`, [state,codeVerifier,userId,returnScreen || null,pendingAction || null]);
    } catch {
      await this.rows(`INSERT INTO modelmesh_oauth_states (state,code_verifier,user_id,expires_at)
        VALUES ($1,$2,$3,NOW()+INTERVAL '10 minutes')`, [state,codeVerifier,userId]);
    }
  }
  async consumeOAuthState(state: string) {
    // One atomic statement: only one instance can consume the state.
    return (await this.rows<DBOAuthState>(`DELETE FROM modelmesh_oauth_states
      WHERE state=$1 AND consumed=FALSE AND expires_at>NOW() RETURNING *`, [state]))[0];
  }
  async getUserChats(userId: string) {
    return this.rows<Chat>('SELECT * FROM modelmesh_chats WHERE user_id=$1 ORDER BY created_at DESC', [userId]);
  }
  async getChatById(chatId: string, userId: string) {
    return (await this.rows<Chat>('SELECT * FROM modelmesh_chats WHERE id=$1 AND user_id=$2', [chatId,userId]))[0];
  }
  async createChat(userId: string, title: string) {
    return (await this.rows<Chat>('INSERT INTO modelmesh_chats (id,user_id,title) VALUES ($1,$2,$3) RETURNING *',
      [crypto.randomUUID(),userId,title.slice(0,100)]))[0];
  }
  async deleteChat(chatId: string, userId: string) {
    return (await this.rows('DELETE FROM modelmesh_chats WHERE id=$1 AND user_id=$2 RETURNING id', [chatId,userId])).length > 0;
  }
  async getChatMessages(chatId: string) {
    return this.rows<ChatMessage>('SELECT * FROM modelmesh_messages WHERE chat_id=$1 ORDER BY created_at ASC', [chatId]);
  }
  async createMessage(chatId: string, role: 'user' | 'assistant' | 'system', content: string, modelCategory?: ChatMessage['model_category'], modelId?: string) {
    return (await this.rows<ChatMessage>(`INSERT INTO modelmesh_messages (id,chat_id,role,content,model_category,model_id)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [crypto.randomUUID(),chatId,role,content,modelCategory || null,modelId || null]))[0];
  }

  // --- Friend Memories ---
  async getMemories(userId: string): Promise<FriendMemory[]> {
    return this.rows<FriendMemory>('SELECT * FROM friend_memories WHERE user_id=$1 ORDER BY updated_at DESC', [userId]);
  }
  async getMemoryByKey(userId: string, key: string): Promise<FriendMemory | null> {
    return (await this.rows<FriendMemory>('SELECT * FROM friend_memories WHERE user_id=$1 AND LOWER(memory_key)=LOWER($2)', [userId, key.trim()]))[0] || null;
  }
  async saveMemory(userId: string, key: string, value: string): Promise<FriendMemory> {
    const k = key.trim().slice(0, 100);
    const v = value.trim().slice(0, 500);
    return (await this.rows<FriendMemory>(`
      INSERT INTO friend_memories (id, user_id, memory_key, memory_value, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (user_id, memory_key)
      DO UPDATE SET memory_value = EXCLUDED.memory_value, updated_at = NOW()
      RETURNING *
    `, [crypto.randomUUID(), userId, k, v]))[0];
  }
  async updateMemory(userId: string, id: string, value: string, key?: string): Promise<FriendMemory | null> {
    const v = value.trim().slice(0, 500);
    if (key) {
      const k = key.trim().slice(0, 100);
      return (await this.rows<FriendMemory>(`
        UPDATE friend_memories SET memory_key=$1, memory_value=$2, updated_at=NOW()
        WHERE id=$3 AND user_id=$4
        RETURNING *
      `, [k, v, id, userId]))[0] || null;
    }
    return (await this.rows<FriendMemory>(`
      UPDATE friend_memories SET memory_value=$1, updated_at=NOW()
      WHERE id=$2 AND user_id=$3
      RETURNING *
    `, [v, id, userId]))[0] || null;
  }
  async deleteMemory(userId: string, id: string): Promise<boolean> {
    return (await this.rows('DELETE FROM friend_memories WHERE id=$1 AND user_id=$2 RETURNING id', [id, userId])).length > 0;
  }
  async clearMemories(userId: string): Promise<boolean> {
    await this.rows('DELETE FROM friend_memories WHERE user_id=$1', [userId]);
    return true;
  }

  // --- Admin Tasks ---
  async getAdminTasks(): Promise<DBAdminDailyTask[]> {
    return this.rows<DBAdminDailyTask>('SELECT * FROM admin_daily_tasks ORDER BY created_at DESC');
  }
  async saveAdminTask(task: DBAdminDailyTask): Promise<DBAdminDailyTask> {
    return (await this.rows<DBAdminDailyTask>(`
      INSERT INTO admin_daily_tasks (id, created_by, title, description, language, status, start_time, end_time, link, allow_participation, allow_dismiss, allow_reminder, spoken_reminder_text, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
      RETURNING *
    `, [task.id, task.created_by, task.title, task.description, task.language, task.status, task.start_time || null, task.end_time || null, task.link || null, task.allow_participation, task.allow_dismiss, task.allow_reminder, task.spoken_reminder_text || null]))[0];
  }
  async updateAdminTask(id: string, updates: Partial<DBAdminDailyTask>): Promise<DBAdminDailyTask | null> {
    const existing = (await this.rows<DBAdminDailyTask>('SELECT * FROM admin_daily_tasks WHERE id=$1', [id]))[0];
    if (!existing) return null;
    const merged = { ...existing, ...updates };
    return (await this.rows<DBAdminDailyTask>(`
      UPDATE admin_daily_tasks
      SET title=$1, description=$2, language=$3, status=$4, link=$5, allow_participation=$6, allow_dismiss=$7, allow_reminder=$8, spoken_reminder_text=$9, updated_at=NOW()
      WHERE id=$10
      RETURNING *
    `, [merged.title, merged.description, merged.language, merged.status, merged.link || null, merged.allow_participation, merged.allow_dismiss, merged.allow_reminder, merged.spoken_reminder_text || null, id]))[0] || null;
  }
  async deleteAdminTask(id: string): Promise<boolean> {
    return (await this.rows('DELETE FROM admin_daily_tasks WHERE id=$1 RETURNING id', [id])).length > 0;
  }

  // --- Admin Promotions ---
  async getAdminPromotions(): Promise<DBAdminPromotion[]> {
    return this.rows<DBAdminPromotion>('SELECT * FROM admin_promotions ORDER BY created_at DESC');
  }
  async saveAdminPromotion(promo: DBAdminPromotion): Promise<DBAdminPromotion> {
    return (await this.rows<DBAdminPromotion>(`
      INSERT INTO admin_promotions (id, created_by, title, description, label, destination_url, format, status, spoken_text, max_frequency_per_day, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING *
    `, [promo.id, promo.created_by, promo.title, promo.description, promo.label, promo.destination_url, promo.format, promo.status, promo.spoken_text || null, promo.max_frequency_per_day]))[0];
  }
  async updateAdminPromotion(id: string, updates: Partial<DBAdminPromotion>): Promise<DBAdminPromotion | null> {
    const existing = (await this.rows<DBAdminPromotion>('SELECT * FROM admin_promotions WHERE id=$1', [id]))[0];
    if (!existing) return null;
    const merged = { ...existing, ...updates };
    return (await this.rows<DBAdminPromotion>(`
      UPDATE admin_promotions
      SET title=$1, description=$2, label=$3, destination_url=$4, format=$5, status=$6, spoken_text=$7, max_frequency_per_day=$8, updated_at=NOW()
      WHERE id=$9
      RETURNING *
    `, [merged.title, merged.description, merged.label, merged.destination_url, merged.format, merged.status, merged.spoken_text || null, merged.max_frequency_per_day, id]))[0] || null;
  }
  async deleteAdminPromotion(id: string): Promise<boolean> {
    return (await this.rows('DELETE FROM admin_promotions WHERE id=$1 RETURNING id', [id])).length > 0;
  }

  // --- Emergency Killswitch ---
  async getEmergencySwitch(): Promise<DBEmergencyKillswitch> {
    const row = (await this.rows<{ value: string }>('SELECT value FROM modelmesh_kv_settings WHERE key=$1', ['emergency_switch']))[0];
    return row ? JSON.parse(row.value) : { campaigns_disabled: false };
  }
  async setEmergencySwitch(sw: DBEmergencyKillswitch): Promise<DBEmergencyKillswitch> {
    await this.rows(`
      INSERT INTO modelmesh_kv_settings (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()
    `, ['emergency_switch', JSON.stringify(sw)]);
    return sw;
  }

  // --- Admin Audit Logs ---
  async recordAdminAudit(event: DBAdminAuditEvent): Promise<void> {
    await this.rows(`
      INSERT INTO admin_audit_logs (id, actor_id, actor_email, action, target_id, target_type, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [event.id, event.actor_id, event.actor_email, event.action, event.target_id, event.target_type]);
  }
  async getAdminAuditLogs(): Promise<DBAdminAuditEvent[]> {
    return this.rows<DBAdminAuditEvent>('SELECT * FROM admin_audit_logs ORDER BY timestamp DESC LIMIT 200');
  }

  // --- User Interactions & Preferences ---
  async getUserTaskInteraction(userId: string, taskId: string): Promise<DBUserTaskInteraction | null> {
    return (await this.rows<DBUserTaskInteraction>('SELECT * FROM user_task_interactions WHERE user_id=$1 AND task_id=$2', [userId, taskId]))[0] || null;
  }
  async setUserTaskInteraction(userId: string, taskId: string, status: string, reminderEnabled: boolean): Promise<DBUserTaskInteraction> {
    return (await this.rows<DBUserTaskInteraction>(`
      INSERT INTO user_task_interactions (user_id, task_id, status, reminder_enabled, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (user_id, task_id)
      DO UPDATE SET status=EXCLUDED.status, reminder_enabled=EXCLUDED.reminder_enabled, updated_at=NOW()
      RETURNING *
    `, [userId, taskId, status, reminderEnabled]))[0];
  }
  async getUserPromotionPreference(userId: string): Promise<boolean> {
    const row = (await this.rows<DBUserPromotionPreference>('SELECT spoken_promotions_opt_in FROM user_promotion_preferences WHERE user_id=$1', [userId]))[0];
    return Boolean(row?.spoken_promotions_opt_in);
  }
  async setUserPromotionPreference(userId: string, optIn: boolean): Promise<boolean> {
    const row = (await this.rows<DBUserPromotionPreference>(`
      INSERT INTO user_promotion_preferences (user_id, spoken_promotions_opt_in, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET spoken_promotions_opt_in=EXCLUDED.spoken_promotions_opt_in, updated_at=NOW()
      RETURNING *
    `, [userId, Boolean(optIn)]))[0];
    return Boolean(row?.spoken_promotions_opt_in);
  }
}

