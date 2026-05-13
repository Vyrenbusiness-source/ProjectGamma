// Regression-Test (2026-05-14): ADD_PROJECT muss IDs für pre-populated
// tasks/rules/ideas generieren. Vorher (TeamLink-bug): items im payload
// behielten id=undefined → cc-pipeline triggert mit taskId=undefined →
// fallback-prompt → cc gibt nur einen plan ab.
//
// Wir replizieren die mutation-logik lokal (ohne den ganzen server.js zu
// laden) — bei einer code-änderung muss das snippet hier nachgezogen werden.

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

function genId() { return Math.random().toString(36).slice(2, 18); }

// Snippet aus server.js ADD_PROJECT (siehe MUT.ADD_PROJECT).
function addProject(s, { project }) {
  if (!project.id) project.id = genId();
  project.tasks = project.tasks || [];
  project.rules = project.rules || [];
  project.ideas = project.ideas || [];
  for (const item of project.tasks) if (!item.id) item.id = genId();
  for (const item of project.rules) if (!item.id) item.id = genId();
  for (const item of project.ideas) if (!item.id) item.id = genId();
  s.projects.push(project);
}

test("ADD_PROJECT generiert IDs für pre-populated tasks", () => {
  const s = { projects: [] };
  addProject(s, { project: {
    name: "Test", path: "C:/x",
    tasks: [
      { title: "Task A", group: "next" },
      { title: "Task B", group: "in_progress" },
    ],
  }});
  const p = s.projects[0];
  assert.ok(p.tasks[0].id, "task A muss id haben");
  assert.ok(p.tasks[1].id, "task B muss id haben");
  assert.notEqual(p.tasks[0].id, p.tasks[1].id, "ids müssen unterschiedlich sein");
});

test("ADD_PROJECT generiert IDs für pre-populated rules + ideas", () => {
  const s = { projects: [] };
  addProject(s, { project: {
    name: "Test",
    rules: [{ text: "Rule 1", active: true }],
    ideas: [{ text: "Idea 1", status: "unprocessed" }],
  }});
  const p = s.projects[0];
  assert.ok(p.rules[0].id, "rule muss id haben");
  assert.ok(p.ideas[0].id, "idea muss id haben");
});

test("ADD_PROJECT lässt bestehende IDs unverändert (idempotent)", () => {
  const s = { projects: [] };
  addProject(s, { project: {
    name: "Test",
    tasks: [
      { id: "existing-id", title: "Has ID" },
      { title: "No ID" },
    ],
  }});
  const p = s.projects[0];
  assert.equal(p.tasks[0].id, "existing-id");
  assert.ok(p.tasks[1].id);
  assert.notEqual(p.tasks[1].id, "existing-id");
});

test("ADD_PROJECT mit leeren arrays bricht nicht", () => {
  const s = { projects: [] };
  addProject(s, { project: { name: "Empty" } });
  const p = s.projects[0];
  assert.deepEqual(p.tasks, []);
  assert.deepEqual(p.rules, []);
  assert.deepEqual(p.ideas, []);
});
