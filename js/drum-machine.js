var DAW = DAW || {};

DAW.DrumMachine = (function () {
  'use strict';

  // ---- Instrument definitions ----
  var INSTRUMENTS = [
    'kick', 'snare', 'hihat-closed', 'hihat-open', 'crash', 'ride',
    'tom-high', 'tom-mid', 'tom-low', 'clap', 'rimshot', 'cowbell', 'shaker'
  ];

  // Default instrument parameters
  var DEFAULT_INST_PARAMS = {
    'kick':        { volume: 0.8, pan: 0, pitch: 1.0, decay: 0.3, tone: 0.5 },
    'snare':       { volume: 0.7, pan: 0, pitch: 1.0, decay: 0.15, tone: 0.5 },
    'hihat-closed':{ volume: 0.4, pan: 0.2, pitch: 1.0, decay: 0.05, tone: 0.7 },
    'hihat-open':  { volume: 0.4, pan: 0.2, pitch: 1.0, decay: 0.2, tone: 0.7 },
    'crash':       { volume: 0.5, pan: -0.1, pitch: 1.0, decay: 0.8, tone: 0.6 },
    'ride':        { volume: 0.4, pan: 0.3, pitch: 1.0, decay: 0.5, tone: 0.8 },
    'tom-high':    { volume: 0.6, pan: -0.3, pitch: 1.0, decay: 0.2, tone: 0.5 },
    'tom-mid':     { volume: 0.6, pan: 0, pitch: 1.0, decay: 0.25, tone: 0.5 },
    'tom-low':     { volume: 0.6, pan: 0.3, pitch: 1.0, decay: 0.3, tone: 0.5 },
    'clap':        { volume: 0.6, pan: 0, pitch: 1.0, decay: 0.12, tone: 0.5 },
    'rimshot':     { volume: 0.5, pan: 0, pitch: 1.0, decay: 0.06, tone: 0.7 },
    'cowbell':     { volume: 0.4, pan: 0.1, pitch: 1.0, decay: 0.15, tone: 0.8 },
    'shaker':      { volume: 0.3, pan: -0.2, pitch: 1.0, decay: 0.05, tone: 0.5 }
  };

  // ---- Pattern presets (16 steps per instrument) ----
  // Velocity values: 0 = off, 1-127 = on with velocity
  function emptyPattern() {
    var pat = {};
    for (var i = 0; i < INSTRUMENTS.length; i++) {
      pat[INSTRUMENTS[i]] = {
        steps: new Array(16),
        probability: new Array(16)
      };
      for (var s = 0; s < 16; s++) {
        pat[INSTRUMENTS[i]].steps[s] = 0;
        pat[INSTRUMENTS[i]].probability[s] = 1.0;
      }
    }
    return pat;
  }

  function patFromSimple(simple) {
    var pat = emptyPattern();
    var keys = Object.keys(simple);
    for (var k = 0; k < keys.length; k++) {
      var inst = keys[k];
      if (!pat[inst]) continue;
      var arr = simple[inst];
      for (var s = 0; s < arr.length && s < 16; s++) {
        pat[inst].steps[s] = arr[s] ? 100 : 0;
        pat[inst].probability[s] = 1.0;
      }
    }
    return pat;
  }

  var STYLE_PATTERNS = {
    rock: patFromSimple({
      'kick':         [1,0,0,0, 0,0,0,0, 1,0,1,0, 0,0,0,0],
      'snare':        [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      'hihat-closed': [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      'crash':        [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]
    }),
    pop: patFromSimple({
      'kick':         [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      'snare':        [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      'hihat-closed': [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,1],
      'crash':        [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]
    }),
    ballad: patFromSimple({
      'kick':         [1,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
      'snare':        [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0],
      'hihat-closed': [1,0,0,1, 0,0,1,0, 0,1,0,0, 1,0,0,1],
      'crash':        [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]
    }),
    funk: patFromSimple({
      'kick':         [1,0,0,1, 0,0,1,0, 0,0,1,0, 0,1,0,0],
      'snare':        [0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,0,0],
      'hihat-closed': [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
      'hihat-open':   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0],
      'crash':        [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]
    }),
    jazz: patFromSimple({
      'kick':         [1,0,0,0, 0,0,1,0, 0,0,0,0, 0,1,0,0],
      'snare':        [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      'hihat-closed': [1,0,1,1, 0,0,1,0, 1,1,0,0, 1,0,1,0],
      'ride':         [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      'rimshot':      [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1]
    }),
    hiphop: patFromSimple({
      'kick':         [1,0,0,0, 0,0,0,1, 0,0,1,0, 0,0,0,0],
      'snare':        [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      'hihat-closed': [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      'hihat-open':   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1],
      'clap':         [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0]
    }),
    techno: patFromSimple({
      'kick':         [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      'snare':        [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      'clap':         [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      'hihat-closed': [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      'hihat-open':   [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1]
    }),
    reggae: patFromSimple({
      'kick':         [1,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,0],
      'snare':        [0,0,0,1, 0,0,0,0, 0,0,0,1, 0,0,0,0],
      'rimshot':      [0,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
      'hihat-closed': [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0]
    }),
    latin: patFromSimple({
      'kick':         [1,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,0],
      'snare':        [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      'hihat-closed': [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      'cowbell':      [0,0,1,0, 0,1,0,0, 1,0,0,0, 0,1,0,1],
      'clap':         [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      'shaker':       [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1]
    }),
    shuffle: patFromSimple({
      'kick':         [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      'snare':        [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      'hihat-closed': [1,0,0,1, 0,0,1,0, 0,1,0,0, 1,0,0,1],
      'hihat-open':   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0]
    })
  };

  // ---- Drum synthesis engine ----
  function synthDrum(ac, type, time, output, params) {
    params = params || {};
    var vol = params.volume !== undefined ? params.volume : 0.7;
    var pitchMult = params.pitch !== undefined ? params.pitch : 1.0;
    var decay = params.decay !== undefined ? params.decay : 0.3;
    var tone = params.tone !== undefined ? params.tone : 0.5;
    var panVal = params.pan !== undefined ? params.pan : 0;
    var velocity = params.velocity !== undefined ? params.velocity / 127 : 1.0;
    var nodes = [];

    // Pan node
    var panNode;
    if (ac.createStereoPanner) {
      panNode = ac.createStereoPanner();
      panNode.pan.value = panVal;
    } else {
      panNode = ac.createGain();
    }
    panNode.connect(output);

    var masterVol = vol * velocity;

    switch (type) {
      case 'kick': {
        var osc = ac.createOscillator();
        var gain = ac.createGain();
        osc.type = 'sine';
        var baseFreq = 150 * pitchMult;
        osc.frequency.setValueAtTime(baseFreq, time);
        osc.frequency.exponentialRampToValueAtTime(Math.max(40 * pitchMult, 20), time + decay * 0.4);
        gain.gain.setValueAtTime(masterVol, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
        // Add click transient
        var click = ac.createOscillator();
        var clickGain = ac.createGain();
        click.type = 'square';
        click.frequency.value = 1000 * pitchMult * tone;
        clickGain.gain.setValueAtTime(masterVol * 0.3 * tone, time);
        clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.02);
        click.connect(clickGain);
        clickGain.connect(panNode);
        click.start(time);
        click.stop(time + 0.02);
        osc.connect(gain);
        gain.connect(panNode);
        osc.start(time);
        osc.stop(time + decay);
        nodes.push(osc, click);
        break;
      }

      case 'snare': {
        // Body
        var bodyOsc = ac.createOscillator();
        var bodyGain = ac.createGain();
        bodyOsc.type = 'triangle';
        bodyOsc.frequency.setValueAtTime(200 * pitchMult, time);
        bodyOsc.frequency.exponentialRampToValueAtTime(Math.max(100 * pitchMult, 20), time + 0.05);
        bodyGain.gain.setValueAtTime(masterVol * 0.5, time);
        bodyGain.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.5);
        bodyOsc.connect(bodyGain);
        bodyGain.connect(panNode);
        bodyOsc.start(time);
        bodyOsc.stop(time + decay * 0.5);
        // Noise
        var nLen = Math.floor(ac.sampleRate * decay);
        var nBuf = ac.createBuffer(1, nLen, ac.sampleRate);
        var nData = nBuf.getChannelData(0);
        for (var i = 0; i < nLen; i++) { nData[i] = Math.random() * 2 - 1; }
        var noise = ac.createBufferSource();
        noise.buffer = nBuf;
        var noiseGain = ac.createGain();
        noiseGain.gain.setValueAtTime(masterVol * 0.6, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, time + decay);
        var hpf = ac.createBiquadFilter();
        hpf.type = 'highpass';
        hpf.frequency.value = 1000 + 4000 * tone;
        noise.connect(hpf);
        hpf.connect(noiseGain);
        noiseGain.connect(panNode);
        noise.start(time);
        noise.stop(time + decay);
        nodes.push(bodyOsc, noise);
        break;
      }

      case 'hihat-closed': {
        var dur = Math.max(decay, 0.03);
        var hLen = Math.floor(ac.sampleRate * dur);
        var hBuf = ac.createBuffer(1, hLen, ac.sampleRate);
        var hData = hBuf.getChannelData(0);
        for (var hi = 0; hi < hLen; hi++) { hData[hi] = Math.random() * 2 - 1; }
        var hNoise = ac.createBufferSource();
        hNoise.buffer = hBuf;
        var hGain = ac.createGain();
        hGain.gain.setValueAtTime(masterVol * 0.5, time);
        hGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        var hBpf = ac.createBiquadFilter();
        hBpf.type = 'bandpass';
        hBpf.frequency.value = (6000 + 6000 * tone) * pitchMult;
        hBpf.Q.value = 1.5;
        hNoise.connect(hBpf);
        hBpf.connect(hGain);
        hGain.connect(panNode);
        hNoise.start(time);
        hNoise.stop(time + dur);
        nodes.push(hNoise);
        break;
      }

      case 'hihat-open': {
        var oDur = Math.max(decay, 0.1);
        var oLen = Math.floor(ac.sampleRate * oDur);
        var oBuf = ac.createBuffer(1, oLen, ac.sampleRate);
        var oData = oBuf.getChannelData(0);
        for (var oi = 0; oi < oLen; oi++) { oData[oi] = Math.random() * 2 - 1; }
        var oNoise = ac.createBufferSource();
        oNoise.buffer = oBuf;
        var oGain = ac.createGain();
        oGain.gain.setValueAtTime(masterVol * 0.45, time);
        oGain.gain.exponentialRampToValueAtTime(0.001, time + oDur);
        var oBpf = ac.createBiquadFilter();
        oBpf.type = 'bandpass';
        oBpf.frequency.value = (7000 + 5000 * tone) * pitchMult;
        oBpf.Q.value = 1.0;
        oNoise.connect(oBpf);
        oBpf.connect(oGain);
        oGain.connect(panNode);
        oNoise.start(time);
        oNoise.stop(time + oDur);
        nodes.push(oNoise);
        break;
      }

      case 'crash': {
        var cDur = Math.max(decay, 0.5);
        var cLen = Math.floor(ac.sampleRate * cDur);
        var cBuf = ac.createBuffer(1, cLen, ac.sampleRate);
        var cData = cBuf.getChannelData(0);
        for (var ci = 0; ci < cLen; ci++) { cData[ci] = Math.random() * 2 - 1; }
        var cNoise = ac.createBufferSource();
        cNoise.buffer = cBuf;
        var cGain = ac.createGain();
        cGain.gain.setValueAtTime(masterVol * 0.5, time);
        cGain.gain.exponentialRampToValueAtTime(0.001, time + cDur);
        var cHpf = ac.createBiquadFilter();
        cHpf.type = 'highpass';
        cHpf.frequency.value = (4000 + 3000 * tone) * pitchMult;
        cNoise.connect(cHpf);
        cHpf.connect(cGain);
        cGain.connect(panNode);
        cNoise.start(time);
        cNoise.stop(time + cDur);
        nodes.push(cNoise);
        break;
      }

      case 'ride': {
        var rDur = Math.max(decay, 0.3);
        var rLen = Math.floor(ac.sampleRate * rDur);
        var rBuf = ac.createBuffer(1, rLen, ac.sampleRate);
        var rData = rBuf.getChannelData(0);
        for (var ri = 0; ri < rLen; ri++) { rData[ri] = Math.random() * 2 - 1; }
        var rNoise = ac.createBufferSource();
        rNoise.buffer = rBuf;
        var rGain = ac.createGain();
        rGain.gain.setValueAtTime(masterVol * 0.35, time);
        rGain.gain.exponentialRampToValueAtTime(0.001, time + rDur);
        var rBpf = ac.createBiquadFilter();
        rBpf.type = 'bandpass';
        rBpf.frequency.value = (5000 + 4000 * tone) * pitchMult;
        rBpf.Q.value = 2.0;
        rNoise.connect(rBpf);
        rBpf.connect(rGain);
        rGain.connect(panNode);
        rNoise.start(time);
        rNoise.stop(time + rDur);
        // Add bell component
        var bellOsc = ac.createOscillator();
        var bellGain = ac.createGain();
        bellOsc.type = 'sine';
        bellOsc.frequency.value = 3000 * pitchMult * tone;
        bellGain.gain.setValueAtTime(masterVol * 0.1, time);
        bellGain.gain.exponentialRampToValueAtTime(0.001, time + rDur * 0.5);
        bellOsc.connect(bellGain);
        bellGain.connect(panNode);
        bellOsc.start(time);
        bellOsc.stop(time + rDur * 0.5);
        nodes.push(rNoise, bellOsc);
        break;
      }

      case 'tom-high': {
        var thOsc = ac.createOscillator();
        var thGain = ac.createGain();
        thOsc.type = 'sine';
        thOsc.frequency.setValueAtTime(300 * pitchMult, time);
        thOsc.frequency.exponentialRampToValueAtTime(Math.max(180 * pitchMult, 20), time + decay);
        thGain.gain.setValueAtTime(masterVol * 0.6, time);
        thGain.gain.exponentialRampToValueAtTime(0.001, time + decay);
        thOsc.connect(thGain);
        thGain.connect(panNode);
        thOsc.start(time);
        thOsc.stop(time + decay);
        nodes.push(thOsc);
        break;
      }

      case 'tom-mid': {
        var tmOsc = ac.createOscillator();
        var tmGain = ac.createGain();
        tmOsc.type = 'sine';
        tmOsc.frequency.setValueAtTime(220 * pitchMult, time);
        tmOsc.frequency.exponentialRampToValueAtTime(Math.max(130 * pitchMult, 20), time + decay);
        tmGain.gain.setValueAtTime(masterVol * 0.6, time);
        tmGain.gain.exponentialRampToValueAtTime(0.001, time + decay);
        tmOsc.connect(tmGain);
        tmGain.connect(panNode);
        tmOsc.start(time);
        tmOsc.stop(time + decay);
        nodes.push(tmOsc);
        break;
      }

      case 'tom-low': {
        var tlOsc = ac.createOscillator();
        var tlGain = ac.createGain();
        tlOsc.type = 'sine';
        tlOsc.frequency.setValueAtTime(160 * pitchMult, time);
        tlOsc.frequency.exponentialRampToValueAtTime(Math.max(80 * pitchMult, 20), time + decay);
        tlGain.gain.setValueAtTime(masterVol * 0.7, time);
        tlGain.gain.exponentialRampToValueAtTime(0.001, time + decay);
        tlOsc.connect(tlGain);
        tlGain.connect(panNode);
        tlOsc.start(time);
        tlOsc.stop(time + decay);
        nodes.push(tlOsc);
        break;
      }

      case 'clap': {
        // Multi-layered noise bursts to simulate clap
        var cpDecay = Math.max(decay, 0.08);
        for (var cl = 0; cl < 3; cl++) {
          var clDelay = cl * 0.01;
          var clLen = Math.floor(ac.sampleRate * cpDecay);
          var clBuf = ac.createBuffer(1, clLen, ac.sampleRate);
          var clData = clBuf.getChannelData(0);
          for (var cli = 0; cli < clLen; cli++) { clData[cli] = Math.random() * 2 - 1; }
          var clNoise = ac.createBufferSource();
          clNoise.buffer = clBuf;
          var clGain = ac.createGain();
          clGain.gain.setValueAtTime(masterVol * 0.35, time + clDelay);
          clGain.gain.exponentialRampToValueAtTime(0.001, time + clDelay + cpDecay);
          var clBpf = ac.createBiquadFilter();
          clBpf.type = 'bandpass';
          clBpf.frequency.value = (1200 + 2000 * tone) * pitchMult;
          clBpf.Q.value = 0.8;
          clNoise.connect(clBpf);
          clBpf.connect(clGain);
          clGain.connect(panNode);
          clNoise.start(time + clDelay);
          clNoise.stop(time + clDelay + cpDecay);
          nodes.push(clNoise);
        }
        break;
      }

      case 'rimshot': {
        var rsOsc = ac.createOscillator();
        var rsGain = ac.createGain();
        rsOsc.type = 'triangle';
        rsOsc.frequency.setValueAtTime(800 * pitchMult, time);
        rsOsc.frequency.exponentialRampToValueAtTime(Math.max(400 * pitchMult, 20), time + decay);
        rsGain.gain.setValueAtTime(masterVol * 0.5, time);
        rsGain.gain.exponentialRampToValueAtTime(0.001, time + decay);
        rsOsc.connect(rsGain);
        rsGain.connect(panNode);
        rsOsc.start(time);
        rsOsc.stop(time + decay);
        // Noise burst
        var rsNLen = Math.floor(ac.sampleRate * decay * 0.5);
        var rsNBuf = ac.createBuffer(1, rsNLen, ac.sampleRate);
        var rsNData = rsNBuf.getChannelData(0);
        for (var rsi = 0; rsi < rsNLen; rsi++) { rsNData[rsi] = Math.random() * 2 - 1; }
        var rsNoise = ac.createBufferSource();
        rsNoise.buffer = rsNBuf;
        var rsNGain = ac.createGain();
        rsNGain.gain.setValueAtTime(masterVol * 0.3, time);
        rsNGain.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.5);
        var rsHpf = ac.createBiquadFilter();
        rsHpf.type = 'highpass';
        rsHpf.frequency.value = 2000 * pitchMult;
        rsNoise.connect(rsHpf);
        rsHpf.connect(rsNGain);
        rsNGain.connect(panNode);
        rsNoise.start(time);
        rsNoise.stop(time + decay * 0.5);
        nodes.push(rsOsc, rsNoise);
        break;
      }

      case 'cowbell': {
        var cb1 = ac.createOscillator();
        var cb2 = ac.createOscillator();
        var cbGain = ac.createGain();
        cb1.type = 'square';
        cb2.type = 'square';
        cb1.frequency.value = 560 * pitchMult;
        cb2.frequency.value = 845 * pitchMult;
        cbGain.gain.setValueAtTime(masterVol * 0.35, time);
        cbGain.gain.exponentialRampToValueAtTime(0.001, time + decay);
        var cbBpf = ac.createBiquadFilter();
        cbBpf.type = 'bandpass';
        cbBpf.frequency.value = 800 * pitchMult;
        cbBpf.Q.value = 3;
        cb1.connect(cbBpf);
        cb2.connect(cbBpf);
        cbBpf.connect(cbGain);
        cbGain.connect(panNode);
        cb1.start(time);
        cb1.stop(time + decay);
        cb2.start(time);
        cb2.stop(time + decay);
        nodes.push(cb1, cb2);
        break;
      }

      case 'shaker': {
        var shDur = Math.max(decay, 0.03);
        var shLen = Math.floor(ac.sampleRate * shDur);
        var shBuf = ac.createBuffer(1, shLen, ac.sampleRate);
        var shData = shBuf.getChannelData(0);
        for (var si = 0; si < shLen; si++) { shData[si] = Math.random() * 2 - 1; }
        var shNoise = ac.createBufferSource();
        shNoise.buffer = shBuf;
        var shGain = ac.createGain();
        shGain.gain.setValueAtTime(masterVol * 0.3, time);
        shGain.gain.exponentialRampToValueAtTime(0.001, time + shDur);
        var shHpf = ac.createBiquadFilter();
        shHpf.type = 'highpass';
        shHpf.frequency.value = (6000 + 4000 * tone) * pitchMult;
        shNoise.connect(shHpf);
        shHpf.connect(shGain);
        shGain.connect(panNode);
        shNoise.start(time);
        shNoise.stop(time + shDur);
        nodes.push(shNoise);
        break;
      }

      default:
        break;
    }

    return nodes;
  }

  // ---- Drum Machine Instance ----
  function createInstance(audioContext, outputNode) {
    var ac = audioContext || DAW.AudioEngine.getContext();
    var output = outputNode || DAW.AudioEngine.getDrumsGain();

    // Pattern banks A-D, each holds a 16-step pattern
    var banks = {
      A: emptyPattern(),
      B: emptyPattern(),
      C: emptyPattern(),
      D: emptyPattern()
    };
    var currentBank = 'A';
    var stepsPerPattern = 16;

    // Pattern chain for arrangement (array of bank letters)
    var patternChain = ['A'];
    var chainIndex = 0;

    // Per-instrument params
    var instParams = {};
    for (var k = 0; k < INSTRUMENTS.length; k++) {
      var inst = INSTRUMENTS[k];
      instParams[inst] = {
        volume: DEFAULT_INST_PARAMS[inst].volume,
        pan: DEFAULT_INST_PARAMS[inst].pan,
        pitch: DEFAULT_INST_PARAMS[inst].pitch,
        decay: DEFAULT_INST_PARAMS[inst].decay,
        tone: DEFAULT_INST_PARAMS[inst].tone
      };
    }

    var swingAmount = 0; // 0-1
    var scheduledNodes = [];
    var isPlaying = false;
    var currentStep = 0;
    var schedulerTimer = null;
    var nextStepTime = 0;
    var scheduleAheadTime = 0.1;
    var scheduleInterval = 25;

    // ---- Pattern management ----
    function getPattern() {
      return banks[currentBank];
    }

    function setPattern(style) {
      if (STYLE_PATTERNS[style]) {
        banks[currentBank] = JSON.parse(JSON.stringify(STYLE_PATTERNS[style]));
      }
    }

    function editStep(instrument, step, velocity) {
      var pat = banks[currentBank];
      if (!pat[instrument]) return;
      if (step < 0 || step >= stepsPerPattern) return;
      pat[instrument].steps[step] = velocity; // 0 = off, 1-127 = on
    }

    function setStepProbability(instrument, step, prob) {
      var pat = banks[currentBank];
      if (!pat[instrument]) return;
      if (step < 0 || step >= stepsPerPattern) return;
      pat[instrument].probability[step] = Math.max(0, Math.min(1, prob));
    }

    function setStepsPerPattern(count) {
      // Allow 16 or 32
      stepsPerPattern = (count === 32) ? 32 : 16;
      // Extend existing patterns if needed
      var bankKeys = Object.keys(banks);
      for (var b = 0; b < bankKeys.length; b++) {
        var pat = banks[bankKeys[b]];
        var instKeys = Object.keys(pat);
        for (var ik = 0; ik < instKeys.length; ik++) {
          while (pat[instKeys[ik]].steps.length < stepsPerPattern) {
            pat[instKeys[ik]].steps.push(0);
            pat[instKeys[ik]].probability.push(1.0);
          }
        }
      }
    }

    function setCurrentBank(bank) {
      if (banks.hasOwnProperty(bank)) {
        currentBank = bank;
      }
    }

    function setPatternChain(chain) {
      if (chain && chain.length > 0) {
        patternChain = chain;
        chainIndex = 0;
      }
    }

    function copyPattern(fromBank, toBank) {
      if (banks[fromBank] && banks[toBank]) {
        banks[toBank] = JSON.parse(JSON.stringify(banks[fromBank]));
      }
    }

    function clearPattern(bank) {
      var target = bank || currentBank;
      if (banks[target]) {
        banks[target] = emptyPattern();
      }
    }

    // ---- Instrument params ----
    function setInstrumentParam(instrument, paramName, value) {
      if (instParams[instrument] && instParams[instrument].hasOwnProperty(paramName)) {
        instParams[instrument][paramName] = value;
      }
    }

    function getInstrumentParams(instrument) {
      return instParams[instrument] ? JSON.parse(JSON.stringify(instParams[instrument])) : null;
    }

    // ---- Swing ----
    function setSwing(amount) {
      swingAmount = Math.max(0, Math.min(1, amount));
    }

    // ---- Real-time step input ----
    function stepInput(instrument, velocity) {
      // Record a hit at the current step position
      editStep(instrument, currentStep % stepsPerPattern, velocity || 100);
    }

    // ---- Trigger a single drum sound ----
    function triggerDrum(instrument, time, velocity) {
      var t = time || ac.currentTime;
      var ip = instParams[instrument] || DEFAULT_INST_PARAMS[instrument] || {};
      var p = {
        volume: ip.volume,
        pan: ip.pan,
        pitch: ip.pitch,
        decay: ip.decay,
        tone: ip.tone,
        velocity: velocity || 100
      };
      var newNodes = synthDrum(ac, instrument, t, output, p);
      for (var n = 0; n < newNodes.length; n++) {
        scheduledNodes.push(newNodes[n]);
      }
    }

    // ---- Scheduler ----
    function scheduleStep() {
      var currentTime = ac.currentTime;

      while (nextStepTime < currentTime + scheduleAheadTime) {
        var bpm = 120;
        if (typeof DAW !== 'undefined' && DAW.Transport && DAW.Transport.getBPM) {
          bpm = DAW.Transport.getBPM();
        }
        var stepDuration = 60.0 / (bpm * 4); // 16th notes

        // Swing: delay even-numbered steps
        var swingOffset = 0;
        if (currentStep % 2 === 1 && swingAmount > 0) {
          swingOffset = stepDuration * swingAmount * 0.5;
        }

        var triggerTime = nextStepTime + swingOffset;

        // Determine which bank to use (pattern chaining)
        var patternInChain = Math.floor(currentStep / stepsPerPattern) % patternChain.length;
        var activeBank = patternChain[patternInChain];
        var pat = banks[activeBank] || banks[currentBank];
        var stepIdx = currentStep % stepsPerPattern;

        // Trigger each instrument
        for (var i = 0; i < INSTRUMENTS.length; i++) {
          var inst = INSTRUMENTS[i];
          if (!pat[inst]) continue;
          var vel = pat[inst].steps[stepIdx];
          if (vel > 0) {
            // Check probability
            var prob = pat[inst].probability[stepIdx];
            if (prob >= 1.0 || Math.random() < prob) {
              triggerDrum(inst, triggerTime, vel);
            }
          }
        }

        currentStep++;
        nextStepTime += stepDuration;
      }
    }

    function start() {
      if (isPlaying) return;
      isPlaying = true;
      currentStep = 0;
      chainIndex = 0;
      nextStepTime = ac.currentTime;
      schedulerTimer = setInterval(scheduleStep, scheduleInterval);
    }

    function stop() {
      isPlaying = false;
      if (schedulerTimer !== null) {
        clearInterval(schedulerTimer);
        schedulerTimer = null;
      }
      // Stop all scheduled nodes
      for (var i = 0; i < scheduledNodes.length; i++) {
        try { scheduledNodes[i].stop(); } catch (e) { /* */ }
      }
      scheduledNodes = [];
      currentStep = 0;
    }

    // ---- Legacy API: generatePattern + play (kept for backward compatibility) ----
    function generatePattern(style, chords, bpm, totalDuration) {
      var pat = STYLE_PATTERNS[style] || STYLE_PATTERNS.rock;
      var stepsPerBeat = 4;
      var stepDuration = 60 / (bpm * stepsPerBeat);
      var totalSteps = Math.ceil(totalDuration / stepDuration);
      var patLen = stepsPerPattern;

      var events = [];
      for (var step = 0; step < totalSteps; step++) {
        var patIdx = step % patLen;
        var time = step * stepDuration;

        for (var ii = 0; ii < INSTRUMENTS.length; ii++) {
          var instName = INSTRUMENTS[ii];
          if (!pat[instName]) continue;
          var vel = pat[instName].steps[patIdx];
          if (vel > 0) {
            events.push({ type: instName, time: time, velocity: vel });
          }
        }
      }

      return {
        events: events,
        style: style,
        bpm: bpm,
        totalDuration: totalDuration,
        pattern: pat,
        stepDuration: stepDuration
      };
    }

    function playGenerated(drumData, startOffset) {
      stop();
      isPlaying = true;
      var now = ac.currentTime;

      drumData.events.forEach(function (evt) {
        var eventTime = evt.time - (startOffset || 0);
        if (eventTime < 0) return;
        var t = now + eventTime;
        triggerDrum(evt.type, t, evt.velocity);
      });
    }

    function getPatternNames() {
      return Object.keys(STYLE_PATTERNS);
    }

    function getCurrentStep() {
      return currentStep % stepsPerPattern;
    }

    function getInstruments() {
      return INSTRUMENTS.slice();
    }

    function getBanks() {
      return Object.keys(banks);
    }

    function getCurrentBank() {
      return currentBank;
    }

    return {
      // New instance API
      start: start,
      stop: stop,
      setPattern: setPattern,
      editStep: editStep,
      setStepProbability: setStepProbability,
      setStepsPerPattern: setStepsPerPattern,
      getPattern: getPattern,
      setSwing: setSwing,
      setCurrentBank: setCurrentBank,
      setPatternChain: setPatternChain,
      copyPattern: copyPattern,
      clearPattern: clearPattern,
      setInstrumentParam: setInstrumentParam,
      getInstrumentParams: getInstrumentParams,
      triggerDrum: triggerDrum,
      stepInput: stepInput,
      getCurrentStep: getCurrentStep,
      getInstruments: getInstruments,
      getBanks: getBanks,
      getCurrentBank: getCurrentBank,
      getPatternNames: getPatternNames,

      // Legacy API
      generatePattern: generatePattern,
      play: playGenerated
    };
  }

  // ---- Module-level legacy API (backward compatible) ----
  var legacyInstance = null;

  function ensureLegacy() {
    if (!legacyInstance) {
      var ac = DAW.AudioEngine.getContext();
      var output = DAW.AudioEngine.getDrumsGain();
      legacyInstance = createInstance(ac, output);
    }
    return legacyInstance;
  }

  return {
    createInstance: createInstance,
    synthDrum: synthDrum,
    INSTRUMENTS: INSTRUMENTS,
    STYLE_PATTERNS: STYLE_PATTERNS,

    // Legacy top-level API for backward compatibility
    generatePattern: function (style, chords, bpm, totalDuration) {
      return ensureLegacy().generatePattern(style, chords, bpm, totalDuration);
    },
    play: function (drumData, startOffset) {
      ensureLegacy().play(drumData, startOffset);
    },
    stop: function () {
      ensureLegacy().stop();
    },
    getPatternNames: function () {
      return Object.keys(STYLE_PATTERNS);
    },
    PATTERNS: (function () {
      // Legacy-compatible PATTERNS object (simple arrays for backward compat)
      var legacy = {};
      var keys = Object.keys(STYLE_PATTERNS);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        legacy[k] = {};
        // Convert from new format back to simple 0/1 arrays for legacy consumers
        var instKeys = Object.keys(STYLE_PATTERNS[k]);
        for (var j = 0; j < instKeys.length; j++) {
          var inst = instKeys[j];
          var steps = STYLE_PATTERNS[k][inst].steps;
          legacy[k][inst] = [];
          for (var s = 0; s < steps.length; s++) {
            legacy[k][inst].push(steps[s] > 0 ? 1 : 0);
          }
        }
        // Map old key names for compatibility
        if (legacy[k]['hihat-closed'] && !legacy[k]['hihat']) {
          legacy[k]['hihat'] = legacy[k]['hihat-closed'];
        }
      }
      return legacy;
    })()
  };
})();
