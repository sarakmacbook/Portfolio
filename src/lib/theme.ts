/**
 * Theme handling shared by the header switch, the web clip strip and the
 * pre-paint inline script in the root layout.
 *
 * The inline script runs before React, so the rules live in one place here and
 * are exported as a string (`bootScript`) rather than duplicated in JSX.
 */

export const THEME_STORAGE_KEY = "ledgerly-theme";

export type Theme = "light" | "dark";

/** Saved choice wins; otherwise use the reference-inspired dark theme. */
export function resolveTheme(saved: string | null | undefined, _prefersDark: boolean): Theme {
  if (saved === "dark" || saved === "light") return saved;
  return "dark";
}

export function nextTheme(current: Theme): Theme {
  return current === "dark" ? "light" : "dark";
}

/** Theme currently applied to the document (the pre-paint script sets the initial theme). */
export function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** Applies a theme and remembers it for the next visit. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private browsing with storage disabled: the theme still applies to this page.
  }
}

export function toggleTheme(): Theme {
  const next = nextTheme(currentTheme());
  applyTheme(next);
  return next;
}

/**
 * Inline script for `<head>`, run before the first paint so a saved dark theme
 * never flashes white. Storage can throw in private browsing; the app then
 * simply starts in the dark theme.
 */
export function bootScript(): string {
  return (
    `(function(){` +
    `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');` +
    `if(t!=='light')document.documentElement.classList.add('dark')}catch(e){document.documentElement.classList.add('dark')}` +
    `})()`
  );
}
