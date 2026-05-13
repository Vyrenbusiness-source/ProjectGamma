"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { classify } = require("./rule_idea_classifier.js");

test("kurze verhaltensregeln zählen als rule", () => {
  assert.equal(classify("kein unnötiger code"), "rule");
  assert.equal(classify("snake_case für dateien"), "rule");
  assert.equal(classify("öffentliche api dokumentiert"), "rule");
  assert.equal(classify("feature-first organisation"), "rule");
});

test("texte mit dateipfaden zählen als idea", () => {
  assert.equal(
    classify("rule-diff-queue als sync-server/lib/rule_diff_queue.js modul"),
    "idea",
  );
  assert.equal(
    classify("desktop-app/styles.css aufräumen"),
    "idea",
  );
});

test("action-prefix (splitten/anlegen/migrieren) zählt als idea", () => {
  assert.equal(classify("store.json → sqlite migration in zwei tasks splitten"), "idea");
  assert.equal(classify("modul für rule-diffs anlegen"), "idea");
  assert.equal(classify("Implementiere conflict-resolution"), "idea");
});

test("sehr lange texte zählen als idea", () => {
  const long = "irgendwas ".repeat(20);
  assert.equal(classify(long), "idea");
});

test("aufzählungslisten (1)..(5) zählen als idea (task-plan)", () => {
  // Real example from user's screenshot
  assert.equal(classify("multi-user-rollout schrittweise: (1) users-table, (2) project-membership-guard, (3) invite-flow"), "idea");
  // numbered list
  assert.equal(classify("1. erst tdd-tests 2. dann implementation 3. dann doku"), "idea");
});

test("technische task-marker (tabelle, workspace, broadcast) → idea", () => {
  assert.equal(classify("workspace-setup für rust-crates konfigurieren"), "idea");
  assert.equal(classify("presence-broadcast über ws-channel implementieren"), "idea");
});

test("multi-line text → idea", () => {
  assert.equal(classify("erste zeile\nzweite zeile\ndritte zeile"), "idea");
});

test("strenger length-cap (>100 chars → idea, war früher 140)", () => {
  // 101 chars
  const x = "x".repeat(101);
  assert.equal(classify(x), "idea");
});

test("leerer text → idea (sicherer default)", () => {
  assert.equal(classify(""), "idea");
  assert.equal(classify(null), "idea");
});

test("config-aussagen ohne dateipfad bleiben rule", () => {
  assert.equal(classify("tests müssen vor implementation kommen"), "rule");
  assert.equal(classify("animationen müssen prefers-reduced-motion respektieren"), "rule");
});
