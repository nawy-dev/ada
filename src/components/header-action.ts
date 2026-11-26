/**
 * One look for every round icon button in a screen header (menu, theme, view, install, edit, back),
 * so they share size, shape and press feedback. Keyboard focus styling is added by the caller
 * where it is wanted: the menu trigger gets focus back after the sheet closes and must not show a
 * ring then.
 */
export const HEADER_ACTION_CLASS =
  "habit-toolbar-action grid size-10 shrink-0 place-items-center rounded-full border bg-card text-muted-foreground outline-none transition-[background-color,color,transform] hover:bg-muted hover:text-foreground active:scale-95";

export const HEADER_ACTION_FOCUS_CLASS =
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
