import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { GET as walletScanGET } from "../src/app/api/wallet/scan/route";
import {
  detectWalletAddressKind,
  encodeBalanceOfCall,
  formatUnitsFromHex,
  scanWalletAddress,
  shortWalletAddress,
  normaliseWalletChain,
} from "../src/lib/wallet-scanner";

test("detectWalletAddressKind identifies EVM, Solana, Bitcoin, and Tron addresses", () => {
  assert.equal(
    detectWalletAddressKind("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"),
    "evm",
  );
  assert.equal(
    detectWalletAddressKind("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"),
    "bitcoin",
  );
  assert.equal(
    detectWalletAddressKind("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"),
    "bitcoin",
  );
  assert.equal(
    detectWalletAddressKind("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"),
    "tron",
  );
  assert.equal(
    detectWalletAddressKind("7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV"),
    "solana",
  );
  assert.equal(detectWalletAddressKind(""), null);
  assert.equal(detectWalletAddressKind("not-an-address"), null);
});

test("formatUnitsFromHex and encodeBalanceOfCall handle ERC-20 balance payloads", () => {
  // 2.5 ETH = 2.5 * 10^18 = 2500000000000000000 = 0x22b1c8c1227a0000
  assert.equal(formatUnitsFromHex("0x22b1c8c1227a0000", 18), 2.5);
  // 1250.5 USDT (6 decimals) = 1250500000 = 0x4a891da0
  assert.equal(formatUnitsFromHex("0x4a891da0", 6), 1250.5);
  assert.equal(formatUnitsFromHex("0x0", 18), 0);

  assert.equal(
    encodeBalanceOfCall("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"),
    "0x70a08231000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045",
  );
});

test("scanWalletAddress and /api/wallet/scan scan EVM, Solana, and Bitcoin wallets", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("ethereum-rpc.publicnode.com")) {
        const body = JSON.parse(String(init?.body ?? "[]")) as Array<{ id: number }>;
        return new Response(
          JSON.stringify(
            body.map((req) => ({
              jsonrpc: "2.0",
              id: req.id,
              // id 0 = native ETH (1.5 ETH = 0x14d1120d7b160000), id 1 = USDT (500 USDT = 0x1dcd6500)
              result:
                req.id === 0
                  ? "0x14d1120d7b160000"
                  : req.id === 1
                    ? "0x1dcd6500"
                    : "0x0",
            })),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("solana-rpc.publicnode.com")) {
        return new Response(
          JSON.stringify([
            { jsonrpc: "2.0", id: 1, result: { value: 4_000_000_000 } }, // 4 SOL
            {
              jsonrpc: "2.0",
              id: 2,
              result: {
                value: [
                  {
                    account: {
                      data: {
                        parsed: {
                          info: {
                            mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                            tokenAmount: { uiAmount: 250 },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("mempool.space/api/address/")) {
        return new Response(
          JSON.stringify({
            chain_stats: { funded_txo_sum: 150_000_000, spent_txo_sum: 25_000_000 },
            mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("Offline", { status: 502 });
    }) as typeof fetch;

    const evmAddr = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const evmScan = await scanWalletAddress(evmAddr, "ethereum");
    assert.equal(evmScan.addressKind, "evm");
    assert.equal(evmScan.balances.length, 2);
    assert.equal(evmScan.balances[0].symbol, "ETH");
    assert.equal(evmScan.balances[0].quantity, 1.5);
    assert.equal(evmScan.balances[1].symbol, "USDT");
    assert.equal(evmScan.balances[1].quantity, 500);

    const routeRes = await walletScanGET(
      new Request(`http://app.test/api/wallet/scan?address=${evmAddr}&chain=ethereum`),
    );
    assert.equal(routeRes.status, 200);
    const routeJson = (await routeRes.json()) as {
      ok: boolean;
      balances: Array<{ symbol: string; quantity: number }>;
    };
    assert.equal(routeJson.ok, true);
    assert.equal(routeJson.balances.length, 2);

    const solScan = await scanWalletAddress(
      "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV",
      "solana",
    );
    assert.equal(solScan.addressKind, "solana");
    assert.equal(solScan.balances.length, 2);
    assert.ok(solScan.balances.some((b) => b.symbol === "SOL" && b.quantity === 4));
    assert.ok(solScan.balances.some((b) => b.symbol === "USDC" && b.quantity === 250));

    const btcScan = await scanWalletAddress(
      "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
      "bitcoin",
    );
    assert.equal(btcScan.addressKind, "bitcoin");
    assert.equal(btcScan.balances.length, 1);
    assert.equal(btcScan.balances[0].symbol, "BTC");
    assert.equal(btcScan.balances[0].quantity, 1.25);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AddAssetDialog exposes Add via wallet address under Crypto", () => {
  const dialogSource = readFileSync(
    resolve(__dirname, "../src/components/AddAssetDialog.tsx"),
    "utf8",
  );
  assert.ok(dialogSource.includes("Add via wallet address"));
  assert.ok(dialogSource.includes("/api/wallet/scan"));
  assert.ok(dialogSource.includes("Scan wallet"));
});

test("shortWalletAddress trims an address for a folder name", () => {
  assert.equal(shortWalletAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"), "0xd8dA…6045");
  // Short values are left alone, blank stays blank.
  assert.equal(shortWalletAddress("0x1234"), "0x1234");
  assert.equal(shortWalletAddress("   "), "");
  // Always inside the 28-character folder-name limit.
  assert.ok(shortWalletAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045").length <= 28);
});

test("a wallet import is filed into a folder named after the wallet", () => {
  const actions = readFileSync(resolve(__dirname, "../src/app/actions.ts"), "utf8");
  const importBody = actions.slice(actions.indexOf("export async function importWalletBalances"));
  assert.ok(importBody.includes("folderForImport("), "the import reuses or creates a folder");
  assert.ok(importBody.includes("saveHoldingFolderAssignments("), "imported holdings are filed");
  assert.ok(importBody.includes("shortWalletAddress(address)"), "the folder is named after the address");
  assert.ok(importBody.includes("folderName !== null"), "a caller can still import without a folder");

  const dialog = readFileSync(resolve(__dirname, "../src/components/AddAssetDialog.tsx"), "utf8");
  assert.ok(dialog.includes("Import as one folder"), "the dialog offers the folder");
  assert.ok(dialog.includes("walletFolderName"), "the folder can be named");
  assert.ok(dialog.includes("folderName: walletFileIntoFolder"), "the choice reaches the action");
  assert.ok(dialog.includes("folderId: walletFileIntoFolder"), "a picked folder is sent by id");
  assert.ok(importBody.includes("pickedId"), "the action resolves the picked folder");
  assert.ok(
    !dialog.includes("DeBank was unavailable"),
    "the 404 notice is worded as a chain read, not a DeBank error",
  );
});

test("the chain filter accepts any well-formed chain id, not just the built-in list", async () => {
  assert.equal(normaliseWalletChain("sonic"), "sonic");
  assert.equal(normaliseWalletChain(" Sonic "), "sonic");
  assert.equal(normaliseWalletChain("auto"), "auto");
  assert.equal(normaliseWalletChain(""), "auto");
  assert.equal(normaliseWalletChain(null), "auto");
  // Anything that is not a sane chain id is ignored rather than passed on.
  assert.equal(normaliseWalletChain("../../etc/passwd"), "auto");
  assert.equal(normaliseWalletChain("x".repeat(40)), "auto");

  // The route accepts a chain that is not in WALLET_CHAINS.
  const scan = await walletScanGET(
    new Request("http://localhost/api/wallet/scan?address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045&chain=sonic"),
  );
  const body = (await scan.json()) as { chain?: string };
  assert.equal(body.chain, "sonic");
});

test("a scan always covers every chain — there is no chain filter to set", () => {
  const dialog = readFileSync(resolve(__dirname, "../src/components/AddAssetDialog.tsx"), "utf8");
  assert.equal(dialog.includes("walletChainOptions"), false, "no chain dropdown");
  assert.equal(dialog.includes("Wallet blockchain"), false, "and no chain select either");
  assert.ok(dialog.includes('chain: "auto"'), "every scan asks for all chains");
  assert.ok(dialog.includes("walletScanChainCount"), "the result says how many chains were hit");
});

test("a scan reads the address directly and never asks a token index", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    // A provider that would love to answer. The scan must never call it.
    if (url.includes("debank.com") || url.includes("rabby.io") || url.includes("etherscan.io") || url.includes("moralis.io")) {
      return new Response(JSON.stringify({ error_code: 1, error_message: "should not be asked" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("rpc")) {
      const body = JSON.parse(String(init?.body ?? "[]")) as Array<{ id: number }>;
      return new Response(
        JSON.stringify(
          body.map((req) => ({ jsonrpc: "2.0", id: req.id, result: req.id === 0 ? "0x14d1120d7b160000" : "0x0" })),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("Offline", { status: 502 });
  }) as typeof fetch;

  try {
    const scan = await scanWalletAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "auto");
    assert.equal(scan.source, "onchain");
    assert.equal(scan.sourceNote, undefined, "a direct read has no provider refusal to explain");
    assert.equal(scan.balances[0]?.symbol, "ETH", "the chain answered");
    assert.ok(
      calls.every((url) => !/debank\.com|rabby\.io|etherscan\.io|moralis\.io/.test(url)),
      "no token index was contacted",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the wallet dialog has no provider menu and no provider copy", () => {
  const dialog = readFileSync(resolve(__dirname, "../src/components/AddAssetDialog.tsx"), "utf8");
  assert.ok(dialog.includes("Add via wallet address"), "the address scan is still there");
  assert.ok(dialog.includes("Scan wallet"), "and its button");
  assert.ok(dialog.includes("Read directly from the chains"), "the result says where it came from");
  for (const gone of ["Scan via DeBank", "Scan via Blockscan", "Scan via Moralis", "DEBANK_ACCESS_KEY", "ETHERSCAN_API_KEY", "MORALIS_API_KEY", "Scanner API keys"]) {
    assert.equal(dialog.includes(gone), false, `${gone} is gone from the dialog`);
  }
  assert.equal(dialog.includes('aria-label="Where to scan for the tokens"'), false, "the source dropdown is gone");
});

test("the direct read discovers tokens it has no hard-coded entry for", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("blockscout.com")) {
      // A wallet holding one known ticker plus a token this app never listed.
      return new Response(
        JSON.stringify({
          status: "1",
          result: [
            {
              contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
              tokenName: "Tether USD",
              symbol: "USDT",
              decimals: "6",
              balance: "500000000",
              type: "ERC-20",
            },
            {
              contractAddress: "0x1111111111111111111111111111111111111111",
              tokenName: "Long Tail Token",
              symbol: "TAIL",
              decimals: "18",
              balance: "4000000000000000000",
              type: "ERC-20",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("rpc")) {
      const body = JSON.parse(String(init?.body ?? "[]")) as Array<{ id: number }>;
      return new Response(
        JSON.stringify(
          body.map((req) => ({
            jsonrpc: "2.0",
            id: req.id,
            result: req.id === 0 ? "0x14d1120d7b160000" : req.id === 1 ? "0x1dcd6500" : "0x0",
          })),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("Offline", { status: 502 });
  }) as typeof fetch;

  try {
    const scan = await scanWalletAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "ethereum");
    assert.equal(scan.source, "onchain");

    const symbols = scan.balances.map((balance) => balance.symbol).sort();
    assert.deepEqual(symbols, ["ETH", "TAIL", "USDT"], "the unknown token is found too");
    // The known ticker is not duplicated by the Blockscout result.
    assert.equal(scan.balances.filter((balance) => balance.symbol === "USDT").length, 1);
    const tail = scan.balances.find((balance) => balance.symbol === "TAIL");
    assert.equal(tail?.quantity, 4);
    assert.equal(tail?.chain, "ethereum");
    assert.equal(tail?.contract, "0x1111111111111111111111111111111111111111");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a scan reads the address directly and ignores a token index that would answer", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    // DeBank would answer with a tidy priced list — the scan must not ask.
    if (url.includes("debank.com") || url.includes("rabby.io")) {
      return new Response(
        JSON.stringify([
          {
            id: "base",
            chain: "base",
            name: "Ether",
            symbol: "ETH",
            decimals: 18,
            amount: 1,
            price: 2650,
            usd_value: 2650,
            is_core: true,
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    // The wallet really holds ETH on Base (RPC) and ZRO (Blockscout).
    if (url.includes("blockscout.com")) {
      return new Response(
        JSON.stringify({
          status: "1",
          result: [
            {
              contractAddress: "0x6985884C4392D348587B19cb9eAAf157F13271cd",
              tokenName: "LayerZero",
              symbol: "ZRO",
              decimals: "18",
              balance: "2500000000000000000",
              type: "ERC-20",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("routescan.io")) {
      return new Response(JSON.stringify({ status: "0", result: "[]" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("rpc")) {
      const body = JSON.parse(String(init?.body ?? "[]")) as Array<{ id: number }>;
      return new Response(
        JSON.stringify(
          body.map((req) => ({ jsonrpc: "2.0", id: req.id, result: req.id === 0 ? "0xde0b6b3a7640000" : "0x0" })),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("Offline", { status: 502 });
  }) as typeof fetch;

  try {
    const scan = await scanWalletAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "base");
    assert.equal(scan.source, "onchain");
    assert.deepEqual(
      scan.balances.map((balance) => balance.symbol).sort(),
      ["ETH", "ZRO"],
      "the direct read's answer is the answer",
    );
    assert.ok(
      calls.every((url) => !/debank\.com|rabby\.io|etherscan\.io|moralis\.io/.test(url)),
      "the token index was never contacted",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Routescan covers a chain Blockscout has no instance for", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("blockscout.com")) return new Response("nope", { status: 404 });
    if (url.includes("routescan.io")) {
      return new Response(
        JSON.stringify({
          status: "1",
          result: [
            {
              TokenAddress: "0x55d398326f99059fF775485246999027B3197955",
              TokenName: "Tether USD (BSC)",
              TokenSymbol: "USDT",
              TokenQuantity: "125000000000000000000",
              TokenDivisor: "1000000000000000000",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("rpc")) {
      const body = JSON.parse(String(init?.body ?? "[]")) as Array<{ id: number }>;
      return new Response(
        JSON.stringify(body.map((req) => ({ jsonrpc: "2.0", id: req.id, result: "0x0" }))),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("Offline", { status: 502 });
  }) as typeof fetch;

  try {
    const scan = await scanWalletAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "bsc");
    assert.equal(scan.source, "onchain");
    const usdt = scan.balances.find((balance) => balance.symbol === "USDT");
    assert.ok(usdt, "the Routescan-only token is found");
    assert.equal(usdt?.quantity, 125);
    assert.equal(usdt?.chain, "bsc");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chains the dropdown offers are scanned even when the RPC list does not cover them", async () => {
  const originalFetch = globalThis.fetch;
  const seenHosts: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seenHosts.push(url);
    if (url.includes("blockscout.com") || url.includes("routescan.io")) {
      return new Response(
        JSON.stringify({
          status: "1",
          result: [
            {
              contractAddress: "0x1111111111111111111111111111111111111111",
              tokenName: "Linea Token",
              symbol: "LNA",
              decimals: "18",
              balance: "5000000000000000000",
              type: "ERC-20",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("Offline", { status: 502 });
  }) as typeof fetch;

  try {
    // zkSync has no RPC spec in the direct read, only an explorer.
    const scan = await scanWalletAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "zksync");
    const found = scan.balances.find((balance) => balance.symbol === "LNA");
    assert.ok(found, "an explorer-only chain still reports its tokens");
    assert.equal(found?.chain, "zksync");
    assert.equal(found?.chainLabel, "zkSync");
    assert.equal(found?.quantity, 5);
    // Only that chain was asked about, because the filter says so.
    assert.ok(seenHosts.every((url) => !url.includes("arbitrum")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a scan reports that it read the chains directly", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("debank.com")) {
      return new Response(JSON.stringify({ error_code: 1, error_message: "rate limited" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("blockscout.com")) {
      return new Response(
        JSON.stringify({
          status: "1",
          result: [
            {
              contractAddress: "0x1111111111111111111111111111111111111111",
              tokenName: "Honest Token",
              symbol: "HON",
              decimals: "18",
              balance: "1000000000000000000",
              type: "ERC-20",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("routescan.io")) {
      return new Response(JSON.stringify({ status: "0", result: "[]" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("Offline", { status: 502 });
  }) as typeof fetch;

  try {
    const scan = await scanWalletAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "base");
    assert.equal(scan.source, "onchain");
    assert.equal(scan.sourceNote, undefined, "there is no provider refusal to explain");
    assert.ok(scan.balances.some((balance) => balance.symbol === "HON"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a non-EVM address goes straight to its own reader", async () => {
  const scanner = readFileSync(resolve(__dirname, "../src/lib/wallet-scanner.ts"), "utf8");
  assert.ok(
    scanner.includes('addressKind === "solana"') &&
      scanner.includes('addressKind === "bitcoin"') &&
      scanner.includes("scanTronWallet(address)"),
    "Solana / Bitcoin / Tron go straight to their own readers",
  );
});
