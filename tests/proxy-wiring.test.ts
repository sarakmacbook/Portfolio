/**
 * The proxy is only useful if it is actually installed on the fetches the app
 * makes and if the saved settings stay encrypted. These read the source, because
 * the alternative — a live proxy and a database — is not available in tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("the saved proxy is installed as undici's global dispatcher", () => {
  const outbound = read("src/lib/outbound.ts");
  assert.ok(outbound.includes("setGlobalDispatcher"), "fetch must be routed without touching every call site");
  assert.ok(outbound.includes("new ProxyAgent(url)"), "the saved proxy becomes the dispatcher");
  assert.ok(outbound.includes("new Agent()"), "turning the proxy off restores a direct agent");
  assert.ok(
    outbound.includes("if (url === appliedUrl) return { mode: config.mode, url }"),
    "re-applying the same settings must not rebuild the agent",
  );
});

test("every server boot and every save installs the proxy", () => {
  const instrumentation = read("src/instrumentation.ts");
  assert.ok(instrumentation.includes("applySavedProxy"), "a cold start applies the saved proxy before fetching prices");
  assert.ok(
    instrumentation.includes('process.env.NEXT_RUNTIME !== "nodejs"'),
    "the browser/edge runtime is skipped — this is a server-side proxy",
  );

  const actions = read("src/app/proxy-actions.ts");
  assert.ok(actions.includes('"use server"'));
  assert.ok(actions.includes("await applySavedProxy()"), "saving applies the change immediately");
  assert.ok(actions.includes("forgetProxyCache()"), "...without waiting for the settings cache to lapse");
  assert.ok(actions.includes("revalidatePath(\"/settings\")"));
});

test("the settings page renders the proxy card", () => {
  const page = read("src/app/settings/page.tsx");
  assert.ok(page.includes('from "@/components/ProxySettings"'));
  assert.ok(page.includes("<ProxySettings settings={proxy} />"));
  assert.ok(page.includes("getPublicProxySettings"), "the page only ever receives the public shape");
});

test("proxy settings and links are encrypted at rest, never stored in clear", () => {
  const store = read("src/lib/proxy-settings-db.ts");
  assert.ok(store.includes("encryptJson(config, key)"), "the whole config is encrypted, password and links included");
  assert.ok(store.includes("decryptJson(row.value, key)"));
  assert.ok(store.includes("getCredentialEncryptionKey"), "the exchange-key encryption key is reused");
  assert.ok(store.includes("onConflictDoUpdate"), "one row, overwritten on save");
  assert.ok(store.includes("return emptyProxyConfig()"), "an unreadable blob degrades to direct, not to a crash");
});

test("the UI hides secrets and explains what VMess links can and cannot do", () => {
  const component = read("src/components/ProxySettings.tsx");
  assert.ok(component.includes("link.hint"), "only the masked hint is rendered");
  assert.ok(!component.includes("{link.url}"), "the raw link never reaches the browser");
  assert.ok(component.includes("passwordHint"), "the password is shown masked");
  assert.ok(component.includes('type="password"'), "a new password is typed into a password field");
  assert.ok(!component.includes("defaultValue={settings.password}"), "no secret is prefilled");

  const text = component + read("src/lib/proxy-settings.ts");
  assert.ok(/v2ray|Xray/i.test(text), "the copy says a local xray/v2ray client exposes the vmess link as an HTTP port");
  assert.ok(
    /cannot speak the VMess tunnel|cannot dial them directly|never dials it/i.test(text),
    "the copy is honest that a raw vmess:// link is not dialled by the app",
  );
});

test("the proxy test compares a direct IP with the proxied one", () => {
  const actions = read("src/app/proxy-actions.ts");
  assert.ok(actions.includes("egressIp({ viaProxy: false })"));
  assert.ok(actions.includes("egressIp({ viaProxy: true })"));
  assert.ok(actions.includes("direct.ip !== viaProxy.ip"), "the result says whether the IP actually changed");

  const outbound = read("src/lib/outbound.ts");
  assert.ok(outbound.includes("api.ipify.org"), "an IP echo service reports the exit address");
  assert.ok(outbound.includes("dispatcher: direct"), "the direct probe bypasses the installed proxy");
});

test("a proxy failure never breaks a price refresh", () => {
  const outbound = read("src/lib/outbound.ts");
  assert.ok(outbound.includes("} catch (error) {"), "installing the proxy is guarded");
  assert.ok(outbound.includes("appliedUrl = null"), "a bad proxy URL falls back to a direct agent");
  assert.ok(
    read("src/lib/proxy-settings-db.ts").includes("catch {\n    return emptyProxyConfig();"),
    "unreadable settings mean direct requests",
  );
});
