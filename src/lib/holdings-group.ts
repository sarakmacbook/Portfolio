/**
 * The group dialog's data model, shared by the two flows that offer it.
 *
 * Both API imports and exchange syncs ask the same question — name a group, give
 * it a logo, tick the holdings that belong in it, or skip — so the request shape
 * and the ticked-row keys live here, free of server imports, and are unit
 * tested in tests/holdings-group.test.ts.
 */
import { EXCHANGE_LABELS, type ExchangeId } from "@/lib/exchanges";
import { MAX_FOLDERS, MAX_FOLDER_NAME_LENGTH, type FolderIconKind } from "@/lib/holdings-folders";

/** A logo picked in the dialog. A reused group keeps its own instead. */
export type GroupIconChoice = {
  icon: FolderIconKind;
  glyph?: string;
  imageDataUrl?: string;
};

/**
 * What the dialog asks for before filing holdings.
 *
 * `assetKeys` are `type:SYMBOL` keys for an API import (the assets do not exist
 * yet) or `asset:<id>` keys for an exchange sync (they do). `null`/omitted files
 * everything the caller offers.
 */
export type HoldingsGroupRequest = {
  name: string;
  assetKeys?: string[] | null;
  icon?: GroupIconChoice;
};

/** One tickable row in the dialog. */
export type GroupPromptRow = {
  /** The key the caller files this row by — `type:SYMBOL` or `asset:<id>`. */
  key: string;
  symbol: string;
  name: string;
  /** Second line under the symbol: asset type, or the exchange it came from. */
  label: string;
  value: number;
};

/** Guards against a huge payload; both flows top out well below this. */
export const MAX_GROUP_KEYS = 500;

const KEY_PATTERN = /^[a-z]+:[A-Za-z0-9._-]{1,40}$/;
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;
const ASSET_ID_PATTERN = /^[1-9]\d{0,15}$/;
const ASSET_TYPE_PREFIXES = new Set(["cash", "stock", "crypto", "other"]);

export type RequestedGroup = {
  name: string;
  /** `null` = file every offered row; otherwise only these keys. */
  assetKeys: Set<string> | null;
  icon?: GroupIconChoice;
};

/**
 * Reads the dialog's answer. A plain string is still accepted so a tab opened
 * before the dialog existed (or a stale client) means "file everything".
 *
 * `null` is Skip. An empty tick list also means no group: creating one with
 * nothing in it would just leave an empty heading in Holdings.
 */
export function normaliseGroupRequest(
  raw: HoldingsGroupRequest | string | null | undefined,
): RequestedGroup | null {
  if (raw === null || raw === undefined) return null;
  const record = typeof raw === "string" ? { name: raw } : raw;
  const name = String(record.name ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FOLDER_NAME_LENGTH);
  if (!name) return null;

  let assetKeys: Set<string> | null = null;
  if (Array.isArray(record.assetKeys)) {
    assetKeys = new Set<string>();
    for (const rawKey of record.assetKeys.slice(0, MAX_GROUP_KEYS)) {
      const text = String(rawKey ?? "").trim();
      if (!KEY_PATTERN.test(text)) continue;
      const separator = text.indexOf(":");
      const prefix = text.slice(0, separator);
      const value = text.slice(separator + 1);
      if (ASSET_TYPE_PREFIXES.has(prefix)) {
        const symbol = value.toUpperCase();
        if (!SYMBOL_PATTERN.test(symbol)) continue;
        assetKeys.add(`${prefix}:${symbol}`);
      } else if (prefix === "asset") {
        if (!ASSET_ID_PATTERN.test(value)) continue;
        assetKeys.add(`asset:${value}`);
      }
    }
    if (assetKeys.size === 0) return null;
  }

  const rawIcon = typeof record.icon === "object" && record.icon !== null ? record.icon : null;
  const icon = rawIcon
    ? {
        icon: String(rawIcon.icon ?? "auto") as FolderIconKind,
        glyph: String(rawIcon.glyph ?? "").slice(0, 8),
        imageDataUrl: String(rawIcon.imageDataUrl ?? ""),
      }
    : undefined;

  return { name, assetKeys, ...(icon ? { icon } : {}) };
}

/** The sentence reported when a group was named but could not be created. */
export function groupRoomNote(count: number): string {
  return ` There is no room for another group (${count}/${MAX_FOLDERS} used), so the holdings were left ungrouped.`;
}

/** Builds the import key for a preview row — see `keyOf` in the import action. */
export function importRowKey(type: string, symbol: string): string {
  return `${type}:${symbol.trim().toUpperCase()}`;
}

/** Builds the sync key for an asset already in the portfolio. */
export function assetRowKey(assetId: number): string {
  return `asset:${assetId}`;
}

type SyncedRow = {
  assetId: number;
  exchange: string;
  symbol: string;
  name: string;
  value: number;
};

/**
 * Turns the exchange page's per-exchange positions into one row per holding:
 * a coin held on two exchanges is a single tick box whose label says how many
 * exchanges it came from, and whose value is the sum.
 */
export function mergeSyncedHoldings(rows: readonly SyncedRow[]): GroupPromptRow[] {
  const byAsset = new Map<number, { row: GroupPromptRow; exchanges: Set<string> }>();
  for (const row of rows) {
    const existing = byAsset.get(row.assetId);
    if (existing) {
      existing.row.value += row.value;
      existing.exchanges.add(row.exchange);
      continue;
    }
    byAsset.set(row.assetId, {
      row: {
        key: assetRowKey(row.assetId),
        symbol: row.symbol,
        name: row.name,
        label: "",
        value: row.value,
      },
      exchanges: new Set([row.exchange]),
    });
  }
  return [...byAsset.values()].map(({ row, exchanges }) => {
    const [only] = exchanges;
    const label =
      exchanges.size === 1
        ? (EXCHANGE_LABELS[only as ExchangeId] ?? only)
        : `${exchanges.size} exchanges`;
    return { ...row, label };
  });
}
