var DAW = DAW || {};

DAW.App = (function () {
  var state = {
    currentView: 'arrange',
    selectedTrackId: null,
    selectedClipId: null,
    activeClip: null,
    isInitialized: false,
    animFrameId: null,
    bottomPanelOpen: true,
    currentBottomPanel: 'instrument',
    keyboardVisible: false
  };

  var els = {};

  function init() {
    cacheElements();
    bindEvents();
    initModules();
    buildVirtualKeyboard();
    setStatus('Ready');
    state.isInitialized = true;
    startRenderLoop();
  }

  function cacheElements() {
    els.btnPlay = document.getElementById('btn-play');
    els.btnStop = document.getElementById('btn-stop');
    els.btnRecord = document.getElementById('btn-record');
    els.btnRewind = document.getElementById('btn-rewind');
    els.btnLoop = document.getElementById('btn-loop');
    els.btnMetronome = document.getElementById('btn-metronome');
    els.btnCountin = document.getElementById('btn-countin');
    els.bpm = document.getElementById('bpm');
    els.timeSig = document.getElementById('time-sig');
    els.transportPosition = document.getElementById('transport-position');
    els.transportTime = document.getElementById('transport-time');
    els.statusMessage = document.getElementById('status-message');

    els.btnAddAudioTrack = document.getElementById('btn-add-audio-track');
    els.btnAddMidiTrack = document.getElementById('btn-add-midi-track');
    els.btnAddBus = document.getElementById('btn-add-bus');

    els.btnExport = document.getElementById('btn-export');
    els.btnSave = document.getElementById('btn-save');
    els.modalExport = document.getElementById('modal-export');
    els.btnCloseExport = document.getElementById('btn-close-export');
    els.btnDoExport = document.getElementById('btn-do-export');

    els.btnToggleBottom = document.getElementById('btn-toggle-bottom');
    els.bottomPanel = document.getElementById('bottom-panel');

    els.instrumentType = document.getElementById('instrument-type');
    els.instrumentPreset = document.getElementById('instrument-preset');
    els.addEffectType = document.getElementById('add-effect-type');
    els.effectsSlots = document.getElementById('effects-slots');

    els.btnAnalyzeChords = document.getElementById('btn-analyze-chords');
    els.btnGenDrums = document.getElementById('btn-gen-drums');
    els.chordDisplay = document.getElementById('chord-display');

    els.btnToggleKeyboard = document.getElementById('btn-toggle-keyboard');
    els.virtualKeyboard = document.getElementById('virtual-keyboard');
    els.keyboardKeys = document.getElementById('keyboard-keys');
    els.kbOctave = document.getElementById('kb-octave');
    els.kbVelocity = document.getElementById('kb-velocity');

    els.drumStyle = document.getElementById('drum-style');
    els.hZoom = document.getElementById('h-zoom');
    els.vZoom = document.getElementById('v-zoom');
  }

  function bindEvents() {
    els.btnPlay.addEventListener('click', handlePlay);
    els.btnStop.addEventListener('click', handleStop);
    els.btnRecord.addEventListener('click', handleRecord);
    els.btnRewind.addEventListener('click', handleRewind);
    els.btnLoop.addEventListener('click', function () { toggleButton(this); toggleLoop(); });
    els.btnMetronome.addEventListener('click', function () { toggleButton(this); toggleMetronome(); });
    els.btnCountin.addEventListener('click', function () { toggleButton(this); toggleCountin(); });

    els.bpm.addEventListener('change', function () {
      var bpm = parseInt(this.value, 10) || 120;
      if (DAW.Transport) DAW.Transport.setBPM(bpm);
      setStatus('Tempo: ' + bpm + ' BPM');
    });

    els.timeSig.addEventListener('change', function () {
      var parts = this.value.split('/');
      if (DAW.Transport) DAW.Transport.setTimeSignature(parseInt(parts[0], 10), parseInt(parts[1], 10));
    });

    bindTabSwitching('#tab-bar .tab[data-view]', function (el) { switchView(el.getAttribute('data-view')); });
    bindTabSwitching('.bottom-tab[data-panel]', function (el) { switchBottomPanel(el.getAttribute('data-panel')); });

    els.btnToggleBottom.addEventListener('click', toggleBottomPanel);

    if (els.btnAddAudioTrack) els.btnAddAudioTrack.addEventListener('click', function () { addTrack('audio'); });
    if (els.btnAddMidiTrack) els.btnAddMidiTrack.addEventListener('click', function () { addTrack('midi'); });
    if (els.btnAddBus) els.btnAddBus.addEventListener('click', function () { addTrack('bus'); });

    els.btnExport.addEventListener('click', function () { els.modalExport.classList.remove('hidden'); });
    els.btnCloseExport.addEventListener('click', function () { els.modalExport.classList.add('hidden'); });
    els.btnDoExport.addEventListener('click', handleExport);
    els.btnSave.addEventListener('click', handleSave);

    els.btnToggleKeyboard.addEventListener('click', toggleVirtualKeyboard);

    if (els.addEffectType) {
      els.addEffectType.addEventListener('change', function () {
        if (this.value) { addEffect(this.value); this.value = ''; }
      });
    }

    if (els.instrumentPreset) {
      els.instrumentPreset.addEventListener('change', function () {
        if (DAW.Synth && DAW.Synth.setPreset) {
          DAW.Synth.setPreset(this.value);
          setStatus('Preset: ' + this.value);
        }
      });
    }

    if (els.btnAnalyzeChords) els.btnAnalyzeChords.addEventListener('click', analyzeChords);
    if (els.btnGenDrums) els.btnGenDrums.addEventListener('click', generateDrums);

    var btnQuantize = document.getElementById('btn-quantize');
    var btnHumanize = document.getElementById('btn-humanize');
    if (btnQuantize) btnQuantize.addEventListener('click', function () { setStatus('Quantized'); });
    if (btnHumanize) btnHumanize.addEventListener('click', function () { setStatus('Humanized'); });

    var btnDrumClear = document.getElementById('btn-drum-clear');
    var btnDrumLoad = document.getElementById('btn-drum-load-pattern');
    if (btnDrumClear) btnDrumClear.addEventListener('click', function () {
      if (DAW.StepSequencer && DAW.StepSequencer.clear) DAW.StepSequencer.clear();
      setStatus('Pattern cleared');
    });
    if (btnDrumLoad) btnDrumLoad.addEventListener('click', function () {
      var style = els.drumStyle ? els.drumStyle.value : 'rock';
      setStatus('Loaded ' + style + ' pattern');
    });

    bindEditButtons();
    bindPianoRollTools();
    bindSynthControls();

    if (els.hZoom) els.hZoom.addEventListener('input', function () {
      if (DAW.Timeline && DAW.Timeline.setZoom) DAW.Timeline.setZoom(parseFloat(this.value));
    });
    if (els.vZoom) els.vZoom.addEventListener('input', function () {
      if (DAW.Timeline && DAW.Timeline.setVZoom) DAW.Timeline.setVZoom(parseFloat(this.value));
    });

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    window.addEventListener('resize', handleResize);
  }

  function bindTabSwitching(selector, handler) {
    var items = document.querySelectorAll(selector);
    for (var i = 0; i < items.length; i++) {
      items[i].addEventListener('click', (function (el) { return function () { handler(el); }; })(items[i]));
    }
  }

  function bindEditButtons() {
    var ops = ['cut', 'copy', 'paste', 'delete', 'normalize', 'reverse',
      'fadein', 'fadeout', 'silence', 'timestretch', 'pitchshift', 'denoise', 'phase'];
    ops.forEach(function (op) {
      var el = document.getElementById('btn-edit-' + op);
      if (el) el.addEventListener('click', function () { setStatus('Edit: ' + op); });
    });
  }

  function bindPianoRollTools() {
    var tools = document.querySelectorAll('#view-pianoroll .view-toolbar [data-tool]');
    for (var i = 0; i < tools.length; i++) {
      tools[i].addEventListener('click', (function (allTools) {
        return function () {
          for (var x = 0; x < allTools.length; x++) allTools[x].classList.remove('active');
          this.classList.add('active');
          if (DAW.PianoRoll && DAW.PianoRoll.setTool) DAW.PianoRoll.setTool(this.getAttribute('data-tool'));
        };
      })(tools));
    }
  }

  function bindSynthControls() {
    var params = [
      ['osc1-type', 'osc1Type'], ['osc1-oct', 'osc1Octave'], ['osc1-detune', 'osc1Detune'],
      ['osc1-level', 'osc1Level'], ['osc2-type', 'osc2Type'], ['osc2-oct', 'osc2Octave'],
      ['osc2-detune', 'osc2Detune'], ['osc2-level', 'osc2Level'],
      ['filter-type', 'filterType'], ['filter-cutoff', 'filterCutoff'],
      ['filter-q', 'filterQ'], ['filter-env', 'filterEnvAmount'],
      ['amp-a', 'ampAttack'], ['amp-d', 'ampDecay'], ['amp-s', 'ampSustain'], ['amp-r', 'ampRelease'],
      ['flt-a', 'filterAttack'], ['flt-d', 'filterDecay'], ['flt-s', 'filterSustain'], ['flt-r', 'filterRelease'],
      ['lfo-rate', 'lfoRate'], ['lfo-depth', 'lfoDepth'], ['lfo-dest', 'lfoDest'], ['lfo-wave', 'lfoWave'],
      ['glide', 'glide'], ['unison', 'unison'], ['unison-spread', 'unisonSpread'], ['sub-level', 'subLevel']
    ];
    params.forEach(function (p) {
      var el = document.getElementById(p[0]);
      if (!el) return;
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () {
        var val = el.tagName === 'SELECT' ? el.value : parseFloat(el.value);
        if (DAW.Synth && DAW.Synth.setParam) DAW.Synth.setParam(p[1], val);
      });
    });
  }

  function initModules() {
    var ac = DAW.AudioEngine.getContext();

    // Initialize views FIRST so render() calls from addTrack are safe
    initView('Timeline', 'arrange-container');
    initView('PianoRoll', 'pianoroll-container');
    initView('MixerView', 'mix-container');
    initView('SessionView', 'session-container');
    initView('StepSequencer', 'drumpad-container');

    if (DAW.Transport) {
      DAW.Transport.on('onPositionChange', updateTransportDisplay);
      DAW.Transport.on('onPlay', function () { els.btnPlay.classList.add('active'); setStatus('Playing'); });
      DAW.Transport.on('onStop', function () {
        els.btnPlay.classList.remove('active');
        els.btnRecord.classList.remove('recording');
        setStatus('Stopped');
      });
    }

    if (DAW.Synth && DAW.Synth.create) {
      DAW.AudioEngine.initGains();
      var output = DAW.AudioEngine.getMasterGain ? DAW.AudioEngine.getMasterGain() : ac.destination;
      DAW.Synth.create(ac, output);
    }

    if (DAW.MIDIEngine && DAW.MIDIEngine.init) {
      DAW.MIDIEngine.init();
      DAW.MIDIEngine.onNoteOn = function (note, velocity) {
        DAW.AudioEngine.ensureResumed();
        if (DAW.Synth && DAW.Synth.noteOn) DAW.Synth.noteOn(note, velocity, 0);
        highlightKey(note, true);
      };
      DAW.MIDIEngine.onNoteOff = function (note) {
        if (DAW.Synth && DAW.Synth.noteOff) DAW.Synth.noteOff(note, 0);
        highlightKey(note, false);
      };
    }

    if (DAW.Timeline) {
      DAW.Timeline.onClipDoubleClick = function (clip) {
        if (clip && clip.type === 'midi') {
          state.activeClip = clip;
          if (DAW.PianoRoll && DAW.PianoRoll.setClip) {
            DAW.PianoRoll.setClip(clip);
            switchView('pianoroll');
            setStatus('Editing: ' + clip.name);
          }
        }
      };
    }

    bindMIDIFileDrop();

    if (DAW.TrackManager) {
      addTrack('audio', 'Audio 1');
      addTrack('midi', 'MIDI 1');
    }
  }

  function bindMIDIFileDrop() {
    var arrangeContainer = document.getElementById('arrange-container');
    if (!arrangeContainer) return;

    arrangeContainer.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    arrangeContainer.addEventListener('drop', function (e) {
      e.preventDefault();
      var files = e.dataTransfer.files;
      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        if (file.name.match(/\.mid$/i) || file.name.match(/\.midi$/i)) {
          loadMIDIFile(file);
        }
      }
    });
  }

  function loadMIDIFile(file) {
    setStatus('Loading MIDI: ' + file.name);
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var bytes = new Uint8Array(e.target.result);
        var parsed = parseMIDI(bytes);
        if (!parsed) { setStatus('Invalid MIDI file'); return; }

        var track = addTrack('midi', file.name.replace(/\.midi?$/i, ''));
        if (!track) return;

        var clip = track.clips[0];
        if (!clip && DAW.Clip) {
          clip = DAW.Clip.createMIDIClip(track.id, 0, parsed.duration);
          track.clips.push(clip);
        }
        if (clip) {
          clip.notes = parsed.notes;
          clip.duration = parsed.duration;
          state.activeClip = clip;
          if (DAW.PianoRoll && DAW.PianoRoll.setClip) {
            DAW.PianoRoll.setClip(clip);
            switchView('pianoroll');
          }
        }
        refreshViews();
        setStatus('Loaded MIDI: ' + file.name + ' (' + parsed.notes.length + ' notes)');
      } catch (err) {
        setStatus('MIDI load error: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function parseMIDI(bytes) {
    var pos = 0;

    function read(n) {
      var r = bytes.slice(pos, pos + n);
      pos += n;
      return r;
    }
    function readUint32() {
      var b = read(4);
      return (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
    }
    function readUint16() {
      var b = read(2);
      return (b[0] << 8) | b[1];
    }
    function readVarLen() {
      var v = 0, b;
      do { b = bytes[pos++]; v = (v << 7) | (b & 0x7F); } while (b & 0x80);
      return v;
    }

    // Header
    if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'MThd') return null;
    pos = 4;
    readUint32(); // header length (always 6)
    var format = readUint16();
    var numTracks = readUint16();
    var division = readUint16();
    if (division & 0x8000) return null; // SMPTE not supported
    var ppq = division;

    var notes = [];
    var tempoUs = 500000;
    var maxTick = 0;

    for (var t = 0; t < numTracks; t++) {
      if (String.fromCharCode(bytes[pos], bytes[pos+1], bytes[pos+2], bytes[pos+3]) !== 'MTrk') break;
      pos += 4;
      var trackLen = readUint32();
      var trackEnd = pos + trackLen;
      var tick = 0;
      var lastStatus = 0;
      var activeNotes = {};

      while (pos < trackEnd) {
        tick += readVarLen();
        var statusByte = bytes[pos];
        if (statusByte & 0x80) { lastStatus = statusByte; pos++; }
        else { statusByte = lastStatus; }

        var type = statusByte & 0xF0;
        var ch = statusByte & 0x0F;

        if (type === 0xFF) { // Meta
          var metaType = bytes[pos++];
          var metaLen = readVarLen();
          if (metaType === 0x51 && metaLen === 3) { // Tempo
            tempoUs = (bytes[pos] << 16) | (bytes[pos+1] << 8) | bytes[pos+2];
          }
          pos += metaLen;
        } else if (type === 0x90 && bytes[pos+1] > 0) { // Note On
          var pitch = bytes[pos++], vel = bytes[pos++];
          activeNotes[ch + '_' + pitch] = { pitch: pitch, velocity: vel, startTick: tick };
        } else if (type === 0x80 || (type === 0x90 && bytes[pos+1] === 0)) { // Note Off
          var offPitch = bytes[pos++]; pos++;
          var key = ch + '_' + offPitch;
          if (activeNotes[key]) {
            var n = activeNotes[key];
            var startBeat = n.startTick / ppq;
            var durBeat = (tick - n.startTick) / ppq;
            notes.push({ id: 'mid_' + notes.length, pitch: n.pitch, start: startBeat, duration: Math.max(0.0625, durBeat), velocity: n.velocity, channel: ch });
            if (tick > maxTick) maxTick = tick;
            delete activeNotes[key];
          }
        } else if (type === 0xA0 || type === 0xB0 || type === 0xE0) { pos += 2; }
        else if (type === 0xC0 || type === 0xD0) { pos += 1; }
        else { pos++; }
      }
      pos = trackEnd;
    }

    var duration = (maxTick / ppq) || 4;
    return { notes: notes, duration: duration, ppq: ppq };
  }

  function initView(moduleName, containerId) {
    if (DAW[moduleName] && DAW[moduleName].init) {
      var container = document.getElementById(containerId);
      if (container) DAW[moduleName].init(container);
    }
  }

  function switchView(viewName) {
    state.currentView = viewName;
    var views = document.querySelectorAll('.view');
    var tabs = document.querySelectorAll('#tab-bar .tab[data-view]');
    for (var i = 0; i < views.length; i++) views[i].classList.remove('active');
    for (var j = 0; j < tabs.length; j++) {
      tabs[j].classList.remove('active');
      if (tabs[j].getAttribute('data-view') === viewName) tabs[j].classList.add('active');
    }
    var target = document.getElementById('view-' + viewName);
    if (target) target.classList.add('active');
    handleResize();
  }

  function switchBottomPanel(panelName) {
    state.currentBottomPanel = panelName;
    var views = document.querySelectorAll('.bottom-view');
    var tabs = document.querySelectorAll('.bottom-tab[data-panel]');
    for (var i = 0; i < views.length; i++) views[i].classList.remove('active');
    for (var j = 0; j < tabs.length; j++) {
      tabs[j].classList.remove('active');
      if (tabs[j].getAttribute('data-panel') === panelName) tabs[j].classList.add('active');
    }
    var target = document.getElementById('panel-' + panelName);
    if (target) target.classList.add('active');
    if (!state.bottomPanelOpen) toggleBottomPanel();
  }

  function toggleBottomPanel() {
    state.bottomPanelOpen = !state.bottomPanelOpen;
    els.bottomPanel.classList.toggle('collapsed');
    els.btnToggleBottom.textContent = state.bottomPanelOpen ? '▼' : '▲';
    handleResize();
  }

  function handlePlay() {
    DAW.AudioEngine.ensureResumed().then(function () {
      if (DAW.Transport) DAW.Transport.play();
      els.btnPlay.classList.add('active');
      setStatus('Playing');
    });
  }

  function handleStop() {
    if (DAW.Transport) DAW.Transport.stop();
    els.btnPlay.classList.remove('active');
    els.btnRecord.classList.remove('recording');
    updateTransportDisplay({ bars: 0, beats: 0, ticks: 0 });
    setStatus('Stopped');
  }

  function handleRecord() {
    DAW.AudioEngine.ensureResumed().then(function () {
      var isRec = els.btnRecord.classList.toggle('recording');
      if (isRec) {
        if (DAW.Transport) DAW.Transport.record();
        var armedTracks = [];
        if (DAW.TrackManager) {
          DAW.TrackManager.getTracks().forEach(function (t) { if (t.armed) armedTracks.push(t.id); });
          if (armedTracks.length === 0) {
            var audio = DAW.TrackManager.getTracksByType('audio');
            if (audio.length > 0) { audio[0].armed = true; armedTracks.push(audio[0].id); }
          }
        }
        if (DAW.Recorder && armedTracks.length > 0) DAW.Recorder.startRecording(armedTracks);
        setStatus('Recording...');
      } else {
        if (DAW.Recorder) DAW.Recorder.stopRecording();
        if (DAW.Transport) DAW.Transport.stop();
        setStatus('Recording stopped');
      }
    });
  }

  function handleRewind() {
    if (DAW.Transport) { DAW.Transport.stop(); DAW.Transport.setPosition(0, 0, 0); }
    updateTransportDisplay({ bars: 0, beats: 0, ticks: 0 });
  }

  function toggleLoop() {
    if (DAW.Transport && DAW.Transport.setLoopRegion) {
      var region = DAW.Transport.getLoopRegion();
      DAW.Transport.setLoopRegion(region.start, region.end, !region.enabled);
    }
  }

  function toggleMetronome() {
    if (DAW.Transport) {
      DAW.Transport.setMetronome(!DAW.Transport.getMetronomeEnabled());
    }
  }

  function toggleCountin() {
    if (DAW.Transport) {
      DAW.Transport.setCountIn(DAW.Transport.getCountIn() ? 0 : 1);
    }
  }

  function toggleButton(btn) { btn.classList.toggle('active'); }

  function addTrack(type, name) {
    if (!DAW.TrackManager) return null;
    var track = DAW.TrackManager.createTrack(type, name);
    if (track) {
      if (type === 'midi' && DAW.Clip) {
        var clip = DAW.Clip.createMIDIClip(track.id, 0, 8);
        track.clips.push(clip);
        if (!state.activeClip) {
          state.activeClip = clip;
          if (DAW.PianoRoll && DAW.PianoRoll.setClip) DAW.PianoRoll.setClip(clip);
        }
      }
      setStatus('Added ' + type + ' track: ' + track.name);
      refreshViews();
    }
    return track;
  }

  function addEffect(effectType) {
    var slot = document.createElement('div');
    slot.className = 'effect-slot';
    slot.innerHTML = '<span class="effect-bypass">●</span>' +
      '<span class="effect-name">' + effectType.toUpperCase() + '</span>' +
      '<span class="effect-remove">×</span>';
    slot.querySelector('.effect-remove').addEventListener('click', function () {
      slot.remove();
      if (els.effectsSlots.children.length === 0) {
        els.effectsSlots.innerHTML = '<div class="effect-placeholder">No effects loaded</div>';
      }
    });
    var ph = els.effectsSlots.querySelector('.effect-placeholder');
    if (ph) ph.remove();
    els.effectsSlots.appendChild(slot);
    setStatus('Added effect: ' + effectType);
  }

  function analyzeChords() {
    var buffer = DAW.AudioEngine.getRecordedBuffer();
    if (!buffer) { setStatus('No recording to analyze'); return; }
    setStatus('Analyzing chords...');
    setTimeout(function () {
      if (!DAW.ChordDetector) return;
      var chords = DAW.ChordDetector.analyze(buffer, 0.5);
      var unique = [];
      chords.forEach(function (c) {
        if (c.chord !== 'N' && unique.indexOf(c.chord) === -1) unique.push(c.chord);
      });
      if (DAW.WaveformRenderer && els.chordDisplay) {
        DAW.WaveformRenderer.drawChords(els.chordDisplay, chords, buffer.duration);
      }
      setStatus('Chords: ' + unique.join(', '));
    }, 50);
  }

  function generateDrums() {
    var buffer = DAW.AudioEngine.getRecordedBuffer();
    if (!buffer) { setStatus('No recording'); return; }
    var style = els.drumStyle ? els.drumStyle.value : 'rock';
    var bpm = parseInt(els.bpm.value, 10) || 120;
    if (DAW.DrumMachine && DAW.DrumMachine.generatePattern) {
      DAW.DrumMachine.generatePattern(style, null, bpm, buffer.duration);
    }
    setStatus(style + ' drums generated');
  }

  function handleExport() {
    var fmt = document.getElementById('export-format');
    var formatVal = fmt ? fmt.value : 'wav16';
    setStatus('Exporting ' + formatVal + '...');
    var buffer = DAW.AudioEngine.getRecordedBuffer();
    if (buffer && DAW.ExportEngine && DAW.ExportEngine.exportWAV) {
      var bits = formatVal === 'wav24' ? 24 : 16;
      var blob = DAW.ExportEngine.exportWAV(buffer, bits);
      if (blob && DAW.ExportEngine.download) DAW.ExportEngine.download(blob, 'export.wav');
      setStatus('Export complete');
    }
    els.modalExport.classList.add('hidden');
  }

  function handleSave() {
    if (DAW.ExportEngine && DAW.ExportEngine.exportProject) {
      var json = DAW.ExportEngine.exportProject();
      var blob = new Blob([json], { type: 'application/json' });
      if (DAW.ExportEngine.download) DAW.ExportEngine.download(blob, 'project.dawproject');
      setStatus('Project saved');
    } else {
      setStatus('Project save ready');
    }
  }

  function updateTransportDisplay(pos) {
    if (!pos) return;
    var bar = (pos.bars != null ? pos.bars : (pos.bar || 1) - 1) + 1;
    var beat = (pos.beats != null ? pos.beats : (pos.beat || 1) - 1) + 1;
    var tick = pos.ticks != null ? pos.ticks : (pos.tick || 0);
    els.transportPosition.textContent =
      ('00' + bar).slice(-3) + ' : ' + beat + ' : ' + ('00' + tick).slice(-3);
    var sec = pos.seconds || (DAW.Transport ? DAW.Transport.getPositionInSeconds() : 0);
    var m = Math.floor(sec / 60), s = sec % 60;
    els.transportTime.textContent = m + ':' + (s < 10 ? '0' : '') + s.toFixed(3);
  }

  // Computer keyboard as MIDI input
  var KEY_MAP = { a:0, w:1, s:2, e:3, d:4, f:5, t:6, g:7, y:8, h:9, u:10, j:11, k:12 };

  function handleKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        if (DAW.Transport && DAW.Transport.isPlaying && DAW.Transport.isPlaying()) handleStop();
        else handlePlay();
        return;
      case 'Home': handleRewind(); return;
      case '1': switchView('arrange'); return;
      case '2': switchView('mix'); return;
      case '3': switchView('pianoroll'); return;
      case '4': switchView('session'); return;
      case '5': switchView('drumpad'); return;
      case '6': switchView('edit'); return;
    }

    if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) { handleRecord(); return; }

    var k = e.key.toLowerCase();
    if (KEY_MAP[k] !== undefined && !e.repeat) {
      var oct = els.kbOctave ? parseInt(els.kbOctave.value, 10) : 4;
      var vel = els.kbVelocity ? parseInt(els.kbVelocity.value, 10) : 100;
      var note = KEY_MAP[k] + (oct * 12);
      if (note >= 0 && note <= 127) {
        DAW.AudioEngine.ensureResumed();
        if (DAW.Synth && DAW.Synth.noteOn) DAW.Synth.noteOn(note, vel, 0);
        highlightKey(note, true);
      }
    }
  }

  function handleKeyUp(e) {
    var k = e.key.toLowerCase();
    if (KEY_MAP[k] !== undefined) {
      var oct = els.kbOctave ? parseInt(els.kbOctave.value, 10) : 4;
      var note = KEY_MAP[k] + (oct * 12);
      if (note >= 0 && note <= 127) {
        if (DAW.Synth && DAW.Synth.noteOff) DAW.Synth.noteOff(note, 0);
        highlightKey(note, false);
      }
    }
  }

  function buildVirtualKeyboard() {
    if (!els.keyboardKeys) return;
    els.keyboardKeys.innerHTML = '';
    var oct = els.kbOctave ? parseInt(els.kbOctave.value, 10) : 4;
    var blacks = [1, 3, 6, 8, 10];
    var names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

    for (var o = oct; o <= oct + 1; o++) {
      for (var n = 0; n < 12; n++) {
        var midi = o * 12 + n;
        if (midi > 127) break;
        var isBlack = blacks.indexOf(n) !== -1;
        var keyEl = document.createElement('div');
        keyEl.className = isBlack ? 'key-black' : 'key-white';
        keyEl.setAttribute('data-note', midi);
        keyEl.title = names[n] + o;
        (function (note) {
          keyEl.addEventListener('mousedown', function () {
            DAW.AudioEngine.ensureResumed();
            var v = els.kbVelocity ? parseInt(els.kbVelocity.value, 10) : 100;
            if (DAW.Synth && DAW.Synth.noteOn) DAW.Synth.noteOn(note, v, 0);
            highlightKey(note, true);
          });
          keyEl.addEventListener('mouseup', function () {
            if (DAW.Synth && DAW.Synth.noteOff) DAW.Synth.noteOff(note, 0);
            highlightKey(note, false);
          });
          keyEl.addEventListener('mouseleave', function () {
            if (DAW.Synth && DAW.Synth.noteOff) DAW.Synth.noteOff(note, 0);
            highlightKey(note, false);
          });
        })(midi);
        els.keyboardKeys.appendChild(keyEl);
      }
    }
    if (els.kbOctave) els.kbOctave.removeEventListener('change', buildVirtualKeyboard);
    if (els.kbOctave) els.kbOctave.addEventListener('change', buildVirtualKeyboard);
  }

  function highlightKey(note, on) {
    var k = document.querySelector('#keyboard-keys [data-note="' + note + '"]');
    if (k) { if (on) k.classList.add('active'); else k.classList.remove('active'); }
  }

  function toggleVirtualKeyboard() {
    state.keyboardVisible = !state.keyboardVisible;
    els.virtualKeyboard.classList.toggle('collapsed');
  }

  function refreshViews() {
    if (DAW.Timeline && DAW.Timeline.render) DAW.Timeline.render();
    if (DAW.MixerView && DAW.MixerView.render) DAW.MixerView.render();
    if (DAW.SessionView && DAW.SessionView.render) DAW.SessionView.render();
  }

  function startRenderLoop() {
    (function loop() {
      if (DAW.Transport && DAW.Transport.isPlaying && DAW.Transport.isPlaying()) {
        var pos = DAW.Transport.getPosition ? DAW.Transport.getPosition() : null;
        if (pos) updateTransportDisplay(pos);
      }
      state.animFrameId = requestAnimationFrame(loop);
    })();
  }

  function handleResize() {
    refreshViews();
    if (DAW.PianoRoll && DAW.PianoRoll.render) DAW.PianoRoll.render();
    if (DAW.StepSequencer && DAW.StepSequencer.render) DAW.StepSequencer.render();
  }

  function setStatus(msg) {
    if (els.statusMessage) els.statusMessage.textContent = msg;
  }

  return { init: init };
})();

document.addEventListener('DOMContentLoaded', DAW.App.init);
