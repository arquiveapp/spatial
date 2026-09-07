export function stats(values) {
  if (!values.length) return { count: 0, mean: null, p50: null, p95: null, stddev: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    count: values.length,
    mean,
    p50: sorted[Math.floor((sorted.length - 1) * 0.5)],
    p95: sorted[Math.floor((sorted.length - 1) * 0.95)],
    stddev: Math.sqrt(values.reduce((s, x) => s + (x - mean) ** 2, 0) / values.length),
  };
}
export class Metrics {
  constructor() {
    this.reset();
  }
  reset() {
    this.started = performance.now();
    this.frames = 0;
    this.dropped = 0;
    this.bursts = 0;
    this.dropping = false;
    this.workerMs = [];
    this.deliveryMs = [];
    this.motionIntervals = [];
    this.lastMotion = null;
    this.motionSamples = 0;
    this.gyroSamples = 0;
    this.captureTimeSamples = 0;
    this.trace = [];
  }
  drop() {
    this.dropped++;
    if (!this.dropping) this.bursts++;
    this.dropping = true;
  }
  frame(ms, delivery) {
    this.frames++;
    this.dropping = false;
    if (this.workerMs.length < 36000) {
      this.workerMs.push(ms);
      this.deliveryMs.push(delivery);
    }
  }
  motion(now, hasGyro) {
    this.motionSamples++;
    if (hasGyro) this.gyroSamples++;
    if (this.lastMotion !== null && this.motionIntervals.length < 36000)
      this.motionIntervals.push(now - this.lastMotion);
    this.lastMotion = now;
  }
  snapshot() {
    const seconds = (performance.now() - this.started) / 1000;
    return {
      seconds,
      frames: this.frames,
      fps: seconds > 0 ? this.frames / seconds : 0,
      droppedFrames: this.dropped,
      droppedBursts: this.bursts,
      burstsPer10s: seconds > 0 ? (this.bursts * 10) / seconds : 0,
      workerMs: stats(this.workerMs),
      deliveryMs: stats(this.deliveryMs),
      imuIntervalsMs: stats(this.motionIntervals),
      imuHz: seconds > 0 ? this.motionSamples / seconds : 0,
      gyroSamples: this.gyroSamples,
      captureTimeSamples: this.captureTimeSamples,
      trace: this.trace,
    };
  }
}
