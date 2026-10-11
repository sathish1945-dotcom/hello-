export type TaskCategory = 'general' | 'coding' | 'reasoning' | 'finance';

export type AiMode = 'auto' | TaskCategory;

export interface User {
  id: string;
  email: string;
  name: string;
  auth_provider: 'email' | 'google';
  role?: 'user' | 'admin' | string;
  created_at: string;
}

export type IntegrationProvider = 'openrouter' | 'github' | 'vercel' | 'supabase' | 'google-drive';

export interface ProviderConnection {
  id: string;
  user_id: string;
  provider: IntegrationProvider;
  provider_account_id?: string;
  account_username?: string;
  scopes?: string;
  connection_status: 'connected' | 'disconnected' | 'error';
  token_expiry?: string;
  created_at: string;
  updated_at: string;
}

export type PermissionLevel = 'READ' | 'WRITE' | 'DANGEROUS';

export interface ConnectorCapability {
  name: string;
  description: string;
  permissionLevel: PermissionLevel;
  requiresConfirmation?: boolean;
}

export interface AuditLogEntry {
  id: string;
  user_id: string;
  provider: IntegrationProvider;
  action: string;
  resource?: string;
  permission_level: PermissionLevel;
  status: 'success' | 'failed' | 'denied' | 'pending_confirmation';
  approval_status?: 'auto_approved' | 'user_confirmed' | 'rejected';
  details?: Record<string, any>;
  created_at: string;
}

export interface ActionProposal {
  id: string;
  provider: IntegrationProvider;
  action: string;
  description: string;
  permissionLevel: PermissionLevel;
  params: Record<string, any>;
  status: 'pending' | 'confirmed' | 'rejected' | 'executed' | 'failed';
  result?: any;
  error?: string;
  created_at: string;
}

export interface IntegrationSummary {
  provider: IntegrationProvider;
  displayName: string;
  description: string;
  icon: string;
  connectionStatus: 'connected' | 'disconnected' | 'error' | 'expired' | 'coming_soon';
  accountUsername?: string;
  connectedAt?: string;
  capabilities: ConnectorCapability[];
  metadata?: Record<string, any>;
  comingSoon?: boolean;
}

export interface Chat {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at?: string;
}

export interface ChatMessage {
  id: string;
  chat_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model_category?: TaskCategory;
  model_id?: string;
  proposal?: ActionProposal;
  toolRequirement?: { providers: string[]; message: string };
  created_at: string;
}

export interface ClassificationResult {
  category: TaskCategory;
  confidence: number;
  reason: string;
}

export interface RouteResolution {
  category: TaskCategory;
  selectedModel: string;
  fallbackModels: string[];
  displayName: string;
}

export const ALLOWED_RETURN_SCREENS = [
  'chat',
  'settings',
  'friend-mode',
  'teacher-mode',
  'models',
  'integrations',
  'scheduling',
] as const;

export type ReturnScreen = typeof ALLOWED_RETURN_SCREENS[number];

export function validateReturnScreen(rawScreen: unknown): ReturnScreen {
  if (typeof rawScreen === 'string' && (ALLOWED_RETURN_SCREENS as readonly string[]).includes(rawScreen.trim())) {
    return rawScreen.trim() as ReturnScreen;
  }
  return 'chat';
}

export interface PendingAction {
  type: 'send_prompt' | 'open_modal' | 'resume_friend_mode' | 'none';
  prompt?: string;
  chatId?: string | null;
  screen?: ReturnScreen;
}

export interface FriendMemory {
  id: string;
  user_id: string;
  memory_key: string;
  memory_value: string;
  created_at: string;
  updated_at: string;
}


