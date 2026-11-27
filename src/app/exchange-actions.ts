"use server";

import { revalidatePath } from "next/cache";
import { isDatabaseConfigured } from "@/db";
import {
  getExchangeCredentials,
  isExchangeId,
  looksLikeApiKey,
  looksLikeApiSecret,
  normaliseCredential,
  saveExchangeCredentials,
} from "@/lib/exchange-credentials";
import { EXCHANGE_IDS, EXCHANGE_LABELS, verifyExchangeCredentials, type ExchangeId } from "@/lib/exchanges";
import {
  describeSyncResult,
  disconnectExchange,
  exchangeGroupCandidates,
  syncExchange,
  syncedAssetIds,
  type ExchangeSyncResult,
} from "@/lib/exchange-sync";
import { fileHoldingsIntoGroup } from "@/lib/group-filing";
import {
  assetRowKey,
  normaliseGroupRequest,
  type GroupPromptRow,
  type HoldingsGroupRequest,
} from "@/lib/holdings-group";

export type ExchangeActionState = {
  error?: string;
  message?: string;
  warning?: string;
  ok?: boolean;
  ts?: number;
  result?: ExchangeSyncResult;
  /** Holdings to offer in the "save as a group" dialog after a sync. */
  groupCandidates?: GroupPromptRow[];
  /** Name suggested in that dialog, e.g. "Binance" or "Exchanges". */
  groupSuggestion?: string;
};

function field(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function exchangeFrom(fd: FormData): ExchangeId {
  const value = field(fd, "exchange");
  if (!isExchangeId(value)) throw new Error("Unknown exchange");
  return value;
}

/**
 * The group dialog's rows for a successful sync. A read failure here must not
 * turn a sync that already wrote its deposits into an error, so it simply means
 * "no dialog this time".
 */
async function groupRowsFor(
  exchanges: readonly ExchangeId[],
): Promise<Pick<ExchangeActionState, "groupCandidates" | "groupSuggestion">> {
  try {
    const rows = await exchangeGroupCandidates(exchanges);
    if (rows.length === 0) return {};
    const suggestion =
      exchanges.length === 1
        ? EXCHANGE_LABELS[exchanges[0]]
        : `${exchanges.length} exchanges`;
    return { groupCandidates: rows, groupSuggestion: suggestion };
  } catch {
    return {};
  }
}

/** Rethrows exchange/API messages as-is; those are written for humans already. */
function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function saveExchangeKeyAction(
  _prev: ExchangeActionState,
  fd: FormData,
): Promise<ExchangeActionState> {
  let result: ExchangeSyncResult;
  let exchange: ExchangeId;
  try {
    exchange = exchangeFrom(fd);
    const label = EXCHANGE_LABELS[exchange];
    const apiKey = normaliseCredential(fd.get("apiKey"), "API key");
    const secret = normaliseCredential(fd.get("apiSecret"), "API secret");
    const passphrase = normaliseCredential(fd.get("passphrase"), "Passphrase");
    const requestedAccountType = normaliseCredential(fd.get("accountType"), "Account type").toUpperCase();

    if (!apiKey) throw new Error(`${label} API key is required.`);
    if (!secret) throw new Error(`${label} API secret is required.`);
    if (!looksLikeApiKey(apiKey)) {
      throw new Error("That does not look like an API key — check for spaces or a partial paste.");
    }
    if (!looksLikeApiSecret(secret)) {
      throw new Error("That does not look like an API secret — check for spaces or a partial paste.");
    }
    if (exchange === "okx" && !passphrase) {
      throw new Error("OKX also needs the passphrase you set when creating the key.");
    }
    const accountType = exchange === "bybit" ? requestedAccountType || "UNIFIED" : "";
    if (exchange === "bybit" && !["UNIFIED", "SPOT", "CONTRACT"].includes(accountType)) {
      throw new Error("Bybit account type must be UNIFIED, SPOT or CONTRACT.");
    }

    const credentials = {
      exchange,
      apiKey,
      secret,
      passphrase: exchange === "okx" ? passphrase : "",
      accountType,
      savedAt: new Date().toISOString(),
    };

    // Verify before storing, so a typo never becomes a saved-but-broken key.
    // Its answer is the first import, so connecting costs one API call.
    const balances = await verifyExchangeCredentials(credentials);

    await saveExchangeCredentials(credentials);
    result = await syncExchange(exchange, Date.now(), balances);
    if (balances.length === 0 && result.warnings.length === 0) {
      result.warnings.push(`${label} returned no balances for this key.`);
    }
  } catch (error) {
    return { error: messageOf(error, "Could not connect the exchange key") };
  }

  revalidatePath("/exchanges");
  revalidatePath("/", "layout");
  return {
    ok: true,
    ts: Date.now(),
    message: `${EXCHANGE_LABELS[exchange]} connected — ${describeSyncResult(result, { label: false })}`,
    warning: result.warnings[0],
    result,
    ...(await groupRowsFor([exchange])),
  };
}

/** Re-reads one exchange and books the difference into the portfolio. */
export async function syncExchangeAction(
  _prev: ExchangeActionState,
  fd: FormData,
): Promise<ExchangeActionState> {
  let result: ExchangeSyncResult;
  let exchange: ExchangeId;
  try {
    exchange = exchangeFrom(fd);
    if (!(await getExchangeCredentials(exchange))) {
      throw new Error(`No ${EXCHANGE_LABELS[exchange]} key saved. Connect one first.`);
    }
    result = await syncExchange(exchange);
  } catch (error) {
    return { error: messageOf(error, "Could not sync the exchange") };
  }

  revalidatePath("/exchanges");
  revalidatePath("/", "layout");
  return {
    ok: true,
    ts: Date.now(),
    message: describeSyncResult(result),
    warning: result.warnings[0],
    result,
    ...(await groupRowsFor([exchange])),
  };
}

/** Syncs every connected exchange; one failure does not stop the others. */
export async function syncAllExchangesAction(
  _prev: ExchangeActionState,
  _fd: FormData,
): Promise<ExchangeActionState> {
  const results: ExchangeSyncResult[] = [];
  const synced: ExchangeId[] = [];
  const errors: string[] = [];
  let connected = 0;

  for (const exchange of EXCHANGE_IDS) {
    try {
      if (!(await getExchangeCredentials(exchange))) continue;
      connected += 1;
      results.push(await syncExchange(exchange));
      synced.push(exchange);
    } catch (error) {
      errors.push(`${EXCHANGE_LABELS[exchange]}: ${messageOf(error, "sync failed")}`);
    }
  }

  revalidatePath("/exchanges");
  revalidatePath("/", "layout");

  if (connected === 0) {
    return { error: "No exchanges connected yet. Add a read-only API key first." };
  }
  if (results.length === 0 && errors.length > 0) {
    return { error: errors.join(" ") };
  }

  const warning = [...results.flatMap((r) => r.warnings), ...errors][0];
  return {
    ok: true,
    ts: Date.now(),
    message: results.map((result) => describeSyncResult(result)).join(" "),
    warning,
    ...(await groupRowsFor(synced)),
  };
}

/**
 * Files holdings that a sync just brought in into a group from the same dialog
 * the API import uses: a name, an optional logo and the ticked rows.
 *
 * Only assets an exchange balance points at can be filed, so a stale or crafted
 * request cannot move unrelated holdings around.
 */
export async function fileSyncedHoldingsAction(
  rawGroup: HoldingsGroupRequest | string | null,
): Promise<ExchangeActionState> {
  if (!isDatabaseConfigured()) return { error: "Connect the portfolio database before grouping holdings." };

  try {
    const requested = normaliseGroupRequest(rawGroup);
    if (!requested) {
      return { ok: true, ts: Date.now(), message: "Skipped — the synced holdings stay ungrouped." };
    }

    const available = await syncedAssetIds();
    const wanted = requested.assetKeys;
    const ids = available.filter((id) => !wanted || wanted.has(assetRowKey(id)));
    const outcome = await fileHoldingsIntoGroup(requested, ids);

    revalidatePath("/exchanges");
    revalidatePath("/", "layout");
    if (!outcome.group) {
      return { ok: true, ts: Date.now(), message: "Sync finished.", warning: outcome.note.trim() };
    }
    return {
      ok: true,
      ts: Date.now(),
      message: `Filed ${outcome.group.filed} ${
        outcome.group.filed === 1 ? "holding" : "holdings"
      } into the “${outcome.group.name}” group.`,
    };
  } catch (error) {
    return { error: messageOf(error, "Could not file these holdings into a group.") };
  }
}

/** Removes the stored key. Imported holdings stay in the portfolio. */
export async function disconnectExchangeAction(
  _prev: ExchangeActionState,
  fd: FormData,
): Promise<ExchangeActionState> {
  let exchange: ExchangeId;
  try {
    exchange = exchangeFrom(fd);
    await disconnectExchange(exchange);
  } catch (error) {
    return { error: messageOf(error, "Could not disconnect the exchange") };
  }
  revalidatePath("/exchanges");
  return {
    ok: true,
    ts: Date.now(),
    message: `${EXCHANGE_LABELS[exchange]} disconnected. The holdings it imported stay in your portfolio.`,
  };
}
