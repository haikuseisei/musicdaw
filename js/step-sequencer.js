var DAW = DAW || {};

DAW.StepSequencer = (function () {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────

  var DRUM_ROWS = [
    { name: 'Kick',    pitch: 36 },
    { name: 'Snare',   pitch: 38 },
    { name: 'Clap',    pitch: 39 },
    { name: 'Hi-Hat C', pitch: 42 },
    { name: 'Hi-Hat O', pitch: 46 },
    { name: 'Tom Lo',  pitch: 41 },
    { name: 'Tom Mid', pitch: 47 },
    { name: 'Tom Hi',  pitch: 50 },
    { name: 'Ride',    pitch: 51 },
    { name: 'Crash',   pitch: 49 }
  ];

  var COLORS = {
    bg:           '#1a1a2e',
    gridLine:     '#2a2a44',
    cellEmpty:    '#222240',
    cellActive:   '#e94560',
    cellAccent:   '#ff6b81',
    labelBg:      '#16162a',
    labelText:    '#aab0c0',
    stepNumber:   '#5a5a7a',
    playhead:     'rgba(255, 255, 255, 0.25)',
    beatLine:     '#3a3a5a'
  };

  var LABEL_WIDTH = 80;
  var HEADER_HEIGHT = 24;
  var CELL_PADDING = 2;

  // ─── State ────────────────────────────────────────────────────────

  var canvas = null;
  var ctx = null;
  var container = null;
  var dpr = 1;

  var mode = 'drum';        // 'drum' | 'melodic'
  var numSteps = 16;        // 4, 8, 16, 32
  var rows = [];            // current row definitions
  var pattern = [];         // 2D: pattern[row][step] = velocity (0-127)
  var currentStep = -1;     // playback position (-1 = not playing)

  var swing = 0;            // 0 to 1
  var direction = 'forward'; // 'forward', 'reverse', 'pingPong', 'random'
  var gateLength = 'medium'; // 'short', 'medium', 'long'
  var speedMultiplier = 1;  // 0.5, 1, 2
  var tieEnabled = false;

  var melodicOctave = 3;    // base octave for melodic mode

  // Interaction state
  var isDragging = false;
  var dragRow = -1;
  var dragStep = -1;
  var dragStartY = 0;
  var dragStartVelocity = 0;

  // Callbacks
  var onStepChanged = null;
  var onPatternChanged = null;

  // ─── Initialization ───────────────────────────────────────────────

  function init(containerEl) {
    container = containerEl;
    canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.cursor = 'pointer';
    container.appendChild(canvas);
    ctx = canvas.getContext('2d');

    dpr = window.devicePixelRatio || 1;

    buildRows();
    initPattern();
    resize();
    bindEvents();
    render();
  }

  function buildRows() {
    rows = [];
    if (mode === 'drum') {
      for (var i = 0; i < DRUM_ROWS.length; i++) {
        rows.push({ name: DRUM_ROWS[i].name, pitch: DRUM_ROWS[i].pitch });
      }
    } else {
      // Melodic: 2 octaves starting from melodicOctave
      var noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      for (var oct = melodicOctave + 1; oct >= melodicOctave; oct--) {
        for (var n = 11; n >= 0; n--) {
          var pitch = (oct + 1) * 12 + n; // MIDI note number
          if (pitch >= 0 && pitch <= 127) {
            rows.push({ name: noteNames[n] + oct, pitch: pitch });
          }
        }
      }
    }
  }

  function initPattern() {
    pattern = [];
    for (var r = 0; r < rows.length; r++) {
      var row = [];
      for (var s = 0; s < numSteps; s++) {
        row.push(0);
      }
      pattern.push(row);
    }
  }

  function resize() {
    var width = container.clientWidth || 600;
    var cellSize = Math.floor((width - LABEL_WIDTH) / numSteps);
    var height = HEADER_HEIGHT + rows.length * cellSize;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ─── Event binding ────────────────────────────────────────────────

  function bindEvents() {
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('resize', function () { resize(); render(); });
  }

  function getCellFromEvent(e) {
    var rect = canvas.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;

    if (x < LABEL_WIDTH || y < HEADER_HEIGHT) return null;

    var cellWidth = (rect.width - LABEL_WIDTH) / numSteps;
    var cellHeight = (rect.height - HEADER_HEIGHT) / rows.length;

    var step = Math.floor((x - LABEL_WIDTH) / cellWidth);
    var row = Math.floor((y - HEADER_HEIGHT) / cellHeight);

    if (step < 0 || step >= numSteps || row < 0 || row >= rows.length) return null;

    return { row: row, step: step, localY: (y - HEADER_HEIGHT) - row * cellHeight, cellHeight: cellHeight };
  }

  function handleMouseDown(e) {
    var cell = getCellFromEvent(e);
    if (!cell) return;

    var isRightClick = e.button === 2;
    var isShiftClick = e.shiftKey;

    if (isRightClick || isShiftClick) {
      // Set accent (velocity 127)
      if (pattern[cell.row][cell.step] > 0) {
        pattern[cell.row][cell.step] = 127;
      } else {
        pattern[cell.row][cell.step] = 127;
      }
      firePatternChanged();
      render();
      return;
    }

    // Toggle on/off
    if (pattern[cell.row][cell.step] > 0) {
      pattern[cell.row][cell.step] = 0;
    } else {
      pattern[cell.row][cell.step] = 100; // default velocity
    }

    // Start drag for velocity adjustment
    isDragging = true;
    dragRow = cell.row;
    dragStep = cell.step;
    dragStartY = e.clientY;
    dragStartVelocity = pattern[cell.row][cell.step];

    firePatternChanged();
    render();
  }

  function handleMouseMove(e) {
    if (!isDragging) return;
    if (dragRow < 0 || dragStep < 0) return;

    // Vertical drag adjusts velocity
    var deltaY = dragStartY - e.clientY;
    var newVelocity = dragStartVelocity + Math.round(deltaY * 1.5);
    newVelocity = Math.max(1, Math.min(127, newVelocity));

    if (pattern[dragRow][dragStep] > 0) {
      pattern[dragRow][dragStep] = newVelocity;
      fireStepChanged(dragRow, dragStep, newVelocity);
      render();
    }
  }

  function handleMouseUp() {
    isDragging = false;
    dragRow = -1;
    dragStep = -1;
  }

  function fireStepChanged(row, step, velocity) {
    if (onStepChanged) {
      onStepChanged({
        row: row,
        step: step,
        velocity: velocity,
        pitch: rows[row] ? rows[row].pitch : 0
      });
    }
  }

  function firePatternChanged() {
    if (onPatternChanged) {
      onPatternChanged(getPattern());
    }
  }

  // ─── Rendering ────────────────────────────────────────────────────

  function render() {
    if (!ctx) return;

    var width = canvas.width / dpr;
    var height = canvas.height / dpr;
    var cellWidth = (width - LABEL_WIDTH) / numSteps;
    var cellHeight = (height - HEADER_HEIGHT) / rows.length;

    // Background
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, width, height);

    // Label background
    ctx.fillStyle = COLORS.labelBg;
    ctx.fillRect(0, 0, LABEL_WIDTH, height);

    // Header background
    ctx.fillStyle = COLORS.labelBg;
    ctx.fillRect(0, 0, width, HEADER_HEIGHT);

    // Step numbers
    ctx.fillStyle = COLORS.stepNumber;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var s = 0; s < numSteps; s++) {
      var sx = LABEL_WIDTH + s * cellWidth + cellWidth / 2;
      ctx.fillText(String(s + 1), sx, HEADER_HEIGHT / 2);
    }

    // Row labels
    ctx.fillStyle = COLORS.labelText;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (var r = 0; r < rows.length; r++) {
      var ry = HEADER_HEIGHT + r * cellHeight + cellHeight / 2;
      ctx.fillText(rows[r].name, LABEL_WIDTH - 8, ry);
    }

    // Grid cells
    for (var row = 0; row < rows.length; row++) {
      for (var step = 0; step < numSteps; step++) {
        var x = LABEL_WIDTH + step * cellWidth;
        var y = HEADER_HEIGHT + row * cellHeight;
        var velocity = pattern[row] ? pattern[row][step] : 0;

        // Cell background
        if (velocity > 0) {
          var brightness = 0.3 + (velocity / 127) * 0.7;
          if (velocity >= 120) {
            ctx.fillStyle = COLORS.cellAccent;
          } else {
            // Interpolate color brightness
            var r1 = parseInt(COLORS.cellActive.slice(1, 3), 16);
            var g1 = parseInt(COLORS.cellActive.slice(3, 5), 16);
            var b1 = parseInt(COLORS.cellActive.slice(5, 7), 16);
            ctx.fillStyle = 'rgba(' + r1 + ',' + g1 + ',' + b1 + ',' + brightness + ')';
          }
        } else {
          ctx.fillStyle = COLORS.cellEmpty;
        }

        ctx.fillRect(
          x + CELL_PADDING,
          y + CELL_PADDING,
          cellWidth - CELL_PADDING * 2,
          cellHeight - CELL_PADDING * 2
        );

        // Velocity bar inside cell
        if (velocity > 0) {
          var barHeight = ((velocity / 127) * (cellHeight - CELL_PADDING * 4));
          var barY = y + cellHeight - CELL_PADDING - barHeight - CELL_PADDING;
          ctx.fillStyle = 'rgba(255,255,255,0.15)';
          ctx.fillRect(
            x + CELL_PADDING + 1,
            barY,
            cellWidth - CELL_PADDING * 2 - 2,
            barHeight
          );
        }
      }
    }

    // Beat lines (every 4 steps)
    ctx.strokeStyle = COLORS.beatLine;
    ctx.lineWidth = 1;
    for (var bl = 4; bl < numSteps; bl += 4) {
      var bx = LABEL_WIDTH + bl * cellWidth;
      ctx.beginPath();
      ctx.moveTo(bx, HEADER_HEIGHT);
      ctx.lineTo(bx, height);
      ctx.stroke();
    }

    // Grid lines (horizontal)
    ctx.strokeStyle = COLORS.gridLine;
    ctx.lineWidth = 0.5;
    for (var gl = 0; gl <= rows.length; gl++) {
      var gy = HEADER_HEIGHT + gl * cellHeight;
      ctx.beginPath();
      ctx.moveTo(LABEL_WIDTH, gy);
      ctx.lineTo(width, gy);
      ctx.stroke();
    }

    // Current step highlight (playhead)
    if (currentStep >= 0 && currentStep < numSteps) {
      var px = LABEL_WIDTH + currentStep * cellWidth;
      ctx.fillStyle = COLORS.playhead;
      ctx.fillRect(px, HEADER_HEIGHT, cellWidth, height - HEADER_HEIGHT);
    }
  }

  // ─── Pattern operations ───────────────────────────────────────────

  function getPattern() {
    var result = [];
    for (var r = 0; r < pattern.length; r++) {
      result.push(pattern[r].slice());
    }
    return result;
  }

  function setPattern(newPattern) {
    pattern = [];
    for (var r = 0; r < newPattern.length; r++) {
      pattern.push(newPattern[r].slice());
    }
    // Ensure row count matches
    while (pattern.length < rows.length) {
      var emptyRow = [];
      for (var s = 0; s < numSteps; s++) emptyRow.push(0);
      pattern.push(emptyRow);
    }
    render();
  }

  function copyPattern() {
    return getPattern();
  }

  function pastePattern(src) {
    if (!src) return;
    setPattern(src);
    firePatternChanged();
  }

  function clearPattern() {
    initPattern();
    firePatternChanged();
    render();
  }

  function randomizePattern(density) {
    density = typeof density === 'number' ? density : 0.3;
    density = Math.max(0, Math.min(1, density));

    for (var r = 0; r < rows.length; r++) {
      for (var s = 0; s < numSteps; s++) {
        if (Math.random() < density) {
          pattern[r][s] = Math.round(60 + Math.random() * 67); // 60-127
        } else {
          pattern[r][s] = 0;
        }
      }
    }
    firePatternChanged();
    render();
  }

  // ─── Configuration ────────────────────────────────────────────────

  function setMode(newMode) {
    if (newMode !== 'drum' && newMode !== 'melodic') return;
    mode = newMode;
    buildRows();
    initPattern();
    resize();
    render();
  }

  function setSteps(count) {
    if ([4, 8, 16, 32].indexOf(count) === -1) return;
    var oldSteps = numSteps;
    numSteps = count;

    // Resize pattern columns
    for (var r = 0; r < pattern.length; r++) {
      if (pattern[r].length < numSteps) {
        while (pattern[r].length < numSteps) {
          pattern[r].push(0);
        }
      } else if (pattern[r].length > numSteps) {
        pattern[r] = pattern[r].slice(0, numSteps);
      }
    }

    resize();
    render();
  }

  function setCurrentStep(step) {
    currentStep = step;
    render();
  }

  function setSwing(value) {
    swing = Math.max(0, Math.min(1, value));
  }

  function getSwing() {
    return swing;
  }

  function setDirection(dir) {
    if (['forward', 'reverse', 'pingPong', 'random'].indexOf(dir) !== -1) {
      direction = dir;
    }
  }

  function getDirection() {
    return direction;
  }

  function setGateLength(len) {
    if (['short', 'medium', 'long'].indexOf(len) !== -1) {
      gateLength = len;
    }
  }

  function getGateLength() {
    return gateLength;
  }

  function setSpeed(mult) {
    if ([0.5, 1, 2].indexOf(mult) !== -1) {
      speedMultiplier = mult;
    }
  }

  function getSpeed() {
    return speedMultiplier;
  }

  function setTie(enabled) {
    tieEnabled = !!enabled;
  }

  function getTie() {
    return tieEnabled;
  }

  // ─── Public API ───────────────────────────────────────────────────

  return {
    init: init,
    render: render,

    // Mode and steps
    setMode: setMode,
    setSteps: setSteps,

    // Pattern access
    getPattern: getPattern,
    setPattern: setPattern,
    copyPattern: copyPattern,
    pastePattern: pastePattern,
    clearPattern: clearPattern,
    randomizePattern: randomizePattern,

    // Playback visualization
    setCurrentStep: setCurrentStep,

    // Parameters
    setSwing: setSwing,
    getSwing: getSwing,
    setDirection: setDirection,
    getDirection: getDirection,
    setGateLength: setGateLength,
    getGateLength: getGateLength,
    setSpeed: setSpeed,
    getSpeed: getSpeed,
    setTie: setTie,
    getTie: getTie,

    // Callbacks
    set onStepChanged(fn) { onStepChanged = fn; },
    set onPatternChanged(fn) { onPatternChanged = fn; }
  };
})();
