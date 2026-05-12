// Pure-Logik: tiefe wert-gleichheit für sync-konflikt-erkennung.
//
// Domain-Schicht (keine I/O). Wird von conflict_resolver/detectConflict und
// conflict_merge benutzt, damit struktur-gleiche, aber referenz-verschiedene
// werte (arrays/objekte aus mobile- bzw. desktop-clients) NICHT als konflikt
// gewertet werden. Behandelt primitive (inkl. NaN===NaN via Object.is),
// arrays und plain-objects rekursiv; funktionen/dates/maps werden nicht
// unterstützt — sync-payloads sind json-serialisiert und enthalten diese
// typen nicht.

"use strict";

/** True, wenn a und b strukturgleich sind. */
function valueEquals(a, b) {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;

  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (aIsArr !== bIsArr) return false;

  if (aIsArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!valueEquals(a[i], b[i])) return false;
    }
    return true;
  }

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!valueEquals(a[k], b[k])) return false;
  }
  return true;
}

module.exports = { valueEquals };
