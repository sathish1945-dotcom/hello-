package com.hello.ai.friendmode;

import android.animation.ValueAnimator;
import android.app.KeyguardManager;
import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.DisplayMetrics;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.LinearInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * FloatingEmojiOverlay: Draggable floating overlay mascot with live speech transcript bubble.
 * Uses WindowManager TYPE_APPLICATION_OVERLAY.
 * 
 * Features:
 * - 64dp compact cyan/pink mascot with alpha transparency (no black background).
 * - Live transcript bubble beside the mascot (max 3 lines, Tamil/English/Tanglish support).
 * - Dynamic positioning: left or right of mascot based on screen edge.
 * - State-driven visuals: calm (idle), cyan pulse (listening), orbit/pulse (thinking), pink pulse (speaking), dimmed (paused).
 * - Touch distinction: dragging vs tapping (15px tolerance).
 * - Tap handles Talk Now, Answer Now, Stop, Resume; Long-press handles Close.
 * - Privacy: Hides on lock screen, clears when turn ends or closed, respects showLiveTranscript setting.
 */
public class FloatingEmojiOverlay {
    private static final String TAG = "FloatingEmojiOverlay";
    private static final int MASCOT_SIZE_DP = 64;
    private static final int CLICK_DRAG_TOLERANCE = 15;

    public interface OverlayInteractionListener {
        void onOverlayTapped();
        void onOverlayLongPressed();
        void onOverlayCloseRequested();
        void onAnswerNowRequested();
        void onStopRequested();
        void onResumeRequested();
    }

    private final Context context;
    private final WindowManager windowManager;
    private OverlayInteractionListener listener;

    // Views
    private LinearLayout rootContainer;
    private FrameLayout mascotContainer;
    private ImageView mascotImageView;
    private View haloRingView;
    private View statusDotView;
    private FrameLayout bubbleFrame;
    private TextView transcriptTextView;

    // WindowManager parameters
    private WindowManager.LayoutParams layoutParams;
    private boolean isShowing = false;
    private boolean isPendingShow = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // Coordinates (in pixels, anchoring mascot)
    private int mascotX = 24;
    private int mascotY = 240;
    private float initialTouchX;
    private float initialTouchY;
    private int initialMascotX;
    private int initialMascotY;
    private boolean isDragging = false;
    private boolean bubbleOnLeft = false;

    // State & Animations
    private FriendModeState currentState = FriendModeState.DISABLED;
    private ValueAnimator pulseAnimator;
    private ValueAnimator orbitAnimator;

    // Transcript content
    private String currentTranscriptText = "";
    private boolean showLiveTranscript = true;

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
                if (rootContainer == null) {
                    createOverlayViews();
                }

                if (rootContainer.getParent() != null || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT && rootContainer.isAttachedToWindow())) {
                    Log.d(TAG, "Overlay view is already attached to WindowManager");
                    isShowing = true;
                    isPendingShow = false;
                    return;
                }

                int layoutType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                        ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                        : WindowManager.LayoutParams.TYPE_PHONE;

                layoutParams = new WindowManager.LayoutParams(
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        layoutType,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
                                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                        PixelFormat.TRANSLUCENT
                );

                layoutParams.gravity = Gravity.TOP | Gravity.START;

                // Initial position clamped to screen bounds
                mascotX = dpToPx(16);
                mascotY = dpToPx(160);
                clampMascotPosition();
                applyWindowCoordinates();

                windowManager.addView(rootContainer, layoutParams);
                isShowing = true;
                Log.d(TAG, "FloatingEmojiOverlay added to WindowManager with 64dp mascot");
            } catch (Exception e) {
                Log.e(TAG, "Failed to display floating mascot overlay", e);
                isShowing = false;
            } finally {
                isPendingShow = false;
            }
        });
    }

    private void createOverlayViews() {
        // Root container is horizontal: [Bubble] [Mascot] or [Mascot] [Bubble]
        rootContainer = new LinearLayout(context);
        rootContainer.setOrientation(LinearLayout.HORIZONTAL);
        rootContainer.setGravity(Gravity.CENTER_VERTICAL);
        rootContainer.setBackgroundColor(Color.TRANSPARENT);

        // --- Mascot View Container (64dp x 64dp) ---
        int mascotSize = dpToPx(MASCOT_SIZE_DP);
        mascotContainer = new FrameLayout(context);
        mascotContainer.setLayoutParams(new LinearLayout.LayoutParams(mascotSize, mascotSize));
        mascotContainer.setBackgroundColor(Color.TRANSPARENT);

        // 1. Halo Ring / Ambient Glow behind mascot
        haloRingView = new View(context);
        FrameLayout.LayoutParams haloParams = new FrameLayout.LayoutParams(mascotSize, mascotSize);
        haloParams.gravity = Gravity.CENTER;
        haloRingView.setLayoutParams(haloParams);

        GradientDrawable haloBg = new GradientDrawable();
        haloBg.setShape(GradientDrawable.OVAL);
        haloBg.setColor(Color.TRANSPARENT);
        haloBg.setStroke(dpToPx(2.5f), Color.parseColor("#06B6D4")); // Cyan brand ring
        haloRingView.setBackground(haloBg);
        mascotContainer.addView(haloRingView);

        // 2. Mascot Character Image View (56dp x 56dp centered, with alpha transparency)
        mascotImageView = new ImageView(context);
        int iconSize = dpToPx(56);
        FrameLayout.LayoutParams iconParams = new FrameLayout.LayoutParams(iconSize, iconSize);
        iconParams.gravity = Gravity.CENTER;
        mascotImageView.setLayoutParams(iconParams);
        mascotImageView.setScaleType(ImageView.ScaleType.FIT_CENTER);
        mascotImageView.setBackgroundColor(Color.TRANSPARENT);

        int resId = 0;
        try {
            resId = context.getResources().getIdentifier("ic_friend_mascot", "drawable", context.getPackageName());
            if (resId == 0) {
                resId = context.getResources().getIdentifier("ic_friend_mode", "drawable", context.getPackageName());
            }
        } catch (Exception ignored) {}

        if (resId != 0) {
            mascotImageView.setImageResource(resId);
        }
        mascotContainer.addView(mascotImageView);

        // 3. Status indicator dot (10dp x 10dp bottom-right)
        statusDotView = new View(context);
        int dotSize = dpToPx(10);
        FrameLayout.LayoutParams dotParams = new FrameLayout.LayoutParams(dotSize, dotSize);
        dotParams.gravity = Gravity.BOTTOM | Gravity.END;
        dotParams.setMargins(0, 0, dpToPx(6), dpToPx(6));

        GradientDrawable dotBg = new GradientDrawable();
        dotBg.setShape(GradientDrawable.OVAL);
        dotBg.setColor(Color.parseColor("#06B6D4"));
        statusDotView.setBackground(dotBg);
        mascotContainer.addView(statusDotView, dotParams);

        // --- Transcript Bubble Frame ---
        bubbleFrame = new FrameLayout(context);
        LinearLayout.LayoutParams bubbleLayoutParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        bubbleLayoutParams.setMargins(dpToPx(6), 0, dpToPx(6), 0);
        bubbleFrame.setLayoutParams(bubbleLayoutParams);
        bubbleFrame.setVisibility(View.GONE);

        GradientDrawable bubbleBg = new GradientDrawable();
        bubbleBg.setShape(GradientDrawable.RECTANGLE);
        bubbleBg.setCornerRadius(dpToPx(14));
        bubbleBg.setColor(Color.parseColor("#F018181B")); // Deep obsidian with 94% opacity
        bubbleBg.setStroke(dpToPx(1), Color.parseColor("#4006B6D4")); // Subtle cyan border
        bubbleFrame.setBackground(bubbleBg);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            bubbleFrame.setElevation(dpToPx(6));
        }

        // Transcript Text View
        transcriptTextView = new TextView(context);
        transcriptTextView.setTextColor(Color.WHITE);
        transcriptTextView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.0f);
        transcriptTextView.setMaxLines(3);
        transcriptTextView.setEllipsize(TextUtils.TruncateAt.END);
        transcriptTextView.setPadding(dpToPx(12), dpToPx(8), dpToPx(12), dpToPx(8));
        transcriptTextView.setMaxWidth(dpToPx(210));
        transcriptTextView.setLineSpacing(dpToPx(2), 1.0f);
        bubbleFrame.addView(transcriptTextView);

        // Initial layout structure: [Mascot] [Bubble]
        rootContainer.addView(mascotContainer);
        rootContainer.addView(bubbleFrame);

        // --- Touch, Drag & Click Handling on Mascot ---
        mascotContainer.setOnTouchListener(new View.OnTouchListener() {
            private long touchStartTime = 0;
            private boolean longPressTriggered = false;
            private final Runnable longPressRunnable = () -> {
                if (!isDragging && isShowing) {
                    longPressTriggered = true;
                    Log.d(TAG, "Overlay mascot long-pressed: requesting close");
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
                        initialMascotX = mascotX;
                        initialMascotY = mascotY;
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

                        if (isDragging && isShowing && rootContainer != null) {
                            mascotX = initialMascotX + (int) deltaX;
                            mascotY = initialMascotY + (int) deltaY;
                            clampMascotPosition();
                            updateBubbleAlignment();
                            applyWindowCoordinates();
                            try {
                                windowManager.updateViewLayout(rootContainer, layoutParams);
                            } catch (Exception ignored) {}
                        }
                        return true;

                    case MotionEvent.ACTION_UP:
                        mainHandler.removeCallbacks(longPressRunnable);
                        long touchDuration = System.currentTimeMillis() - touchStartTime;

                        if (!isDragging && !longPressTriggered && touchDuration < 400) {
                            Log.d(TAG, "Overlay mascot tapped in state: " + currentState);
                            if (listener != null) {
                                if (currentState == FriendModeState.ACTIVE_LISTENING || currentState == FriendModeState.WAITING_FOR_FINISH) {
                                    listener.onAnswerNowRequested();
                                } else if (currentState == FriendModeState.SPEAKING) {
                                    listener.onStopRequested();
                                } else if (currentState == FriendModeState.IDLE) {
                                    listener.onResumeRequested();
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
    }

    private void clampMascotPosition() {
        int screenWidth = getScreenWidth();
        int screenHeight = getScreenHeight();
        int statusBarHeight = getStatusBarHeight();
        int mascotSize = dpToPx(MASCOT_SIZE_DP);

        mascotX = Math.max(dpToPx(8), Math.min(mascotX, screenWidth - mascotSize - dpToPx(8)));
        mascotY = Math.max(statusBarHeight + dpToPx(8), Math.min(mascotY, screenHeight - mascotSize - dpToPx(48)));
    }

    private void updateBubbleAlignment() {
        if (rootContainer == null || bubbleFrame == null) return;

        int screenWidth = getScreenWidth();
        boolean shouldBeOnLeft = mascotX > (screenWidth / 2);

        if (shouldBeOnLeft != bubbleOnLeft) {
            bubbleOnLeft = shouldBeOnLeft;
            rootContainer.removeAllViews();
            if (bubbleOnLeft) {
                // Mascot is on right side of screen -> bubble appears on left: [Bubble] [Mascot]
                rootContainer.addView(bubbleFrame);
                rootContainer.addView(mascotContainer);
            } else {
                // Mascot is on left side of screen -> bubble appears on right: [Mascot] [Bubble]
                rootContainer.addView(mascotContainer);
                rootContainer.addView(bubbleFrame);
            }
        }
    }

    private void applyWindowCoordinates() {
        if (layoutParams == null) return;

        if (bubbleFrame != null && bubbleFrame.getVisibility() == View.VISIBLE && bubbleOnLeft) {
            // Bubble is to the left of the mascot
            int bubbleWidth = bubbleFrame.getWidth() > 0 ? bubbleFrame.getWidth() : dpToPx(160);
            int margin = dpToPx(6);
            layoutParams.x = Math.max(dpToPx(4), mascotX - bubbleWidth - margin);
        } else {
            layoutParams.x = mascotX;
        }
        layoutParams.y = mascotY;
    }

    /**
     * Updates the live transcript text bubble beside the mascot.
     * Combines completed prior segments with the current partial result correctly.
     * Replaces revised partial text rather than appending duplicate words.
     */
    public synchronized void updateLiveTranscript(String cumulativePrefix, String currentText, boolean isFinal) {
        mainHandler.post(() -> {
            if (!showLiveTranscript || isKeyguardLocked()) {
                hideBubble();
                return;
            }

            String prefix = cumulativePrefix != null ? cumulativePrefix.trim() : "";
            String current = currentText != null ? currentText.trim() : "";

            String fullText;
            if (!prefix.isEmpty() && !current.isEmpty()) {
                fullText = prefix + " " + current;
            } else if (!current.isEmpty()) {
                fullText = current;
            } else if (!prefix.isEmpty()) {
                fullText = prefix;
            } else {
                fullText = currentState == FriendModeState.ACTIVE_LISTENING ? "Listening..." : "";
            }

            currentTranscriptText = fullText;

            if (fullText.isEmpty()) {
                hideBubble();
                return;
            }

            if (transcriptTextView != null) {
                transcriptTextView.setText(fullText);
            }

            if (bubbleFrame != null) {
                bubbleFrame.setVisibility(View.VISIBLE);
                updateBubbleAlignment();
                applyWindowCoordinates();
                if (isShowing && rootContainer != null) {
                    try {
                        windowManager.updateViewLayout(rootContainer, layoutParams);
                    } catch (Exception ignored) {}
                }
            }
        });
    }

    public synchronized void clearTranscript() {
        currentTranscriptText = "";
        mainHandler.post(this::hideBubble);
    }

    private void hideBubble() {
        if (bubbleFrame != null && bubbleFrame.getVisibility() != View.GONE) {
            bubbleFrame.setVisibility(View.GONE);
            applyWindowCoordinates();
            if (isShowing && rootContainer != null) {
                try {
                    windowManager.updateViewLayout(rootContainer, layoutParams);
                } catch (Exception ignored) {}
            }
        }
    }

    public synchronized void setShowLiveTranscript(boolean show) {
        this.showLiveTranscript = show;
        if (!show) {
            clearTranscript();
        }
    }

    /**
     * Updates visual state, animations, and halo colors based on FriendModeState.
     */
    public synchronized void updateState(FriendModeState state) {
        this.currentState = state;
        mainHandler.post(() -> {
            if (rootContainer == null || haloRingView == null || statusDotView == null) return;

            stopAllAnimations();

            // Reset dimmed alpha unless paused
            mascotContainer.setAlpha(1.0f);

            int strokeColor = Color.parseColor("#06B6D4"); // Cyan default
            int dotColor = Color.parseColor("#3B82F6");    // Blue default

            switch (state) {
                case LISTENING_FOR_WAKE:
                    strokeColor = Color.parseColor("#06B6D4"); // Calm cyan
                    dotColor = Color.parseColor("#3B82F6");    // Blue wake indicator
                    hideBubble();
                    break;

                case ACTIVE_LISTENING:
                    strokeColor = Color.parseColor("#06B6D4"); // Cyan
                    dotColor = Color.parseColor("#EF4444");    // Red active mic
                    startCyanPulseAnimation();
                    if (currentTranscriptText.isEmpty() && showLiveTranscript) {
                        updateLiveTranscript("", "", false); // shows "Listening..."
                    }
                    break;

                case WAITING_FOR_FINISH:
                    strokeColor = Color.parseColor("#F59E0B"); // Amber
                    dotColor = Color.parseColor("#F97316");    // Orange
                    break;

                case THINKING:
                    strokeColor = Color.parseColor("#F59E0B"); // Amber
                    dotColor = Color.parseColor("#F59E0B");    // Amber
                    startOrbitAnimation();
                    if (showLiveTranscript && !isKeyguardLocked()) {
                        if (transcriptTextView != null) {
                            transcriptTextView.setText("Thinking...");
                        }
                        if (bubbleFrame != null) {
                            bubbleFrame.setVisibility(View.VISIBLE);
                            updateBubbleAlignment();
                            applyWindowCoordinates();
                            try {
                                windowManager.updateViewLayout(rootContainer, layoutParams);
                            } catch (Exception ignored) {}
                        }
                    }
                    break;

                case SPEAKING:
                    strokeColor = Color.parseColor("#EC4899"); // Pink
                    dotColor = Color.parseColor("#8B5CF6");    // Purple
                    startPinkPulseAnimation();
                    hideBubble();
                    break;

                case IDLE:
                    strokeColor = Color.parseColor("#64748B"); // Slate dimmed
                    dotColor = Color.parseColor("#94A3B8");
                    mascotContainer.setAlpha(0.5f);            // Dimmed appearance when paused
                    hideBubble();
                    break;

                case ERROR:
                    strokeColor = Color.parseColor("#EF4444"); // Red
                    dotColor = Color.parseColor("#DC2626");
                    hideBubble();
                    break;

                case DISABLED:
                default:
                    hide();
                    return;
            }

            GradientDrawable haloBg = new GradientDrawable();
            haloBg.setShape(GradientDrawable.OVAL);
            haloBg.setColor(Color.TRANSPARENT);
            haloBg.setStroke(dpToPx(2.5f), strokeColor);
            haloRingView.setBackground(haloBg);

            GradientDrawable dotBg = new GradientDrawable();
            dotBg.setShape(GradientDrawable.OVAL);
            dotBg.setColor(dotColor);
            statusDotView.setBackground(dotBg);
        });
    }

    private void startCyanPulseAnimation() {
        if (haloRingView == null) return;
        pulseAnimator = ValueAnimator.ofFloat(0.96f, 1.08f);
        pulseAnimator.setDuration(1100);
        pulseAnimator.setRepeatMode(ValueAnimator.REVERSE);
        pulseAnimator.setRepeatCount(ValueAnimator.INFINITE);
        pulseAnimator.addUpdateListener(animation -> {
            float scale = (float) animation.getAnimatedValue();
            if (haloRingView != null) {
                haloRingView.setScaleX(scale);
                haloRingView.setScaleY(scale);
            }
        });
        pulseAnimator.start();
    }

    private void startPinkPulseAnimation() {
        if (haloRingView == null) return;
        pulseAnimator = ValueAnimator.ofFloat(0.97f, 1.09f);
        pulseAnimator.setDuration(950);
        pulseAnimator.setRepeatMode(ValueAnimator.REVERSE);
        pulseAnimator.setRepeatCount(ValueAnimator.INFINITE);
        pulseAnimator.addUpdateListener(animation -> {
            float scale = (float) animation.getAnimatedValue();
            if (haloRingView != null) {
                haloRingView.setScaleX(scale);
                haloRingView.setScaleY(scale);
            }
        });
        pulseAnimator.start();
    }

    private void startOrbitAnimation() {
        if (haloRingView == null) return;
        orbitAnimator = ValueAnimator.ofFloat(0f, 360f);
        orbitAnimator.setDuration(2400);
        orbitAnimator.setInterpolator(new LinearInterpolator());
        orbitAnimator.setRepeatCount(ValueAnimator.INFINITE);
        orbitAnimator.addUpdateListener(animation -> {
            float rotation = (float) animation.getAnimatedValue();
            if (haloRingView != null) {
                haloRingView.setRotation(rotation);
            }
        });
        orbitAnimator.start();
    }

    private void stopAllAnimations() {
        if (pulseAnimator != null) {
            pulseAnimator.cancel();
            pulseAnimator = null;
        }
        if (orbitAnimator != null) {
            orbitAnimator.cancel();
            orbitAnimator = null;
        }
        if (haloRingView != null) {
            haloRingView.setScaleX(1.0f);
            haloRingView.setScaleY(1.0f);
            haloRingView.setAlpha(1.0f);
            haloRingView.setRotation(0f);
        }
    }

    private boolean isKeyguardLocked() {
        try {
            KeyguardManager km = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
            return km != null && km.isKeyguardLocked();
        } catch (Exception e) {
            return false;
        }
    }

    public synchronized void hide() {
        if (!isShowing) return;

        mainHandler.post(() -> {
            try {
                stopAllAnimations();
                if (rootContainer != null && rootContainer.isAttachedToWindow()) {
                    windowManager.removeView(rootContainer);
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
        rootContainer = null;
        mascotContainer = null;
        bubbleFrame = null;
        transcriptTextView = null;
        listener = null;
    }

    public boolean isShowing() {
        return isShowing;
    }

    private int dpToPx(float dp) {
        return (int) TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                dp,
                context.getResources().getDisplayMetrics()
        );
    }

    private int getScreenWidth() {
        DisplayMetrics dm = context.getResources().getDisplayMetrics();
        return dm.widthPixels;
    }

    private int getScreenHeight() {
        DisplayMetrics dm = context.getResources().getDisplayMetrics();
        return dm.heightPixels;
    }

    private int getStatusBarHeight() {
        int resourceId = context.getResources().getIdentifier("status_bar_height", "dimen", "android");
        if (resourceId > 0) {
            return context.getResources().getDimensionPixelSize(resourceId);
        }
        return dpToPx(24);
    }
}
