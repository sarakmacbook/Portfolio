import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  SCAN_SORTS,
  effectiveWalletCategory,
  groupWalletBalancesByChain,
  marketCapTier,
  searchWalletBalances,
  shortMarketCap,
  sortWalletBalances,
  walletValueUsd,
} from "../src/lib/wallet-results";

type Row = {
  id: string;
  symbol: string;
  name: string;
  chain: string;
  chainLabel: string;
  valueUsd: number;
  cmcName?: string;
};

const rows: Row[] = [
  { id: "usdc-base", symbol: "USDC", name: "USD Coin", chain: "base", chainLabel: "Base", valueUsd: 120 },
  { id: "eth-base", symbol: "ETH", name: "Ethereum", chain: "base", chainLabel: "Base", valueUsd: 3_000 },
  { id: "usdt-eth", symbol: "USDT", name: "Tether USD", chain: "ethereum", chainLabel: "Ethereum", valueUsd: 500 },
  { id: "renamed", symbol: "RNDR", name: "Render", chain: "ethereum", chainLabel: "Ethereum", valueUsd: 40, cmcName: "Render" },
  { id: "unpriced", symbol: "NEW", name: "New Token", chain: "polygon", chainLabel: "Polygon", valueUsd: 0 },
];

test("the search matches ticker, name, chain and CoinMarketCap's name", () => {
  // An empty (or blank) box shows everything, so the caller needs no branch.
  assert.equal(searchWalletBalances(rows, "").length, rows.length);
  assert.equal(searchWalletBalances(rows, "   ").length, rows.length);

  assert.deepEqual(searchWalletBalances(rows, "usd").map((row) => row.id), ["usdc-base", "usdt-eth"]);
  assert.deepEqual(searchWalletBalances(rows, "USD COIN").map((row) => row.id), ["usdc-base"]);
  assert.deepEqual(searchWalletBalances(rows, "eth").map((row) => row.id), [
    "eth-base",
    "usdt-eth",
    "renamed",
  ]);
  // The chain is searchable both ways: the id and the label the scan sent.
  assert.deepEqual(searchWalletBalances(rows, "polygon").map((row) => row.id), ["unpriced"]);
  assert.deepEqual(searchWalletBalances(rows, "base").map((row) => row.id), ["usdc-base", "eth-base"]);
  assert.deepEqual(searchWalletBalances(rows, "render").map((row) => row.id), ["renamed"]);
  assert.deepEqual(searchWalletBalances(rows, "nothing-like-this"), []);
});

test("the results group by chain, biggest first, with a total each", () => {
  const groups = groupWalletBalancesByChain(rows);
  assert.deepEqual(groups.map((group) => group.chain), ["base", "ethereum", "polygon"]);
  assert.deepEqual(groups.map((group) => group.label), ["Base", "Ethereum", "Polygon"]);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].valueUsd, 3_120);
  assert.equal(groups[1].valueUsd, 540);
  assert.equal(groups[2].valueUsd, 0);

  // Nothing is dropped: the groups hold exactly what went in.
  assert.equal(
    groups.reduce((sum, group) => sum + group.items.length, 0),
    rows.length,
  );

  // Two chains worth nothing fall back to the alphabet, so the order is stable.
  const flat = [
    { ...rows[4], id: "z", chain: "zora", chainLabel: "Zora" },
    { ...rows[4], id: "a", chain: "arbitrum", chainLabel: "Arbitrum" },
  ];
  assert.deepEqual(groupWalletBalancesByChain(flat).map((group) => group.label), ["Arbitrum", "Zora"]);

  // A single chain is still one group, never a special case.
  const one = groupWalletBalancesByChain([rows[0], rows[1]]);
  assert.equal(one.length, 1);
  assert.equal(one[0].items.length, 2);
});

test("the running total counts what has a price and ignores what does not", () => {
  assert.equal(walletValueUsd(rows), 3_660);
  assert.equal(walletValueUsd([]), 0);
  assert.equal(walletValueUsd([{ valueUsd: 0 }, { valueUsd: Number.NaN }, {}]), 0);
});

test("the picker searches, groups and totals with those helpers", () => {
  const dialog = readFileSync(resolve(__dirname, "../src/components/AddAssetDialog.tsx"), "utf8");

  assert.ok(dialog.includes("searchWalletBalances("), "the search box filters the cards");
  assert.ok(dialog.includes("groupWalletBalancesByChain("), "the results are grouped by chain");
  assert.ok(dialog.includes("walletValueUsd("), "and the ticked total is computed once");

  assert.ok(dialog.includes('placeholder="Search ticker, name or chain…"'), "there is a search box");
  assert.ok(dialog.includes("Clear the search"), "an empty search result explains itself");
  assert.ok(dialog.includes("Group by chain"), "grouping can be switched off");
  assert.ok(dialog.includes("Tick chain"), "a whole chain can be ticked at once");
  assert.ok(dialog.includes("walletChosenValue"), "the selected total is shown");
  // Select all / none act on what the search shows, not on everything.
  assert.ok(dialog.includes("for (const item of walletMatched) next.add(item.id)"));
  assert.ok(dialog.includes("for (const item of walletMatched) next.delete(item.id)"));
  // The cards are a responsive grid, not one long horizontal scroll.
  assert.ok(dialog.includes('grid max-h-[24rem] grid-cols-2'));
});

type Ranked = {
  id: string;
  valueUsd: number;
  marketCapUsd?: number;
  verification?: "verified" | "unverified" | "unknown";
};

const ranked: Ranked[] = [
  // A big holding of a token nobody could verify.
  { id: "junk", valueUsd: 5_000, verification: "unverified", marketCapUsd: 20_000 },
  // A small holding of a blue chip.
  { id: "blue", valueUsd: 50, verification: "verified", marketCapUsd: 60_000_000_000 },
  // Verified, mid cap.
  { id: "mid", valueUsd: 800, verification: "verified", marketCapUsd: 300_000_000 },
  // No data at all.
  { id: "unknown", valueUsd: 10 },
];

test("the default order puts real, big tokens first", () => {
  assert.deepEqual(sortWalletBalances(ranked, "best").map((row) => row.id), [
    "blue",
    "mid",
    "junk",
    "unknown",
  ]);
  // Verified comes before unverified even when the unverified one is worth more.
  assert.ok(
    sortWalletBalances(ranked, "best").findIndex((row) => row.id === "blue") <
      sortWalletBalances(ranked, "best").findIndex((row) => row.id === "junk"),
  );

  assert.deepEqual(sortWalletBalances(ranked, "value").map((row) => row.id), [
    "junk",
    "mid",
    "blue",
    "unknown",
  ]);
  assert.deepEqual(sortWalletBalances(ranked, "marketCap").map((row) => row.id), [
    "blue",
    "mid",
    "junk",
    "unknown",
  ]);

  // Nothing is dropped by any order, and the input is left alone.
  for (const sort of SCAN_SORTS) {
    assert.equal(sortWalletBalances(ranked, sort.id).length, ranked.length);
  }
  assert.deepEqual(ranked.map((row) => row.id), ["junk", "blue", "mid", "unknown"]);
  // The default is the first option offered, and it is labelled plainly.
  assert.equal(SCAN_SORTS[0].id, "best");
});

test("a market cap is labelled by size, and an unknown cap is never a judgement", () => {
  assert.equal(marketCapTier(2_500_000_000), "major");
  assert.equal(marketCapTier(120_000_000), "large");
  assert.equal(marketCapTier(4_000_000), "mid");
  assert.equal(marketCapTier(50_000), "small");
  assert.equal(marketCapTier(0), "unknown");
  assert.equal(marketCapTier(undefined), "unknown");
  assert.equal(marketCapTier(Number.NaN), "unknown");

  assert.equal(shortMarketCap(60_000_000_000), "$60.0B");
  assert.equal(shortMarketCap(45_000_000), "$45.0M");
  assert.equal(shortMarketCap(820_000), "$820k");
  assert.equal(shortMarketCap(0), "");
  assert.equal(shortMarketCap(undefined), "");
});

test("the folder dropdown files the wallet into one existing folder", () => {
  const dialog = readFileSync(resolve(__dirname, "../src/components/AddAssetDialog.tsx"), "utf8");
  assert.ok(dialog.includes("Import as one folder"), "the choice is worded as one folder");
  assert.ok(dialog.includes('aria-label="Folder to import the scanned tokens into"'), "there is a dropdown");
  assert.ok(dialog.includes("folders.map((folder) => ("), "it lists the existing folders");
  assert.ok(dialog.includes("New folder"), "and offers a new one");
  assert.ok(dialog.includes("folderId: walletFileIntoFolder && walletPickedFolder ?"), "a picked folder is sent by id");
  assert.ok(dialog.includes("walletPickedFolder.name"), "the copy names the target folder");

  const actions = readFileSync(resolve(__dirname, "../src/app/actions.ts"), "utf8");
  const body = actions.slice(actions.indexOf("export async function importWalletBalances"));
  assert.ok(body.includes("folderId?: string | null"), "the action accepts a folder id");
  assert.ok(body.includes("folders.find((item) => item.id === pickedId)"), "and files into that exact folder");
  assert.ok(body.includes("folderForImport(folders, wanted)"), "falling back to the name when it is gone");

  const page = readFileSync(resolve(__dirname, "../src/app/page.tsx"), "utf8");
  assert.ok(page.includes("folders={foldersForDialog}"), "the dashboard hands the folders to the dialog");
});

test("a token's category is the scan's guess unless the user corrected it", () => {
  const guessed = { id: "usdt-eth", category: "stablecoin" as const };
  const volatile = { id: "pepe-base", category: "volatile" as const };

  // No correction: the scan's answer is what the token is filed under.
  assert.equal(effectiveWalletCategory(guessed, {}), "stablecoin");
  assert.equal(effectiveWalletCategory(volatile, {}), "volatile");

  // A correction on the card wins, whichever way it goes.
  assert.equal(
    effectiveWalletCategory(guessed, { "usdt-eth": "volatile" }),
    "volatile",
  );
  assert.equal(
    effectiveWalletCategory(volatile, { "pepe-base": "stablecoin" }),
    "stablecoin",
  );

  // A correction for another token (or left over from an old scan) changes nothing.
  assert.equal(effectiveWalletCategory(guessed, { "other-id": "volatile" }), "stablecoin");
});

test("each scanned token gets its own Add button, category dropdown and batch import", () => {
  const dialog = readFileSync(resolve(__dirname, "../src/components/AddAssetDialog.tsx"), "utf8");

  // Per-asset category selector, on every card, with both tabs offered.
  assert.ok(dialog.includes("walletCategoryOverrides"), "corrections are kept per token id");
  assert.ok(dialog.includes("effectiveWalletCategory("), "the correction is applied through one helper");
  assert.ok(dialog.includes('aria-label={`Category for ${item.symbol}`}'), "each card has a dropdown");
  assert.ok(dialog.includes('<option value="volatile">Volatile</option>'), "volatile is offered");
  assert.ok(dialog.includes('<option value="stablecoin">Stablecoin</option>'), "stablecoin is offered");

  // Per-asset Add: one token, straight into its category, and it stays added.
  assert.ok(dialog.includes("handleImportOneWalletBalance(item)"), "each card has its own Add button");
  assert.ok(dialog.includes("walletAdded.has(item.id)"), "an added token cannot be added twice");
  assert.ok(dialog.includes("walletAddingId === item.id"), "the busy card shows it is working");

  // The batch flow is still there, and files each ticked token under its category.
  assert.ok(dialog.includes("handleImportAllWalletBalances()"), "batch import is kept");
  assert.ok(dialog.includes("Import selected ("), "and still says how many are ticked");
  assert.ok(
    dialog.includes("category: walletCategoryOf(item)"),
    "batch import sends the corrected category per token",
  );
  assert.ok(
    dialog.includes("!walletAdded.has(item.id)"),
    "batch import leaves out tokens already added one by one",
  );

  // A new scan starts clean: no stale corrections or Added marks.
  assert.ok(dialog.includes("setWalletCategoryOverrides({})"), "a new scan clears corrections");
  assert.ok(dialog.includes("setWalletAdded(new Set())"), "a new scan clears Added marks");

  const actions = readFileSync(resolve(__dirname, "../src/app/actions.ts"), "utf8");
  const body = actions.slice(actions.indexOf("export async function importWalletBalances"));
  assert.ok(
    body.includes("CRYPTO_CATEGORIES.includes(item.category) ? item.category : \"volatile\""),
    "the import files each token under the category it was sent with",
  );
});
