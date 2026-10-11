package com.hello.ai.auth;

import android.app.Activity;
import android.content.Intent;
import android.util.Log;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.tasks.Task;

@CapacitorPlugin(name = "NativeGoogleAuth")
public class NativeGoogleAuthPlugin extends Plugin {
    private static final String TAG = "NativeGoogleAuth";
    private static final String DEFAULT_WEB_CLIENT_ID = "885739506439-2fok3opj8bgnja02at0e9ghs62hbjpju.apps.googleusercontent.com";

    private GoogleSignInClient googleSignInClient;

    private String resolveWebClientId(String passedClientId) {
        if (passedClientId != null && !passedClientId.trim().isEmpty()) {
            return passedClientId.trim();
        }

        // 1. Check if google-services.json generated default_web_client_id resource
        try {
            int resId = getContext().getResources().getIdentifier("default_web_client_id", "string", getContext().getPackageName());
            if (resId != 0) {
                String client = getContext().getString(resId);
                if (client != null && !client.trim().isEmpty()) {
                    Log.i(TAG, "Resolved web client ID from default_web_client_id resource");
                    return client.trim();
                }
            }
        } catch (Exception ignored) {}

        // 2. Check strings.xml for google_web_client_id
        try {
            int resId = getContext().getResources().getIdentifier("google_web_client_id", "string", getContext().getPackageName());
            if (resId != 0) {
                String client = getContext().getString(resId);
                if (client != null && !client.trim().isEmpty()) {
                    Log.i(TAG, "Resolved web client ID from strings.xml (google_web_client_id)");
                    return client.trim();
                }
            }
        } catch (Exception ignored) {}

        // 3. Fallback to constant
        Log.i(TAG, "Using default fallback web client ID");
        return DEFAULT_WEB_CLIENT_ID;
    }

    private GoogleSignInClient getClient(String serverClientId) {
        String clientId = resolveWebClientId(serverClientId);
        Log.i(TAG, "Configuring Google Sign-In with Web Client ID: " + clientId);

        GoogleSignInOptions gso = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestIdToken(clientId)
                .requestEmail()
                .build();

        return GoogleSignIn.getClient(getActivity(), gso);
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        try {
            String clientId = call.getString("clientId");
            googleSignInClient = getClient(clientId);

            // Clear any cached credentials so the account picker always shows
            googleSignInClient.signOut().addOnCompleteListener(getActivity(), signOutTask -> {
                Intent signInIntent = googleSignInClient.getSignInIntent();
                startActivityForResult(call, signInIntent, "handleSignInResult");
            });
        } catch (Exception e) {
            Log.e(TAG, "Error initiating Google Sign-In", e);
            call.reject("Failed to initiate Google Sign-In: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void handleSignInResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }

        Intent data = result != null ? result.getData() : null;
        if (data != null) {
            Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(data);
            try {
                GoogleSignInAccount account = task.getResult(ApiException.class);
                String idToken = account != null ? account.getIdToken() : null;

                if (idToken == null || idToken.isEmpty()) {
                    call.reject("Google Sign-In returned an empty ID token.", "NO_ID_TOKEN");
                    return;
                }

                JSObject response = new JSObject();
                response.put("idToken", idToken);
                response.put("email", account.getEmail());
                response.put("name", account.getDisplayName());
                response.put("photoUrl", account.getPhotoUrl() != null ? account.getPhotoUrl().toString() : null);

                call.resolve(response);
                return;
            } catch (ApiException e) {
                int statusCode = e.getStatusCode();
                Log.e(TAG, "Google Sign-In failed with status code: " + statusCode, e);
                String message = "Google Sign-In failed (code " + statusCode + ").";
                if (statusCode == 10) {
                    message = "Google Sign-In failed (code 10: DEVELOPER_ERROR). The Android app SHA-1 fingerprint must be added to the Google Cloud / Firebase Console.";
                } else if (statusCode == 12500) {
                    message = "Google Sign-In failed (code 12500: SIGN_IN_FAILED). Please check your internet connection and Google Play Services.";
                } else if (statusCode == 12501) {
                    message = "Google sign-in was cancelled by user.";
                }
                call.reject(message, String.valueOf(statusCode));
                return;
            } catch (Exception e) {
                Log.e(TAG, "Unexpected error parsing Google Sign-In result", e);
                call.reject("Unexpected error: " + e.getMessage());
                return;
            }
        }

        if (result != null && result.getResultCode() == Activity.RESULT_CANCELED) {
            call.reject("Google sign-in was cancelled by user.", "USER_CANCELLED");
            return;
        }

        call.reject("Google sign-in failed with no result data.", "NO_DATA");
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        try {
            if (googleSignInClient == null) {
                googleSignInClient = getClient(DEFAULT_WEB_CLIENT_ID);
            }
            googleSignInClient.signOut().addOnCompleteListener(getActivity(), task -> {
                JSObject ret = new JSObject();
                ret.put("success", true);
                call.resolve(ret);
            });
        } catch (Exception e) {
            call.reject("Failed to sign out: " + e.getMessage());
        }
    }

    private static volatile String lastDeepLinkUrl = null;

    public static synchronized void setLastDeepLink(String url) {
        lastDeepLinkUrl = url;
        Log.i(TAG, "Recorded pending deep link URL: " + url);
    }

    @PluginMethod
    public void getPendingDeepLink(PluginCall call) {
        JSObject ret = new JSObject();
        synchronized (NativeGoogleAuthPlugin.class) {
            ret.put("url", lastDeepLinkUrl);
            // Single-use retrieval: clear immediately so it cannot trigger duplicate actions
            lastDeepLinkUrl = null;
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void openSystemUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("URL cannot be empty");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Failed to launch external URL: " + url, e);
            call.reject("Failed to launch external browser: " + e.getMessage());
        }
    }
}
