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
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.hello.ai.MainActivity;

/**
 * FriendModeService: Android Foreground Service that runs Friend Mode.
 * Holds foreground notification, creates floating emoji overlay,
 * coordinates wake word detection, STT listening, and TTS playback.
 */
public class FriendModeService extends Service {
    private static final String TAG = "FriendModeService";

    public static final String ACTION_START = "com.hello.ai.friendmode.ACTION_START";
    public static final String ACTION_STOP = "com.hello.ai.friendmode.ACTION_STOP";
    public static final String ACTION_TRIGGER_WAKE = "com.hello.ai.friendmode.ACTION_TRIGGER_WAKE";
    public static final String ACTION_SPEAK = "com.hello.ai.friendmode.ACTION_SPEAK";
    public static final String EXTRA_TEXT_TO_SPEAK = "extra_text_to_speak";
    public static final String EXTRA_LANGUAGE = "extra_language";

    private static final String CHANNEL_ID = "hello_friend_mode_channel";
    private static final int NOTIFICATION_ID = 4040;

    public interface ServiceCallback {
        void onStateChanged(FriendModeState state);
        void onWakeDetected(String phrase);
        void onSpeechRecognized(String text, boolean isFinal);
        void onSpeechCompleted(String text);
        void onAgentSpeechRequested(String text);
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

    private String language = "ta-IN";
    private boolean floatingEmojiEnabled = true;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean isListeningSessionActive = false;

    public class LocalBinder extends Binder {
        public FriendModeService getService() {
            return FriendModeService.this;
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
        Log.d(TAG, "FriendModeService onCreate");

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
        });

        wakeWordEngine.setListener(new WakeWordEngine.WakeWordListener() {
            @Override
            public void onWakeWordDetected(String phrase) {
                Log.d(TAG, "Wake word detected by engine: " + phrase);
                onWakeDetected(phrase);
            }

            @Override
            public void onWakeListeningStarted() {
                if (currentState != FriendModeState.ACTIVE_LISTENING && currentState != FriendModeState.SPEAKING) {
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
                setState(FriendModeState.SPEAKING);
            }

            @Override
            public void onSpeechDone(String utteranceId) {
                Log.d(TAG, "TTS playback finished");
                // Resume listening for wake phrase
                mainHandler.postDelayed(() -> {
                    if (currentState != FriendModeState.DISABLED) {
                        startWakeListening();
                    }
                }, 400);
            }

            @Override
            public void onSpeechError(String utteranceId, String error) {
                Log.w(TAG, "TTS playback error: " + error);
                if (currentState != FriendModeState.DISABLED) {
                    startWakeListening();
                }
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
            if (lang != null) this.language = lang;
            startFriendMode();
        } else if (ACTION_STOP.equals(action)) {
            stopFriendMode();
            stopSelf();
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

    public void startWakeListening() {
        if (currentState == FriendModeState.DISABLED) return;

        setState(FriendModeState.LISTENING_FOR_WAKE);
        wakeWordEngine.startListening();

        sttEngine.setLanguage(language);
        sttEngine.startListening(new SpeechToTextEngine.SpeechCallback() {
            @Override
            public void onReady() {
                Log.d(TAG, "STT ready for wake listening");
            }

            @Override
            public void onBeginningOfSpeech() {}

            @Override
            public void onRmsChanged(float rmsdB) {}

            @Override
            public void onResult(String text, boolean isFinal) {
                Log.d(TAG, "STT heard during wake check: '" + text + "' (final=" + isFinal + ")");
                if (wakeWordEngine.checkWakePhrase(text)) {
                    // Handled in wake listener
                    return;
                }

                if (isFinal) {
                    // Loop back to listen for wake phrase
                    mainHandler.postDelayed(() -> {
                        if (currentState == FriendModeState.LISTENING_FOR_WAKE) {
                            startWakeListening();
                        }
                    }, 300);
                }
            }

            @Override
            public void onError(int errorCode, String errorMessage) {
                Log.d(TAG, "Wake STT loop cycle (" + errorMessage + ")");
                // Re-arm wake listening after brief delay if not disabled or busy
                mainHandler.postDelayed(() -> {
                    if (currentState == FriendModeState.LISTENING_FOR_WAKE) {
                        startWakeListening();
                    }
                }, 600);
            }

            @Override
            public void onEndOfSpeech() {}
        });
    }

    private void onWakeDetected(String phrase) {
        sttEngine.stopListening();
        wakeWordEngine.stopListening();

        if (serviceCallback != null) {
            serviceCallback.onWakeDetected(phrase);
        }

        // Brief cheerful acknowledgment tone or immediate active speech capture
        ttsEngine.speak("Sollu da, listening!", () -> {
            mainHandler.postDelayed(this::startActiveListeningSession, 150);
        });
    }

    public synchronized void startActiveListeningSession() {
        if (isListeningSessionActive) return;
        isListeningSessionActive = true;

        wakeWordEngine.stopListening();
        ttsEngine.stop();

        setState(FriendModeState.ACTIVE_LISTENING);
        updateNotification("Friend Mode listening...", "Speak your message now");

        sttEngine.setLanguage(language);
        sttEngine.startListening(new SpeechToTextEngine.SpeechCallback() {
            @Override
            public void onReady() {
                Log.d(TAG, "Active STT session ready");
            }

            @Override
            public void onBeginningOfSpeech() {}

            @Override
            public void onRmsChanged(float rmsdB) {}

            @Override
            public void onResult(String text, boolean isFinal) {
                if (serviceCallback != null) {
                    serviceCallback.onSpeechRecognized(text, isFinal);
                }

                if (isFinal && text != null && !text.trim().isEmpty()) {
                    isListeningSessionActive = false;
                    onUserUtteranceCaptured(text);
                }
            }

            @Override
            public void onError(int errorCode, String errorMessage) {
                Log.w(TAG, "Active listening error: " + errorMessage);
                isListeningSessionActive = false;
                setState(FriendModeState.IDLE);
                if (serviceCallback != null) {
                    serviceCallback.onError(errorMessage);
                }
                // Return to wake listening
                mainHandler.postDelayed(() -> startWakeListening(), 800);
            }

            @Override
            public void onEndOfSpeech() {
                isListeningSessionActive = false;
            }
        });
    }

    private void onUserUtteranceCaptured(String userText) {
        setState(FriendModeState.THINKING);
        updateNotification("Hello AI Thinking...", userText);

        if (serviceCallback != null) {
            serviceCallback.onSpeechCompleted(userText);
        } else {
            // Default native fallback reply if web UI bridge is detached
            speak("Kettaen da: " + userText + ". Connect pannikuren.");
        }
    }

    public void speak(String responseText) {
        setState(FriendModeState.SPEAKING);
        updateNotification("Hello AI Speaking", responseText);

        ttsEngine.speak(responseText, () -> {
            Log.d(TAG, "Speech finished: returning to wake listening");
            mainHandler.postDelayed(() -> {
                if (currentState != FriendModeState.DISABLED) {
                    startWakeListening();
                }
            }, 400);
        });
    }

    public void stopFriendMode() {
        Log.d(TAG, "Stopping Friend Mode and releasing resources");
        setState(FriendModeState.DISABLED);

        isListeningSessionActive = false;
        if (wakeWordEngine != null) wakeWordEngine.stopListening();
        if (sttEngine != null) sttEngine.stopListening();
        if (ttsEngine != null) ttsEngine.stop();
        if (floatingOverlay != null) floatingOverlay.hide();

        stopForeground(true);
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.cancel(NOTIFICATION_ID);
        }
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
        this.language = lang != null ? lang : "ta-IN";
        if (sttEngine != null) sttEngine.setLanguage(this.language);
        if (ttsEngine != null) ttsEngine.setLanguage(this.language);
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

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle(title)
                .setContentText(content)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setContentIntent(pendingIntent)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Disable", stopPendingIntent);

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
