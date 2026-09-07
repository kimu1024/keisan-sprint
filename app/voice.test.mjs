import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VoiceCapture, parseSpokenNumber } from './voice.ts';

const speechResult = (transcript, isFinal) => ({ isFinal, 0: { transcript } });

test('last spoken number wins', () => {
  for (const [text, number] of [['/ 16', 16], ['12 / 16', 16], ['16 / 12', 12], ['三十六', 36], ['十五 / じゅうろく', 16]]) {
    assert.equal(parseSpokenNumber(text), number);
  }
});

test('one continuous microphone serves consecutive questions', async () => {
  const instances = [];
  class MockRecognition { constructor() { instances.push(this); } start() { this.onstart?.(); } abort() {} }
  globalThis.window = { SpeechRecognition: MockRecognition };
  const capture = new VoiceCapture();
  const first = capture.begin(() => {});
  instances[0].onresult({ resultIndex: 0, results: [speechResult('16', false)] });
  const firstResult = first.finish();
  const second = capture.begin(() => {});
  assert.equal(instances.length, 1);
  instances[0].onresult({ resultIndex: 0, results: [speechResult('16', true)] });
  assert.equal((await firstResult).value, 16);
  instances[0].onresult({ resultIndex: 1, results: [speechResult('16', true), speechResult('8', true)] });
  assert.equal((await second.finish()).value, 8);
  assert.equal(instances.length, 1);
  capture.cancelAll();
});

test('rapid Next presses while the microphone connects do not start another recognizer', () => {
  const instances = [];
  class MockRecognition { constructor() { instances.push(this); } start() {} abort() {} }
  globalThis.window = { SpeechRecognition: MockRecognition };
  const capture = new VoiceCapture();
  capture.begin(() => {}).finish();
  capture.begin(() => {}).finish();
  assert.equal(instances.length, 1);
  capture.cancelAll();
});

test('answers arriving after Next resolve queued questions in order', async () => {
  let recognition;
  class MockRecognition { constructor() { recognition = this; } start() { this.onstart?.(); } abort() {} }
  globalThis.window = { SpeechRecognition: MockRecognition };
  const capture = new VoiceCapture();
  const first = capture.begin(() => {});
  const pendingFirst = first.finish();
  const second = capture.begin(() => {});
  recognition.onresult({ resultIndex: 0, results: [speechResult('7', true)] });
  assert.equal((await pendingFirst).value, 7);
  const pendingSecond = second.finish();
  recognition.onresult({ resultIndex: 1, results: [speechResult('7', true), speechResult('12', true)] });
  assert.equal((await pendingSecond).value, 12);
  capture.cancelAll();
});

test('a batch of final answers is distributed across queued questions', async () => {
  let recognition;
  class MockRecognition { constructor() { recognition = this; } start() { this.onstart?.(); } abort() {} }
  globalThis.window = { SpeechRecognition: MockRecognition };
  const capture = new VoiceCapture();
  const first = capture.begin(() => {});
  const pendingFirst = first.finish();
  const second = capture.begin(() => {});
  const pendingSecond = second.finish();
  recognition.onresult({ resultIndex: 0, results: [speechResult('', true), speechResult('7', true), speechResult('12', true)] });
  assert.equal((await pendingFirst).value, 7);
  assert.equal((await pendingSecond).value, 12);
  capture.cancelAll();
});

test('a nonfatal end restarts recognition without losing the active ticket', async () => {
  const instances = [];
  class MockRecognition { constructor() { instances.push(this); } start() { this.onstart?.(); } abort() {} }
  globalThis.window = { SpeechRecognition: MockRecognition };
  const capture = new VoiceCapture();
  const ticket = capture.begin(() => {});
  instances[0].onend();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(instances.length, 2);
  instances[1].onresult({ resultIndex: 0, results: [speechResult('9', true)] });
  assert.equal((await ticket.finish()).value, 9);
  capture.cancelAll();
});

test('a result survives a later nonfatal recognition error', async () => {
  let recognition;
  class MockRecognition { constructor() { recognition = this; } start() { this.onstart?.(); } abort() {} }
  globalThis.window = { SpeechRecognition: MockRecognition };
  const capture = new VoiceCapture();
  const ticket = capture.begin(() => {});
  recognition.onresult({ resultIndex: 0, results: [speechResult('6', false)] });
  const result = ticket.finish();
  recognition.onerror({ error: 'no-speech' });
  recognition.onresult({ resultIndex: 0, results: [speechResult('6', true)] });
  assert.equal((await result).value, 6);
  capture.cancelAll();
});
