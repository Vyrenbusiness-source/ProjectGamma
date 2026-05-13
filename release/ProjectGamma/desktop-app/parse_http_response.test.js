'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseHttpResponse } = require('./parse_http_response');

test('leerer body + ok → {}', () => {
  assert.deepEqual(parseHttpResponse({ text: '', status: 200, ok: true }), {});
});

test('leerer body + !ok → wirft mit status', () => {
  try { parseHttpResponse({ text: '', status: 500, ok: false }); assert.fail('sollte werfen'); }
  catch (e) {
    assert.equal(e.status, 500);
    assert.match(e.message, /http 500/);
  }
});

test('valides JSON + ok → parsed object', () => {
  const out = parseHttpResponse({ text: '{"hello":"world"}', status: 200, ok: true });
  assert.deepEqual(out, { hello: 'world' });
});

test('valides JSON-error + !ok → wirft mit data.error als message', () => {
  try {
    parseHttpResponse({ text: '{"error":"token-expired"}', status: 401, ok: false });
    assert.fail('sollte werfen');
  } catch (e) {
    assert.equal(e.status, 401);
    assert.equal(e.message, 'token-expired');
    assert.deepEqual(e.data, { error: 'token-expired' });
  }
});

test('malformed JSON + ok → wirft klaren parse-fehler statt {raw} zu returnen', () => {
  try {
    parseHttpResponse({ text: '<html>proxy error</html>', status: 200, ok: true });
    assert.fail('sollte werfen');
  } catch (e) {
    assert.equal(e.status, 200);
    assert.equal(e.raw, '<html>proxy error</html>');
    assert.ok(e.parseError instanceof Error, 'parseError beigelegt');
    assert.match(e.message, /kein JSON/i);
    assert.match(e.message, /<html>proxy error<\/html>/);
  }
});

test('malformed JSON + !ok → wirft mit parse-context, nicht stiller "http 502"', () => {
  try {
    parseHttpResponse({ text: 'Bad Gateway', status: 502, ok: false });
    assert.fail('sollte werfen');
  } catch (e) {
    assert.equal(e.status, 502);
    assert.equal(e.raw, 'Bad Gateway');
    assert.match(e.message, /http 502/);
    assert.match(e.message, /Bad Gateway/);
  }
});

test('langer malformed body wird auf 200 chars + ellipsis gekürzt', () => {
  const body = 'x'.repeat(500);
  try { parseHttpResponse({ text: body, status: 200, ok: true }); assert.fail('sollte werfen'); }
  catch (e) {
    assert.equal(e.raw, body); // raw bleibt komplett
    assert.ok(e.message.length < 400, 'message snippet gekürzt, war ' + e.message.length);
    assert.match(e.message, /…/);
  }
});

test('json-array body wird durchgereicht (kein object-zwang)', () => {
  const out = parseHttpResponse({ text: '[1,2,3]', status: 200, ok: true });
  assert.deepEqual(out, [1, 2, 3]);
});
