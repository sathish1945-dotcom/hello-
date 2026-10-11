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
  pauseFriendMode(): Promise<{ success: boolean; state: FriendModeState }>;
  resumeFriendMode(): Promise<{ success: boolean; state: FriendModeState }>;
  triggerWake(): Promise<{ success: boolean }>;
  answerNow(): Promise<{ success: boolean }>;
  stopPlayback(): Promise<{ success: boolean }>;
  speakResponse(options: { text: string }): Promise<{ success: boolean }>;
  setLanguage(options: { language: string }): Promise<{ success: boolean; language: string }>;
  setFloatingEmoji(options: { enabled: boolean }): Promise<{ success: boolean; floatingEmoji: boolean }>;
  setShowLiveTranscript(options: { enabled: boolean }): Promise<{ success: boolean; showLiveTranscript: boolean }>;
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
  private language: FriendLanguage = 'en-IN';
  private floatingEmoji: boolean = true;
  private showLiveTranscript: boolean = true;
  private listeners: Set<(state: FriendModeState) => void> = new Set();
  private transcriptListeners: Set<(text: string, isFinal: boolean) => void> = new Set();
  private countdownListeners: Set<(secondsRemaining: number) => void> = new Set();

  // Web Speech fallback variables
  private webRecognition: any = null;
  private isWebListening: boolean = false;
  private webTurnText: string = '';
  private webTurnTimer: any = null;
  private webLastSpeechTime: number = 0;
  private webCountdownSeconds: number = 10;

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

      const liveTranscript = localStorage.getItem('hello_friend_mode_live_transcript');
      if (liveTranscript !== null) this.showLiveTranscript = liveTranscript === 'true';

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
        if (data.state === 'DISABLED' || data.state === 'IDLE' || data.state === 'ERROR') {
          friendAgent.cancelPending();
        }
        this.setState(data.state);
      });

      await NativeFriendMode.addListener('wakeWordDetected', (data: { phrase: string }) => {
        console.log('Native wake word detected:', data.phrase);
        this.notifyTranscript(`[Wake Phrase: ${data.phrase}]`, true);
      });

      await NativeFriendMode.addListener('speechRecognized', (data: { text: string; isFinal: boolean }) => {
        this.notifyTranscript(data.text, data.isFinal);
      });

      await NativeFriendMode.addListener('turnCountdownTick', (data: { secondsRemaining: number }) => {
        this.notifyCountdown(data.secondsRemaining);
      });

      await NativeFriendMode.addListener('speechInterrupted', () => {
        console.log('[FriendModeBridge] Speech interrupted event from native');
        friendAgent.cancelPending();
      });

      await NativeFriendMode.addListener('speechCompleted', async (data: { text: string }) => {
        console.log('[FriendModeBridge] speechCompleted event:', data.text);
        this.notifyTranscript(data.text, true);
        this.setState('THINKING');

        // Pass to FriendAgent to query Hello AI model router with language context
        const reply = await friendAgent.processMessage(data.text, this.language);
        console.log('[FriendModeBridge] FriendAgent reply:', reply);

        // If Friend Mode was paused, closed, or disabled while waiting, suppress late playback
        if (this.state === 'DISABLED' || this.state === 'IDLE' || this.state === 'ERROR') {
          console.log('[FriendModeBridge] Friend Mode was paused/disabled/inactive during processing; suppressing playback');
          return;
        }

        // Instruct native service to speak reply via Android TTS
        if (reply) {
          await NativeFriendMode.speakResponse({ text: reply });
        }
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

  public onCountdownTick(callback: (secondsRemaining: number) => void): () => void {
    this.countdownListeners.add(callback);
    return () => this.countdownListeners.delete(callback);
  }

  public async answerNow(): Promise<void> {
    if (this.isNative()) {
      await NativeFriendMode.answerNow().catch(() => {});
    } else {
      this.triggerWebAnswerNow();
    }
  }

  public async stop(): Promise<void> {
    this.clearWebSilenceThresholdTimer();
    friendAgent.cancelPending();
    if (this.isNative()) {
      await NativeFriendMode.stopPlayback().catch(() => {});
    } else {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      this.setState('ACTIVE_LISTENING');
    }
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

  private notifyCountdown(secondsRemaining: number) {
    for (const listener of this.countdownListeners) {
      listener(secondsRemaining);
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
    friendAgent.cancelPending();
    friendAgent.clearHistory(); // Temporary session context cleared on close

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

  /**
   * Pause Friend Mode: stops capture, pending AI requests, and speech.
   * Preserves short-term memory session context (Step 07).
   */
  public async pause(): Promise<boolean> {
    friendAgent.cancelPending();
    this.cancelPendingSpeech();

    if (this.isNative()) {
      try {
        const res = await NativeFriendMode.pauseFriendMode();
        this.setState(res.state || 'IDLE');
        return true;
      } catch (err) {
        console.error('Failed to pause native friend mode:', err);
        this.setState('IDLE');
        return false;
      }
    } else {
      this.stopWebFallback();
      this.setState('IDLE');
      return true;
    }
  }

  /**
   * Resume Friend Mode from paused state (Step 07).
   */
  public async resume(): Promise<boolean> {
    if (this.state === 'DISABLED') {
      return this.enable();
    }

    if (this.isNative()) {
      try {
        const res = await NativeFriendMode.resumeFriendMode();
        this.setState(res.state || 'LISTENING_FOR_WAKE');
        return true;
      } catch (err) {
        console.error('Failed to resume native friend mode:', err);
        return false;
      }
    } else {
      this.startWebFallback();
      return true;
    }
  }

  public cancelPendingSpeech(): void {
    friendAgent.cancelPending();
    if (this.isNative()) {
      NativeFriendMode.speakResponse({ text: '' }).catch(() => {});
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

  public getShowLiveTranscript(): boolean {
    return this.showLiveTranscript;
  }

  public async setShowLiveTranscript(enabled: boolean): Promise<void> {
    this.showLiveTranscript = enabled;
    localStorage.setItem('hello_friend_mode_live_transcript', String(enabled));
    if (this.isNative()) {
      await NativeFriendMode.setShowLiveTranscript({ enabled }).catch(() => {});
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

  private webSilenceThresholdTimer: any = null;

  private clearWebSilenceThresholdTimer() {
    if (this.webSilenceThresholdTimer) {
      clearTimeout(this.webSilenceThresholdTimer);
      this.webSilenceThresholdTimer = null;
    }
  }

  private triggerWebAnswerNow() {
    this.clearWebSilenceThresholdTimer();
    this.submitWebTurn();
  }

  private startWebActiveListening() {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    this.clearWebSilenceThresholdTimer();
    this.webTurnText = '';
    this.webLastSpeechTime = Date.now();

    this.setState('ACTIVE_LISTENING');
    try {
      const activeRec = new SpeechRecognition();
      activeRec.continuous = true;
      activeRec.interimResults = true;
      activeRec.lang = this.language === 'ta-IN' ? 'ta-IN' : 'en-IN';

      activeRec.onresult = (event: any) => {
        this.webLastSpeechTime = Date.now();
        this.clearWebSilenceThresholdTimer();

        let interim = '';
        let hasFinal = false;
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const trans = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            hasFinal = true;
            if (!this.webTurnText.toLowerCase().includes(trans.trim().toLowerCase())) {
              this.webTurnText += (this.webTurnText ? ' ' : '') + trans.trim();
            }
          } else {
            interim += trans;
          }
        }

        this.notifyTranscript(this.webTurnText + (interim ? ' ' + interim : ''), false);

        if (hasFinal && this.webTurnText.trim()) {
          // Short silence threshold of 1500ms allows brief pauses without cutting off
          this.clearWebSilenceThresholdTimer();
          this.webSilenceThresholdTimer = setTimeout(() => {
            this.webSilenceThresholdTimer = null;
            try { activeRec.stop(); } catch {}
            this.submitWebTurn();
          }, 1500);
        }
      };

      activeRec.onerror = (e: any) => {
        if (this.webTurnText.trim()) {
          this.submitWebTurn();
        } else {
          this.setState('LISTENING_FOR_WAKE');
          this.startWebFallback();
        }
      };

      activeRec.start();
      this.webRecognition = activeRec;
    } catch {
      this.startWebFallback();
    }
  }

  private startWebSilenceCountdown(rec: any) {
    if (this.webTurnTimer) {
      clearInterval(this.webTurnTimer);
      this.webTurnTimer = null;
    }
    try { rec.stop(); } catch {}
    this.submitWebTurn();
  }

  private async submitWebTurn() {
    this.clearWebSilenceThresholdTimer();
    const textToSubmit = this.webTurnText.trim();
    this.webTurnText = '';
    if (!textToSubmit) {
      this.setState('LISTENING_FOR_WAKE');
      this.startWebFallback();
      return;
    }

    this.notifyTranscript(textToSubmit, true);
    this.setState('THINKING');

    const isTamil = this.language === 'ta-IN';
    const isRetrieval = /check|weather|score|time|search|find|theriyuma/i.test(textToSubmit);
    const ackPhrase = isRetrieval
      ? (isTamil ? 'செக் பண்றேன் இருங்க.' : 'Let me check.')
      : (isTamil ? 'யோசிக்கிறேன் இருங்க.' : 'Let me think.');

    let ackTimer: any = setTimeout(() => {
      if (this.state === 'THINKING') {
        this.speakWeb(ackPhrase);
      }
    }, 800);

    const reply = await friendAgent.processMessage(textToSubmit, this.language);
    clearTimeout(ackTimer);

    if (this.state === 'DISABLED' || this.state === 'IDLE') {
      return;
    }

    if (reply) {
      this.speakWeb(reply, () => {
        this.setState('LISTENING_FOR_WAKE');
        this.startWebFallback();
      });
    } else {
      this.setState('LISTENING_FOR_WAKE');
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
    if (this.webTurnTimer) {
      clearInterval(this.webTurnTimer);
      this.webTurnTimer = null;
    }
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
