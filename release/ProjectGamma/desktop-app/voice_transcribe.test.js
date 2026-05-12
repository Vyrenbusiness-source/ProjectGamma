'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vt = require('./voice_transcribe');

test('normalizeTranscript trimmt + kollabiert whitespace', () => {
  assert.equal(vt.normalizeTranscript('  hallo   welt  '), 'hallo welt');
  assert.equal(vt.normalizeTranscript('\n\tidee\n'), 'idee');
  assert.equal(vt.normalizeTranscript(''), '');
  assert.equal(vt.normalizeTranscript(null), '');
  assert.equal(vt.normalizeTranscript(undefined), '');
});

test('normalizeTranscript schneidet auf MAX_LEN', () => {
  const long = 'x'.repeat(vt._MAX_LEN + 50);
  assert.equal(vt.normalizeTranscript(long).length, vt._MAX_LEN);
});

test('mergeDraft hängt transkript an bestehenden draft', () => {
  assert.equal(vt.mergeDraft('hallo', 'welt'), 'hallo welt');
  assert.equal(vt.mergeDraft('', 'welt'), 'welt');
  assert.equal(vt.mergeDraft('  ', 'welt'), 'welt');
  assert.equal(vt.mergeDraft('hallo', ''), 'hallo');
  assert.equal(vt.mergeDraft(null, 'welt'), 'welt');
  assert.equal(vt.mergeDraft('hallo', '  '), 'hallo');
});

test('isVoiceSupported false ohne SpeechRecognition', () => {
  assert.equal(vt.isVoiceSupported({}), false);
});

test('isVoiceSupported true mit Stub-Ctor', () => {
  const g = { SpeechRecognition: function () {} };
  assert.equal(vt.isVoiceSupported(g), true);
});

test('createRecognizer null ohne Browser-API', () => {
  assert.equal(vt.createRecognizer({ globalObj: {} }), null);
});

test('createRecognizer ruft onFinal/onPartial mit normalisiertem text', () => {
  let started = false;
  function FakeRec() {}
  FakeRec.prototype.start = function () { started = true; };
  FakeRec.prototype.stop = function () {};
  const g = { SpeechRecognition: FakeRec };
  const finals = []; const partials = [];
  const r = vt.createRecognizer({
    globalObj: g,
    onFinal: (t) => finals.push(t),
    onPartial: (t) => partials.push(t),
  });
  assert.ok(r);
  assert.equal(r.start(), true);
  assert.equal(started, true);

  // Simuliere onresult-event direkt am letzten erzeugten Recognizer.
  // Wir greifen auf den intern erzeugten Recognizer per Prototyp nicht
  // mehr zu; stattdessen rufen wir start ein zweites mal mit
  // sichtbaren Callbacks, indem wir createRecognizer neu erzeugen und
  // den onresult-handler manuell triggern.
  const captured = [];
  function CapRec() { captured.push(this); }
  CapRec.prototype.start = function () {};
  CapRec.prototype.stop = function () {};
  const finals2 = []; const partials2 = [];
  vt.createRecognizer({
    globalObj: { SpeechRecognition: CapRec },
    onFinal: (t) => finals2.push(t),
    onPartial: (t) => partials2.push(t),
  });
  const rec = captured[0];
  rec.onresult({
    resultIndex: 0,
    results: [
      { isFinal: true,  0: { transcript: '  neue   idee  ' } },
      { isFinal: false, 0: { transcript: ' wird gerade ' } },
    ],
  });
  assert.deepEqual(finals2, ['neue idee']);
  assert.deepEqual(partials2, ['wird gerade']);
});
