package org.beamlisp.omega.pocket;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;

/** Visible until the existing Mob renderer commits its first root. No network
 * reporting: startup diagnostics stay on this phone and are copied on request.
 * The native launcher, runtime and screen remain the owners of the actual app.
 */
public final class StartupStatus {
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final String POCKET = "https://work.tailcb5318.ts.net:18001/"
        + "?file=workspace:all&use=present,dwim,workspace,places,references,buffers,workbench,mobile,live"
        + "&layout=mobile&app=pocket";
    private static volatile String phase = "Installing Pocket runtime…";
    private static volatile String log = "";
    private static volatile Process capture;
    private static volatile boolean finished;

    private StartupStatus() {}

    public static void phase(String value) { phase = value; }

    public static void attach(Activity activity) {
        finished = false;
        LinearLayout panel = new LinearLayout(activity);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER_VERTICAL);
        panel.setBackgroundColor(Color.rgb(247, 243, 238));
        int padding = (int) (28 * activity.getResources().getDisplayMetrics().density);
        panel.setPadding(padding, padding, padding, padding);
        TextView title = new TextView(activity);
        title.setText("ω  Omega Pocket");
        title.setTextColor(Color.rgb(59, 44, 36));
        title.setTextSize(26);
        panel.addView(title);
        ProgressBar progress = new ProgressBar(activity);
        panel.addView(progress, new LinearLayout.LayoutParams(64, 64));
        TextView status = new TextView(activity);
        status.setTextColor(Color.rgb(59, 44, 36));
        status.setTextSize(17);
        status.setPadding(0, 20, 0, 20);
        panel.addView(status);
        Button details = new Button(activity);
        details.setText("Startup details");
        details.setOnClickListener(v -> showDetails(activity));
        panel.addView(details);
        Button browser = new Button(activity);
        browser.setText("Open Pocket in browser");
        browser.setOnClickListener(v -> {
            try { activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(POCKET))); }
            catch (Exception e) { phase = "Could not open browser: " + e.getMessage(); }
        });
        panel.addView(browser);
        activity.addContentView(panel, new ViewGroup.LayoutParams(-1, -1));
        startCapture(activity);
        long began = android.os.SystemClock.elapsedRealtime();
        MAIN.post(new Runnable() {
            @Override public void run() {
                if (activity.isDestroyed()) { stopCapture(); return; }
                if (hasRoot()) {
                    ((ViewGroup) panel.getParent()).removeView(panel);
                    stopCapture();
                    return;
                }
                long seconds = (android.os.SystemClock.elapsedRealtime() - began) / 1000;
                status.setText(phase + "\n" + seconds + " seconds"
                    + (seconds >= 30 ? "\nThe native screen has not opened. Startup details can help diagnose it; your work is also available in the browser." : ""));
                if (seconds >= 120) { progress.setVisibility(android.view.View.GONE); stopCapture(); }
                MAIN.postDelayed(this, 1000);
            }
        });
    }

    private static boolean hasRoot() {
        try {
            Class<?> bridge = Class.forName("org.beamlisp.omega.pocket.MobBridge");
            Object instance = bridge.getField("INSTANCE").get(null);
            Object state = bridge.getMethod("getRootState").invoke(instance);
            Method getValue = Class.forName("androidx.compose.runtime.State").getMethod("getValue");
            Object root = getValue.invoke(state);
            return root != null && root.getClass().getMethod("getNode").invoke(root) != null;
        } catch (ReflectiveOperationException ignored) { return false; }
    }

    private static void startCapture(Activity activity) {
        Thread reader = new Thread(() -> {
            try {
                capture = new ProcessBuilder("logcat", "--pid", Integer.toString(android.os.Process.myPid()),
                    "-v", "brief", "-T", "1", "MobBeam:V", "BEAMout:V", "Beam Lisp:V", "*:S")
                    .redirectErrorStream(true).start();
                try (BufferedReader input = new BufferedReader(new InputStreamReader(capture.getInputStream()))) {
                    String line;
                    while (!finished && (line = input.readLine()) != null) {
                        String next = log + line + "\n";
                        log = next.substring(Math.max(0, next.length() - 16000));
                        try (FileOutputStream out = new FileOutputStream(new File(activity.getFilesDir(), "pocket-startup.log"))) {
                            out.write(log.getBytes(StandardCharsets.UTF_8));
                        }
                    }
                }
            } catch (Exception e) { log += "Startup log unavailable: " + e.getMessage() + "\n"; }
        }, "pocket-startup-log");
        reader.setDaemon(true);
        reader.start();
    }

    private static void stopCapture() {
        finished = true;
        Process process = capture;
        if (process != null) process.destroy();
    }

    private static void showDetails(Activity activity) {
        String text = "Pocket 0.1.6 · " + android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL
            + " · Android " + android.os.Build.VERSION.RELEASE + "\n" + phase + "\n\n" + log;
        TextView details = new TextView(activity);
        details.setText(text);
        details.setTextIsSelectable(true);
        details.setPadding(24, 16, 24, 16);
        ScrollView scroll = new ScrollView(activity);
        scroll.addView(details);
        new AlertDialog.Builder(activity).setTitle("Pocket startup").setView(scroll)
            .setPositiveButton("Copy", (dialog, which) -> {
                ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Activity.CLIPBOARD_SERVICE);
                clipboard.setPrimaryClip(ClipData.newPlainText("Pocket startup", text));
            }).setNegativeButton("Close", null).show();
    }
}
