"use client";

import { useActionState, useState } from "react";
import {
  addProxyLinkAction,
  removeProxyLinkAction,
  saveProxySettingsAction,
  testProxyConnectionAction,
  type ProxyActionState,
} from "@/app/proxy-actions";
import {
  MAX_PROXY_LABEL_LENGTH,
  MAX_PROXY_LINKS,
  MAX_PROXY_LINK_LENGTH,
  type PublicProxyConfig,
} from "@/lib/proxy-settings";
import { SubmitButton } from "./ui";

const EMPTY: ProxyActionState = {};

function StateNote({ state }: { state: ProxyActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
        {state.error}
      </p>
    );
  }
  if (!state.ok) return null;
  return (
    <div className="space-y-1">
      {state.message && (
        <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
          {state.message}
        </p>
      )}
      {state.warning && (
        <p role="status" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
          {state.warning}
        </p>
      )}
    </div>
  );
}

/**
 * Settings → Proxy.
 *
 * The app talks to its data providers from the server, so a proxy here changes
 * the address those providers see — prices, exchange balances, wallet explorers
 * and Telegram all use it. Browser traffic is untouched (that is your own
 * system/browser proxy).
 */
export default function ProxySettings({ settings }: { settings: PublicProxyConfig }) {
  const [saveState, saveAction] = useActionState(saveProxySettingsAction, EMPTY);
  const [testState, testAction] = useActionState(testProxyConnectionAction, EMPTY);
  const [linkState, linkAction] = useActionState(addProxyLinkAction, EMPTY);
  const [removeState, removeAction] = useActionState(removeProxyLinkAction, EMPTY);
  const [mode, setMode] = useState(settings.mode);

  const proxyOn = mode === "http";

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Proxy &amp; VPN</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
              Send the app&apos;s own outbound requests through an HTTP proxy — price feeds, exchange
              balances, wallet explorers and Telegram — so providers see the proxy&apos;s address
              instead of this deployment&apos;s. Your browser traffic is not affected; this is the
              server side only.
            </p>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
              settings.mode === "http"
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                : "bg-slate-100 text-slate-600 ring-slate-200"
            }`}
          >
            {settings.mode === "http" ? `On · ${settings.host}:${settings.port}` : "Direct connection"}
          </span>
        </div>

        <form action={saveAction} className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-slate-600" htmlFor="proxy-mode">
              Connection
              <select
                id="proxy-mode"
                name="mode"
                className="input mt-1"
                value={mode}
                onChange={(event) => setMode(event.target.value as PublicProxyConfig["mode"])}
              >
                <option value="off">Direct — no proxy</option>
                <option value="http">HTTP proxy</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-600" htmlFor="proxy-host">
              Host
              <input
                id="proxy-host"
                name="host"
                className="input mt-1 font-mono text-xs"
                defaultValue={settings.host}
                placeholder="127.0.0.1"
                autoComplete="off"
                spellCheck={false}
                required={proxyOn}
              />
            </label>
            <label className="block text-xs font-medium text-slate-600" htmlFor="proxy-port">
              Port
              <input
                id="proxy-port"
                name="port"
                inputMode="numeric"
                className="input mt-1 font-mono text-xs"
                defaultValue={settings.port || ""}
                placeholder="8080"
                required={proxyOn}
              />
            </label>
            <label className="block text-xs font-medium text-slate-600" htmlFor="proxy-username">
              Username <span className="font-normal text-slate-400">(optional)</span>
              <input
                id="proxy-username"
                name="username"
                className="input mt-1 font-mono text-xs"
                defaultValue={settings.username}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="block text-xs font-medium text-slate-600" htmlFor="proxy-password">
              Password <span className="font-normal text-slate-400">(optional)</span>
              <input
                id="proxy-password"
                name="password"
                type="password"
                className="input mt-1 font-mono text-xs"
                placeholder={settings.hasPassword ? `Saved ${settings.passwordHint} — leave blank to keep` : "Proxy password"}
                autoComplete="new-password"
                spellCheck={false}
              />
            </label>
            {settings.hasPassword && (
              <label className="flex items-center gap-2 self-end text-xs text-slate-600" htmlFor="proxy-clear-password">
                <input id="proxy-clear-password" type="checkbox" name="clearPassword" className="h-4 w-4 accent-indigo-600" />
                Remove the saved password
              </label>
            )}
          </div>

          <p className="text-xs leading-relaxed text-slate-500">
            Something must be listening at that host and port from <strong>this app&apos;s server</strong>.
            On Vercel that means a public proxy address, not <code className="rounded bg-slate-100 px-1">127.0.0.1</code>.
            For a VMess/VLESS server, run v2ray/Xray with an HTTP inbound and put its address here —
            the app cannot speak the VMess tunnel itself.
          </p>

          <StateNote state={saveState} />

          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton className="btn-primary" pendingText="Saving…">
              Save proxy
            </SubmitButton>
          </div>
        </form>

        <form action={testAction} className="mt-4 space-y-3 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Test the connection</h3>
              <p className="text-xs text-slate-500">
                Asks an IP-echo service twice — directly and through the saved proxy — and shows both addresses.
              </p>
            </div>
            <SubmitButton className="btn-ghost" pendingText="Checking…">
              Test connection
            </SubmitButton>
          </div>

          {(testState.directIp || testState.proxyIp) && (
            <dl className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                <dt className="text-[11px] uppercase tracking-wide text-slate-500">Direct</dt>
                <dd className="font-mono text-sm text-slate-800">{testState.directIp ?? "unavailable"}</dd>
              </div>
              <div className="rounded-xl bg-indigo-50 px-3 py-2 ring-1 ring-indigo-200">
                <dt className="text-[11px] uppercase tracking-wide text-indigo-600">Through the proxy</dt>
                <dd className="font-mono text-sm text-indigo-900">{testState.proxyIp ?? "unavailable"}</dd>
              </div>
            </dl>
          )}
          <StateNote state={testState} />
        </form>
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">VMess / VLESS / Trojan links</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
              Keep your proxy links here as an encrypted reference — one line per server. They are
              stored masked and are never sent back to the browser.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
            {settings.links.length} of {MAX_PROXY_LINKS} saved
          </span>
        </div>

        {settings.links.length > 0 ? (
          <ul className="mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-200">
            {settings.links.map((link) => (
              <li key={link.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  {link.protocol}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-800">{link.label}</span>
                  <span className="block truncate font-mono text-xs text-slate-400">{link.hint}</span>
                </span>
                <form action={removeAction}>
                  <input type="hidden" name="id" value={link.id} />
                  <SubmitButton className="btn-ghost px-2 py-1 text-xs" pendingText="Removing…">
                    Remove
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-xl bg-slate-50 px-3 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">
            No proxy links saved yet.
          </p>
        )}

        <form action={linkAction} className="mt-4 space-y-3 border-t border-slate-100 pt-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <label className="block text-xs font-medium text-slate-600" htmlFor="proxy-link-label">
              Name <span className="font-normal text-slate-400">(optional)</span>
              <input
                id="proxy-link-label"
                name="label"
                className="input mt-1"
                maxLength={MAX_PROXY_LABEL_LENGTH}
                placeholder="Singapore, home, work…"
                autoComplete="off"
              />
            </label>
            <label className="block text-xs font-medium text-slate-600" htmlFor="proxy-link-url">
              Proxy link
              <input
                id="proxy-link-url"
                name="url"
                className="input mt-1 font-mono text-xs"
                maxLength={MAX_PROXY_LINK_LENGTH}
                placeholder="vmess://…  vless://…  trojan://…  ss://…"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </label>
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            The link is encrypted with the same key as the exchange API keys. To <em>use</em> it, open it
            in your V2Ray/Xray client and point the HTTP proxy fields above at the local port that client
            exposes. Links are never shown again once saved.
          </p>
          <StateNote state={linkState} />
          <StateNote state={removeState} />
          <SubmitButton className="btn-ghost" pendingText="Saving…">
            Save link
          </SubmitButton>
        </form>
      </section>
    </div>
  );
}
