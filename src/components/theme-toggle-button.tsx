import { HEADER_ACTION_CLASS } from "@/components/header-action";
import { Icon } from "@/components/icon";
import { useTheme } from "@/lib/theme/theme-context";

/**
 * One-tap light/dark switch for the header. It always sets an explicit theme (the "follow the
 * system" option stays available in Settings) and shows the mode the tap will switch to.
 */
export function ThemeToggleButton() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const label = dark ? "التبديل إلى الوضع النهاري" : "التبديل إلى الوضع الليلي";

  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={label}
      title={label}
      className={HEADER_ACTION_CLASS}
    >
      <Icon name={dark ? "light_mode" : "bedtime"} className="size-5" />
    </button>
  );
}
