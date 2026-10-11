package com.hello.ai.friendmode;

import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

/**
 * FloatingEmojiOverlay: Draggable floating overlay bubble with 👋 emoji.
 * Uses WindowManager TYPE_APPLICATION_OVERLAY.
 * Allows tapping to activate listening, dragging across the screen,
 * and long pressing to close/disable Friend Mode.
 */
public class FloatingEmojiOverlay {
    private static final String TAG = "FloatingEmojiOverlay";

    public interface OverlayInteractionListener {
        void onOverlayTapped();
        void onOverlayLongPressed();
        void onOverlayCloseRequested();
        void onAnswerNowRequested();
        void onStopRequested();
    }

    private final Context context;
    private final WindowManager windowManager;
    private View overlayView;
    private TextView emojiTextView;
    private ImageView characterImageView;
    private GradientDrawable backgroundDrawable;
    private View statusIndicatorView;
    private WindowManager.LayoutParams layoutParams;
    private OverlayInteractionListener listener;
    private boolean isShowing = false;
    private boolean isPendingShow = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private float initialTouchX;
    private float initialTouchY;
    private int initialX;
    private int initialY;
    private boolean isDragging = false;
    private FriendModeState currentState = FriendModeState.DISABLED;
    private static final int CLICK_DRAG_TOLERANCE = 15;

    public FloatingEmojiOverlay(Context context, OverlayInteractionListener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
        this.windowManager = (WindowManager) this.context.getSystemService(Context.WINDOW_SERVICE);
    }

    public static boolean canDrawOverlays(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return Settings.canDrawOverlays(ctx);
        }
        return true;
    }

    public synchronized void show() {
        if (isShowing || isPendingShow) {
            Log.d(TAG, "Overlay is already showing or pending, ignoring duplicate show()");
            return;
        }

        if (!canDrawOverlays(context)) {
            Log.w(TAG, "Cannot show overlay: SYSTEM_ALERT_WINDOW permission not granted");
            return;
        }

        isPendingShow = true;

        mainHandler.post(() -> {
            try {
                if (overlayView == null) {
                    createOverlayView();
                }

                if (overlayView.getParent() != null || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT && overlayView.isAttachedToWindow())) {
                    Log.d(TAG, "Overlay view is already attached to WindowManager");
                    isShowing = true;
                    isPendingShow = false;
                    return;
                }

                int layoutType;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    layoutType = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
                } else {
                    layoutType = WindowManager.LayoutParams.TYPE_PHONE;
                }

                int sizeInPx = dpToPx(56);
                layoutParams = new WindowManager.LayoutParams(
                        sizeInPx,
                        sizeInPx,
                        layoutType,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
                                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                        PixelFormat.TRANSLUCENT
                );

                layoutParams.gravity = Gravity.TOP | Gravity.START;
                layoutParams.x = 24;
                layoutParams.y = dpToPx(120);

                windowManager.addView(overlayView, layoutParams);
                isShowing = true;
                Log.d(TAG, "FloatingEmojiOverlay added to WindowManager");
            } catch (Exception e) {
                Log.e(TAG, "Failed to display floating emoji overlay", e);
                isShowing = false;
            } finally {
                isPendingShow = false;
            }
        });
    }


    private void createOverlayView() {
        FrameLayout container = new FrameLayout(context);
        int size = dpToPx(56);
        container.setLayoutParams(new FrameLayout.LayoutParams(size, size));

        // Circular background with subtle elevation shadow and cyan/pink glow theme
        backgroundDrawable = new GradientDrawable();
        backgroundDrawable.setShape(GradientDrawable.OVAL);
        backgroundDrawable.setColor(Color.parseColor("#09090B"));
        backgroundDrawable.setStroke(dpToPx(2), Color.parseColor("#06B6D4")); // Cyan brand ring

        container.setBackground(backgroundDrawable);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            container.setElevation(dpToPx(8));
        }

        // Compact smiling characters icon (from user artwork)
        characterImageView = new ImageView(context);
        boolean hasCustomIcon = false;
        try {
            int resId = context.getResources().getIdentifier("ic_friend_mode", "drawable", context.getPackageName());
            if (resId != 0) {
                characterImageView.setImageResource(resId);
                characterImageView.setScaleType(ImageView.ScaleType.CENTER_CROP);
                hasCustomIcon = true;
            }
        } catch (Exception ignored) {}

        FrameLayout.LayoutParams iconParams = new FrameLayout.LayoutParams(
                dpToPx(44),
                dpToPx(44)
        );
        iconParams.gravity = Gravity.CENTER;
        characterImageView.setLayoutParams(iconParams);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            characterImageView.setClipToOutline(true);
        }
        container.addView(characterImageView);

        // Fallback or state emoji TextView (hidden if custom icon loaded)
        emojiTextView = new TextView(context);
        emojiTextView.setText("👋");
        emojiTextView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
        emojiTextView.setGravity(Gravity.CENTER);
        FrameLayout.LayoutParams emojiParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        );
        emojiParams.gravity = Gravity.CENTER;
        container.addView(emojiTextView, emojiParams);
        if (hasCustomIcon) {
            emojiTextView.setVisibility(View.GONE);
        }

        // Small pulse/status indicator dot
        statusIndicatorView = new View(context);
        int dotSize = dpToPx(10);
        FrameLayout.LayoutParams dotParams = new FrameLayout.LayoutParams(dotSize, dotSize);
        dotParams.gravity = Gravity.BOTTOM | Gravity.END;
        dotParams.setMargins(0, 0, dpToPx(4), dpToPx(4));

        GradientDrawable dotBg = new GradientDrawable();
        dotBg.setShape(GradientDrawable.OVAL);
        dotBg.setColor(Color.parseColor("#06B6D4")); // Cyan idle/listening
        statusIndicatorView.setBackground(dotBg);
        container.addView(statusIndicatorView, dotParams);

        // Touch & Drag Handling
        container.setOnTouchListener(new View.OnTouchListener() {
            private long touchStartTime = 0;
            private boolean longPressTriggered = false;
            private final Runnable longPressRunnable = () -> {
                if (!isDragging && isShowing) {
                    longPressTriggered = true;
                    Log.d(TAG, "Overlay long-pressed");
                    if (listener != null) {
                        listener.onOverlayLongPressed();
                    }
                }
            };

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                if (layoutParams == null) return false;

                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        touchStartTime = System.currentTimeMillis();
                        longPressTriggered = false;
                        isDragging = false;
                        initialX = layoutParams.x;
                        initialY = layoutParams.y;
                        initialTouchX = event.getRawX();
                        initialTouchY = event.getRawY();
                        mainHandler.postDelayed(longPressRunnable, 800);
                        return true;

                    case MotionEvent.ACTION_MOVE:
                        float deltaX = event.getRawX() - initialTouchX;
                        float deltaY = event.getRawY() - initialTouchY;

                        if (Math.abs(deltaX) > CLICK_DRAG_TOLERANCE || Math.abs(deltaY) > CLICK_DRAG_TOLERANCE) {
                            isDragging = true;
                            mainHandler.removeCallbacks(longPressRunnable);
                        }

                        if (isDragging && isShowing && overlayView != null) {
                            layoutParams.x = initialX + (int) deltaX;
                            layoutParams.y = initialY + (int) deltaY;
                            try {
                                windowManager.updateViewLayout(overlayView, layoutParams);
                            } catch (Exception ignored) {}
                        }
                        return true;

                    case MotionEvent.ACTION_UP:
                        mainHandler.removeCallbacks(longPressRunnable);
                        long touchDuration = System.currentTimeMillis() - touchStartTime;

                        if (!isDragging && !longPressTriggered && touchDuration < 400) {
                            Log.d(TAG, "Overlay tapped in state: " + currentState);
                            if (listener != null) {
                                if (currentState == FriendModeState.ACTIVE_LISTENING || currentState == FriendModeState.WAITING_FOR_FINISH) {
                                    listener.onAnswerNowRequested();
                                } else if (currentState == FriendModeState.SPEAKING) {
                                    listener.onStopRequested();
                                } else {
                                    listener.onOverlayTapped();
                                }
                            }
                        }
                        return true;

                    case MotionEvent.ACTION_CANCEL:
                        mainHandler.removeCallbacks(longPressRunnable);
                        return true;
                }
                return false;
            }
        });

        overlayView = container;
    }

    public synchronized void updateState(FriendModeState state) {
        this.currentState = state;
        mainHandler.post(() -> {
            if (statusIndicatorView == null) return;

            GradientDrawable dot = new GradientDrawable();
            dot.setShape(GradientDrawable.OVAL);

            int strokeColor = Color.parseColor("#06B6D4"); // Cyan default

            switch (state) {
                case ACTIVE_LISTENING:
                    strokeColor = Color.parseColor("#EC4899"); // Pink
                    dot.setColor(Color.parseColor("#EF4444")); // Red when actively recording
                    if (emojiTextView != null) {
                        emojiTextView.setText("👂");
                        emojiTextView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
                    }
                    break;
                case WAITING_FOR_FINISH:
                    strokeColor = Color.parseColor("#F59E0B"); // Amber
                    dot.setColor(Color.parseColor("#F97316")); // Warm orange when waiting for speech end
                    if (emojiTextView != null) {
                        emojiTextView.setText("⏳");
                        emojiTextView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
                    }
                    break;
                case LISTENING_FOR_WAKE:
                    strokeColor = Color.parseColor("#06B6D4"); // Cyan
                    dot.setColor(Color.parseColor("#3B82F6")); // Blue when listening for wake phrase
                    if (emojiTextView != null) {
                        emojiTextView.setText("👋");
                        emojiTextView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
                    }
                    break;
                case THINKING:
                    strokeColor = Color.parseColor("#06B6D4"); // Cyan
                    dot.setColor(Color.parseColor("#F59E0B")); // Amber when thinking
                    if (emojiTextView != null) {
                        emojiTextView.setText("🤔");
                        emojiTextView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
                    }
                    break;
                case SPEAKING:
                    strokeColor = Color.parseColor("#EC4899"); // Pink
                    dot.setColor(Color.parseColor("#8B5CF6")); // Purple when speaking
                    if (emojiTextView != null) {
                        emojiTextView.setText("🗣️");
                        emojiTextView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
                    }
                    break;
                case ERROR:
                    strokeColor = Color.parseColor("#EF4444");
                    dot.setColor(Color.parseColor("#991B1B"));
                    if (emojiTextView != null) {
                        emojiTextView.setText("⚠️");
                        emojiTextView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
                    }
                    break;
                default:
                    strokeColor = Color.parseColor("#64748B");
                    dot.setColor(Color.parseColor("#10B981")); // Emerald
                    if (emojiTextView != null) {
                        emojiTextView.setText("👋");
                        emojiTextView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
                    }
                    break;
            }

            if (backgroundDrawable != null) {
                backgroundDrawable.setStroke(dpToPx(2), strokeColor);
            }
            statusIndicatorView.setBackground(dot);
        });
    }

    public synchronized void updateCountdown(int secondsRemaining) {
        // 10s countdown removed: emoji remains dedicated status indicator
    }

    public synchronized void hide() {
        if (!isShowing) return;

        mainHandler.post(() -> {
            try {
                if (overlayView != null && overlayView.isAttachedToWindow()) {
                    windowManager.removeView(overlayView);
                    Log.d(TAG, "FloatingEmojiOverlay removed from WindowManager");
                }
            } catch (Exception e) {
                Log.w(TAG, "Error removing overlay view", e);
            } finally {
                isShowing = false;
            }
        });
    }

    public synchronized void destroy() {
        hide();
        overlayView = null;
        listener = null;
    }

    public boolean isShowing() {
        return isShowing;
    }

    private int dpToPx(int dp) {
        return (int) TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                dp,
                context.getResources().getDisplayMetrics()
        );
    }
}
