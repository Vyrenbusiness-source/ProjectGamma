"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { isSafeProjectPath } = require("./safe_path");

/**
 * Leitet den Default-Projektpfad zur Laufzeit ab, statt ihn hartzukodieren.
 *
 * sync-server liegt als Unterordner im ProjectGamma-Root, daher ist der
 * parent des sync-server-Verzeichnisses der natürliche Default. Existiert er
 * nicht (oder ist nicht safe-path-konform), wird null zurückgegeben — der
 * Aufrufer kann dann z.B. den Eintrag ohne Pfad anlegen und sichtbar warnen,
 * statt stillschweigend auf einen toten absoluten Pfad zu zeigen.
 *
 * @param {string|undefined} serverDir absoluter Pfad des sync-server-Ordners
 * @returns {string|null} resolvter Default-Projektpfad oder null
 */
function resolveDefaultProjectPath(serverDir) {
  if (typeof serverDir !== "string" || serverDir.length === 0) return null;
  const candidate = path.resolve(serverDir, "..");
  if (!isSafeProjectPath(candidate)) return null;
  try {
    if (!fs.existsSync(candidate)) return null;
    if (!fs.statSync(candidate).isDirectory()) return null;
  } catch {
    return null;
  }
  return candidate;
}

module.exports = { resolveDefaultProjectPath };
