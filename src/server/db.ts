import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PostgresDatabase } from './postgres.ts';
import { getDatabaseUrl, loadEnvironment } from './env.ts';
import type { User, ProviderConnection, Chat, ChatMessage, AuditLogEntry, IntegrationProvider, FriendMemory } from '../types/index.ts';

loadEnvironment();

export interface DBUser extends User {
  password_hash?: string;
}

export interface DBProviderConnection extends ProviderConnection {
  encrypted_credential?: string;
  encrypted_refresh_token?: string;
  metadata?: Record<string, any>;
}

export interface ConnectionOptions {
  providerAccountId?: string;
  accountUsername?: string;
  scopes?: string;
  encryptedRefreshToken?: string;
  tokenExpiry?: string;
  metadata?: Record<string, any>;
}

export interface DBOAuthState {
  state: string;
  code_verifier: string;
  user_id: string;
  expires_at: string;
  consumed: boolean;
  created_at: string;
  return_screen?: string;
  pending_action?: string;
}

export interface DBAdminDailyTask {
  id: string;
  created_by: string;
  title: string;
  description: string;
  language: string;
  status: 'draft' | 'preview' | 'published' | 'scheduled' | 'paused' | 'archived';
  start_time?: string;
  end_time?: string;
  link?: string;
  allow_participation: boolean;
  allow_dismiss: boolean;
  allow_reminder: boolean;
  spoken_reminder_text?: string;
  created_at: string;
  updated_at: string;
}

export interface DBAdminPromotion {
  id: string;
  created_by: string;
  title: string;
  description: string;
  label: 'Sponsored' | 'Advertisement';
  destination_url: string;
  format: 'card' | 'spoken' | 'both';
  status: 'draft' | 'preview' | 'approved' | 'scheduled' | 'paused' | 'archived';
  spoken_text?: string;
  max_frequency_per_day: number;
  created_at: string;
  updated_at: string;
}

export interface DBUserTaskInteraction {
  user_id: string;
  task_id: string;
  status: string;
  reminder_enabled: boolean;
  updated_at: string;
}

export interface DBUserPromotionPreference {
  user_id: string;
  spoken_promotions_opt_in: boolean;
  updated_at: string;
}

export interface DBEmergencyKillswitch {
  campaigns_disabled: boolean;
  reason?: string;
  toggled_by?: string;
  toggled_at?: string;
}

export interface DBAdminAuditEvent {
  id: string;
  actor_id: string;
  actor_email: string;
  action: string;
  target_id: string;
  target_type: 'task' | 'promotion' | 'emergency_switch';
  timestamp: string;
}

interface DatabaseSchema {
  users: DBUser[];
  provider_connections: DBProviderConnection[];
  chats: Chat[];
  messages: ChatMessage[];
  oauth_states: DBOAuthState[];
  audit_logs: AuditLogEntry[];
  friend_memories: FriendMemory[];
  admin_tasks: DBAdminDailyTask[];
  admin_promotions: DBAdminPromotion[];
  user_task_interactions: DBUserTaskInteraction[];
  user_promo_preferences: DBUserPromotionPreference[];
  admin_audit_logs: DBAdminAuditEvent[];
  emergency_switch?: DBEmergencyKillswitch;
}

const DB_FALLBACK_FILE = path.resolve(process.cwd(), 'data/modelmesh_db.json');

export class LocalDatabase {
  async checkHealth() { return; }

  private data: DatabaseSchema = {
    users: [],
    provider_connections: [],
    chats: [],
    messages: [],
    oauth_states: [],
    audit_logs: [],
    friend_memories: [],
    admin_tasks: [],
    admin_promotions: [],
    user_task_interactions: [],
    user_promo_preferences: [],
    admin_audit_logs: [],
    emergency_switch: { campaigns_disabled: false },
  };

  constructor() {
    this.initLocalFallback();
  }

  private initLocalFallback() {
    try {
      const dir = path.dirname(DB_FALLBACK_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (fs.existsSync(DB_FALLBACK_FILE)) {
        const raw = fs.readFileSync(DB_FALLBACK_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this.data = {
          users: parsed.users || [],
          provider_connections: parsed.provider_connections || [],
          chats: parsed.chats || [],
          messages: parsed.messages || [],
          oauth_states: parsed.oauth_states || [],
          audit_logs: parsed.audit_logs || [],
          friend_memories: parsed.friend_memories || [],
          admin_tasks: parsed.admin_tasks || [],
          admin_promotions: parsed.admin_promotions || [],
          user_task_interactions: parsed.user_task_interactions || [],
          user_promo_preferences: parsed.user_promo_preferences || [],
          admin_audit_logs: parsed.admin_audit_logs || [],
          emergency_switch: parsed.emergency_switch || { campaigns_disabled: false },
        };
      }
    } catch (err) {
      console.error('[DB] Failed to load local JSON fallback:', err);
    }
  }

  private saveLocalFallback() {
    try {
      const dir = path.dirname(DB_FALLBACK_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const serialized = JSON.stringify(this.data, null, 2);
      const tmpFile = `${DB_FALLBACK_FILE}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpFile, serialized, 'utf-8');
      try {
        fs.renameSync(tmpFile, DB_FALLBACK_FILE);
      } catch {
        // Fallback for Windows file locking / antivirus scan
        fs.writeFileSync(DB_FALLBACK_FILE, serialized, 'utf-8');
        try { fs.unlinkSync(tmpFile); } catch {}
      }
    } catch (err) {
      console.error('[DB] Failed to save local JSON file:', err);
    }
  }

  // --- Users ---
  findUserByEmail(email: string): DBUser | undefined {
    return this.data.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  }

  findUserById(id: string): DBUser | undefined {
    return this.data.users.find((u) => u.id === id);
  }

  createUser(user: Omit<DBUser, 'id' | 'created_at'>): DBUser {
    const newUser: DBUser = {
      ...user,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    this.data.users.push(newUser);
    this.saveLocalFallback();

    return newUser;
  }

  // --- Provider Connections ---
  getProviderConnection(userId: string, provider: IntegrationProvider = 'openrouter'): DBProviderConnection | undefined {
    return this.data.provider_connections.find(
      (pc) => pc.user_id === userId && pc.provider === provider && pc.connection_status === 'connected'
    );
  }

  getAnyProviderConnection(userId: string, provider: IntegrationProvider = 'openrouter'): DBProviderConnection | undefined {
    return this.data.provider_connections.find(
      (pc) => pc.user_id === userId && pc.provider === provider
    );
  }

  saveProviderConnection(
    userId: string,
    provider: IntegrationProvider,
    encryptedCredential: string,
    status: 'connected' | 'disconnected' | 'error' = 'connected',
    options: ConnectionOptions = {},
  ): DBProviderConnection {
    const existingIndex = this.data.provider_connections.findIndex(
      (pc) => pc.user_id === userId && pc.provider === provider
    );
    const now = new Date().toISOString();

    let resultConn: DBProviderConnection;

    if (existingIndex >= 0) {
      this.data.provider_connections[existingIndex] = {
        ...this.data.provider_connections[existingIndex],
        encrypted_credential: encryptedCredential,
        connection_status: status,
        updated_at: now,
        ...(options.providerAccountId && { provider_account_id: options.providerAccountId }),
        ...(options.accountUsername && { account_username: options.accountUsername }),
        ...(options.scopes && { scopes: options.scopes }),
        ...(options.encryptedRefreshToken && { encrypted_refresh_token: options.encryptedRefreshToken }),
        ...(options.tokenExpiry && { token_expiry: options.tokenExpiry }),
        ...(options.metadata && { metadata: options.metadata }),
      };
      resultConn = this.data.provider_connections[existingIndex];
    } else {
      resultConn = {
        id: crypto.randomUUID(),
        user_id: userId,
        provider,
        encrypted_credential: encryptedCredential,
        connection_status: status,
        created_at: now,
        updated_at: now,
        provider_account_id: options.providerAccountId,
        account_username: options.accountUsername,
        scopes: options.scopes,
        encrypted_refresh_token: options.encryptedRefreshToken,
        token_expiry: options.tokenExpiry,
        metadata: options.metadata,
      };
      this.data.provider_connections.push(resultConn);
    }
    this.saveLocalFallback();

    return resultConn;
  }

  disconnectProvider(userId: string, provider: IntegrationProvider): boolean {
    const conn = this.data.provider_connections.find(
      (pc) => pc.user_id === userId && pc.provider === provider
    );
    if (conn) {
      conn.connection_status = 'disconnected';
      conn.encrypted_credential = undefined;
      conn.encrypted_refresh_token = undefined;
      conn.updated_at = new Date().toISOString();
      this.saveLocalFallback();

      return true;
    }
    return false;
  }

  getAllProviderConnections(userId: string): DBProviderConnection[] {
    return this.data.provider_connections.filter((conn) => conn.user_id === userId);
  }

  createAuditLog(entry: Omit<AuditLogEntry, 'id' | 'created_at'>): AuditLogEntry {
    const log = { ...entry, id: crypto.randomUUID(), created_at: new Date().toISOString() };
    this.data.audit_logs.push(log);
    this.saveLocalFallback();
    return log;
  }

  getAuditLogs(userId: string): AuditLogEntry[] {
    return this.data.audit_logs.filter((log) => log.user_id === userId).slice(-100).reverse();
  }

  // --- OAuth PKCE States with Expiry and Consumption Control ---
  saveOAuthState(state: string, codeVerifier: string, userId: string, returnScreen?: string, pendingAction?: string): void {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString(); // 10 minutes expiry

    // Purge expired states in memory
    const nowTime = now.getTime();
    this.data.oauth_states = this.data.oauth_states.filter(
      (s) => new Date(s.expires_at).getTime() > nowTime && !s.consumed
    );

    this.data.oauth_states.push({
      state,
      code_verifier: codeVerifier,
      user_id: userId,
      expires_at: expiresAt,
      consumed: false,
      created_at: now.toISOString(),
      return_screen: returnScreen,
      pending_action: pendingAction,
    });
    this.saveLocalFallback();
  }

  consumeOAuthState(state: string): DBOAuthState | undefined {
    const nowTime = Date.now();
    const index = this.data.oauth_states.findIndex(
      (s) => s.state === state && !s.consumed && new Date(s.expires_at).getTime() > nowTime
    );

    if (index === -1) {
      // Invalidate on database as well if replayed

      return undefined;
    }

    const [oauthState] = this.data.oauth_states.splice(index, 1);
    oauthState.consumed = true;
    this.saveLocalFallback();

    return oauthState;
  }

  // --- Chats ---
  getUserChats(userId: string): Chat[] {
    return this.data.chats
      .filter((c) => c.user_id === userId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  getChatById(chatId: string, userId: string): Chat | undefined {
    return this.data.chats.find((c) => c.id === chatId && c.user_id === userId);
  }

  createChat(userId: string, title: string): Chat {
    const chat: Chat = {
      id: crypto.randomUUID(),
      user_id: userId,
      title: title.slice(0, 100),
      created_at: new Date().toISOString(),
    };
    this.data.chats.unshift(chat);
    this.saveLocalFallback();

    return chat;
  }

  deleteChat(chatId: string, userId: string): boolean {
    const chatIndex = this.data.chats.findIndex((c) => c.id === chatId && c.user_id === userId);
    if (chatIndex === -1) return false;

    this.data.chats.splice(chatIndex, 1);
    this.data.messages = this.data.messages.filter((m) => m.chat_id !== chatId);
    this.saveLocalFallback();

    return true;
  }

  // --- Messages ---
  getChatMessages(chatId: string): ChatMessage[] {
    return this.data.messages
      .filter((m) => m.chat_id === chatId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }

  createMessage(
    chatId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    modelCategory?: ChatMessage['model_category'],
    modelId?: string
  ): ChatMessage {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      chat_id: chatId,
      role,
      content,
      model_category: modelCategory,
      model_id: modelId,
      created_at: new Date().toISOString(),
    };
    this.data.messages.push(message);
    this.saveLocalFallback();

    return message;
  }

  // --- Friend Memories ---
  async getMemories(userId: string): Promise<FriendMemory[]> {
    return (this.data.friend_memories || [])
      .filter((m) => m.user_id === userId)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }

  async getMemoryByKey(userId: string, key: string): Promise<FriendMemory | null> {
    const mem = (this.data.friend_memories || []).find(
      (m) => m.user_id === userId && m.memory_key.toLowerCase() === key.trim().toLowerCase()
    );
    return mem || null;
  }

  async saveMemory(userId: string, key: string, value: string): Promise<FriendMemory> {
    if (!this.data.friend_memories) this.data.friend_memories = [];
    const normalizedKey = key.trim().slice(0, 100);
    const normalizedValue = value.trim().slice(0, 500);
    const existingIndex = this.data.friend_memories.findIndex(
      (m) => m.user_id === userId && m.memory_key.toLowerCase() === normalizedKey.toLowerCase()
    );

    const now = new Date().toISOString();
    if (existingIndex >= 0) {
      this.data.friend_memories[existingIndex].memory_value = normalizedValue;
      this.data.friend_memories[existingIndex].updated_at = now;
      this.saveLocalFallback();
      return this.data.friend_memories[existingIndex];
    }

    const memory: FriendMemory = {
      id: crypto.randomUUID(),
      user_id: userId,
      memory_key: normalizedKey,
      memory_value: normalizedValue,
      created_at: now,
      updated_at: now,
    };
    this.data.friend_memories.unshift(memory);
    this.saveLocalFallback();
    return memory;
  }

  async updateMemory(userId: string, id: string, value: string, key?: string): Promise<FriendMemory | null> {
    if (!this.data.friend_memories) return null;
    const index = this.data.friend_memories.findIndex((m) => m.id === id && m.user_id === userId);
    if (index === -1) return null;

    if (key) {
      this.data.friend_memories[index].memory_key = key.trim().slice(0, 100);
    }
    this.data.friend_memories[index].memory_value = value.trim().slice(0, 500);
    this.data.friend_memories[index].updated_at = new Date().toISOString();
    this.saveLocalFallback();
    return this.data.friend_memories[index];
  }

  async deleteMemory(userId: string, id: string): Promise<boolean> {
    if (!this.data.friend_memories) return false;
    const initialLen = this.data.friend_memories.length;
    this.data.friend_memories = this.data.friend_memories.filter((m) => !(m.id === id && m.user_id === userId));
    const deleted = this.data.friend_memories.length < initialLen;
    if (deleted) this.saveLocalFallback();
    return deleted;
  }

  async clearMemories(userId: string): Promise<boolean> {
    if (!this.data.friend_memories) return true;
    this.data.friend_memories = this.data.friend_memories.filter((m) => m.user_id !== userId);
    this.saveLocalFallback();
    return true;
  }

  // --- Admin Tasks ---
  async getAdminTasks(): Promise<DBAdminDailyTask[]> {
    return this.data.admin_tasks || [];
  }
  async saveAdminTask(task: DBAdminDailyTask): Promise<DBAdminDailyTask> {
    if (!this.data.admin_tasks) this.data.admin_tasks = [];
    this.data.admin_tasks.unshift(task);
    this.saveLocalFallback();
    return task;
  }
  async updateAdminTask(id: string, updates: Partial<DBAdminDailyTask>): Promise<DBAdminDailyTask | null> {
    if (!this.data.admin_tasks) return null;
    const idx = this.data.admin_tasks.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    this.data.admin_tasks[idx] = { ...this.data.admin_tasks[idx], ...updates, updated_at: new Date().toISOString() };
    this.saveLocalFallback();
    return this.data.admin_tasks[idx];
  }
  async deleteAdminTask(id: string): Promise<boolean> {
    if (!this.data.admin_tasks) return false;
    const initial = this.data.admin_tasks.length;
    this.data.admin_tasks = this.data.admin_tasks.filter((t) => t.id !== id);
    const deleted = this.data.admin_tasks.length < initial;
    if (deleted) this.saveLocalFallback();
    return deleted;
  }

  // --- Admin Promotions ---
  async getAdminPromotions(): Promise<DBAdminPromotion[]> {
    return this.data.admin_promotions || [];
  }
  async saveAdminPromotion(promo: DBAdminPromotion): Promise<DBAdminPromotion> {
    if (!this.data.admin_promotions) this.data.admin_promotions = [];
    this.data.admin_promotions.unshift(promo);
    this.saveLocalFallback();
    return promo;
  }
  async updateAdminPromotion(id: string, updates: Partial<DBAdminPromotion>): Promise<DBAdminPromotion | null> {
    if (!this.data.admin_promotions) return null;
    const idx = this.data.admin_promotions.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    this.data.admin_promotions[idx] = { ...this.data.admin_promotions[idx], ...updates, updated_at: new Date().toISOString() };
    this.saveLocalFallback();
    return this.data.admin_promotions[idx];
  }
  async deleteAdminPromotion(id: string): Promise<boolean> {
    if (!this.data.admin_promotions) return false;
    const initial = this.data.admin_promotions.length;
    this.data.admin_promotions = this.data.admin_promotions.filter((p) => p.id !== id);
    const deleted = this.data.admin_promotions.length < initial;
    if (deleted) this.saveLocalFallback();
    return deleted;
  }

  // --- Emergency Killswitch ---
  async getEmergencySwitch(): Promise<DBEmergencyKillswitch> {
    return this.data.emergency_switch || { campaigns_disabled: false };
  }
  async setEmergencySwitch(sw: DBEmergencyKillswitch): Promise<DBEmergencyKillswitch> {
    this.data.emergency_switch = sw;
    this.saveLocalFallback();
    return sw;
  }

  // --- Admin Audit Logs (Tamper Protected / Append Only) ---
  async recordAdminAudit(event: DBAdminAuditEvent): Promise<void> {
    if (!this.data.admin_audit_logs) this.data.admin_audit_logs = [];
    this.data.admin_audit_logs.unshift(event);
    this.saveLocalFallback();
  }
  async getAdminAuditLogs(): Promise<DBAdminAuditEvent[]> {
    return this.data.admin_audit_logs || [];
  }

  // --- User Interactions & Promotion Preferences ---
  async getUserTaskInteraction(userId: string, taskId: string): Promise<DBUserTaskInteraction | null> {
    if (!this.data.user_task_interactions) return null;
    return this.data.user_task_interactions.find((i) => i.user_id === userId && i.task_id === taskId) || null;
  }
  async setUserTaskInteraction(userId: string, taskId: string, status: string, reminderEnabled: boolean): Promise<DBUserTaskInteraction> {
    if (!this.data.user_task_interactions) this.data.user_task_interactions = [];
    const idx = this.data.user_task_interactions.findIndex((i) => i.user_id === userId && i.task_id === taskId);
    const interaction: DBUserTaskInteraction = {
      user_id: userId,
      task_id: taskId,
      status,
      reminder_enabled: reminderEnabled,
      updated_at: new Date().toISOString(),
    };
    if (idx >= 0) {
      this.data.user_task_interactions[idx] = interaction;
    } else {
      this.data.user_task_interactions.push(interaction);
    }
    this.saveLocalFallback();
    return interaction;
  }
  async getUserPromotionPreference(userId: string): Promise<boolean> {
    if (!this.data.user_promo_preferences) return false;
    const pref = this.data.user_promo_preferences.find((p) => p.user_id === userId);
    return Boolean(pref?.spoken_promotions_opt_in);
  }
  async setUserPromotionPreference(userId: string, optIn: boolean): Promise<boolean> {
    if (!this.data.user_promo_preferences) this.data.user_promo_preferences = [];
    const idx = this.data.user_promo_preferences.findIndex((p) => p.user_id === userId);
    const pref: DBUserPromotionPreference = {
      user_id: userId,
      spoken_promotions_opt_in: Boolean(optIn),
      updated_at: new Date().toISOString(),
    };
    if (idx >= 0) {
      this.data.user_promo_preferences[idx] = pref;
    } else {
      this.data.user_promo_preferences.push(pref);
    }
    this.saveLocalFallback();
    return Boolean(pref.spoken_promotions_opt_in);
  }
}

export const db = process.env.NODE_ENV === 'production' || getDatabaseUrl()
  ? new PostgresDatabase()
  : new LocalDatabase();

