export function resample16k(input, rate) {
  if (rate === 16000) return input.slice();
  const ratio = rate / 16000, output = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < output.length; i++) {
    const start = i * ratio, end = (i + 1) * ratio;
    let total = 0;
    for (let j = Math.floor(start); j < Math.ceil(end); j++) total += input[j] * (Math.min(j + 1, end) - Math.max(j, start));
    output[i] = total / ratio;
  }
  return output;
}

/** Silence segmentation with pre-roll, minimum speech duration and bounded chunks. */
export class SpeechSegments {
  constructor(rate, emit) { this.rate = rate; this.emit = emit; this.reset(); this.pre = []; }
  reset() { this.parts = []; this.length = 0; this.voice = 0; this.silence = 0; }
  push(samples, threshold = 0.012) {
    const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
    const speaking = rms > threshold;
    if (!this.parts.length && !speaking) {
      this.pre.push(samples); while (this.pre.length * samples.length > this.rate * 0.3) this.pre.shift(); return;
    }
    if (!this.parts.length) { this.parts = this.pre; this.pre = []; this.length = this.parts.reduce((n, p) => n + p.length, 0); }
    this.parts.push(samples); this.length += samples.length;
    if (speaking) { this.voice += samples.length; this.silence = 0; } else this.silence += samples.length;
    if (this.silence >= this.rate * 0.9 || this.length >= this.rate * 12) this.flush();
  }
  flush() {
    if (this.voice >= this.rate * 0.25) {
      const joined = new Float32Array(this.length); let offset = 0;
      for (const part of this.parts) { joined.set(part, offset); offset += part.length; }
      this.emit(resample16k(joined, this.rate));
    }
    this.reset();
  }
}
