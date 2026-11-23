export class AnimationLoop {
  private frame: number | null = null;

  start(onFrame: FrameRequestCallback) {
    this.stop();
    const tick: FrameRequestCallback = (now) => {
      const frame = this.frame;
      onFrame(now);
      if (this.frame === frame) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }
}
