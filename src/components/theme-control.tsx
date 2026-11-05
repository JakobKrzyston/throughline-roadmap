"use client";
/** The system / light / dark switch in the top bar. Exports ThemeControl. */
import { Monitor, Moon, Sun } from "lucide-react";
import { type ReactElement, useSyncExternalStore } from "react";

type Theme = "system" | "light" | "dark";

const OPTIONS = [
  { theme: "system", label: "Use the system theme", Icon: Monitor },
  { theme: "light", label: "Light theme", Icon: Sun },
  { theme: "dark", label: "Dark theme", Icon: Moon },
] as const;

// The same key the theme script in the root layout reads before the first paint.
const STORAGE_KEY = "theme";
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function storedTheme(): Theme {
  try {
    const theme = localStorage.getItem(STORAGE_KEY);
    return theme === "light" || theme === "dark" ? theme : "system";
  } catch {
    // Storage can be blocked, e.g. in some private windows.
    return "system";
  }
}

function chooseTheme(theme: Theme): void {
  try {
    if (theme === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The choice still applies to this page; it just is not remembered.
  }
  const dark =
    theme === "dark" ||
    (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  listeners.forEach((listener) => listener());
}

/**
 * Three buttons that pick the colour theme and remember the choice in this browser.
 *
 * Returns:
 *   The button group.
 */
export function ThemeControl(): ReactElement {
  // The server cannot see the stored choice, so it renders "system" and the browser corrects it.
  const current = useSyncExternalStore(subscribe, storedTheme, () => "system");

  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex shrink-0 rounded-lg border border-border p-0.5"
    >
      {OPTIONS.map(({ theme, label, Icon }) => (
        <button
          key={theme}
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={current === theme}
          onClick={() => chooseTheme(theme)}
          className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary aria-pressed:bg-muted aria-pressed:text-foreground"
        >
          <Icon aria-hidden className="size-4" />
        </button>
      ))}
    </div>
  );
}
