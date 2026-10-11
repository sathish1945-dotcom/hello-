package com.hello.ai;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.hello.ai.friendmode.FriendModePlugin;
import com.hello.ai.auth.NativeGoogleAuthPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FriendModePlugin.class);
        registerPlugin(NativeGoogleAuthPlugin.class);
        super.onCreate(savedInstanceState);
        handleDeepLink(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleDeepLink(intent);
    }

    private void handleDeepLink(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        Uri uri = intent.getData();
        if ("hello".equals(uri.getScheme()) && "oauth-callback".equals(uri.getHost())) {
            NativeGoogleAuthPlugin.setLastDeepLink(uri.toString());
        }
    }
}
