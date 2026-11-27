import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_GROUP_KEYS,
  assetRowKey,
  groupRoomNote,
  importRowKey,
  mergeSyncedHoldings,
  normaliseGroupRequest,
} from "../src/lib/holdings-group";
import { MAX_FOLDER_NAME_LENGTH } from "../src/lib/holdings-folders";

test("a group request keeps its name, logo and ticked rows", () => {
  const request = normaliseGroupRequest({
    name: "  Nansen   wallet ",
    assetKeys: ["crypto:btc", "stock:aapl"],
    icon: { icon: "emoji", glyph: "🏦" },
  });
  assert.ok(request);
  assert.equal(request.name, "Nansen wallet", "whitespace is collapsed and trimmed");
  assert.deepEqual([...(request.assetKeys ?? [])], ["crypto:BTC", "stock:AAPL"], "symbols are upper-cased");
  assert.equal(request.icon?.icon, "emoji");
  assert.equal(request.icon?.glyph, "🏦");
});

test("the group name is clamped like every other group", () => {
  const request = normaliseGroupRequest({ name: "x".repeat(80) });
  assert.equal(request?.name.length, MAX_FOLDER_NAME_LENGTH);
  assert.equal(request?.assetKeys, null, "no tick list means every offered row is filed");
});

test("Skip and an empty tick list both mean 'no group'", () => {
  assert.equal(normaliseGroupRequest(null), null);
  assert.equal(normaliseGroupRequest(undefined), null);
  assert.equal(normaliseGroupRequest("   "), null);
  assert.equal(normaliseGroupRequest(""), null);
  assert.equal(normaliseGroupRequest({ name: "Wallet", assetKeys: [] }), null);
  assert.equal(
    normaliseGroupRequest({ name: "Wallet", assetKeys: ["not a key", "nope", ":BTC"] }),
    null,
    "keys that cannot match anything leave nothing to file",
  );
});

test("a bare name still works, for a tab opened before the dialog existed", () => {
  const request = normaliseGroupRequest("Binance");
  assert.equal(request?.name, "Binance");
  assert.equal(request?.assetKeys, null);
});

test("only known holding keys survive validation", () => {
  const request = normaliseGroupRequest({
    name: "Wallet",
    assetKeys: ["crypto:BTC", "asset:12", "asset:0", "asset:-3", "vault:1", "crypto:", "crypto:B T C"],
  });
  assert.deepEqual([...(request?.assetKeys ?? [])], ["crypto:BTC", "asset:12"]);
});

test("the tick list is capped so a crafted request stays small", () => {
  const keys = Array.from({ length: MAX_GROUP_KEYS + 40 }, (_, index) => `asset:${index + 1}`);
  const request = normaliseGroupRequest({ name: "Wallet", assetKeys: keys });
  assert.equal(request?.assetKeys?.size, MAX_GROUP_KEYS);
});

test("row keys match what each flow files by", () => {
  assert.equal(importRowKey("crypto", " btc "), "crypto:BTC");
  assert.equal(assetRowKey(42), "asset:42");
  assert.equal(groupRoomNote(20).includes("no room"), true);
  assert.equal(groupRoomNote(20).includes("20"), true);
});

test("synced holdings merge into one row per asset", () => {
  const rows = mergeSyncedHoldings([
    { assetId: 7, exchange: "binance", symbol: "BTC", name: "Bitcoin", value: 1000 },
    { assetId: 7, exchange: "okx", symbol: "BTC", name: "Bitcoin", value: 500 },
    { assetId: 9, exchange: "binance", symbol: "ETH", name: "Ethereum", value: 200 },
  ]);

  assert.equal(rows.length, 2, "a coin held on two exchanges is one tick box");
  const btc = rows.find((row) => row.key === "asset:7");
  assert.ok(btc);
  assert.equal(btc.value, 1500, "the values are summed");
  assert.equal(btc.label, "2 exchanges");
  const eth = rows.find((row) => row.key === "asset:9");
  assert.equal(eth?.label, "Binance", "a single exchange is named");
});
