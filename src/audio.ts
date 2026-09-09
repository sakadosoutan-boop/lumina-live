export class AudioEngine {
  context: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  element: HTMLAudioElement | null = null;
  stream: MediaStream | null = null;
  private source: AudioNode | null = null;
  private samples: Uint8Array<ArrayBuffer> = new Uint8Array(512);
  async init() {
    this.context ??= new AudioContext();
    if (this.context.state !== "running") await this.context.resume();
    this.analyser ??= this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.78;
    return this.context;
  }
  async load(url: string) {
    await this.init();
    this.stopInput();
    const el = new Audio(url);
    el.preload = "auto";
    this.element = el;
    this.source = this.context!.createMediaElementSource(el);
    this.source.connect(this.analyser!);
    this.analyser!.connect(this.context!.destination);
    return el;
  }
  async microphone() {
    await this.init();
    this.stopInput();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    this.source = this.context!.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser!);
  }
  levels() {
    if (!this.analyser) return { low: 0, mid: 0, high: 0, level: 0 };
    this.analyser.getByteFrequencyData(this.samples);
    const rate = this.context!.sampleRate / 1024;
    const avg = (from: number, to: number) => {
      const a = Math.max(0, Math.floor(from / rate)),
        b = Math.min(this.samples.length, Math.ceil(to / rate));
      let s = 0;
      for (let i = a; i < b; i++) s += this.samples[i];
      return s / Math.max(1, b - a) / 255;
    };
    return {
      low: avg(40, 250),
      mid: avg(250, 2500),
      high: avg(2500, 14000),
      level: avg(40, 14000),
    };
  }
  stopInput() {
    this.element?.pause();
    if (this.element) {
      const sourceUrl = this.element.src;
      this.element.removeAttribute("src");
      this.element.load();
      if (sourceUrl.startsWith("blob:")) URL.revokeObjectURL(sourceUrl);
    }
    this.element = null;
    this.source?.disconnect();
    this.source = null;
    this.analyser?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
  dispose() {
    this.stopInput();
    void this.context?.close();
  }
}
export class MidiInput {
  access: MIDIAccess | null = null;
  onAction: (action: string, value: number) => void = () => {};
  private ticks: number[] = [];
  async connect() {
    if (!navigator.requestMIDIAccess)
      throw new Error("このブラウザーはMIDI入力に対応していません");
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    const bind = () =>
      this.access?.inputs.forEach((input) => {
        input.onmidimessage = (e) => this.message(e);
      });
    bind();
    this.access.onstatechange = bind;
    return this.access.inputs.size;
  }
  message(e: MIDIMessageEvent) {
    const d = e.data;
    if (!d) return;
    const status = d[0],
      kind = status & 0xf0;
    if (status === 0xf8) {
      this.ticks.push(e.timeStamp);
      if (this.ticks.length > 49) this.ticks.shift();
      if (this.ticks.length >= 25) {
        const delta = this.ticks.at(-1)! - this.ticks[0];
        const bpm = (60000 * (this.ticks.length - 1)) / (delta * 24);
        if (bpm >= 20 && bpm <= 400) this.onAction("clock", bpm);
      }
      return;
    }
    if (status === 0xfa) {
      this.ticks = [];
      this.onAction("start", 1);
    }
    if (status === 0xfb) this.onAction("continue", 1);
    if (status === 0xfc) this.onAction("stop", 1);
    if (kind === 0x90 && d[2] > 0) {
      const names: Record<number, string> = {
        36: "next",
        37: "prev",
        38: "tap",
        39: "blackout",
        40: "play",
        41: "auto",
        42: "freeze",
      };
      if (names[d[1]]) this.onAction(names[d[1]], d[2] / 127);
      if (d[1] >= 48 && d[1] <= 55) this.onAction("clip", d[1] - 48);
    }
    if (kind === 0xb0) {
      if (d[1] === 1) this.onAction("crossfade", d[2] / 127);
      if (d[1] === 7) this.onAction("master", d[2] / 127);
    }
  }
  dispose() {
    this.access?.inputs.forEach((i) => (i.onmidimessage = null));
    if (this.access) this.access.onstatechange = null;
  }
}
