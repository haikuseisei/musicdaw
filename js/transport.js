var DAW = DAW || {};

DAW.Transport = (function () {
  var PPQ = 480;

  var state = 'stopped'; // 'stopped', 'playing', 'paused', 'recording'
  var bpm = 120;
  var timeSignature = { numerator: 4, denominator: 4 };

  var positionTicks = 0;
  var startContextTime = 0;
  var pausedPositionTicks = 0;

  var loopRegion = { start: 0, end: PPQ * 4 * 4, enabled: false };

  var metronomeEnabled = false;
  var metronomeVolume = 0.5;

  var countInBars = 0; // 0 = disabled, 1 or 2
  var countInTicks = 0;
  var isCountingIn = false;

  var scheduleAheadTime = 0.1; // 100ms lookahead
  var scheduleInterval = 25;   // check every 25ms
  var schedulerTimer = null;
  var nextTickTime = 0;
  var nextTick = 0;
  var lastBeat = -1;
  var lastBar = -1;

  // Tap tempo
  var tapTimes = [];
  var tapTimeout = null;

  // Callbacks
  var callbacks = {
    onTick: null,
    onBeat: null,
    onBar: null,
    onPlay: null,
    onStop: null,
    onPause: null,
    onPositionChange: null
  };

  function getContext() {
    return DAW.AudioEngine.getContext();
  }

  function ticksPerBeat() {
    return PPQ * (4 / timeSignature.denominator);
  }

  function ticksPerBar() {
    return ticksPerBeat() * timeSignature.numerator;
  }

  function tickDuration() {
    var beatsPerSecond = bpm / 60;
    return 1.0 / (beatsPerSecond * PPQ);
  }

  function positionToTicks(bars, beats, ticks) {
    return (bars * ticksPerBar()) + (beats * ticksPerBeat()) + ticks;
  }

  function ticksToPosition(totalTicks) {
    var tpBar = ticksPerBar();
    var tpBeat = ticksPerBeat();
    var bars = Math.floor(totalTicks / tpBar);
    var remainder = totalTicks - (bars * tpBar);
    var beats = Math.floor(remainder / tpBeat);
    var ticks = Math.round(remainder - (beats * tpBeat));
    return { bars: bars, beats: beats, ticks: ticks };
  }

  function convertToSeconds(bars, beats, ticks) {
    var totalTicks = positionToTicks(bars, beats, ticks);
    return totalTicks * tickDuration();
  }

  function convertToPosition(seconds) {
    var totalTicks = Math.round(seconds / tickDuration());
    return ticksToPosition(totalTicks);
  }

  function getPositionInSeconds() {
    return positionTicks * tickDuration();
  }

  function fire(name, data) {
    if (callbacks[name]) {
      callbacks[name](data);
    }
  }

  function playMetronomeClick(time, accent) {
    if (!metronomeEnabled) return;
    var ac = getContext();
    var osc = ac.createOscillator();
    var env = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = accent ? 1000 : 800;
    env.gain.value = 0;
    env.gain.setValueAtTime(metronomeVolume * (accent ? 1.0 : 0.6), time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    osc.connect(env);
    env.connect(ac.destination);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  function scheduleTick() {
    var ac = getContext();
    var currentTime = ac.currentTime;

    while (nextTickTime < currentTime + scheduleAheadTime) {
      // Handle count-in phase
      if (isCountingIn) {
        var tpBeat = ticksPerBeat();
        var tpBar = ticksPerBar();

        if (nextTick % tpBeat === 0) {
          var isAccent = (nextTick % tpBar) === 0;
          playMetronomeClick(nextTickTime, isAccent);
        }

        nextTick++;
        nextTickTime += tickDuration();

        if (nextTick >= countInTicks) {
          isCountingIn = false;
          nextTick = 0;
          startContextTime = nextTickTime;
          positionTicks = 0;
        }
        continue;
      }

      // Normal playback scheduling
      positionTicks = nextTick;

      // Loop handling
      if (loopRegion.enabled && positionTicks >= loopRegion.end) {
        positionTicks = loopRegion.start;
        nextTick = loopRegion.start;
        fire('onPositionChange', ticksToPosition(positionTicks));
      }

      var tpBeatNorm = ticksPerBeat();
      var tpBarNorm = ticksPerBar();
      var currentBeat = Math.floor(positionTicks / tpBeatNorm);
      var currentBar = Math.floor(positionTicks / tpBarNorm);

      // Beat boundary
      if (positionTicks % tpBeatNorm === 0) {
        if (currentBeat !== lastBeat) {
          lastBeat = currentBeat;
          var isBarAccent = (positionTicks % tpBarNorm) === 0;
          playMetronomeClick(nextTickTime, isBarAccent);
          fire('onBeat', {
            beat: currentBeat,
            position: ticksToPosition(positionTicks),
            time: nextTickTime
          });
        }
      }

      // Bar boundary
      if (positionTicks % tpBarNorm === 0) {
        if (currentBar !== lastBar) {
          lastBar = currentBar;
          fire('onBar', {
            bar: currentBar,
            position: ticksToPosition(positionTicks),
            time: nextTickTime
          });
        }
      }

      // Tick callback (throttled to every PPQ/24 ticks to avoid overwhelming)
      if (positionTicks % (PPQ / 24) === 0) {
        fire('onTick', {
          tick: positionTicks,
          position: ticksToPosition(positionTicks),
          time: nextTickTime
        });
      }

      nextTick++;
      nextTickTime += tickDuration();
    }
  }

  function startScheduler() {
    if (schedulerTimer !== null) return;
    schedulerTimer = setInterval(scheduleTick, scheduleInterval);
  }

  function stopScheduler() {
    if (schedulerTimer !== null) {
      clearInterval(schedulerTimer);
      schedulerTimer = null;
    }
  }

  function play() {
    if (state === 'playing') return;
    var ac = getContext();
    DAW.AudioEngine.ensureResumed();

    if (state === 'paused') {
      nextTick = pausedPositionTicks;
      positionTicks = pausedPositionTicks;
    } else {
      nextTick = positionTicks;
    }

    nextTickTime = ac.currentTime;
    startContextTime = ac.currentTime - (positionTicks * tickDuration());
    lastBeat = -1;
    lastBar = -1;
    state = 'playing';
    startScheduler();
    fire('onPlay', { state: state });
  }

  function stop() {
    stopScheduler();
    isCountingIn = false;
    state = 'stopped';
    positionTicks = 0;
    pausedPositionTicks = 0;
    lastBeat = -1;
    lastBar = -1;
    fire('onStop', { state: state });
    fire('onPositionChange', ticksToPosition(0));
  }

  function pause() {
    if (state !== 'playing' && state !== 'recording') return;
    stopScheduler();
    pausedPositionTicks = positionTicks;
    state = 'paused';
    if (callbacks.onPause) callbacks.onPause({ state: state });
  }

  function record() {
    var ac = getContext();
    DAW.AudioEngine.ensureResumed();

    if (countInBars > 0) {
      isCountingIn = true;
      countInTicks = countInBars * ticksPerBar();
      nextTick = 0;
      nextTickTime = ac.currentTime;
      lastBeat = -1;
      lastBar = -1;
      state = 'recording';
      startScheduler();
      fire('onPlay', { state: state });
    } else {
      state = 'recording';
      nextTick = positionTicks;
      nextTickTime = ac.currentTime;
      startContextTime = ac.currentTime - (positionTicks * tickDuration());
      lastBeat = -1;
      lastBar = -1;
      startScheduler();
      fire('onPlay', { state: state });
    }
  }

  function setPosition(bars, beats, ticks) {
    positionTicks = positionToTicks(bars, beats, ticks);
    pausedPositionTicks = positionTicks;
    if (state === 'playing' || state === 'recording') {
      nextTick = positionTicks;
      var ac = getContext();
      startContextTime = ac.currentTime - (positionTicks * tickDuration());
      lastBeat = -1;
      lastBar = -1;
    }
    fire('onPositionChange', ticksToPosition(positionTicks));
  }

  function setPositionSeconds(seconds) {
    var pos = convertToPosition(seconds);
    setPosition(pos.bars, pos.beats, pos.ticks);
  }

  function setBPM(newBPM) {
    if (newBPM < 20) newBPM = 20;
    if (newBPM > 999) newBPM = 999;
    bpm = newBPM;
  }

  function tapTempo() {
    var now = Date.now();
    if (tapTimeout) clearTimeout(tapTimeout);
    tapTimeout = setTimeout(function () { tapTimes = []; }, 2000);

    tapTimes.push(now);
    if (tapTimes.length > 8) tapTimes.shift();

    if (tapTimes.length >= 2) {
      var sum = 0;
      for (var i = 1; i < tapTimes.length; i++) {
        sum += tapTimes[i] - tapTimes[i - 1];
      }
      var avgMs = sum / (tapTimes.length - 1);
      var tappedBPM = Math.round(60000 / avgMs);
      setBPM(tappedBPM);
    }
  }

  function setTimeSignature(num, den) {
    timeSignature.numerator = num;
    timeSignature.denominator = den;
  }

  function setLoopRegion(startTicks, endTicks, enabled) {
    loopRegion.start = startTicks;
    loopRegion.end = endTicks;
    if (typeof enabled !== 'undefined') {
      loopRegion.enabled = enabled;
    }
  }

  function setMetronome(enabled) {
    metronomeEnabled = enabled;
  }

  function setMetronomeVolume(vol) {
    metronomeVolume = Math.max(0, Math.min(1, vol));
  }

  function setCountIn(bars) {
    countInBars = (bars === 1 || bars === 2) ? bars : 0;
  }

  function on(eventName, fn) {
    if (callbacks.hasOwnProperty(eventName)) {
      callbacks[eventName] = fn;
    }
  }

  return {
    PPQ: PPQ,

    play: play,
    stop: stop,
    pause: pause,
    record: record,

    getState: function () { return state; },
    isPlaying: function () { return state === 'playing' || state === 'recording'; },
    isRecording: function () { return state === 'recording'; },

    setBPM: setBPM,
    getBPM: function () { return bpm; },
    tapTempo: tapTempo,

    setTimeSignature: setTimeSignature,
    getTimeSignature: function () { return { numerator: timeSignature.numerator, denominator: timeSignature.denominator }; },

    setPosition: setPosition,
    setPositionSeconds: setPositionSeconds,
    getPosition: function () { return ticksToPosition(positionTicks); },
    getPositionTicks: function () { return positionTicks; },
    getPositionInSeconds: getPositionInSeconds,

    setLoopRegion: setLoopRegion,
    getLoopRegion: function () { return { start: loopRegion.start, end: loopRegion.end, enabled: loopRegion.enabled }; },
    setLoopEnabled: function (en) { loopRegion.enabled = en; },

    setMetronome: setMetronome,
    getMetronomeEnabled: function () { return metronomeEnabled; },
    setMetronomeVolume: setMetronomeVolume,

    setCountIn: setCountIn,
    getCountIn: function () { return countInBars; },

    convertToSeconds: convertToSeconds,
    convertToPosition: convertToPosition,
    ticksToPosition: ticksToPosition,
    positionToTicks: positionToTicks,
    ticksPerBeat: ticksPerBeat,
    ticksPerBar: ticksPerBar,

    on: on
  };
})();
