import { lookup } from "node:dns/promises";
import https, { type RequestOptions } from "node:https";
import { isIP } from "node:net";
import tls from "node:tls";
import { ASSET_TYPES, type AssetType } from "@/lib/constants";
import type { CustomApiImportConfig } from "@/lib/custom-import-types";

export const MAX_CUSTOM_IMPORT_ROWS = 200;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const FORBIDDEN_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "connection",
  "content-length",
  "content-type",
  "cookie",
  "host",
  "origin",
  "proxy-authorization",
  "referer",
  "sec-fetch-site",
  "set-cookie",
  "transfer-encoding",
  "user-agent",
]);
const SENSITIVE_QUERY_KEY = /^(?:key|api[_-]?key|access[_-]?(?:key|token)|auth(?:orization)?|client[_-]?secret|credential|password|secret|token)$/i;
const SENSITIVE_BODY_KEY = /^(?:key|api[_-]?key|access[_-]?(?:key|token)|auth(?:orization)?|client[_-]?secret|credential|password|secret|token)$/i;
const STABLECOINS = new Set(["DAI", "FDUSD", "PYUSD", "TUSD", "USDC", "USDD", "USDE", "USD1", "USDT"]);

export class CustomApiImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomApiImportError";
  }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function apiUrl(value: unknown): URL {
  const raw = text(value);
  if (!raw || raw.length > 2048) {
    throw new CustomApiImportError("Enter an API endpoint URL no longer than 2,048 characters.");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CustomApiImportError("Enter a valid HTTPS API URL.");
  }

  if (url.protocol !== "https:") {
    throw new CustomApiImportError("Custom API endpoints must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new CustomApiImportError("Do not put credentials in the URL. Use the API key field instead.");
  }
  if (url.hash) {
    throw new CustomApiImportError("Remove the URL fragment; it is not sent to APIs.");
  }
  if (url.port && url.port !== "443") {
    throw new CustomApiImportError("For safety, custom API endpoints must use the standard HTTPS port (443).");
  }
  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEY.test(key)) {
      throw new CustomApiImportError("Put API keys in the authentication field, not in the URL query string.");
    }
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".test") ||
    hostname.endsWith(".invalid")
  ) {
    throw new CustomApiImportError("Use a public HTTPS API host; local and private network hosts are blocked.");
  }

  const literalFamily = isIP(hostname);
  if (literalFamily === 6) {
    throw new CustomApiImportError("IPv6-only API endpoints are not supported. Use a public HTTPS hostname.");
  }
  if (literalFamily === 4 && !isPublicIpv4(hostname)) {
    throw new CustomApiImportError("Private and reserved network addresses are blocked.");
  }

  return url;
}

/**
 * True only for globally routable IPv4 addresses. The API request connects to
 * the resolved address directly (rather than resolving the hostname again),
 * which prevents a DNS rebinding lookup from reaching a private service.
 */
export function isPublicIpv4(value: string): boolean {
  if (isIP(value) !== 4) return false;
  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => part < 0 || part > 255)) return false;
  const [a, b, c] = octets;

  if (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  ) {
    return false;
  }
  return true;
}

function normalizePath(value: unknown, label: string, required = false): string {
  const path = text(value);
  if (!path && !required) return "";
  if (!path && required) throw new CustomApiImportError(`${label} is required.`);
  if (path.length > 180 || !/^(?:[A-Za-z_$][A-Za-z0-9_$-]*|\d+)(?:\.(?:[A-Za-z_$][A-Za-z0-9_$-]*|\d+))*$/.test(path)) {
    throw new CustomApiImportError(`${label} must be a dot-separated JSON path, such as data.tokens.`);
  }
  if (path.split(".").some((part) => ["__proto__", "constructor", "prototype"].includes(part))) {
    throw new CustomApiImportError(`${label} cannot reference a prototype property.`);
  }
  return path;
}

function containsCredentialField(value: unknown): boolean {
  const pending: unknown[] = [value];
  let inspected = 0;
  while (pending.length > 0 && inspected < 1000) {
    const current = pending.pop();
    inspected += 1;
    if (Array.isArray(current)) {
      pending.push(...current);
    } else if (isRecord(current)) {
      for (const [key, child] of Object.entries(current)) {
        if (SENSITIVE_BODY_KEY.test(key)) return true;
        pending.push(child);
      }
    }
  }
  return false;
}

/** Validates and normalizes a server-action payload or decrypted config. */
export function normalizeCustomApiConfig(value: unknown): CustomApiImportConfig {
  if (!isRecord(value)) throw new CustomApiImportError("The custom API configuration is invalid.");

  const sourceName = text(value.sourceName) || "Custom API";
  if (sourceName.length > 60 || /[\u0000-\u001f\u007f]/.test(sourceName)) {
    throw new CustomApiImportError("The connection name must be 1–60 characters without control characters.");
  }

  const endpoint = text(value.endpoint);
  // Syntax and protocol are checked here. DNS is checked only when making a request.
  apiUrl(endpoint);

  const methodValue = text(value.method).toUpperCase();
  if (methodValue !== "GET" && methodValue !== "POST") {
    throw new CustomApiImportError("Choose GET or POST as the API method.");
  }
  const method = methodValue as CustomApiImportConfig["method"];

  const authValue = text(value.authMode).toLowerCase() || "none";
  if (authValue !== "none" && authValue !== "bearer" && authValue !== "header") {
    throw new CustomApiImportError("Choose no authentication, Bearer token, or API-key header.");
  }
  const authMode = authValue as CustomApiImportConfig["authMode"];
  let authHeader = "";
  if (authMode === "bearer") {
    authHeader = "Authorization";
  } else if (authMode === "header") {
    authHeader = text(value.authHeader) || "X-API-Key";
    if (!/^[A-Za-z0-9-]{1,64}$/.test(authHeader) || FORBIDDEN_HEADERS.has(authHeader.toLowerCase())) {
      throw new CustomApiImportError("Enter a valid custom API-key header name.");
    }
  }

  const token = authMode === "none" ? "" : text(value.token);
  if (token.length > 2048 || /[\u0000-\u001f\u007f]/.test(token)) {
    throw new CustomApiImportError("The API key must be 2,048 characters or fewer and contain no control characters.");
  }

  const requestBody = text(value.requestBody);
  if (Buffer.byteLength(requestBody, "utf8") > MAX_REQUEST_BODY_BYTES) {
    throw new CustomApiImportError("The JSON request body must be 16 KB or smaller.");
  }
  if (method === "GET" && requestBody) {
    throw new CustomApiImportError("GET requests cannot include a JSON body. Choose POST or clear the body.");
  }
  if (method === "POST" && requestBody) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(requestBody);
    } catch {
      throw new CustomApiImportError("The POST body must be valid JSON (an object or array).");
    }
    if (parsed === null || typeof parsed !== "object") {
      throw new CustomApiImportError("The POST body must be a JSON object or array.");
    }
    if (containsCredentialField(parsed)) {
      throw new CustomApiImportError("Keep API credentials out of the request body; use the authentication field instead.");
    }
  }

  const assetTypeValue = text(value.assetType) || "crypto";
  if (!(ASSET_TYPES as readonly string[]).includes(assetTypeValue)) {
    throw new CustomApiImportError("Choose Crypto, Stock, Cash, or Other for the imported asset type.");
  }

  return {
    sourceName,
    endpoint,
    method,
    authMode,
    authHeader,
    token,
    requestBody,
    dataPath: normalizePath(value.dataPath, "Response array path"),
    symbolPath: normalizePath(value.symbolPath, "Symbol field", true),
    namePath: normalizePath(value.namePath, "Name field"),
    quantityPath: normalizePath(value.quantityPath, "Quantity field", true),
    pricePath: normalizePath(value.pricePath, "USD price field"),
    valuePath: normalizePath(value.valuePath, "USD value field"),
    assetType: assetTypeValue as AssetType,
  };
}

function resolvePublicAddress(hostname: string): Promise<string> {
  if (isIP(hostname) === 4) return Promise.resolve(hostname);

  return lookup(hostname, { all: true, verbatim: true })
    .then((records) => {
      const ipv4Records = records.filter((record) => record.family === 4);
      if (ipv4Records.length === 0 || ipv4Records.some((record) => !isPublicIpv4(record.address))) {
        throw new CustomApiImportError("This API host does not resolve exclusively to public IPv4 addresses.");
      }
      return ipv4Records[0].address;
    })
    .catch((error: unknown) => {
      if (error instanceof CustomApiImportError) throw error;
      throw new CustomApiImportError("Could not resolve the API host. Use a public HTTPS endpoint.");
    });
}

function requestJson(config: CustomApiImportConfig, url: URL, address: string): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "identity",
    Host: url.host,
    "User-Agent": "Portfolio/1.0",
  };
  if (config.authMode === "bearer") {
    headers.Authorization = `Bearer ${config.token}`;
  } else if (config.authMode === "header") {
    headers[config.authHeader] = config.token;
  }
  if (config.method === "POST") headers["Content-Type"] = "application/json";

  const tlsHostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const options: RequestOptions = {
    protocol: "https:",
    hostname: address,
    port: 443,
    path: `${url.pathname}${url.search}`,
    method: config.method,
    headers,
    // Connect to the already-vetted address but still verify the certificate
    // against the hostname the user configured.
    ...(isIP(tlsHostname) === 0 ? { servername: tlsHostname } : {}),
    checkServerIdentity: (_hostname, certificate) => tls.checkServerIdentity(tlsHostname, certificate),
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    let failureMessage = "Could not reach the API endpoint. Check the URL and try again.";
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const request = https.request(options, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        response.resume();
        fail(new CustomApiImportError("The API redirected the request. Use its final HTTPS endpoint URL."));
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        fail(new CustomApiImportError(`The API responded with HTTP ${status || "error"}. Check the endpoint and API key.`));
        return;
      }

      const contentLength = Number(response.headers["content-length"] ?? 0);
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
        failureMessage = "The API response is larger than 2 MB. Narrow the endpoint to fewer holdings.";
        fail(new CustomApiImportError(failureMessage));
        response.destroy();
        request.destroy();
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_RESPONSE_BYTES) {
          failureMessage = "The API response is larger than 2 MB. Narrow the endpoint to fewer holdings.";
          fail(new CustomApiImportError(failureMessage));
          response.destroy();
          request.destroy();
          return;
        }
        chunks.push(buffer);
      });
      response.on("error", () => fail(new CustomApiImportError(failureMessage)));
      response.on("end", () => {
        if (settled) return;
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          const payload: unknown = JSON.parse(raw);
          settled = true;
          resolve(payload);
        } catch {
          fail(new CustomApiImportError("The endpoint did not return valid JSON."));
        }
      });
    });

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      failureMessage = "The API request timed out after 12 seconds.";
      request.destroy();
    });
    request.on("error", () => fail(new CustomApiImportError(failureMessage)));
    if (config.method === "POST" && config.requestBody) request.write(config.requestBody);
    request.end();
  });
}

/** Fetches one bounded JSON response from a public HTTPS endpoint. */
export async function fetchCustomApiJson(config: CustomApiImportConfig): Promise<unknown> {
  const url = apiUrl(config.endpoint);
  const address = await resolvePublicAddress(url.hostname.replace(/^\[|\]$/g, ""));
  return requestJson(config, url, address);
}

function atPath(value: unknown, path: string): unknown {
  if (!path) return value;
  let current: unknown = value;
  for (const part of path.split(".")) {
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)];
    } else if (isRecord(current) && Object.hasOwn(current, part)) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function safeSymbol(value: unknown): string {
  const symbol = text(value).toUpperCase();
  return /^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(symbol) ? symbol : "";
}

function safeName(value: unknown, fallback: string): string {
  const name = text(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return (name || fallback).slice(0, 100);
}

function numericValue(value: unknown, { required = false }: { required?: boolean } = {}): number | null {
  if (value === null || value === undefined || value === "") return required ? null : 0;
  const parsed = typeof value === "number" ? value : Number(text(value));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export type ParsedCustomHolding = {
  type: AssetType;
  symbol: string;
  name: string;
  quantity: number;
  price: number;
  value: number;
};

export type ParsedCustomHoldings = {
  dataCount: number;
  skippedCount: number;
  rows: ParsedCustomHolding[];
};

/** Maps an arbitrary JSON response to normalized, safe portfolio holding rows. */
export function parseCustomApiHoldings(
  payload: unknown,
  config: CustomApiImportConfig,
): ParsedCustomHoldings {
  const source = atPath(payload, config.dataPath);
  if (!Array.isArray(source)) {
    const label = config.dataPath ? `"${config.dataPath}"` : "the response root";
    throw new CustomApiImportError(`Response array path ${label} did not resolve to a JSON array.`);
  }
  if (source.length > MAX_CUSTOM_IMPORT_ROWS) {
    throw new CustomApiImportError(`The endpoint returned ${source.length} rows. Narrow it to ${MAX_CUSTOM_IMPORT_ROWS} or fewer before importing.`);
  }

  type Aggregate = ParsedCustomHolding & { pricedQuantity: number; pricedValue: number };
  const grouped = new Map<string, Aggregate>();
  let skippedCount = 0;

  for (const item of source) {
    if (!isRecord(item)) {
      skippedCount += 1;
      continue;
    }
    const symbol = safeSymbol(atPath(item, config.symbolPath));
    const quantity = numericValue(atPath(item, config.quantityPath), { required: true });
    const mappedPrice = config.pricePath ? numericValue(atPath(item, config.pricePath)) : 0;
    const mappedValue = config.valuePath ? numericValue(atPath(item, config.valuePath)) : 0;
    if (
      !symbol ||
      quantity === null ||
      quantity <= 0 ||
      mappedPrice === null ||
      (mappedValue === null && mappedPrice <= 0)
    ) {
      skippedCount += 1;
      continue;
    }

    const totalValue = mappedValue ?? 0;
    const price =
      config.assetType === "cash"
        ? 1
        : mappedPrice > 0
          ? mappedPrice
          : totalValue > 0
            ? totalValue / quantity
            : 0;
    if (!Number.isFinite(price) || !Number.isFinite(quantity * price)) {
      skippedCount += 1;
      continue;
    }
    const name = safeName(config.namePath ? atPath(item, config.namePath) : undefined, symbol);
    const key = `${config.assetType}:${symbol}`;
    const previous = grouped.get(key);
    if (previous) {
      const nextQuantity = previous.quantity + quantity;
      const nextPricedQuantity = previous.pricedQuantity + (price > 0 ? quantity : 0);
      const nextPricedValue = previous.pricedValue + (price > 0 ? quantity * price : 0);
      const nextPrice = nextPricedQuantity > 0 ? nextPricedValue / nextPricedQuantity : 0;
      if (!Number.isFinite(nextQuantity) || !Number.isFinite(nextPrice) || !Number.isFinite(nextQuantity * nextPrice)) {
        skippedCount += 1;
        continue;
      }
      previous.quantity = nextQuantity;
      previous.pricedQuantity = nextPricedQuantity;
      previous.pricedValue = nextPricedValue;
      previous.price = nextPrice;
      previous.value = nextQuantity * nextPrice;
      if (previous.name === previous.symbol && name !== symbol) previous.name = name;
    } else {
      grouped.set(key, {
        type: config.assetType,
        symbol,
        name,
        quantity,
        price,
        value: quantity * price,
        pricedQuantity: price > 0 ? quantity : 0,
        pricedValue: price > 0 ? quantity * price : 0,
      });
    }
  }

  const rows = [...grouped.values()]
    .map(({ pricedQuantity: _pricedQuantity, pricedValue: _pricedValue, ...row }) => row)
    .sort((a, b) => b.value - a.value || a.symbol.localeCompare(b.symbol));
  return { dataCount: source.length, skippedCount, rows };
}

/** Shared stablecoin classification for imported crypto assets. */
export function importedCryptoCategory(symbol: string): "stablecoin" | "volatile" {
  return STABLECOINS.has(symbol.trim().toUpperCase()) ? "stablecoin" : "volatile";
}

/** A short host label for the browser preview; query strings are never returned. */
export function customApiHostLabel(endpoint: string): string {
  return apiUrl(endpoint).host;
}
