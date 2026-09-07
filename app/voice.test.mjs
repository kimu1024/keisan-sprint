import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VoiceCapture, parseSpokenNumber } from './voice.ts';

test('spoken numbers accept complete Japanese numbers without guessing', () => {
  for (const [text, number] of [['３６', 36], ['三十六', 36], ['さんじゅうろく', 36], ['キュウ', 9], ['18です。', 18], ['零', 0]]) {
    assert.equal(parseSpokenNumber(text), number);
  }
  for (const text of ['', '3か4', '答えは3かな', '2 3です', 'マイナス1']) {
    assert.equal(parseSpokenNumber(text), null);
  }
});

test('late results remain attached to sealed question and microphone is serialized', async () => {
  const instances = [];
  class MockRecognition {
    start() { this.onstart?.(); }
    stop() { this.stopped = true; }
    abort() { this.onend?.(); }
    constructor() { instances.push(this); }
    result(text) { this.onresult({ results: [{ isFinal: true, 0: { transcript: text } }] }); }
    end() { this.onend(); }
  }
  globalThis.window = { SpeechRecognition: MockRecognition };
  const capture = new VoiceCapture();
  const first = capture.begin(() => {});
  await Promise.resolve();
  const firstResult = first.finish();
  const second = capture.begin(() => {});
  await Promise.resolve();
  assert.equal(instances.length, 1);
  instances[0].result('三十六');
  instances[0].end();
  assert.equal((await firstResult).value, 36);
  await Promise.resolve();
  assert.equal(instances.length, 2);
  const secondResult = second.finish();
  instances[1].result('8'); instances[1].end();
  assert.equal((await secondResult).value, 8);
  capture.cancelAll();
});

test('skipping a queued microphone produces unrecognized, never steals preceding audio', async () => {
  let recognition;
  class MockRecognition {
    constructor() { recognition = this; }
    start() {} stop() {} abort() { this.onend?.(); }
  }
  globalThis.window = { SpeechRecognition: MockRecognition };
  const capture = new VoiceCapture();
  const first = capture.begin(() => {});
  await Promise.resolve();
  const pending = first.finish();
  const second = capture.begin(() => {});
  assert.equal((await second.finish()).value, null);
  recognition.onresult({ results: [{ isFinal: true, 0: { transcript: '9' } }] });
  recognition.onend();
  assert.equal((await pending).value, 9);
  capture.cancelAll();
});

test('cancelled keypad override ignores a late voice callback', async () => {
  let recognition;
  class MockRecognition {
    constructor() { recognition = this; }
    start() {} stop() {} abort() {}
  }
  globalThis.window = { SpeechRecognition: MockRecognition };
  const capture = new VoiceCapture();
  const ticket = capture.begin(() => {});
  await Promise.resolve();
  ticket.cancel();
  recognition.onresult({ results: [{ isFinal: true, 0: { transcript: '7' } }] });
  assert.equal((await ticket.finish()).value, null);
});
