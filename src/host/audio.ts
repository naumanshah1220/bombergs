// Procedural WebAudio SFX — no asset files, tiny, and tunable in code.
// Construct after a user gesture (the START click) so the context is allowed.

export class Sfx {
  private ctx: AudioContext;
  private master: GainNode;

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  resume(): void {
    void this.ctx.resume();
  }

  explosion(): void {
    const t = this.ctx.currentTime;
    const noise = this.noiseSource(0.9);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200, t);
    filter.frequency.exponentialRampToValueAtTime(60, t + 0.8);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(1.0, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
    noise.connect(filter).connect(gain).connect(this.master);
    noise.start(t);
    // sub-thump
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(36, t + 0.5);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.9, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.55);
  }

  splash(): void {
    const t = this.ctx.currentTime;
    const noise = this.noiseSource(0.5);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(2600, t + 0.3);
    filter.Q.value = 1.2;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    noise.connect(filter).connect(gain).connect(this.master);
    noise.start(t);
  }

  honk(): void {
    this.tone('square', 220, 0.12, 0.25, 330);
  }

  throwWhoosh(): void {
    const t = this.ctx.currentTime;
    const noise = this.noiseSource(0.35);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(500, t);
    filter.frequency.exponentialRampToValueAtTime(3200, t + 0.3);
    filter.Q.value = 2.5;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    noise.connect(filter).connect(gain).connect(this.master);
    noise.start(t);
  }

  stick(): void {
    this.tone('sine', 180, 0.09, 0.4, 90);
  }

  blink(): void {
    this.tone('triangle', 880, 0.16, 0.22, 1760);
  }

  shield(): void {
    this.tone('triangle', 520, 0.2, 0.2, 260);
  }

  fanfare(): void {
    // stage-win: quick major arpeggio
    [0, 4, 7, 12].forEach((semi, i) => {
      setTimeout(() => this.tone('triangle', 392 * Math.pow(2, semi / 12), 0.22, 0.25), i * 110);
    });
  }

  private tone(type: OscillatorType, freq: number, dur: number, vol: number, glideTo?: number): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseSource(seconds: number): AudioBufferSourceNode {
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }
}
