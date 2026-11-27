"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  forgetCustomApiImportAction,
  importCustomApiHoldingsAction,
  previewCustomApiImportAction,
} from "@/app/import-actions";
import type { AssetType } from "@/lib/constants";
import { money, qty } from "@/lib/format";
import type {
  CustomApiHolding,
  CustomApiImportConfig,
  CustomApiImportGroupRequest,
  CustomApiImportPublicConfig,
  CustomApiPreview,
} from "@/lib/custom-import-types";
import ImportGroupPrompt from "./ImportGroupPrompt";

type Props = {
  initialConfig: CustomApiImportPublicConfig | null;
  loadError: string;
  /** Root group names already in the portfolio, offered when naming a new group. */
  existingGroups?: readonly string[];
};

function blankConfig(): CustomApiImportConfig {
  return {
    sourceName: "Nansen",
    endpoint: "",
    method: "GET",
    authMode: "header",
    authHeader: "X-API-Key",
    token: "",
    requestBody: "",
    dataPath: "",
    symbolPath: "symbol",
    namePath: "name",
    quantityPath: "quantity",
    pricePath: "price_usd",
    valuePath: "value_usd",
    assetType: "crypto",
  };
}

function formConfigFromPublic(config: CustomApiImportPublicConfig): CustomApiImportConfig {
  return {
    sourceName: config.sourceName,
    endpoint: config.endpoint,
    method: config.method,
    authMode: config.authMode,
    authHeader: config.authHeader,
    token: "",
    requestBody: config.requestBody,
    dataPath: config.dataPath,
    symbolPath: config.symbolPath,
    namePath: config.namePath,
    quantityPath: config.quantityPath,
    pricePath: config.pricePath,
    valuePath: config.valuePath,
    assetType: config.assetType,
  };
}

const TYPE_LABELS: Record<AssetType, string> = {
  cash: "Cash",
  stock: "Stock",
  crypto: "Crypto",
  other: "Other",
};

function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

export default function CustomApiImport({ initialConfig, loadError, existingGroups = [] }: Props) {
  const router = useRouter();
  const [config, setConfig] = useState<CustomApiImportConfig>(() =>
    initialConfig ? formConfigFromPublic(initialConfig) : blankConfig(),
  );
  const [saved, setSaved] = useState(initialConfig);
  const [preview, setPreview] = useState<CustomApiPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  /** The name-the-group step shown before the review's Import button commits. */
  const [groupPrompt, setGroupPrompt] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selectableRows = preview?.rows.filter((row) => !row.alreadyExists) ?? [];
  const selectedRows = preview?.rows.filter((row) => selected.has(row.id)) ?? [];
  const selectedValue = selectedRows.reduce((sum, row) => sum + row.value, 0);

  function updateConfig<K extends keyof CustomApiImportConfig>(
    key: K,
    value: CustomApiImportConfig[K],
  ) {
    setConfig((current) => ({
      ...current,
      [key]: value,
      ...(key === "method" && value === "GET" ? { requestBody: "" } : {}),
      ...(key === "authMode" && value === "none" ? { token: "" } : {}),
    }));
    setPreview(null);
    setSelected(new Set());
    setGroupPrompt(false);
    setError("");
    setMessage("");
  }

  async function fetchPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    setPreview(null);
    setSelected(new Set());
    setGroupPrompt(false);
    try {
      const result = await previewCustomApiImportAction(config);
      if (!result.ok || !result.preview || !result.config) {
        setError(result.error || "Could not fetch this API.");
        return;
      }
      setSaved(result.config);
      setConfig(formConfigFromPublic(result.config));
      setPreview(result.preview);
      setSelected(new Set(result.preview.rows.filter((row) => !row.alreadyExists).map((row) => row.id)));
      setMessage(result.message || "API response loaded.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not fetch this API.");
    } finally {
      setBusy(false);
    }
  }

  function toggleSelected(row: CustomApiHolding) {
    if (row.alreadyExists) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }

  function selectAll(shouldSelect: boolean) {
    setSelected(shouldSelect ? new Set(selectableRows.map((row) => row.id)) : new Set());
  }

  /**
   * Commits the ticked rows. `group` is the group prompt's answer — name, logo
   * and the rows to file; the Skip button passes `null`, which imports plain
   * holdings.
   */
  async function importSelected(group: CustomApiImportGroupRequest | null) {
    if (!preview || selectedRows.length === 0) return;
    setGroupPrompt(false);
    setImporting(true);
    setError("");
    setMessage("");
    try {
      const selectedIds = new Set(selectedRows.map((row) => row.id));
      const result = await importCustomApiHoldingsAction(selectedRows, preview.sourceName, group);
      if (!result.ok) {
        setError(result.error || "Could not import these holdings.");
        return;
      }
      setMessage(result.message || "Import complete.");
      setPreview((current) =>
        current
          ? {
              ...current,
              rows: current.rows.map((row) =>
                selectedIds.has(row.id) ? { ...row, alreadyExists: true } : row,
              ),
            }
          : current,
      );
      setSelected(new Set());
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not import these holdings.");
    } finally {
      setImporting(false);
    }
  }

  async function forgetConnection() {
    if (!window.confirm("Forget the saved API endpoint and key? Imported holdings will stay in your portfolio.")) {
      return;
    }
    setForgetting(true);
    setError("");
    setMessage("");
    try {
      const result = await forgetCustomApiImportAction();
      if (!result.ok) {
        setError(result.error || "Could not forget the API connection.");
        return;
      }
      setSaved(null);
      setConfig(blankConfig());
      setPreview(null);
      setSelected(new Set());
      setGroupPrompt(false);
      setMessage(result.message || "Connection forgotten.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not forget the API connection.");
    } finally {
      setForgetting(false);
    }
  }

  return (
    <div className="space-y-5">
      {loadError && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {loadError} Paste a replacement key below to reconnect.
        </p>
      )}

      {saved && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <div className="min-w-0">
            <p className="font-semibold">Saved connection · {saved.sourceName}</p>
            <p className="mt-0.5 truncate text-xs text-emerald-800">
              {safeHost(saved.endpoint)} · {saved.method}
              {saved.hasSavedToken ? ` · API key ${saved.tokenHint}` : " · no API key saved"}
            </p>
          </div>
          <button type="button" className="btn-ghost shrink-0" onClick={() => void forgetConnection()} disabled={forgetting}>
            {forgetting ? "Forgetting…" : "Forget connection"}
          </button>
        </section>
      )}

      <section className="card p-5 sm:p-6">
        <div className="mb-5">
          <h2 className="text-base font-semibold">Connect an API</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            This connector works with Nansen and other JSON APIs. Use the endpoint and authentication details from the
            provider&apos;s documentation; field names can be mapped below.
          </p>
        </div>

        <form onSubmit={fetchPreview} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="custom-api-name">Connection name</label>
              <input
                id="custom-api-name"
                className="input"
                value={config.sourceName}
                maxLength={60}
                onChange={(event) => updateConfig("sourceName", event.target.value)}
                placeholder="Nansen wallet"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="custom-api-method">Request method</label>
              <select
                id="custom-api-method"
                className="input"
                value={config.method}
                onChange={(event) => updateConfig("method", event.target.value as CustomApiImportConfig["method"])}
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="custom-api-endpoint">HTTPS endpoint</label>
            <input
              id="custom-api-endpoint"
              type="url"
              inputMode="url"
              className="input font-mono text-xs"
              value={config.endpoint}
              onChange={(event) => updateConfig("endpoint", event.target.value)}
              placeholder="https://api.example.com/v1/portfolio"
              required
            />
            <p className="mt-1 text-xs text-slate-400">
              Public HTTPS host only. Put wallet addresses or other non-secret filters in the URL; keep API keys out of the URL and body.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="custom-api-auth">Authentication</label>
              <select
                id="custom-api-auth"
                className="input"
                value={config.authMode}
                onChange={(event) => updateConfig("authMode", event.target.value as CustomApiImportConfig["authMode"])}
              >
                <option value="header">API key in a custom header</option>
                <option value="bearer">Bearer token</option>
                <option value="none">No authentication</option>
              </select>
            </div>
            {config.authMode === "header" ? (
              <div>
                <label className="label" htmlFor="custom-api-header">API-key header name</label>
                <input
                  id="custom-api-header"
                  className="input"
                  value={config.authHeader}
                  maxLength={64}
                  onChange={(event) => updateConfig("authHeader", event.target.value)}
                  placeholder="X-API-Key"
                  required
                />
              </div>
            ) : config.authMode === "bearer" ? (
              <div className="flex items-end text-xs leading-relaxed text-slate-500">
                The key is sent in an Authorization: Bearer header.
              </div>
            ) : (
              <div className="flex items-end text-xs leading-relaxed text-slate-500">
                No credential will be sent to the API.
              </div>
            )}
          </div>

          {config.authMode !== "none" && (
            <div>
              <label className="label" htmlFor="custom-api-token">API key / token</label>
              <input
                id="custom-api-token"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                className="input font-mono"
                value={config.token}
                maxLength={2048}
                onChange={(event) => updateConfig("token", event.target.value)}
                placeholder={saved?.hasSavedToken ? "Saved encrypted — leave blank to reuse on this host" : "Paste a read-only API key"}
              />
              <p className="mt-1 text-xs text-slate-400">
                Keys are encrypted in the portfolio database after a successful preview. A saved key is never sent to a different host.
              </p>
            </div>
          )}

          {config.method === "POST" && (
            <div>
              <label className="label" htmlFor="custom-api-body">JSON request body (optional)</label>
              <textarea
                id="custom-api-body"
                className="input min-h-24 font-mono text-xs"
                value={config.requestBody}
                onChange={(event) => updateConfig("requestBody", event.target.value)}
                placeholder={'{ "address": "0x..." }'}
                maxLength={16_384}
              />
              <p className="mt-1 text-xs text-slate-400">Sent as application/json (maximum 16 KB). Keep credentials in the authentication field.</p>
            </div>
          )}

          <details className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <summary className="cursor-pointer select-none text-sm font-semibold text-slate-700">
              Response mapping &amp; asset type
            </summary>
            <div className="mt-4 space-y-4">
              <div>
                <label className="label" htmlFor="custom-api-data-path">Path to the holdings array</label>
                <input
                  id="custom-api-data-path"
                  className="input font-mono"
                  value={config.dataPath}
                  onChange={(event) => updateConfig("dataPath", event.target.value)}
                  placeholder="data.tokens (blank if the response is an array)"
                />
                <p className="mt-1 text-xs text-slate-400">Use dot paths, for example data.balances or result.items.</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="custom-api-symbol-path">Symbol field</label>
                  <input
                    id="custom-api-symbol-path"
                    className="input font-mono"
                    value={config.symbolPath}
                    onChange={(event) => updateConfig("symbolPath", event.target.value)}
                    placeholder="symbol"
                    required
                  />
                </div>
                <div>
                  <label className="label" htmlFor="custom-api-name-path">Name field (optional)</label>
                  <input
                    id="custom-api-name-path"
                    className="input font-mono"
                    value={config.namePath}
                    onChange={(event) => updateConfig("namePath", event.target.value)}
                    placeholder="name"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="custom-api-quantity-path">Quantity / balance field</label>
                  <input
                    id="custom-api-quantity-path"
                    className="input font-mono"
                    value={config.quantityPath}
                    onChange={(event) => updateConfig("quantityPath", event.target.value)}
                    placeholder="quantity"
                    required
                  />
                </div>
                <div>
                  <label className="label" htmlFor="custom-api-price-path">USD price per unit (optional)</label>
                  <input
                    id="custom-api-price-path"
                    className="input font-mono"
                    value={config.pricePath}
                    onChange={(event) => updateConfig("pricePath", event.target.value)}
                    placeholder="price_usd"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="custom-api-value-path">Total USD value (optional)</label>
                  <input
                    id="custom-api-value-path"
                    className="input font-mono"
                    value={config.valuePath}
                    onChange={(event) => updateConfig("valuePath", event.target.value)}
                    placeholder="value_usd"
                  />
                </div>
              </div>

              <div>
                <label className="label" htmlFor="custom-api-asset-type">Asset type for this import</label>
                <select
                  id="custom-api-asset-type"
                  className="input sm:max-w-xs"
                  value={config.assetType}
                  onChange={(event) => updateConfig("assetType", event.target.value as AssetType)}
                >
                  <option value="crypto">Crypto</option>
                  <option value="stock">Stock</option>
                  <option value="cash">Cash</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <p className="text-xs leading-relaxed text-slate-500">
                The mapped USD price per unit is preferred; if it is missing, the importer derives it from total USD value divided by quantity. That price becomes the opening cost basis. Without either value, the holding imports at $0 until you refresh or enter a price.
              </p>
            </div>
          </details>

          {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>}
          {message && <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">{message}</p>}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <p className="max-w-xl text-xs leading-relaxed text-slate-400">
              Use a read-only key with no trading permissions. API requests run server-side; saved keys are encrypted and never returned to the page.
            </p>
            <button type="submit" className="btn-primary shrink-0" disabled={busy}>
              {busy ? "Fetching preview…" : saved ? "Fetch preview & save" : "Connect & preview"}
            </button>
          </div>
        </form>
      </section>

      {preview && (
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold">Review imported holdings</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {preview.sourceName} · {preview.endpointHost} · fetched {new Date(preview.fetchedAt).toLocaleString()}
              </p>
              {preview.rows.some((row) => row.alreadyExists) && (
                <p className="mt-1 text-xs text-slate-500">Holdings with a matching type and symbol already in your portfolio are disabled to avoid duplicates.</p>
              )}
            </div>
            <div className="text-right text-sm">
              <p className="font-semibold tabular-nums">{selectedRows.length} selected</p>
              <p className="text-xs tabular-nums text-slate-500">{money(selectedValue)} selected value</p>
            </div>
          </div>

          {preview.rows.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-slate-500">
              No usable holdings were found. Check the response array path and field mappings above, then fetch again.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
                <p className="text-xs text-slate-500">
                  {preview.rows.length} unique {preview.rows.length === 1 ? "asset" : "assets"}
                  {preview.skippedCount > 0 ? ` · ${preview.skippedCount} source rows skipped` : ""}
                </p>
                <div className="flex gap-2">
                  <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => selectAll(true)} disabled={selectableRows.length === 0}>
                    Select new
                  </button>
                  <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => selectAll(false)} disabled={selected.size === 0}>
                    Clear
                  </button>
                </div>
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="w-12 px-5 py-3"><span className="sr-only">Import</span></th>
                      <th className="px-3 py-3 font-medium">Asset</th>
                      <th className="px-3 py-3 font-medium">Type</th>
                      <th className="px-3 py-3 text-right font-medium">Quantity</th>
                      <th className="px-3 py-3 text-right font-medium">Price</th>
                      <th className="px-5 py-3 text-right font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.rows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/70">
                        <td className="px-5 py-3">
                          <input
                            type="checkbox"
                            aria-label={`Import ${row.symbol}`}
                            checked={selected.has(row.id)}
                            disabled={row.alreadyExists || importing}
                            onChange={() => toggleSelected(row)}
                            className="h-4 w-4 accent-indigo-600"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <span className="font-semibold">{row.symbol}</span>
                          {row.name !== row.symbol && <span className="ml-2 text-slate-500">{row.name}</span>}
                        </td>
                        <td className="px-3 py-3 text-slate-500">{TYPE_LABELS[row.type]}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{qty(row.quantity)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-600">{row.price > 0 ? money(row.price) : "—"}</td>
                        <td className="px-5 py-3 text-right font-medium tabular-nums">{row.value > 0 ? money(row.value) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="divide-y divide-slate-100 md:hidden">
                {preview.rows.map((row) => (
                  <li key={row.id} className="flex items-start gap-3 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Import ${row.symbol}`}
                      checked={selected.has(row.id)}
                      disabled={row.alreadyExists || importing}
                      onChange={() => toggleSelected(row)}
                      className="mt-1 h-4 w-4 shrink-0 accent-indigo-600"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{row.symbol}</p>
                          <p className="truncate text-xs text-slate-500">{row.name} · {TYPE_LABELS[row.type]}</p>
                        </div>
                        <p className="shrink-0 text-right font-semibold tabular-nums">{row.value > 0 ? money(row.value) : "—"}</p>
                      </div>
                      <p className="mt-1 text-xs tabular-nums text-slate-500">
                        {qty(row.quantity)} units{row.price > 0 ? ` · ${money(row.price)} each` : " · no price"}
                        {row.alreadyExists ? " · already in portfolio" : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
            <p className="max-w-xl text-xs text-slate-500">
              Import creates opening deposits; it does not overwrite existing holdings or transactions.
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setGroupPrompt(true)}
              disabled={importing || selectedRows.length === 0}
            >
              {importing ? "Importing…" : `Import ${selectedRows.length} ${selectedRows.length === 1 ? "holding" : "holdings"}`}
            </button>
          </div>
        </section>
      )}

      {groupPrompt && selectedRows.length > 0 && preview && (
        <ImportGroupPrompt
          rows={selectedRows}
          sourceName={preview.sourceName}
          existingGroups={existingGroups}
          busy={importing}
          onCancel={() => setGroupPrompt(false)}
          onConfirm={(group) => void importSelected(group)}
          onSkip={() => void importSelected(null)}
        />
      )}
    </div>
  );
}
