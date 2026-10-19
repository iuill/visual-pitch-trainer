// Bounded microphone transport. No playback, recording, or network access.
class LiveCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(4096);
    this.used = 0;
    this.startFrame = 0;
  }
  process(inputs, outputs) {
    for (const channel of outputs[0] || []) channel.fill(0);
    const channels = inputs[0];
    if (!channels?.[0]) return true;
    for (let i = 0; i < channels[0].length; i++) {
      if (this.used === 0) this.startFrame = currentFrame + i;
      let value = 0;
      for (const channel of channels) value += channel[i] / channels.length;
      this.buffer[this.used++] = value;
      if (this.used === this.buffer.length) {
        this.port.postMessage(
          {
            samples: this.buffer,
            endTime: (this.startFrame + this.used) / sampleRate,
          },
          [this.buffer.buffer],
        );
        this.buffer = new Float32Array(4096);
        this.used = 0;
      }
    }
    return true;
  }
}
registerProcessor("live-capture", LiveCapture);
