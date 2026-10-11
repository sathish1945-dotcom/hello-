import React, { useState, useEffect } from 'react';
import {
  X,
  Heart,
  Mic,
  MicOff,
  Volume2,
  Sparkles,
  ShieldAlert,
  Radio,
  Settings,
  Layers,
  Check,
  AlertCircle,
  Play,
  Square,
  MessageCircle,
} from 'lucide-react';
import { friendModeBridge } from '../services/friend-mode/FriendModeBridge.ts';
import type { FriendModeState, FriendLanguage, PermissionStatus } from '../services/friend-mode/types.ts';

interface FriendModeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartChat: (prompt: string) => void;
}

export const FriendModeModal: React.FC<FriendModeModalProps> = ({
  isOpen,
  onClose,
  onStartChat,
}) => {
  const [state, setState] = useState<FriendModeState>(friendModeBridge.getState());
  const [language, setLanguage] = useState<FriendLanguage>(friendModeBridge.getLanguage());
  const [floatingEmoji, setFloatingEmoji] = useState<boolean>(friendModeBridge.isFloatingEmojiEnabled());
  const [permissions, setPermissions] = useState<PermissionStatus>({
    microphone: 'prompt',
    notifications: 'prompt',
    overlay: 'prompt',
  });
  const [liveTranscript, setLiveTranscript] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [testSpeechPlaying, setTestSpeechPlaying] = useState(false);
  const isNative = friendModeBridge.isNative();

  useEffect(() => {
    if (!isOpen) return;

    // Subscribe to state changes
    const unsubState = friendModeBridge.onStateChange((s) => {
      setState(s);
      setIsProcessing(s === 'STARTING');
    });

    // Subscribe to transcripts
    const unsubTranscript = friendModeBridge.onTranscript((text) => {
      setLiveTranscript(text);
    });



    // Check permissions
    friendModeBridge.checkPermissions().then(setPermissions);
    friendModeBridge.syncStatus();

    return () => {
      unsubState();
      unsubTranscript();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const isEnabled = state !== 'DISABLED';

  const handleToggleFriendMode = async () => {
    setIsProcessing(true);
    if (isEnabled) {
      await friendModeBridge.disable();
    } else {
      // First ensure permissions
      const perms = await friendModeBridge.checkPermissions();
      if (perms.microphone !== 'granted') {
        const requested = await friendModeBridge.requestPermissions();
        setPermissions(requested);
      }
      await friendModeBridge.enable(language, floatingEmoji);
    }
    setIsProcessing(false);
  };

  const handleLanguageChange = async (newLang: FriendLanguage) => {
    setLanguage(newLang);
    await friendModeBridge.setLanguage(newLang);
  };

  const handleFloatingEmojiToggle = async (enabled: boolean) => {
    setFloatingEmoji(enabled);
    if (enabled && permissions.overlay !== 'granted' && isNative) {
      await friendModeBridge.requestOverlayPermission();
    }
    await friendModeBridge.setFloatingEmoji(enabled);
  };

  const handleRequestMic = async () => {
    const res = await friendModeBridge.requestPermissions();
    setPermissions(res);
  };

  const handleRequestOverlay = async () => {
    if (isNative) {
      await friendModeBridge.requestOverlayPermission();
      const perms = await friendModeBridge.checkPermissions();
      setPermissions(perms);
    }
  };

  const handleTestVoiceSample = () => {
    if (testSpeechPlaying) return;
    setTestSpeechPlaying(true);

    const sample =
      language === 'ta-IN'
        ? 'வணக்கம் மச்சான்! Hello Friend Mode voice test.'
        : 'Hello macha! I am your AI friend on Hello.';

    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const ut = new SpeechSynthesisUtterance(sample);
      ut.lang = language === 'ta-IN' ? 'ta-IN' : 'en-IN';
      ut.onend = () => setTestSpeechPlaying(false);
      ut.onerror = () => setTestSpeechPlaying(false);
      window.speechSynthesis.speak(ut);
    } else {
      setTimeout(() => setTestSpeechPlaying(false), 2000);
    }
  };

  const handleManualWakeTrigger = () => {
    friendModeBridge.triggerWake();
  };

  const getStateBadge = () => {
    switch (state) {
      case 'LISTENING_FOR_WAKE':
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            Listening for "Hello macha"
          </span>
        );
      case 'WAITING_FOR_FINISH':
      case 'ACTIVE_LISTENING':
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            Listening...
          </span>
        );
      case 'THINKING':
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
            Hello AI Thinking...
          </span>
        );
      case 'SPEAKING':
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
            <Volume2 className="w-3 h-3 text-purple-500 animate-bounce" />
            Speaking Response
          </span>
        );
      case 'STARTING':
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border border-zinc-500/20">
            Starting service...
          </span>
        );
      case 'ERROR':
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/20">
            <AlertCircle className="w-3 h-3 text-red-500" />
            Microphone or Service Error
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border border-zinc-500/20">
            <span className="w-2 h-2 rounded-full bg-zinc-400" />
            Disabled
          </span>
        );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex justify-center items-center p-2 sm:p-5"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Friend Mode Settings"
        className="w-full max-w-xl max-h-[92dvh] flex flex-col bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 flex items-center justify-between border-b border-zinc-200/80 dark:border-zinc-800/80">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 text-orange-500 flex items-center justify-center text-xl shadow-xs">
              👋
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-lg text-zinc-900 dark:text-zinc-100">
                  Friend Mode
                </h2>
                {getStateBadge()}
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Always-ready AI friend living on your phone • Wake phrase "Hello macha"
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close Friend Mode dialog"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-xs">
          {/* Main Activation Banner */}
          <div className="p-4 rounded-xl border border-orange-500/20 bg-gradient-to-r from-orange-500/10 via-amber-500/5 to-transparent flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 block">
                {isEnabled ? 'Friend Mode is Active' : 'Friend Mode is Turned Off'}
              </span>
              <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed text-[11px]">
                {isEnabled
                  ? 'Runs in the Android background via foreground service. Say "Hello macha" or tap the floating emoji 👋 to speak.'
                  : 'Enable to start the background foreground service, floating emoji overlay, and native voice listener.'}
              </p>
            </div>
            <button
              type="button"
              disabled={isProcessing}
              onClick={handleToggleFriendMode}
              className={`px-5 py-2.5 rounded-xl font-semibold text-xs transition-all shadow-md shrink-0 flex items-center gap-2 active:scale-95 ${
                isEnabled
                  ? 'bg-zinc-800 hover:bg-zinc-900 text-white dark:bg-zinc-700 dark:hover:bg-zinc-600'
                  : 'bg-orange-600 hover:bg-orange-700 text-white shadow-orange-500/20'
              }`}
            >
              {isEnabled ? (
                <>
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Disable Friend Mode</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Enable Friend Mode</span>
                </>
              )}
            </button>
          </div>

          {/* Wake Phrase & Live Activity Card */}
          <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-orange-500" />
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  Wake Phrase
                </span>
              </div>
              <span className="text-[10px] font-mono text-zinc-400">Offline / Low-Power Engine</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-orange-500/30 text-orange-600 dark:text-orange-400 font-mono font-medium text-xs">
                "Hello macha"
              </span>
              <span className="text-[11px] text-zinc-400">also matches:</span>
              <span className="px-2 py-1 rounded bg-zinc-200/60 dark:bg-zinc-800 font-mono text-[11px]">
                "Hey macha"
              </span>
              <span className="px-2 py-1 rounded bg-zinc-200/60 dark:bg-zinc-800 font-mono text-[11px]">
                "Macha"
              </span>
            </div>

            {isEnabled && (
              <div className="pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-zinc-500 truncate flex-1 min-w-40">
                    {liveTranscript ? `Heard: "${liveTranscript}"` : 'Listening for speech in background...'}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {liveTranscript && state === 'ACTIVE_LISTENING' && (
                      <button
                        type="button"
                        onClick={() => friendModeBridge.answerNow()}
                        className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-orange-600 hover:bg-orange-700 text-white shadow-xs transition-all flex items-center gap-1 animate-pulse"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>Answer Now</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => friendModeBridge.stop()}
                      disabled={state !== 'SPEAKING' && state !== 'THINKING'}
                      className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white shadow-xs transition-all flex items-center gap-1"
                    >
                      <Square className="w-3 h-3 fill-current" />
                      <span>Stop</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => (state === 'IDLE' ? friendModeBridge.resume() : friendModeBridge.pause())}
                      className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors"
                    >
                      {state === 'IDLE' ? 'Resume' : 'Pause'}
                    </button>

                    <button
                      type="button"
                      onClick={handleManualWakeTrigger}
                      className="px-2 py-1 text-[11px] font-medium rounded-lg bg-orange-500/10 hover:bg-orange-500/20 text-orange-600 dark:text-orange-400 transition-colors"
                    >
                      Wake
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Voice & Language Settings */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Language */}
            <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 space-y-2">
              <label className="font-semibold text-zinc-900 dark:text-zinc-100 block">
                Speech Language
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'ta-IN', label: 'தமிழ் (Tamil)' },
                  { id: 'en-IN', label: 'English (IN)' },
                  { id: 'auto', label: 'Auto / Tanglish' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleLanguageChange(item.id as FriendLanguage)}
                    className={`py-2 px-1 text-center rounded-lg border text-[11px] font-medium transition-all ${
                      language === item.id
                        ? 'border-orange-500 bg-orange-500/10 text-orange-600 dark:text-orange-400'
                        : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-white dark:bg-zinc-900'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Voice / TTS */}
            <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 space-y-2">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-zinc-900 dark:text-zinc-100 block">
                  Voice Engine
                </label>
                <button
                  type="button"
                  onClick={handleTestVoiceSample}
                  className="text-[11px] text-orange-600 dark:text-orange-400 hover:underline flex items-center gap-1"
                >
                  <Volume2 className="w-3 h-3" />
                  <span>{testSpeechPlaying ? 'Playing...' : 'Test Voice'}</span>
                </button>
              </div>
              <div className="p-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-[11px] flex items-center justify-between">
                <span className="text-zinc-700 dark:text-zinc-300">Android Native TTS (Free)</span>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                  System Voice
                </span>
              </div>
            </div>
          </div>

          {/* Floating Emoji Toggle */}
          <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  Floating Emoji Overlay (👋)
                </span>
                <span className="text-[10px] font-mono text-zinc-400">SYSTEM_ALERT_WINDOW</span>
              </div>
              <p className="text-[11px] text-zinc-500">
                Draggable overlay remains on screen over other apps when Hello is minimized. Tap to talk, long-press to close.
              </p>
            </div>
            <input
              type="checkbox"
              id="floatingEmojiCheck"
              checked={floatingEmoji}
              onChange={(e) => handleFloatingEmojiToggle(e.target.checked)}
              className="w-4 h-4 rounded text-orange-500 focus:ring-orange-500 shrink-0"
            />
          </div>

          {/* Permissions Status Card */}
          <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 space-y-2">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100 block">
              Required Android Permissions
            </span>
            <div className="grid grid-cols-3 gap-2">
              {/* Mic */}
              <div className="p-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <div className="truncate">
                  <div className="font-medium text-[11px]">Microphone</div>
                  <div className="text-[10px] text-zinc-400">RECORD_AUDIO</div>
                </div>
                {permissions.microphone === 'granted' ? (
                  <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                ) : (
                  <button
                    type="button"
                    onClick={handleRequestMic}
                    className="text-[10px] font-medium text-blue-500 hover:underline shrink-0"
                  >
                    Grant
                  </button>
                )}
              </div>

              {/* Notifications */}
              <div className="p-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <div className="truncate">
                  <div className="font-medium text-[11px]">Notifications</div>
                  <div className="text-[10px] text-zinc-400">Foreground svc</div>
                </div>
                {permissions.notifications === 'granted' ? (
                  <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                ) : (
                  <button
                    type="button"
                    onClick={handleRequestMic}
                    className="text-[10px] font-medium text-blue-500 hover:underline shrink-0"
                  >
                    Grant
                  </button>
                )}
              </div>

              {/* Overlay */}
              <div className="p-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <div className="truncate">
                  <div className="font-medium text-[11px]">Overlay</div>
                  <div className="text-[10px] text-zinc-400">Display over apps</div>
                </div>
                {permissions.overlay === 'granted' ? (
                  <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                ) : (
                  <button
                    type="button"
                    onClick={handleRequestOverlay}
                    className="text-[10px] font-medium text-blue-500 hover:underline shrink-0"
                  >
                    Grant
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Android Persistent Notification Notice */}
          <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-900 dark:text-blue-300 space-y-1">
            <div className="font-semibold text-xs flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              <span>Android Foreground Service Transparency</span>
            </div>
            <p className="text-[11px] leading-relaxed opacity-90">
              When Friend Mode is enabled, Android displays a persistent notification. This is standard Android security
              behavior required whenever an app accesses the microphone or maintains background readiness.
              You can disable Friend Mode at any time directly from the notification or by tapping the floating emoji.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-zinc-200/80 dark:border-zinc-800/80 flex items-center justify-between gap-3 bg-zinc-50/50 dark:bg-zinc-950/50">
          <div className="text-[11px] text-zinc-500">
            {isNative
              ? '📱 Native Android Service Active'
              : '🌐 Running on Web Browser (Web Speech Engine Ready)'}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onStartChat("Hello macha! Let's chat.");
                onClose();
              }}
              className="px-3.5 py-2 text-xs font-medium rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors flex items-center gap-1.5"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>Open in Chat</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 transition-all shadow-xs"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
