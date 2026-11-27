"use server";

import { revalidatePath } from "next/cache";
import { isDatabaseConfigured } from "@/db";
import { applySavedProxy, egressIp, forgetProxyCache } from "@/lib/outbound";
import { loadProxyConfig, saveProxyConfig } from "@/lib/proxy-settings-db";
import {
  MAX_PROXY_LINKS,
  PROXY_MODES,
  proxyDispatcherUrl,
  proxySummary,
  validateProxyConfig,
  validateProxyLink,
  type ProxyMode,
} from "@/lib/proxy-settings";

export type ProxyActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  warning?: string;
  ts?: number;
  /** IP the request went out from directly. */
  directIp?: string;
  /** IP it went out from through the saved proxy. */
  proxyIp?: string;
};

function field(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** Passwords are taken verbatim — a leading or trailing space can be real. */
function rawField(fd: FormData, key: string): string {
  const value = fd.get(key);
  return typeof value === "string" ? value : "";
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Saves the proxy the app's server-side requests should use.
 *
 * A blank password field keeps the saved one (it is never sent back to the
 * browser, so it cannot be re-submitted); tick **Remove password** to clear it.
 */
export async function saveProxySettingsAction(
  _prev: ProxyActionState,
  fd: FormData,
): Promise<ProxyActionState> {
  if (!isDatabaseConfigured()) {
    return { error: "Connect the portfolio database before saving proxy settings." };
  }

  try {
    const current = await loadProxyConfig();
    const mode = (PROXY_MODES.includes(field(fd, "mode") as ProxyMode) ? field(fd, "mode") : "off") as ProxyMode;
    const portText = field(fd, "port");
    const port = portText ? Number(portText) : 0;
    const submittedPassword = rawField(fd, "password");
    const password = fd.get("clearPassword") === "on" || fd.get("clearPassword") === "true"
      ? ""
      : submittedPassword
        ? submittedPassword
        : current.password;

    const validated = validateProxyConfig({
      mode,
      host: field(fd, "host"),
      port: Number.isFinite(port) ? port : 0,
      username: field(fd, "username"),
      password,
      links: current.links,
    });
    if (!validated.ok) return { error: validated.error };

    await saveProxyConfig(validated.config);
    // Install (or remove) the proxy before anything else goes out.
    forgetProxyCache();
    await applySavedProxy();
    revalidatePath("/settings");
    return {
      ok: true,
      ts: Date.now(),
      message:
        validated.config.mode === "off"
          ? "Proxy off — the app's requests go out from this deployment's own address."
          : `Saved: ${proxySummary(validated.config)}. Test the connection to check the IP it uses.`,
    };
  } catch (error) {
    return { error: messageOf(error, "Could not save the proxy settings.") };
  }
}

/** Stores one VMess / VLESS / Trojan / SS / SOCKS link, encrypted, for reference. */
export async function addProxyLinkAction(
  _prev: ProxyActionState,
  fd: FormData,
): Promise<ProxyActionState> {
  if (!isDatabaseConfigured()) {
    return { error: "Connect the portfolio database before saving proxy links." };
  }
  try {
    const current = await loadProxyConfig();
    if (current.links.length >= MAX_PROXY_LINKS) {
      return { error: `You can keep up to ${MAX_PROXY_LINKS} proxy links.` };
    }
    const validated = validateProxyLink(fd.get("url"), field(fd, "label"));
    if (!validated.ok) return { error: validated.error };

    await saveProxyConfig({ ...current, links: [...current.links, validated.link] });
    revalidatePath("/settings");
    return { ok: true, ts: Date.now(), message: `Saved the ${validated.link.protocol.toUpperCase()} link “${validated.link.label}”.` };
  } catch (error) {
    return { error: messageOf(error, "Could not save that proxy link.") };
  }
}

export async function removeProxyLinkAction(
  _prev: ProxyActionState,
  fd: FormData,
): Promise<ProxyActionState> {
  if (!isDatabaseConfigured()) {
    return { error: "Connect the portfolio database before changing proxy links." };
  }
  try {
    const id = field(fd, "id");
    const current = await loadProxyConfig();
    const next = current.links.filter((link) => link.id !== id);
    if (next.length === current.links.length) return { error: "That proxy link is already gone." };

    await saveProxyConfig({ ...current, links: next });
    revalidatePath("/settings");
    return { ok: true, ts: Date.now(), message: "Proxy link removed." };
  } catch (error) {
    return { error: messageOf(error, "Could not remove that proxy link.") };
  }
}

/**
 * Asks an IP-echo service twice — once directly, once through the saved proxy —
 * so "does this actually change my IP?" is answered by the app itself.
 */
export async function testProxyConnectionAction(
  _prev: ProxyActionState,
  _fd: FormData,
): Promise<ProxyActionState> {
  if (!isDatabaseConfigured()) {
    return { error: "Connect the portfolio database before testing the proxy." };
  }
  try {
    const config = await loadProxyConfig();
    if (!proxyDispatcherUrl(config)) {
      return { error: "Turn the proxy on and save the host and port first, then test." };
    }

    const [direct, viaProxy] = await Promise.all([
      egressIp({ viaProxy: false }),
      egressIp({ viaProxy: true }),
    ]);

    if (viaProxy.error) {
      return {
        error: `The proxy did not answer: ${viaProxy.error}. Check the host, port and credentials, and that the proxy allows outbound HTTPS.`,
        directIp: direct.ip,
      };
    }
    if (!direct.ip) {
      return {
        ok: true,
        ts: Date.now(),
        message: `Through the proxy the app goes out from ${viaProxy.ip}.`,
        proxyIp: viaProxy.ip,
        warning: `The direct check failed (${direct.error ?? "unknown error"}), so the two addresses cannot be compared.`,
      };
    }

    const changed = direct.ip !== viaProxy.ip;
    return {
      ok: true,
      ts: Date.now(),
      directIp: direct.ip,
      proxyIp: viaProxy.ip,
      message: changed
        ? `Working — direct ${direct.ip}, through the proxy ${viaProxy.ip}.`
        : `The proxy answered, but with the same address (${viaProxy.ip}). It is probably forwarding without changing the IP.`,
      ...(changed ? {} : { warning: `Both requests came from ${direct.ip}.` }),
    };
  } catch (error) {
    return { error: messageOf(error, "Could not test the proxy.") };
  }
}
