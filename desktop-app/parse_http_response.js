'use strict';

// Robustes parsing der HTTP-antwort des sync-servers (pure helper, ohne dom).
//
// Vorher: `try { JSON.parse(text) } catch { data = { raw: text } }` hat den
// parse-fehler verschluckt und beim caller landete entweder ein kryptisches
// {raw:"…"}-objekt (bei res.ok) oder ein nichtssagendes "http 500" (bei !ok)
// ohne hinweis, dass die antwort gar kein JSON war (typisch: HTML-fehlerseite
// eines reverse-proxys, leeres Bad-Gateway, etc.).
//
// Jetzt:
//  - leerer body + ok      → {}
//  - leerer body + !ok     → wirft "http <status>"
//  - JSON + ok             → parsed value (objekt/array)
//  - JSON + !ok            → wirft Error mit data.error als message, err.data=parsed
//  - non-JSON body         → wirft Error("ungültige server-antwort (http N): kein JSON — <snippet>")
//                            mit err.raw=text, err.parseError=ursprünglicher SyntaxError
//
// Alle wurf-pfade setzen err.status. Der UI-layer kann e.message direkt anzeigen.

const SNIPPET_MAX = 200;

function _snippet(text) {
  if (text.length <= SNIPPET_MAX) return text;
  return text.slice(0, SNIPPET_MAX) + '…';
}

function parseHttpResponse({ text, status, ok }) {
  if (!text) {
    if (!ok) {
      const err = new Error('http ' + status);
      err.status = status;
      err.data = {};
      throw err;
    }
    return {};
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (parseErr) {
    const err = new Error(
      'ungültige server-antwort (http ' + status + '): kein JSON — ' + _snippet(text)
    );
    err.status = status;
    err.raw = text;
    err.parseError = parseErr;
    throw err;
  }

  if (!ok) {
    const msg = (data && typeof data === 'object' && data.error) || ('http ' + status);
    const err = new Error(msg);
    err.status = status;
    err.data = data;
    throw err;
  }
  return data;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseHttpResponse };
}
if (typeof window !== 'undefined') {
  window.parseHttpResponse = parseHttpResponse;
}
