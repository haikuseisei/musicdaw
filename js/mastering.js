var DAW = DAW || {};

DAW.Mastering = (function () {
  'use strict';

  var ac = null;
  var chain = null;
  var bypassed = false;

  // ─── Utility ────────────────────────────────────────────────────────

  function clamp(val, min, max) {
    return val < min ? min : val > max ? max : val;
  }

  function dBToLinear(db) {
    return Math.pow(10, db / 20);
  }

  function linearToDB(lin) {
    if (lin <= 0) return -Infinity;
    return 20 * Math.log10(lin);
  }

  // ─── Multiband Compressor ──────────────────────────────────────────

  function createMultibandCompressor(context) {
    var input = context.createGain();
    var output = context.createGain();

    // Crossover frequencies
    var lowMidFreq = 250;
    var midHighFreq = 4000;

    // Low band: lowpass at lowMidFreq
    var lowLP = context.createBiquadFilter();
    lowLP.type = 'lowpass';
    lowLP.frequency.value = lowMidFreq;
    lowLP.Q.value = 0.707;

    // Mid band: bandpass (highpass + lowpass)
    var midHP = context.createBiquadFilter();
    midHP.type = 'highpass';
    midHP.frequency.value = lowMidFreq;
    midHP.Q.value = 0.707;

    var midLP = context.createBiquadFilter();
    midLP.type = 'lowpass';
    midLP.frequency.value = midHighFreq;
    midLP.Q.value = 0.707;

    // High band: highpass at midHighFreq
    var highHP = context.createBiquadFilter();
    highHP.type = 'highpass';
    highHP.frequency.value = midHighFreq;
    highHP.Q.value = 0.707;

    // Compressors per band
    var lowComp = context.createDynamicsCompressor();
    lowComp.threshold.value = -18;
    lowComp.ratio.value = 3;
    lowComp.attack.value = 0.01;
    lowComp.release.value = 0.15;
    lowComp.knee.value = 6;

    var midComp = context.createDynamicsCompressor();
    midComp.threshold.value = -20;
    midComp.ratio.value = 2.5;
    midComp.attack.value = 0.005;
    midComp.release.value = 0.1;
    midComp.knee.value = 8;

    var highComp = context.createDynamicsCompressor();
    highComp.threshold.value = -22;
    highComp.ratio.value = 3;
    highComp.attack.value = 0.002;
    highComp.release.value = 0.08;
    highComp.knee.value = 6;

    // Makeup gains per band
    var lowGain = context.createGain();
    lowGain.gain.value = 1;
    var midGain = context.createGain();
    midGain.gain.value = 1;
    var highGain = context.createGain();
    highGain.gain.value = 1;

    // Solo/bypass mute nodes
    var lowMute = context.createGain();
    lowMute.gain.value = 1;
    var midMute = context.createGain();
    midMute.gain.value = 1;
    var highMute = context.createGain();
    highMute.gain.value = 1;

    // Route
    input.connect(lowLP);
    lowLP.connect(lowComp);
    lowComp.connect(lowGain);
    lowGain.connect(lowMute);
    lowMute.connect(output);

    input.connect(midHP);
    midHP.connect(midLP);
    midLP.connect(midComp);
    midComp.connect(midGain);
    midGain.connect(midMute);
    midMute.connect(output);

    input.connect(highHP);
    highHP.connect(highComp);
    highComp.connect(highGain);
    highGain.connect(highMute);
    highMute.connect(output);

    var bandSoloState = { low: false, mid: false, high: false };
    var bandBypassState = { low: false, mid: false, high: false };

    function updateBandMutes() {
      var anySolo = bandSoloState.low || bandSoloState.mid || bandSoloState.high;

      if (anySolo) {
        lowMute.gain.value = bandSoloState.low ? 1 : 0;
        midMute.gain.value = bandSoloState.mid ? 1 : 0;
        highMute.gain.value = bandSoloState.high ? 1 : 0;
      } else {
        lowMute.gain.value = bandBypassState.low ? 0 : 1;
        midMute.gain.value = bandBypassState.mid ? 0 : 1;
        highMute.gain.value = bandBypassState.high ? 0 : 1;
      }
    }

    return {
      input: input,
      output: output,
      bands: {
        low: { compressor: lowComp, gain: lowGain, filter: lowLP },
        mid: { compressor: midComp, gain: midGain, filterHP: midHP, filterLP: midLP },
        high: { compressor: highComp, gain: highGain, filter: highHP }
      },

      setCrossover: function (lowMid, midHigh) {
        lowLP.frequency.value = clamp(lowMid, 60, 1000);
        midHP.frequency.value = clamp(lowMid, 60, 1000);
        midLP.frequency.value = clamp(midHigh, 1000, 16000);
        highHP.frequency.value = clamp(midHigh, 1000, 16000);
      },

      setBandParams: function (band, params) {
        var comp = null;
        var gain = null;
        if (band === 'low') { comp = lowComp; gain = lowGain; }
        else if (band === 'mid') { comp = midComp; gain = midGain; }
        else if (band === 'high') { comp = highComp; gain = highGain; }
        if (!comp) return;

        if (params.threshold !== undefined) comp.threshold.value = clamp(params.threshold, -60, 0);
        if (params.ratio !== undefined) comp.ratio.value = clamp(params.ratio, 1, 20);
        if (params.attack !== undefined) comp.attack.value = clamp(params.attack, 0, 1);
        if (params.release !== undefined) comp.release.value = clamp(params.release, 0, 1);
        if (params.knee !== undefined) comp.knee.value = clamp(params.knee, 0, 40);
        if (params.makeupGain !== undefined) gain.gain.value = dBToLinear(clamp(params.makeupGain, -12, 24));
      },

      soloBand: function (band, state) {
        bandSoloState[band] = !!state;
        updateBandMutes();
      },

      bypassBand: function (band, state) {
        bandBypassState[band] = !!state;
        updateBandMutes();
      },

      getReduction: function () {
        return {
          low: lowComp.reduction,
          mid: midComp.reduction,
          high: highComp.reduction
        };
      },

      dispose: function () {
        try {
          input.disconnect();
          output.disconnect();
          lowLP.disconnect(); lowComp.disconnect(); lowGain.disconnect(); lowMute.disconnect();
          midHP.disconnect(); midLP.disconnect(); midComp.disconnect(); midGain.disconnect(); midMute.disconnect();
          highHP.disconnect(); highComp.disconnect(); highGain.disconnect(); highMute.disconnect();
        } catch (e) { /* */ }
      }
    };
  }

  // ─── Stereo Imager (inline) ─────────────────────────────────────────

  function createStereoImager(context) {
    var input = context.createGain();
    var output = context.createGain();

    var splitter = context.createChannelSplitter(2);
    var merger = context.createChannelMerger(2);

    var midGainL = context.createGain();
    midGainL.gain.value = 0.5;
    var midGainR = context.createGain();
    midGainR.gain.value = 0.5;
    var sideGainL = context.createGain();
    sideGainL.gain.value = 0.5;
    var sideGainR = context.createGain();
    sideGainR.gain.value = -0.5;

    var midSum = context.createGain();
    midSum.gain.value = 1;
    var sideSum = context.createGain();
    sideSum.gain.value = 1;

    var outLMid = context.createGain();
    outLMid.gain.value = 1;
    var outLSide = context.createGain();
    outLSide.gain.value = 1;
    var outRMid = context.createGain();
    outRMid.gain.value = 1;
    var outRSide = context.createGain();
    outRSide.gain.value = -1;

    splitter.connect(midGainL, 0);
    splitter.connect(midGainR, 1);
    midGainL.connect(midSum);
    midGainR.connect(midSum);

    splitter.connect(sideGainL, 0);
    splitter.connect(sideGainR, 1);
    sideGainL.connect(sideSum);
    sideGainR.connect(sideSum);

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

    return {
      input: input,
      output: output,
      setWidth: function (v) {
        v = clamp(v, 0, 2);
        midSum.gain.value = 2 - v;
        sideSum.gain.value = v;
      },
      dispose: function () {
        try {
          input.disconnect(); output.disconnect();
          splitter.disconnect(); merger.disconnect();
          midGainL.disconnect(); midGainR.disconnect();
          sideGainL.disconnect(); sideGainR.disconnect();
          midSum.disconnect(); sideSum.disconnect();
          outLMid.disconnect(); outLSide.disconnect();
          outRMid.disconnect(); outRSide.disconnect();
        } catch (e) { /* */ }
      }
    };
  }

  // ─── Dither ─────────────────────────────────────────────────────────

  function createDither(context, bitDepth) {
    bitDepth = bitDepth || 16;
    var bufferSize = 4096;

    // Create TPDF dither noise buffer
    var noiseLength = context.sampleRate * 2;
    var noiseBuffer = context.createBuffer(2, noiseLength, context.sampleRate);

    for (var ch = 0; ch < 2; ch++) {
      var data = noiseBuffer.getChannelData(ch);
      for (var i = 0; i < noiseLength; i++) {
        // TPDF: sum of two uniform random values - 1
        var r1 = Math.random();
        var r2 = Math.random();
        data[i] = (r1 + r2 - 1);
      }
    }

    var input = context.createGain();
    var output = context.createGain();

    // Dither noise source
    var noiseSource = context.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    var noiseGain = context.createGain();
    // Dither amplitude: 1 LSB at target bit depth
    var ditherLevel = 1 / Math.pow(2, bitDepth);
    noiseGain.gain.value = ditherLevel;

    noiseSource.connect(noiseGain);
    noiseGain.connect(output);
    input.connect(output);

    noiseSource.start();

    return {
      input: input,
      output: output,
      setBitDepth: function (bits) {
        bitDepth = clamp(bits, 8, 32);
        noiseGain.gain.value = 1 / Math.pow(2, bitDepth);
      },
      dispose: function () {
        try { noiseSource.stop(); } catch (e) { /* */ }
        try {
          input.disconnect();
          output.disconnect();
          noiseSource.disconnect();
          noiseGain.disconnect();
        } catch (e) { /* */ }
      }
    };
  }

  // ─── Loudness Metering ──────────────────────────────────────────────

  function createLoudnessMeter(context) {
    var input = context.createGain();
    var splitter = context.createChannelSplitter(2);

    var analyserL = context.createAnalyser();
    analyserL.fftSize = 4096;
    analyserL.smoothingTimeConstant = 0;
    var analyserR = context.createAnalyser();
    analyserR.fftSize = 4096;
    analyserR.smoothingTimeConstant = 0;

    // K-weighting filter chain (simplified)
    // Stage 1: high-shelf boost at ~1500 Hz (+4 dB)
    var kweightL = context.createBiquadFilter();
    kweightL.type = 'highshelf';
    kweightL.frequency.value = 1500;
    kweightL.gain.value = 4;

    var kweightR = context.createBiquadFilter();
    kweightR.type = 'highshelf';
    kweightR.frequency.value = 1500;
    kweightR.gain.value = 4;

    // Stage 2: highpass at ~38 Hz
    var hpL = context.createBiquadFilter();
    hpL.type = 'highpass';
    hpL.frequency.value = 38;
    hpL.Q.value = 0.5;

    var hpR = context.createBiquadFilter();
    hpR.type = 'highpass';
    hpR.frequency.value = 38;
    hpR.Q.value = 0.5;

    input.connect(splitter);
    splitter.connect(kweightL, 0);
    splitter.connect(kweightR, 1);
    kweightL.connect(hpL);
    kweightR.connect(hpR);
    hpL.connect(analyserL);
    hpR.connect(analyserR);

    var bufferL = new Float32Array(analyserL.fftSize);
    var bufferR = new Float32Array(analyserR.fftSize);

    // For unweighted peak/RMS
    var rawAnalyserL = context.createAnalyser();
    rawAnalyserL.fftSize = 4096;
    rawAnalyserL.smoothingTimeConstant = 0;
    var rawAnalyserR = context.createAnalyser();
    rawAnalyserR.fftSize = 4096;
    rawAnalyserR.smoothingTimeConstant = 0;

    splitter.connect(rawAnalyserL, 0);
    splitter.connect(rawAnalyserR, 1);

    var rawBufL = new Float32Array(rawAnalyserL.fftSize);
    var rawBufR = new Float32Array(rawAnalyserR.fftSize);

    // Integrated LUFS accumulator
    var integratedBlocks = [];
    var shortTermBlocks = [];
    var blockDuration = 0.4; // 400ms blocks
    var blockSampleCount = Math.floor(context.sampleRate * blockDuration);
    var gatingThreshold = -70; // absolute gate (dB)

    // Accumulate blocks over time
    var lastBlockTime = 0;
    var LUFS_OFFSET = -0.691;

    function computeRMS(buf) {
      var sum = 0;
      for (var i = 0; i < buf.length; i++) {
        sum += buf[i] * buf[i];
      }
      return Math.sqrt(sum / buf.length);
    }

    function computePeak(buf) {
      var peak = 0;
      for (var i = 0; i < buf.length; i++) {
        var a = Math.abs(buf[i]);
        if (a > peak) peak = a;
      }
      return peak;
    }

    function computeTruePeak(buf) {
      // Simplified: 4x oversampling approximation via linear interpolation
      var peak = 0;
      for (var i = 0; i < buf.length - 1; i++) {
        var a = Math.abs(buf[i]);
        if (a > peak) peak = a;
        // Check interpolated samples
        for (var j = 1; j <= 3; j++) {
          var t = j / 4;
          var interp = Math.abs(buf[i] * (1 - t) + buf[i + 1] * t);
          if (interp > peak) peak = interp;
        }
      }
      if (buf.length > 0) {
        var last = Math.abs(buf[buf.length - 1]);
        if (last > peak) peak = last;
      }
      return peak;
    }

    function getLoudness() {
      // K-weighted data
      analyserL.getFloatTimeDomainData(bufferL);
      analyserR.getFloatTimeDomainData(bufferR);

      // Raw data
      rawAnalyserL.getFloatTimeDomainData(rawBufL);
      rawAnalyserR.getFloatTimeDomainData(rawBufR);

      // Peak (raw)
      var peakL = computePeak(rawBufL);
      var peakR = computePeak(rawBufR);
      var peak = Math.max(peakL, peakR);

      // RMS (raw)
      var rmsL = computeRMS(rawBufL);
      var rmsR = computeRMS(rawBufR);
      var rms = Math.sqrt((rmsL * rmsL + rmsR * rmsR) / 2);

      // True peak approximation (raw)
      var tpL = computeTruePeak(rawBufL);
      var tpR = computeTruePeak(rawBufR);
      var truePeak = Math.max(tpL, tpR);

      // Short-term LUFS (K-weighted, last 3 seconds)
      var kRmsL = computeRMS(bufferL);
      var kRmsR = computeRMS(bufferR);
      var meanSquare = (kRmsL * kRmsL + kRmsR * kRmsR) / 2;
      var shortTermLufs = meanSquare > 0 ? (LUFS_OFFSET + 10 * Math.log10(meanSquare)) : -Infinity;

      // Accumulate for integrated LUFS
      var now = context.currentTime;
      if (now - lastBlockTime >= blockDuration) {
        lastBlockTime = now;
        if (meanSquare > 0) {
          var blockLoudness = LUFS_OFFSET + 10 * Math.log10(meanSquare);
          if (blockLoudness > gatingThreshold) {
            integratedBlocks.push(meanSquare);
            shortTermBlocks.push({ time: now, ms: meanSquare });
          }
        }
        // Trim short-term blocks older than 3 seconds
        while (shortTermBlocks.length > 0 && (now - shortTermBlocks[0].time) > 3) {
          shortTermBlocks.shift();
        }
      }

      // Compute integrated LUFS from all accumulated blocks
      var integratedLufs = -Infinity;
      if (integratedBlocks.length > 0) {
        var totalMS = 0;
        for (var i = 0; i < integratedBlocks.length; i++) {
          totalMS += integratedBlocks[i];
        }
        totalMS /= integratedBlocks.length;
        integratedLufs = LUFS_OFFSET + 10 * Math.log10(totalMS);
      }

      // Compute short-term LUFS from last 3s
      var stLufs = -Infinity;
      if (shortTermBlocks.length > 0) {
        var stMS = 0;
        for (var j = 0; j < shortTermBlocks.length; j++) {
          stMS += shortTermBlocks[j].ms;
        }
        stMS /= shortTermBlocks.length;
        stLufs = LUFS_OFFSET + 10 * Math.log10(stMS);
      }

      return {
        peak: linearToDB(peak),
        rms: linearToDB(rms),
        lufs: integratedLufs,
        shortTermLufs: stLufs,
        truePeak: linearToDB(truePeak)
      };
    }

    function reset() {
      integratedBlocks = [];
      shortTermBlocks = [];
      lastBlockTime = 0;
    }

    return {
      input: input,
      getLoudness: getLoudness,
      reset: reset,
      dispose: function () {
        try {
          input.disconnect();
          splitter.disconnect();
          analyserL.disconnect(); analyserR.disconnect();
          kweightL.disconnect(); kweightR.disconnect();
          hpL.disconnect(); hpR.disconnect();
          rawAnalyserL.disconnect(); rawAnalyserR.disconnect();
        } catch (e) { /* */ }
      }
    };
  }

  // ─── Init Mastering Chain ───────────────────────────────────────────

  function init(audioContext, outputNode) {
    ac = audioContext;
    if (chain) {
      dispose();
    }

    var destination = outputNode || ac.destination;

    // Create chain components
    var inputGain = ac.createGain();
    inputGain.gain.value = 1;

    // EQ (using effects module if available, or inline)
    var eq = null;
    if (DAW.Effects) {
      eq = DAW.Effects.create('eq', ac);
    }

    // Multiband compressor
    var multibandComp = createMultibandCompressor(ac);

    // Stereo imager
    var stereoImager = createStereoImager(ac);

    // Limiter
    var limiter = ac.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.05;
    limiter.knee.value = 0;

    var ceilingGain = ac.createGain();
    ceilingGain.gain.value = dBToLinear(-0.3);

    // Dither
    var dither = createDither(ac, 16);

    // Loudness meter
    var loudnessMeter = createLoudnessMeter(ac);

    // Bypass path
    var bypassGain = ac.createGain();
    bypassGain.gain.value = 0;
    var processedGain = ac.createGain();
    processedGain.gain.value = 1;

    // Connect chain: input -> EQ -> multibandComp -> stereoImager -> limiter -> dither -> meter -> output
    if (eq) {
      inputGain.connect(eq.input);
      eq.output.connect(multibandComp.input);
    } else {
      inputGain.connect(multibandComp.input);
    }

    multibandComp.output.connect(stereoImager.input);
    stereoImager.output.connect(limiter);
    limiter.connect(ceilingGain);
    ceilingGain.connect(dither.input);
    dither.output.connect(processedGain);
    processedGain.connect(loudnessMeter.input);
    processedGain.connect(destination);

    // Bypass path
    inputGain.connect(bypassGain);
    bypassGain.connect(loudnessMeter.input);
    bypassGain.connect(destination);

    chain = {
      input: inputGain,
      eq: eq,
      multibandComp: multibandComp,
      stereoImager: stereoImager,
      limiter: limiter,
      ceilingGain: ceilingGain,
      dither: dither,
      loudnessMeter: loudnessMeter,
      bypassGain: bypassGain,
      processedGain: processedGain,
      destination: destination
    };

    bypassed = false;

    return chain.input;
  }

  // ─── Control Functions ──────────────────────────────────────────────

  function setEQ(band, params) {
    if (!chain || !chain.eq) return;
    var keys = Object.keys(params);
    for (var i = 0; i < keys.length; i++) {
      var paramName = band + keys[i].charAt(0).toUpperCase() + keys[i].slice(1);
      chain.eq.setParam(paramName, params[keys[i]]);
    }
  }

  function setMultibandCompressor(band, params) {
    if (!chain) return;
    chain.multibandComp.setBandParams(band, params);
  }

  function setCrossover(lowMid, midHigh) {
    if (!chain) return;
    chain.multibandComp.setCrossover(lowMid, midHigh);
  }

  function soloBand(band, state) {
    if (!chain) return;
    chain.multibandComp.soloBand(band, state);
  }

  function bypassBand(band, state) {
    if (!chain) return;
    chain.multibandComp.bypassBand(band, state);
  }

  function setStereoWidth(width) {
    if (!chain) return;
    chain.stereoImager.setWidth(width);
  }

  function setLimiterCeiling(db) {
    if (!chain) return;
    db = clamp(db, -12, 0);
    chain.limiter.threshold.value = db;
    chain.ceilingGain.gain.value = dBToLinear(db);
  }

  function setLimiterRelease(seconds) {
    if (!chain) return;
    chain.limiter.release.value = clamp(seconds, 0.01, 1);
  }

  function setDitherBitDepth(bits) {
    if (!chain) return;
    chain.dither.setBitDepth(bits);
  }

  function bypassChain(state) {
    if (!chain) return;
    bypassed = (state !== undefined) ? !!state : !bypassed;
    if (bypassed) {
      chain.processedGain.gain.value = 0;
      chain.bypassGain.gain.value = 1;
    } else {
      chain.processedGain.gain.value = 1;
      chain.bypassGain.gain.value = 0;
    }
    return bypassed;
  }

  function isBypassed() {
    return bypassed;
  }

  function getLoudness() {
    if (!chain) return null;
    return chain.loudnessMeter.getLoudness();
  }

  function getAnalysis() {
    if (!chain) return null;
    var loudness = chain.loudnessMeter.getLoudness();
    var mbReduction = chain.multibandComp.getReduction();
    var limiterReduction = chain.limiter.reduction;

    return {
      loudness: loudness,
      multibandReduction: mbReduction,
      limiterReduction: limiterReduction,
      bypassed: bypassed
    };
  }

  function resetMeters() {
    if (!chain) return;
    chain.loudnessMeter.reset();
  }

  function getInput() {
    if (!chain) return null;
    return chain.input;
  }

  function dispose() {
    if (!chain) return;
    if (chain.eq) chain.eq.dispose();
    chain.multibandComp.dispose();
    chain.stereoImager.dispose();
    chain.dither.dispose();
    chain.loudnessMeter.dispose();
    try {
      chain.input.disconnect();
      chain.limiter.disconnect();
      chain.ceilingGain.disconnect();
      chain.bypassGain.disconnect();
      chain.processedGain.disconnect();
    } catch (e) { /* */ }
    chain = null;
    bypassed = false;
  }

  // ─── Public API ─────────────────────────────────────────────────────

  return {
    init: init,
    dispose: dispose,
    getInput: getInput,
    setEQ: setEQ,
    setMultibandCompressor: setMultibandCompressor,
    setCrossover: setCrossover,
    soloBand: soloBand,
    bypassBand: bypassBand,
    setStereoWidth: setStereoWidth,
    setLimiterCeiling: setLimiterCeiling,
    setLimiterRelease: setLimiterRelease,
    setDitherBitDepth: setDitherBitDepth,
    bypassChain: bypassChain,
    isBypassed: isBypassed,
    getLoudness: getLoudness,
    getAnalysis: getAnalysis,
    resetMeters: resetMeters
  };
})();
