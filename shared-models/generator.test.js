'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseType, renderDart, renderJs } = require('./generator');

test('parseType erkennt primitive + nullable', () => {
  assert.deepEqual(parseType('string'), { kind: 'prim', name: 'string', nullable: false });
  assert.deepEqual(parseType('int?'), { kind: 'prim', name: 'int', nullable: true });
  assert.deepEqual(parseType('bool'), { kind: 'prim', name: 'bool', nullable: false });
});

test('parseType erkennt list<T>', () => {
  const t = parseType('list<string>');
  assert.equal(t.kind, 'list');
  assert.equal(t.nullable, false);
  assert.deepEqual(t.inner, { kind: 'prim', name: 'string', nullable: false });
});

test('parseType erkennt map<string,int>', () => {
  const t = parseType('map<string,int>');
  assert.equal(t.kind, 'map');
  assert.deepEqual(t.value, { kind: 'prim', name: 'int', nullable: false });
});

test('renderDart erzeugt klasse mit fromJson/toJson', () => {
  const out = renderDart('Task', {
    id: 'string',
    done: 'bool',
    tags: 'list<string>',
    ownerUserId: 'string?',
  });
  assert.match(out, /class Task /);
  assert.match(out, /final String id;/);
  assert.match(out, /final bool done;/);
  assert.match(out, /final List<String> tags;/);
  assert.match(out, /final String\? ownerUserId;/);
  assert.match(out, /factory Task\.fromJson/);
  assert.match(out, /Map<String, dynamic> toJson/);
});

test('renderJs erzeugt validator + factory', () => {
  const out = renderJs('Task', {
    id: 'string',
    done: 'bool',
    tags: 'list<string>',
  });
  assert.match(out, /function makeTask/);
  assert.match(out, /function isTask/);
  assert.match(out, /module\.exports/);
});

test('renderDart enthält keinen flutter-import', () => {
  const out = renderDart('Idea', { id: 'string', text: 'string' });
  assert.doesNotMatch(out, /package:flutter/);
});
