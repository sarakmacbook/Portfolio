/**
 * Storage for the outbound proxy settings.
 *
 * The whole configuration — host, credentials and any saved VMess/VLESS links —
 * is AES-256-GCM encrypted with the same key that protects the exchange API
 * keys (`EXCHANGE_CREDENTIALS_KEY`, or a generated key kept in `app_settings`
 * when that variable is unset). A copied database dump is then useless without
 * the key, and a proxy password never sits in plain text.
 *
 * Reads never throw: a missing row, an unreadable blob (key rotated) or an old
 * payload all mean "proxy off", so a settings problem cannot stop price refreshes.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { decryptJson, encryptJson, getCredentialEncryptionKey } from "@/lib/exchange-credentials";
import { ensureSchema } from "@/lib/portfolio";
import {
  emptyProxyConfig,
  publicProxyConfig,
  readProxyConfig,
  type ProxyConfig,
  type PublicProxyConfig,
} from "@/lib/proxy-settings";

export const PROXY_SETTING_KEY = "proxy.settings";

export async function loadProxyConfig(): Promise<ProxyConfig> {
  try {
    await ensureSchema();
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, PROXY_SETTING_KEY))
      .limit(1);
    if (!row?.value) return emptyProxyConfig();
    const { key } = await getCredentialEncryptionKey();
    return readProxyConfig(decryptJson(row.value, key));
  } catch {
    return emptyProxyConfig();
  }
}

export async function saveProxyConfig(config: ProxyConfig): Promise<void> {
  await ensureSchema();
  const { key } = await getCredentialEncryptionKey();
  const blob = encryptJson(config, key);
  const updatedAt = new Date();
  await db
    .insert(appSettings)
    .values({ key: PROXY_SETTING_KEY, value: blob, updatedAt })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: blob, updatedAt } });
}

export async function getPublicProxySettings(): Promise<PublicProxyConfig> {
  return publicProxyConfig(await loadProxyConfig());
}
