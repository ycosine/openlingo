/* global AudioWorkletProcessor, registerProcessor, sampleRate */

const TARGET_RATE = 16000;

/** Downsamples the context-rate input to 16 kHz PCM16 with linear
 *  interpolation, so the AudioContext can run at the device's native rate. */
class OpenLingoPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.buffer = new Int16Array(3200);
    this.offset = 0;
    // Fractional read position into [prevSample, ...currentBlock].
    this.pos = 0;
    this.prevSample = 0;
  }

  pushSample(sample) {
    const clamped = Math.max(-1, Math.min(1, sample));
    this.buffer[this.offset] = clamped < 0 ? clamped * 32768 : clamped * 32767;
    this.offset += 1;
    if (this.offset >= this.buffer.length) {
      const chunk = this.buffer.buffer;
      this.port.postMessage(chunk, [chunk]);
      this.buffer = new Int16Array(3200);
      this.offset = 0;
    }
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    let pos = this.pos;
    while (pos < channel.length) {
      const index = Math.floor(pos);
      const frac = pos - index;
      const before = index === 0 ? this.prevSample : channel[index - 1];
      const after = channel[index];
      this.pushSample(before + (after - before) * frac);
      pos += this.ratio;
    }
    this.pos = pos - channel.length;
    this.prevSample = channel[channel.length - 1];
    return true;
  }
}

registerProcessor('openlingo-pcm-processor', OpenLingoPcmProcessor);
