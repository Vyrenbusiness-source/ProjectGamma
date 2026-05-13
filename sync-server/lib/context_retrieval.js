"use strict";
/**
 * lib/context_retrieval.js
 * BM25-basierte semantic-lite retrieval für project memory.
 *
 * Anstatt bei jedem cc-run alle rules/activity/bugs in den prompt zu kippen
 * (dump-style, viel tokens), wird hier pro task der relevanteste subset
 * ausgewählt — keyword-überlappung via BM25, ohne external embedding-API.
 *
 * Hintergrund (master-spec mapping):
 *   - "Smart Context Loading" → pickTopK(...) gibt nur die top-K items
 *   - "Multi-Memory-System" → wir trennen short/long/semantic/project IN
 *     den scoring-domains: rules=semantic, activity=long-term, bugs=project
 *   - "Embeddings/vector-search" → BM25 ist die light-version; echte
 *     embeddings wären eine API-erweiterung
 *
 * Public API:
 *   tokenize(text) -> string[]                   - normalisiert + stopwords raus
 *   buildIndex(docs) -> { idf, tfDocs, avgLen }  - statisches index pro corpus
 *   scoreQuery(index, queryTokens, doc) -> number - BM25 score
 *   pickTopK({ query, corpus, k, idKey, textKey }) -> docs[]
 *
 * Pure-helper: kein I/O, kein API-call, kein state — node:test friendly.
 */

const STOPWORDS = new Set([
  "der","die","das","den","dem","des","ein","eine","einer","einem","einen",
  "und","oder","aber","wenn","dann","auch","nur","noch","schon","mehr",
  "in","an","auf","bei","mit","zu","von","aus","über","unter","für","gegen",
  "ist","sind","war","waren","wird","werde","wurde","wurden","sein","hat","hatte","haben",
  "ich","du","er","sie","es","wir","ihr","mich","dich","ihn","uns","euch",
  "das","dies","diese","dieser","diesem","jeden","alles","etwas","nichts",
  "the","a","an","is","are","was","were","be","been","being","has","have","had",
  "to","of","in","on","at","for","with","by","from","as","that","this","these",
  "it","its","they","their","them","we","our","you","your",
  "do","does","did","done","get","got","make","made","go","goes","went",
  "and","or","but","not","no","if","then","else","when","while","so",
]);

/**
 * Tokenize: lowercase, alphanumeric, stopwords raus, min 3 zeichen.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  return text.toLowerCase()
    // split bei nicht-alphanumerisch — unicode-aware für umlaute
    .split(/[^\p{L}\p{N}]+/u)
    .filter(t => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Index: pro doc tokenisieren + term-frequencies zählen. IDF aus corpus.
 * @param {Array<{id: string, text: string}>} docs
 * @returns {{ idf: Map<string, number>, tfDocs: Map<string, {tf: Map, len: number}>, avgLen: number }}
 */
function buildIndex(docs) {
  const tfDocs = new Map();
  const docFreq = new Map();
  let totalLen = 0;
  for (const doc of docs) {
    const tokens = tokenize(doc.text);
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    tfDocs.set(doc.id, { tf, len: tokens.length });
    totalLen += tokens.length;
    for (const term of tf.keys()) docFreq.set(term, (docFreq.get(term) || 0) + 1);
  }
  const N = docs.length || 1;
  const idf = new Map();
  for (const [term, df] of docFreq) {
    // BM25 idf: log((N - df + 0.5) / (df + 0.5) + 1) — immer >= 0
    idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1));
  }
  const avgLen = totalLen / N;
  return { idf, tfDocs, avgLen };
}

/**
 * BM25 score eines docs gegen query-tokens.
 * @param {object} index
 * @param {string[]} queryTokens
 * @param {string} docId
 * @returns {number}
 */
function scoreQuery(index, queryTokens, docId) {
  const entry = index.tfDocs.get(docId);
  if (!entry) return 0;
  const k1 = 1.5, b = 0.75;
  let score = 0;
  for (const qt of queryTokens) {
    const tf = entry.tf.get(qt) || 0;
    if (!tf) continue;
    const idf = index.idf.get(qt) || 0;
    const norm = 1 - b + b * (entry.len / (index.avgLen || 1));
    score += idf * (tf * (k1 + 1)) / (tf + k1 * norm);
  }
  return score;
}

/**
 * Top-K retrieval: corpus + query → top-K docs sortiert nach BM25.
 * Falls k > corpus.length, return alle. Ties bleiben in original-reihenfolge.
 *
 * @param {object} opts
 * @param {string} opts.query - der task/prompt-text als query
 * @param {Array<object>} opts.corpus - { [idKey]: id, [textKey]: text, ...extra }
 * @param {number} opts.k - wie viele zurück
 * @param {string} [opts.idKey="id"]
 * @param {string} [opts.textKey="text"]
 * @returns {Array<object>} - die top-K docs IN URSPRÜNGLICHER FORM (mit allen feldern)
 */
function pickTopK({ query, corpus, k, idKey = "id", textKey = "text" }) {
  if (!Array.isArray(corpus) || corpus.length === 0) return [];
  if (!query || k <= 0) return corpus.slice(0, Math.max(0, k));

  // Synthetic ids falls fehlen — index braucht eindeutige refs
  const docs = corpus.map((d, i) => ({
    id: d[idKey] != null ? String(d[idKey]) : "_idx_" + i,
    text: String(d[textKey] || ""),
    _orig: d,
    _idx: i,
  }));
  const index = buildIndex(docs);
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    // keine query → fallback: erste K aus corpus
    return corpus.slice(0, k);
  }
  const scored = docs.map(d => ({
    doc: d._orig,
    idx: d._idx,
    score: scoreQuery(index, queryTokens, d.id),
  }));
  // sortieren: höchster score zuerst; bei tie → ursprüngliche reihenfolge
  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
  // Falls ALLE scores 0 sind (keine token-überlappung), fallback auf
  // erste K aus corpus — gibt cc immerhin die neuesten/wichtigsten
  if (scored[0]?.score === 0) return corpus.slice(0, k);
  return scored.slice(0, k).map(s => s.doc);
}

module.exports = { tokenize, buildIndex, scoreQuery, pickTopK, STOPWORDS };
