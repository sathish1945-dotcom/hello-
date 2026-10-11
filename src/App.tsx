import { hasNewOAuthConnection } from './lib/oauth-status.ts';
import React, { useState, useEffect, useRef } from 'react';
import { Navbar } from './components/Navbar.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { ChatMessageItem } from './components/ChatMessageItem.tsx';
import { ChatInput } from './components/ChatInput.tsx';
import { HomePage } from './components/HomePage.tsx';
import { RoutingIndicator } from './components/RoutingIndicator.tsx';
import { ProviderSettingsModal } from './components/ProviderSettingsModal.tsx';
import { AuthModal } from './components/AuthModal.tsx';
import { IntegrationsModal } from './components/IntegrationsModal.tsx';
import { ModelsModal } from './components/ModelsModal.tsx';
import { FriendModeModal } from './components/FriendModeModal.tsx';
import { TeacherModeModal } from './components/TeacherModeModal.tsx';
import { SchedulingModal } from './components/SchedulingModal.tsx';
import { HistoryModal } from './components/HistoryModal.tsx';
import { AdminPanelModal } from './components/AdminPanelModal.tsx';
import { FeatureNoticeModal, type FeatureNoticeConfig } from './components/FeatureNoticeModal.tsx';
import { auth, logOutGoogle } from './lib/firebase-auth.ts';
import { onAuthStateChanged } from 'firebase/auth';
import { formatChatToMarkdown, downloadMarkdownFile } from './lib/export-markdown.ts';
import { apiRequest, parseApiError, getApiUrl, setStoredAuthToken, getStoredAuthToken, clearStoredAuthToken, parseApiResponse } from './lib/api.ts';
import { friendModeBridge } from './services/friend-mode/FriendModeBridge.ts';
import { Capacitor } from '@capacitor/core';
import { NativeGoogleAuth } from './lib/native-google-auth.ts';
import {
  validateReturnScreen,
  type ReturnScreen,
  type PendingAction,
  type User,
  type ProviderConnection,
  type Chat,
  type ChatMessage,
  type AiMode,
  type TaskCategory,
} from './types/index.ts';

export default function App() {
  // Theme state
  const [darkMode, setDarkMode] = useState(true);

  // Auth & Provider state
  const [user, setUser] = useState<User | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderConnection | null>(null);
  const [isConnectingOpenRouter, setIsConnectingOpenRouter] = useState(false);
  const openRouterPollingRef = useRef<any>(null);
  const authReadyRef = useRef<Promise<void>>(Promise.resolve());
  const inFlightOAuthStatesRef = useRef(new Set<string>());

  // Chat & History state
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [aiMode, setAiMode] = useState<AiMode>('auto');
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  // UI & Drawer state
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isModelsOpen, setIsModelsOpen] = useState(false);
  const [isIntegrationsOpen, setIsIntegrationsOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isFriendModeOpen, setIsFriendModeOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyTab, setHistoryTab] = useState<'conversations' | 'memories'>('conversations');
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [isTeacherModeOpen, setIsTeacherModeOpen] = useState(false);
  const [isSchedulingOpen, setIsSchedulingOpen] = useState(false);
  const [featureNotice, setFeatureNotice] = useState<FeatureNoticeConfig | null>(null);
  const [bannerAlert, setBannerAlert] = useState<{ message: string; type: 'error' | 'info' | 'success' } | null>(null);

  // Streaming & Routing indicator state
  const [isStreaming, setIsStreaming] = useState(false);
  const isStreamingRef = useRef(false);
  const [routingStatus, setRoutingStatus] = useState<'idle' | 'routing' | 'streaming'>('idle');
  const [activeCategory, setActiveCategory] = useState<TaskCategory | undefined>();
  const [isFallbackRoute, setIsFallbackRoute] = useState(false);
  const [activeModelId, setActiveModelId] = useState<string | undefined>();
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Sync dark mode class
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Initial Load: check config, auth, and provider status
  useEffect(() => {
    let nativeListenerHandle: { remove: () => void } | null = null;

    const initializeAppAndRouting = async () => {
      // 1. Restore authenticated user first to avoid unauthenticated /api/openrouter/status races
      authReadyRef.current = fetchCurrentUser();
      await authReadyRef.current;

      // 2. Check pending native deep links on mount (for cold launch / activity recreation)
      await checkPendingNativeDeepLink();
      const pending = getStoredOAuthAttempt();
      if (pending && Date.now() < pending.expiresAt) {
        restoreScreen(pending.returnScreen);
        setIsConnectingOpenRouter(true);
        startPollingOpenRouter(pending.state, pending.returnScreen, pending.pendingAction);
      }
    };

    initializeAppAndRouting();

    // Register real-time native deep link listener (for warm launch / onNewIntent)
    if (Capacitor.isNativePlatform()) {
      NativeGoogleAuth.addListener('appUrlOpen', async (data: { url?: string }) => {
        if (data?.url) {
          await processDeepLinkUrl(data.url);
        }
      }).then((handle) => {
        nativeListenerHandle = handle;
      }).catch((err) => {
        console.warn('[App] Native deep link listener registration:', err);
      });
    }

    // Listen to Firebase auth state: if user is logged into Firebase but backend has no session, exchange ID token automatically
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        const storedToken = getStoredAuthToken();
        if (!storedToken) {
          try {
            const idToken = await fbUser.getIdToken();
            const res = await fetch(getApiUrl('/api/auth/google'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ idToken }),
            });
            const data = await parseApiResponse<{ user: User; token?: string }>(res);
            if (data.token) {
              setStoredAuthToken(data.token);
            }
            setUser(data.user);
            fetchProviderStatus();
            fetchChats();
          } catch (err) {
            console.warn('[App] Background Firebase token sync:', err);
          }
        }
      }
    });

    // Check URL parameters for OAuth redirects (e.g. mobile web full-page redirects)
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const connected = params.get('integration_connected');
      const returnScreen = params.get('return_screen');
      const state = params.get('state') || undefined;
      const error = params.get('integration_error');
      if (connected === 'openrouter') {
        handleOAuthReturn({
          provider: 'openrouter',
          status: 'success',
          returnScreen: returnScreen || undefined,
          state,
        });
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (connected === 'google-drive') {
        setBannerAlert({
          message: 'Google Drive connected successfully!',
          type: 'success',
        });
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (error) {
        handleOAuthReturn({
          provider: 'openrouter',
          status: 'error',
          returnScreen: returnScreen || undefined,
          error: decodeURIComponent(error),
          state,
        });
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }

    return () => {
      unsubscribe();
      if (nativeListenerHandle) {
        nativeListenerHandle.remove();
      }
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const syncSidebar = () => { if (!media.matches) setIsSidebarOpen(false); };
    media.addEventListener('change', syncSidebar);
    return () => media.removeEventListener('change', syncSidebar);
  }, []);

  const fetchCurrentUser = async () => {
    try {
      const data = await apiRequest<{ user: User | null }>('/api/auth/me');
      setUser(data.user);
      if (data.user) {
        fetchProviderStatus();
        fetchChats();
      }
    } catch (err) {
      console.error('Failed to fetch user:', err);
    }
  };


  const fetchProviderStatus = async () => {
    try {
      const data = await apiRequest<{ connected: boolean; updatedAt?: string }>('/api/openrouter/status');
      setProviderStatus({
        id: 'openrouter-status',
        user_id: user?.id || '',
        provider: 'openrouter',
        connection_status: data.connected ? 'connected' : 'disconnected',
        created_at: '',
        updated_at: data.updatedAt || '',
      });
    } catch (err) {
      console.error('Failed to fetch provider status:', err);
    }
  };

  const fetchChats = async () => {
    try {
      const data = await apiRequest<{ chats: Chat[] }>('/api/chats');
      setChats(data.chats || []);
    } catch (err) {
      console.error('Failed to fetch chats:', err);
    }
  };

  const loadChatMessages = async (chatId: string) => {
    try {
      const data = await apiRequest<{ messages: ChatMessage[] }>(`/api/chats/${chatId}`);
      setMessages(data.messages || []);
      setActiveChatId(chatId);
    } catch (err) {
      console.error('Failed to load chat:', err);
    }
  };

  // Scroll to bottom on messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, routingStatus]);

  interface StoredOAuthAttempt {
    state: string;
    returnScreen: ReturnScreen;
    pendingAction?: PendingAction;
    friendModeActiveBeforeNav?: boolean;
    createdAt: number;
    expiresAt: number;
    previousUpdatedAt?: string | null;
  }

  const getStoredOAuthAttempt = (): StoredOAuthAttempt | null => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem('hello_pending_oauth');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return {
        previousUpdatedAt: parsed.previousUpdatedAt,
        state: String(parsed.state || ''),
        returnScreen: validateReturnScreen(parsed.returnScreen),
        pendingAction: parsed.pendingAction,
        friendModeActiveBeforeNav: Boolean(parsed.friendModeActiveBeforeNav),
        createdAt: Number(parsed.createdAt || Date.now()),
        expiresAt: Number(parsed.expiresAt || Date.now() + 10 * 60 * 1000),
      };
    } catch {
      return null;
    }
  };

  const saveStoredOAuthAttempt = (attempt: StoredOAuthAttempt) => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('hello_pending_oauth', JSON.stringify(attempt));
      localStorage.setItem('hello_active_oauth_state', attempt.state);
      localStorage.setItem(`hello_oauth_session_${attempt.state}`, JSON.stringify(attempt));
    } catch {}
  };

  const clearStoredOAuthAttempt = () => {
    if (typeof window === 'undefined') return;
    try {
      const activeState = localStorage.getItem('hello_active_oauth_state');
      if (activeState) {
        localStorage.removeItem(`hello_oauth_session_${activeState}`);
      }
      localStorage.removeItem('hello_active_oauth_state');
      localStorage.removeItem('hello_pending_oauth');
      localStorage.removeItem('hello_pending_return_screen');
    } catch {}
  };

  const processedOAuthStatesRef = useRef<Set<string>>(new Set());
  const handleSendMessageRef = useRef<((prompt?: string, chatId?: string) => Promise<void>) | null>(null);

  const restoreScreen = (targetScreen: ReturnScreen) => {
    setIsSettingsOpen(false);
    setIsFriendModeOpen(false);
    setIsHistoryOpen(false);
    setIsAdminOpen(false);
    setIsTeacherModeOpen(false);
    setIsModelsOpen(false);
    setIsIntegrationsOpen(false);
    setIsSchedulingOpen(false);

    switch (targetScreen) {
      case 'settings':
        setIsSettingsOpen(true);
        break;
      case 'friend-mode':
        setIsFriendModeOpen(true);
        break;
      case 'teacher-mode':
        setIsTeacherModeOpen(true);
        break;
      case 'models':
        setIsModelsOpen(true);
        break;
      case 'integrations':
        setIsIntegrationsOpen(true);
        break;
      case 'scheduling':
        setIsSchedulingOpen(true);
        break;
      case 'chat':
      default:
        break;
    }
  };

  const handleOAuthReturn = async (params: {
    provider?: string;
    status: 'success' | 'error';
    returnScreen?: ReturnScreen | string;
    error?: string;
    state?: string;
    pendingAction?: PendingAction;
  }) => {
    await authReadyRef.current;
    const storedAttempt = getStoredOAuthAttempt();

    // Stale callbacks must not destroy a newer attempt or its destination.
    if (params.state && storedAttempt && storedAttempt.state !== params.state) return;
    if (!storedAttempt) return;

    // Reject expired attempts (>10 minutes)
    if (storedAttempt && Date.now() > storedAttempt.expiresAt) {
      console.warn('[OAuth Return] Stored OAuth attempt has expired');
      setBannerAlert({
        message: 'Authorization attempt expired. Please try connecting again.',
        type: 'error',
      });
      restoreScreen(validateReturnScreen(storedAttempt.returnScreen));
      stopPollingOpenRouter();
      setIsConnectingOpenRouter(false);
      clearStoredOAuthAttempt();
      return;
    }

    // Exactly-once execution guard per attempt/state
    const stateKey = params.state || storedAttempt?.state || `time_${Math.floor(Date.now() / 4000)}`;
    if (processedOAuthStatesRef.current.has(stateKey) || inFlightOAuthStatesRef.current.has(stateKey)) {
      console.log('[OAuth Return] State already processed, skipping duplicate:', stateKey);
      return;
    }
    inFlightOAuthStatesRef.current.add(stateKey);

    const rawTarget = storedAttempt.returnScreen;
    const targetScreen = validateReturnScreen(rawTarget);

    if (params.status === 'error') {
      const errMsg = params.error || 'Authorization was cancelled or rejected by the provider.';
      setBannerAlert({ message: errMsg, type: 'error' });
      restoreScreen(targetScreen);
      processedOAuthStatesRef.current.add(stateKey);
      inFlightOAuthStatesRef.current.delete(stateKey);
      stopPollingOpenRouter();
      setIsConnectingOpenRouter(false);
      clearStoredOAuthAttempt();
      return;
    }

    // Success flow: MUST verify provider connection through authenticated backend before declaring connected
    try {
      const statusData = await apiRequest<{ connected: boolean; updatedAt?: string }>('/api/openrouter/status');
      if (!statusData || !statusData.connected) {
        setBannerAlert({
          message: 'Unable to verify OpenRouter connection with backend. Please retry.',
          type: 'error',
        });
        restoreScreen(targetScreen);
        startPollingOpenRouter(storedAttempt.state, targetScreen, storedAttempt.pendingAction);
        return;
      }

      processedOAuthStatesRef.current.add(stateKey);
      stopPollingOpenRouter();
      setIsConnectingOpenRouter(false);
      setProviderStatus({
        id: 'openrouter-status',
        user_id: user?.id || '',
        provider: 'openrouter',
        connection_status: 'connected',
        created_at: '',
        updated_at: statusData.updatedAt || '',
      });

      setBannerAlert({
        message: 'OpenRouter connected successfully! Free models are ready.',
        type: 'success',
      });
      setTimeout(() => setBannerAlert(null), 4000);

      // Restore originating screen (Friend Mode / Settings / etc.)
      restoreScreen(targetScreen);

      // Restore pending action exactly once
      const pendingAction: PendingAction | undefined =
        storedAttempt.pendingAction;

      if (pendingAction) {
        if (pendingAction.type === 'send_prompt' && pendingAction.prompt) {
          if (targetScreen === 'chat') {
            if (handleSendMessageRef.current) {
              handleSendMessageRef.current(pendingAction.prompt, pendingAction.chatId || undefined);
            } else {
              setInput(pendingAction.prompt);
            }
          } else {
            setInput(pendingAction.prompt);
          }
        }
      }

      clearStoredOAuthAttempt();

      // Safeguard Friend Mode microphone resumption:
      // Resume microphone capture only if Friend Mode remains enabled, permissions allow it and it was active before navigation.
      const currentFriendState = friendModeBridge.getState();
      const wasActiveBefore = Boolean(storedAttempt?.friendModeActiveBeforeNav);

      if (currentFriendState !== 'DISABLED' && wasActiveBefore) {
        const perms = await friendModeBridge.checkPermissions();
        if (perms.microphone === 'granted') {
          console.log('[OAuth Return] Resuming Friend Mode wake listening');
          await friendModeBridge.enable(friendModeBridge.getLanguage(), friendModeBridge.isFloatingEmojiEnabled());
        } else {
          console.log('[OAuth Return] Microphone permission not granted, leaving Friend Mode paused');
        }
      } else {
        console.log('[OAuth Return] Friend Mode disabled or was not active before, respecting state');
      }

    } catch (err: any) {
      if (processedOAuthStatesRef.current.has(stateKey)) return;
      console.warn('[OAuth Return] Verification error:', err);
      setBannerAlert({
        message: 'Failed to verify OpenRouter status. Please check your connection.',
        type: 'error',
      });
      restoreScreen(targetScreen);
      startPollingOpenRouter(storedAttempt.state, targetScreen, storedAttempt.pendingAction);
    } finally {
      inFlightOAuthStatesRef.current.delete(stateKey);
    }
  };

  const processDeepLinkUrl = async (urlStr: string) => {
    try {
      const urlObj = new URL(urlStr.replace(/^hello:\/\//i, 'https://dummy.local/'));
      const provider = urlObj.searchParams.get('provider');
      const status = (urlObj.searchParams.get('status') as 'success' | 'error') || 'success';
      const returnScreen = urlObj.searchParams.get('return_screen') || undefined;
      const state = urlObj.searchParams.get('state') || undefined;
      const error = urlObj.searchParams.get('error') || undefined;
      if (provider === 'openrouter') {
        await handleOAuthReturn({ provider, status, returnScreen, state, error });
      }
    } catch (e) {
      console.warn('[App] Error processing deep link URL:', e);
    }
  };

  const checkPendingNativeDeepLink = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        const res = await NativeGoogleAuth.getPendingDeepLink();
        if (res?.url) {
          await processDeepLinkUrl(res.url);
        }
      } catch (e) {
        console.warn('[App] Error checking pending deep link:', e);
      }
    }
  };

  // Listen for OAuth PKCE postMessage from OpenRouter popup
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.provider === 'openrouter') {
        handleOAuthReturn({
          provider: 'openrouter',
          status: 'success',
          returnScreen: event.data.returnScreen,
          pendingAction: event.data.pendingAction,
          state: event.data.state,
        });
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR' && event.data?.provider === 'openrouter') {
        handleOAuthReturn({
          provider: 'openrouter',
          status: 'error',
          returnScreen: event.data.returnScreen,
          error: event.data.error,
          state: event.data.state,
        });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const stopPollingOpenRouter = () => {
    if (openRouterPollingRef.current) {
      clearInterval(openRouterPollingRef.current);
      openRouterPollingRef.current = null;
    }
  };

  const startPollingOpenRouter = (expectedState?: string, returnScreen?: ReturnScreen, pendingAction?: PendingAction) => {
    stopPollingOpenRouter();
    let attempts = 0;
    const maxAttempts = 90; // 3 minutes total (poll every 2s)

    openRouterPollingRef.current = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        stopPollingOpenRouter();
        setIsConnectingOpenRouter(false);
        return;
      }

      try {
        const data = await apiRequest<{ connected: boolean; updatedAt?: string }>('/api/openrouter/status');
        if (hasNewOAuthConnection(data, getStoredOAuthAttempt())) {
          const attempt = getStoredOAuthAttempt();
          await handleOAuthReturn({
            provider: 'openrouter',
            status: 'success',
            state: expectedState || attempt?.state,
            returnScreen: returnScreen || attempt?.returnScreen,
            pendingAction: pendingAction || attempt?.pendingAction,
          });
        }
      } catch {
        // ignore network hiccups while polling
      }
    }, 2000);
  };

  // Re-check OpenRouter connection status and deep links when window regains focus or app resumes
  useEffect(() => {
    const handleVisibilityOrFocus = async () => {
      await checkPendingNativeDeepLink();
      if (isConnectingOpenRouter) {
        try {
          const data = await apiRequest<{ connected: boolean; updatedAt?: string }>('/api/openrouter/status');
          if (hasNewOAuthConnection(data, getStoredOAuthAttempt())) {
            const attempt = getStoredOAuthAttempt();
            await handleOAuthReturn({
              provider: 'openrouter',
              status: 'success',
              state: attempt?.state,
              returnScreen: attempt?.returnScreen,
              pendingAction: attempt?.pendingAction,
            });
          }
        } catch (_) {}
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    return () => {
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [isConnectingOpenRouter, user]);

  useEffect(() => {
    return () => {
      stopPollingOpenRouter();
    };
  }, []);

  // Initiate OpenRouter PKCE Connect Flow with Originating Screen & Pending Action preservation
  const handleConnectOpenRouter = async (
    explicitReturnScreen?: ReturnScreen,
    explicitPendingAction?: PendingAction
  ) => {
    if (!user) {
      setIsAuthOpen(true);
      return;
    }

    let returnScreen: ReturnScreen = explicitReturnScreen || 'chat';
    if (!explicitReturnScreen) {
      if (isFriendModeOpen) returnScreen = 'friend-mode';
      else if (isTeacherModeOpen) returnScreen = 'teacher-mode';
      else if (isModelsOpen) returnScreen = 'models';
      else if (isIntegrationsOpen) returnScreen = 'integrations';
      else if (isSchedulingOpen) returnScreen = 'scheduling';
      else if (isSettingsOpen) returnScreen = 'settings';
      else returnScreen = 'chat';
    }

    let pendingAction = explicitPendingAction;
    if (!pendingAction && returnScreen === 'chat' && input.trim()) {
      pendingAction = {
        type: 'send_prompt',
        prompt: input.trim(),
        chatId: activeChatId,
      };
    } else if (!pendingAction && returnScreen === 'friend-mode') {
      pendingAction = {
        type: 'resume_friend_mode',
      };
    }

    const friendModeActiveBeforeNav = friendModeBridge.getState() !== 'DISABLED';

    try {
      setIsConnectingOpenRouter(true);
      const params = new URLSearchParams();
      params.set('platform', Capacitor.isNativePlatform() ? 'android' : 'web');
      if (returnScreen) params.set('return_screen', returnScreen);
      if (pendingAction) params.set('pending_action', JSON.stringify(pendingAction));
      const queryString = params.toString() ? `?${params.toString()}` : '';

      let data: {
        url?: string;
        state?: string;
        previousUpdatedAt?: string | null;
        returnScreen?: ReturnScreen;
      };

      try {
        data = await apiRequest<{
          url?: string;
          state?: string;
          previousUpdatedAt?: string | null;
          returnScreen?: ReturnScreen;
        }>(`/api/openrouter/connect${queryString}`, {
          method: 'GET',
        });
      } catch (err: any) {
        if (err?.status === 404 || err?.status === 405) {
          data = await apiRequest<{
            url?: string;
            state?: string;
          previousUpdatedAt?: string | null;
            returnScreen?: ReturnScreen;
          }>('/api/openrouter/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              returnScreen,
              platform: Capacitor.isNativePlatform() ? 'android' : 'web',
              pendingAction,
            }),
          });
        } else {
          throw err;
        }
      }

      if (!data.url) {
        throw new Error('No authorization URL returned');
      }

      if (data.state && typeof window !== 'undefined') {
        const canonicalTarget = validateReturnScreen(data.returnScreen || returnScreen);
        saveStoredOAuthAttempt({
          state: data.state,
          returnScreen: canonicalTarget,
          pendingAction,
          friendModeActiveBeforeNav,
          previousUpdatedAt: data.previousUpdatedAt,
          createdAt: Date.now(),
          expiresAt: Date.now() + 10 * 60 * 1000,
        });
      }

      // If running as native Android/iOS Capacitor app, open system browser
      if (Capacitor.isNativePlatform()) {
        await NativeGoogleAuth.openSystemUrl({ url: data.url });
        startPollingOpenRouter(data.state, returnScreen, pendingAction);
        return;
      }

      startPollingOpenRouter(data.state, returnScreen, pendingAction);
      const isMobile = typeof window !== 'undefined' && (window.innerWidth < 640 || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
      if (isMobile) {
        window.location.href = data.url;
        return;
      }

      const popup = window.open(
        data.url,
        'openrouter_oauth_popup',
        'width=600,height=750,menubar=no,toolbar=no,location=no,status=no'
      );

      if (!popup) {
        window.location.href = data.url;
      }
    } catch (err: any) {
      console.error('OpenRouter connect error:', err);
      stopPollingOpenRouter();
      setBannerAlert({
        message: err.message || 'Failed to open OpenRouter authorization window',
        type: 'error',
      });
      setIsConnectingOpenRouter(false);
    }
  };

  const handleDisconnectOpenRouter = async () => {
    try {
      stopPollingOpenRouter();
      setIsConnectingOpenRouter(false);
      await apiRequest('/api/openrouter/disconnect', { method: 'POST' });
      fetchProviderStatus();
      setBannerAlert({
        message: 'OpenRouter account disconnected.',
        type: 'info',
      });
      setTimeout(() => setBannerAlert(null), 3000);
    } catch (err: any) {
      console.error('Failed to disconnect:', err);
    }
  };

  const handleLogout = async () => {
    try {
      if (isStreaming || isStreamingRef.current) {
        handleStopStreaming();
      }
      friendModeBridge.cancelPendingSpeech();
      await friendModeBridge.disable();
      await apiRequest('/api/auth/logout', { method: 'POST' });
      await logOutGoogle().catch(() => {});
      clearStoredAuthToken();
      setUser(null);
      setProviderStatus(null);
      setChats([]);
      setActiveChatId(null);
      setMessages([]);
      setSelectedModelId(null);

    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const handleNewChat = () => {
    if (isStreaming || isStreamingRef.current) {
      handleStopStreaming();
    }
    setActiveChatId(null);
    setMessages([]);
    setInput('');
    setRoutingStatus('idle');
    setActiveCategory(undefined);
    setIsFallbackRoute(false);
    setActiveModelId(undefined);
  };

  const handleDeleteChat = async (chatId: string) => {
    try {
      await apiRequest(`/api/chats/${chatId}`, { method: 'DELETE' });
      setChats((prev) => prev.filter((c) => c.id !== chatId));
      if (activeChatId === chatId) {
        handleNewChat();
      }
    } catch (err) {
      console.error('Failed to delete chat:', err);
    }
  };

  const handleExportCurrentChat = () => {
    if (messages.length === 0) return;
    const currentChat = chats.find((c) => c.id === activeChatId);
    const title = currentChat?.title || messages[0]?.content?.slice(0, 30) || 'hello Chat';
    const markdown = formatChatToMarkdown(title, messages);
    const sanitizedFilename = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'modelmesh-chat';

    downloadMarkdownFile(markdown, `${sanitizedFilename}.md`);
    setBannerAlert({
      message: `Chat conversation exported as ${sanitizedFilename}.md`,
      type: 'success',
    });
    setTimeout(() => setBannerAlert(null), 3000);
  };

  const handleExportSpecificChat = async (chatId: string) => {
    try {
      let targetMessages = messages;
      let targetTitle = chats.find((c) => c.id === chatId)?.title || 'hello Chat';

      if (chatId !== activeChatId) {
        const data = await apiRequest<{ messages: ChatMessage[] }>(`/api/chats/${chatId}`);
        targetMessages = data.messages || [];
      }

      if (targetMessages.length === 0) {
        setBannerAlert({
          message: 'This conversation has no messages to export.',
          type: 'info',
        });
        setTimeout(() => setBannerAlert(null), 3000);
        return;
      }

      const markdown = formatChatToMarkdown(targetTitle, targetMessages);
      const sanitizedFilename = targetTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'modelmesh-chat';

      downloadMarkdownFile(markdown, `${sanitizedFilename}.md`);
      setBannerAlert({
        message: `Chat exported as ${sanitizedFilename}.md`,
        type: 'success',
      });
      setTimeout(() => setBannerAlert(null), 3000);
    } catch (err) {
      console.error('Export error:', err);
      setBannerAlert({
        message: 'Failed to export chat conversation',
        type: 'error',
      });
      setTimeout(() => setBannerAlert(null), 3000);
    }
  };

  const handleStopStreaming = () => {
    isStreamingRef.current = false;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setRoutingStatus('idle');
  };

  // Main Prompt Submission & SSE Streaming
  const handleSendMessage = async (customPrompt?: string, targetChatId?: string) => {
    const promptToSend = customPrompt || input;
    // Synchronous ref guard against duplicate calls, double clicks, and StrictMode double-triggers
    if (!promptToSend.trim() || isStreamingRef.current) return;

    if (!user) {
      setIsAuthOpen(true);
      return;
    }

    const currentChatId = targetChatId || activeChatId;

    if (providerStatus?.connection_status !== 'connected') {
      setBannerAlert({
        message: 'Connect OpenRouter to start chatting.',
        type: 'error',
      });
      handleConnectOpenRouter('chat', {
        type: 'send_prompt',
        prompt: promptToSend.trim(),
        chatId: currentChatId,
      });
      return;
    }

    // Abort any previous running stream reader before starting a new one
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    isStreamingRef.current = true;
    setIsStreaming(true);
    setRoutingStatus('routing');
    setActiveCategory(undefined);
    setIsFallbackRoute(false);
    setActiveModelId(undefined);
    setInput('');

    const assistantMsgId = `assistant-${Date.now()}`;
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      chat_id: activeChatId || 'temp',
      role: 'user',
      content: promptToSend.trim(),
      created_at: new Date().toISOString(),
    };

    const assistantMsgPlaceholder: ChatMessage = {
      id: assistantMsgId,
      chat_id: activeChatId || 'temp',
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg, assistantMsgPlaceholder]);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    let accumulatedText = '';

    try {
      const response = await fetch(getApiUrl('/api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          prompt: promptToSend.trim(),
          chatId: activeChatId,
          aiMode,
          modelId: selectedModelId || undefined,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorInfo = await parseApiError(response, 'Failed to send prompt');
        if (errorInfo.code === 'OPENROUTER_NOT_CONNECTED') {
          setBannerAlert({
            message: 'Connect OpenRouter to start chatting.',
            type: 'error',
          });
          setIsSettingsOpen(true);
        } else {
          setBannerAlert({
            message: errorInfo.message,
            type: 'error',
          });
        }
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No readable stream from server');

      const decoder = new TextDecoder('utf-8');
      let streamBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        streamBuffer += decoder.decode(value, { stream: true });
        const lines = streamBuffer.split('\n');
        streamBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6).trim();

          try {
            const event = JSON.parse(jsonStr);

            if (event.type === 'classification') {
              setActiveCategory(event.category);
            } else if (event.type === 'routing') {
              setRoutingStatus('streaming');
              setActiveCategory(event.category);
              setActiveModelId(event.modelId);
              if (event.chatId && !activeChatId) {
                setActiveChatId(event.chatId);
                fetchChats();
              }
              setMessages((prev) => {
                const lastIndex = prev.length - 1;
                if (lastIndex < 0) return prev;
                const last = prev[lastIndex];
                if (last.role !== 'assistant' || last.id !== assistantMsgId) return prev;
                return [
                  ...prev.slice(0, lastIndex),
                  {
                    ...last,
                    model_category: event.category,
                    model_id: event.modelId,
                  },
                ];
              });
            } else if (event.type === 'fallback_switch') {
              setIsFallbackRoute(true);
              setActiveModelId(event.activeModel);
              setMessages((prev) => prev.map((message) => message.id === assistantMsgId ? { ...message, model_id: event.activeModel } : message));
              if (event.resetContent) {
                accumulatedText = '';
                setMessages((prev) => {
                  const lastIndex = prev.length - 1;
                  if (lastIndex < 0) return prev;
                  const last = prev[lastIndex];
                  if (last.role !== 'assistant' || last.id !== assistantMsgId) return prev;
                  return [
                    ...prev.slice(0, lastIndex),
                    { ...last, content: '' },
                  ];
                });
              }
              setBannerAlert({
                message: `Trying another available AI…`,
                type: 'info',
              });
              setTimeout(() => setBannerAlert(null), 3000);
            } else if (event.type === 'tool_requirement') {
              setMessages((prev) => {
                const lastIndex = prev.length - 1;
                if (lastIndex < 0) return prev;
                const last = prev[lastIndex];
                if (last.role !== 'assistant' || last.id !== assistantMsgId) return prev;
                return [
                  ...prev.slice(0, lastIndex),
                  {
                    ...last,
                    toolRequirement: {
                      providers: event.unconnectedProviders || [],
                      message: event.message || 'Please connect required developer tools in the Tools panel.',
                    },
                  },
                ];
              });
            } else if (event.type === 'action_proposal') {
              setMessages((prev) => {
                const lastIndex = prev.length - 1;
                if (lastIndex < 0) return prev;
                const last = prev[lastIndex];
                if (last.role !== 'assistant' || last.id !== assistantMsgId) return prev;
                return [
                  ...prev.slice(0, lastIndex),
                  {
                    ...last,
                    proposal: event.proposal,
                  },
                ];
              });
            } else if (event.type === 'chunk') {
              if (typeof event.text === 'string' && event.text.length > 0) {
                // The server normalizes provider output into incremental text.
                accumulatedText += event.text;

                const currentText = accumulatedText;
                // Pure immutable update - immune to React StrictMode double invocation!
                setMessages((prev) => {
                  const lastIndex = prev.length - 1;
                  if (lastIndex < 0) return prev;
                  const last = prev[lastIndex];
                  if (last.role !== 'assistant' || last.id !== assistantMsgId) return prev;
                  if (last.content === currentText) return prev;
                  return [
                    ...prev.slice(0, lastIndex),
                    {
                      ...last,
                      content: currentText,
                    },
                  ];
                });
              }
            } else if (event.type === 'done') {
              isStreamingRef.current = false;
              setIsStreaming(false);
              setRoutingStatus('idle');
              if (event.chatId) {
                setActiveChatId(event.chatId);
                fetchChats();
              }
              const finalContent = accumulatedText;
              setMessages((prev) => {
                const lastIndex = prev.length - 1;
                if (lastIndex < 0) return prev;
                const last = prev[lastIndex];
                if (last.role !== 'assistant' || last.id !== assistantMsgId) return prev;
                return [
                  ...prev.slice(0, lastIndex),
                  {
                    ...last,
                    id: event.messageId || last.id,
                    model_category: event.category || last.model_category,
                    model_id: event.modelId || last.model_id,
                    content: finalContent,
                  },
                ];
              });
            } else if (event.type === 'error') {
              setBannerAlert({
                message: event.error,
                type: 'error',
              });
              const errorContent = `⚠️ ${event.error}`;
              setMessages((prev) => {
                const lastIndex = prev.length - 1;
                if (lastIndex < 0) return prev;
                const last = prev[lastIndex];
                if (last.role !== 'assistant' || last.id !== assistantMsgId) return prev;
                return [
                  ...prev.slice(0, lastIndex),
                  {
                    ...last,
                    content: errorContent,
                  },
                ];
              });
              isStreamingRef.current = false;
              setIsStreaming(false);
              setRoutingStatus('idle');
            }
          } catch {
            // Ignore non-json chunk lines
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Chat stream error:', err);
        setBannerAlert({
          message: 'Network issue or connection interrupted. Please try again.',
          type: 'error',
        });
      }
    } finally {
      isStreamingRef.current = false;
      setIsStreaming(false);
      setRoutingStatus('idle');
      abortControllerRef.current = null;
    }
  };

  useEffect(() => {
    handleSendMessageRef.current = handleSendMessage;
  });

  const handleRegenerate = () => {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMessage) {
      handleSendMessage(lastUserMessage.content);
    }
  };

  const isConnected = providerStatus?.connection_status === 'connected';

  return (
    <div className="hello-app flex h-[100dvh] w-full overflow-hidden bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans transition-colors">
      {/* Sidebar (History & Drawer) */}
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onNewChat={handleNewChat}
        onOpenHistory={() => {
          setHistoryTab('conversations');
          setIsHistoryOpen(true);
        }}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenModels={() => setIsModelsOpen(true)}
        onOpenIntegrations={() => setIsIntegrationsOpen(true)}
        onOpenFriendMode={() => setIsFriendModeOpen(true)}
        onOpenTeacherMode={() => setIsTeacherModeOpen(true)}
        onOpenProjects={() =>
          setFeatureNotice({
            title: 'Projects & Knowledge Hub',
            tagline: 'Multi-document context & dedicated project spaces',
            description:
              'Group your research, documents, repositories, and custom prompt directives into organized project folders with dedicated memory.',
            highlights: [
              'Document ingestion & vector retrieval',
              'Custom system instructions per project',
              'Cross-document synthesis and code analysis',
            ],
            status: 'In Development',
          })
        }
        onOpenScheduling={() => setIsSchedulingOpen(true)}
        onOpenPlugins={() => setIsIntegrationsOpen(true)}
        onOpenAdmin={() => setIsAdminOpen(true)}
        onOpenAuth={() => setIsAuthOpen(true)}
        onLogout={handleLogout}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
        darkMode={darkMode}
        user={user}
      />

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative">
        {/* Top Navbar */}
        <Navbar
          user={user}
          onNewChat={handleNewChat}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenIntegrations={() => setIsIntegrationsOpen(true)}
          onExportMarkdown={handleExportCurrentChat}
          hasMessagesToExport={messages.length > 0}
          onOpenAuth={() => setIsAuthOpen(true)}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          isSidebarOpen={isSidebarOpen}
        />

        {/* Global Banner Notification */}
        {bannerAlert && (
          <div
            className={`py-2 px-4 text-xs font-medium text-center transition-all flex items-center justify-center gap-2 ${
              bannerAlert.type === 'error'
                ? 'bg-red-500/10 text-red-700 dark:text-red-400 border-b border-red-500/20'
                : bannerAlert.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-b border-emerald-500/20'
                : 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-b border-blue-500/20'
            }`}
          >
            <span>{bannerAlert.message}</span>
            <button
              onClick={() => setBannerAlert(null)}
              className="ml-2 text-current opacity-70 hover:opacity-100 font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* Chat Scroll Area */}
        <div className={`flex-1 min-h-0 overflow-y-auto overscroll-contain ${messages.length === 0 ? "bg-[#020f1b]" : ""}`} role="main">
          {messages.length === 0 ? (
            <HomePage
              conversations={chats}
              onSelectConversation={loadChatMessages}
              onNewChat={(prompt = '') => { handleNewChat(); setInput(prompt); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea')?.focus()); }}
              onOpenSetup={() => setIsIntegrationsOpen(true)}
              onOpenHistory={() => {
                setHistoryTab('conversations');
                setIsHistoryOpen(true);
              }}
              onOpenFriendMode={() => setIsFriendModeOpen(true)}
              onOpenTeacherMode={() => setIsTeacherModeOpen(true)}
              onOpenScheduling={() => setIsSchedulingOpen(true)}
              onOpenFeatureNotice={(feat) => setFeatureNotice(feat)}
            />
          ) : (
            <div className="max-w-3xl mx-auto px-2 sm:px-4 py-4 space-y-1">
              {messages.map((msg, index) => {
                const isLastAssistant =
                  msg.role === 'assistant' && index === messages.length - 1;
                return (
                  <ChatMessageItem
                    key={msg.id || index}
                    message={msg}
                    isStreaming={isStreaming && isLastAssistant}
                    onRegenerate={handleRegenerate}
                    isLastAssistantMessage={isLastAssistant}
                    onOpenIntegrations={() => setIsIntegrationsOpen(true)}
                  />
                );
              })}

              {/* Dynamic Routing / Model Indicator during generation */}
              <RoutingIndicator
                status={routingStatus}
              />

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Bottom Input Area */}
        <ChatInput
          input={input}
          setInput={setInput}
          onSend={() => handleSendMessage()}
          onStop={handleStopStreaming}
          onNewChat={handleNewChat}
          isStreaming={isStreaming}
          disabled={false}
        />
      </div>

      {/* Provider Settings Modal */}
      <ProviderSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        providerStatus={providerStatus}
        onConnectOpenRouter={() => handleConnectOpenRouter('settings')}
        onDisconnectOpenRouter={handleDisconnectOpenRouter}
        isConnecting={isConnectingOpenRouter}
        onOpenIntegrations={() => setIsIntegrationsOpen(true)}
      />

      <ModelsModal isOpen={isModelsOpen} onClose={() => setIsModelsOpen(false)} selectedModelId={selectedModelId} onSelectModel={(id) => { setSelectedModelId(id); setAiMode('auto'); }} isConnected={isConnected} />

      {/* Developer Integrations & Plugins Modal */}
      <IntegrationsModal
        isOpen={isIntegrationsOpen}
        onClose={() => setIsIntegrationsOpen(false)}
        onOpenAuth={() => setIsAuthOpen(true)}
        isAuthenticated={Boolean(user)}
      />

      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onAuthSuccess={(u) => {
          setUser(u);
          fetchProviderStatus();
          fetchChats();
        }}
      />

      {/* Friend Mode Modal */}
      <FriendModeModal
        isOpen={isFriendModeOpen}
        onClose={() => setIsFriendModeOpen(false)}
        onStartChat={(prompt) => {
          handleNewChat();
          setInput(prompt);
          requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea')?.focus());
        }}
        onConnectOpenRouter={() => handleConnectOpenRouter('friend-mode', { type: 'resume_friend_mode' })}
        isOpenRouterConnected={providerStatus?.provider === 'openrouter' && providerStatus?.connection_status === 'connected'}
      />

      {/* History (Conversations & My Memories) Modal */}
      <HistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={(id) => {
          loadChatMessages(id);
          setIsHistoryOpen(false);
        }}
        onDeleteChat={handleDeleteChat}
        onExportChat={handleExportSpecificChat}
        user={user}
        defaultTab={historyTab}
      />

      {/* Founder Admin Panel Modal (Sathish) */}
      <AdminPanelModal
        isOpen={isAdminOpen}
        onClose={() => setIsAdminOpen(false)}
        user={user}
      />

      {/* Teacher Mode Modal */}
      <TeacherModeModal
        isOpen={isTeacherModeOpen}
        onClose={() => setIsTeacherModeOpen(false)}
        onStartChat={(prompt) => {
          handleNewChat();
          setInput(prompt);
          requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea')?.focus());
        }}
      />

      {/* Scheduling Modal */}
      <SchedulingModal
        isOpen={isSchedulingOpen}
        onClose={() => setIsSchedulingOpen(false)}
        onStartChat={(prompt) => {
          handleNewChat();
          setInput(prompt);
          requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea')?.focus());
        }}
      />

      {/* Feature Notice / Roadmap Modal */}
      <FeatureNoticeModal
        isOpen={Boolean(featureNotice)}
        onClose={() => setFeatureNotice(null)}
        feature={featureNotice}
      />


    </div>
  );
}
