"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createPublicIpResolver, isValidIpv4 } = require("./public_ip.js");

function fakeFetch(map) {
  return (url) => {
    if (typeof map[url] === "string") return Promise.resolve(map[url]);
    if (map[url] instanceof Error) return Promise.reject(map[url]);
    return Promise.reject(new Error("no mock for " + url));
  };
}

test("isValidIpv4", () => {
  assert.equal(isValidIpv4("203.0.113.42"), true);
  assert.equal(isValidIpv4("256.0.0.0"), false);
  assert.equal(isValidIpv4("foo"), false);
  assert.equal(isValidIpv4(""), false);
  assert.equal(isValidIpv4(null), false);
});

test("resolve: erster service liefert → cached", async () => {
  const services = [{ url: "https://a", parse: (s) => s.trim() }];
  const r = createPublicIpResolver({ services, fetch: fakeFetch({ "https://a": "1.2.3.4\n" }) });
  const a = await r.resolve();
  assert.equal(a.ip, "1.2.3.4");
  assert.equal(a.cached, false);
  const b = await r.resolve();
  assert.equal(b.ip, "1.2.3.4");
  assert.equal(b.cached, true);
});

test("resolve: nächster service wenn erster fails", async () => {
  const services = [
    { url: "https://a", parse: (s) => s.trim() },
    { url: "https://b", parse: (s) => s.trim() },
  ];
  const r = createPublicIpResolver({ services, fetch: fakeFetch({
    "https://a": new Error("down"),
    "https://b": "5.6.7.8",
  })});
  const a = await r.resolve();
  assert.equal(a.ip, "5.6.7.8");
  assert.equal(a.error, null);
});

test("resolve: alle fail → null", async () => {
  const services = [{ url: "https://a", parse: (s) => s.trim() }];
  const r = createPublicIpResolver({ services, fetch: fakeFetch({
    "https://a": new Error("nope"),
  })});
  const a = await r.resolve();
  assert.equal(a.ip, null);
  assert.match(a.error, /nope/);
});

test("resolve: ungültige IPs werden verworfen", async () => {
  const services = [
    { url: "https://a", parse: (s) => s.trim() },
    { url: "https://b", parse: (s) => s.trim() },
  ];
  const r = createPublicIpResolver({ services, fetch: fakeFetch({
    "https://a": "<html>error</html>",
    "https://b": "1.2.3.4",
  })});
  const a = await r.resolve();
  assert.equal(a.ip, "1.2.3.4");
});

test("getCached: gibt cache zurück nach erstem resolve", async () => {
  const services = [{ url: "https://a", parse: (s) => s.trim() }];
  const r = createPublicIpResolver({ services, fetch: fakeFetch({ "https://a": "1.2.3.4" })});
  assert.equal(r.getCached().ip, null);
  await r.resolve();
  assert.equal(r.getCached().ip, "1.2.3.4");
});
