/** Shared navigation targets for the header menu. */
export type NavLink = {
  href: string;
  label: string;
  hint?: string;
};

/** Top-level links that stay directly in the header bar. */
export const PRIMARY_NAV_LINKS: NavLink[] = [
  { href: "/", label: "Dashboard" },
  { href: "/activity", label: "Activity" },
];

/** Balance and third-party data sources grouped under the Imports menu. */
export const IMPORT_NAV_LINKS: NavLink[] = [
  { href: "/exchanges", label: "Exchanges", hint: "Read-only exchange balances" },
  { href: "/imports", label: "Custom API", hint: "Nansen and other JSON APIs" },
];

/** Links grouped inside the Settings submenu. */
export const SETTINGS_NAV_LINKS: NavLink[] = [
  { href: "/settings", label: "General", hint: "Price feed & auto refresh" },
  { href: "/prices", label: "Refresh prices", hint: "Update market prices" },
  { href: "/alerts", label: "Alerts", hint: "Price moves & scheduled recaps" },
  { href: "/database", label: "Database", hint: "Connection, backup & export" },
];

/** Complete flat list of all navigation destinations. */
export const NAV_LINKS: NavLink[] = [...PRIMARY_NAV_LINKS, ...IMPORT_NAV_LINKS, ...SETTINGS_NAV_LINKS];

/** True when `path` belongs to `href` (the dashboard also owns asset pages). */
export function isActivePath(path: string, href: string): boolean {
  if (href === "/") return path === "/" || path.startsWith("/assets");
  return path === href || path.startsWith(`${href}/`);
}

/** True when `path` belongs to an entry inside the Imports menu. */
export function isImportPath(path: string): boolean {
  return IMPORT_NAV_LINKS.some((link) => isActivePath(path, link.href));
}

/** True when `path` belongs to any page inside the Settings submenu. */
export function isSettingsPath(path: string): boolean {
  return SETTINGS_NAV_LINKS.some((link) => isActivePath(path, link.href));
}
