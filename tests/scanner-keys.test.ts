import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  MAX_SCANNER_KEY_LENGTH,
  MIN_SCANNER_KEY_LENGTH,
  SCANNER_KEY_SPECS,
  SCANNER_PROVIDERS,
  ScannerKeyError,
  buildScannerKeyStatuses,
  getScannerKeys,
  isScannerProvider,
  maskScannerKey,
  normaliseScannerKey,
  resolveScannerKey,
  scannerKeyFromEnv,
  scannerKeySpec,
} from "../src/lib/scanner-keys";

const CMC_KEY = "A1B2C3D4E5F60718293A4B5C6D7E8F9012"; // 34 chars

test("the only key the app stores is CoinMarketCap's, for the post-scan check", () => {
  assert.deepEqual(SCANNER_PROVIDERS, ["coinmarketcap"]);
  assert.equal(SCANNER_KEY_SPECS.length, 1);

  const spec = scannerKeySpec("coinmarketcap");
  assert.deepEqual(spec.envVars, ["CMC_PRO_API_KEY", "COINMARKETCAP_API_KEY"]);
  assert.equal(spec.setting, "scanner.key.coinmarketcap");
  assert.ok(spec.docsUrl.startsWith("https://"));
  assert.ok(spec.usedFor.length > 20);

  // The scan itself has no provider left: none of these are accepted keys.
  assert.ok(isScannerProvider("coinmarketcap"));
  assert.ok(!isScannerProvider("debank"));
  assert.ok(!isScannerProvider("etherscan"));
  assert.ok(!isScannerProvider("moralis"));
  assert.ok(!isScannerProvider("coingecko"));
  assert.ok(!isScannerProvider(null));
});

test("a key is read from the environment, the first matching variable winning", () => {
  const spec = scannerKeySpec("coinmarketcap");
  assert.equal(scannerKeyFromEnv(spec, { CMC_PRO_API_KEY: ` ${CMC_KEY} ` }), CMC_KEY);
  assert.equal(scannerKeyFromEnv(spec, { COINMARKETCAP_API_KEY: "alias-key" }), "alias-key");
  assert.equal(
    scannerKeyFromEnv(spec, { CMC_PRO_API_KEY: "", COINMARKETCAP_API_KEY: "alias-key" }),
    "alias-key",
  );
  assert.equal(scannerKeyFromEnv(spec, {}), "");
  assert.equal(scannerKeyFromEnv(spec, { CMC_PRO_API_KEY: "   " }), "");
});

test("pasted keys are trimmed and obvious mistakes are rejected", () => {
  assert.equal(normaliseScannerKey(` "${CMC_KEY}" `), CMC_KEY);
  assert.equal(normaliseScannerKey("`" + CMC_KEY + "`"), CMC_KEY);
  assert.equal(normaliseScannerKey("key_with-dots.and_underscores"), "key_with-dots.and_underscores");

  const rejects = [
    "",
    "   ",
    "short",
    `${CMC_KEY} ${CMC_KEY}`,
    "https://pro.coinmarketcap.com",
    "key with a space",
    "key,with,commas",
    "x".repeat(MAX_SCANNER_KEY_LENGTH + 1),
  ];
  for (const value of rejects) {
    assert.throws(() => normaliseScannerKey(value), ScannerKeyError, `expected ${JSON.stringify(value)} to be rejected`);
  }
  // The shortest accepted key is exactly the documented minimum.
  assert.equal(normaliseScannerKey("a".repeat(MIN_SCANNER_KEY_LENGTH)).length, MIN_SCANNER_KEY_LENGTH);
});

test("a masked key never leaks more than its last four characters", () => {
  const masked = maskScannerKey(CMC_KEY);
  assert.ok(masked.endsWith(CMC_KEY.slice(-4)));
  assert.ok(!masked.includes(CMC_KEY.slice(0, 10)));
  assert.equal(maskScannerKey("abc"), "••••");
});

test("a key saved in the app wins over the environment; removing it falls back", () => {
  const spec = scannerKeySpec("coinmarketcap");
  const env = { CMC_PRO_API_KEY: "from-environment-key" };

  const saved = resolveScannerKey(spec, {
    stored: { key: "saved-in-app-key", savedAt: "2026-01-02T03:04:05.000Z" },
    env,
  });
  assert.equal(saved.key, "saved-in-app-key");
  assert.equal(saved.source, "app");
  assert.equal(saved.savedAt, "2026-01-02T03:04:05.000Z");
  assert.equal(saved.hint, maskScannerKey("saved-in-app-key"));

  const fromEnv = resolveScannerKey(spec, { stored: null, env });
  assert.equal(fromEnv.key, "from-environment-key");
  assert.equal(fromEnv.source, "env");
  assert.equal(fromEnv.savedAt, null);

  const none = resolveScannerKey(spec, { stored: null, env: {} });
  assert.deepEqual(none, { key: "", source: "none", hint: "", savedAt: null });
});

test("statuses say where the key came from and what can be removed", () => {
  const statuses = buildScannerKeyStatuses(
    { coinmarketcap: { key: "cmc-saved-key", savedAt: "2026-02-03T00:00:00.000Z" } },
    { env: {}, canSave: true },
  );
  assert.equal(statuses.length, 1);

  const cmc = statuses[0];
  assert.equal(cmc.id, "coinmarketcap");
  assert.equal(cmc.configured, true);
  assert.equal(cmc.source, "app");
  assert.equal(cmc.removable, true);
  assert.equal(cmc.hint, maskScannerKey("cmc-saved-key"));
  assert.equal(cmc.envVar, "CMC_PRO_API_KEY");

  const fromEnv = buildScannerKeyStatuses({}, { env: { CMC_PRO_API_KEY: "cmc-env-key" } });
  assert.equal(fromEnv[0].configured, true);
  assert.equal(fromEnv[0].source, "env");
  assert.equal(fromEnv[0].removable, false);

  // No key at all still reports a usable list, so the panel can offer the input.
  const empty = buildScannerKeyStatuses({}, { env: {} });
  assert.ok(empty.every((status) => !status.configured && !status.removable));
});

test("the scanner gets its key from the environment when nothing is saved", async () => {
  const saved = { ...process.env };
  try {
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    process.env.CMC_PRO_API_KEY = "";
    process.env.COINMARKETCAP_API_KEY = "cmc-alias-key";

    const keys = await getScannerKeys();
    assert.deepEqual(keys, { coinmarketcap: "cmc-alias-key" });
  } finally {
    process.env = saved;
  }
});

const read = (path: string) => readFileSync(resolve(__dirname, "../src", path), "utf8");

test("the scan route, the scanner and the dialog all use the one key", () => {
  const route = read("app/api/wallet/scan/route.ts");
  assert.ok(route.includes("getScannerKeys()"), "the route resolves the key first");
  assert.ok(route.includes("cmcApiKey: keys.coinmarketcap"), "and hands it to the trust pass");

  const scanner = read("lib/wallet-scanner.ts");
  assert.ok(!scanner.includes("debank"), "no DeBank client is left in the scanner");
  assert.ok(!scanner.includes("blockscan"), "no Blockscan client is left in the scanner");
  assert.ok(!scanner.includes("moralis"), "no Moralis client is left in the scanner");

  const dialog = read("components/AddAssetDialog.tsx");
  assert.ok(dialog.includes("<ScannerKeys"), "the scan dialog renders the key panel");

  const panel = read("components/ScannerKeys.tsx");
  assert.ok(panel.includes("saveScannerKeyAction"), "a key can be saved from the panel");
  assert.ok(panel.includes("removeScannerKeyAction"), "and removed again");
  assert.ok(panel.includes('type="password"'), "the input is masked while typing");
  assert.ok(panel.includes("/api/wallet/scan/keys"), "statuses come from the masked endpoint");
});

test("the keys endpoint returns masks, never keys", () => {
  const route = read("app/api/wallet/scan/keys/route.ts");
  assert.ok(route.includes("getScannerKeyStatuses()"));
  assert.ok(!route.includes(".key"), "no raw key field is ever returned");
  // Saving happens through the server actions, not this route.
  assert.ok(!route.includes("export async function POST"));
});
