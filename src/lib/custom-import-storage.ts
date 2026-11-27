import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { ensureSchema } from "@/lib/portfolio";
import {
  decryptJson,
  encryptJson,
  getCredentialEncryptionKey,
  maskApiKey,
} from "@/lib/exchange-credentials";
import { normalizeCustomApiConfig } from "@/lib/custom-api-import";
import type { CustomApiImportConfig, CustomApiImportPublicConfig } from "@/lib/custom-import-types";

const CUSTOM_API_IMPORT_SETTING = "imports.custom-api.connection";

/** Decrypts the one saved custom API connector, or returns null if none is set. */
export async function getCustomApiImportConfig(): Promise<CustomApiImportConfig | null> {
  await ensureSchema();
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, CUSTOM_API_IMPORT_SETTING))
    .limit(1);
  if (!row) return null;

  try {
    const { key } = await getCredentialEncryptionKey();
    return normalizeCustomApiConfig(decryptJson(row.value, key));
  } catch {
    throw new Error("The saved API connection could not be decrypted. Enter the API key again to replace it.");
  }
}

/** Encrypts the endpoint settings and API key before writing to app_settings. */
export async function saveCustomApiImportConfig(config: CustomApiImportConfig): Promise<void> {
  await ensureSchema();
  const { key } = await getCredentialEncryptionKey();
  const value = encryptJson(config, key);
  await db
    .insert(appSettings)
    .values({ key: CUSTOM_API_IMPORT_SETTING, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

/** Removes only the saved connector. Assets already imported stay in the portfolio. */
export async function clearCustomApiImportConfig(): Promise<void> {
  await ensureSchema();
  await db.delete(appSettings).where(eq(appSettings.key, CUSTOM_API_IMPORT_SETTING));
}

/** Browser-safe connector summary. The plaintext token is never returned. */
export function publicCustomApiImportConfig(
  config: CustomApiImportConfig,
): CustomApiImportPublicConfig {
  const { token, ...publicConfig } = config;
  return {
    ...publicConfig,
    hasSavedToken: Boolean(token),
    tokenHint: token ? maskApiKey(token) : "",
  };
}
