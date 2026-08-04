// Sound engine for TETRA.
//
// Every sound has a Web Audio synth fallback, so the game is audible with zero
// assets. If the user drops files into `public/sounds/` (lock.mp3, clear.mp3,
// music.mp3 — .wav/.ogg also checked), those are used instead automatically.

type SfxName = "lock" | "clear" | "record" | "music";

const FILE_SOURCES: Record<SfxName, string[]> = {
  lock: ["/sounds/lock.mp3", "/sounds/lock.wav"],
  clear: ["/sounds/clear.mp3", "/sounds/clear.wav"],
  record: ["/sounds/record.mp3", "/sounds/record.wav"],
  music: ["/sounds/music.mp3", "/sounds/music.ogg"],
};

// Lo-fi progression: Am7 → Fmaj7 → Cmaj7 → G7 (voices as Hz)
const CHORDS: number[][] = [
  [110.0, 196.0, 261.63, 329.63],
  [87.31, 174.61, 220.0, 261.63],
  [130.81, 196.0, 246.94, 329.63],
  [98.0, 174.61, 246.94, 293.66],
];
const CHORD_DUR = 3.8;

// A-minor pentatonic for the sparse pluck melody
const PLUCKS = [440.0, 523.25, 587.33, 659.26, 783.99, 880.0];

// Bus levels at full volume; the settings sliders scale these.
const SFX_BASE = 0.55;
const MUSIC_BASE = 0.14;

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  sfx: GainNode;
  music: GainNode;
  echoSend: GainNode;
  noise: AudioBuffer;
}

function buildNoise(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

class SoundEngine {
  private graph: Graph | null = null;
  private files: Partial<Record<SfxName, AudioBuffer>> = {};
  private filesRequested = false;
  private muted = false;
  private sfxVolume = 1;
  private musicVolume = 1;
  private musicOn = false;
  private chordIdx = 0;
  private musicTimer: ReturnType<typeof setTimeout> | null = null;
  private musicStopTimer: ReturnType<typeof setTimeout> | null = null;
  private musicFileNode: AudioBufferSourceNode | null = null;

  private ensure(): Graph | null {
    if (typeof window === "undefined") return null;
    if (!this.graph) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;

      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.9;
      master.connect(ctx.destination);

      const sfx = ctx.createGain();
      sfx.gain.value = SFX_BASE * this.sfxVolume;
      sfx.connect(master);

      const music = ctx.createGain();
      music.gain.value = 0;
      music.connect(master);

      // Simple feedback echo, used as a send for the plucks
      const echoSend = ctx.createGain();
      echoSend.gain.value = 0.5;
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.29;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.32;
      const wet = ctx.createGain();
      wet.gain.value = 0.3;
      echoSend.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(wet);
      wet.connect(music);

      this.graph = { ctx, master, sfx, music, echoSend, noise: buildNoise(ctx) };

      // Browsers may keep a fresh context suspended until a user gesture.
      const unlock = () => {
        void ctx.resume();
      };
      window.addEventListener("pointerdown", unlock);
      window.addEventListener("keydown", unlock);

      void this.loadFiles(ctx);
    }
    if (this.graph.ctx.state === "suspended") void this.graph.ctx.resume();
    return this.graph;
  }

  private async loadFiles(ctx: AudioContext) {
    if (this.filesRequested) return;
    this.filesRequested = true;
    await Promise.all(
      (Object.keys(FILE_SOURCES) as SfxName[]).map(async (name) => {
        for (const url of FILE_SOURCES[name]) {
          try {
            const res = await fetch(url);
            if (!res.ok) continue;
            const bytes = await res.arrayBuffer();
            this.files[name] = await ctx.decodeAudioData(bytes);
            break;
          } catch {
            // not present / not decodable — try next source or fall back to synth
          }
        }
      })
    );
    // If a music file appeared while the synth loop was already playing, swap over.
    if (this.files.music && this.musicOn && this.graph) {
      this.clearMusicTimers();
      this.startMusicSource(this.graph);
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.graph) {
      this.graph.master.gain.setTargetAtTime(
        muted ? 0 : 0.9,
        this.graph.ctx.currentTime,
        0.02
      );
    }
  }

  // Volume setters never call ensure(): an AudioContext must not be created
  // before a user gesture, and settings can change while the game is idle.
  setSfxVolume(volume: number) {
    this.sfxVolume = Math.min(1, Math.max(0, volume));
    if (this.graph) {
      this.graph.sfx.gain.setTargetAtTime(
        SFX_BASE * this.sfxVolume,
        this.graph.ctx.currentTime,
        0.02
      );
    }
  }

  setMusicVolume(volume: number) {
    this.musicVolume = Math.min(1, Math.max(0, volume));
    if (this.graph && this.musicOn) {
      this.graph.music.gain.setTargetAtTime(
        MUSIC_BASE * this.musicVolume,
        this.graph.ctx.currentTime,
        0.15
      );
    }
  }

  // ——— SFX ———

  playLock() {
    const g = this.ensure();
    if (!g) return;
    if (this.files.lock) return this.playBuffer(g, this.files.lock, 0.9);
    this.synthKnock(g);
  }

  playClear(lines: number) {
    const g = this.ensure();
    if (!g) return;
    if (this.files.clear) return this.playBuffer(g, this.files.clear, 1);
    this.synthFire(g, lines);
  }

  // Deliberately quiet: this fires often and must never nag.
  playHold() {
    const g = this.ensure();
    if (!g) return;
    const t = g.ctx.currentTime;
    [740, 988].forEach((freq, i) => {
      const start = t + i * 0.045;
      const osc = g.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const env = g.ctx.createGain();
      env.gain.setValueAtTime(0.0001, start);
      env.gain.linearRampToValueAtTime(0.06, start + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);
      osc.connect(env).connect(g.sfx);
      osc.start(start);
      osc.stop(start + 0.15);
    });
  }

  // Celebration fanfare: rising pentatonic run + soft closing chord
  playRecord() {
    const g = this.ensure();
    if (!g) return;
    if (this.files.record) return this.playBuffer(g, this.files.record, 1);
    const t = g.ctx.currentTime;
    const run = [523.25, 659.26, 783.99, 1046.5, 1318.51];
    run.forEach((freq, i) => {
      const start = t + i * 0.09;
      const osc = g.ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const env = g.ctx.createGain();
      env.gain.setValueAtTime(0.0001, start);
      env.gain.linearRampToValueAtTime(0.17, start + 0.015);
      env.gain.exponentialRampToValueAtTime(0.0001, start + 0.7);
      osc.connect(env).connect(g.sfx);
      osc.start(start);
      osc.stop(start + 0.75);
    });
    const chordAt = t + run.length * 0.09 + 0.05;
    [523.25, 659.26, 783.99].forEach((freq) => {
      const osc = g.ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const env = g.ctx.createGain();
      env.gain.setValueAtTime(0.0001, chordAt);
      env.gain.linearRampToValueAtTime(0.09, chordAt + 0.04);
      env.gain.exponentialRampToValueAtTime(0.0001, chordAt + 1.4);
      osc.connect(env).connect(g.sfx);
      osc.start(chordAt);
      osc.stop(chordAt + 1.5);
    });
  }

  playOver() {
    const g = this.ensure();
    if (!g) return;
    const t = g.ctx.currentTime;
    [220, 146.83].forEach((freq, i) => {
      const osc = g.ctx.createOscillator();
      osc.type = "sine";
      const start = t + i * 0.16;
      osc.frequency.setValueAtTime(freq, start);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.5, start + 0.55);
      const env = g.ctx.createGain();
      env.gain.setValueAtTime(0.22, start);
      env.gain.exponentialRampToValueAtTime(0.001, start + 0.6);
      osc.connect(env).connect(g.sfx);
      osc.start(start);
      osc.stop(start + 0.65);
    });
  }

  private playBuffer(g: Graph, buffer: AudioBuffer, gain: number) {
    const src = g.ctx.createBufferSource();
    src.buffer = buffer;
    const env = g.ctx.createGain();
    env.gain.value = gain;
    src.connect(env).connect(g.sfx);
    src.start();
  }

  // Wood knock: low pitched thump + short filtered click
  private synthKnock(g: Graph) {
    const t = g.ctx.currentTime;

    const thump = g.ctx.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(175, t);
    thump.frequency.exponentialRampToValueAtTime(72, t + 0.09);
    const thumpEnv = g.ctx.createGain();
    thumpEnv.gain.setValueAtTime(0.55, t);
    thumpEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    thump.connect(thumpEnv).connect(g.sfx);
    thump.start(t);
    thump.stop(t + 0.13);

    const partial = g.ctx.createOscillator();
    partial.type = "sine";
    partial.frequency.setValueAtTime(330, t);
    partial.frequency.exponentialRampToValueAtTime(150, t + 0.05);
    const partialEnv = g.ctx.createGain();
    partialEnv.gain.setValueAtTime(0.18, t);
    partialEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    partial.connect(partialEnv).connect(g.sfx);
    partial.start(t);
    partial.stop(t + 0.08);

    const click = g.ctx.createBufferSource();
    click.buffer = g.noise;
    const bp = g.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1900;
    bp.Q.value = 1.2;
    const clickEnv = g.ctx.createGain();
    clickEnv.gain.setValueAtTime(0.3, t);
    clickEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    click.connect(bp).connect(clickEnv).connect(g.sfx);
    click.start(t, Math.random() * 1.5, 0.04);
  }

  // Fire burst: swept low-pass noise whoosh + random high crackles
  private synthFire(g: Graph, lines: number) {
    const t = g.ctx.currentTime;
    const dur = 0.55 + 0.12 * lines;
    const boost = Math.min(0.8, 0.35 + 0.12 * lines);

    const whoosh = g.ctx.createBufferSource();
    whoosh.buffer = g.noise;
    const lp = g.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(250, t);
    lp.frequency.exponentialRampToValueAtTime(2600, t + 0.14);
    lp.frequency.exponentialRampToValueAtTime(320, t + dur);
    const whooshEnv = g.ctx.createGain();
    whooshEnv.gain.setValueAtTime(0.0001, t);
    whooshEnv.gain.linearRampToValueAtTime(boost, t + 0.1);
    whooshEnv.gain.exponentialRampToValueAtTime(0.001, t + dur);
    whoosh.connect(lp).connect(whooshEnv).connect(g.sfx);
    whoosh.start(t, Math.random(), dur + 0.1);

    const crackles = 7 + lines * 3;
    for (let i = 0; i < crackles; i++) {
      const ts = t + 0.03 + Math.random() * dur * 0.75;
      const len = 0.008 + Math.random() * 0.02;
      const pop = g.ctx.createBufferSource();
      pop.buffer = g.noise;
      const bp = g.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1700 + Math.random() * 3800;
      bp.Q.value = 2;
      const env = g.ctx.createGain();
      env.gain.setValueAtTime(0.1 + Math.random() * 0.28, ts);
      env.gain.exponentialRampToValueAtTime(0.001, ts + len);
      pop.connect(bp).connect(env).connect(g.sfx);
      pop.start(ts, Math.random() * 1.8, len + 0.01);
    }
  }

  // ——— Music ———

  startMusic() {
    const g = this.ensure();
    if (!g || this.musicOn) return;
    this.musicOn = true;
    if (this.musicStopTimer) {
      clearTimeout(this.musicStopTimer);
      this.musicStopTimer = null;
    }
    g.music.gain.setTargetAtTime(MUSIC_BASE * this.musicVolume, g.ctx.currentTime, 0.6);
    this.startMusicSource(g);
  }

  stopMusic() {
    if (!this.graph || !this.musicOn) return;
    this.musicOn = false;
    this.graph.music.gain.setTargetAtTime(0, this.graph.ctx.currentTime, 0.35);
    this.clearMusicTimers();
    const node = this.musicFileNode;
    if (node) {
      this.musicFileNode = null;
      this.musicStopTimer = setTimeout(() => {
        try {
          node.stop();
        } catch {
          // already stopped
        }
      }, 900);
    }
  }

  private clearMusicTimers() {
    if (this.musicTimer) {
      clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private startMusicSource(g: Graph) {
    if (this.files.music) {
      const src = g.ctx.createBufferSource();
      src.buffer = this.files.music;
      src.loop = true;
      src.connect(g.music);
      src.start();
      this.musicFileNode = src;
      return;
    }
    this.scheduleChord(g, g.ctx.currentTime + 0.05);
  }

  // Generative chill loop: soft detuned pads + sparse pentatonic plucks
  private scheduleChord(g: Graph, when: number) {
    const chord = CHORDS[this.chordIdx];
    this.chordIdx = (this.chordIdx + 1) % CHORDS.length;

    const lp = g.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 750;
    lp.Q.value = 0.4;
    lp.connect(g.music);

    for (const freq of chord) {
      for (const detune of [0.997, 1.004]) {
        const osc = g.ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = freq * detune;
        const env = g.ctx.createGain();
        env.gain.setValueAtTime(0.0001, when);
        env.gain.linearRampToValueAtTime(0.05, when + 1.1);
        env.gain.setValueAtTime(0.05, when + CHORD_DUR - 0.4);
        env.gain.linearRampToValueAtTime(0.0001, when + CHORD_DUR + 0.6);
        osc.connect(env).connect(lp);
        osc.start(when);
        osc.stop(when + CHORD_DUR + 0.7);
      }
    }

    for (let i = 0; i < 2; i++) {
      if (Math.random() < 0.35) continue; // leave space — it's chill
      const ts = when + 0.4 + Math.random() * (CHORD_DUR - 1.4);
      const osc = g.ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = PLUCKS[Math.floor(Math.random() * PLUCKS.length)];
      const env = g.ctx.createGain();
      env.gain.setValueAtTime(0.0001, ts);
      env.gain.linearRampToValueAtTime(0.11, ts + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, ts + 1.1);
      osc.connect(env);
      env.connect(g.music);
      env.connect(g.echoSend);
      osc.start(ts);
      osc.stop(ts + 1.2);
    }

    this.musicTimer = setTimeout(
      () => {
        if (this.musicOn && !this.files.music) {
          this.scheduleChord(g, when + CHORD_DUR);
        }
      },
      Math.max(50, (when + CHORD_DUR - g.ctx.currentTime - 0.35) * 1000)
    );
  }
}

export const sound = new SoundEngine();
