package com.hello.ai.friendmode;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.speech.SpeechRecognizer;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.hello.ai.MainActivity;

import java.util.Locale;

/**
 * FriendModeService: Android Foreground Service coordinating Friend Mode.
 * Holds foreground notification, creates floating emoji overlay,
 * manages continuous speech turns with 10-second silence window,
 * spoken stop/interruption detection, waiting acknowledgements,
 * and reliable audio lifecycle.
 */
public class FriendModeService extends Service {
    private static final String TAG = "FriendModeService";

    public static final String ACTION_START = "com.hello.ai.friendmode.ACTION_START";
    public static final String ACTION_STOP = "com.hello.ai.friendmode.ACTION_STOP";
    public static final String ACTION_PAUSE = "com.hello.ai.friendmode.ACTION_PAUSE";
    public static final String ACTION_RESUME = "com.hello.ai.friendmode.ACTION_RESUME";
    public static final String ACTION_ANSWER_NOW = "com.hello.ai.friendmode.ACTION_ANSWER_NOW";
    public static final String ACTION_INTERRUPT_STOP = "com.hello.ai.friendmode.ACTION_INTERRUPT_STOP";
    public static final String ACTION_TRIGGER_WAKE = "com.hello.ai.friendmode.ACTION_TRIGGER_WAKE";
    public static final String ACTION_SPEAK = "com.hello.ai.friendmode.ACTION_SPEAK";
    public static final String EXTRA_TEXT_TO_SPEAK = "extra_text_to_speak";
    public static final String EXTRA_LANGUAGE = "extra_language";
    private static final String WAKE_RECOGNITION_LANGUAGE = "en-IN";

    public static final int SILENCE_WINDOW_MS = 10000; // 10 continuous seconds of silence

    private static final String CHANNEL_ID = "hello_friend_mode_channel";
    private static final int NOTIFICATION_ID = 4040;

    public interface ServiceCallback {
        void onStateChanged(FriendModeState state);
        void onWakeDetected(String phrase);
        void onSpeechRecognized(String text, boolean isFinal);
        void onSpeechCompleted(String text);
        void onAgentSpeechRequested(String text);
        void onTurnCountdownTick(int secondsRemaining);
        void onSpeechInterrupted();
        void onError(String error);
    }

    private final IBinder binder = new LocalBinder();
    private static FriendModeService instance;
    private ServiceCallback serviceCallback;

    private FriendModeState currentState = FriendModeState.DISABLED;
    private WakeWordEngine wakeWordEngine;
    private SpeechToTextEngine sttEngine;
    private TextToSpeechEngine ttsEngine;
    private FloatingEmojiOverlay floatingOverlay;

    private String language = "en-IN";
    private String commandRecognitionLanguage = "en-IN";
    private boolean floatingEmojiEnabled = true;
    private boolean showLiveTranscript = true;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean isListeningSessionActive = false;
    private int wakeSessionId = 0;
    private Runnable pendingWakeRestartRunnable;
    private int consecutiveSilenceTimeouts = 0;

    // 10-Second Silence & Turn Construction
    private final StringBuilder cumulativeTurnText = new StringBuilder();
    private long lastSpeechTimeMonotonic = 0;
    private int currentTurnSessionId = 0;
    private Runnable turnCountdownRunnable = null;
    private int countdownSecondsRemaining = 10;
    private boolean isWaitingForSilence = false;

    // Waiting Acknowledgement
    private Runnable pendingAcknowledgementRunnable = null;
    private boolean isWaitingAcknowledgementActive = false;
    private boolean answerReceivedForCurrentTurn = false;

    // Answer interruption
    private boolean reminderGivenForCurrentAnswer = false;

    private String mapCommandLanguage(String rawLang) {
        if (rawLang == null || rawLang.trim().isEmpty() || "auto".equalsIgnoreCase(rawLang.trim())) {
            return "en-IN";
        }
        String lower = rawLang.trim().toLowerCase(Locale.ROOT);
        if (lower.startsWith("ta") || lower.contains("tamil")) {
            return "ta-IN";
        }
        if (lower.contains("en-us") || lower.contains("us")) {
            return "en-US";
        }
        return "en-IN";
    }

    private synchronized void cancelPendingRestarts() {
        if (pendingWakeRestartRunnable != null) {
            mainHandler.removeCallbacks(pendingWakeRestartRunnable);
            pendingWakeRestartRunnable = null;
        }
    }

    public static final long SPEECH_END_SILENCE_THRESHOLD_MS = 1500L; // 1.5 seconds silence threshold
    private Runnable pendingTurnSubmissionRunnable = null;

    private synchronized void cancelPendingTurnSubmission() {
        if (pendingTurnSubmissionRunnable != null) {
            mainHandler.removeCallbacks(pendingTurnSubmissionRunnable);
            pendingTurnSubmissionRunnable = null;
        }
    }

    private synchronized void cancelTurnCountdown() {
        cancelPendingTurnSubmission();
        if (turnCountdownRunnable != null) {
            mainHandler.removeCallbacks(turnCountdownRunnable);
            turnCountdownRunnable = null;
        }
        isWaitingForSilence = false;
    }

    private synchronized void cancelPendingAcknowledgement() {
        if (pendingAcknowledgementRunnable != null) {
            mainHandler.removeCallbacks(pendingAcknowledgementRunnable);
            pendingAcknowledgementRunnable = null;
        }
        if (isWaitingAcknowledgementActive) {
            ttsEngine.stop();
            isWaitingAcknowledgementActive = false;
        }
    }

    public class LocalBinder extends Binder {
        public FriendModeService getService() {
            return FriendModeService.this;
        }
    }

    private static ServiceCallback sPluginCallback;

    public static void setPluginCallback(ServiceCallback callback) {
        sPluginCallback = callback;
        if (instance != null) {
            instance.setServiceCallback(callback);
        }
    }

    public static FriendModeService getInstance() {
        return instance;
    }

    public static boolean isRunning() {
        return instance != null && instance.currentState != FriendModeState.DISABLED;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        if (sPluginCallback != null) {
            this.serviceCallback = sPluginCallback;
        }
        Log.d(TAG, "FriendModeService onCreate (callback registered: " + (serviceCallback != null) + ")");

        createNotificationChannel();
        initializeEngines();
    }

    private void initializeEngines() {
        wakeWordEngine = new WakeWordEngine(this);
        sttEngine = new SpeechToTextEngine(this);
        ttsEngine = new TextToSpeechEngine(this);

        floatingOverlay = new FloatingEmojiOverlay(this, new FloatingEmojiOverlay.OverlayInteractionListener() {
            @Override
            public void onOverlayTapped() {
                Log.d(TAG, "Overlay tapped: triggering active listening");
                startActiveListeningSession();
            }

            @Override
            public void onOverlayLongPressed() {
                Log.d(TAG, "Overlay long pressed: stopping Friend Mode");
                stopFriendMode();
            }

            @Override
            public void onOverlayCloseRequested() {
                stopFriendMode();
            }

            @Override
            public void onAnswerNowRequested() {
                Log.d(TAG, "Overlay Answer Now requested");
                answerNow();
            }

            @Override
            public void onStopRequested() {
                Log.d(TAG, "Overlay Stop requested");
                stopAnswerPlaybackAndCancel();
            }

            @Override
            public void onResumeRequested() {
                Log.d(TAG, "Overlay Resume requested");
                resumeFriendMode();
            }
        });

        showLiveTranscript = getSharedPreferences("hello_friend_prefs", MODE_PRIVATE)
                .getBoolean("show_live_transcript", true);
        if (floatingOverlay != null) {
            floatingOverlay.setShowLiveTranscript(showLiveTranscript);
        }

        wakeWordEngine.setListener(new WakeWordEngine.WakeWordListener() {
            @Override
            public void onWakeWordDetected(String phrase) {
                Log.d(TAG, "Wake word detected by engine: " + phrase);
                onWakeDetected(phrase);
            }

            @Override
            public void onWakeListeningStarted() {
                if (currentState != FriendModeState.ACTIVE_LISTENING
                        && currentState != FriendModeState.WAITING_FOR_FINISH
                        && currentState != FriendModeState.SPEAKING) {
                    setState(FriendModeState.LISTENING_FOR_WAKE);
                }
            }

            @Override
            public void onWakeListeningStopped() {}

            @Override
            public void onError(String error) {
                Log.w(TAG, "WakeWordEngine error: " + error);
            }
        });

        ttsEngine.setCallback(new TextToSpeechEngine.TTSCallback() {
            @Override
            public void onInit(boolean success) {
                Log.d(TAG, "TTS Engine initialized: " + success);
            }

            @Override
            public void onSpeechStart(String utteranceId) {
                Log.d(TAG, "TTS utterance started: " + utteranceId);
                if (!isWaitingAcknowledgementActive) {
                    setState(FriendModeState.SPEAKING);
                }
            }

            @Override
            public void onSpeechDone(String utteranceId) {
                Log.d(TAG, "TTS utterance completed: " + utteranceId);
            }

            @Override
            public void onSpeechError(String utteranceId, String error) {
                Log.w(TAG, "TTS playback error: " + error);
                mainHandler.postDelayed(() -> {
                    if (currentState == FriendModeState.SPEAKING) {
                        startWakeListening();
                    }
                }, 400);
            }
        });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            return START_STICKY;
        }

        String action = intent.getAction();
        Log.d(TAG, "FriendModeService onStartCommand with action: " + action);

        if (ACTION_START.equals(action)) {
            String lang = intent.getStringExtra(EXTRA_LANGUAGE);
            if (lang != null) {
                this.language = lang;
                this.commandRecognitionLanguage = mapCommandLanguage(lang);
            }
            startFriendMode();
        } else if (ACTION_STOP.equals(action)) {
            stopFriendMode();
            stopSelf();
        } else if (ACTION_PAUSE.equals(action)) {
            pauseFriendMode();
        } else if (ACTION_RESUME.equals(action)) {
            resumeFriendMode();
        } else if (ACTION_ANSWER_NOW.equals(action)) {
            answerNow();
        } else if (ACTION_INTERRUPT_STOP.equals(action)) {
            stopAnswerPlaybackAndCancel();
        } else if (ACTION_TRIGGER_WAKE.equals(action)) {
            startActiveListeningSession();
        } else if (ACTION_SPEAK.equals(action)) {
            String textToSpeak = intent.getStringExtra(EXTRA_TEXT_TO_SPEAK);
            if (textToSpeak != null) {
                speak(textToSpeak);
            }
        }

        return START_STICKY;
    }

    private void startFriendMode() {
        Log.d(TAG, "Starting Friend Mode service in foreground");
        setState(FriendModeState.STARTING);

        Notification notification = buildNotification("Friend Mode active", "Listening for 'Hello macha' • Tap 👋 anytime");

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                        NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                );
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error starting foreground service", e);
            startForeground(NOTIFICATION_ID, notification);
        }

        if (floatingEmojiEnabled && FloatingEmojiOverlay.canDrawOverlays(this)) {
            floatingOverlay.show();
        }

        startWakeListening();
    }

    public synchronized void startWakeListening() {
        if (currentState == FriendModeState.DISABLED) return;
        if (ttsEngine != null && ttsEngine.isSpeaking()) {
            Log.d(TAG, "TTS is currently speaking; deferring wake listening");
            return;
        }

        cancelPendingRestarts();
        cancelTurnCountdown();
        cancelPendingAcknowledgement();

        final int currentSession = ++wakeSessionId;
        setState(FriendModeState.LISTENING_FOR_WAKE);
        wakeWordEngine.startListening();

        sttEngine.setLanguage(WAKE_RECOGNITION_LANGUAGE);
        sttEngine.startListening(new SpeechToTextEngine.SpeechCallback() {
            @Override
            public void onReady() {
                Log.d(TAG, "STT ready for wake listening (session " + currentSession + ")");
            }

            @Override
            public void onBeginningOfSpeech() {}

            @Override
            public void onRmsChanged(float rmsdB) {}

            @Override
            public void onResult(String text, boolean isFinal) {
                if (currentSession != wakeSessionId || currentState != FriendModeState.LISTENING_FOR_WAKE) {
                    return;
                }

                Log.d(TAG, "STT heard during wake check: '" + text + "' (final=" + isFinal + ")");
                if (wakeWordEngine.checkWakePhrase(text)) {
                    onWakeDetected(text);
                    return;
                }

                if (isFinal) {
                    scheduleWakeRestart(currentSession, 300);
                }
            }

            @Override
            public void onError(int errorCode, String errorMessage) {
                if (currentSession != wakeSessionId || currentState != FriendModeState.LISTENING_FOR_WAKE) {
                    return;
                }

                Log.d(TAG, "Wake STT loop cycle (error " + errorCode + ": " + errorMessage + ")");

                if (SpeechToTextEngine.isRecoverableError(errorCode)) {
                    scheduleWakeRestart(currentSession, errorCode == 8 ? 800 : 400);
                } else if (errorCode == 9) { // INSUFFICIENT_PERMISSIONS
                    Log.e(TAG, "Microphone permission denied; stopping Friend Mode");
                    stopFriendMode();
                    if (serviceCallback != null) {
                        serviceCallback.onError("Microphone permission denied");
                    }
                } else {
                    scheduleWakeRestart(currentSession, 1000);
                }
            }

            @Override
            public void onEndOfSpeech() {}
        });
    }

    private void scheduleWakeRestart(int session, long delayMs) {
        cancelPendingRestarts();
        pendingWakeRestartRunnable = () -> {
            if (session == wakeSessionId && currentState == FriendModeState.LISTENING_FOR_WAKE) {
                startWakeListening();
            }
        };
        mainHandler.postDelayed(pendingWakeRestartRunnable, delayMs);
    }

    private synchronized void onWakeDetected(String phrase) {
        cancelPendingRestarts();
        cancelTurnCountdown();
        cancelPendingAcknowledgement();

        final int session = ++wakeSessionId;
        sttEngine.cancel();
        wakeWordEngine.stopListening();

        setState(FriendModeState.ACTIVE_LISTENING);

        if (serviceCallback != null) {
            serviceCallback.onWakeDetected(phrase);
        }

        // Short, cheerful wake reply: "Enna macha?"
        ttsEngine.speak("Enna macha?", () -> {
            mainHandler.postDelayed(() -> {
                if ((currentState == FriendModeState.SPEAKING || currentState == FriendModeState.ACTIVE_LISTENING) && session == wakeSessionId) {
                    startActiveListeningSession();
                }
            }, 350);
        });
    }

    public synchronized void startActiveListeningSession() {
        if (currentState == FriendModeState.DISABLED) return;
        isListeningSessionActive = true;

        cancelPendingRestarts();
        cancelTurnCountdown();
        cancelPendingAcknowledgement();
        wakeWordEngine.stopListening();
        ttsEngine.stop();
        sttEngine.cancel();

        cumulativeTurnText.setLength(0);
        lastSpeechTimeMonotonic = SystemClock.elapsedRealtime();
        final int turnId = ++currentTurnSessionId;

        setState(FriendModeState.ACTIVE_LISTENING);
        updateNotification("Friend Mode listening...", "Speak your message now");
        if (floatingOverlay != null) {
            floatingOverlay.updateLiveTranscript("", "", false);
        }

        launchSTTCaptureForTurn(turnId);
    }

    private synchronized void launchSTTCaptureForTurn(final int turnId) {
        if (turnId != currentTurnSessionId || currentState == FriendModeState.DISABLED) return;

        sttEngine.setLanguage(commandRecognitionLanguage);
        sttEngine.startListening(new SpeechToTextEngine.SpeechCallback() {
            @Override
            public void onReady() {
                Log.d(TAG, "STT capture ready for turn " + turnId + " with language: " + commandRecognitionLanguage);
            }

            @Override
            public void onBeginningOfSpeech() {
                markSpeechDetected();
            }

            @Override
            public void onRmsChanged(float rmsdB) {
                if (rmsdB > 2.0f) {
                    markSpeechDetected();
                }
            }

            @Override
            public void onResult(String text, boolean isFinal) {
                if (turnId != currentTurnSessionId) return;

                markSpeechDetected();

                if (serviceCallback != null) {
                    serviceCallback.onSpeechRecognized(text, isFinal);
                }

                if (floatingOverlay != null) {
                    floatingOverlay.updateLiveTranscript(cumulativeTurnText.toString(), text, isFinal);
                }

                if (text != null && !text.trim().isEmpty()) {
                    if (isConversationClosure(text)) {
                        handleConversationClosure(text);
                        return;
                    }

                    if (isStopCommand(text)) {
                        String postStop = extractPostStopInstruction(text);
                        if (postStop != null) {
                            Log.d(TAG, "Stop + trailing instruction detected: \"" + postStop + "\"");
                            cancelPendingAcknowledgement();
                            if (ttsEngine != null) ttsEngine.stop();
                            if (serviceCallback != null) serviceCallback.onSpeechInterrupted();

                            cumulativeTurnText.setLength(0);
                            cumulativeTurnText.append(postStop);
                            submitTurnForAnswer(turnId);
                            return;
                        } else {
                            Log.d(TAG, "Stop command detected: stopping playback and returning to listening");
                            stopAnswerPlaybackAndCancel();
                            return;
                        }
                    }

                    if (isFinal) {
                        appendTranscriptSegment(text);
                        Log.d(TAG, "Turn " + turnId + " cumulative transcript: \"" + cumulativeTurnText + "\"");
                        scheduleSpeechEndSubmission(turnId);
                    }
                }
            }

            @Override
            public void onError(int errorCode, String errorMessage) {
                if (turnId != currentTurnSessionId) return;

                Log.d(TAG, "Active STT turn cycle error (" + errorCode + "): " + errorMessage);

                if (cumulativeTurnText.length() > 0) {
                    if (pendingTurnSubmissionRunnable == null) {
                        scheduleSpeechEndSubmission(turnId);
                    }
                    return;
                }

                // If no speech heard at all, handle natural silence timeout
                if (errorCode == SpeechRecognizer.ERROR_NO_MATCH || errorCode == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                    consecutiveSilenceTimeouts++;
                    if (consecutiveSilenceTimeouts >= 2) {
                        Log.d(TAG, "Conversation idle: returning to wake listening");
                        consecutiveSilenceTimeouts = 0;
                        scheduleWakeRestart(wakeSessionId, 600);
                    } else {
                        mainHandler.postDelayed(() -> {
                            if (currentState != FriendModeState.DISABLED) {
                                startActiveListeningSession();
                            }
                        }, 450);
                    }
                } else {
                    scheduleWakeRestart(wakeSessionId, 600);
                }
            }

            @Override
            public void onEndOfSpeech() {
                if (cumulativeTurnText.length() > 0) {
                    scheduleSpeechEndSubmission(turnId);
                }
            }
        });
    }

    private synchronized void markSpeechDetected() {
        lastSpeechTimeMonotonic = SystemClock.elapsedRealtime();
        if (pendingTurnSubmissionRunnable != null) {
            Log.d(TAG, "Speech resumed within silence threshold (" + SPEECH_END_SILENCE_THRESHOLD_MS + "ms): resetting timer");
            cancelPendingTurnSubmission();
            setState(FriendModeState.ACTIVE_LISTENING);
            updateNotification("Friend Mode listening...", "Listening: " + cumulativeTurnText.toString());
        }
    }

    private synchronized void appendTranscriptSegment(String newSegment) {
        if (newSegment == null) return;
        String trimmed = newSegment.trim();
        if (trimmed.isEmpty()) return;

        if (cumulativeTurnText.length() == 0) {
            cumulativeTurnText.append(trimmed);
            return;
        }

        String current = cumulativeTurnText.toString().trim();
        if (current.equalsIgnoreCase(trimmed)) {
            return; // Exact duplicate
        }

        if (current.toLowerCase(Locale.ROOT).endsWith(trimmed.toLowerCase(Locale.ROOT))) {
            return;
        }

        String[] currentWords = current.split("\\s+");
        String[] newWords = trimmed.split("\\s+");

        int overlapLen = 0;
        int maxCheck = Math.min(currentWords.length, newWords.length);
        for (int k = maxCheck; k > 0; k--) {
            boolean match = true;
            for (int j = 0; j < k; j++) {
                if (!currentWords[currentWords.length - k + j].equalsIgnoreCase(newWords[j])) {
                    match = false;
                    break;
                }
            }
            if (match) {
                overlapLen = k;
                break;
            }
        }

        if (overlapLen > 0) {
            for (int i = overlapLen; i < newWords.length; i++) {
                cumulativeTurnText.append(" ").append(newWords[i]);
            }
        } else {
            cumulativeTurnText.append(" ").append(trimmed);
        }
    }

    private synchronized void scheduleSpeechEndSubmission(final int turnId) {
        if (turnId != currentTurnSessionId) return;
        if (cumulativeTurnText.length() == 0 || cumulativeTurnText.toString().trim().isEmpty()) {
            return;
        }

        cancelPendingTurnSubmission();
        Log.d(TAG, "Speech pause detected: starting short silence threshold (" + SPEECH_END_SILENCE_THRESHOLD_MS + "ms)");

        pendingTurnSubmissionRunnable = () -> {
            Log.d(TAG, "Speech-end silence threshold reached (" + SPEECH_END_SILENCE_THRESHOLD_MS + "ms): submitting turn " + turnId);
            pendingTurnSubmissionRunnable = null;
            submitTurnForAnswer(turnId);
        };
        mainHandler.postDelayed(pendingTurnSubmissionRunnable, SPEECH_END_SILENCE_THRESHOLD_MS);

        // Keep recognizer ready for continuation so if user speaks within 1.5s, words append smoothly
        mainHandler.postDelayed(() -> {
            if (turnId == currentTurnSessionId && pendingTurnSubmissionRunnable != null && isListeningSessionActive && currentState != FriendModeState.DISABLED) {
                if (!sttEngine.isListening()) {
                    launchSTTCaptureForTurn(turnId);
                }
            }
        }, 120);
    }

    private synchronized void startSilenceCountdown(final int turnId) {
        scheduleSpeechEndSubmission(turnId);
    }

    public synchronized void answerNow() {
        Log.d(TAG, "Answer Now triggered: cancelling silence threshold timer and submitting immediately");
        cancelPendingTurnSubmission();
        cancelTurnCountdown();
        if (currentState != FriendModeState.DISABLED && currentState != FriendModeState.IDLE) {
            submitTurnForAnswer(currentTurnSessionId);
        }
    }

    private synchronized void submitTurnForAnswer(int turnId) {
        if (turnId != currentTurnSessionId) {
            Log.w(TAG, "Turn ID mismatch; discarding obsolete turn submission");
            return;
        }

        cancelTurnCountdown();
        sttEngine.cancel();
        isListeningSessionActive = false;

        String completedUtterance = cumulativeTurnText.toString().trim();
        cumulativeTurnText.setLength(0);
        isWaitingForSilence = false;

        if (completedUtterance.isEmpty()) {
            Log.d(TAG, "Turn text is empty, ignoring submission");
            startWakeListening();
            return;
        }

        onUserUtteranceCaptured(completedUtterance);
    }

    private boolean isConversationClosure(String text) {
        if (text == null) return false;
        String lower = text.trim().toLowerCase(Locale.ROOT);
        return lower.equals("bye") || lower.equals("bye macha") || lower.contains("goodbye")
                || lower.contains("close friend") || lower.contains("stop listening")
                || lower.contains("apram pesalam") || lower.contains("mudichuko");
    }

    private void handleConversationClosure(String userText) {
        Log.d(TAG, "User closed conversation: " + userText);
        cancelTurnCountdown();
        cancelPendingAcknowledgement();
        cumulativeTurnText.setLength(0);

        setState(FriendModeState.SPEAKING);
        updateNotification("Hello AI", "Catch you later!");
        ttsEngine.speak("Seri da, apram pesalaam!", () -> {
            mainHandler.postDelayed(() -> {
                if (currentState != FriendModeState.DISABLED && currentState != FriendModeState.IDLE && currentState != FriendModeState.ERROR) {
                    startWakeListening();
                }
            }, 400);
        });
    }

    public static boolean isStopCommand(String text) {
        if (text == null) return false;
        String clean = text.trim().toLowerCase(Locale.ROOT)
                .replaceAll("[^a-zA-Z0-9\\u0B80-\\u0BFF\\s]", "")
                .trim();
        if (clean.isEmpty()) return false;

        if (clean.equals("stop") || clean.equals("please stop") || clean.equals("stop please")
                || clean.equals("stop it") || clean.equals("shut up") || clean.equals("quiet")
                || clean.equals("நிறுத்து") || clean.equals("போதும்") || clean.equals("நில்லு")
                || clean.equals("nirutthu") || clean.equals("niruthu") || clean.equals("podhum")
                || clean.equals("stop pannu") || clean.equals("stop da") || clean.equals("podhum da")
                || clean.equals("nirutthu da") || clean.equals("niruthu da") || clean.equals("stop macha")) {
            return true;
        }

        if (clean.startsWith("stop ") || clean.startsWith("நிறுத்து ") || clean.startsWith("போதும் ")
                || clean.startsWith("nirutthu ") || clean.startsWith("podhum ")) {
            String[] words = clean.split("\\s+");
            return words.length <= 4;
        }
        return false;
    }

    public static String extractPostStopInstruction(String text) {
        if (text == null) return null;
        String clean = text.trim();
        String lower = clean.toLowerCase(Locale.ROOT);
        String[] stopPrefixes = { "stop,", "stop.", "stop ", "நிறுத்து,", "நிறுத்து ", "போதும்,", "போதும் ", "nirutthu ", "podhum " };
        for (String prefix : stopPrefixes) {
            if (lower.startsWith(prefix)) {
                String remainder = clean.substring(prefix.length()).trim();
                while (!remainder.isEmpty() && (remainder.charAt(0) == ',' || remainder.charAt(0) == '.' || remainder.charAt(0) == ' ')) {
                    remainder = remainder.substring(1).trim();
                }
                return remainder.isEmpty() ? null : remainder;
            }
        }
        return null;
    }

    private boolean isRetrievalOrVerificationQuery(String text) {
        if (text == null) return false;
        String lower = text.toLowerCase(Locale.ROOT);
        return lower.contains("check") || lower.contains("weather") || lower.contains("score")
                || lower.contains("time") || lower.contains("date") || lower.contains("news")
                || lower.contains("search") || lower.contains("look up") || lower.contains("find")
                || lower.contains("status") || lower.contains("paaru") || lower.contains("பாரு")
                || lower.contains("theriyuma") || lower.contains("தெரியுமா");
    }

    private String getWaitingAcknowledgementPhrase(boolean isRetrieval, String lang) {
        String lower = lang != null ? lang.toLowerCase(Locale.ROOT) : "en-in";
        boolean isTamil = lower.startsWith("ta") || lower.contains("tamil");
        if (isRetrieval) {
            return isTamil ? "செக் பண்றேன் இருங்க." : "Let me check.";
        } else {
            return isTamil ? "யோசிக்கிறேன் இருங்க." : "Let me think.";
        }
    }

    private String getStopReminderPhrase(String lang) {
        String lower = lang != null ? lang.toLowerCase(Locale.ROOT) : "en-in";
        if (lower.startsWith("ta-in") || lower.equals("ta")) {
            return "நான் நிறுத்தணும்னா, 'நிறுத்து'ன்னு சொல்லுங்க.";
        } else if (lower.contains("tanglish") || lower.contains("auto")) {
            return "Naan niruthanumna, 'stop' nu sollu.";
        }
        return "If you want me to stop, say 'stop'.";
    }

    private void onUserUtteranceCaptured(String userText) {
        consecutiveSilenceTimeouts = 0;
        reminderGivenForCurrentAnswer = false;
        answerReceivedForCurrentTurn = false;
        final int turnId = currentTurnSessionId;

        setState(FriendModeState.THINKING);
        updateNotification("Hello AI Thinking...", userText);
        Log.d(TAG, "onUserUtteranceCaptured: \"" + userText + "\", serviceCallback present: " + (serviceCallback != null));

        // Waiting acknowledgement scheduled: play only if answer is still pending after 750ms
        boolean isRetrieval = isRetrievalOrVerificationQuery(userText);
        final String ackPhrase = getWaitingAcknowledgementPhrase(isRetrieval, language);

        cancelPendingAcknowledgement();
        pendingAcknowledgementRunnable = () -> {
            if (turnId == currentTurnSessionId && !answerReceivedForCurrentTurn && currentState == FriendModeState.THINKING) {
                Log.d(TAG, "Answer still pending: speaking waiting acknowledgement: " + ackPhrase);
                isWaitingAcknowledgementActive = true;
                ttsEngine.speak(ackPhrase, () -> {
                    isWaitingAcknowledgementActive = false;
                });
            }
        };
        mainHandler.postDelayed(pendingAcknowledgementRunnable, 750);

        if (serviceCallback != null) {
            serviceCallback.onSpeechCompleted(userText);
        } else {
            speak("Kettaen da: " + userText + ". Connect pannikuren.");
        }
    }

    public synchronized void speak(String responseText) {
        answerReceivedForCurrentTurn = true;
        cancelPendingAcknowledgement();

        isListeningSessionActive = false;
        cancelPendingRestarts();
        sttEngine.cancel();
        wakeWordEngine.stopListening();

        setState(FriendModeState.SPEAKING);
        updateNotification("Hello AI Speaking", responseText);

        ttsEngine.speak(responseText, () -> {
            Log.d(TAG, "Speech finished: keeping continuous conversation alive in active listening");
            mainHandler.postDelayed(() -> {
                if (currentState != FriendModeState.DISABLED && currentState != FriendModeState.IDLE && currentState != FriendModeState.ERROR) {
                    consecutiveSilenceTimeouts = 0;
                    startActiveListeningSession();
                }
            }, 450); // 450ms acoustic guard prevents self-hearing
        });
    }

    public synchronized void stopAnswerPlaybackAndCancel() {
        Log.d(TAG, "Stop triggered: stopping audio playback and cancelling generation");
        cancelPendingAcknowledgement();
        if (floatingOverlay != null) {
            floatingOverlay.clearTranscript();
        }
        if (ttsEngine != null) {
            ttsEngine.stop();
        }
        isWaitingAcknowledgementActive = false;

        if (serviceCallback != null) {
            serviceCallback.onSpeechInterrupted();
        }

        // Enter listening mode for next user instruction with 10-second silence rule
        mainHandler.postDelayed(() -> {
            if (currentState != FriendModeState.DISABLED && currentState != FriendModeState.IDLE) {
                startActiveListeningSession();
            }
        }, 300);
    }

    public synchronized void stopFriendMode() {
        Log.d(TAG, "Stopping Friend Mode and releasing resources");
        setState(FriendModeState.DISABLED);

        isListeningSessionActive = false;
        cancelPendingRestarts();
        cancelTurnCountdown();
        cancelPendingAcknowledgement();
        if (wakeWordEngine != null) wakeWordEngine.stopListening();
        if (sttEngine != null) sttEngine.cancel();
        if (ttsEngine != null) ttsEngine.stop();
        if (floatingOverlay != null) {
            floatingOverlay.clearTranscript();
            floatingOverlay.hide();
        }

        stopForeground(true);
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.cancel(NOTIFICATION_ID);
        }
    }

    public synchronized void pauseFriendMode() {
        Log.d(TAG, "Pausing Friend Mode: stopping audio capture, pending requests, and speech");
        isListeningSessionActive = false;
        cancelPendingRestarts();
        cancelTurnCountdown();
        cancelPendingAcknowledgement();
        if (wakeWordEngine != null) wakeWordEngine.stopListening();
        if (sttEngine != null) sttEngine.cancel();
        if (ttsEngine != null) ttsEngine.stop();
        if (floatingOverlay != null) {
            floatingOverlay.clearTranscript();
        }
        setState(FriendModeState.IDLE);
        updateNotification("Friend Mode paused", "Tap Resume in notification or app to continue");
    }

    public synchronized void resumeFriendMode() {
        Log.d(TAG, "Resuming Friend Mode from paused state");
        if (currentState == FriendModeState.DISABLED) return;
        consecutiveSilenceTimeouts = 0;
        cancelTurnCountdown();
        cancelPendingAcknowledgement();
        startWakeListening();
        updateNotification("Friend Mode active", "Listening for 'Hello macha' • Tap 👋 anytime");
    }

    public void setState(FriendModeState newState) {
        this.currentState = newState;
        Log.d(TAG, "FriendMode state changed to: " + newState);

        if (floatingOverlay != null) {
            floatingOverlay.updateState(newState);
        }

        if (serviceCallback != null) {
            mainHandler.post(() -> serviceCallback.onStateChanged(newState));
        }
    }

    public FriendModeState getCurrentState() {
        return currentState;
    }

    public void setLanguage(String lang) {
        this.language = lang != null ? lang : "en-IN";
        this.commandRecognitionLanguage = mapCommandLanguage(this.language);
        if (ttsEngine != null) ttsEngine.setLanguage(this.commandRecognitionLanguage);
    }

    public void setFloatingEmojiEnabled(boolean enabled) {
        this.floatingEmojiEnabled = enabled;
        if (floatingOverlay != null) {
            if (enabled && currentState != FriendModeState.DISABLED && FloatingEmojiOverlay.canDrawOverlays(this)) {
                floatingOverlay.show();
            } else {
                floatingOverlay.hide();
            }
        }
    }

    public void setShowLiveTranscriptEnabled(boolean enabled) {
        this.showLiveTranscript = enabled;
        getSharedPreferences("hello_friend_prefs", MODE_PRIVATE)
                .edit().putBoolean("show_live_transcript", enabled).apply();
        if (floatingOverlay != null) {
            floatingOverlay.setShowLiveTranscript(enabled);
        }
    }

    public boolean isShowLiveTranscriptEnabled() {
        return showLiveTranscript;
    }

    public void setServiceCallback(ServiceCallback callback) {
        this.serviceCallback = callback;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Hello Friend Mode",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Background voice listening and companion service for Hello");
            channel.setShowBadge(false);

            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildNotification(String title, String content) {
        Intent openAppIntent = new Intent(this, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        Intent stopIntent = new Intent(this, FriendModeService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPendingIntent = PendingIntent.getService(
                this,
                1,
                stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        boolean isPaused = (currentState == FriendModeState.IDLE);
        Intent pauseIntent = new Intent(this, FriendModeService.class);
        pauseIntent.setAction(isPaused ? ACTION_RESUME : ACTION_PAUSE);
        PendingIntent pausePendingIntent = PendingIntent.getService(
                this,
                2,
                pauseIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle(title)
                .setContentText(content)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setContentIntent(pendingIntent);

        if (pendingTurnSubmissionRunnable != null || (cumulativeTurnText.length() > 0 && currentState == FriendModeState.ACTIVE_LISTENING)) {
            Intent answerNowIntent = new Intent(this, FriendModeService.class);
            answerNowIntent.setAction(ACTION_ANSWER_NOW);
            PendingIntent answerNowPending = PendingIntent.getService(
                    this,
                    3,
                    answerNowIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
            );
            builder.addAction(android.R.drawable.ic_media_play, "Answer Now", answerNowPending);
        } else if (currentState == FriendModeState.SPEAKING) {
            Intent interruptIntent = new Intent(this, FriendModeService.class);
            interruptIntent.setAction(ACTION_INTERRUPT_STOP);
            PendingIntent interruptPending = PendingIntent.getService(
                    this,
                    4,
                    interruptIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
            );
            builder.addAction(android.R.drawable.ic_media_pause, "Stop", interruptPending);
        }

        builder.addAction(
                isPaused ? android.R.drawable.ic_media_play : android.R.drawable.ic_media_pause,
                isPaused ? "Resume" : "Pause",
                pausePendingIntent
        );
        builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Close", stopPendingIntent);

        return builder.build();
    }

    private void updateNotification(String title, String content) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && currentState != FriendModeState.DISABLED) {
            nm.notify(NOTIFICATION_ID, buildNotification(title, content));
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "FriendModeService onDestroy: cleaning up");
        stopFriendMode();

        if (wakeWordEngine != null) wakeWordEngine.destroy();
        if (sttEngine != null) sttEngine.destroy();
        if (ttsEngine != null) ttsEngine.destroy();
        if (floatingOverlay != null) floatingOverlay.destroy();

        instance = null;
        super.onDestroy();
    }
}
