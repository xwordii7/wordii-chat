package com.wordii.chat;

import android.util.Log;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class WordiiMessagingService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);
        Log.i("WordiiFCM", "FCM message received");
    }

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        Log.i("WordiiFCM", "FCM token refreshed");
    }
}
