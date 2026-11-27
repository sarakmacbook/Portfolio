"use server";

import { revalidatePath } from "next/cache";
import { db, isDatabaseConfigured } from "@/db";
import { ASSET_TYPES, assets, priceSnapshots, transactions, type AssetType } from "@/db/schema";
import { ensureSchema, recordSnapshot, today } from "@/lib/portfolio";
import {
  CustomApiImportError,
  customApiHostLabel,
  fetchCustomApiJson,
  importedCryptoCategory,
  MAX_CUSTOM_IMPORT_ROWS,
  normalizeCustomApiConfig,
  parseCustomApiHoldings,
  type ParsedCustomHolding,
} from "@/lib/custom-api-import";
import {
  clearCustomApiImportConfig,
  getCustomApiImportConfig,
  publicCustomApiImportConfig,
  saveCustomApiImportConfig,
} from "@/lib/custom-import-storage";
import type {
  CustomApiHolding,
  CustomApiImportActionResult,
  CustomApiImportConfig,
  CustomApiPreview,
  CustomApiPreviewActionResult,
} from "@/lib/custom-import-types";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function sameCredentialTarget(saved: CustomApiImportConfig, submitted: CustomApiImportConfig): boolean {
  try {
    return (
      new URL(saved.endpoint).origin === new URL(submitted.endpoint).origin &&
      saved.authMode === submitted.authMode &&
      saved.authHeader.toLowerCase() === submitted.authHeader.toLowerCase()
    );
  } catch {
    return false;
  }
}

function keyOf(type: AssetType, symbol: string): string {
  return `${type}:${symbol.trim().toUpperCase()}`;
}

/** Tests the configured JSON API, stores its key encrypted, and returns a mapped preview. */
export async function previewCustomApiImportAction(
  rawConfig: CustomApiImportConfig,
): Promise<CustomApiPreviewActionResult> {
  if (!isDatabaseConfigured()) return { error: "Connect the portfolio database before setting up an API import." };

  try {
    await ensureSchema();
    const submitted = normalizeCustomApiConfig(rawConfig);
    let saved: CustomApiImportConfig | null = null;
    let savedConfigError = false;
    try {
      saved = await getCustomApiImportConfig();
    } catch {
      // A new key supplied below can replace a record that used an old encryption key.
      savedConfigError = true;
    }

    let config = submitted;
    if (submitted.authMode !== "none" && !submitted.token) {
      if (saved && saved.token && sameCredentialTarget(saved, submitted)) {
        config = { ...submitted, token: saved.token };
      } else {
        throw new CustomApiImportError(
          savedConfigError
            ? "The saved API key cannot be decrypted. Paste a replacement key to reconnect."
            : "Paste an API key, or keep the saved key and use the same HTTPS host and authentication mode.",
        );
      }
    }

    const payload = await fetchCustomApiJson(config);
    const parsed = parseCustomApiHoldings(payload, config);
    const existing = await db.select({ type: assets.type, symbol: assets.symbol }).from(assets);
    const existingKeys = new Set(existing.map((row) => keyOf(row.type, row.symbol)));
    const rows: CustomApiHolding[] = parsed.rows.map((row, index) => ({
      ...row,
      id: `${row.type}-${row.symbol}-${index}`,
      alreadyExists: existingKeys.has(keyOf(row.type, row.symbol)),
    }));
    const preview: CustomApiPreview = {
      sourceName: config.sourceName,
      endpointHost: customApiHostLabel(config.endpoint),
      fetchedAt: new Date().toISOString(),
      dataCount: parsed.dataCount,
      skippedCount: parsed.skippedCount,
      rows,
    };

    // Persist only after the endpoint has returned a valid JSON response and the
    // response mapping has been checked. The token is AES-GCM encrypted at rest.
    await saveCustomApiImportConfig(config);
    revalidatePath("/imports");

    const message =
      rows.length === 0
        ? "Connected successfully, but no usable holdings matched these field mappings. Adjust the response paths and try again."
        : `Fetched ${parsed.dataCount} rows. ${rows.length} usable${parsed.skippedCount ? `, ${parsed.skippedCount} skipped` : ""}.`;
    return {
      ok: true,
      message,
      config: publicCustomApiImportConfig(config),
      preview,
    };
  } catch (error) {
    return { error: errorMessage(error, "Could not fetch the custom API.") };
  }
}

type SelectedHolding = Omit<ParsedCustomHolding, "value">;

function validateSelection(value: unknown): SelectedHolding[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CustomApiImportError("Select at least one holding to import.");
  }
  if (value.length > MAX_CUSTOM_IMPORT_ROWS) {
    throw new CustomApiImportError(`You can import up to ${MAX_CUSTOM_IMPORT_ROWS} holdings at a time.`);
  }

  const unique = new Map<string, SelectedHolding>();
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new CustomApiImportError("One of the selected holdings is invalid. Fetch a new preview and try again.");
    }
    const record = item as Record<string, unknown>;
    const type = String(record.type ?? "") as AssetType;
    if (!(ASSET_TYPES as readonly string[]).includes(type)) {
      throw new CustomApiImportError("One of the selected asset types is invalid.");
    }
    const symbol = String(record.symbol ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(symbol)) {
      throw new CustomApiImportError("One of the selected symbols is invalid. Fetch a new preview and try again.");
    }
    const name = String(record.name ?? symbol)
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) || symbol;
    const quantity = Number(record.quantity);
    const price = type === "cash" ? 1 : Number(record.price);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price < 0 || !Number.isFinite(quantity * price)) {
      throw new CustomApiImportError("One of the selected quantities or prices is invalid.");
    }
    unique.set(keyOf(type, symbol), { type, symbol, name, quantity, price });
  }
  return [...unique.values()];
}

/** Imports selected preview rows as opening deposits. Duplicate symbols are skipped. */
export async function importCustomApiHoldingsAction(
  rawRows: CustomApiHolding[],
  rawSourceName: string,
): Promise<CustomApiImportActionResult> {
  if (!isDatabaseConfigured()) return { error: "Connect the portfolio database before importing holdings." };

  try {
    await ensureSchema();
    const rows = validateSelection(rawRows);
    const sourceName = String(rawSourceName ?? "Custom API")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60) || "Custom API";
    const date = today();
    const knownAssets = await db.select({ type: assets.type, symbol: assets.symbol }).from(assets);
    const existingKeys = new Set(knownAssets.map((row) => keyOf(row.type, row.symbol)));
    const inserted = await db.transaction(async (transaction) => {
      const ids: number[] = [];
      for (const row of rows) {
        const key = keyOf(row.type, row.symbol);
        if (existingKeys.has(key)) continue;

        const price = row.type === "cash" ? 1 : row.price;
        const [asset] = await transaction
          .insert(assets)
          .values({
            type: row.type,
            name: row.name || row.symbol,
            symbol: row.symbol,
            cryptoCategory: row.type === "crypto" ? importedCryptoCategory(row.symbol) : "volatile",
            quantity: row.quantity,
            avgCost: row.type === "cash" ? 1 : price,
            currentPrice: price,
            realizedPnl: 0,
            notes: `Imported from ${sourceName}`,
          })
          .returning({ id: assets.id });

        await transaction.insert(transactions).values({
          assetId: asset.id,
          kind: "deposit",
          quantity: row.quantity,
          price,
          fee: 0,
          date,
          note: `Imported from ${sourceName}`,
        });
        if (price > 0) {
          await transaction
            .insert(priceSnapshots)
            .values({ assetId: asset.id, date, price })
            .onConflictDoNothing();
        }
        existingKeys.add(key);
        ids.push(asset.id);
      }
      return ids;
    });

    let snapshotWarning = "";
    if (inserted.length > 0) {
      try {
        await recordSnapshot(date);
      } catch {
        snapshotWarning = " Holdings were imported, but the daily snapshot could not be refreshed.";
      }
    }

    revalidatePath("/imports");
    if (inserted.length > 0) revalidatePath("/", "layout");
    const skipped = rows.length - inserted.length;
    const message =
      inserted.length === 0
        ? "Nothing new was imported; the selected symbols are already in your portfolio."
        : `Imported ${inserted.length} ${inserted.length === 1 ? "holding" : "holdings"}${skipped ? `; skipped ${skipped} already in the portfolio` : ""}.${snapshotWarning}`;
    return { ok: true, message, imported: inserted.length, skipped };
  } catch (error) {
    return { error: errorMessage(error, "Could not import the selected holdings.") };
  }
}

/** Removes the saved encrypted connection without changing imported holdings. */
export async function forgetCustomApiImportAction(): Promise<CustomApiImportActionResult> {
  if (!isDatabaseConfigured()) return { error: "Connect the portfolio database before changing API settings." };
  try {
    await clearCustomApiImportConfig();
    revalidatePath("/imports");
    return { ok: true, message: "Saved API connection forgotten. Imported holdings stay in your portfolio." };
  } catch (error) {
    return { error: errorMessage(error, "Could not forget the saved API connection.") };
  }
}
