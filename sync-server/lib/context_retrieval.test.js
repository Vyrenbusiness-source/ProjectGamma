"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { tokenize, buildIndex, scoreQuery, pickTopK } = require("./context_retrieval");

test("tokenize: lowercase + alphanumeric + stopwords raus + min 3 zeichen", () => {
  const tokens = tokenize("Der Service muss schnell sein und die API stabil halten");
  // 'der', 'die', 'und', 'sein' = stopwords → raus
  // 'api' = 3 zeichen → drin
  assert.ok(tokens.includes("service"));
  assert.ok(tokens.includes("schnell"));
  assert.ok(tokens.includes("api"));
  assert.ok(tokens.includes("stabil"));
  assert.ok(!tokens.includes("der"));
  assert.ok(!tokens.includes("die"));
  assert.ok(!tokens.includes("und"));
});

test("tokenize: leer / null / nicht-string → []", () => {
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize(null), []);
  assert.deepEqual(tokenize(undefined), []);
  assert.deepEqual(tokenize(42), []);
});

test("tokenize: umlaute werden behandelt", () => {
  const tokens = tokenize("Geschäftsmodell für Müllerei und Brüche");
  assert.ok(tokens.includes("geschäftsmodell"));
  assert.ok(tokens.includes("müllerei"));
  assert.ok(tokens.includes("brüche"));
});

test("buildIndex: IDF für seltene terme höher als für häufige", () => {
  const docs = [
    { id: "1", text: "common common common" },
    { id: "2", text: "common rare" },
    { id: "3", text: "common another" },
  ];
  const index = buildIndex(docs);
  // "common" in 3/3 docs → IDF niedrig
  // "rare" in 1/3 docs → IDF höher
  assert.ok(index.idf.get("rare") > index.idf.get("common"));
});

test("pickTopK: relevanteste docs zuerst", () => {
  const corpus = [
    { id: "1", text: "datenbank index performance optimieren" },
    { id: "2", text: "ui button styling react component" },
    { id: "3", text: "api endpoint authentication jwt token" },
    { id: "4", text: "database migration schema upgrade" },
  ];
  const top = pickTopK({
    query: "datenbank query performance verbessern",
    corpus,
    k: 2,
  });
  assert.equal(top.length, 2);
  // doc 1 sollte erstplatziert sein (datenbank+performance)
  assert.equal(top[0].id, "1");
});

test("pickTopK: leerer corpus → []", () => {
  const out = pickTopK({ query: "anything", corpus: [], k: 5 });
  assert.deepEqual(out, []);
});

test("pickTopK: k = 0 → []", () => {
  const out = pickTopK({
    query: "query",
    corpus: [{ id: "1", text: "foo" }],
    k: 0,
  });
  assert.deepEqual(out, []);
});

test("pickTopK: k > corpus → alle docs", () => {
  const corpus = [
    { id: "1", text: "alpha" },
    { id: "2", text: "beta" },
  ];
  const out = pickTopK({ query: "alpha", corpus, k: 10 });
  assert.equal(out.length, 2);
});

test("pickTopK: keine overlap → fallback auf erste K (alphabetisch nicht nötig)", () => {
  const corpus = [
    { id: "1", text: "datenbank optimierung" },
    { id: "2", text: "ui styling" },
    { id: "3", text: "api routing" },
  ];
  const out = pickTopK({
    query: "completely unrelated xyzqwerty",
    corpus,
    k: 2,
  });
  // fallback: erste 2 (corpus-reihenfolge)
  assert.equal(out.length, 2);
  assert.equal(out[0].id, "1");
  assert.equal(out[1].id, "2");
});

test("pickTopK: behält original-objekt-format mit extra-feldern", () => {
  const corpus = [
    { id: "1", text: "datenbank", category: "perf", active: true },
    { id: "2", text: "ui", category: "design", active: false },
  ];
  const out = pickTopK({ query: "datenbank", corpus, k: 1 });
  assert.equal(out[0].id, "1");
  assert.equal(out[0].category, "perf");
  assert.equal(out[0].active, true);
});

test("pickTopK: custom textKey + idKey", () => {
  const corpus = [
    { ruleId: "r1", body: "datenbank performance" },
    { ruleId: "r2", body: "ui styling" },
  ];
  const out = pickTopK({
    query: "datenbank optimieren",
    corpus,
    k: 1,
    idKey: "ruleId",
    textKey: "body",
  });
  assert.equal(out[0].ruleId, "r1");
});

test("pickTopK: tie-break = ursprüngliche reihenfolge", () => {
  // beide docs haben identischen score
  const corpus = [
    { id: "first", text: "datenbank" },
    { id: "second", text: "datenbank" },
  ];
  const out = pickTopK({ query: "datenbank", corpus, k: 2 });
  assert.equal(out[0].id, "first");
  assert.equal(out[1].id, "second");
});
