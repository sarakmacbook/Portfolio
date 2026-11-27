import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_PROXY_LINKS,
  detectProxyProtocol,
  emptyProxyConfig,
  maskSecret,
  publicProxyConfig,
  proxyDispatcherUrl,
  proxySummary,
  readProxyConfig,
  validateProxyConfig,
  validateProxyLink,
  type ProxyConfig,
} from "@/lib/proxy-settings";

const base: ProxyConfig = {
  mode: "http",
  host: "proxy.example.com",
  port: 8080,
  username: "",
  password: "",
  links: [],
};

test("a fresh install makes direct requests", () => {
  const config = emptyProxyConfig();
  assert.equal(config.mode, "off");
  assert.equal(proxyDispatcherUrl(config), null, "off means no dispatcher — fetch goes out directly");
  assert.equal(proxySummary(config), "Direct connection — no proxy");
  assert.deepEqual(config.links, []);
});

test("an HTTP proxy becomes a dispatcher URL", () => {
  assert.equal(proxyDispatcherUrl(base), "http://proxy.example.com:8080");

  const withAuth = proxyDispatcherUrl({ ...base, username: "me", password: "p@ss word/x" });
  assert.equal(withAuth, "http://me:p%40ss%20word%2Fx@proxy.example.com:8080");
  assert.ok(!withAuth?.includes("p@ss"), "credentials are percent-encoded, not pasted in");
});

test("the proxy needs a real host and port when it is on", () => {
  assert.equal(validateProxyConfig({ ...base, host: "" }).ok, false);
  assert.equal(validateProxyConfig({ ...base, host: "http://proxy.example.com" }).ok, false, "no scheme in the host field");
  assert.equal(validateProxyConfig({ ...base, host: "proxy.example.com/path" }).ok, false);
  assert.equal(validateProxyConfig({ ...base, port: 0 }).ok, false);
  assert.equal(validateProxyConfig({ ...base, port: 70000 }).ok, false);
  assert.equal(validateProxyConfig({ ...base, port: 8080.5 }).ok, false);

  const ok = validateProxyConfig({ ...base, host: " 10.0.0.4 ", port: 3128, username: " user " });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.ok && { host: ok.config.host, port: ok.config.port, username: ok.config.username }, {
    host: "10.0.0.4",
    port: 3128,
    username: "user",
  });
});

test("turning the proxy off accepts a half-filled form", () => {
  const validated = validateProxyConfig({ ...base, mode: "off", host: "", port: 0 });
  assert.equal(validated.ok, true);
  assert.equal(validated.ok && proxyDispatcherUrl(validated.config), null);
});

test("the proxy never hands a password to the browser", () => {
  const publicConfig = publicProxyConfig({
    ...base,
    username: "me",
    password: "hunter2-secret",
    links: [
      {
        id: "1",
        label: "Singapore",
        protocol: "vmess",
        url: "vmess://eyJhZGQiOiJleGFtcGxlLmNvbSIsInBzIjoiU0cifQ==",
        addedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });

  const serialised = JSON.stringify(publicConfig);
  assert.ok(!serialised.includes("hunter2-secret"), "the password is not serialised");
  assert.ok(!serialised.includes("eyJhZGQiOiJleGFtcGxlLmNvbSIs"), "the link body is not serialised");
  assert.equal(publicConfig.hasPassword, true);
  assert.equal(publicConfig.passwordHint, "••••••••cret");
  assert.equal(publicConfig.links[0].hint, "vmess://••••••••fQ==");
  assert.match(maskSecret("abcd"), /^••••••••abcd$/);
  assert.equal(maskSecret(""), "");
});

test("link protocols are recognised from their scheme", () => {
  assert.equal(detectProxyProtocol("vmess://abc"), "vmess");
  assert.equal(detectProxyProtocol("VLESS://abc"), "vless");
  assert.equal(detectProxyProtocol("trojan://abc"), "trojan");
  assert.equal(detectProxyProtocol("ss://abc"), "ss");
  assert.equal(detectProxyProtocol("socks5://1.2.3.4:1080"), "socks");
  assert.equal(detectProxyProtocol("https://proxy.example.com"), "http");
  assert.equal(detectProxyProtocol("ftp://nope"), null);
  assert.equal(detectProxyProtocol("vmess-abc"), null);
});

test("VMess links are stored as given, with a label and protocol", () => {
  const validated = validateProxyLink("  vmess://eyJhZGQiOiIxLjIuMy40In0=  ", " Tokyo ");
  assert.equal(validated.ok, true);
  const link = validated.ok && validated.link;
  assert.ok(link);
  assert.equal(link.url, "vmess://eyJhZGQiOiIxLjIuMy40In0=", "whitespace trimmed, payload untouched");
  assert.equal(link.label, "Tokyo");
  assert.equal(link.protocol, "vmess");
  assert.equal(link.id.length > 0, true);
  assert.match(link.addedAt, /^\d{4}-\d{2}-\d{2}T/);

  const unlabelled = validateProxyLink("vless://uuid@host:443", "");
  assert.equal(unlabelled.ok && unlabelled.link.label, "VLESS");
});

test("bad links are refused with a readable reason", () => {
  const empty = validateProxyLink("", "");
  assert.equal(empty.ok, false);
  assert.match(!empty.ok ? empty.error : "", /Paste a proxy link/);

  const website = validateProxyLink("https://example.com/not-a-proxy", "");
  assert.equal(website.ok, false, "a website is not a proxy");
  assert.match(!website.ok ? website.error : "", /Include the port/);

  assert.equal(validateProxyLink("http://proxy.example.com:8080", "").ok, true);
  assert.equal(validateProxyLink("ftp://example.com:21", "").ok, false);

  const spaced = validateProxyLink("vmess://abc def", "");
  assert.equal(spaced.ok, false);

  const huge = validateProxyLink(`vmess://${"a".repeat(5000)}`, "");
  assert.equal(huge.ok, false);
});

test("stored settings are read back defensively", () => {
  const restored = readProxyConfig({
    mode: "http",
    host: " proxy.example.com ",
    port: "8080",
    username: "me",
    password: "secret",
    links: [{ id: "a", label: "Home", protocol: "trojan", url: "trojan://x@y:443", addedAt: "2026-01-01T00:00:00.000Z" }, "junk", { protocol: "nope", url: "nope" }],
  });
  assert.equal(restored.mode, "http");
  assert.equal(restored.host, "proxy.example.com");
  assert.equal(restored.port, 8080, "a numeric string port is accepted");
  assert.equal(restored.links.length, 1, "unknown links are dropped");
  assert.equal(restored.links[0].protocol, "trojan");

  const garbage = readProxyConfig("not an object");
  assert.deepEqual(garbage, emptyProxyConfig());

  const weirdMode = readProxyConfig({ mode: "socks5" });
  assert.equal(weirdMode.mode, "off", "an unknown mode degrades to direct");
});

test("the link list is capped", () => {
  assert.ok(MAX_PROXY_LINKS >= 5 && MAX_PROXY_LINKS <= 100);
});
