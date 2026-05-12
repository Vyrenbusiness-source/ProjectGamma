"use strict";
/**
 * lib/user_settings.js
 * Persistente user-settings (API-keys, claude-presets) als JSON-file.
 *
 * Bewusst separat von store.sqlite — settings sind global (nicht
 * projekt-scoped) und sollen ohne db-migration änderbar sein.
 *
 * Sicherheit: GET-responses maskieren keys (gibt nur „set/unset" + letzte
 * 4 zeichen zurück). Klartext-keys bleiben auf der platte und gehen in
 * den env-injizier-pfad für claude-spawn.
 *
 * Pure-modul mit injizierbarem fs-helfer für tests.
 */

const fs = require("fs");
const path = require("path");

const KNOWN_KEYS = Object.freeze([
  "ANTHROPIC_API_KEY",                // claude-cli auth (fallback wenn user nicht claude login gemacht hat)
  "REF_API_KEY",                       // ref-tools-mcp
  "CONTEXT7_API_KEY",                  // context7-mcp (optional, höhere quota)
  "OPENAI_API_KEY",                    // falls user andere agents bauen will
  "GITHUB_PERSONAL_ACCESS_TOKEN",      // github-mcp (repo-zugriff, PRs, issues)
]);

function maskKey(v) {
  if (!v || typeof v !== "string") return null;
  if (v.length < 8) return "set (***)";
  return "set (…" + v.slice(-4) + ")";
}

function createUserSettingsStore({ file, readFile = fs.readFileSync, writeFile = fs.writeFileSync, existsSync = fs.existsSync }) {
  if (!file || typeof file !== "string") {
    throw new Error("createUserSettingsStore: 'file' (path) erforderlich");
  }
  function load() {
    if (!existsSync(file)) return {};
    try {
      const raw = readFile(file, "utf8");
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === "object") ? parsed : {};
    } catch (e) {
      console.warn("[user_settings] read failed:", e && e.message);
      return {};
    }
  }
  function save(obj) {
    try {
      writeFile(file, JSON.stringify(obj, null, 2));
      return true;
    } catch (e) {
      console.warn("[user_settings] write failed:", e && e.message);
      return false;
    }
  }
  function getAllMasked() {
    const all = load();
    const out = {};
    for (const k of KNOWN_KEYS) {
      out[k] = all[k] ? maskKey(all[k]) : "unset";
    }
    return out;
  }
  function getRaw(key) {
    const all = load();
    return all[key] || null;
  }
  function setKey(key, value) {
    if (!KNOWN_KEYS.includes(key)) throw new Error("unbekannter setting-key: " + key);
    const all = load();
    if (value == null || value === "") delete all[key];
    else if (typeof value !== "string") throw new Error("setting-value muss string sein");
    else all[key] = value.trim();
    save(all);
    return getAllMasked();
  }
  function envOverlay() {
    // Liefert ein env-overlay-objekt für spawn — nur gesetzte werte, damit
    // process.env (claude login etc.) nicht überschrieben wird wenn user
    // hier nichts eingetragen hat.
    const all = load();
    const out = {};
    for (const k of KNOWN_KEYS) if (all[k]) out[k] = all[k];
    return out;
  }
  return { getAllMasked, getRaw, setKey, envOverlay, KNOWN_KEYS };
}

module.exports = { createUserSettingsStore, KNOWN_KEYS };
