// apk-release: liefert version+sha256+size für gebaute mobile-app-debug-apk.
// Pure helpers (keine express-deps), damit per node:test verifizierbar.
// Mobile-app holt sich /api/updates/apk/info → vergleicht version → lädt apk
// → prüft sha256 vor dem install (defense-in-depth, regel "sha256-integrität").

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// pubspec.yaml-format: "version: 1.0.0+1" → {semver:"1.0.0", build:1}
function parsePubspecVersion(text) {
  const m = String(text || "").match(/^version:\s*([0-9.]+)\+(\d+)/m);
  if (!m) return null;
  return { semver: m[1], build: Number(m[2]), full: `${m[1]}+${m[2]}` };
}

function compareVersions(a, b) {
  const pa = parsePubspecVersion(`version: ${a}`) || parsePubspecVersion(a);
  const pb = parsePubspecVersion(`version: ${b}`) || parsePubspecVersion(b);
  if (!pa || !pb) return 0;
  const sa = pa.semver.split(".").map(Number);
  const sb = pb.semver.split(".").map(Number);
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const da = sa[i] || 0, db = sb[i] || 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  if (pa.build !== pb.build) return pa.build < pb.build ? -1 : 1;
  return 0;
}

function sha256OfFile(filePath) {
  const h = crypto.createHash("sha256");
  const buf = fs.readFileSync(filePath);
  h.update(buf);
  return h.digest("hex");
}

function sha256OfBuffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// rootDir = mobileDir (mobile-app/). Liefert release-info oder null,
// wenn pubspec/apk fehlt. Niemals throwen — caller entscheidet.
function readReleaseInfo(rootDir) {
  if (!rootDir) return null;
  try {
    const pubspecPath = path.join(rootDir, "pubspec.yaml");
    const apkPath = path.join(rootDir, "build", "app", "outputs",
      "flutter-apk", "app-debug.apk");
    if (!fs.existsSync(pubspecPath) || !fs.existsSync(apkPath)) return null;
    const pub = parsePubspecVersion(fs.readFileSync(pubspecPath, "utf8"));
    if (!pub) return null;
    const stat = fs.statSync(apkPath);
    return {
      version: pub.full,
      semver: pub.semver,
      build: pub.build,
      sha256: sha256OfFile(apkPath),
      size: stat.size,
      builtAt: stat.mtimeMs,
      apkPath,
    };
  } catch (err) {
    console.warn("[apk_release] readReleaseInfo:", err && err.message);
    return null;
  }
}

module.exports = {
  parsePubspecVersion,
  compareVersions,
  sha256OfFile,
  sha256OfBuffer,
  readReleaseInfo,
};
