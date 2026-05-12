/**
 * TDD · heuristische KI-Suggestion fuer "Idee -> Aufgabe" auf dem Desktop.
 * Spiegelt mobile-app/.../ai_suggest_task.dart (snake_case-modul, pure JS).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { aiSuggestTask } = require('./ai_suggest_task.js');

test('leere oder whitespace-eingabe -> null', () => {
  assert.equal(aiSuggestTask(''), null);
  assert.equal(aiSuggestTask('   '), null);
});

test('einfacher text -> title getrimmt + erstes zeichen gross', () => {
  const s = aiSuggestTask('einkaufen morgen');
  assert.equal(s.title, 'Einkaufen morgen');
  assert.equal(s.meta, 'aus idee');
  assert.equal(s.priority, 3);
});

test('hoch-keyword -> priority 4 + meta "hoch"', () => {
  const s = aiSuggestTask('DRINGEND backup machen');
  assert.equal(s.priority, 4);
  assert.match(s.meta, /hoch/i);
  assert.ok(!/^dringend/i.test(s.title));
});

test('niedrig-keyword -> priority 2', () => {
  const s = aiSuggestTask('vielleicht mal die docs lesen');
  assert.equal(s.priority, 2);
  assert.match(s.meta, /niedrig/i);
});

test('langer text wird auf 80 zeichen gekuerzt', () => {
  const s = aiSuggestTask('a'.repeat(200));
  assert.ok(s.title.length <= 80);
});
