package com.hello.ai.friendmode;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Log;

import java.util.ArrayList;
import java.util.Locale;

/**
 * SpeechToTextEngine: Encapsulates Android SpeechRecognizer.
 * Supports Tamil (ta-IN), English (en-IN / en-US), and mixed Tanglish speech.
 * Handles microphone errors, session timeouts, and lifecycle transitions.
 */
public class SpeechToTextEngine implements RecognitionListener {
    private static final String TAG = "SpeechToTextEngine";

    public interface SpeechCallback {
        void onReady();
        void onBeginningOfSpeech();
        void onRmsChanged(float rmsdB);
        void onResult(String text, boolean isFinal);
        void onError(int errorCode, String errorMessage);
        void onEndOfSpeech();
    }

    private final Context context;
    private SpeechRecognizer speechRecognizer;
    private SpeechCallback callback;
    private boolean isListening = false;
    private String selectedLanguage = "ta-IN";
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private int consecutiveErrorCount = 0;
    private static final int MAX_CONSECUTIVE_ERRORS = 5;

    public SpeechToTextEngine(Context context) {
        this.context = context.getApplicationContext();
    }

    public void setCallback(SpeechCallback callback) {
        this.callback = callback;
    }

    public void setLanguage(String languageCode) {
        if (languageCode == null || languageCode.trim().isEmpty() || "auto".equalsIgnoreCase(languageCode)) {
            // Default to Indian English / Tamil context
            this.selectedLanguage = "ta-IN";
        } else {
            this.selectedLanguage = languageCode;
        }
    }

    public String getLanguage() {
        return selectedLanguage;
    }

    public boolean isListening() {
        return isListening;
    }

    public synchronized void startListening(SpeechCallback callback) {
        this.callback = callback;

        mainHandler.post(() -> {
            try {
                if (!SpeechRecognizer.isRecognitionAvailable(context)) {
                    Log.e(TAG, "SpeechRecognizer is not available on this device");
                    if (this.callback != null) {
                        this.callback.onError(-1, "Speech recognition is not available on this device");
                    }
                    return;
                }

                if (speechRecognizer != null) {
                    try {
                        speechRecognizer.destroy();
                    } catch (Exception ignored) {}
                    speechRecognizer = null;
                }

                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context);
                speechRecognizer.setRecognitionListener(this);

                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.getPackageName());
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);

                // Set primary language and additional languages for Tamil / English mixing
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, selectedLanguage);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, selectedLanguage);
                intent.putExtra(RecognizerIntent.EXTRA_ONLY_RETURN_LANGUAGE_PREFERENCE, false);

                isListening = true;
                speechRecognizer.startListening(intent);
                Log.d(TAG, "Speech recognition started with language: " + selectedLanguage);
            } catch (Exception e) {
                Log.e(TAG, "Failed to start speech recognition", e);
                isListening = false;
                if (this.callback != null) {
                    this.callback.onError(-2, "Failed to initialize microphone listener: " + e.getMessage());
                }
            }
        });
    }

    public synchronized void stopListening() {
        isListening = false;
        mainHandler.post(() -> {
            if (speechRecognizer != null) {
                try {
                    speechRecognizer.stopListening();
                    speechRecognizer.cancel();
                } catch (Exception e) {
                    Log.w(TAG, "Error while stopping speech recognizer", e);
                }
            }
        });
    }

    public synchronized void destroy() {
        isListening = false;
        mainHandler.post(() -> {
            if (speechRecognizer != null) {
                try {
                    speechRecognizer.destroy();
                } catch (Exception ignored) {}
                speechRecognizer = null;
            }
            callback = null;
        });
    }

    // RecognitionListener Callbacks
    @Override
    public void onReadyForSpeech(Bundle params) {
        Log.d(TAG, "SpeechRecognizer onReadyForSpeech");
        consecutiveErrorCount = 0;
        if (callback != null) {
            callback.onReady();
        }
    }

    @Override
    public void onBeginningOfSpeech() {
        Log.d(TAG, "SpeechRecognizer onBeginningOfSpeech");
        if (callback != null) {
            callback.onBeginningOfSpeech();
        }
    }

    @Override
    public void onRmsChanged(float rmsdB) {
        if (callback != null) {
            callback.onRmsChanged(rmsdB);
        }
    }

    @Override
    public void onBufferReceived(byte[] buffer) {
        // Raw audio buffer discarded per security rule: no raw audio retention
    }

    @Override
    public void onEndOfSpeech() {
        Log.d(TAG, "SpeechRecognizer onEndOfSpeech");
        if (callback != null) {
            callback.onEndOfSpeech();
        }
    }

    @Override
    public void onError(int error) {
        String message = getErrorMessage(error);
        Log.w(TAG, "SpeechRecognizer error: " + error + " (" + message + ")");
        isListening = false;
        consecutiveErrorCount++;

        if (callback != null) {
            callback.onError(error, message);
        }
    }

    @Override
    public void onResults(Bundle results) {
        isListening = false;
        consecutiveErrorCount = 0;
        ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (matches != null && !matches.isEmpty()) {
            String bestText = matches.get(0);
            Log.d(TAG, "SpeechRecognizer final result: " + bestText);
            if (callback != null) {
                callback.onResult(bestText, true);
            }
        } else {
            if (callback != null) {
                callback.onError(SpeechRecognizer.ERROR_NO_MATCH, "No speech recognized");
            }
        }
    }

    @Override
    public void onPartialResults(Bundle partialResults) {
        ArrayList<String> matches = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (matches != null && !matches.isEmpty()) {
            String partial = matches.get(0);
            if (callback != null) {
                callback.onResult(partial, false);
            }
        }
    }

    @Override
    public void onEvent(int eventType, Bundle params) {}

    private String getErrorMessage(int errorCode) {
        switch (errorCode) {
            case SpeechRecognizer.ERROR_AUDIO:
                return "Audio recording error";
            case SpeechRecognizer.ERROR_CLIENT:
                return "Client side error";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "Microphone permission required";
            case SpeechRecognizer.ERROR_NETWORK:
                return "Network error";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "Network timeout";
            case SpeechRecognizer.ERROR_NO_MATCH:
                return "No speech match recognized";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "Speech recognizer is busy";
            case SpeechRecognizer.ERROR_SERVER:
                return "Server error";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "No speech heard (timeout)";
            default:
                return "Unknown speech recognition error (" + errorCode + ")";
        }
    }
}
