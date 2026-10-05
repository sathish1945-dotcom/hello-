export type FriendModeState =
  | 'DISABLED'
  | 'STARTING'
  | 'IDLE'
  | 'LISTENING_FOR_WAKE'
  | 'ACTIVE_LISTENING'
  | 'THINKING'
  | 'SPEAKING'
  | 'ERROR';

export type FriendLanguage = 'auto' | 'ta-IN' | 'en-IN' | 'en-US';

export interface FriendModeConfig {
  enabled: boolean;
  language: FriendLanguage;
  floatingEmoji: boolean;
  voice: string;
}

export interface FriendConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface PermissionStatus {
  microphone: 'granted' | 'denied' | 'prompt';
  notifications: 'granted' | 'denied' | 'prompt';
  overlay: 'granted' | 'denied' | 'prompt';
}
