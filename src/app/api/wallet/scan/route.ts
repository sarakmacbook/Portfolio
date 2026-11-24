import { NextResponse } from "next/server";
import { normaliseWalletChain, scanWalletAddress } from "@/lib/wallet-scanner";
import { getScannerKeys } from "@/lib/scanner-keys";
import { enrichTokenTrust } from "@/lib/wallet-trust";

export const dynamic = "force-dynamic";

/**
 * GET /api/wallet/scan?address=0x...&chain=auto
 *
 * Returns the tokens a wallet holds, read **directly from the public RPCs and
 * explorers** — no third-party token index sits in front of the scan, so there
 * is no provider to choose and no key required. `chain` may be `auto` (every
 * chain) or any well-formed chain id; the filter is alias-aware, so `ethereum`
 * and `eth` are the same. The response carries `source: "onchain"`, so the
 * dialog can say where the numbers came from. Each balance is then matched
 * against the official contract table and looked up for organic trading volume
 * (`wallet-trust`) — best-effort, so a slow or rate-limited lookup leaves the
 * token "unknown" rather than hidden.
 *
 * The only optional key is `CMC_PRO_API_KEY` (or a CoinMarketCap key saved in
 * the app), used by the post-scan trust pass. Read-only — no wallet keys or
 * signatures.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const address = (params.get("address") ?? "").trim();
  const chain = normaliseWalletChain(params.get("chain"));

  if (!address) {
    return NextResponse.json(
      { error: "Paste a wallet address first." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    /**
     * The only key a scan can use is CoinMarketCap's, for the post-scan
     * contract lookup. A missing key is not an error — the contracts simply
     * stay unverified.
     */
    const keys = await getScannerKeys();
    const result = await scanWalletAddress(address, chain);
    // Contract match (local table + CoinMarketCap) and market depth, so the
    // picker can rank real tokens above look-alikes and tokens nobody trades.
    // Never throws, never drops a balance.
    /** Whether CoinMarketCap actually answered is reported back with the scan.
     * "Not listed" and "never asked" look identical on a balance, and the
     * picker's *only listed on CoinMarketCap* filter must switch itself off when
     * nothing was asked — a missing key must never empty the list.
     */
    let cmcLookup = { ok: false, asked: 0, listed: 0 };
    const balances = await enrichTokenTrust(result.balances, fetch, {
      cmcApiKey: keys.coinmarketcap,
      onCmcLookup: (report) => {
        cmcLookup = report;
      },
    });
    return NextResponse.json(
      {
        ok: true,
        ...result,
        balances,
        cmcChecked: cmcLookup.ok,
        cmcListed: cmcLookup.listed,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not scan that wallet address.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
