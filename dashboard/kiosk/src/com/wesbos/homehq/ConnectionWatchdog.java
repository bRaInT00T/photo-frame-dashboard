package com.wesbos.homehq;

import android.content.Context;
import android.net.wifi.SupplicantState;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.util.Log;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Keeps the frame online. Some Android 6 frames never rejoin Wi-Fi after the router restarts, so
 * the dashboard shows "Webpage not available" until someone power-cycles it. Every minute this
 * checks that the dashboard's server answers; if it doesn't for a while, it asks Wi-Fi to
 * reconnect, then turns Wi-Fi off and on (at most once per 15 minutes, so a server that is simply
 * down doesn't make Wi-Fi flap). Any HTTP response counts as reachable; only network errors count.
 */
final class ConnectionWatchdog {
  static final String TAG = "HomeHQ";
  static final long CHECK_MS = 60 * 1000;
  static final int RECONNECT_AFTER = 3;                // failed checks (~3 min) → ask Wi-Fi to reconnect
  static final int TOGGLE_AFTER = 5;                   // failed checks (~5 min) → Wi-Fi off and on
  static final long TOGGLE_COOLDOWN_MS = 15 * 60 * 1000;
  static final long TOGGLE_OFF_MS = 5 * 1000;

  private final WifiManager wifi;
  private final HandlerThread thread = new HandlerThread("HomeHQ-watchdog");
  private final Handler handler;
  private volatile String url;
  private int failures;
  private long lastToggle = -TOGGLE_COOLDOWN_MS;

  ConnectionWatchdog(Context context, String url) {
    this.wifi = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
    this.url = url;
    thread.start();
    handler = new Handler(thread.getLooper());
  }

  void setUrl(String url) { this.url = url; }

  void start() { handler.postDelayed(check, CHECK_MS); }

  void stop() {
    handler.removeCallbacksAndMessages(null);
    thread.quitSafely();
  }

  private final Runnable check = new Runnable() {
    @Override
    public void run() {
      try {
        tick();
      } catch (RuntimeException e) {
        Log.w(TAG, "Watchdog check failed: " + e);
      }
      handler.postDelayed(this, CHECK_MS);
    }
  };

  private void tick() {
    if (reachable()) {
      if (failures > 0) Log.i(TAG, "Watchdog: server reachable again after " + failures + " failed checks");
      failures = 0;
      return;
    }
    failures++;
    boolean connected = wifiConnected();
    Log.w(TAG, "Watchdog: server unreachable (" + failures + "), Wi-Fi " + (connected ? "connected" : "not connected"));
    if (wifi == null) return;
    if (!wifi.isWifiEnabled()) {
      Log.w(TAG, "Watchdog: Wi-Fi was off, turning it on");
      wifi.setWifiEnabled(true);
      return;
    }
    if ((!connected && failures == 1) || failures == RECONNECT_AFTER) {
      Log.w(TAG, "Watchdog: asking Wi-Fi to reconnect");
      wifi.reconnect();
    } else if (failures >= TOGGLE_AFTER && SystemClock.elapsedRealtime() - lastToggle > TOGGLE_COOLDOWN_MS) {
      Log.w(TAG, "Watchdog: turning Wi-Fi off and on");
      lastToggle = SystemClock.elapsedRealtime();
      wifi.setWifiEnabled(false);
      handler.postDelayed(new Runnable() {
        @Override
        public void run() { wifi.setWifiEnabled(true); }
      }, TOGGLE_OFF_MS);
    }
  }

  private boolean wifiConnected() {
    if (wifi == null || !wifi.isWifiEnabled()) return false;
    WifiInfo info = wifi.getConnectionInfo();
    return info != null && info.getSupplicantState() == SupplicantState.COMPLETED && info.getIpAddress() != 0;
  }

  private boolean reachable() {
    HttpURLConnection c = null;
    try {
      URL page = new URL(url);
      URL probe = new URL(page.getProtocol(), page.getHost(), page.getPort(), "/healthz");
      c = (HttpURLConnection) probe.openConnection();
      c.setConnectTimeout(5000);
      c.setReadTimeout(5000);
      c.setUseCaches(false);
      c.getResponseCode(); // any answer at all means the network path works
      return true;
    } catch (IOException e) {
      return false;
    } finally {
      if (c != null) c.disconnect();
    }
  }
}
