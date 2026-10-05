import { Capacitor, registerPlugin } from '@capacitor/core';
import type { FriendModeState, FriendLanguage, PermissionStatus } from './types.ts';
import { friendAgent } from './FriendAgent.ts';

interface NativeFriendModePlugin {
  getStatus(): Promise<{
    enabled: boolean;
    state: FriendModeState;
    hasOverlayPermission: boolean;
    isNative: boolean;
  }>;
  enableFriendMode(options: { language: string; floatingEmoji: boolean }): Promise<{ success: boolean; state: FriendModeState }>;
  disableFriendMode(): Promise<{ success: boolean; state: FriendModeState }>;
  triggerWake(): Promise<{ success: boolean }>;
  speakResponse(options: { text: string }): Promise<{ success: boolean }>;
  setLanguage(options: { language: string }): Promise<{ success: boolean; language: string }>;
  setFloatingEmoji(options: { enabled: boolean }): Promise<{ success: boolean; floatingEmoji: boolean }>;
  checkPermissions(): Promise<{ microphone: string; notifications: string; overlay: string }>;
  requestPermissions(): Promise<{ microphone: string; notifications: string; overlay: string }>;
  requestOverlayPermission(): Promise<{ granted: boolean }>;
  addListener(eventName: string, listenerFunc: (data: any) => void): Promise<any>;
  removeAllListeners(): Promise<void>;
}

const NativeFriendMode = registerPlugin<NativeFriendModePlugin>('FriendMode');

export class FriendModeBridge {
  private static instance: FriendModeBridge;
  private state: FriendModeState = 'DISABLED';
  private language: FriendLanguage = 'ta-IN';
  private floatingEmoji: boolean = true;
  private listeners: Set<(state: FriendModeState) => void> = new Set();
  private transcriptListeners: Set<(text: string, isFinal: boolean) => void> = new Set();

  // Web Speech fallback variables
  private webRecognition: any = null;
  private isWebListening: boolean = false;

  private constructor() {
    this.initNativeListeners();
    this.loadPersistedConfig();
  }

  public static getInstance(): FriendModeBridge {
    if (!FriendModeBridge.instance) {
      FriendModeBridge.instance = new FriendModeBridge();
    }
    return FriendModeBridge.instance;
  }

  public isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  private loadPersistedConfig() {
    try {
      const saved = localStorage.getItem('hello_friend_mode_active');
      const lang = localStorage.getItem('hello_friend_mode_language') as FriendLanguage;
      const emoji = localStorage.getItem('hello_friend_mode_emoji');

      if (lang) this.language = lang;
      if (emoji !== null) this.floatingEmoji = emoji === 'true';

      if (saved === 'true') {
        // Auto-reconnect status
        this.syncStatus();
      }
    } catch {
      // Ignore storage errors
    }
  }

  private async initNativeListeners() {
    if (!this.isNative()) return;

    try {
      await NativeFriendMode.addListener('stateChange', (data: { state: FriendModeState }) => {
        this.setState(data.state);
      });

      await NativeFriendMode.addListener('wakeWordDetected', (data: { phrase: string }) => {
        console.log('Native wake word detected:', data.phrase);
        this.notifyTranscript(`[Wake Phrase: ${data.phrase}]`, true);
      });

      await NativeFriendMode.addListener('speechRecognized', (data: { text: string; isFinal: boolean }) => {
        this.notifyTranscript(data.text, data.isFinal);
      });

      await NativeFriendMode.addListener('speechCompleted', async (data: { text: string }) => {
        this.notifyTranscript(data.text, true);
        this.setState('THINKING');

        // Pass to FriendAgent to query Hello AI model router
        const reply = await friendAgent.processMessage(data.text);

        // Instruct native service to speak reply via Android TTS
        await NativeFriendMode.speakResponse({ text: reply });
      });

      await NativeFriendMode.addListener('error', (data: { error: string }) => {
        console.warn('Native Friend Mode error:', data.error);
        this.setState('ERROR');
      });
    } catch (err) {
      console.warn('Could not register native listeners:', err);
    }
  }

  public async syncStatus(): Promise<FriendModeState> {
    if (this.isNative()) {
      try {
        const status = await NativeFriendMode.getStatus();
        this.state = status.state;
        this.notifyState();
        return this.state;
      } catch (e) {
        console.warn('Failed to sync native status:', e);
      }
    }
    return this.state;
  }

  public getState(): FriendModeState {
    return this.state;
  }

  public getLanguage(): FriendLanguage {
    return this.language;
  }

  public isFloatingEmojiEnabled(): boolean {
    return this.floatingEmoji;
  }

  public onStateChange(callback: (state: FriendModeState) => void): () => void {
    this.listeners.add(callback);
    callback(this.state);
    return () => this.listeners.delete(callback);
  }

  public onTranscript(callback: (text: string, isFinal: boolean) => void): () => void {
    this.transcriptListeners.add(callback);
    return () => this.transcriptListeners.delete(callback);
  }

  private setState(newState: FriendModeState) {
    this.state = newState;
    this.notifyState();
  }

  private notifyState() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private notifyTranscript(text: string, isFinal: boolean) {
    for (const listener of this.transcriptListeners) {
      listener(text, isFinal);
    }
  }

  public async enable(language?: FriendLanguage, floatingEmoji?: boolean): Promise<boolean> {
    if (language) this.language = language;
    if (floatingEmoji !== undefined) this.floatingEmoji = floatingEmoji;

    localStorage.setItem('hello_friend_mode_active', 'true');
    localStorage.setItem('hello_friend_mode_language', this.language);
    localStorage.setItem('hello_friend_mode_emoji', String(this.floatingEmoji));

    this.setState('STARTING');

    if (this.isNative()) {
      try {
        const res = await NativeFriendMode.enableFriendMode({
          language: this.language,
          floatingEmoji: this.floatingEmoji,
        });
        this.setState(res.state || 'LISTENING_FOR_WAKE');
        return true;
      } catch (err: any) {
        console.error('Failed to enable native friend mode:', err);
        this.setState('ERROR');
        return false;
      }
    } else {
      // Browser Development / Web Fallback
      return this.startWebFallback();
    }
  }

  public async disable(): Promise<boolean> {
    localStorage.setItem('hello_friend_mode_active', 'false');

    if (this.isNative()) {
      try {
        await NativeFriendMode.disableFriendMode();
        this.setState('DISABLED');
        return true;
      } catch (err) {
        console.error('Failed to disable native friend mode:', err);
        this.setState('DISABLED');
        return false;
      }
    } else {
      this.stopWebFallback();
      this.setState('DISABLED');
      return true;
    }
  }

  public async setLanguage(lang: FriendLanguage): Promise<void> {
    this.language = lang;
    localStorage.setItem('hello_friend_mode_language', lang);
    if (this.isNative()) {
      await NativeFriendMode.setLanguage({ language: lang }).catch(() => {});
    }
  }

  public async setFloatingEmoji(enabled: boolean): Promise<void> {
    this.floatingEmoji = enabled;
    localStorage.setItem('hello_friend_mode_emoji', String(enabled));
    if (this.isNative()) {
      await NativeFriendMode.setFloatingEmoji({ enabled }).catch(() => {});
    }
  }

  public async triggerWake(): Promise<void> {
    if (this.isNative()) {
      await NativeFriendMode.triggerWake();
    } else {
      // On web: manually trigger speech capture
      this.startWebActiveListening();
    }
  }

  public async checkPermissions(): Promise<PermissionStatus> {
    if (this.isNative()) {
      try {
        const res = await NativeFriendMode.checkPermissions();
        return {
          microphone: res.microphone === 'granted' ? 'granted' : 'denied',
          notifications: res.notifications === 'granted' ? 'granted' : 'denied',
          overlay: res.overlay === 'granted' ? 'granted' : 'denied',
        };
      } catch {
        return { microphone: 'prompt', notifications: 'prompt', overlay: 'prompt' };
      }
    } else {
      // Browser permissions
      let micGranted = false;
      try {
        const perm = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
        micGranted = perm.state === 'granted';
      } catch {}

      const notifState = typeof Notification !== 'undefined' ? Notification.permission : 'default';

      return {
        microphone: micGranted ? 'granted' : 'prompt',
        notifications: notifState === 'granted' ? 'granted' : notifState === 'denied' ? 'denied' : 'prompt',
        overlay: 'granted', // Web does not need system alert window
      };
    }
  }

  public async requestPermissions(): Promise<PermissionStatus> {
    if (this.isNative()) {
      await NativeFriendMode.requestPermissions();
      return this.checkPermissions();
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch {}

      if (typeof Notification !== 'undefined' && Notification.requestPermission) {
        await Notification.requestPermission();
      }

      return this.checkPermissions();
    }
  }

  public async requestOverlayPermission(): Promise<boolean> {
    if (this.isNative()) {
      const res = await NativeFriendMode.requestOverlayPermission();
      return res.granted;
    }
    return true;
  }

  // Web Speech Fallback for local development and non-Android environments
  private startWebFallback(): boolean {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('Web Speech API not supported in this browser; running in simulated mode');
      this.setState('IDLE');
      return true;
    }

    try {
      this.webRecognition = new SpeechRecognition();
      this.webRecognition.continuous = true;
      this.webRecognition.interimResults = true;
      this.webRecognition.lang = this.language === 'ta-IN' ? 'ta-IN' : 'en-IN';

      this.webRecognition.onstart = () => {
        this.isWebListening = true;
        this.setState('LISTENING_FOR_WAKE');
      };

      this.webRecognition.onresult = async (event: any) => {
        let transcript = '';
        let isFinal = false;

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
          if (event.results[i].isFinal) isFinal = true;
        }

        this.notifyTranscript(transcript, isFinal);

        const lower = transcript.toLowerCase();
        if (lower.includes('hello macha') || lower.includes('macha') || lower.includes('hey macha')) {
          this.webRecognition.stop();
          this.setState('ACTIVE_LISTENING');
          this.speakWeb('Sollu da, listening!', () => {
            this.startWebActiveListening();
          });
        }
      };

      this.webRecognition.onerror = (e: any) => {
        console.warn('Web recognition error:', e.error);
        if (e.error !== 'no-speech') {
          this.setState('ERROR');
        }
      };

      this.webRecognition.onend = () => {
        this.isWebListening = false;
        if (this.state !== 'DISABLED' && this.state !== 'SPEAKING' && this.state !== 'THINKING') {
          setTimeout(() => {
            if (this.state !== 'DISABLED') {
              try { this.webRecognition?.start(); } catch {}
            }
          }, 500);
        }
      };

      this.webRecognition.start();
      return true;
    } catch (e) {
      console.warn('Failed to start web speech recognition:', e);
      this.setState('IDLE');
      return true;
    }
  }

  private startWebActiveListening() {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    this.setState('ACTIVE_LISTENING');
    try {
      const activeRec = new SpeechRecognition();
      activeRec.continuous = false;
      activeRec.interimResults = true;
      activeRec.lang = this.language === 'ta-IN' ? 'ta-IN' : 'en-IN';

      activeRec.onresult = async (event: any) => {
        let finalUtterance = '';
        for (let i = 0; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            finalUtterance += event.results[i][0].transcript;
          }
        }

        if (finalUtterance.trim()) {
          this.notifyTranscript(finalUtterance, true);
          this.setState('THINKING');
          const reply = await friendAgent.processMessage(finalUtterance);
          this.speakWeb(reply, () => {
            this.setState('LISTENING_FOR_WAKE');
            this.startWebFallback();
          });
        }
      };

      activeRec.onerror = () => {
        this.setState('LISTENING_FOR_WAKE');
        this.startWebFallback();
      };

      activeRec.start();
    } catch {
      this.startWebFallback();
    }
  }

  private speakWeb(text: string, onEnd?: () => void) {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      onEnd?.();
      return;
    }

    window.speechSynthesis.cancel();
    this.setState('SPEAKING');

    const utterance = new SpeechSynthesisUtterance(text);
    if (this.language === 'ta-IN') {
      utterance.lang = 'ta-IN';
    } else {
      utterance.lang = 'en-IN';
    }

    utterance.onend = () => {
      onEnd?.();
    };

    utterance.onerror = () => {
      onEnd?.();
    };

    window.speechSynthesis.speak(utterance);
  }

  private stopWebFallback() {
    if (this.webRecognition) {
      try {
        this.webRecognition.stop();
        this.webRecognition.abort();
      } catch {}
      this.webRecognition = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.isWebListening = false;
  }
}

export const friendModeBridge = FriendModeBridge.getInstance();
