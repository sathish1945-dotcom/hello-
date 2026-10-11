package com.hello.ai.friendmode;

import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;

import java.util.Locale;
import java.util.UUID;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * TextToSpeechEngine: Encapsulates Android native TextToSpeech.
 * Supports Tamil and English with graceful fallbacks.
 * Prevents overlapping utterances and cleanly releases audio resources.
 */
public class TextToSpeechEngine implements TextToSpeech.OnInitListener {
    private static final String TAG = "TextToSpeechEngine";

    public interface TTSCallback {
        void onInit(boolean success);
        void onSpeechStart(String utteranceId);
        void onSpeechDone(String utteranceId);
        void onSpeechError(String utteranceId, String error);
    }

    private final Context context;
    private TextToSpeech tts;
    private boolean isInitialized = false;
    private boolean isSpeaking = false;
    private TTSCallback callback;
    private String currentLanguage = "auto";
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Map<String, Runnable> utteranceCallbacks = new ConcurrentHashMap<>();

    public TextToSpeechEngine(Context context) {
        this.context = context.getApplicationContext();
        initialize();
    }

    private void initialize() {
        mainHandler.post(() -> {
            try {
                tts = new TextToSpeech(context, this);
            } catch (Exception e) {
                Log.e(TAG, "Failed to instantiate TextToSpeech", e);
                if (callback != null) {
                    callback.onInit(false);
                }
            }
        });
    }

    public void setCallback(TTSCallback callback) {
        this.callback = callback;
    }

    public void setLanguage(String lang) {
        this.currentLanguage = lang != null ? lang : "auto";
        applyLanguage();
    }

    private void applyLanguage() {
        if (!isInitialized || tts == null) return;

        try {
            Locale targetLocale;
            if ("ta".equalsIgnoreCase(currentLanguage) || "ta-IN".equalsIgnoreCase(currentLanguage)) {
                targetLocale = new Locale("ta", "IN");
            } else if ("en".equalsIgnoreCase(currentLanguage) || "en-US".equalsIgnoreCase(currentLanguage)) {
                targetLocale = Locale.US;
            } else if ("en-IN".equalsIgnoreCase(currentLanguage)) {
                targetLocale = new Locale("en", "IN");
            } else {
                // Auto: try device default or Indian English
                targetLocale = Locale.getDefault();
            }

            int result = tts.setLanguage(targetLocale);
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                Log.w(TAG, "Target locale not supported: " + targetLocale + ", falling back to English");
                tts.setLanguage(Locale.ENGLISH);
            }
        } catch (Exception e) {
            Log.w(TAG, "Error applying TTS language", e);
        }
    }

    @Override
    public void onInit(int status) {
        if (status == TextToSpeech.SUCCESS) {
            isInitialized = true;
            Log.d(TAG, "TextToSpeech initialized successfully");
            applyLanguage();
            setupProgressListener();
            if (callback != null) {
                callback.onInit(true);
            }
        } else {
            isInitialized = false;
            Log.e(TAG, "Failed to initialize TextToSpeech with code: " + status);
            if (callback != null) {
                callback.onInit(false);
            }
        }
    }

    private void setupProgressListener() {
        if (tts == null) return;
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String utteranceId) {
                isSpeaking = true;
                Log.d(TAG, "TTS started utterance: " + utteranceId);
                if (callback != null) {
                    mainHandler.post(() -> callback.onSpeechStart(utteranceId));
                }
            }

            @Override
            public void onDone(String utteranceId) {
                isSpeaking = false;
                Log.d(TAG, "TTS completed utterance: " + utteranceId);
                Runnable onDone = utteranceCallbacks.remove(utteranceId);
                if (onDone != null) {
                    mainHandler.post(onDone);
                }
                if (callback != null) {
                    mainHandler.post(() -> callback.onSpeechDone(utteranceId));
                }
            }

            @Override
            public void onError(String utteranceId) {
                isSpeaking = false;
                Log.e(TAG, "TTS error on utterance: " + utteranceId);
                Runnable onDone = utteranceCallbacks.remove(utteranceId);
                if (onDone != null) {
                    mainHandler.post(onDone);
                }
                if (callback != null) {
                    mainHandler.post(() -> callback.onSpeechError(utteranceId, "Playback error"));
                }
            }

            @Override
            public void onError(String utteranceId, int errorCode) {
                isSpeaking = false;
                Log.e(TAG, "TTS error code " + errorCode + " on utterance: " + utteranceId);
                Runnable onDone = utteranceCallbacks.remove(utteranceId);
                if (onDone != null) {
                    mainHandler.post(onDone);
                }
                if (callback != null) {
                    mainHandler.post(() -> callback.onSpeechError(utteranceId, "Playback error: " + errorCode));
                }
            }
        });
    }


    public synchronized void speak(String text, Runnable onDone) {
        if (text == null || text.trim().isEmpty()) {
            if (onDone != null) onDone.run();
            return;
        }

        // Stop any currently playing audio so utterances don't overlap
        stop();

        mainHandler.post(() -> {
            if (!isInitialized || tts == null) {
                Log.w(TAG, "TTS not ready yet to speak: " + text);
                if (onDone != null) onDone.run();
                return;
            }

            // Detect if text contains Tamil characters (Unicode block 0B80-0BFF)
            boolean hasTamil = false;
            for (char c : text.toCharArray()) {
                if (c >= 0x0B80 && c <= 0x0BFF) {
                    hasTamil = true;
                    break;
                }
            }

            if (hasTamil) {
                int res = tts.setLanguage(new Locale("ta", "IN"));
                if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) {
                    Log.w(TAG, "Tamil voice not installed on device; using default voice");
                    tts.setLanguage(Locale.ENGLISH);
                }
            }

            String utteranceId = "friend_msg_" + UUID.randomUUID().toString();
            if (onDone != null) {
                utteranceCallbacks.put(utteranceId, onDone);
            }
            Bundle params = new Bundle();
            params.putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId);

            int result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId);
            if (result == TextToSpeech.ERROR) {
                Log.e(TAG, "Failed to queue TTS utterance");
                isSpeaking = false;
                utteranceCallbacks.remove(utteranceId);
                if (onDone != null) onDone.run();
            }
        });
    }

    public synchronized void stop() {
        utteranceCallbacks.clear();
        if (tts != null) {
            try {
                tts.stop();
            } catch (Exception e) {
                Log.w(TAG, "Error stopping TTS", e);
            }
        }
        isSpeaking = false;
    }


    public boolean isSpeaking() {
        return isSpeaking;
    }

    public synchronized void destroy() {
        stop();
        if (tts != null) {
            try {
                tts.shutdown();
            } catch (Exception ignored) {}
            tts = null;
        }
        isInitialized = false;
        callback = null;
    }
}
