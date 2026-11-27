import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CustomApiImportError,
  isPublicIpv4,
  normalizeCustomApiConfig,
  parseCustomApiHoldings,
} from "../src/lib/custom-api-import";

function config(overrides: Record<string, unknown> = {}) {
  return normalizeCustomApiConfig({
    sourceName: "Nansen wallet",
    endpoint: "https://api.example.com/v1/portfolio?address=0xabc",
    method: "GET",
    authMode: "header",
    authHeader: "X-API-Key",
    token: "test-api-key-123456",
    requestBody: "",
    dataPath: "data.tokens",
    symbolPath: "token.symbol",
    namePath: "token.name",
    quantityPath: "balance",
    pricePath: "price_usd",
    assetType: "crypto",
    ...overrides,
  });
}

test("maps nested JSON fields and combines duplicate symbols at a weighted price", () => {
  const parsed = parseCustomApiHoldings(
    {
      data: {
        tokens: [
          { token: { symbol: "eth", name: "Ethereum" }, balance: "2", price_usd: "100" },
          { token: { symbol: "ETH", name: "Ethereum" }, balance: "1", price_usd: "130" },
          { token: { symbol: "BAD SYMBOL", name: "Bad" }, balance: "5", price_usd: "1" },
          { token: { symbol: "ZERO", name: "Zero" }, balance: "0", price_usd: "1" },
        ],
      },
    },
    config(),
  );

  assert.equal(parsed.dataCount, 4);
  assert.equal(parsed.skippedCount, 2);
  assert.deepEqual(parsed.rows, [
    {
      type: "crypto",
      symbol: "ETH",
      name: "Ethereum",
      quantity: 3,
      price: 110,
      value: 330,
    },
  ]);
});

test("derives unit price from total USD value when the API does not include a unit price", () => {
  const parsed = parseCustomApiHoldings(
    {
      data: {
        tokens: [
          { token: { symbol: "SOL", name: "Solana" }, balance: "2.5", value_usd: "375" },
        ],
      },
    },
    config({ pricePath: "", valuePath: "value_usd" }),
  );

  assert.deepEqual(parsed.rows, [
    {
      type: "crypto",
      symbol: "SOL",
      name: "Solana",
      quantity: 2.5,
      price: 150,
      value: 375,
    },
  ]);
});

test("supports a root array and cash imports always use a one-dollar unit price", () => {
  const parsed = parseCustomApiHoldings(
    [{ ticker: "USD", amount: "1250.5", usd: "999" }],
    config({
      dataPath: "",
      symbolPath: "ticker",
      namePath: "",
      quantityPath: "amount",
      pricePath: "usd",
      assetType: "cash",
    }),
  );

  assert.deepEqual(parsed.rows, [
    {
      type: "cash",
      symbol: "USD",
      name: "USD",
      quantity: 1250.5,
      price: 1,
      value: 1250.5,
    },
  ]);
});

test("accepts Nansen-style POST configuration and custom API-key headers", () => {
  const parsed = config({
    endpoint: "https://api.example.com/v1/wallet/portfolio",
    method: "POST",
    requestBody: JSON.stringify({ address: "0xabc" }),
    authHeader: "apiKey",
  });
  assert.equal(parsed.method, "POST");
  assert.equal(parsed.authHeader, "apiKey");
  assert.equal(parsed.requestBody, '{"address":"0xabc"}');
});

test("rejects insecure endpoints, URL-embedded secrets, unsafe header names and prototype paths", () => {
  assert.throws(() => config({ endpoint: "http://api.example.com/portfolio" }), CustomApiImportError);
  assert.throws(() => config({ endpoint: "https://api.example.com/portfolio?api_key=secret" }), /not in the URL query/);
  assert.throws(() => config({ endpoint: "https://api.example.com/portfolio?key=secret" }), /not in the URL query/);
  assert.throws(() => config({ endpoint: "https://127.0.0.1/portfolio" }), /Private and reserved/);
  assert.throws(() => config({ authHeader: "Host" }), /valid custom API-key header/);
  assert.throws(() => config({ dataPath: "data.__proto__.tokens" }), /prototype property/);
  assert.throws(() => config({ method: "GET", requestBody: "{}" }), /GET requests cannot include/);
  assert.throws(
    () => config({ method: "POST", requestBody: JSON.stringify({ token: "secret" }) }),
    /Keep API credentials out of the request body/,
  );
});

test("rejects a non-array response path and oversized source arrays", () => {
  assert.throws(
    () => parseCustomApiHoldings({ data: { tokens: {} } }, config()),
    /did not resolve to a JSON array/,
  );
  assert.throws(
    () => parseCustomApiHoldings({ data: { tokens: Array.from({ length: 201 }, () => ({})) } }, config()),
    /Narrow it to 200 or fewer/,
  );
});

test("only globally routable IPv4 addresses are accepted", () => {
  assert.equal(isPublicIpv4("8.8.8.8"), true);
  assert.equal(isPublicIpv4("1.1.1.1"), true);
  assert.equal(isPublicIpv4("10.0.0.1"), false);
  assert.equal(isPublicIpv4("172.31.255.255"), false);
  assert.equal(isPublicIpv4("172.32.0.1"), true);
  assert.equal(isPublicIpv4("100.64.0.1"), false);
  assert.equal(isPublicIpv4("169.254.169.254"), false);
  assert.equal(isPublicIpv4("203.0.113.8"), false);
  assert.equal(isPublicIpv4("224.0.0.1"), false);
  assert.equal(isPublicIpv4("not-an-ip"), false);
});
