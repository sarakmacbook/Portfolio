/**
 * The chains a wallet address can be scanned on, and the address formats the
 * scanner understands.
 *
 * Kept apart from `wallet-scanner` (which does the network work) so the rest of
 * the app can share the same vocabulary without importing the scanner back.
 */

export const WALLET_CHAINS = [
  "auto",
  "ethereum",
  "bsc",
  "arbitrum",
  "base",
  "polygon",
  "optimism",
  "avalanche",
  "zksync",
  "linea",
  "scroll",
  "mantle",
  "blast",
  "fantom",
  "gnosis",
  "cronos",
  "solana",
  "bitcoin",
  "tron",
] as const;

export type WalletChain = (typeof WALLET_CHAINS)[number];

export const WALLET_CHAIN_LABELS: Record<WalletChain, string> = {
  auto: "All chains",
  ethereum: "Ethereum",
  bsc: "BNB Chain",
  arbitrum: "Arbitrum",
  base: "Base",
  polygon: "Polygon",
  optimism: "Optimism",
  avalanche: "Avalanche",
  zksync: "zkSync",
  linea: "Linea",
  scroll: "Scroll",
  mantle: "Mantle",
  blast: "Blast",
  fantom: "Fantom",
  gnosis: "Gnosis",
  cronos: "Cronos",
  solana: "Solana",
  bitcoin: "Bitcoin",
  tron: "Tron",
};

export type WalletAddressKind = "evm" | "solana" | "bitcoin" | "tron";

export function detectWalletAddressKind(rawAddress: string): WalletAddressKind | null {
  const addr = rawAddress.trim();
  if (!addr) return null;
  if (/^0x[a-fA-F0-9]{40}$/.test(addr)) return "evm";
  if (/^(bc1[a-zA-HJ-NP-Z0-9]{25,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(addr)) {
    return "bitcoin";
  }
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) {
    return "tron";
  }
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) {
    return "solana";
  }
  return null;
}

export function isValidWalletChain(value: unknown): value is WalletChain {
  return typeof value === "string" && (WALLET_CHAINS as readonly string[]).includes(value);
}

/**
 * Turns whatever the client sent into a chain filter.
 *
 * The list above is only what this app can read *by itself*; the explorers
 * cover more, so any well-formed chain id is accepted here — `sonic`, `zora`, or
 * a chain that did not exist when this shipped. Anything unusable becomes `auto`
 * (every chain), which is always safe.
 */
export function normaliseWalletChain(value: unknown): string {
  if (typeof value !== "string") return "auto";
  const key = value.trim().toLowerCase();
  if (!key || key === "auto") return "auto";
  return /^[a-z0-9][a-z0-9-]{0,31}$/.test(key) ? key : "auto";
}

/**
 * A wallet address trimmed to something a human can read — `0x1234…abcd` — and,
 * because a folder name allows 28 characters, the default name for the folder a
 * wallet import is filed into. Short addresses are returned untouched.
 */
export function shortWalletAddress(rawAddress: string): string {
  const address = rawAddress.trim();
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Chain ids that have more than one common spelling. */
const CHAIN_ALIASES: Record<string, string> = {
  ethereum: "eth",
  binance: "bsc",
  "bnb-chain": "bsc",
  arbitrum: "arb",
  polygon: "matic",
  optimism: "op",
  avalanche: "avax",
  zksync: "era",
  scroll: "scrl",
  mantle: "mnt",
  fantom: "ftm",
  gnosis: "xdai",
  cronos: "cro",
  "polygon-zkevm": "pze",
  "arbitrum-nova": "nova",
  kaia: "klay",
  "zk-sync": "era",
  // A stray non-EVM id stays recognisable as such.
  sol: "solana",
  btc: "bitcoin",
  xbt: "bitcoin",
  trx: "tron",
};

/**
 * The canonical id for a chain value, whichever spelling it came from:
 * `ethereum`, `Ethereum` and `eth` all become `eth`. Unknown ids are lowercased
 * and returned as-is, so chains this app has never heard of still compare
 * correctly.
 */
export function canonicalChainId(value: string): string {
  const key = value.trim().toLowerCase();
  if (!key) return "";
  return CHAIN_ALIASES[key] ?? key;
}
