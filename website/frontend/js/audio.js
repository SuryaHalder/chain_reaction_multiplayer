/**
 * Chain Reaction Audio Manager
 * Plays authentic sound effects extracted from the original APK
 * Uses Web Audio API with fallback synthesized sound generation
 */

class AudioManager {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.buffers = {};
    this.soundPaths = {
      click: 'assets/click.wav',
      pop: 'assets/pop.wav',
      laser: 'assets/laser.wav',
      laser2: 'assets/laser2.wav',
      beep: 'assets/beep.wav'
    };
    this.initDone = false;
  }

  init() {
    if (this.initDone) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.loadAllSounds();
      }
      this.initDone = true;
    } catch (e) {
      console.warn('Web Audio API not supported:', e);
    }
  }

  async loadSound(name, url) {
    if (!this.ctx) return;
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const arrayBuffer = await resp.arrayBuffer();
      this.ctx.decodeAudioData(arrayBuffer, (decoded) => {
        this.buffers[name] = decoded;
      }, (err) => {
        console.warn(`Failed to decode audio "${name}":`, err);
      });
    } catch (err) {
      console.warn(`Could not load audio file ${url}:`, err);
    }
  }

  loadAllSounds() {
    for (const [name, url] of Object.entries(this.soundPaths)) {
      this.loadSound(name, url);
    }
  }

  unlock() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  play(name, options = {}) {
    if (!this.enabled) return;
    this.unlock();

    if (this.ctx && this.buffers[name]) {
      try {
        const source = this.ctx.createBufferSource();
        source.buffer = this.buffers[name];
        
        // Pitch variation for variety
        if (options.pitch) {
          source.playbackRate.value = options.pitch;
        }

        const gainNode = this.ctx.createGain();
        gainNode.gain.value = options.volume !== undefined ? options.volume : 0.8;

        source.connect(gainNode);
        gainNode.connect(this.ctx.destination);
        source.start(0);
        return;
      } catch (e) {
        console.warn('Error playing buffer audio:', e);
      }
    }

    // Synthesized fallback if audio file failed to load
    this.playSynthesized(name);
  }

  playSynthesized(name) {
    if (!this.ctx || !this.enabled) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);

      if (name === 'click') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(120, now + 0.08);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      } else if (name === 'pop') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.06);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (name === 'laser' || name === 'laser2') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(900, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.2);
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
      } else if (name === 'beep') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(650, now);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
      }
    } catch (e) {}
  }

  vibrate(ms = 30) {
    if (this.enabled && window.navigator && window.navigator.vibrate) {
      try {
        window.navigator.vibrate(ms);
      } catch (e) {}
    }
  }
}

window.soundManager = new AudioManager();
