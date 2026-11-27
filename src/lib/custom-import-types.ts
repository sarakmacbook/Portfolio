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

/**
 * What the review step asks for before importing: a group name, an optional
 * logo, and which of the ticked holdings should be filed into it. Holdings left
 * out still import — they just stay ungrouped.
 */
export type CustomApiImportGroupRequest = {
  name: string;
  /** `type:SYMBOL` keys to file; `null`/omitted files every imported holding. */
  assetKeys?: string[] | null;
  /** Logo picked in the dialog. A reused group keeps its own instead. */
  icon?: {
    icon: "auto" | "exchange" | "emoji" | "image";
    glyph?: string;
    imageDataUrl?: string;
  };
};

export type CustomApiImportActionResult = {
  ok?: boolean;
  error?: string;
  message?: string;
  imported?: number;
  skipped?: number;
  /** The group the imported holdings were filed into, when the user named one. */
  group?: { id: string; name: string; filed: number };
  /** Set when a group was named but the import had to go ahead without it. */
  groupNote?: string;
};
