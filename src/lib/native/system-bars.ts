import { isNativeApp } from "./platform";

export type BarTheme = "light" | "dark";

/** Our own native plugin (tools/android/java); Capacitor has no call for the bar colour. */
interface AdaSystemBarsPlugin {
  setColors(options: { color: string; lightBackground: boolean }): Promise<void>;
}

/** The page background tokens in src/styles.css, used only if the real colour cannot be read. */
const FALLBACK_BACKGROUND: Record<BarTheme, string> = { light: "#F7F8FA", dark: "#121212" };

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/**
 * The colour the page background is painted with right now, as #RRGGBB. It is read from the page
 * (through a canvas, which turns any CSS colour syntax into plain RGB) so the bars follow the CSS
 * tokens instead of a second copy of them that could drift.
 */
export function readPageBackground(theme: BarTheme): string {
  try {
    const context = document.createElement("canvas").getContext("2d");
    const css = getComputedStyle(document.body).backgroundColor;
    if (context && css) {
      context.fillStyle = "#000000";
      context.fillStyle = css; // an invalid value would leave black, caught by the alpha check
      context.clearRect(0, 0, 1, 1);
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      if (r !== undefined && g !== undefined && b !== undefined && a === 255) {
        return toHex(r, g, b);
      }
    }
  } catch {
    // No canvas (tests, very old WebView): use the token.
  }
  return FALLBACK_BACKGROUND[theme];
}

/** Whether dark icons are needed on top of this colour (WCAG relative luminance above half). */
export function isLightColor(hex: string): boolean {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5) > 0.5;
}

/**
 * Plugin objects are proxies that answer to any property, `then` included, so they travel inside a
 * plain object and are looked up once (registering the same plugin twice only logs a warning).
 */
let cached: Promise<{ bars: AdaSystemBarsPlugin }> | null = null;

function loadBars() {
  cached ??= import("@capacitor/core").then((core) => ({
    bars: core.registerPlugin<AdaSystemBarsPlugin>("AdaSystemBars"),
  }));
  return cached;
}

/**
 * Paints the status and navigation bars like the page: the same colour as the background, and
 * dark or light icons to match it. Without this the phone shows its own grey behind them, which
 * follows the PHONE's theme and not the one chosen inside the app. A no-op outside the app, and it
 * never throws: a wrong bar colour must not stop the app from opening.
 *
 * Capacitor's own SystemBars plugin is deliberately not used: it puts the phone's grey back behind
 * the bars every time it is called (see AdaSystemBarsPlugin.java).
 */
export async function syncSystemBars(theme: BarTheme): Promise<void> {
  if (!isNativeApp()) return;
  const color = readPageBackground(theme);
  try {
    const { bars } = await loadBars();
    await bars.setColors({ color, lightBackground: isLightColor(color) });
  } catch (error) {
    console.warn("system bars were not updated", error);
  }
}
