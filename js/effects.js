var DAW = DAW || {};

DAW.Effects = (function () {
  'use strict';

  var EFFECT_TYPES = [
    'eq', 'compressor', 'reverb', 'delay', 'chorus',
    'phaser', 'saturation', 'noisegate', 'limiter', 'stereoimager'
  ];

  // ─── Utility helpers ────────────────────────────────────────────────

  function clamp(val, min, max) {
    return val < min ? min : val > max ? max : val;
  }

  function dBToLinear(db) {
    return Math.pow(10, db / 20);
  }

  function makeBaseEffect(type, inputNode, outputNode, params) {
    var bypassed = false;
    var directBypass = inputNode.context.createGain();
    directBypass.gain.value = 0;
    inputNode.connect(directBypass);
    directBypass.connect(outputNode);

    return {
      type: type,
      input: inputNode,
      output: outputNode,
      node: inputNode,
      _params: params,
      _bypassed: bypassed,
      _directBypass: directBypass,
      setParam: function (name, value) {
        if (params[name] !== undefined) {
          params[name].value = value;
          if (params[name].apply) {
            params[name].apply(value);
          }
        }
      },
      getParams: function () {
        var result = {};
        var keys = Object.keys(params);
        for (var i = 0; i < keys.length; i++) {
          result[keys[i]] = params[keys[i]].value;
        }
        return result;
      },
      bypass: function (state) {
        bypassed = (state !== undefined) ? !!state : !bypassed;
        if (bypassed) {
          directBypass.gain.value = 1;
          outputNode.gain ? (outputNode.gain.value = 0) : null;
        } else {
          directBypass.gain.value = 0;
          outputNode.gain ? (outputNode.gain.value = 1) : null;
        }
        return bypassed;
      },
      dispose: function () {
        try {
          inputNode.disconnect();
          outputNode.disconnect();
          directBypass.disconnect();
        } catch (e) { /* already disconnected */ }
      }
    };
  }

  // ─── Parametric EQ ──────────────────────────────────────────────────

  function createParametricEQ(ac) {
    var input = ac.createGain();
    var output = ac.createGain();

    var highpass = ac.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 20;
    highpass.Q.value = 0.707;

    var lowShelf = ac.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 200;
    lowShelf.gain.value = 0;
    lowShelf.Q.value = 1;

    var midPeak = ac.createBiquadFilter();
    midPeak.type = 'peaking';
    midPeak.frequency.value = 1000;
    midPeak.gain.value = 0;
    midPeak.Q.value = 1;

    var highShelf = ac.createBiquadFilter();
    highShelf.type = 'highshelf';
    highShelf.frequency.value = 6000;
    highShelf.gain.value = 0;
    highShelf.Q.value = 1;

    var lowpass = ac.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 20000;
    lowpass.Q.value = 0.707;

    input.connect(highpass);
    highpass.connect(lowShelf);
    lowShelf.connect(midPeak);
    midPeak.connect(highShelf);
    highShelf.connect(lowpass);
    lowpass.connect(output);

    var params = {
      highpassFreq:    { value: 20,    apply: function (v) { highpass.frequency.value = clamp(v, 10, 20000); } },
      highpassQ:       { value: 0.707, apply: function (v) { highpass.Q.value = clamp(v, 0.1, 20); } },
      lowFreq:         { value: 200,   apply: function (v) { lowShelf.frequency.value = clamp(v, 20, 2000); } },
      lowGain:         { value: 0,     apply: function (v) { lowShelf.gain.value = clamp(v, -24, 24); } },
      lowQ:            { value: 1,     apply: function (v) { lowShelf.Q.value = clamp(v, 0.1, 20); } },
      midFreq:         { value: 1000,  apply: function (v) { midPeak.frequency.value = clamp(v, 100, 16000); } },
      midGain:         { value: 0,     apply: function (v) { midPeak.gain.value = clamp(v, -24, 24); } },
      midQ:            { value: 1,     apply: function (v) { midPeak.Q.value = clamp(v, 0.1, 20); } },
      highFreq:        { value: 6000,  apply: function (v) { highShelf.frequency.value = clamp(v, 2000, 20000); } },
      highGain:        { value: 0,     apply: function (v) { highShelf.gain.value = clamp(v, -24, 24); } },
      highQ:           { value: 1,     apply: function (v) { highShelf.Q.value = clamp(v, 0.1, 20); } },
      lowpassFreq:     { value: 20000, apply: function (v) { lowpass.frequency.value = clamp(v, 200, 20000); } },
      lowpassQ:        { value: 0.707, apply: function (v) { lowpass.Q.value = clamp(v, 0.1, 20); } }
    };

    var effect = makeBaseEffect('eq', input, output, params);
    effect._filters = { highpass: highpass, lowShelf: lowShelf, midPeak: midPeak, highShelf: highShelf, lowpass: lowpass };
    return effect;
  }

  // ─── Compressor ─────────────────────────────────────────────────────

  function createCompressor(ac) {
    var input = ac.createGain();
    var output = ac.createGain();

    var comp = ac.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    comp.knee.value = 30;

    var makeupGain = ac.createGain();
    makeupGain.gain.value = 1;

    input.connect(comp);
    comp.connect(makeupGain);
    makeupGain.connect(output);

    var params = {
      threshold:  { value: -24,   apply: function (v) { comp.threshold.value = clamp(v, -100, 0); } },
      ratio:      { value: 4,     apply: function (v) { comp.ratio.value = clamp(v, 1, 20); } },
      attack:     { value: 0.003, apply: function (v) { comp.attack.value = clamp(v, 0, 1); } },
      release:    { value: 0.25,  apply: function (v) { comp.release.value = clamp(v, 0, 1); } },
      knee:       { value: 30,    apply: function (v) { comp.knee.value = clamp(v, 0, 40); } },
      makeupGain: { value: 0,     apply: function (v) { makeupGain.gain.value = dBToLinear(clamp(v, -12, 36)); } }
    };

    var effect = makeBaseEffect('compressor', input, output, params);
    effect.getReduction = function () {
      return comp.reduction;
    };
    effect._compressor = comp;
    return effect;
  }

  // ─── Reverb ─────────────────────────────────────────────────────────

  function generateImpulseResponse(ac, roomSize, decay, damping) {
    var sampleRate = ac.sampleRate;
    var length = Math.max(0.5, roomSize) * sampleRate * Math.max(0.1, decay);
    length = Math.min(length, sampleRate * 6);
    var numChannels = 2;
    var buffer = ac.createBuffer(numChannels, length, sampleRate);

    for (var ch = 0; ch < numChannels; ch++) {
      var data = buffer.getChannelData(ch);
      for (var i = 0; i < length; i++) {
        var t = i / sampleRate;
        var envelope = Math.pow(1 - i / length, damping * 2 + 1);
        var earlyReflection = 0;
        if (i < sampleRate * 0.08) {
          var numReflections = 6;
          for (var r = 0; r < numReflections; r++) {
            var reflTime = (r + 1) * 0.01 * roomSize;
            var reflSample = Math.floor(reflTime * sampleRate);
            if (i >= reflSample && i < reflSample + 32) {
              earlyReflection += (Math.random() * 2 - 1) * Math.pow(0.7, r);
            }
          }
        }
        var noise = (Math.random() * 2 - 1);
        var dampingFilter = 1 - (damping * t * 0.5);
        dampingFilter = Math.max(0, dampingFilter);
        data[i] = (noise * envelope * dampingFilter + earlyReflection * 0.3) * decay;
      }
    }
    return buffer;
  }

  function createReverb(ac) {
    var input = ac.createGain();
    var output = ac.createGain();

    var dryGain = ac.createGain();
    dryGain.gain.value = 0.5;

    var wetGain = ac.createGain();
    wetGain.gain.value = 0.5;

    var preDelay = ac.createDelay(1);
    preDelay.delayTime.value = 0.01;

    var convolver = ac.createConvolver();
    var irBuffer = generateImpulseResponse(ac, 1.5, 1.5, 0.5);
    convolver.buffer = irBuffer;

    input.connect(dryGain);
    dryGain.connect(output);

    input.connect(preDelay);
    preDelay.connect(convolver);
    convolver.connect(wetGain);
    wetGain.connect(output);

    var currentRoomSize = 1.5;
    var currentDecay = 1.5;
    var currentDamping = 0.5;

    function rebuildIR() {
      var newBuffer = generateImpulseResponse(ac, currentRoomSize, currentDecay, currentDamping);
      convolver.buffer = newBuffer;
    }

    var params = {
      roomSize: {
        value: 1.5,
        apply: function (v) { currentRoomSize = clamp(v, 0.1, 5); rebuildIR(); }
      },
      decay: {
        value: 1.5,
        apply: function (v) { currentDecay = clamp(v, 0.1, 5); rebuildIR(); }
      },
      damping: {
        value: 0.5,
        apply: function (v) { currentDamping = clamp(v, 0, 1); rebuildIR(); }
      },
      mix: {
        value: 0.5,
        apply: function (v) {
          v = clamp(v, 0, 1);
          wetGain.gain.value = v;
          dryGain.gain.value = 1 - v;
        }
      },
      preDelay: {
        value: 0.01,
        apply: function (v) { preDelay.delayTime.value = clamp(v, 0, 0.5); }
      }
    };

    return makeBaseEffect('reverb', input, output, params);
  }

  // ─── Delay ──────────────────────────────────────────────────────────

  function tempoSyncToSeconds(subdivision, bpm) {
    var beatDuration = 60.0 / bpm;
    var table = {
      '1':     4.0,
      '1/2':   2.0,
      '1/2d':  3.0,
      '1/4':   1.0,
      '1/4d':  1.5,
      '1/4t':  2 / 3,
      '1/8':   0.5,
      '1/8d':  0.75,
      '1/8t':  1 / 3,
      '1/16':  0.25,
      '1/16d': 0.375,
      '1/16t': 1 / 6,
      '1/32':  0.125
    };
    var multiplier = table[subdivision] || 1.0;
    return beatDuration * multiplier;
  }

  function createDelay(ac) {
    var input = ac.createGain();
    var output = ac.createGain();

    var MAX_DELAY = 5;
    var dryGain = ac.createGain();
    dryGain.gain.value = 1;

    var wetGain = ac.createGain();
    wetGain.gain.value = 0.5;

    var delayL = ac.createDelay(MAX_DELAY);
    delayL.delayTime.value = 0.375;

    var delayR = ac.createDelay(MAX_DELAY);
    delayR.delayTime.value = 0.375;

    var feedbackL = ac.createGain();
    feedbackL.gain.value = 0.4;

    var feedbackR = ac.createGain();
    feedbackR.gain.value = 0.4;

    var fbHighpass = ac.createBiquadFilter();
    fbHighpass.type = 'highpass';
    fbHighpass.frequency.value = 200;

    var fbLowpass = ac.createBiquadFilter();
    fbLowpass.type = 'lowpass';
    fbLowpass.frequency.value = 6000;

    var merger = ac.createChannelMerger(2);

    var isPingPong = false;
    var currentTime = 0.375;

    function routeNormal() {
      try {
        input.disconnect();
        delayL.disconnect();
        delayR.disconnect();
        feedbackL.disconnect();
        feedbackR.disconnect();
        fbHighpass.disconnect();
        fbLowpass.disconnect();
        merger.disconnect();
      } catch (e) { /* first run */ }

      input.connect(dryGain);
      dryGain.connect(output);

      input.connect(delayL);
      delayL.connect(fbHighpass);
      fbHighpass.connect(fbLowpass);
      fbLowpass.connect(feedbackL);
      feedbackL.connect(delayL);

      delayL.connect(wetGain);
      wetGain.connect(output);
    }

    function routePingPong() {
      try {
        input.disconnect();
        delayL.disconnect();
        delayR.disconnect();
        feedbackL.disconnect();
        feedbackR.disconnect();
        fbHighpass.disconnect();
        fbLowpass.disconnect();
        merger.disconnect();
        wetGain.disconnect();
      } catch (e) { /* first run */ }

      input.connect(dryGain);
      dryGain.connect(output);

      input.connect(delayL);
      delayL.connect(feedbackL);
      feedbackL.connect(fbHighpass);
      fbHighpass.connect(fbLowpass);
      fbLowpass.connect(delayR);
      delayR.connect(feedbackR);
      feedbackR.connect(delayL);

      delayL.connect(merger, 0, 0);
      delayR.connect(merger, 0, 1);
      merger.connect(wetGain);
      wetGain.connect(output);
    }

    routeNormal();

    var params = {
      time: {
        value: 375,
        apply: function (v) {
          currentTime = clamp(v, 1, MAX_DELAY * 1000) / 1000;
          delayL.delayTime.value = currentTime;
          delayR.delayTime.value = currentTime;
        }
      },
      feedback: {
        value: 0.4,
        apply: function (v) {
          v = clamp(v, 0, 0.95);
          feedbackL.gain.value = v;
          feedbackR.gain.value = v;
        }
      },
      mix: {
        value: 0.5,
        apply: function (v) {
          v = clamp(v, 0, 1);
          wetGain.gain.value = v;
          dryGain.gain.value = 1 - v * 0.5;
        }
      },
      pingPong: {
        value: 0,
        apply: function (v) {
          isPingPong = !!v;
          if (isPingPong) {
            routePingPong();
          } else {
            routeNormal();
          }
        }
      },
      fbHighpass: {
        value: 200,
        apply: function (v) { fbHighpass.frequency.value = clamp(v, 20, 5000); }
      },
      fbLowpass: {
        value: 6000,
        apply: function (v) { fbLowpass.frequency.value = clamp(v, 500, 20000); }
      },
      tempoSync: {
        value: 0,
        apply: function () { /* handled externally */ }
      },
      syncSubdivision: {
        value: '1/4',
        apply: function () { /* handled externally */ }
      }
    };

    var effect = makeBaseEffect('delay', input, output, params);

    effect.syncToTempo = function (bpm, subdivision) {
      var seconds = tempoSyncToSeconds(subdivision || params.syncSubdivision.value, bpm);
      var ms = seconds * 1000;
      params.time.value = ms;
      params.time.apply(ms);
    };

    return effect;
  }

  // ─── Chorus ─────────────────────────────────────────────────────────

  function createChorus(ac) {
    var input = ac.createGain();
    var output = ac.createGain();

    var dryGain = ac.createGain();
    dryGain.gain.value = 0.7;

    var wetGain = ac.createGain();
    wetGain.gain.value = 0.5;

    var delayNode = ac.createDelay(0.1);
    delayNode.delayTime.value = 0.007;

    var delayNode2 = ac.createDelay(0.1);
    delayNode2.delayTime.value = 0.012;

    var lfo = ac.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 1.5;

    var lfoGain = ac.createGain();
    lfoGain.gain.value = 0.002;

    var lfo2 = ac.createOscillator();
    lfo2.type = 'sine';
    lfo2.frequency.value = 1.8;

    var lfoGain2 = ac.createGain();
    lfoGain2.gain.value = 0.0015;

    lfo.connect(lfoGain);
    lfoGain.connect(delayNode.delayTime);

    lfo2.connect(lfoGain2);
    lfoGain2.connect(delayNode2.delayTime);

    input.connect(dryGain);
    dryGain.connect(output);

    input.connect(delayNode);
    input.connect(delayNode2);
    delayNode.connect(wetGain);
    delayNode2.connect(wetGain);
    wetGain.connect(output);

    lfo.start();
    lfo2.start();

    var params = {
      rate: {
        value: 1.5,
        apply: function (v) {
          v = clamp(v, 0.05, 10);
          lfo.frequency.value = v;
          lfo2.frequency.value = v * 1.2;
        }
      },
      depth: {
        value: 0.002,
        apply: function (v) {
          v = clamp(v, 0, 0.02);
          lfoGain.gain.value = v;
          lfoGain2.gain.value = v * 0.75;
        }
      },
      mix: {
        value: 0.5,
        apply: function (v) {
          v = clamp(v, 0, 1);
          wetGain.gain.value = v;
          dryGain.gain.value = 1 - v * 0.5;
        }
      }
    };

    var effect = makeBaseEffect('chorus', input, output, params);

    var origDispose = effect.dispose;
    effect.dispose = function () {
      try { lfo.stop(); } catch (e) { /* */ }
      try { lfo2.stop(); } catch (e) { /* */ }
      origDispose();
    };

    return effect;
  }

  // ─── Phaser ─────────────────────────────────────────────────────────

  function createPhaser(ac) {
    var input = ac.createGain();
    var output = ac.createGain();

    var dryGain = ac.createGain();
    dryGain.gain.value = 0.5;

    var wetGain = ac.createGain();
    wetGain.gain.value = 0.5;

    var feedback = ac.createGain();
    feedback.gain.value = 0.5;

    var numStages = 6;
    var allpassFilters = [];
    var baseFrequencies = [200, 400, 800, 1600, 3200, 6400];

    for (var i = 0; i < numStages; i++) {
      var ap = ac.createBiquadFilter();
      ap.type = 'allpass';
      ap.frequency.value = baseFrequencies[i] || 1000;
      ap.Q.value = 5;
      allpassFilters.push(ap);
    }

    var lfo = ac.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.5;

    var lfoGains = [];
    for (var j = 0; j < numStages; j++) {
      var lg = ac.createGain();
      lg.gain.value = baseFrequencies[j] * 0.5;
      lfo.connect(lg);
      lg.connect(allpassFilters[j].frequency);
      lfoGains.push(lg);
    }

    input.connect(dryGain);
    dryGain.connect(output);

    var chainInput = input;
    for (var k = 0; k < numStages; k++) {
      chainInput.connect(allpassFilters[k]);
      chainInput = allpassFilters[k];
    }

    allpassFilters[numStages - 1].connect(wetGain);
    wetGain.connect(output);

    allpassFilters[numStages - 1].connect(feedback);
    feedback.connect(allInput());

    function chainInput_() { return allpassFilters[0]; }
    function allInput() { return allpassFilters[0]; }

    feedback.connect(allpassFilters[0]);

    lfo.start();

    var params = {
      rate: {
        value: 0.5,
        apply: function (v) { lfo.frequency.value = clamp(v, 0.01, 10); }
      },
      depth: {
        value: 0.5,
        apply: function (v) {
          v = clamp(v, 0, 1);
          for (var m = 0; m < lfoGains.length; m++) {
            lfoGains[m].gain.value = baseFrequencies[m] * v;
          }
        }
      },
      feedback: {
        value: 0.5,
        apply: function (v) { feedback.gain.value = clamp(v, 0, 0.95); }
      },
      stages: {
        value: numStages,
        apply: function () {
          /* stages are fixed at creation; value stored for metadata */
        }
      },
      mix: {
        value: 0.5,
        apply: function (v) {
          v = clamp(v, 0, 1);
          wetGain.gain.value = v;
          dryGain.gain.value = 1 - v;
        }
      }
    };

    var effect = makeBaseEffect('phaser', input, output, params);

    var origDispose = effect.dispose;
    effect.dispose = function () {
      try { lfo.stop(); } catch (e) { /* */ }
      origDispose();
    };

    return effect;
  }

  // ─── Saturation / Distortion ────────────────────────────────────────

  function makeDistortionCurve(amount, type, samples) {
    samples = samples || 44100;
    var curve = new Float32Array(samples);
    var x;

    for (var i = 0; i < samples; i++) {
      x = (i * 2) / samples - 1;

      if (type === 'soft') {
        // Soft clipping: tanh approximation
        var k = amount * 10 + 1;
        curve[i] = Math.tanh(k * x);
      } else if (type === 'hard') {
        // Hard clipping
        var threshold = Math.max(0.01, 1 - amount * 0.9);
        if (x > threshold) {
          curve[i] = threshold;
        } else if (x < -threshold) {
          curve[i] = -threshold;
        } else {
          curve[i] = x;
        }
      } else {
        // Tube-style: asymmetric soft clipping
        var drive = amount * 5 + 1;
        if (x >= 0) {
          curve[i] = 1 - Math.exp(-drive * x);
        } else {
          curve[i] = -(1 - Math.exp(drive * x)) * 0.8;
        }
      }
    }
    return curve;
  }

  function createSaturation(ac) {
    var input = ac.createGain();
    var output = ac.createGain();

    var dryGain = ac.createGain();
    dryGain.gain.value = 0.5;

    var wetGain = ac.createGain();
    wetGain.gain.value = 0.5;

    var driveGain = ac.createGain();
    driveGain.gain.value = 1;

    var waveshaper = ac.createWaveShaper();
    waveshaper.curve = makeDistortionCurve(0.3, 'tube');
    waveshaper.oversample = '4x';

    var toneFilter = ac.createBiquadFilter();
    toneFilter.type = 'lowpass';
    toneFilter.frequency.value = 8000;
    toneFilter.Q.value = 0.707;

    var outputTrim = ac.createGain();
    outputTrim.gain.value = 0.7;

    input.connect(dryGain);
    dryGain.connect(output);

    input.connect(driveGain);
    driveGain.connect(waveshaper);
    waveshaper.connect(toneFilter);
    toneFilter.connect(outputTrim);
    outputTrim.connect(wetGain);
    wetGain.connect(output);

    var currentDrive = 0.3;
    var currentCurveType = 'tube';

    var params = {
      drive: {
        value: 0.3,
        apply: function (v) {
          currentDrive = clamp(v, 0, 1);
          driveGain.gain.value = 1 + currentDrive * 4;
          waveshaper.curve = makeDistortionCurve(currentDrive, currentCurveType);
          outputTrim.gain.value = 1 / (1 + currentDrive * 2);
        }
      },
      tone: {
        value: 8000,
        apply: function (v) { toneFilter.frequency.value = clamp(v, 500, 20000); }
      },
      mix: {
        value: 0.5,
        apply: function (v) {
          v = clamp(v, 0, 1);
          wetGain.gain.value = v;
          dryGain.gain.value = 1 - v;
        }
      },
      curveType: {
        value: 'tube',
        apply: function (v) {
          if (v === 'soft' || v === 'hard' || v === 'tube') {
            currentCurveType = v;
            waveshaper.curve = makeDistortionCurve(currentDrive, currentCurveType);
          }
        }
      }
    };

    return makeBaseEffect('saturation', input, output, params);
  }

  // ─── Noise Gate ─────────────────────────────────────────────────────

  function createNoiseGate(ac) {
    var input = ac.createGain();
    var output = ac.createGain();

    var gateGain = ac.createGain();
    gateGain.gain.value = 1;

    var analyser = ac.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.3;

    input.connect(analyser);
    input.connect(gateGain);
    gateGain.connect(output);

    var threshold = -40;
    var attackTime = 0.001;
    var releaseTime = 0.05;
    var range = -80;
    var isOpen = true;
    var animFrameId = null;
    var disposed = false;

    var timeData = new Float32Array(analyser.fftSize);

    function getLevel() {
      analyser.getFloatTimeDomainData(timeData);
      var sum = 0;
      for (var i = 0; i < timeData.length; i++) {
        sum += timeData[i] * timeData[i];
      }
      var rms = Math.sqrt(sum / timeData.length);
      if (rms === 0) return -Infinity;
      return 20 * Math.log10(rms);
    }

    function process() {
      if (disposed) return;
      var level = getLevel();
      var now = ac.currentTime;
      var openGain = 1;
      var closedGain = dBToLinear(range);

      if (level > threshold) {
        if (!isOpen) {
          isOpen = true;
          gateGain.gain.cancelScheduledValues(now);
          gateGain.gain.setTargetAtTime(openGain, now, attackTime / 3);
        }
      } else {
        if (isOpen) {
          isOpen = false;
          gateGain.gain.cancelScheduledValues(now);
          gateGain.gain.setTargetAtTime(closedGain, now, releaseTime / 3);
        }
      }

      animFrameId = requestAnimationFrame(process);
    }

    process();

    var params = {
      threshold: {
        value: -40,
        apply: function (v) { threshold = clamp(v, -96, 0); }
      },
      attack: {
        value: 0.001,
        apply: function (v) { attackTime = clamp(v, 0.0001, 0.1); }
      },
      release: {
        value: 0.05,
        apply: function (v) { releaseTime = clamp(v, 0.005, 0.5); }
      },
      range: {
        value: -80,
        apply: function (v) { range = clamp(v, -96, 0); }
      }
    };

    var effect = makeBaseEffect('noisegate', input, output, params);

    var origDispose = effect.dispose;
    effect.dispose = function () {
      disposed = true;
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
      }
      origDispose();
    };

    return effect;
  }

  // ─── Limiter ────────────────────────────────────────────────────────

  function createLimiter(ac) {
    var input = ac.createGain();
    var output = ac.createGain();

    var limiterComp = ac.createDynamicsCompressor();
    limiterComp.threshold.value = -1;
    limiterComp.ratio.value = 20;
    limiterComp.attack.value = 0.001;
    limiterComp.release.value = 0.1;
    limiterComp.knee.value = 0;

    var ceilingGain = ac.createGain();
    ceilingGain.gain.value = dBToLinear(-0.3);

    input.connect(limiterComp);
    limiterComp.connect(ceilingGain);
    ceilingGain.connect(output);

    var params = {
      ceiling: {
        value: -0.3,
        apply: function (v) {
          v = clamp(v, -12, 0);
          limiterComp.threshold.value = v;
          ceilingGain.gain.value = dBToLinear(v);
        }
      },
      release: {
        value: 0.1,
        apply: function (v) { limiterComp.release.value = clamp(v, 0.01, 1); }
      }
    };

    var effect = makeBaseEffect('limiter', input, output, params);
    effect.getReduction = function () {
      return limiterComp.reduction;
    };
    effect._compressor = limiterComp;
    return effect;
  }

  // ─── Stereo Imager ──────────────────────────────────────────────────

  function createStereoImager(ac) {
    var input = ac.createGain();
    var output = ac.createGain();

    var splitter = ac.createChannelSplitter(2);
    var merger = ac.createChannelMerger(2);

    // M/S encoding: Mid = (L+R)/2, Side = (L-R)/2
    // M/S decoding: L = Mid+Side, R = Mid-Side
    var midGainL = ac.createGain();
    midGainL.gain.value = 0.5;
    var midGainR = ac.createGain();
    midGainR.gain.value = 0.5;

    var sideGainL = ac.createGain();
    sideGainL.gain.value = 0.5;
    var sideGainR = ac.createGain();
    sideGainR.gain.value = -0.5;

    // Mid channel = (L+R) * midLevel
    var midSum = ac.createGain();
    midSum.gain.value = 1;

    // Side channel = (L-R) * sideLevel
    var sideSum = ac.createGain();
    sideSum.gain.value = 1;

    // Build Mid: L*0.5 + R*0.5
    splitter.connect(midGainL, 0);
    splitter.connect(midGainR, 1);
    midGainL.connect(midSum);
    midGainR.connect(midSum);

    // Build Side: L*0.5 + R*(-0.5)
    splitter.connect(sideGainL, 0);
    splitter.connect(sideGainR, 1);
    sideGainL.connect(sideSum);
    sideGainR.connect(sideSum);

    // Decode back: L = Mid + Side, R = Mid - Side
    var outLMid = ac.createGain();
    outLMid.gain.value = 1;
    var outLSide = ac.createGain();
    outLSide.gain.value = 1;

    var outRMid = ac.createGain();
    outRMid.gain.value = 1;
    var outRSide = ac.createGain();
    outRSide.gain.value = -1;

    midSum.connect(outLMid);
    sideSum.connect(outLSide);
    midSum.connect(outRMid);
    sideSum.connect(outRSide);

    outLMid.connect(merger, 0, 0);
    outLSide.connect(merger, 0, 0);
    outRMid.connect(merger, 0, 1);
    outRSide.connect(merger, 0, 1);

    input.connect(splitter);
    merger.connect(output);

    var params = {
      width: {
        value: 1,
        apply: function (v) {
          v = clamp(v, 0, 2);
          // width=0: mono (mid only), width=1: normal, width=2: wide (boosted side)
          var midLevel = 2 - v;    // 0->2, 1->1, 2->0
          var sideLevel = v;       // 0->0, 1->1, 2->2

          midSum.gain.value = midLevel;
          sideSum.gain.value = sideLevel;
        }
      }
    };

    return makeBaseEffect('stereoimager', input, output, params);
  }

  // ─── Factory ────────────────────────────────────────────────────────

  function create(type, audioContext) {
    var ac = audioContext || (DAW.AudioEngine ? DAW.AudioEngine.getContext() : null);
    if (!ac) {
      throw new Error('DAW.Effects.create: no AudioContext provided');
    }

    switch (type) {
      case 'eq':           return createParametricEQ(ac);
      case 'compressor':   return createCompressor(ac);
      case 'reverb':       return createReverb(ac);
      case 'delay':        return createDelay(ac);
      case 'chorus':       return createChorus(ac);
      case 'phaser':       return createPhaser(ac);
      case 'saturation':   return createSaturation(ac);
      case 'noisegate':    return createNoiseGate(ac);
      case 'limiter':      return createLimiter(ac);
      case 'stereoimager': return createStereoImager(ac);
      default:
        throw new Error('DAW.Effects.create: unknown type "' + type + '"');
    }
  }

  function getTypes() {
    return EFFECT_TYPES.slice();
  }

  // ─── Public API ─────────────────────────────────────────────────────

  return {
    create: create,
    getTypes: getTypes,
    makeDistortionCurve: makeDistortionCurve,
    tempoSyncToSeconds: tempoSyncToSeconds
  };
})();
