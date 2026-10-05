package com.hello.ai.friendmode;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * FriendModePlugin: Capacitor plugin exposing native Friend Mode background service,
 * floating emoji overlay, STT, wake phrase, and TTS to the React web application.
 */
@CapacitorPlugin(
        name = "FriendMode",
        permissions = {
                @Permission(strings = {Manifest.permission.RECORD_AUDIO}, alias = "microphone"),
                @Permission(strings = {Manifest.permission.POST_NOTIFICATIONS}, alias = "notifications")
        }
)
public class FriendModePlugin extends Plugin {
    private static final String TAG = "FriendModePlugin";
    private FriendModeService boundService;

    @Override
    public void load() {
        super.load();
        Log.d(TAG, "FriendModePlugin loaded");
        connectToServiceIfRunning();
    }

    private void connectToServiceIfRunning() {
        FriendModeService svc = FriendModeService.getInstance();
        if (svc != null) {
            boundService = svc;
            attachServiceCallbacks(svc);
        }
    }

    private void attachServiceCallbacks(FriendModeService svc) {
        svc.setServiceCallback(new FriendModeService.ServiceCallback() {
            @Override
            public void onStateChanged(FriendModeState state) {
                JSObject data = new JSObject();
                data.put("state", state.name());
                notifyListeners("stateChange", data);
            }

            @Override
            public void onWakeDetected(String phrase) {
                JSObject data = new JSObject();
                data.put("phrase", phrase);
                notifyListeners("wakeWordDetected", data);
            }

            @Override
            public void onSpeechRecognized(String text, boolean isFinal) {
                JSObject data = new JSObject();
                data.put("text", text);
                data.put("isFinal", isFinal);
                notifyListeners("speechRecognized", data);
            }

            @Override
            public void onSpeechCompleted(String text) {
                JSObject data = new JSObject();
                data.put("text", text);
                notifyListeners("speechCompleted", data);
            }

            @Override
            public void onAgentSpeechRequested(String text) {
                JSObject data = new JSObject();
                data.put("text", text);
                notifyListeners("agentSpeechRequested", data);
            }

            @Override
            public void onError(String error) {
                JSObject data = new JSObject();
                data.put("error", error);
                notifyListeners("error", data);
            }
        });
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        boolean isRunning = FriendModeService.isRunning();
        FriendModeService svc = FriendModeService.getInstance();
        String state = svc != null ? svc.getCurrentState().name() : FriendModeState.DISABLED.name();

        ret.put("enabled", isRunning);
        ret.put("state", state);
        ret.put("hasOverlayPermission", FloatingEmojiOverlay.canDrawOverlays(getContext()));
        ret.put("isNative", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void enableFriendMode(PluginCall call) {
        Context ctx = getContext();
        String lang = call.getString("language", "ta-IN");
        boolean floatingEmoji = call.getBoolean("floatingEmoji", true);

        // Check overlay permission
        if (floatingEmoji && !FloatingEmojiOverlay.canDrawOverlays(ctx)) {
            Log.w(TAG, "Overlay permission not granted; starting service without overlay or requesting permission");
        }

        try {
            Intent intent = new Intent(ctx, FriendModeService.class);
            intent.setAction(FriendModeService.ACTION_START);
            intent.putExtra(FriendModeService.EXTRA_LANGUAGE, lang);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent);
            } else {
                ctx.startService(intent);
            }

            // Connect callback
            FriendModeService svc = FriendModeService.getInstance();
            if (svc != null) {
                boundService = svc;
                svc.setFloatingEmojiEnabled(floatingEmoji);
                attachServiceCallbacks(svc);
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("state", FriendModeState.STARTING.name());
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Failed to start FriendModeService", e);
            call.reject("Failed to start Friend Mode: " + e.getMessage());
        }
    }

    @PluginMethod
    public void disableFriendMode(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent intent = new Intent(ctx, FriendModeService.class);
            intent.setAction(FriendModeService.ACTION_STOP);
            ctx.startService(intent);

            FriendModeService svc = FriendModeService.getInstance();
            if (svc != null) {
                svc.stopFriendMode();
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("state", FriendModeState.DISABLED.name());
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop FriendModeService", e);
            call.reject("Failed to stop Friend Mode: " + e.getMessage());
        }
    }

    @PluginMethod
    public void triggerWake(PluginCall call) {
        FriendModeService svc = FriendModeService.getInstance();
        if (svc != null && svc.getCurrentState() != FriendModeState.DISABLED) {
            svc.startActiveListeningSession();
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } else {
            call.reject("Friend Mode is not currently active");
        }
    }

    @PluginMethod
    public void speakResponse(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.trim().isEmpty()) {
            call.reject("Text to speak cannot be empty");
            return;
        }

        FriendModeService svc = FriendModeService.getInstance();
        if (svc != null) {
            svc.speak(text);
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } else {
            // Service not active, start one-off speak intent
            Intent intent = new Intent(getContext(), FriendModeService.class);
            intent.setAction(FriendModeService.ACTION_SPEAK);
            intent.putExtra(FriendModeService.EXTRA_TEXT_TO_SPEAK, text);
            getContext().startService(intent);

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void setLanguage(PluginCall call) {
        String lang = call.getString("language", "ta-IN");
        FriendModeService svc = FriendModeService.getInstance();
        if (svc != null) {
            svc.setLanguage(lang);
        }
        JSObject ret = new JSObject();
        ret.put("success", true);
        ret.put("language", lang);
        call.resolve(ret);
    }

    @PluginMethod
    public void setFloatingEmoji(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", true);
        FriendModeService svc = FriendModeService.getInstance();
        if (svc != null) {
            svc.setFloatingEmojiEnabled(enabled);
        }
        JSObject ret = new JSObject();
        ret.put("success", true);
        ret.put("floatingEmoji", enabled);
        call.resolve(ret);
    }

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        JSObject ret = new JSObject();
        boolean micGranted = getPermissionState("microphone").equals(com.getcapacitor.PermissionState.GRANTED);
        boolean notifGranted = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notifGranted = getPermissionState("notifications").equals(com.getcapacitor.PermissionState.GRANTED);
        }
        boolean overlayGranted = FloatingEmojiOverlay.canDrawOverlays(getContext());

        ret.put("microphone", micGranted ? "granted" : "denied");
        ret.put("notifications", notifGranted ? "granted" : "denied");
        ret.put("overlay", overlayGranted ? "granted" : "denied");
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        requestPermissionForAliases(new String[]{"microphone", "notifications"}, call, "permissionsCallback");
    }

    @PermissionCallback
    private void permissionsCallback(PluginCall call) {
        checkPermissions(call);
    }

    @PluginMethod
    public void requestOverlayPermission(PluginCall call) {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (!Settings.canDrawOverlays(ctx)) {
                Intent intent = new Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + ctx.getPackageName())
                );
                startActivityForResult(call, intent, "overlayPermissionResult");
                return;
            }
        }
        JSObject ret = new JSObject();
        ret.put("granted", true);
        call.resolve(ret);
    }

    @ActivityCallback
    private void overlayPermissionResult(PluginCall call, ActivityResult result) {
        boolean granted = FloatingEmojiOverlay.canDrawOverlays(getContext());
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }
}
