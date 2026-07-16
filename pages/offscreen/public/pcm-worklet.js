/* global AudioWorkletProcessor, registerProcessor */

class OpenLingoPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(3200);
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, channel[i]));
      this.buffer[this.offset] = sample < 0 ? sample * 32768 : sample * 32767;
      this.offset += 1;
      if (this.offset >= this.buffer.length) {
        const chunk = this.buffer.buffer;
        this.port.postMessage(chunk, [chunk]);
        this.buffer = new Int16Array(3200);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('openlingo-pcm-processor', OpenLingoPcmProcessor);
