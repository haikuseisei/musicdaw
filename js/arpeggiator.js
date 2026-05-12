var DAW = DAW || {};

DAW.Arpeggiator = (function () {
  'use strict';

  // Rate definitions in terms of beats (quarter notes)
  var RATE_VALUES = {
    '1/4':   1.0,
    '1/8':   0.5,
    '1/8T':  1.0 / 3,
    '1/16':  0.25,
    '1/16T': 1.0 / 6,
    '1/32':  0.125
  };

  function create(options) {
    options = options || {};

    var noteCallback = options.noteCallback || null;
    var pattern = 'up';
    var rate = '1/8';
    var octaves = 1;
    var gate = 0.5;       // 0.1 - 1.0
    var swing = 0;        // 0 - 1.0
    var holdMode = false;
    var latchMode = false;

    var heldNotes = [];       // { pitch, velocity } in played order
    var latchedNotes = [];    // latched notes persist after release
    var customSteps = null;   // optional custom step pattern array (pitches/offsets)

    var running = false;
    var schedulerTimer = null;
    var currentStep = 0;
    var nextStepTime = 0;
    var scheduleAhead = 0.1;  // seconds
    var scheduleInterval = 20; // ms

    // ---- Pattern generators ----
    function getSequence() {
      var notes = latchMode ? latchedNotes.slice() : heldNotes.slice();
      if (notes.length === 0) return [];

      // Sort by pitch for directional patterns
      var sorted = notes.slice().sort(function (a, b) { return a.pitch - b.pitch; });

      // Expand across octaves
      var expanded = [];
      for (var oct = 0; oct < octaves; oct++) {
        for (var i = 0; i < sorted.length; i++) {
          expanded.push({
            pitch: sorted[i].pitch + oct * 12,
            velocity: sorted[i].velocity
          });
        }
      }

      var sequence = [];
      var i, j;

      switch (pattern) {
        case 'up':
          sequence = expanded;
          break;

        case 'down':
          sequence = expanded.slice().reverse();
          break;

        case 'upDown':
          sequence = expanded.slice();
          if (expanded.length > 1) {
            for (i = expanded.length - 2; i > 0; i--) {
              sequence.push(expanded[i]);
            }
          }
          break;

        case 'downUp':
          var rev = expanded.slice().reverse();
          sequence = rev.slice();
          if (rev.length > 1) {
            for (i = rev.length - 2; i > 0; i--) {
              sequence.push(rev[i]);
            }
          }
          break;

        case 'random':
          sequence = expanded.slice();
          // Shuffle
          for (i = sequence.length - 1; i > 0; i--) {
            j = Math.floor(Math.random() * (i + 1));
            var tmp = sequence[i];
            sequence[i] = sequence[j];
            sequence[j] = tmp;
          }
          break;

        case 'played':
          // In played order, expanded across octaves
          for (var oct2 = 0; oct2 < octaves; oct2++) {
            for (i = 0; i < notes.length; i++) {
              sequence.push({
                pitch: notes[i].pitch + oct2 * 12,
                velocity: notes[i].velocity
              });
            }
          }
          break;

        default:
          sequence = expanded;
      }

      return sequence;
    }

    function getStepDurationSeconds() {
      var bpm = 120;
      if (typeof DAW !== 'undefined' && DAW.Transport && DAW.Transport.getBPM) {
        bpm = DAW.Transport.getBPM();
      }
      var beatDuration = 60.0 / bpm;
      var rateVal = RATE_VALUES[rate] || 0.5;
      return beatDuration * rateVal;
    }

    function scheduleStep() {
      var ac = null;
      if (typeof DAW !== 'undefined' && DAW.AudioEngine && DAW.AudioEngine.getContext) {
        ac = DAW.AudioEngine.getContext();
      }
      if (!ac) return;

      var currentTime = ac.currentTime;

      while (nextStepTime < currentTime + scheduleAhead) {
        var stepDuration = getStepDurationSeconds();

        // Apply swing: delay even-numbered steps
        var swingOffset = 0;
        if (currentStep % 2 === 1 && swing > 0) {
          swingOffset = stepDuration * swing * 0.5;
        }

        var triggerTime = nextStepTime + swingOffset;

        // Get sequence
        var seq;
        if (customSteps) {
          seq = customSteps;
        } else {
          seq = getSequence();
        }

        if (seq.length > 0) {
          var stepIdx = currentStep % seq.length;
          var note = seq[stepIdx];
          var noteDuration = stepDuration * gate;

          if (note && noteCallback) {
            noteCallback(note.pitch, note.velocity, noteDuration, triggerTime);
          }
        }

        currentStep++;
        nextStepTime += stepDuration;
      }
    }

    function start() {
      if (running) return;
      running = true;
      currentStep = 0;

      var ac = null;
      if (typeof DAW !== 'undefined' && DAW.AudioEngine && DAW.AudioEngine.getContext) {
        ac = DAW.AudioEngine.getContext();
      }
      nextStepTime = ac ? ac.currentTime : 0;

      schedulerTimer = setInterval(scheduleStep, scheduleInterval);
    }

    function stop() {
      running = false;
      if (schedulerTimer !== null) {
        clearInterval(schedulerTimer);
        schedulerTimer = null;
      }
      currentStep = 0;
      if (!holdMode && !latchMode) {
        // Notes remain in heldNotes until explicitly removed
      }
    }

    function addNote(pitch, velocity) {
      velocity = velocity || 100;

      if (latchMode) {
        // Toggle note in latched set
        var found = false;
        for (var i = 0; i < latchedNotes.length; i++) {
          if (latchedNotes[i].pitch === pitch) {
            latchedNotes.splice(i, 1);
            found = true;
            break;
          }
        }
        if (!found) {
          latchedNotes.push({ pitch: pitch, velocity: velocity });
        }
      }

      // Always add to held notes
      for (var j = 0; j < heldNotes.length; j++) {
        if (heldNotes[j].pitch === pitch) {
          heldNotes[j].velocity = velocity;
          return;
        }
      }
      heldNotes.push({ pitch: pitch, velocity: velocity });
    }

    function removeNote(pitch) {
      for (var i = 0; i < heldNotes.length; i++) {
        if (heldNotes[i].pitch === pitch) {
          heldNotes.splice(i, 1);
          break;
        }
      }
      // In hold mode, keep notes even after key release
      // In latch mode, latched notes are toggled via addNote only
    }

    function setPattern(p) {
      var valid = ['up', 'down', 'upDown', 'downUp', 'random', 'played'];
      for (var i = 0; i < valid.length; i++) {
        if (valid[i] === p) {
          pattern = p;
          return;
        }
      }
    }

    function setRate(r) {
      if (RATE_VALUES.hasOwnProperty(r)) {
        rate = r;
      }
    }

    function setOctaves(num) {
      octaves = Math.max(1, Math.min(4, num));
    }

    function setGate(pct) {
      gate = Math.max(0.1, Math.min(1.0, pct));
    }

    function setSwing(pct) {
      swing = Math.max(0, Math.min(1.0, pct));
    }

    function setHold(enabled) {
      holdMode = enabled;
      if (!holdMode) {
        // Clear notes that are no longer held
        // (In a real scenario, you'd track which keys are physically held)
      }
    }

    function setLatch(enabled) {
      latchMode = enabled;
      if (!latchMode) {
        latchedNotes = [];
      }
    }

    function setNoteCallback(fn) {
      noteCallback = fn;
    }

    function setCustomSteps(steps) {
      // steps: array of { pitch, velocity } or null to clear
      customSteps = steps;
    }

    function clearNotes() {
      heldNotes = [];
      latchedNotes = [];
    }

    function isRunning() {
      return running;
    }

    function getPatterns() {
      return ['up', 'down', 'upDown', 'downUp', 'random', 'played'];
    }

    function getRates() {
      return Object.keys(RATE_VALUES);
    }

    return {
      start: start,
      stop: stop,
      addNote: addNote,
      removeNote: removeNote,
      setPattern: setPattern,
      setRate: setRate,
      setOctaves: setOctaves,
      setGate: setGate,
      setSwing: setSwing,
      setHold: setHold,
      setLatch: setLatch,
      setNoteCallback: setNoteCallback,
      setCustomSteps: setCustomSteps,
      clearNotes: clearNotes,
      isRunning: isRunning,
      getPatterns: getPatterns,
      getRates: getRates
    };
  }

  return {
    create: create,
    RATES: RATE_VALUES
  };
})();
