import { isNativeApp } from "./platform";

/**
 * - `shared`: the share sheet was shown and the person went through it.
 * - `copied`: no share sheet on this device, so the text went to the clipboard instead.
 * - `cancelled`: the person closed the share sheet.
 * - `unavailable`: neither sharing nor copying is possible here.
 */
export type ShareTextResult = "shared" | "copied" | "cancelled" | "unavailable";

export interface ShareTextInput {
  title: string;
  text: string;
  url: string;
}

function isCancel(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
  return /cancel/i.test(message);
}

/**
 * The Android WebView has no `navigator.share`, so inside the app the system share sheet is opened
 * through the Share plugin (its proxy is used right here and never returned from an async function,
 * see reminder-scheduler.ts). In a browser: Web Share, then the clipboard.
 */
export async function shareText(input: ShareTextInput): Promise<ShareTextResult> {
  try {
    if (isNativeApp()) {
      const { Share } = await import("@capacitor/share");
      await Share.share({ ...input, dialogTitle: "مشاركة العادة" });
      return "shared";
    }

    if (typeof navigator.share === "function") {
      await navigator.share(input);
      return "shared";
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(`${input.text}\n${input.url}`);
      return "copied";
    }
    return "unavailable";
  } catch (error) {
    if (isCancel(error)) return "cancelled";
    throw error;
  }
}
