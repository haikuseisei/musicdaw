var DAW = DAW || {};

DAW.Synth = (function () {
  'use strict';

  // ---- Utility helpers ----
  function midiToFreq(pitch) {
    return 440 * Math.pow(2, (pitch - 69) / 12);
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function deepCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // ---- Default parameter set ----
  var DEFAULT_PARAMS = {
    mode: 'subtractive', // 'subtractive' | 'fm' | 'wavetable'

    // Oscillators
    osc1Type: 'sawtooth',
    osc1Detune: 0,
    osc1Octave: 0,
    osc1Mix: 0.5,
    osc2Type: 'sawtooth',
    osc2Detune: 7,
    osc2Octave: 0,
    osc2Mix: 0.0,
    subOscLevel: 0.0,
    noiseType: 'white',
    noiseLevel: 0.0,

    // Filter
    filterType: 'lowpass',
    filterCutoff: 8000,
    filterResonance: 1,
    filterEnvAmount: 0,
    filterKeyTracking: 0,

    // Filter envelope
    filterAttack: 0.01,
    filterDecay: 0.3,
    filterSustain: 0.5,
    filterRelease: 0.3,

    // Amp envelope
    attackTime: 0.01,
    decayTime: 0.2,
    sustainLevel: 0.7,
    releaseTime: 0.3,

    // LFOs
    lfo1Rate: 4,
    lfo1Depth: 0,
    lfo1Waveform: 'sine',
    lfo1Dest: 'pitch', // 'pitch' | 'filter' | 'amplitude' | 'pan'
    lfo2Rate: 2,
    lfo2Depth: 0,
    lfo2Waveform: 'sine',
    lfo2Dest: 'filter',

    // Glide
    glideTime: 0,

    // Unison
    unisonVoices: 1,
    unisonDetune: 10,

    // Polyphony
    polyphony: 16,

    // Master
    masterGain: 0.5,

    // FM parameters
    fmAlgorithm: 0,
    op1Ratio: 1, op1Detune: 0, op1Level: 1.0,
    op1Attack: 0.01, op1Decay: 0.3, op1Sustain: 0.7, op1Release: 0.3,
    op2Ratio: 2, op2Detune: 0, op2Level: 0.5,
    op2Attack: 0.01, op2Decay: 0.3, op2Sustain: 0.5, op2Release: 0.3,
    op3Ratio: 3, op3Detune: 0, op3Level: 0.3,
    op3Attack: 0.01, op3Decay: 0.2, op3Sustain: 0.3, op3Release: 0.2,
    op4Ratio: 4, op4Detune: 0, op4Level: 0.2,
    op4Attack: 0.01, op4Decay: 0.15, op4Sustain: 0.2, op4Release: 0.15,

    // Wavetable
    wavetableType: 'saw',
    wavetablePosition: 0.0
  };

  // ---- FM Algorithms ----
  // Each algorithm describes routing: carrier ops output to audio, modulators feed other ops.
  // Format: array of { carriers: [...], modulations: [{from, to}, ...] }
  var FM_ALGORITHMS = [
    // 0: Serial  4->3->2->1(carrier)
    { carriers: [0], mods: [{from:3,to:2},{from:2,to:1},{from:1,to:0}] },
    // 1: 3->2->1(carrier), 4->1(carrier)
    { carriers: [0], mods: [{from:2,to:1},{from:1,to:0},{from:3,to:0}] },
    // 2: Two parallel stacks  (3->1)(carrier), (4->2)(carrier)
    { carriers: [0,1], mods: [{from:2,to:0},{from:3,to:1}] },
    // 3: All carriers in parallel, 4 modulates 3
    { carriers: [0,1,2], mods: [{from:3,to:2}] },
    // 4: All four operators as carriers (additive)
    { carriers: [0,1,2,3], mods: [] },
    // 5: 4->3->2(carrier), 4->1(carrier)
    { carriers: [0,1], mods: [{from:3,to:2},{from:2,to:1},{from:3,to:0}] }
  ];

  // ---- Wavetable generation ----
  function generateWavetable(ac, type, size) {
    size = size || 2048;
    var real = new Float32Array(size);
    var imag = new Float32Array(size);
    real[0] = 0;
    imag[0] = 0;
    var i;

    switch (type) {
      case 'saw':
        for (i = 1; i < size; i++) {
          imag[i] = (2.0 / (Math.PI * i)) * Math.pow(-1, i + 1);
        }
        break;
      case 'square':
        for (i = 1; i < size; i++) {
          if (i % 2 === 1) {
            imag[i] = 4.0 / (Math.PI * i);
          }
        }
        break;
      case 'triangle':
        for (i = 1; i < size; i++) {
          if (i % 2 === 1) {
            imag[i] = (8.0 / (Math.PI * Math.PI * i * i)) * Math.pow(-1, (i - 1) / 2);
          }
        }
        break;
      case 'pwm':
        // Pulse width ~25%
        for (i = 1; i < size; i++) {
          imag[i] = (2.0 / (Math.PI * i)) * Math.sin(Math.PI * i * 0.25);
        }
        break;
      case 'formant':
        // Vowel-like formant
        for (i = 1; i < size; i++) {
          var f = i * 100;
          var a = Math.exp(-0.001 * Math.pow(f - 700, 2)) +
                  0.6 * Math.exp(-0.002 * Math.pow(f - 1200, 2)) +
                  0.3 * Math.exp(-0.003 * Math.pow(f - 2500, 2));
          imag[i] = a / i;
        }
        break;
      case 'metallic':
        // Inharmonic partials
        for (i = 1; i < Math.min(size, 64); i++) {
          var ratio = 1 + 0.7 * i + 0.1 * i * i;
          var idx = Math.round(ratio);
          if (idx < size) {
            imag[idx] = (imag[idx] || 0) + 1.0 / (i + 1);
          }
        }
        break;
      default:
        // Saw fallback
        for (i = 1; i < size; i++) {
          imag[i] = (2.0 / (Math.PI * i)) * Math.pow(-1, i + 1);
        }
    }

    return ac.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  // ---- Pink noise helper ----
  function createPinkNoiseBuffer(ac, duration) {
    var length = Math.floor(ac.sampleRate * duration);
    var buffer = ac.createBuffer(1, length, ac.sampleRate);
    var data = buffer.getChannelData(0);
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (var i = 0; i < length; i++) {
      var white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    return buffer;
  }

  function createWhiteNoiseBuffer(ac, duration) {
    var length = Math.floor(ac.sampleRate * duration);
    var buffer = ac.createBuffer(1, length, ac.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  // ---- Voice (single note) for subtractive/wavetable ----
  function SubVoice(ac, params, outputNode, unisonIndex, unisonTotal) {
    var self = this;
    self.ac = ac;
    self.params = params;
    self.pitch = 60;
    self.velocity = 1.0;
    self.active = false;
    self.released = false;

    // Unison detune offset
    var detuneOffset = 0;
    if (unisonTotal > 1) {
      var spread = params.unisonDetune;
      detuneOffset = -spread / 2 + (spread / (unisonTotal - 1)) * unisonIndex;
    }
    self.detuneOffset = detuneOffset;

    // Create nodes
    self.osc1 = ac.createOscillator();
    self.osc2 = ac.createOscillator();
    self.subOsc = ac.createOscillator();

    self.osc1Gain = ac.createGain();
    self.osc2Gain = ac.createGain();
    self.subGain = ac.createGain();
    self.noiseGain = ac.createGain();

    self.mixer = ac.createGain();
    self.filter = ac.createBiquadFilter();
    self.ampEnv = ac.createGain();
    self.panNode = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain();
    self.outputGain = ac.createGain();

    // Oscillator setup
    if (params.mode === 'wavetable') {
      var wave = generateWavetable(ac, params.wavetableType);
      self.osc1.setPeriodicWave(wave);
      self.osc2.setPeriodicWave(wave);
    } else {
      self.osc1.type = params.osc1Type;
      self.osc2.type = params.osc2Type;
    }
    self.subOsc.type = 'sine';

    // Gains
    self.osc1Gain.gain.value = params.osc1Mix;
    self.osc2Gain.gain.value = params.osc2Mix;
    self.subGain.gain.value = params.subOscLevel;
    self.noiseGain.gain.value = params.noiseLevel;

    // Routing: oscs -> mixer -> filter -> ampEnv -> pan -> outputGain -> output
    self.osc1.connect(self.osc1Gain);
    self.osc2.connect(self.osc2Gain);
    self.subOsc.connect(self.subGain);

    self.osc1Gain.connect(self.mixer);
    self.osc2Gain.connect(self.mixer);
    self.subGain.connect(self.mixer);
    self.noiseGain.connect(self.mixer);

    self.mixer.connect(self.filter);
    self.filter.connect(self.ampEnv);
    self.ampEnv.connect(self.panNode);
    self.panNode.connect(self.outputGain);
    self.outputGain.connect(outputNode);

    // Filter defaults
    self.filter.type = params.filterType;
    self.filter.frequency.value = params.filterCutoff;
    self.filter.Q.value = params.filterResonance;

    // Amp envelope starts at 0
    self.ampEnv.gain.value = 0;
    self.outputGain.gain.value = params.masterGain / Math.max(1, unisonTotal);

    // Noise source (loop a buffer)
    self.noiseBuf = params.noiseType === 'pink'
      ? createPinkNoiseBuffer(ac, 2)
      : createWhiteNoiseBuffer(ac, 2);
    self.noiseSource = ac.createBufferSource();
    self.noiseSource.buffer = self.noiseBuf;
    self.noiseSource.loop = true;
    self.noiseSource.connect(self.noiseGain);

    // LFO 1
    self.lfo1 = ac.createOscillator();
    self.lfo1.type = params.lfo1Waveform;
    self.lfo1.frequency.value = params.lfo1Rate;
    self.lfo1Gain = ac.createGain();
    self.lfo1Gain.gain.value = params.lfo1Depth;
    self.lfo1.connect(self.lfo1Gain);
    self._routeLFO(self.lfo1Gain, params.lfo1Dest);

    // LFO 2
    self.lfo2 = ac.createOscillator();
    self.lfo2.type = params.lfo2Waveform;
    self.lfo2.frequency.value = params.lfo2Rate;
    self.lfo2Gain = ac.createGain();
    self.lfo2Gain.gain.value = params.lfo2Depth;
    self.lfo2.connect(self.lfo2Gain);
    self._routeLFO(self.lfo2Gain, params.lfo2Dest);
  }

  SubVoice.prototype._routeLFO = function (lfoGainNode, dest) {
    switch (dest) {
      case 'pitch':
        lfoGainNode.connect(this.osc1.frequency);
        lfoGainNode.connect(this.osc2.frequency);
        break;
      case 'filter':
        lfoGainNode.connect(this.filter.frequency);
        break;
      case 'amplitude':
        lfoGainNode.connect(this.ampEnv.gain);
        break;
      case 'pan':
        if (this.panNode.pan) {
          lfoGainNode.connect(this.panNode.pan);
        }
        break;
    }
  };

  SubVoice.prototype.start = function (pitch, velocity, time, glideFrom) {
    var p = this.params;
    var freq = midiToFreq(pitch + p.osc1Octave * 12);
    var freq2 = midiToFreq(pitch + p.osc2Octave * 12);
    var subFreq = midiToFreq(pitch - 12);
    var t = time || this.ac.currentTime;

    this.pitch = pitch;
    this.velocity = velocity;
    this.active = true;
    this.released = false;

    // Detune
    this.osc1.detune.setValueAtTime(p.osc1Detune + this.detuneOffset, t);
    this.osc2.detune.setValueAtTime(p.osc2Detune + this.detuneOffset, t);

    // Frequency with optional glide
    if (glideFrom > 0 && p.glideTime > 0) {
      var glideFromFreq = midiToFreq(glideFrom + p.osc1Octave * 12);
      var glideFromFreq2 = midiToFreq(glideFrom + p.osc2Octave * 12);
      var glideFromSub = midiToFreq(glideFrom - 12);
      var glideSec = p.glideTime / 1000;
      this.osc1.frequency.setValueAtTime(glideFromFreq, t);
      this.osc1.frequency.linearRampToValueAtTime(freq, t + glideSec);
      this.osc2.frequency.setValueAtTime(glideFromFreq2, t);
      this.osc2.frequency.linearRampToValueAtTime(freq2, t + glideSec);
      this.subOsc.frequency.setValueAtTime(glideFromSub, t);
      this.subOsc.frequency.linearRampToValueAtTime(subFreq, t + glideSec);
    } else {
      this.osc1.frequency.setValueAtTime(freq, t);
      this.osc2.frequency.setValueAtTime(freq2, t);
      this.subOsc.frequency.setValueAtTime(subFreq, t);
    }

    // Key tracking for filter
    var cutoff = p.filterCutoff + (pitch - 60) * p.filterKeyTracking * 50;
    cutoff = clamp(cutoff, 20, 20000);

    // Filter envelope
    var fEnvPeak = clamp(cutoff + p.filterEnvAmount * 4000, 20, 20000);
    var fSustain = clamp(cutoff + p.filterEnvAmount * 4000 * p.filterSustain, 20, 20000);
    this.filter.frequency.cancelScheduledValues(t);
    this.filter.frequency.setValueAtTime(cutoff, t);
    this.filter.frequency.linearRampToValueAtTime(fEnvPeak, t + Math.max(p.filterAttack, 0.001));
    this.filter.frequency.linearRampToValueAtTime(fSustain, t + p.filterAttack + Math.max(p.filterDecay, 0.001));

    // Amp envelope
    var vol = velocity / 127;
    this.ampEnv.gain.cancelScheduledValues(t);
    this.ampEnv.gain.setValueAtTime(0.0001, t);
    this.ampEnv.gain.linearRampToValueAtTime(vol, t + Math.max(p.attackTime, 0.001));
    this.ampEnv.gain.linearRampToValueAtTime(vol * p.sustainLevel, t + p.attackTime + Math.max(p.decayTime, 0.001));

    // Start all sources
    try { this.osc1.start(t); } catch (e) { /* already started */ }
    try { this.osc2.start(t); } catch (e) { /* already started */ }
    try { this.subOsc.start(t); } catch (e) { /* already started */ }
    try { this.noiseSource.start(t); } catch (e) { /* already started */ }
    try { this.lfo1.start(t); } catch (e) { /* already started */ }
    try { this.lfo2.start(t); } catch (e) { /* already started */ }
  };

  SubVoice.prototype.release = function (time) {
    if (!this.active || this.released) return;
    var p = this.params;
    var t = time || this.ac.currentTime;
    var relTime = Math.max(p.releaseTime, 0.01);
    this.released = true;

    this.ampEnv.gain.cancelScheduledValues(t);
    this.ampEnv.gain.setValueAtTime(this.ampEnv.gain.value, t);
    this.ampEnv.gain.linearRampToValueAtTime(0.0001, t + relTime);

    // Filter release
    var fRelTime = Math.max(p.filterRelease, 0.01);
    this.filter.frequency.cancelScheduledValues(t);
    this.filter.frequency.setValueAtTime(this.filter.frequency.value, t);
    this.filter.frequency.linearRampToValueAtTime(clamp(p.filterCutoff, 20, 20000), t + fRelTime);

    var self = this;
    var stopTime = t + Math.max(relTime, fRelTime) + 0.05;
    self.stopTimeout = setTimeout(function () {
      self._stop();
    }, (stopTime - self.ac.currentTime) * 1000);
  };

  SubVoice.prototype._stop = function () {
    this.active = false;
    try { this.osc1.stop(); } catch (e) { /* */ }
    try { this.osc2.stop(); } catch (e) { /* */ }
    try { this.subOsc.stop(); } catch (e) { /* */ }
    try { this.noiseSource.stop(); } catch (e) { /* */ }
    try { this.lfo1.stop(); } catch (e) { /* */ }
    try { this.lfo2.stop(); } catch (e) { /* */ }
    try { this.osc1.disconnect(); } catch (e) { /* */ }
    try { this.osc2.disconnect(); } catch (e) { /* */ }
    try { this.subOsc.disconnect(); } catch (e) { /* */ }
    try { this.noiseSource.disconnect(); } catch (e) { /* */ }
    try { this.lfo1.disconnect(); } catch (e) { /* */ }
    try { this.lfo2.disconnect(); } catch (e) { /* */ }
    try { this.outputGain.disconnect(); } catch (e) { /* */ }
  };

  SubVoice.prototype.forceStop = function () {
    if (this.stopTimeout) clearTimeout(this.stopTimeout);
    this._stop();
  };

  // ---- FM Voice ----
  function FMVoice(ac, params, outputNode) {
    var self = this;
    self.ac = ac;
    self.params = params;
    self.pitch = 60;
    self.active = false;
    self.released = false;

    // Create 4 operators
    self.ops = [];
    self.opGains = [];
    self.opEnvs = [];
    for (var i = 0; i < 4; i++) {
      var osc = ac.createOscillator();
      osc.type = 'sine';
      var envGain = ac.createGain();
      envGain.gain.value = 0;
      var opGain = ac.createGain();
      var idx = i + 1;
      opGain.gain.value = params['op' + idx + 'Level'] || 0;
      osc.connect(envGain);
      envGain.connect(opGain);
      self.ops.push(osc);
      self.opEnvs.push(envGain);
      self.opGains.push(opGain);
    }

    // Master amp envelope + output
    self.ampEnv = ac.createGain();
    self.ampEnv.gain.value = 0;
    self.masterOut = ac.createGain();
    self.masterOut.gain.value = params.masterGain;
    self.ampEnv.connect(self.masterOut);
    self.masterOut.connect(outputNode);

    // Apply algorithm routing
    var algo = FM_ALGORITHMS[clamp(params.fmAlgorithm, 0, FM_ALGORITHMS.length - 1)];

    // Connect carriers to amp envelope
    for (var c = 0; c < algo.carriers.length; c++) {
      self.opGains[algo.carriers[c]].connect(self.ampEnv);
    }

    // Connect modulators: modulator output -> destination osc frequency
    for (var m = 0; m < algo.mods.length; m++) {
      var mod = algo.mods[m];
      // FM modulation: modulator gain -> carrier osc.frequency
      // Need a modulation depth gain node
      var modDepthGain = ac.createGain();
      modDepthGain.gain.value = 1000 * (params['op' + (mod.from + 1) + 'Level'] || 0.5);
      self.opGains[mod.from].connect(modDepthGain);
      modDepthGain.connect(self.ops[mod.to].frequency);
    }

    // Filter (shared)
    self.filter = ac.createBiquadFilter();
    self.filter.type = params.filterType;
    self.filter.frequency.value = params.filterCutoff;
    self.filter.Q.value = params.filterResonance;

    // Reroute: ampEnv -> filter -> masterOut
    self.ampEnv.disconnect();
    self.ampEnv.connect(self.filter);
    self.filter.connect(self.masterOut);
  }

  FMVoice.prototype.start = function (pitch, velocity, time) {
    var p = this.params;
    var t = time || this.ac.currentTime;
    this.pitch = pitch;
    this.active = true;
    this.released = false;
    var baseFreq = midiToFreq(pitch);
    var vol = velocity / 127;

    // Set operator frequencies and envelopes
    for (var i = 0; i < 4; i++) {
      var idx = i + 1;
      var ratio = p['op' + idx + 'Ratio'] || 1;
      var detune = p['op' + idx + 'Detune'] || 0;
      var attack = Math.max(p['op' + idx + 'Attack'] || 0.01, 0.001);
      var decay = Math.max(p['op' + idx + 'Decay'] || 0.3, 0.001);
      var sustain = p['op' + idx + 'Sustain'] || 0.5;
      var level = p['op' + idx + 'Level'] || 0;

      this.ops[i].frequency.setValueAtTime(baseFreq * ratio + detune, t);

      this.opEnvs[i].gain.cancelScheduledValues(t);
      this.opEnvs[i].gain.setValueAtTime(0.0001, t);
      this.opEnvs[i].gain.linearRampToValueAtTime(level, t + attack);
      this.opEnvs[i].gain.linearRampToValueAtTime(level * sustain, t + attack + decay);

      try { this.ops[i].start(t); } catch (e) { /* already started */ }
    }

    // Master amp envelope
    this.ampEnv.gain.cancelScheduledValues(t);
    this.ampEnv.gain.setValueAtTime(0.0001, t);
    this.ampEnv.gain.linearRampToValueAtTime(vol, t + Math.max(p.attackTime, 0.001));
    this.ampEnv.gain.linearRampToValueAtTime(vol * p.sustainLevel, t + p.attackTime + Math.max(p.decayTime, 0.001));
  };

  FMVoice.prototype.release = function (time) {
    if (!this.active || this.released) return;
    var p = this.params;
    var t = time || this.ac.currentTime;
    var relTime = Math.max(p.releaseTime, 0.01);
    this.released = true;

    // Release amp
    this.ampEnv.gain.cancelScheduledValues(t);
    this.ampEnv.gain.setValueAtTime(this.ampEnv.gain.value, t);
    this.ampEnv.gain.linearRampToValueAtTime(0.0001, t + relTime);

    // Release each operator
    for (var i = 0; i < 4; i++) {
      var idx = i + 1;
      var opRel = Math.max(p['op' + idx + 'Release'] || 0.3, 0.01);
      this.opEnvs[i].gain.cancelScheduledValues(t);
      this.opEnvs[i].gain.setValueAtTime(this.opEnvs[i].gain.value, t);
      this.opEnvs[i].gain.linearRampToValueAtTime(0.0001, t + opRel);
    }

    var self = this;
    var stopTime = t + relTime + 0.1;
    self.stopTimeout = setTimeout(function () {
      self._stop();
    }, (stopTime - self.ac.currentTime) * 1000);
  };

  FMVoice.prototype._stop = function () {
    this.active = false;
    for (var i = 0; i < 4; i++) {
      try { this.ops[i].stop(); } catch (e) { /* */ }
      try { this.ops[i].disconnect(); } catch (e) { /* */ }
    }
    try { this.masterOut.disconnect(); } catch (e) { /* */ }
  };

  FMVoice.prototype.forceStop = function () {
    if (this.stopTimeout) clearTimeout(this.stopTimeout);
    this._stop();
  };

  // ---- Presets ----
  var PRESETS = {
    'init': {},
    'pad': {
      osc1Type: 'sawtooth', osc1Mix: 0.4, osc2Type: 'sawtooth', osc2Mix: 0.3, osc2Detune: 12,
      attackTime: 0.8, decayTime: 1.0, sustainLevel: 0.6, releaseTime: 1.5,
      filterCutoff: 3000, filterResonance: 2, filterEnvAmount: 0.3,
      filterAttack: 0.6, filterDecay: 1.0, filterSustain: 0.4, filterRelease: 1.2,
      unisonVoices: 4, unisonDetune: 15
    },
    'lead': {
      osc1Type: 'sawtooth', osc1Mix: 0.6, osc2Type: 'square', osc2Mix: 0.3, osc2Octave: 1,
      attackTime: 0.01, decayTime: 0.3, sustainLevel: 0.8, releaseTime: 0.2,
      filterCutoff: 5000, filterResonance: 4, filterEnvAmount: 0.5,
      filterAttack: 0.01, filterDecay: 0.2, filterSustain: 0.6, filterRelease: 0.2,
      glideTime: 60, lfo1Rate: 5.5, lfo1Depth: 8, lfo1Dest: 'pitch'
    },
    'bass': {
      osc1Type: 'sawtooth', osc1Mix: 0.5, osc2Type: 'square', osc2Mix: 0.3,
      subOscLevel: 0.5, osc1Octave: -1,
      attackTime: 0.01, decayTime: 0.15, sustainLevel: 0.6, releaseTime: 0.1,
      filterCutoff: 800, filterResonance: 3, filterEnvAmount: 0.6,
      filterAttack: 0.01, filterDecay: 0.15, filterSustain: 0.3, filterRelease: 0.1
    },
    'pluck': {
      osc1Type: 'sawtooth', osc1Mix: 0.5, osc2Type: 'triangle', osc2Mix: 0.2,
      attackTime: 0.002, decayTime: 0.4, sustainLevel: 0.0, releaseTime: 0.3,
      filterCutoff: 6000, filterResonance: 2, filterEnvAmount: 0.8,
      filterAttack: 0.001, filterDecay: 0.3, filterSustain: 0.0, filterRelease: 0.2
    },
    'strings': {
      osc1Type: 'sawtooth', osc1Mix: 0.4, osc2Type: 'sawtooth', osc2Mix: 0.35, osc2Detune: 8,
      attackTime: 1.2, decayTime: 0.5, sustainLevel: 0.8, releaseTime: 1.0,
      filterCutoff: 4000, filterResonance: 1, filterEnvAmount: 0.1,
      filterAttack: 0.8, filterDecay: 0.5, filterSustain: 0.7, filterRelease: 0.8,
      unisonVoices: 3, unisonDetune: 12,
      lfo1Rate: 5, lfo1Depth: 4, lfo1Dest: 'pitch'
    },
    'brass': {
      osc1Type: 'sawtooth', osc1Mix: 0.6, osc2Type: 'sawtooth', osc2Mix: 0.2, osc2Detune: 3,
      attackTime: 0.08, decayTime: 0.2, sustainLevel: 0.7, releaseTime: 0.15,
      filterCutoff: 1200, filterResonance: 2, filterEnvAmount: 0.9,
      filterAttack: 0.06, filterDecay: 0.3, filterSustain: 0.5, filterRelease: 0.15
    },
    'keys': {
      osc1Type: 'sine', osc1Mix: 0.4, osc2Type: 'triangle', osc2Mix: 0.3, osc2Octave: 1,
      attackTime: 0.005, decayTime: 1.2, sustainLevel: 0.2, releaseTime: 0.4,
      filterCutoff: 5000, filterResonance: 1, filterEnvAmount: 0.3,
      filterAttack: 0.005, filterDecay: 0.8, filterSustain: 0.2, filterRelease: 0.3
    },
    'fm-bell': {
      mode: 'fm', fmAlgorithm: 0,
      op1Ratio: 1, op1Level: 1.0, op1Attack: 0.001, op1Decay: 2.0, op1Sustain: 0.0, op1Release: 1.5,
      op2Ratio: 3.5, op2Level: 0.7, op2Attack: 0.001, op2Decay: 1.5, op2Sustain: 0.0, op2Release: 1.0,
      op3Ratio: 7.1, op3Level: 0.3, op3Attack: 0.001, op3Decay: 1.0, op3Sustain: 0.0, op3Release: 0.8,
      op4Ratio: 1, op4Level: 0.0,
      attackTime: 0.001, decayTime: 3.0, sustainLevel: 0.0, releaseTime: 2.0,
      filterCutoff: 12000
    },
    'fm-bass': {
      mode: 'fm', fmAlgorithm: 0,
      op1Ratio: 1, op1Level: 1.0, op1Attack: 0.005, op1Decay: 0.3, op1Sustain: 0.6, op1Release: 0.1,
      op2Ratio: 1, op2Level: 0.8, op2Attack: 0.005, op2Decay: 0.2, op2Sustain: 0.3, op2Release: 0.1,
      op3Ratio: 2, op3Level: 0.4, op3Attack: 0.005, op3Decay: 0.15, op3Sustain: 0.1, op3Release: 0.08,
      op4Ratio: 3, op4Level: 0.0,
      attackTime: 0.005, decayTime: 0.2, sustainLevel: 0.6, releaseTime: 0.1,
      filterCutoff: 2000
    },
    'wobble': {
      osc1Type: 'sawtooth', osc1Mix: 0.5, osc2Type: 'square', osc2Mix: 0.3,
      subOscLevel: 0.3,
      attackTime: 0.01, decayTime: 0.2, sustainLevel: 0.7, releaseTime: 0.2,
      filterCutoff: 1500, filterResonance: 8, filterEnvAmount: 0.2,
      filterAttack: 0.01, filterDecay: 0.3, filterSustain: 0.4, filterRelease: 0.2,
      lfo1Rate: 3, lfo1Depth: 2000, lfo1Waveform: 'sine', lfo1Dest: 'filter'
    }
  };

  // ---- Synth Instance ----
  function create(audioContext, outputNode) {
    var ac = audioContext || DAW.AudioEngine.getContext();
    var output = outputNode || ac.destination;
    var params = deepCopy(DEFAULT_PARAMS);
    var activeVoices = {}; // pitch -> array of voice objects
    var voiceCount = 0;
    var lastPitch = -1;

    function allocateVoices(pitch, velocity, time) {
      // Voice stealing if at polyphony limit
      if (voiceCount >= params.polyphony) {
        stealVoice(time);
      }

      var voices = [];
      var numUnison = params.mode === 'fm' ? 1 : Math.max(1, params.unisonVoices);

      for (var u = 0; u < numUnison; u++) {
        var voice;
        if (params.mode === 'fm') {
          voice = new FMVoice(ac, params, output);
          voice.start(pitch, velocity, time);
        } else {
          voice = new SubVoice(ac, params, output, u, numUnison);
          var glideFrom = (params.glideTime > 0 && lastPitch >= 0) ? lastPitch : 0;
          voice.start(pitch, velocity, time, glideFrom);
        }
        voices.push(voice);
        voiceCount++;
      }

      lastPitch = pitch;
      return voices;
    }

    function stealVoice(time) {
      // Steal oldest voice
      var keys = Object.keys(activeVoices);
      if (keys.length === 0) return;
      var oldestKey = keys[0];
      var oldestVoices = activeVoices[oldestKey];
      if (oldestVoices && oldestVoices.length > 0) {
        for (var i = 0; i < oldestVoices.length; i++) {
          oldestVoices[i].forceStop();
          voiceCount--;
        }
        delete activeVoices[oldestKey];
      }
    }

    function noteOn(pitch, velocity, time) {
      velocity = velocity || 100;
      time = time || ac.currentTime;

      // If this pitch already playing, release it first
      if (activeVoices[pitch]) {
        noteOff(pitch, time);
      }

      var voices = allocateVoices(pitch, velocity, time);
      activeVoices[pitch] = voices;
    }

    function noteOff(pitch, time) {
      time = time || ac.currentTime;
      var voices = activeVoices[pitch];
      if (!voices) return;
      for (var i = 0; i < voices.length; i++) {
        voices[i].release(time);
      }
      delete activeVoices[pitch];
      voiceCount = Math.max(0, voiceCount - voices.length);
    }

    function setParam(name, value) {
      if (params.hasOwnProperty(name)) {
        params[name] = value;
      }
    }

    function getParams() {
      return deepCopy(params);
    }

    function setPreset(presetName) {
      var preset = PRESETS[presetName];
      if (!preset) return;
      // Reset to defaults then apply preset
      params = deepCopy(DEFAULT_PARAMS);
      var keys = Object.keys(preset);
      for (var i = 0; i < keys.length; i++) {
        params[keys[i]] = preset[keys[i]];
      }
    }

    function getPresets() {
      return Object.keys(PRESETS);
    }

    function panic() {
      var keys = Object.keys(activeVoices);
      for (var i = 0; i < keys.length; i++) {
        var voices = activeVoices[keys[i]];
        for (var j = 0; j < voices.length; j++) {
          voices[j].forceStop();
        }
      }
      activeVoices = {};
      voiceCount = 0;
    }

    return {
      noteOn: noteOn,
      noteOff: noteOff,
      setParam: setParam,
      getParams: getParams,
      setPreset: setPreset,
      getPresets: getPresets,
      panic: panic
    };
  }

  // ---- Public API ----
  return {
    create: create,
    getPresetNames: function () { return Object.keys(PRESETS); },
    generateWavetable: generateWavetable
  };
})();
