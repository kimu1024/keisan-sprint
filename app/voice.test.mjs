import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VoiceCapture, parseSpokenNumber } from './voice.ts';

const speechResult = (transcript, isFinal = true) => ({ isFinal, 0: { transcript } });

test('last spoken number wins inside one question', () => {
  for (const [text, number] of [['/ 16', 16], ['12 / 16', 16], ['16 / 12', 12], ['三十六', 36], ['十五 / じゅうろく', 16]]) {
    assert.equal(parseSpokenNumber(text), number);
  }
});

test('each question uses a separate microphone and never concatenates answers', async () => {
  const instances = [];
  class MockRecognition {
    constructor() { instances.push(this); }
    start() { this.onstart?.(); }
    stop() { this.stopped = true; }
    abort() { this.onend?.(); }
    result(transcript) { this.onresult({ results: [speechResult(transcript)] }); }
    end() { this.onend(); }
  }
  globalThis.window = { SpeechRecognition: MockRecognition };
  const capture = new VoiceCapture();
  const first = capture.begin(() => {});
  await Promise.resolve();
  const firstResult = first.finish();
  const second = capture.begin(() => {});
  assert.equal(instances.length, 1);
  instances[0].result('13');
  instances[0].end();
  assert.equal((await firstResult).value, 13);
  await Promise.resolve();
  assert.equal(instances.length, 2);
  instances[1].result('10');
  const secondResult = second.finish();
  instances[1].end();
  assert.equal((await secondResult).value, 10);
  assert.equal((await secondResult).transcript, '10');
  capture.cancelAll();
});

test('a result arriving after Next remains attached to the old question', async () => {
  let firstRecognition;
  class MockRecognition {
    constructor() { firstRecognition ??= this; }
    start() { this.onstart?.(); }
    stop() {}
    abort() { this.onend?.(); }
  }
  globalThis.window = { SpeechRecognition: MockRecognition };
  const capture = new VoiceCapture();
  const first = capture.begin(() => {});
  await Promise.resolve();
  const pending = first.finish();
  capture.begin(() => {});
  firstRecognition.onresult({ results: [speechResult('13')] });
  firstRecognition.onend();
  assert.equal((await pending).value, 13);
  capture.cancelAll();
});

test('pressing Next while a microphone is queued becomes unrecognized without stealing audio', async () => {
  const instances = [];
  class MockRecognition {
    constructor() { instances.push(this); }
    start() { this.onstart?.(); }
    stop() {}
    abort() { this.onend?.(); }
  }
  globalThis.window = { SpeechRecognition: MockRecognition };
  const capture = new VoiceCapture();
  const first = capture.begin(() => {});
  await Promise.resolve();
  first.finish();
  const queued = capture.begin(() => {});
  const queuedResult = queued.finish();
  instances[0].onend();
  assert.equal((await queuedResult).value, null);
  await Promise.resolve();
  assert.equal(instances.length, 1);
  capture.cancelAll();
});

test('a recognized number survives a later stop error', async () => {
  let recognition;
  class MockRecognition {
    constructor() { recognition = this; }
    start() { this.onstart?.(); }
    stop() {}
    abort() { this.onend?.(); }
  }
  globalThis.window = { SpeechRecognition: MockRecognition };
  const capture = new VoiceCapture();
  const ticket = capture.begin(() => {});
  await Promise.resolve();
  recognition.onresult({ results: [speechResult('16')] });
  const result = ticket.finish();
  recognition.onerror({ error: 'no-speech' });
  recognition.onend();
  assert.equal((await result).value, 16);
  capture.cancelAll();
});
