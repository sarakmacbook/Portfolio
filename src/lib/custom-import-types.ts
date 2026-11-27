import type { AssetType } from "@/lib/constants";

export type CustomApiAuthMode = "none" | "bearer" | "header";
export type CustomApiMethod = "GET" | "POST";

/**
 * A user-configured public JSON API. The API token is always server-side at
 * rest; this type is passed to a server action only when the user submits it.
 */
export type CustomApiImportConfig = {
  sourceName: string;
  endpoint: string;
  method: CustomApiMethod;
  authMode: CustomApiAuthMode;
  authHeader: string;
  token: string;
  requestBody: string;
  dataPath: string;
  symbolPath: string;
  namePath: string;
  quantityPath: string;
  pricePath: string;
  valuePath: string;
  assetType: AssetType;
};

/** Safe configuration returned to the browser. It never includes the token. */
export type CustomApiImportPublicConfig = Omit<CustomApiImportConfig, "token"> & {
  hasSavedToken: boolean;
  tokenHint: string;
};

/** One normalized holding shown in the import review table. */
export type CustomApiHolding = {
  id: string;
  type: AssetType;
  symbol: string;
  name: string;
  quantity: number;
  price: number;
  value: number;
  alreadyExists: boolean;
};

export type CustomApiPreview = {
  sourceName: string;
  endpointHost: string;
  fetchedAt: string;
  dataCount: number;
  skippedCount: number;
  rows: CustomApiHolding[];
};

export type CustomApiPreviewActionResult = {
  ok?: boolean;
  error?: string;
  message?: string;
  config?: CustomApiImportPublicConfig;
  preview?: CustomApiPreview;
};

export type CustomApiImportActionResult = {
  ok?: boolean;
  error?: string;
  message?: string;
  imported?: number;
  skipped?: number;
};
