import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeechSegments, resample16k } from '../scripts/vn-audio.mjs';
test('48k and 44.1k audio is resampled to 16k with constant amplitude preserved', () => {
  for (const rate of [48000, 44100, 16000]) {
    const result = resample16k(new Float32Array(rate).fill(0.25), rate);
    assert.equal(result.length, 16000);
    assert.ok(result.every(n => Math.abs(n - 0.25) < 0.00001));
  }
});
test('silence never emits; utterance emits after pause with pre-roll; short noise rejected', () => {
  const chunks = [], s = new SpeechSegments(16000, audio => chunks.push(audio));
  const silent = new Float32Array(1600), voice = new Float32Array(1600).fill(0.1);
  for (let i = 0; i < 20; i++) s.push(silent);
  assert.equal(chunks.length, 0);
  s.push(voice); for (let i = 0; i < 10; i++) s.push(silent);
  assert.equal(chunks.length, 0);
  for (let i = 0; i < 5; i++) s.push(voice);
  for (let i = 0; i < 10; i++) s.push(silent);
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].length > 16000);
});
test('long speech splits into bounded chunks', () => {
  const chunks = [], s = new SpeechSegments(16000, audio => chunks.push(audio));
  for (let i = 0; i < 250; i++) s.push(new Float32Array(1600).fill(0.1));
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every(c => c.length <= 12 * 16000));
});
