var DAW = DAW || {};

DAW.Sampler = (function () {
  'use strict';

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function deepCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // ---- Default parameters ----
  var DEFAULT_PARAMS = {
    // Amp envelope
    attackTime: 0.005,
    decayTime: 0.2,
    sustainLevel: 1.0,
    releaseTime: 0.3,

    // Filter
    filterType: 'lowpass',
    filterCutoff: 20000,
    filterResonance: 0,
    filterEnvAmount: 0,

    // Filter envelope
    filterAttack: 0.01,
    filterDecay: 0.3,
    filterSustain: 0.5,
    filterRelease: 0.3,

    // Playback
    oneShot: false,
    reverse: false,
    sampleStart: 0,     // 0-1 normalized
    sampleEnd: 1,       // 0-1 normalized

    // Master
    masterGain: 0.7,
    polyphony: 16
  };

  // ---- Procedural sample generation ----
  function generatePianoSample(ac, rootNote) {
    var freq = 440 * Math.pow(2, (rootNote - 69) / 12);
    var duration = 3.0;
    var sampleRate = ac.sampleRate;
    var length = Math.floor(sampleRate * duration);
    var buffer = ac.createBuffer(1, length, sampleRate);
    var data = buffer.getChannelData(0);

    // Additive synthesis with decaying harmonics
    var harmonics = [1.0, 0.6, 0.3, 0.15, 0.08, 0.04, 0.02, 0.01];
    var decayRates = [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0];

    for (var i = 0; i < length; i++) {
      var t = i / sampleRate;
      var sample = 0;
      for (var h = 0; h < harmonics.length; h++) {
        var hFreq = freq * (h + 1);
        if (hFreq > sampleRate / 2) break;
        var amp = harmonics[h] * Math.exp(-decayRates[h] * t);
        // Slight inharmonicity like a real piano
        var stretch = 1 + 0.0001 * (h + 1) * (h + 1);
        sample += amp * Math.sin(2 * Math.PI * hFreq * stretch * t);
      }
      // Hammer strike transient
      var strike = Math.exp(-80 * t) * 0.3 * (Math.random() * 2 - 1);
      data[i] = clamp((sample + strike) * 0.4, -1, 1);
    }

    return buffer;
  }

  function generateStringsSample(ac, rootNote) {
    var freq = 440 * Math.pow(2, (rootNote - 69) / 12);
    var duration = 4.0;
    var sampleRate = ac.sampleRate;
    var length = Math.floor(sampleRate * duration);
    var buffer = ac.createBuffer(1, length, sampleRate);
    var data = buffer.getChannelData(0);

    // Sawtooth-like with slow attack envelope
    var numHarmonics = Math.floor(Math.min(32, (sampleRate / 2) / freq));
    for (var i = 0; i < length; i++) {
      var t = i / sampleRate;
      var sample = 0;
      for (var h = 1; h <= numHarmonics; h++) {
        var amp = 1.0 / h;
        // Roll off high harmonics over time
        amp *= Math.exp(-0.3 * h * t);
        sample += amp * Math.sin(2 * Math.PI * freq * h * t);
      }
      // Slow attack, sustain envelope
      var env = 1.0 - Math.exp(-1.5 * t);
      // Add subtle vibrato
      var vibrato = 1 + 0.003 * Math.sin(2 * Math.PI * 5.2 * t);
      data[i] = clamp(sample * env * 0.25 * vibrato, -1, 1);
    }

    return buffer;
  }

  function generateOrganSample(ac, rootNote) {
    var freq = 440 * Math.pow(2, (rootNote - 69) / 12);
    var duration = 3.0;
    var sampleRate = ac.sampleRate;
    var length = Math.floor(sampleRate * duration);
    var buffer = ac.createBuffer(1, length, sampleRate);
    var data = buffer.getChannelData(0);

    // Organ drawbar registrations (Hammond-like)
    // Drawbars: sub-third, sub, unison, 8va-quint, 8va, 10th, 12th, 15th, 17th
    var drawbars = [0.5, 0.8, 1.0, 0.0, 0.6, 0.0, 0.4, 0.3, 0.1];
    var drawbarFreqMult = [0.5, 1.0, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0];

    for (var i = 0; i < length; i++) {
      var t = i / sampleRate;
      var sample = 0;
      for (var d = 0; d < drawbars.length; d++) {
        if (drawbars[d] === 0) continue;
        var hFreq = freq * drawbarFreqMult[d];
        if (hFreq > sampleRate / 2) continue;
        sample += drawbars[d] * Math.sin(2 * Math.PI * hFreq * t);
      }
      // Add subtle key click at start
      var click = Math.exp(-200 * t) * 0.15 * (Math.random() * 2 - 1);
      // Add subtle chorus/vibrato
      var chorus = 0.15 * Math.sin(2 * Math.PI * freq * 1.003 * t);
      data[i] = clamp((sample + click + chorus) * 0.15, -1, 1);
    }

    return buffer;
  }

  // Built-in sample set definitions
  var SAMPLE_SET_DEFS = {
    'piano': { generator: generatePianoSample, rootNotes: [36, 48, 60, 72, 84] },
    'strings': { generator: generateStringsSample, rootNotes: [36, 48, 60, 72, 84] },
    'organ': { generator: generateOrganSample, rootNotes: [36, 48, 60, 72] }
  };

  // ---- Sample Zone ----
  function SampleZone(audioBuffer, options) {
    options = options || {};
    this.buffer = audioBuffer;
    this.rootNote = options.rootNote || 60;
    this.keyRangeLow = options.keyRangeLow || 0;
    this.keyRangeHigh = options.keyRangeHigh || 127;
    this.velocityLow = options.velocityLow || 0;
    this.velocityHigh = options.velocityHigh || 127;
    this.loopStart = options.loopStart || 0;
    this.loopEnd = options.loopEnd || 0;
    this.loopEnabled = options.loopEnabled || false;
  }

  // ---- Sampler Voice ----
  function SamplerVoice(ac, zone, params, outputNode) {
    this.ac = ac;
    this.zone = zone;
    this.params = params;
    this.active = false;
    this.released = false;
    this.pitch = 60;

    // Create source
    this.source = ac.createBufferSource();
    var buf = zone.buffer;

    // Handle reverse
    if (params.reverse) {
      var revBuf = ac.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
      for (var ch = 0; ch < buf.numberOfChannels; ch++) {
        var srcData = buf.getChannelData(ch);
        var dstData = revBuf.getChannelData(ch);
        for (var i = 0; i < srcData.length; i++) {
          dstData[i] = srcData[srcData.length - 1 - i];
        }
      }
      this.source.buffer = revBuf;
    } else {
      this.source.buffer = buf;
    }

    // Loop
    if (zone.loopEnabled) {
      this.source.loop = true;
      this.source.loopStart = zone.loopStart;
      this.source.loopEnd = zone.loopEnd > 0 ? zone.loopEnd : buf.duration;
    }

    // Filter
    this.filter = ac.createBiquadFilter();
    this.filter.type = params.filterType;
    this.filter.frequency.value = params.filterCutoff;
    this.filter.Q.value = params.filterResonance;

    // Amp envelope
    this.ampEnv = ac.createGain();
    this.ampEnv.gain.value = 0;

    // Output gain
    this.outputGain = ac.createGain();
    this.outputGain.gain.value = params.masterGain;

    // Routing
    this.source.connect(this.filter);
    this.filter.connect(this.ampEnv);
    this.ampEnv.connect(this.outputGain);
    this.outputGain.connect(outputNode);
  }

  SamplerVoice.prototype.start = function (pitch, velocity, time) {
    var p = this.params;
    var t = time || this.ac.currentTime;
    this.pitch = pitch;
    this.active = true;
    this.released = false;

    // Pitch shift via playback rate
    var semitones = pitch - this.zone.rootNote;
    this.source.playbackRate.value = Math.pow(2, semitones / 12);

    var vol = (velocity / 127) * p.masterGain;

    // Filter envelope
    var cutoff = clamp(p.filterCutoff, 20, 20000);
    var fEnvPeak = clamp(cutoff + p.filterEnvAmount * 4000, 20, 20000);
    var fSustain = clamp(cutoff + p.filterEnvAmount * 4000 * p.filterSustain, 20, 20000);
    this.filter.frequency.cancelScheduledValues(t);
    this.filter.frequency.setValueAtTime(cutoff, t);
    this.filter.frequency.linearRampToValueAtTime(fEnvPeak, t + Math.max(p.filterAttack, 0.001));
    this.filter.frequency.linearRampToValueAtTime(fSustain, t + p.filterAttack + Math.max(p.filterDecay, 0.001));

    // Amp envelope
    this.ampEnv.gain.cancelScheduledValues(t);
    this.ampEnv.gain.setValueAtTime(0.0001, t);
    this.ampEnv.gain.linearRampToValueAtTime(vol, t + Math.max(p.attackTime, 0.001));
    this.ampEnv.gain.linearRampToValueAtTime(vol * p.sustainLevel, t + p.attackTime + Math.max(p.decayTime, 0.001));

    // Calculate start offset based on sampleStart param
    var bufDuration = this.zone.buffer.duration;
    var startOffset = p.sampleStart * bufDuration;
    var endOffset = p.sampleEnd * bufDuration;
    var playDuration = endOffset - startOffset;

    this.source.start(t, startOffset, p.oneShot ? playDuration : undefined);

    // For one-shot, schedule auto-stop
    if (p.oneShot) {
      var self = this;
      var actualDuration = playDuration / this.source.playbackRate.value;
      self.stopTimeout = setTimeout(function () {
        self._stop();
      }, actualDuration * 1000);
    }
  };

  SamplerVoice.prototype.release = function (time) {
    if (!this.active || this.released) return;
    if (this.params.oneShot) return; // one-shot ignores noteOff
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
    var stopDelay = Math.max(relTime, fRelTime) + 0.05;
    self.stopTimeout = setTimeout(function () {
      self._stop();
    }, stopDelay * 1000);
  };

  SamplerVoice.prototype._stop = function () {
    this.active = false;
    try { this.source.stop(); } catch (e) { /* */ }
    try { this.source.disconnect(); } catch (e) { /* */ }
    try { this.outputGain.disconnect(); } catch (e) { /* */ }
  };

  SamplerVoice.prototype.forceStop = function () {
    if (this.stopTimeout) clearTimeout(this.stopTimeout);
    this._stop();
  };

  // ---- Sampler Instance ----
  function create(audioContext, outputNode) {
    var ac = audioContext || DAW.AudioEngine.getContext();
    var output = outputNode || ac.destination;
    var params = deepCopy(DEFAULT_PARAMS);
    var zones = [];
    var activeVoices = {}; // pitch -> voice
    var voiceCount = 0;

    function findZone(pitch, velocity) {
      var best = null;
      var bestDist = Infinity;
      for (var i = 0; i < zones.length; i++) {
        var z = zones[i];
        if (pitch >= z.keyRangeLow && pitch <= z.keyRangeHigh &&
            velocity >= z.velocityLow && velocity <= z.velocityHigh) {
          var dist = Math.abs(pitch - z.rootNote);
          if (dist < bestDist) {
            bestDist = dist;
            best = z;
          }
        }
      }
      return best;
    }

    function loadSample(audioBuffer, options) {
      var zone = new SampleZone(audioBuffer, options);
      zones.push(zone);
      return zone;
    }

    function clearSamples() {
      zones = [];
    }

    function loadSampleSet(name) {
      clearSamples();
      var def = SAMPLE_SET_DEFS[name];
      if (!def) return;

      var rootNotes = def.rootNotes;
      for (var i = 0; i < rootNotes.length; i++) {
        var root = rootNotes[i];
        var buf = def.generator(ac, root);

        // Calculate key range: halfway between adjacent root notes
        var low = (i === 0) ? 0 : Math.floor((rootNotes[i - 1] + root) / 2) + 1;
        var high = (i === rootNotes.length - 1) ? 127 : Math.floor((root + rootNotes[i + 1]) / 2);

        loadSample(buf, {
          rootNote: root,
          keyRangeLow: low,
          keyRangeHigh: high,
          velocityLow: 0,
          velocityHigh: 127
        });
      }
    }

    function noteOn(pitch, velocity, time) {
      velocity = velocity || 100;
      time = time || ac.currentTime;

      // Release existing voice on same pitch
      if (activeVoices[pitch]) {
        noteOff(pitch, time);
      }

      // Voice stealing
      if (voiceCount >= params.polyphony) {
        var keys = Object.keys(activeVoices);
        if (keys.length > 0) {
          var stealKey = keys[0];
          activeVoices[stealKey].forceStop();
          delete activeVoices[stealKey];
          voiceCount--;
        }
      }

      var zone = findZone(pitch, velocity);
      if (!zone) return;

      var voice = new SamplerVoice(ac, zone, params, output);
      voice.start(pitch, velocity, time);
      activeVoices[pitch] = voice;
      voiceCount++;
    }

    function noteOff(pitch, time) {
      time = time || ac.currentTime;
      var voice = activeVoices[pitch];
      if (!voice) return;
      voice.release(time);
      delete activeVoices[pitch];
      voiceCount = Math.max(0, voiceCount - 1);
    }

    function setParam(name, value) {
      if (params.hasOwnProperty(name)) {
        params[name] = value;
      }
    }

    function getParams() {
      return deepCopy(params);
    }

    function panic() {
      var keys = Object.keys(activeVoices);
      for (var i = 0; i < keys.length; i++) {
        activeVoices[keys[i]].forceStop();
      }
      activeVoices = {};
      voiceCount = 0;
    }

    function getSampleSets() {
      return Object.keys(SAMPLE_SET_DEFS);
    }

    function getZoneCount() {
      return zones.length;
    }

    return {
      noteOn: noteOn,
      noteOff: noteOff,
      setParam: setParam,
      getParams: getParams,
      loadSample: loadSample,
      loadSampleSet: loadSampleSet,
      clearSamples: clearSamples,
      getSampleSets: getSampleSets,
      getZoneCount: getZoneCount,
      panic: panic
    };
  }

  return {
    create: create,
    getSampleSetNames: function () { return Object.keys(SAMPLE_SET_DEFS); }
  };
})();
