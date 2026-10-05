package com.hello.ai.friendmode;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * WakeWordEngine: Abstraction for wake phrase detection.
 * Matches phrases like "hello macha", "hey macha", "macha"
 * and allows drop-in replacement by offline engines (e.g. Porcupine, Vosk).
 */
public class WakeWordEngine {
    private static final String TAG = "WakeWordEngine";

    public interface WakeWordListener {
        void onWakeWordDetected(String phrase);
        void onWakeListeningStarted();
        void onWakeListeningStopped();
        void onError(String error);
    }

    private final Context context;
    private WakeWordListener listener;
    private boolean isListening = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private static final List<String> DEFAULT_WAKE_PHRASES = Arrays.asList(
            "hello macha",
            "hey macha",
            "macha",
            "allo macha",
            "hello matcha",
            "வணக்கம் மச்சான்"
    );

    public WakeWordEngine(Context context) {
        this.context = context.getApplicationContext();
    }

    public void setListener(WakeWordListener listener) {
        this.listener = listener;
    }

    public void startListening() {
        if (isListening) return;
        isListening = true;
        Log.d(TAG, "WakeWordEngine started listening for wake phrases");
        if (listener != null) {
            mainHandler.post(() -> listener.onWakeListeningStarted());
        }
    }

    public void stopListening() {
        if (!isListening) return;
        isListening = false;
        Log.d(TAG, "WakeWordEngine stopped listening");
        if (listener != null) {
            mainHandler.post(() -> listener.onWakeListeningStopped());
        }
    }

    public boolean isListening() {
        return isListening;
    }

    /**
     * Inspects recognized text to determine whether any accepted wake phrase is present.
     */
    public boolean checkWakePhrase(String rawText) {
        if (rawText == null || rawText.trim().isEmpty()) {
            return false;
        }

        String cleaned = rawText.toLowerCase(Locale.ROOT)
                .replaceAll("[^a-zA-Z0-9\\u0B80-\\u0BFF\\s]", " ")
                .replaceAll("\\s+", " ")
                .trim();

        for (String phrase : DEFAULT_WAKE_PHRASES) {
            if (cleaned.contains(phrase) || phrase.equals(cleaned)) {
                Log.d(TAG, "Wake phrase matched: '" + phrase + "' in raw input: '" + rawText + "'");
                if (listener != null) {
                    mainHandler.post(() -> listener.onWakeWordDetected(phrase));
                }
                return true;
            }
        }
        return false;
    }

    public void destroy() {
        stopListening();
        listener = null;
    }
}
