var DAW = DAW || {};

DAW.App = (function () {
  var state = {
    hasRecording: false,
    chords: null,
    drumData: null,
    isPlaying: false,
    playStartTime: 0,
    animFrameId: null,
    totalDuration: 0
  };

  var els = {};

  function init() {
    els.btnRecord = document.getElementById('btn-record');
    els.btnPlay = document.getElementById('btn-play');
    els.btnStop = document.getElementById('btn-stop');
    els.btnAnalyze = document.getElementById('btn-analyze');
    els.btnGenDrums = document.getElementById('btn-generate-drums');
    els.drumStyle = document.getElementById('drum-style');
    els.bpm = document.getElementById('bpm');
    els.timeDisplay = document.getElementById('time-display');
    els.status = document.getElementById('status-message');

    els.canvasWaveform = document.getElementById('waveform-recording');
    els.canvasChords = document.getElementById('chord-display');
    els.canvasDrums = document.getElementById('drum-display');

    els.placeholderRec = document.getElementById('recording-placeholder');
    els.placeholderChords = document.getElementById('chords-placeholder');
    els.placeholderDrums = document.getElementById('drums-placeholder');

    els.volRecording = document.getElementById('vol-recording');
    els.volDrums = document.getElementById('vol-drums');

    els.btnRecord.addEventListener('click', toggleRecord);
    els.btnPlay.addEventListener('click', startPlayback);
    els.btnStop.addEventListener('click', stopPlayback);
    els.btnAnalyze.addEventListener('click', analyzeChords);
    els.btnGenDrums.addEventListener('click', generateDrums);

    els.volRecording.addEventListener('input', function () {
      DAW.AudioEngine.setRecordingVolume(parseFloat(this.value));
    });
    els.volDrums.addEventListener('input', function () {
      DAW.AudioEngine.setDrumsVolume(parseFloat(this.value));
    });

    window.addEventListener('resize', redrawAll);

    setStatus('Ready - click REC to start recording');
  }

  function setStatus(msg) {
    els.status.textContent = msg;
  }

  function formatTime(seconds) {
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function toggleRecord() {
    if (DAW.AudioEngine.isRecording()) {
      DAW.AudioEngine.stopRecording();
      els.btnRecord.classList.remove('recording');
      els.btnRecord.textContent = '● REC';
      setStatus('Processing recording...');
    } else {
      state.hasRecording = false;
      state.chords = null;
      state.drumData = null;
      els.btnPlay.disabled = true;
      els.btnAnalyze.disabled = true;
      els.btnGenDrums.disabled = true;
      els.placeholderRec.style.display = '';
      els.placeholderChords.style.display = '';
      els.placeholderDrums.style.display = '';

      DAW.AudioEngine.startRecording(onRecordingReady).then(function () {
        els.btnRecord.classList.add('recording');
        els.btnRecord.textContent = '■ STOP REC';
        setStatus('Recording... click again to stop');
      }).catch(function (err) {
        setStatus('Microphone access denied: ' + err.message);
      });
    }
  }

  function onRecordingReady(buffer) {
    state.hasRecording = true;
    state.totalDuration = buffer.duration;
    els.placeholderRec.style.display = 'none';
    els.btnPlay.disabled = false;
    els.btnAnalyze.disabled = false;

    DAW.WaveformRenderer.drawWaveform(els.canvasWaveform, buffer, '#4ecca3');

    var estimatedBPM = DAW.ChordDetector.estimateTempo(buffer);
    els.bpm.value = estimatedBPM;

    setStatus('Recording ready (' + formatTime(buffer.duration) + ') - estimated BPM: ' + estimatedBPM);
  }

  function analyzeChords() {
    var buffer = DAW.AudioEngine.getRecordedBuffer();
    if (!buffer) return;

    setStatus('Analyzing chords...');
    els.btnAnalyze.disabled = true;

    setTimeout(function () {
      state.chords = DAW.ChordDetector.analyze(buffer, 0.5);
      els.placeholderChords.style.display = 'none';
      DAW.WaveformRenderer.drawChords(els.canvasChords, state.chords, state.totalDuration);

      els.btnGenDrums.disabled = false;
      els.btnAnalyze.disabled = false;

      var chordNames = state.chords
        .filter(function (c) { return c.chord !== 'N'; })
        .map(function (c) { return c.chord; });
      var unique = chordNames.filter(function (v, i, a) { return a.indexOf(v) === i; });

      setStatus('Detected chords: ' + unique.join(', '));
    }, 50);
  }

  function generateDrums() {
    var buffer = DAW.AudioEngine.getRecordedBuffer();
    if (!buffer) return;

    var style = els.drumStyle.value;
    var bpm = parseInt(els.bpm.value, 10) || 120;

    setStatus('Generating ' + style + ' drums at ' + bpm + ' BPM...');

    state.drumData = DAW.DrumMachine.generatePattern(
      style, state.chords, bpm, state.totalDuration
    );

    els.placeholderDrums.style.display = 'none';
    DAW.WaveformRenderer.drawDrumPattern(els.canvasDrums, state.drumData);

    setStatus(style.charAt(0).toUpperCase() + style.slice(1) + ' drum pattern generated - press PLAY');
  }

  function startPlayback() {
    if (state.isPlaying) return;
    state.isPlaying = true;

    DAW.AudioEngine.ensureResumed().then(function () {
      var ac = DAW.AudioEngine.getContext();
      state.playStartTime = ac.currentTime;

      DAW.AudioEngine.playRecording(0);

      if (state.drumData) {
        DAW.DrumMachine.play(state.drumData, 0);
      }

      els.btnPlay.disabled = true;
      els.btnStop.disabled = false;
      els.btnRecord.disabled = true;

      setStatus('Playing...');
      updatePlayhead();
    });
  }

  function stopPlayback() {
    state.isPlaying = false;
    DAW.AudioEngine.stopPlayback();
    DAW.DrumMachine.stop();

    els.btnPlay.disabled = false;
    els.btnStop.disabled = true;
    els.btnRecord.disabled = false;

    if (state.animFrameId) {
      cancelAnimationFrame(state.animFrameId);
      state.animFrameId = null;
    }

    redrawAll();
    els.timeDisplay.textContent = '0:00';
    setStatus('Stopped');
  }

  function updatePlayhead() {
    if (!state.isPlaying) return;

    var ac = DAW.AudioEngine.getContext();
    var elapsed = ac.currentTime - state.playStartTime;

    if (elapsed >= state.totalDuration) {
      stopPlayback();
      return;
    }

    var ratio = elapsed / state.totalDuration;
    els.timeDisplay.textContent = formatTime(elapsed);

    var buffer = DAW.AudioEngine.getRecordedBuffer();
    DAW.WaveformRenderer.drawWaveform(els.canvasWaveform, buffer, '#4ecca3', ratio);

    if (state.chords) {
      DAW.WaveformRenderer.drawChords(els.canvasChords, state.chords, state.totalDuration, ratio);
    }
    if (state.drumData) {
      DAW.WaveformRenderer.drawDrumPattern(els.canvasDrums, state.drumData, ratio);
    }

    state.animFrameId = requestAnimationFrame(updatePlayhead);
  }

  function redrawAll() {
    var buffer = DAW.AudioEngine.getRecordedBuffer();
    if (buffer) {
      DAW.WaveformRenderer.drawWaveform(els.canvasWaveform, buffer, '#4ecca3');
    }
    if (state.chords) {
      DAW.WaveformRenderer.drawChords(els.canvasChords, state.chords, state.totalDuration);
    }
    if (state.drumData) {
      DAW.WaveformRenderer.drawDrumPattern(els.canvasDrums, state.drumData);
    }
  }

  return { init: init };
})();

document.addEventListener('DOMContentLoaded', DAW.App.init);
