import { afterEach, describe, expect, it, vi } from "vitest";

import { registerServiceWorker } from "./register-sw";

describe("registerServiceWorker inside the Android app", () => {
  afterEach(() => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = undefined;
    Object.assign(navigator, { serviceWorker: undefined });
    vi.restoreAllMocks();
  });

  it("does not touch the service worker at all (the file is not bundled in the app)", async () => {
    const getRegistrations = vi.fn().mockResolvedValue([]);
    const register = vi.fn();
    Object.assign(navigator, { serviceWorker: { getRegistrations, register } });
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };

    await registerServiceWorker();

    expect(getRegistrations).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });
});
