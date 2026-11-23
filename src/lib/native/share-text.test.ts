import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { shareText } from "./share-text";

const mocks = vi.hoisted(() => ({ share: vi.fn() }));

// A proxy that answers to ANY property, like the real plugin; `then` throws so returning it from
// an async function (which would break the promise) fails here and not on a phone.
vi.mock("@capacitor/share", () => ({
  Share: new Proxy(
    { share: mocks.share },
    {
      get(target, prop: string) {
        if (prop === "then") throw new Error("Share.then() is not implemented on android");
        return target[prop as "share"];
      },
    },
  ),
}));

const input = { title: "عادة — قراءة", text: "ناوي ألتزم", url: "https://ada.nawy.app/" };

const setNative = (native: boolean) => {
  (window as unknown as { Capacitor?: unknown }).Capacitor = native
    ? { isNativePlatform: () => true }
    : undefined;
};

describe("shareText", () => {
  beforeEach(() => {
    mocks.share.mockReset().mockResolvedValue({});
  });
  afterEach(() => {
    setNative(false);
    vi.restoreAllMocks();
    Object.assign(navigator, { share: undefined, clipboard: undefined });
  });

  describe("inside the Android app", () => {
    beforeEach(() => setNative(true));

    it("opens the system share sheet with the text and the link", async () => {
      await expect(shareText(input)).resolves.toBe("shared");
      expect(mocks.share).toHaveBeenCalledWith(expect.objectContaining(input));
    });

    it("reports a closed share sheet as cancelled", async () => {
      mocks.share.mockRejectedValue(new Error("Share canceled"));
      await expect(shareText(input)).resolves.toBe("cancelled");
    });

    it("does not hide real failures", async () => {
      mocks.share.mockRejectedValue(new Error("no activity found"));
      await expect(shareText(input)).rejects.toThrow("no activity found");
    });
  });

  describe("in a browser", () => {
    it("uses Web Share when there is one and never touches the plugin", async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { share });
      await expect(shareText(input)).resolves.toBe("shared");
      expect(share).toHaveBeenCalledWith(input);
      expect(mocks.share).not.toHaveBeenCalled();
    });

    it("treats a dismissed Web Share as cancelled", async () => {
      Object.assign(navigator, {
        share: vi.fn().mockRejectedValue(new DOMException("closed", "AbortError")),
      });
      await expect(shareText(input)).resolves.toBe("cancelled");
    });

    it("copies the text and the link when there is no share sheet", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });
      await expect(shareText(input)).resolves.toBe("copied");
      expect(writeText).toHaveBeenCalledWith("ناوي ألتزم\nhttps://ada.nawy.app/");
    });

    it("says so when it can neither share nor copy", async () => {
      await expect(shareText(input)).resolves.toBe("unavailable");
    });
  });
});
