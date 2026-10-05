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
import { FeatureNoticeModal, type FeatureNoticeConfig } from './components/FeatureNoticeModal.tsx';
import { logOutGoogle } from './lib/firebase-auth.ts';
import { formatChatToMarkdown, downloadMarkdownFile } from './lib/export-markdown.ts';
import { apiRequest, parseApiError } from './lib/api.ts';
import type {
  User,
  ProviderConnection,
  Chat,
  ChatMessage,
  AiMode,
  TaskCategory,
} from './types/index.ts';

export default function App() {
  // Theme state
  const [darkMode, setDarkMode] = useState(true);

  // Auth & Provider state
  const [user, setUser] = useState<User | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderConnection | null>(null);
  const [isConnectingOpenRouter, setIsConnectingOpenRouter] = useState(false);

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
    fetchCurrentUser();

    // Check URL parameters for OAuth redirects (e.g. mobile full-page redirects)
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const connected = params.get('integration_connected');
      const error = params.get('integration_error');
      if (connected === 'openrouter') {
        fetchProviderStatus();
        setBannerAlert({
          message: 'OpenRouter connected successfully! Free models are ready.',
          type: 'success',
        });
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (connected === 'google-drive') {
        setBannerAlert({
          message: 'Google Drive connected successfully!',
          type: 'success',
        });
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (error) {
        setBannerAlert({
          message: decodeURIComponent(error),
          type: 'error',
        });
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
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

  // Listen for OAuth PKCE postMessage from OpenRouter popup
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.provider === 'openrouter') {
        fetchProviderStatus();
        setIsConnectingOpenRouter(false);
        setBannerAlert({
          message: 'OpenRouter connected successfully! Free models are ready.',
          type: 'success',
        });
        setTimeout(() => setBannerAlert(null), 4000);
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR') {
        setIsConnectingOpenRouter(false);
        setBannerAlert({
          message: event.data?.error || 'Failed to connect OpenRouter. Please try again.',
          type: 'error',
        });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Initiate OpenRouter PKCE Connect Flow
  const handleConnectOpenRouter = async () => {
    if (!user) {
      setIsAuthOpen(true);
      return;
    }

    try {
      setIsConnectingOpenRouter(true);
      const data = await apiRequest<{ url?: string }>('/api/openrouter/connect');
      if (!data.url) {
        throw new Error('No authorization URL returned');
      }

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
      setBannerAlert({
        message: err.message || 'Failed to open OpenRouter authorization window',
        type: 'error',
      });
      setIsConnectingOpenRouter(false);
    }
  };

  const handleDisconnectOpenRouter = async () => {
    try {
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
      await apiRequest('/api/auth/logout', { method: 'POST' });
      await logOutGoogle().catch(() => {});
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
  const handleSendMessage = async (customPrompt?: string) => {
    const promptToSend = customPrompt || input;
    // Synchronous ref guard against duplicate calls, double clicks, and StrictMode double-triggers
    if (!promptToSend.trim() || isStreamingRef.current) return;

    if (!user) {
      setIsAuthOpen(true);
      return;
    }

    if (providerStatus?.connection_status !== 'connected') {
      setBannerAlert({
        message: 'Connect OpenRouter to start chatting.',
        type: 'error',
      });
      setIsSettingsOpen(true);
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
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
                message: `The connection changed. hello is continuing your reply.`,
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
                // Safeguard against providers sending accumulated snapshots rather than deltas
                if (accumulatedText && event.text.startsWith(accumulatedText)) {
                  accumulatedText = event.text;
                } else if (accumulatedText && event.text === accumulatedText) {
                  // Duplicate snapshot: ignore
                } else {
                  accumulatedText += event.text;
                }

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
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={loadChatMessages}
        onNewChat={handleNewChat}
        onDeleteChat={handleDeleteChat}
        onExportChat={handleExportSpecificChat}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenModels={() => setIsModelsOpen(true)}
        onOpenIntegrations={() => setIsIntegrationsOpen(true)}
        onOpenFriendMode={() => setIsFriendModeOpen(true)}
        onOpenTeacherMode={() => setIsTeacherModeOpen(true)}
        onOpenRelationshipSupport={() =>
          setFeatureNotice({
            title: 'Relationship Support',
            tagline: 'Empathetic guidance for communication & boundaries',
            description:
              'Navigate difficult interpersonal conversations, communication patterns, and thoughtful relationship reflections with a supportive AI facilitator.',
            highlights: [
              'Perspective-taking roleplay exercises',
              'De-escalation & boundary phrasing suggestions',
              'Private, confidential journaling space',
            ],
            status: 'In Development',
          })
        }
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
              onOpenHistory={() => setIsSidebarOpen(true)}
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
        onConnectOpenRouter={handleConnectOpenRouter}
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
