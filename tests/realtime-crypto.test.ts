import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../src/app/api/prices/live/route";
import { cryptoRefreshTargets } from "../src/lib/portfolio";
import { isRealtimeCryptoCategory } from "../src/lib/stablecoins";

test("real-time updates include stablecoins", () => {
  assert.equal(isRealtimeCryptoCategory("volatile"), true);
  assert.equal(isRealtimeCryptoCategory("stablecoin"), true);
  // An unknown or missing category keeps the old behaviour: fetch it.
  assert.equal(isRealtimeCryptoCategory(undefined), true);
  assert.equal(isRealtimeCryptoCategory(null), true);
});

test("all refresh runs include stablecoins", () => {
  const crypto = [
    { cryptoCategory: "volatile" as const },
    { cryptoCategory: "stablecoin" as const },
    { cryptoCategory: "volatile" as const },
  ];
  assert.deepEqual(cryptoRefreshTargets(crypto, true), crypto);
  // Daily and manual runs still capture every crypto asset once a day.
  assert.deepEqual(cryptoRefreshTargets(crypto, false), crypto);
});

test("live route fetches stablecoin and volatile prices", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    // Bybit's order-book shape: result.b / result.a hold the bid/ask levels.
    return new Response(JSON.stringify({ result: { b: [["122", "1"]], a: [["124", "1"]] } }), { status: 200 });
  };
  try {
    const response = await POST(new Request("http://example.test/api/prices/live", {
      method: "POST",
      body: JSON.stringify({
        provider: "bybit",
        assets: [
          { id: 1, symbol: "USDC", type: "crypto", cryptoCategory: "stablecoin" },
          { id: 2, symbol: "BTC", type: "crypto", cryptoCategory: "volatile" },
        ],
      }),
    }));
    const data = await response.json();
    assert.equal(calls.length, 2);
    assert.ok(calls.some(url => url.includes("USDCUSDT")));
    assert.equal(data.found, 2);
    assert.equal(data.results[0].price, 123);
    assert.equal(data.results[1].price, 123);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed stablecoin quotes report an error without inventing a peg", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return new Response("unavailable", { status: 503 });
  };
  try {
    const response = await POST(new Request("http://example.test/api/prices/live", {
      method: "POST",
      body: JSON.stringify({
        provider: "bybit",
        fallback: true,
        assets: [{ id: 3, symbol: "USDC", type: "crypto", cryptoCategory: "stablecoin" }],
      }),
    }));
    const data = await response.json();
    assert.ok(calls.length > 0);
    assert.equal(data.found, 0);
    assert.match(data.results[0].error, /No exchange returned/);
    assert.equal(data.results[0].price, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("manual live fetch falls back to a USD venue for USDT even without fallback flag", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    return url.includes("products/USDT-USD/book")
      ? new Response(JSON.stringify({ bids: [["0.98", "1"]], asks: [["1.00", "1"]] }))
      : new Response("unavailable", { status: 503 });
  };
  try {
    const response = await POST(new Request("http://example.test/api/prices/live", {
      method: "POST",
      body: JSON.stringify({ provider: "bybit", assets: [{ id: 1, symbol: "USDT", type: "crypto", cryptoCategory: "stablecoin" }] }),
    }));
    const data = await response.json();
    assert.equal(data.found, 1);
    assert.equal(data.results[0].price, .99);
    assert.equal(data.results[0].provider, "coinbase");
    assert.ok(calls.every(url => !url.includes("USDTUSDT") && !url.includes("USDT-USDT")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
