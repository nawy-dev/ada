import { useSyncExternalStore } from "react";

import { isNativeApp } from "./platform";

const subscribe = () => () => {};

/**
 * Whether the page runs inside the Android app, as a hook. The first (server or hydration) render
 * answers false so it matches the pre-built page, then it switches at once on the phone.
 */
export function useIsNativeApp(): boolean {
  return useSyncExternalStore(subscribe, isNativeApp, () => false);
}
