// Downsamples microphone audio to 16 kHz mono int16 and posts ~64 ms chunks to the main thread.
class MicProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 16000; this.pos = 0; this.out = []; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        const v = Math.max(-1, Math.min(1, ch[i]));
        this.out.push(v < 0 ? v * 32768 : v * 32767);
      }
    }
    if (this.out.length >= 1024) {
      const buf = Int16Array.from(this.out).buffer;
      this.port.postMessage(buf, [buf]);
      this.out = [];
    }
    return true;
  }
}
registerProcessor('mic-processor', MicProcessor);
