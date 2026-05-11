var DAW = DAW || {};

DAW.DrumMachine = (function () {
  var PATTERNS = {
    rock: {
      kick:  [1,0,0,0, 0,0,0,0, 1,0,1,0, 0,0,0,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      hihat: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      crash: [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]
    },
    pop: {
      kick:  [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      hihat: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,1],
      crash: [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]
    },
    ballad: {
      kick:  [1,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
      snare: [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0],
      hihat: [1,0,0,1, 0,0,1,0, 0,1,0,0, 1,0,0,1],
      crash: [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]
    },
    funk: {
      kick:  [1,0,0,1, 0,0,1,0, 0,0,1,0, 0,1,0,0],
      snare: [0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,0,0],
      hihat: [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
      crash: [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]
    }
  };

  var scheduledNodes = [];
  var isPlaying = false;

  function synthKick(ac, time, output) {
    var osc = ac.createOscillator();
    var gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.12);
    gain.gain.setValueAtTime(0.8, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
    osc.connect(gain);
    gain.connect(output);
    osc.start(time);
    osc.stop(time + 0.3);
    scheduledNodes.push(osc);
  }

  function synthSnare(ac, time, output) {
    var bufferSize = ac.sampleRate * 0.15;
    var noiseBuffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    var data = noiseBuffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1);
    }

    var noise = ac.createBufferSource();
    noise.buffer = noiseBuffer;
    var noiseGain = ac.createGain();
    noiseGain.gain.setValueAtTime(0.5, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
    var filter = ac.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1000;
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(output);
    noise.start(time);
    noise.stop(time + 0.15);

    var osc = ac.createOscillator();
    var oscGain = ac.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(200, time);
    osc.frequency.exponentialRampToValueAtTime(100, time + 0.05);
    oscGain.gain.setValueAtTime(0.4, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
    osc.connect(oscGain);
    oscGain.connect(output);
    osc.start(time);
    osc.stop(time + 0.08);

    scheduledNodes.push(noise, osc);
  }

  function synthHihat(ac, time, output, open) {
    var duration = open ? 0.15 : 0.05;
    var bufferSize = ac.sampleRate * duration;
    var noiseBuffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    var data = noiseBuffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1);
    }

    var noise = ac.createBufferSource();
    noise.buffer = noiseBuffer;
    var gain = ac.createGain();
    gain.gain.setValueAtTime(0.2, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    var filter = ac.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 8000;
    filter.Q.value = 1.5;
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    noise.start(time);
    noise.stop(time + duration);
    scheduledNodes.push(noise);
  }

  function synthCrash(ac, time, output) {
    var duration = 0.8;
    var bufferSize = ac.sampleRate * duration;
    var noiseBuffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    var data = noiseBuffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1);
    }

    var noise = ac.createBufferSource();
    noise.buffer = noiseBuffer;
    var gain = ac.createGain();
    gain.gain.setValueAtTime(0.25, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    var filter = ac.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 5000;
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    noise.start(time);
    noise.stop(time + duration);
    scheduledNodes.push(noise);
  }

  function generatePattern(style, chords, bpm, totalDuration) {
    var pattern = PATTERNS[style] || PATTERNS.rock;
    var stepsPerBeat = 4;
    var stepDuration = 60 / (bpm * stepsPerBeat);
    var totalSteps = Math.ceil(totalDuration / stepDuration);
    var patternLength = 16;

    var events = [];
    for (var step = 0; step < totalSteps; step++) {
      var patternIdx = step % patternLength;
      var time = step * stepDuration;
      var isFirstBar = (step % patternLength === 0);

      if (pattern.kick[patternIdx]) {
        events.push({ type: 'kick', time: time });
      }
      if (pattern.snare[patternIdx]) {
        events.push({ type: 'snare', time: time });
      }
      if (pattern.hihat[patternIdx]) {
        events.push({ type: 'hihat', time: time });
      }
      if (isFirstBar && pattern.crash[0]) {
        events.push({ type: 'crash', time: time });
      }
    }

    return {
      events: events,
      style: style,
      bpm: bpm,
      totalDuration: totalDuration,
      pattern: pattern,
      stepDuration: stepDuration
    };
  }

  function play(drumData, startOffset) {
    stop();
    var ac = DAW.AudioEngine.getContext();
    var output = DAW.AudioEngine.getDrumsGain();
    var now = ac.currentTime;
    isPlaying = true;

    drumData.events.forEach(function (evt) {
      var eventTime = evt.time - (startOffset || 0);
      if (eventTime < 0) return;
      var t = now + eventTime;
      switch (evt.type) {
        case 'kick':  synthKick(ac, t, output); break;
        case 'snare': synthSnare(ac, t, output); break;
        case 'hihat': synthHihat(ac, t, output, false); break;
        case 'crash': synthCrash(ac, t, output); break;
      }
    });
  }

  function stop() {
    isPlaying = false;
    scheduledNodes.forEach(function (node) {
      try { node.stop(); } catch (e) { /* ignore */ }
    });
    scheduledNodes = [];
  }

  function getPatternNames() {
    return Object.keys(PATTERNS);
  }

  return {
    generatePattern: generatePattern,
    play: play,
    stop: stop,
    getPatternNames: getPatternNames,
    PATTERNS: PATTERNS
  };
})();
