package com.hello.ai;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.hello.ai.friendmode.FriendModePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FriendModePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
