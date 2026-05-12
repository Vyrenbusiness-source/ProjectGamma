"use strict";

// Verhindert Code-Execution via project.path: Felder, die später als
// cwd oder spawn-Argument (--add-dir, apkPath, flutterBin) verwendet
// werden, dürfen keine shell-Metazeichen enthalten. Begründung:
// spawn(..., { shell: true }) auf Windows leitet Args durch cmd.exe;
// Zeichen wie & | ; > < ` " ' werden dort als Befehlstrenner geparst.
//
// Whitelist statt Blacklist: nur druckbare ASCII + Umlaute + die für
// Pfade üblichen Zeichen (Buchstaben, Ziffern, Leerzeichen, _ - . : \ /).

const FORBIDDEN = /[&|;<>`"'$*?!\r\n\t\0\x1b]/;
const ALLOWED   = /^[A-Za-z0-9 _\-.:\\/äöüÄÖÜß]+$/;
const MAX_LEN   = 260; // Windows MAX_PATH

/**
 * Prüft, ob ein String als Projekt-Pfad sicher in spawn(...) und cwd
 * verwendet werden kann.
 * @param {unknown} p
 * @returns {boolean}
 */
function isSafeProjectPath(p) {
  if (typeof p !== "string") return false;
  if (p.length === 0 || p.length > MAX_LEN) return false;
  if (FORBIDDEN.test(p)) return false;
  if (!ALLOWED.test(p)) return false;
  return true;
}

/**
 * Wirft einen Error, wenn der Pfad nicht sicher ist.
 * @param {unknown} p
 * @param {string} [field]
 */
function assertSafeProjectPath(p, field = "path") {
  if (!isSafeProjectPath(p)) {
    const err = new Error(`unsicherer ${field}: shell-metazeichen oder unerlaubte zeichen`);
    err.status = 400;
    throw err;
  }
}

module.exports = { isSafeProjectPath, assertSafeProjectPath };
