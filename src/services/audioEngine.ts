/**
 * AuraCast Web Audio DSP Engine
 * Handles real-time audio playback, 5-band EQ, spatial widening,
 * procedural high-fidelity music synthesis, mic input, and cross-tab streaming.
 */

import { AudioEngineSettings } from '../types/audio';

class AudioEngineService {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private delayNodeL: DelayNode | null = null;
  private delayNodeR: DelayNode | null = null;
  private pannerNode: StereoPannerNode | null = null;

  // EQ Biquad Filters
  private eqSub: BiquadFilterNode | null = null;       // 60Hz LowShelf
  private eqLow: BiquadFilterNode | null = null;       // 250Hz Peaking
  private eqMid: BiquadFilterNode | null = null;       // 1000Hz Peaking
  private eqPresence: BiquadFilterNode | null = null;  // 4000Hz Peaking
  private eqHigh: BiquadFilterNode | null = null;      // 12000Hz HighShelf

  // Active Sound Sources
  private synthInterval: number | null = null;
  private activeOscillators: OscillatorNode[] = [];
  private micStream: MediaStream | null = null;
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  private fileBufferSource: AudioBufferSourceNode | null = null;
  private fileAudioBuffer: AudioBuffer | null = null;
  private testToneOscillator: OscillatorNode | null = null;

  // Real-time synchronization
  private broadcastChannel: BroadcastChannel | null = null;
  private isSynthesizing = false;
  private currentTrack: string = 'none';

  // Callbacks
  private onStateChangeListeners: Array<() => void> = [];

  constructor() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.broadcastChannel = new BroadcastChannel('auracast_mesh_sync');
        this.broadcastChannel.onmessage = (event) => {
          this.handleBroadcastMessage(event.data);
        };
      } catch (err) {
        console.warn('BroadcastChannel not available', err);
      }
    }
  }

  public init() {
    if (this.ctx) return;
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AudioCtxClass({ latencyHint: 'interactive' });

    // Analyser
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;

    // Master Gain
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.85, this.ctx.currentTime);

    // Dynamics Limiter
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.setValueAtTime(-18, this.ctx.currentTime);
    this.compressor.knee.setValueAtTime(12, this.ctx.currentTime);
    this.compressor.ratio.setValueAtTime(4, this.ctx.currentTime);
    this.compressor.attack.setValueAtTime(0.005, this.ctx.currentTime);
    this.compressor.release.setValueAtTime(0.15, this.ctx.currentTime);

    // 5-band EQ
    this.eqSub = this.ctx.createBiquadFilter();
    this.eqSub.type = 'lowshelf';
    this.eqSub.frequency.setValueAtTime(60, this.ctx.currentTime);

    this.eqLow = this.ctx.createBiquadFilter();
    this.eqLow.type = 'peaking';
    this.eqLow.frequency.setValueAtTime(250, this.ctx.currentTime);
    this.eqLow.Q.setValueAtTime(1.0, this.ctx.currentTime);

    this.eqMid = this.ctx.createBiquadFilter();
    this.eqMid.type = 'peaking';
    this.eqMid.frequency.setValueAtTime(1000, this.ctx.currentTime);
    this.eqMid.Q.setValueAtTime(1.0, this.ctx.currentTime);

    this.eqPresence = this.ctx.createBiquadFilter();
    this.eqPresence.type = 'peaking';
    this.eqPresence.frequency.setValueAtTime(4000, this.ctx.currentTime);
    this.eqPresence.Q.setValueAtTime(1.0, this.ctx.currentTime);

    this.eqHigh = this.ctx.createBiquadFilter();
    this.eqHigh.type = 'highshelf';
    this.eqHigh.frequency.setValueAtTime(12000, this.ctx.currentTime);

    // Spatial Panner
    this.pannerNode = this.ctx.createStereoPanner();

    // Wiring DSP chain:
    // Input -> eqSub -> eqLow -> eqMid -> eqPresence -> eqHigh -> panner -> compressor -> masterGain -> analyser -> destination
    this.eqSub.connect(this.eqLow);
    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqPresence);
    this.eqPresence.connect(this.eqHigh);
    this.eqHigh.connect(this.pannerNode);
    this.pannerNode.connect(this.compressor);
    this.compressor.connect(this.masterGain);
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  public async resumeContext() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  public getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  public applySettings(settings: AudioEngineSettings) {
    if (!this.ctx || !this.masterGain || !this.eqSub || !this.eqLow || !this.eqMid || !this.eqPresence || !this.eqHigh || !this.pannerNode) {
      return;
    }

    const t = this.ctx.currentTime;
    const vol = settings.isMuted ? 0 : settings.masterVolume;
    this.masterGain.gain.setTargetAtTime(vol, t, 0.05);

    // EQ bands
    const bassBoostAdd = settings.bassBoost ? 4 : 0;
    this.eqSub.gain.setTargetAtTime(settings.eqBands.sub + bassBoostAdd, t, 0.05);
    this.eqLow.gain.setTargetAtTime(settings.eqBands.low + (bassBoostAdd * 0.5), t, 0.05);
    this.eqMid.gain.setTargetAtTime(settings.eqBands.mid, t, 0.05);
    this.eqPresence.gain.setTargetAtTime(settings.eqBands.presence, t, 0.05);
    this.eqHigh.gain.setTargetAtTime(settings.eqBands.high, t, 0.05);

    // Channel Routing
    if (settings.channelRouting === 'left') {
      this.pannerNode.pan.setTargetAtTime(-1, t, 0.05);
    } else if (settings.channelRouting === 'right') {
      this.pannerNode.pan.setTargetAtTime(1, t, 0.05);
    } else {
      this.pannerNode.pan.setTargetAtTime(0, t, 0.05);
    }
  }

  // --- SOUND SOURCES ---

  /**
   * Start procedurally generated music
   */
  public async playProceduralTrack(trackType: 'lofi' | 'synthwave' | 'ambient') {
    await this.resumeContext();
    this.stopAllSources();
    if (!this.ctx || !this.eqSub) return;

    this.isSynthesizing = true;
    this.currentTrack = trackType;

    if (trackType === 'lofi') {
      this.startLofiGroove();
    } else if (trackType === 'synthwave') {
      this.startSynthwaveGroove();
    } else {
      this.startAmbientSpace();
    }

    this.broadcastState('playing_track', { trackType });
    this.notifyListeners();
  }

  private startLofiGroove() {
    if (!this.ctx || !this.eqSub) return;
    const ctx = this.ctx;
    const chords = [
      [261.63, 329.63, 392.00, 493.88], // Cmaj7
      [220.00, 261.63, 329.63, 392.00], // Am7
      [174.61, 220.00, 261.63, 329.63], // Fmaj7
      [196.00, 246.94, 293.66, 349.23], // G7
    ];
    let step = 0;

    const playStep = () => {
      if (!this.isSynthesizing || !this.ctx || !this.eqSub) return;
      const t = ctx.currentTime;
      const chord = chords[step % chords.length];

      // Warm rhodes-like notes
      chord.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = i % 2 === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(freq * 0.5, t);

        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.04, t + 0.06);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 1.6);

        osc.connect(gain);
        gain.connect(this.eqSub!);

        osc.start(t);
        osc.stop(t + 1.7);
      });

      // Warm kick
      const kickOsc = ctx.createOscillator();
      const kickGain = ctx.createGain();
      kickOsc.frequency.setValueAtTime(110, t);
      kickOsc.frequency.exponentialRampToValueAtTime(32, t + 0.25);
      kickGain.gain.setValueAtTime(0.2, t);
      kickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      kickOsc.connect(kickGain);
      kickGain.connect(this.eqSub!);
      kickOsc.start(t);
      kickOsc.stop(t + 0.35);

      // Hi-hat click on off-beat
      const hatOsc = ctx.createOscillator();
      const hatGain = ctx.createGain();
      hatOsc.type = 'highpass' as any;
      hatOsc.frequency.setValueAtTime(8000, t + 0.4);
      hatGain.gain.setValueAtTime(0.015, t + 0.4);
      hatGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.48);
      hatOsc.connect(hatGain);
      hatGain.connect(this.eqSub!);
      hatOsc.start(t + 0.4);
      hatOsc.stop(t + 0.5);

      step++;
    };

    playStep();
    this.synthInterval = window.setInterval(playStep, 800);
  }

  private startSynthwaveGroove() {
    if (!this.ctx || !this.eqSub) return;
    const ctx = this.ctx;
    const bassNotes = [110, 110, 130.81, 146.83, 98, 98, 110, 123.47];
    let noteIdx = 0;

    const playBass = () => {
      if (!this.isSynthesizing || !this.ctx || !this.eqSub) return;
      const t = ctx.currentTime;
      const freq = bassNotes[noteIdx % bassNotes.length];

      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(600, t);
      filter.frequency.exponentialRampToValueAtTime(140, t + 0.2);

      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.eqSub!);

      osc.start(t);
      osc.stop(t + 0.25);
      noteIdx++;
    };

    playBass();
    this.synthInterval = window.setInterval(playBass, 220);
  }

  private startAmbientSpace() {
    if (!this.ctx || !this.eqSub) return;
    const ctx = this.ctx;
    const padFrequencies = [130.81, 196.00, 261.63, 311.13, 392.00];

    padFrequencies.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      gain.gain.setValueAtTime(0.02 / (idx + 1), ctx.currentTime);

      // Slow LFO for organic movement
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.setValueAtTime(0.1 + idx * 0.05, ctx.currentTime);
      lfoGain.gain.setValueAtTime(freq * 0.02, ctx.currentTime);
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start();

      osc.connect(gain);
      gain.connect(this.eqSub!);
      osc.start();
      this.activeOscillators.push(osc, lfo);
    });
  }

  /**
   * Start Test Tone Calibration
   */
  public async playTestTone(freq: number, type: OscillatorType = 'sine') {
    await this.resumeContext();
    this.stopAllSources();
    if (!this.ctx || !this.eqSub) return;

    this.currentTrack = `tone_${freq}hz`;
    this.testToneOscillator = this.ctx.createOscillator();
    const toneGain = this.ctx.createGain();

    this.testToneOscillator.type = type;
    this.testToneOscillator.frequency.setValueAtTime(freq, this.ctx.currentTime);
    toneGain.gain.setValueAtTime(0.12, this.ctx.currentTime);

    this.testToneOscillator.connect(toneGain);
    toneGain.connect(this.eqSub);
    this.testToneOscillator.start();

    this.broadcastState('test_tone', { freq, type });
    this.notifyListeners();
  }

  /**
   * Start Microphone live pass-through
   */
  public async startMicrophone() {
    await this.resumeContext();
    this.stopAllSources();
    if (!this.ctx || !this.eqSub) return;

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: true,
        },
      });

      this.micSourceNode = this.ctx.createMediaStreamSource(this.micStream);
      this.micSourceNode.connect(this.eqSub);
      this.currentTrack = 'microphone_live';
      this.broadcastState('mic_started', {});
      this.notifyListeners();
      return true;
    } catch (err) {
      console.error('Microphone access failed:', err);
      return false;
    }
  }

  /**
   * Play user uploaded audio file
   */
  public async playAudioFile(file: File) {
    await this.resumeContext();
    this.stopAllSources();
    if (!this.ctx || !this.eqSub) return;

    try {
      const arrayBuffer = await file.arrayBuffer();
      this.fileAudioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

      this.fileBufferSource = this.ctx.createBufferSource();
      this.fileBufferSource.buffer = this.fileAudioBuffer;
      this.fileBufferSource.loop = true;
      this.fileBufferSource.connect(this.eqSub);
      this.fileBufferSource.start();

      this.currentTrack = file.name;
      this.broadcastState('playing_file', { fileName: file.name });
      this.notifyListeners();
      return true;
    } catch (err) {
      console.error('Audio file decode error:', err);
      return false;
    }
  }

  public stopAllSources() {
    if (this.synthInterval !== null) {
      clearInterval(this.synthInterval);
      this.synthInterval = null;
    }
    this.isSynthesizing = false;

    this.activeOscillators.forEach((osc) => {
      try {
        osc.stop();
        osc.disconnect();
      } catch (e) {}
    });
    this.activeOscillators = [];

    if (this.testToneOscillator) {
      try {
        this.testToneOscillator.stop();
        this.testToneOscillator.disconnect();
      } catch (e) {}
      this.testToneOscillator = null;
    }

    if (this.fileBufferSource) {
      try {
        this.fileBufferSource.stop();
        this.fileBufferSource.disconnect();
      } catch (e) {}
      this.fileBufferSource = null;
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }
    if (this.micSourceNode) {
      try {
        this.micSourceNode.disconnect();
      } catch (e) {}
      this.micSourceNode = null;
    }

    this.currentTrack = 'none';
    this.broadcastState('stopped', {});
    this.notifyListeners();
  }

  public getCurrentTrack(): string {
    return this.currentTrack;
  }

  public isPlaying(): boolean {
    return this.currentTrack !== 'none';
  }

  // Cross-tab broadcast
  private broadcastState(type: string, payload: any) {
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({ type, payload, timestamp: Date.now() });
    }
  }

  private handleBroadcastMessage(msg: { type: string; payload: any; timestamp: number }) {
    if (msg.type === 'remote_play_request') {
      if (msg.payload.trackType) {
        this.playProceduralTrack(msg.payload.trackType);
      }
    } else if (msg.type === 'remote_stop_request') {
      this.stopAllSources();
    }
  }

  public sendRemotePlay(trackType: 'lofi' | 'synthwave' | 'ambient') {
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({
        type: 'remote_play_request',
        payload: { trackType },
        timestamp: Date.now(),
      });
    }
  }

  public sendRemoteStop() {
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({
        type: 'remote_stop_request',
        payload: {},
        timestamp: Date.now(),
      });
    }
  }

  public addListener(cb: () => void) {
    this.onStateChangeListeners.push(cb);
  }

  public removeListener(cb: () => void) {
    this.onStateChangeListeners = this.onStateChangeListeners.filter((l) => l !== cb);
  }

  private notifyListeners() {
    this.onStateChangeListeners.forEach((cb) => cb());
  }
}

export const audioEngine = new AudioEngineService();
