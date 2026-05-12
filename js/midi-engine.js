var DAW = DAW || {};

DAW.MIDIEngine = (function () {
  var midiAccess = null;
  var inputs = [];
  var outputs = [];
  var isRecording = false;
  var recordingClipId = null;
  var recordStartTime = 0;
  var activeNotes = {};
  var recordedNotes = [];
  var recordedCCs = [];
  var channelFilter = null; // null = all channels

  var onMIDIMessage = null;
  var onNoteOn = null;
  var onNoteOff = null;
  var onCC = null;

  // Scale definitions (semitone intervals from root)
  var scales = {
    major:       [0, 2, 4, 5, 7, 9, 11],
    minor:       [0, 2, 3, 5, 7, 8, 10],
    dorian:      [0, 2, 3, 5, 7, 9, 10],
    mixolydian:  [0, 2, 4, 5, 7, 9, 10],
    pentatonic:  [0, 2, 4, 7, 9],
    blues:       [0, 3, 5, 6, 7, 10],
    chromatic:   [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  };

  var noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function init() {
    if (!navigator.requestMIDIAccess) {
      console.warn('Web MIDI API not supported in this browser');
      return Promise.reject(new Error('Web MIDI not supported'));
    }

    return navigator.requestMIDIAccess({ sysex: false }).then(function (access) {
      midiAccess = access;
      refreshDevices();

      midiAccess.onstatechange = function () {
        refreshDevices();
      };

      return access;
    });
  }

  function refreshDevices() {
    inputs = [];
    outputs = [];

    if (!midiAccess) return;

    midiAccess.inputs.forEach(function (input) {
      inputs.push({
        id: input.id,
        name: input.name,
        manufacturer: input.manufacturer,
        port: input
      });
      input.onmidimessage = handleMIDIMessage;
    });

    midiAccess.outputs.forEach(function (output) {
      outputs.push({
        id: output.id,
        name: output.name,
        manufacturer: output.manufacturer,
        port: output
      });
    });
  }

  function listInputs() {
    return inputs.map(function (inp) {
      return { id: inp.id, name: inp.name, manufacturer: inp.manufacturer };
    });
  }

  function listOutputs() {
    return outputs.map(function (out) {
      return { id: out.id, name: out.name, manufacturer: out.manufacturer };
    });
  }

  function handleMIDIMessage(event) {
    var data = event.data;
    var status = data[0] & 0xF0;
    var channel = data[0] & 0x0F;

    // Channel filtering
    if (channelFilter !== null && channel !== channelFilter) return;

    if (onMIDIMessage) {
      onMIDIMessage({
        status: status,
        channel: channel,
        data1: data[1],
        data2: data.length > 2 ? data[2] : 0,
        timestamp: event.timeStamp
      });
    }

    switch (status) {
      case 0x90: // Note On
        if (data[2] > 0) {
          if (onNoteOn) onNoteOn(data[1], data[2], channel);
          if (isRecording) {
            recordNoteOn(data[1], data[2], channel);
          }
        } else {
          // Note On with velocity 0 = Note Off
          if (onNoteOff) onNoteOff(data[1], channel);
          if (isRecording) {
            recordNoteOff(data[1], channel);
          }
        }
        break;
      case 0x80: // Note Off
        if (onNoteOff) onNoteOff(data[1], channel);
        if (isRecording) {
          recordNoteOff(data[1], channel);
        }
        break;
      case 0xB0: // CC
        if (onCC) onCC(data[1], data[2], channel);
        if (isRecording) {
          recordCC(data[1], data[2], channel);
        }
        break;
    }
  }

  function getTransportTime() {
    if (typeof DAW.Transport !== 'undefined') {
      return DAW.Transport.getPositionInSeconds();
    }
    return (Date.now() - recordStartTime) / 1000;
  }

  function recordNoteOn(pitch, velocity, channel) {
    var time = getTransportTime();
    var key = pitch + '_' + channel;
    activeNotes[key] = {
      pitch: pitch,
      velocity: velocity,
      start: time,
      channel: channel
    };
  }

  function recordNoteOff(pitch, channel) {
    var time = getTransportTime();
    var key = pitch + '_' + channel;
    if (activeNotes[key]) {
      var note = activeNotes[key];
      recordedNotes.push({
        pitch: note.pitch,
        velocity: note.velocity,
        start: note.start,
        duration: Math.max(0.01, time - note.start),
        channel: note.channel
      });
      delete activeNotes[key];
    }
  }

  function recordCC(cc, value, channel) {
    var time = getTransportTime();
    recordedCCs.push({
      cc: cc,
      value: value,
      channel: channel,
      time: time
    });
  }

  function startRecording(clipId) {
    isRecording = true;
    recordingClipId = clipId;
    recordStartTime = Date.now();
    activeNotes = {};
    recordedNotes = [];
    recordedCCs = [];
  }

  function stopRecording() {
    isRecording = false;

    // Close any lingering active notes
    var time = getTransportTime();
    var keys = Object.keys(activeNotes);
    for (var i = 0; i < keys.length; i++) {
      var note = activeNotes[keys[i]];
      recordedNotes.push({
        pitch: note.pitch,
        velocity: note.velocity,
        start: note.start,
        duration: Math.max(0.01, time - note.start),
        channel: note.channel
      });
    }
    activeNotes = {};

    var result = {
      clipId: recordingClipId,
      notes: recordedNotes.slice(),
      ccs: recordedCCs.slice()
    };

    recordingClipId = null;
    recordedNotes = [];
    recordedCCs = [];
    return result;
  }

  // --- MIDI Utilities ---

  function quantize(notes, gridSize, strength) {
    if (typeof strength !== 'number') strength = 1.0;
    strength = Math.max(0, Math.min(1, strength));

    var gridSeconds = gridSize * (60.0 / (DAW.Transport ? DAW.Transport.getBPM() : 120)) * 4;

    var result = [];
    for (var i = 0; i < notes.length; i++) {
      var note = {};
      var keys = Object.keys(notes[i]);
      for (var k = 0; k < keys.length; k++) {
        note[keys[k]] = notes[i][keys[k]];
      }

      var nearest = Math.round(note.start / gridSeconds) * gridSeconds;
      note.start = note.start + (nearest - note.start) * strength;
      result.push(note);
    }
    return result;
  }

  function humanize(notes, timingAmount, velocityAmount) {
    timingAmount = timingAmount || 0.01;
    velocityAmount = velocityAmount || 5;

    var result = [];
    for (var i = 0; i < notes.length; i++) {
      var note = {};
      var keys = Object.keys(notes[i]);
      for (var k = 0; k < keys.length; k++) {
        note[keys[k]] = notes[i][keys[k]];
      }

      var timeOffset = (Math.random() - 0.5) * 2 * timingAmount;
      note.start = Math.max(0, note.start + timeOffset);

      var velOffset = Math.round((Math.random() - 0.5) * 2 * velocityAmount);
      note.velocity = Math.max(1, Math.min(127, note.velocity + velOffset));

      result.push(note);
    }
    return result;
  }

  function correctToScale(notes, root, scaleName) {
    var scaleIntervals = scales[scaleName];
    if (!scaleIntervals) {
      console.warn('Unknown scale: ' + scaleName);
      return notes;
    }

    // Build full set of valid MIDI pitches for this scale
    var validPitches = {};
    for (var octave = 0; octave < 11; octave++) {
      for (var s = 0; s < scaleIntervals.length; s++) {
        var pitch = (root % 12) + (octave * 12) + scaleIntervals[s];
        if (pitch >= 0 && pitch <= 127) {
          validPitches[pitch] = true;
        }
      }
    }

    var result = [];
    for (var i = 0; i < notes.length; i++) {
      var note = {};
      var keys = Object.keys(notes[i]);
      for (var k = 0; k < keys.length; k++) {
        note[keys[k]] = notes[i][keys[k]];
      }

      if (!validPitches[note.pitch]) {
        // Find nearest valid pitch
        var best = note.pitch;
        var bestDist = 128;
        for (var p = 0; p <= 127; p++) {
          if (validPitches[p]) {
            var dist = Math.abs(p - note.pitch);
            if (dist < bestDist) {
              bestDist = dist;
              best = p;
            }
          }
        }
        note.pitch = best;
      }

      result.push(note);
    }
    return result;
  }

  function transpose(notes, semitones) {
    var result = [];
    for (var i = 0; i < notes.length; i++) {
      var note = {};
      var keys = Object.keys(notes[i]);
      for (var k = 0; k < keys.length; k++) {
        note[keys[k]] = notes[i][keys[k]];
      }
      note.pitch = Math.max(0, Math.min(127, note.pitch + semitones));
      result.push(note);
    }
    return result;
  }

  function noteNameToMIDI(name) {
    var match = name.match(/^([A-Ga-g])(#|b)?(-?\d+)$/);
    if (!match) return -1;

    var letter = match[1].toUpperCase();
    var accidental = match[2] || '';
    var octave = parseInt(match[3], 10);

    var noteIndex = noteNames.indexOf(letter);
    if (noteIndex === -1) return -1;

    if (accidental === '#') noteIndex++;
    else if (accidental === 'b') noteIndex--;

    var midi = (octave + 1) * 12 + noteIndex;
    if (midi < 0 || midi > 127) return -1;
    return midi;
  }

  function midiToNoteName(midi) {
    if (midi < 0 || midi > 127) return '';
    var octave = Math.floor(midi / 12) - 1;
    var noteIndex = midi % 12;
    return noteNames[noteIndex] + octave;
  }

  function applyVelocityCurve(velocity, curveType) {
    var v = velocity / 127;

    switch (curveType) {
      case 'linear':
        break;
      case 'soft':
        v = Math.sqrt(v);
        break;
      case 'hard':
        v = v * v;
        break;
      case 'fixed':
        v = 1.0;
        break;
      case 's-curve':
        v = v * v * (3 - 2 * v);
        break;
      default:
        break;
    }

    return Math.max(1, Math.min(127, Math.round(v * 127)));
  }

  function sendNoteOn(outputId, pitch, velocity, channel) {
    var port = getOutputPort(outputId);
    if (!port) return;
    var ch = channel || 0;
    port.send([0x90 | ch, pitch, velocity]);
  }

  function sendNoteOff(outputId, pitch, channel) {
    var port = getOutputPort(outputId);
    if (!port) return;
    var ch = channel || 0;
    port.send([0x80 | ch, pitch, 0]);
  }

  function sendCC(outputId, cc, value, channel) {
    var port = getOutputPort(outputId);
    if (!port) return;
    var ch = channel || 0;
    port.send([0xB0 | ch, cc, value]);
  }

  function getOutputPort(outputId) {
    for (var i = 0; i < outputs.length; i++) {
      if (outputs[i].id === outputId) return outputs[i].port;
    }
    return null;
  }

  function setChannelFilter(ch) {
    channelFilter = (ch !== null && ch >= 0 && ch <= 15) ? ch : null;
  }

  function getScaleNames() {
    return Object.keys(scales);
  }

  return {
    init: init,
    listInputs: listInputs,
    listOutputs: listOutputs,

    startRecording: startRecording,
    stopRecording: stopRecording,
    get isRecording() { return isRecording; },

    quantize: quantize,
    humanize: humanize,
    correctToScale: correctToScale,
    transpose: transpose,

    noteNameToMIDI: noteNameToMIDI,
    midiToNoteName: midiToNoteName,
    applyVelocityCurve: applyVelocityCurve,

    sendNoteOn: sendNoteOn,
    sendNoteOff: sendNoteOff,
    sendCC: sendCC,

    setChannelFilter: setChannelFilter,
    getScaleNames: getScaleNames,

    set onMIDIMessage(fn) { onMIDIMessage = fn; },
    set onNoteOn(fn) { onNoteOn = fn; },
    set onNoteOff(fn) { onNoteOff = fn; },
    set onCC(fn) { onCC = fn; }
  };
})();
