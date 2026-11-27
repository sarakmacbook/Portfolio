/**
 * Applies the saved proxy to every outbound request the server makes.
 *
 * The app's providers (prices, exchange balances, wallet explorers, Telegram)
 * all call the global `fetch`. Instead of threading a dispatcher through each of
 * them — and pulling database code into every client bundle that imports a price
 * constant — the proxy is installed once as undici's **global dispatcher**. From
 * then on, `fetch` tunnels through it and the providers see the proxy's address.
 *
 * Wired up in `src/instrumentation.ts` (once per server process) and re-applied
 * right after Settings → Proxy is saved, so a change takes effect immediately.
 *
 * Server-only: importing this from a client component would pull `pg` in.
 */
import { Agent, ProxyAgent, setGlobalDispatcher } from "undici";
import { loadProxyConfig } from "@/lib/proxy-settings-db";
import { proxyDispatcherUrl } from "@/lib/proxy-settings";

/**
 * The proxy URL currently installed. `undefined` means "not applied yet", so the
 * first call always installs a dispatcher; `null` means "direct".
 */
let appliedUrl: string | null | undefined = undefined;

export type AppliedProxy = { mode: "off" | "http"; url: string | null; error?: string };

/**
 * Reads the saved settings and installs the matching dispatcher.
 *
 * Never throws: if the database is unreachable or the settings are unreadable the
 * app keeps making direct requests, which is the behaviour that used to exist.
 */
export async function applySavedProxy(): Promise<AppliedProxy> {
  let config;
  try {
    config = await loadProxyConfig();
  } catch (error) {
    return {
      mode: "off",
      url: null,
      error: error instanceof Error ? error.message : "Could not read the proxy settings.",
    };
  }

  const url = proxyDispatcherUrl(config);
  if (url === appliedUrl) return { mode: config.mode, url };

  try {
    setGlobalDispatcher(url ? new ProxyAgent(url) : new Agent());
    appliedUrl = url;
    return { mode: config.mode, url };
  } catch (error) {
    // A malformed proxy URL must not take the app down; go direct instead.
    setGlobalDispatcher(new Agent());
    appliedUrl = null;
    return {
      mode: "off",
      url: null,
      error: error instanceof Error ? error.message : "Could not install the proxy.",
    };
  }
}

/** Forces the next `applySavedProxy` to reinstall, e.g. after saving settings. */
export function forgetProxyCache(): void {
  appliedUrl = undefined;
}

export type EgressResult = { ip?: string; error?: string };

/**
 * The IP a request goes out from. `viaProxy: false` deliberately bypasses the
 * installed dispatcher with a fresh direct agent, so the two answers can be
 * compared — that is how the Settings button proves the proxy changed the IP.
 */
export async function egressIp(options: { viaProxy: boolean }): Promise<EgressResult> {
  const url = "https://api.ipify.org?format=json";
  const init: RequestInit = {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  };
  try {
    if (!options.viaProxy) {
      const direct = new Agent();
      try {
        const response = await fetch(url, { ...init, dispatcher: direct } as unknown as RequestInit);
        return await readIp(response);
      } finally {
        await direct.close().catch(() => {});
      }
    }
    return await readIp(await fetch(url, init));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not reach the IP check." };
  }
}

async function readIp(response: Response): Promise<EgressResult> {
  if (!response.ok) return { error: `The IP check answered HTTP ${response.status}.` };
  const payload = (await response.json()) as { ip?: unknown };
  const ip = typeof payload.ip === "string" ? payload.ip.trim() : "";
  return ip ? { ip } : { error: "The IP check returned no address." };
}
