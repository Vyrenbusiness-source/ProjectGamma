// cloudflare_tunnel.js · Quick-Tunnel via cloudflared.
// Lädt cloudflared binary on-demand und startet einen anonymen Tunnel
// (kein Cloudflare-Account nötig). Das Binary verbindet outbound zu Cloudflare,
// die App ist dann über eine *.trycloudflare.com URL weltweit erreichbar.
// Ideal für team-collab ohne port-forwarding, hinter NAT/CGNAT, etc.

const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawn } = require("child_process");

const RELEASE_URLS = {
  "win32-x64":   "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe",
  "linux-x64":   "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
  "linux-arm64": "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64",
  "darwin-x64":  "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz",
  "darwin-arm64":"https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz",
};

function binaryName() {
  return process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
}

function binaryPath(baseDir) {
  return path.join(baseDir, "bin", binaryName());
}

function ensureBinary(baseDir) {
  return new Promise((resolve, reject) => {
    const target = binaryPath(baseDir);
    if (fs.existsSync(target)) return resolve(target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const key = `${process.platform}-${process.arch}`;
    const url = RELEASE_URLS[key];
    if (!url) return reject(new Error(`cloudflared: keine binary für ${key}`));
    if (url.endsWith(".tgz")) {
      // macOS: tarball entpacken — out-of-scope für jetzt, user muss selbst installieren
      return reject(new Error("cloudflared: macOS bitte manuell via `brew install cloudflared` installieren"));
    }
    console.log("[cloudflare] downloading cloudflared from", url);
    download(url, target).then(() => {
      try {
        if (process.platform !== "win32") fs.chmodSync(target, 0o755);
      } catch (_) {}
      resolve(target);
    }).catch(reject);
  });
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("zu viele redirects"));
    const file = fs.createWriteStream(dest);
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try { fs.unlinkSync(dest); } catch (_) {}
        return download(res.headers.location, dest, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch (_) {}
        return reject(new Error(`download fehlgeschlagen: HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
    });
    req.on("error", (e) => { file.close(); try { fs.unlinkSync(dest); } catch (_) {} reject(e); });
  });
}

function createCloudflareTunnel({ baseDir, localPort, logger = console }) {
  let proc = null;
  let url = null;
  let status = "idle";        // idle | starting | active | error | stopped
  let error = null;
  let startedAt = null;
  const listeners = new Set();
  const emit = () => listeners.forEach((l) => { try { l({ status, url, error, startedAt }); } catch (_) {} });
  const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

  async function start() {
    if (status === "active" || status === "starting") return { status, url, error };
    status = "starting"; url = null; error = null; startedAt = Date.now(); emit();
    let bin;
    try {
      bin = await ensureBinary(baseDir);
    } catch (e) {
      status = "error"; error = e.message; emit();
      return { status, url, error };
    }
    return new Promise((resolve) => {
      const args = ["tunnel", "--no-autoupdate", "--url", `http://localhost:${localPort}`];
      proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
      const handleChunk = (chunk) => {
        const s = chunk.toString();
        if (!url) {
          const m = s.match(URL_RE);
          if (m) {
            url = m[0];
            status = "active";
            logger.log("[cloudflare] tunnel aktiv:", url);
            emit();
            resolve({ status, url, error: null });
          }
        }
      };
      proc.stdout.on("data", handleChunk);
      proc.stderr.on("data", handleChunk);
      proc.on("exit", (code) => {
        if (status !== "stopped") {
          status = code === 0 ? "stopped" : "error";
          error = code === 0 ? null : `cloudflared exited (code ${code})`;
          logger.warn("[cloudflare] tunnel beendet:", code);
          emit();
        }
        proc = null;
        url = null;
        if (status === "error" && !startedAt) resolve({ status, url: null, error });
      });
      // Timeout-fallback: wenn nach 30s noch keine URL geparsed wurde, return current state
      setTimeout(() => {
        if (status === "starting") {
          // Lass den Tunnel weiterlaufen — vielleicht kommt die URL noch.
          // Aber der API-call returnt jetzt mit dem letzten status.
          resolve({ status, url, error });
        }
      }, 30_000);
    });
  }

  function stop() {
    if (proc) {
      status = "stopped"; emit();
      try { proc.kill(); } catch (_) {}
      proc = null;
      url = null;
    }
    return { status, url, error };
  }

  function getStatus() {
    return { status, url, error, startedAt };
  }

  function onChange(l) {
    listeners.add(l);
    return () => listeners.delete(l);
  }

  return { start, stop, getStatus, onChange };
}

module.exports = { createCloudflareTunnel, ensureBinary };
