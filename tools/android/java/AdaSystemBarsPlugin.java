package ada.nawy.app;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.view.Window;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Paints the area behind the status and navigation bars with the app's own background colour.
 *
 * Capacitor's SystemBars plugin only sets the colour of the ICONS. What shows behind them is the
 * window background, which Android takes from the PHONE's theme: grey in dark mode whatever the
 * app is showing, and it ignores the theme chosen inside the app. The page tells us which colour
 * it is painting (see src/lib/native/system-bars.ts) and we make the window the same colour.
 */
@CapacitorPlugin(name = "AdaSystemBars")
public class AdaSystemBarsPlugin extends Plugin {

    @PluginMethod
    public void setColors(final PluginCall call) {
        final String hex = call.getString("color");
        if (hex == null) {
            call.reject("color is required");
            return;
        }
        final int color;
        try {
            color = Color.parseColor(hex);
        } catch (IllegalArgumentException e) {
            call.reject("not a colour: " + hex);
            return;
        }
        final Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            Window window = activity.getWindow();
            // Android 15+ draws the app edge to edge, so the bars are see-through and show this.
            window.setBackgroundDrawable(new ColorDrawable(color));
            // Before that the bars have a colour of their own.
            if (Build.VERSION.SDK_INT < 35) {
                setLegacyBarColors(window, color);
            }
            call.resolve();
        });
    }

    @SuppressWarnings("deprecation")
    private static void setLegacyBarColors(Window window, int color) {
        window.setStatusBarColor(color);
        window.setNavigationBarColor(color);
    }
}
