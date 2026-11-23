package ada.nawy.app;

import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Paints the status and navigation bars like the page: the area behind them gets the app's
 * background colour and the icons are dark or light to stay readable on it.
 *
 * Why not Capacitor's own SystemBars plugin: it sets the icons but also puts the PHONE theme's
 * window colour (grey in dark mode) behind the bars on every setStyle call and again whenever the
 * phone's theme changes. That grey follows the phone, not the theme chosen inside the app. So this
 * plugin owns both, and applies them again right after Capacitor's handler has run.
 *
 * The page tells us the colour it is painting (see src/lib/native/system-bars.ts).
 */
@CapacitorPlugin(name = "AdaSystemBars")
public class AdaSystemBarsPlugin extends Plugin {

    private boolean applied = false;
    private int color;
    private boolean lightBackground;

    @PluginMethod
    public void setColors(final PluginCall call) {
        final String hex = call.getString("color");
        if (hex == null) {
            call.reject("color is required");
            return;
        }
        final int parsed;
        try {
            parsed = Color.parseColor(hex);
        } catch (IllegalArgumentException e) {
            call.reject("not a colour: " + hex);
            return;
        }
        final boolean light = Boolean.TRUE.equals(call.getBoolean("lightBackground", false));
        getActivity().runOnUiThread(() -> {
            color = parsed;
            lightBackground = light;
            applied = true;
            apply();
            call.resolve();
        });
    }

    @Override
    protected void handleOnConfigurationChanged(Configuration newConfig) {
        super.handleOnConfigurationChanged(newConfig);
        // Capacitor's SystemBars restores the phone's colours in its own handler of this same
        // event. Posting runs ours after it.
        getActivity().getWindow().getDecorView().post(this::apply);
    }

    private void apply() {
        if (!applied) return;
        final Activity activity = getActivity();
        final Window window = activity.getWindow();
        // Android 15+ draws the app edge to edge, so the bars are see-through and show this.
        window.getDecorView().setBackgroundColor(color);
        // Before that the bars have a colour of their own.
        if (Build.VERSION.SDK_INT < 35) {
            setLegacyBarColors(window, color);
        }
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(lightBackground);
        controller.setAppearanceLightNavigationBars(lightBackground);
    }

    @SuppressWarnings("deprecation")
    private static void setLegacyBarColors(Window window, int color) {
        window.setStatusBarColor(color);
        window.setNavigationBarColor(color);
    }
}
