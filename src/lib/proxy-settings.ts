/**
 * Outbound proxy settings, shared by the Settings UI and the server.
 *
 * The app talks to price feeds, exchanges, wallet explorers and Telegram from
 * the server. Behind a network that blocks or throttles those, routing those
 * requests through an HTTP proxy is what changes the IP the providers see.
 *
 * Pure module: validation, masking and the public shape the browser may see.
 * Storage and encryption live in `proxy-settings-db.ts`; the fetch plumbing in
 * `outbound.ts`.
 *
 * VMess / VLESS / Trojan links can be kept here (encrypted), but those are
 * tunnel protocols, not HTTP proxies: the app cannot dial them directly. Run a
 * V2Ray/Xray client that exposes an HTTP proxy and point the fields above at it.
 */

export const MAX_PROXY_LINKS = 20;
export const MAX_PROXY_LINK_LENGTH = 4096;
export const MAX_PROXY_HOST_LENGTH = 253;
export const MAX_PROXY_USERNAME_LENGTH = 128;
export const MAX_PROXY_PASSWORD_LENGTH = 256;
export const MAX_PROXY_LABEL_LENGTH = 48;

export const PROXY_MODES = ["off", "http"] as const;
export type ProxyMode = (typeof PROXY_MODES)[number];

export const PROXY_LINK_PROTOCOLS = ["vmess", "vless", "trojan", "ss", "socks", "http"] as const;
export type ProxyLinkProtocol = (typeof PROXY_LINK_PROTOCOLS)[number];

export type ProxyLink = {
  id: string;
  /** Free name, e.g. the server's city. */
  label: string;
  protocol: ProxyLinkProtocol;
  /** The full `vmess://…`-style link. Encrypted at rest, never sent back. */
  url: string;
  addedAt: string;
};

export type ProxyConfig = {
  mode: ProxyMode;
  host: string;
  port: number;
  username: string;
  password: string;
  links: ProxyLink[];
};

/** What the Settings page may know: no password, no link contents. */
export type PublicProxyLink = {
  id: string;
  label: string;
  protocol: ProxyLinkProtocol;
  /** e.g. `vmess://••••••ab12` */
  hint: string;
  addedAt: string;
};

export type PublicProxyConfig = {
  mode: ProxyMode;
  host: string;
  port: number;
  username: string;
  hasPassword: boolean;
  /** e.g. `••••••••7F3A`, or "" when nothing is saved. */
  passwordHint: string;
  links: PublicProxyLink[];
};

export function emptyProxyConfig(): ProxyConfig {
  return { mode: "off", host: "", port: 0, username: "", password: "", links: [] };
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** `••••••••abcd` — enough to recognise a value, never enough to use it. */
export function maskSecret(secret: string, visible = 4): string {
  if (!secret) return "";
  const tail = visible > 0 ? secret.slice(-visible) : "";
  return `${"•".repeat(8)}${tail}`;
}

/** Reads whatever was stored (older payloads, edited JSON) into a safe shape. */
export function readProxyConfig(value: unknown): ProxyConfig {
  const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const mode = PROXY_MODES.includes(record.mode as ProxyMode) ? (record.mode as ProxyMode) : "off";
  const port = Number(record.port);
  const rawLinks = Array.isArray(record.links) ? record.links : [];
  const links: ProxyLink[] = [];
  for (const raw of rawLinks.slice(0, MAX_PROXY_LINKS)) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const protocol = PROXY_LINK_PROTOCOLS.includes(item.protocol as ProxyLinkProtocol)
      ? (item.protocol as ProxyLinkProtocol)
      : null;
    const url = text(item.url, MAX_PROXY_LINK_LENGTH);
    if (!protocol || !url) continue;
    links.push({
      id: text(item.id, 64) || newProxyLinkId(),
      label: text(item.label, MAX_PROXY_LABEL_LENGTH) || protocol.toUpperCase(),
      protocol,
      url,
      addedAt: text(item.addedAt, 40) || new Date(0).toISOString(),
    });
  }
  return {
    mode,
    host: text(record.host, MAX_PROXY_HOST_LENGTH),
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0,
    username: text(record.username, MAX_PROXY_USERNAME_LENGTH),
    password: typeof record.password === "string" ? record.password.slice(0, MAX_PROXY_PASSWORD_LENGTH) : "",
    links,
  };
}

export type ProxyValidation =
  | { ok: true; config: ProxyConfig }
  | { ok: false; error: string };

const HOST_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/**
 * Checks what the Settings form submits. `off` accepts a half-filled form (the
 * user may be turning the proxy off); `http` needs a host and a port that a
 * proxy client could really listen on.
 */
export function validateProxyConfig(config: ProxyConfig): ProxyValidation {
  if (!PROXY_MODES.includes(config.mode)) return { ok: false, error: "Choose whether the proxy is on or off." };

  const host = config.host.trim();
  const username = config.username.trim();
  const password = config.password;

  if (config.mode === "http") {
    if (!host) return { ok: false, error: "Enter the proxy host, for example 127.0.0.1." };
    if (!HOST_PATTERN.test(host) || host.length > MAX_PROXY_HOST_LENGTH) {
      return { ok: false, error: "Enter only the host — no http://, no path, no spaces." };
    }
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
      return { ok: false, error: "Enter the proxy port, for example 8080." };
    }
  } else {
    if (host && (!HOST_PATTERN.test(host) || host.length > MAX_PROXY_HOST_LENGTH)) {
      return { ok: false, error: "Enter only the host — no http://, no path, no spaces." };
    }
    if (host && (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535)) {
      return { ok: false, error: "That port is not valid." };
    }
  }

  if (username.length > MAX_PROXY_USERNAME_LENGTH) return { ok: false, error: "That username is too long." };
  if (username.includes("@") || username.includes("/")) {
    return { ok: false, error: "A proxy username cannot contain @ or /." };
  }
  if (password.length > MAX_PROXY_PASSWORD_LENGTH) return { ok: false, error: "That password is too long." };

  return {
    ok: true,
    config: {
      mode: config.mode,
      host,
      port: config.mode === "http" ? config.port : config.port || 0,
      username,
      password,
      links: config.links.slice(0, MAX_PROXY_LINKS),
    },
  };
}

/**
 * The URL a proxy dispatcher dials (`http://user:pass@host:port`), or `null`
 * when the proxy is off — in which case outbound requests go out directly.
 */
export function proxyDispatcherUrl(config: ProxyConfig): string | null {
  if (config.mode !== "http" || !config.host || !config.port) return null;
  const auth = config.username
    ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`
    : "";
  return `http://${auth}${config.host}:${config.port}`;
}

/** A one-line label for the current mode, for summaries and messages. */
export function proxySummary(config: ProxyConfig): string {
  if (config.mode === "off") return "Direct connection — no proxy";
  return `HTTP proxy ${config.host}:${config.port}`;
}

export function newProxyLinkId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    // Older runtimes without webcrypto still get a unique-enough id.
    return `link-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

/** Which protocol a pasted link uses, from its scheme. */
export function detectProxyProtocol(url: string): ProxyLinkProtocol | null {
  const scheme = url.trim().toLowerCase().split("://")[0];
  if (scheme === "socks5" || scheme === "socks" || scheme === "socks4") return "socks";
  if (scheme === "https") return "http";
  return PROXY_LINK_PROTOCOLS.includes(scheme as ProxyLinkProtocol) ? (scheme as ProxyLinkProtocol) : null;
}

export type ProxyLinkValidation =
  | { ok: true; link: ProxyLink }
  | { ok: false; error: string };

/**
 * Accepts a `vmess://`, `vless://`, `trojan://`, `ss://`, `socks://` or `http://`
 * link. Only the scheme and shape are checked — the app stores the link, it never
 * dials it.
 */
export function validateProxyLink(rawUrl: unknown, rawLabel: unknown): ProxyLinkValidation {
  const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!url) return { ok: false, error: "Paste a proxy link, for example vmess://…" };
  if (url.length > MAX_PROXY_LINK_LENGTH) return { ok: false, error: "That link is too long to store." };
  if (/\s/.test(url)) return { ok: false, error: "A proxy link cannot contain spaces or line breaks." };

  const protocol = detectProxyProtocol(url);
  if (!protocol) {
    return { ok: false, error: "Paste a vmess://, vless://, trojan://, ss://, socks:// or http:// link." };
  }
  if (!/^[a-z0-9]+:\/\/\S+$/i.test(url)) return { ok: false, error: "That does not look like a proxy link." };

  if (protocol === "http") {
    // An http(s) proxy is only usable with its port; a plain website URL is not a proxy.
    let port = "";
    try {
      port = new URL(url).port;
    } catch {
      port = "";
    }
    if (!port) return { ok: false, error: "Include the port, for example http://proxy.example.com:8080." };
  }

  const label = text(rawLabel, MAX_PROXY_LABEL_LENGTH) || protocol.toUpperCase();
  return {
    ok: true,
    link: { id: newProxyLinkId(), label, protocol, url, addedAt: new Date().toISOString() },
  };
}

/** The browser-visible version of one stored link. */
export function publicProxyLink(link: ProxyLink): PublicProxyLink {
  return {
    id: link.id,
    label: link.label,
    protocol: link.protocol,
    hint: `${link.protocol}://${maskSecret(link.url, 4)}`,
    addedAt: link.addedAt,
  };
}

export function publicProxyConfig(config: ProxyConfig): PublicProxyConfig {
  return {
    mode: config.mode,
    host: config.host,
    port: config.port,
    username: config.username,
    hasPassword: config.password.length > 0,
    passwordHint: maskSecret(config.password),
    links: config.links.map(publicProxyLink),
  };
}
