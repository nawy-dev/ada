import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isLightColor, readPageBackground, syncSystemBars } from "./system-bars";

const mocks = vi.hoisted(() => ({
  setColors: vi.fn(),
  setStyle: vi.fn(),
  registerPlugin: vi.fn(),
}));

// Like the real ones, plugins are proxies that answer to ANY property; `then` throws so returning
// one from an async function (which would break the promise) fails here and not on a phone.
const proxy = <T extends object>(target: T, name: string) =>
  new Proxy(target, {
    get(t, prop: string) {
      if (prop === "then") throw new Error(`${name}.then() is not implemented on android`);
      return (t as Record<string, unknown>)[prop];
    },
  });

vi.mock("@capacitor/core", () => ({
  SystemBars: proxy({ setStyle: mocks.setStyle }, "SystemBars"),
  SystemBarsStyle: { Dark: "DARK", Light: "LIGHT", Default: "DEFAULT" },
  registerPlugin: mocks.registerPlugin,
}));

const setNative = (native: boolean) => {
  (window as unknown as { Capacitor?: unknown }).Capacitor = native
    ? { isNativePlatform: () => true }
    : undefined;
};

/** jsdom has no canvas; this one "paints" the colour it is given as one red/green/blue pixel. */
function fakeCanvas(pixel: [number, number, number, number] | null) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() =>
    pixel
      ? {
          fillStyle: "",
          clearRect: () => {},
          fillRect: () => {},
          getImageData: () => ({ data: pixel }),
        }
      : null) as never);
}

describe("isLightColor", () => {
  it("tells the two page backgrounds apart", () => {
    expect(isLightColor("#F7F8FA")).toBe(true);
    expect(isLightColor("#121212")).toBe(false);
  });
});

describe("readPageBackground", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads the painted colour as #RRGGBB", () => {
    fakeCanvas([18, 18, 18, 255]);
    expect(readPageBackground("dark")).toBe("#121212");
  });

  it("falls back to the token when the page has no canvas", () => {
    fakeCanvas(null);
    expect(readPageBackground("light")).toBe("#F7F8FA");
    expect(readPageBackground("dark")).toBe("#121212");
  });

  it("falls back to the token when the background is transparent", () => {
    fakeCanvas([0, 0, 0, 0]);
    expect(readPageBackground("dark")).toBe("#121212");
  });
});

describe("syncSystemBars", () => {
  beforeEach(() => {
    mocks.setColors.mockReset().mockResolvedValue(undefined);
    mocks.setStyle.mockReset().mockResolvedValue(undefined);
    mocks.registerPlugin
      .mockReset()
      .mockReturnValue(proxy({ setColors: mocks.setColors }, "AdaSystemBars"));
    fakeCanvas(null);
  });
  afterEach(() => {
    setNative(false);
    vi.restoreAllMocks();
  });

  it("does nothing in a browser", async () => {
    await syncSystemBars("dark");
    expect(mocks.setColors).not.toHaveBeenCalled();
    expect(mocks.setStyle).not.toHaveBeenCalled();
  });

  it("colours the bars like the dark page and asks for light icons", async () => {
    setNative(true);
    await syncSystemBars("dark");
    expect(mocks.setColors).toHaveBeenCalledWith({ color: "#121212" });
    expect(mocks.setStyle).toHaveBeenCalledWith({ style: "DARK" });
  });

  it("colours the bars like the light page and asks for dark icons", async () => {
    setNative(true);
    await syncSystemBars("light");
    expect(mocks.setColors).toHaveBeenCalledWith({ color: "#F7F8FA" });
    expect(mocks.setStyle).toHaveBeenCalledWith({ style: "LIGHT" });
  });

  it("does not throw when the phone refuses", async () => {
    setNative(true);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.setColors.mockRejectedValue(new Error("not implemented"));
    await expect(syncSystemBars("dark")).resolves.toBeUndefined();
  });
});
