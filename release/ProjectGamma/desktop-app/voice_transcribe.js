/**
 * Voice-Transkription für die Ideen-Inbox (Desktop-App).
 *
 * Trennung domain ↔ infra:
 *  - normalizeTranscript / mergeDraft: pure, testbar via node:test.
 *  - createRecognizer: dünner Adapter auf Web-Speech-API
 *    (browser-only, kein DOM in tests).
 *
 * Hinweis: erzeugt KEINE neuen Mutationen. Das Transkript wird vom
 * UI-Layer per bestehender ADD_IDEA-mutation gespeichert; mobile/
 * desktop bleiben damit synchron (gleicher MUT-handler).
 *
 * Public API:
 *  - normalizeTranscript(text): trimmt + collapsed whitespace, schneidet
 *    auf max-länge.
 *  - mergeDraft(existing, transcript): hängt transkript an bestehenden
 *    draft an (mit einem Leerzeichen), respektiert leere drafts.
 *  - isVoiceSupported(): true falls Web-Speech-API verfügbar.
 *  - createRecognizer(opts): liefert { start, stop } oder null.
 */

'use strict';

const MAX_LEN = 2000;

function normalizeTranscript(text) {
  if (text == null) return '';
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > MAX_LEN ? s.slice(0, MAX_LEN) : s;
}

function mergeDraft(existing, transcript) {
  const t = normalizeTranscript(transcript);
  if (!t) return existing == null ? '' : String(existing);
  const base = existing == null ? '' : String(existing).trim();
  if (!base) return t;
  return `${base} ${t}`;
}

function _resolveCtor(globalObj) {
  if (!globalObj) return null;
  return (
    globalObj.SpeechRecognition ||
    globalObj.webkitSpeechRecognition ||
    null
  );
}

function isVoiceSupported(globalObj) {
  const g = globalObj || (typeof window !== 'undefined' ? window : null);
  return _resolveCtor(g) != null;
}

/**
 * @param {{
 *   lang?: string,
 *   onPartial?: (t:string)=>void,
 *   onFinal?: (t:string)=>void,
 *   onError?: (e:any)=>void,
 *   onEnd?: ()=>void,
 *   globalObj?: any,
 * }} opts
 * @returns {{start:()=>boolean, stop:()=>void} | null}
 */
function createRecognizer(opts) {
  const o = opts || {};
  const g = o.globalObj || (typeof window !== 'undefined' ? window : null);
  const Ctor = _resolveCtor(g);
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = o.lang || 'de-DE';
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onresult = (ev) => {
    let partial = '';
    let final = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      const txt = (r[0] && r[0].transcript) || '';
      if (r.isFinal) final += txt;
      else partial += txt;
    }
    const finalN = normalizeTranscript(final);
    const partialN = normalizeTranscript(partial);
    if (finalN && typeof o.onFinal === 'function') o.onFinal(finalN);
    if (partialN && typeof o.onPartial === 'function') o.onPartial(partialN);
  };
  rec.onerror = (ev) => {
    if (typeof o.onError === 'function') o.onError(ev);
  };
  rec.onend = () => {
    if (typeof o.onEnd === 'function') o.onEnd();
  };

  return {
    start() {
      try { rec.start(); return true; }
      catch (e) {
        if (typeof o.onError === 'function') o.onError(e);
        return false;
      }
    },
    stop() {
      try { rec.stop(); } catch (_) { /* already stopped */ }
    },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeTranscript,
    mergeDraft,
    isVoiceSupported,
    createRecognizer,
    _MAX_LEN: MAX_LEN,
  };
}

if (typeof window !== 'undefined') {
  window.voiceTranscribe = {
    normalizeTranscript,
    mergeDraft,
    isVoiceSupported,
    createRecognizer,
  };
}
