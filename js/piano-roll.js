var DAW = DAW || {};

DAW.PianoRoll = (function () {
  // --- Constants ---
  var COLORS = {
    bg: '#1a1a2e',
    surface: '#16213e',
    surface2: '#0f3460',
    accent: '#e94560',
    accent2: '#533483',
    text: '#eee',
    textDim: '#888',
    green: '#4ecca3',
    yellow: '#f0c040',
    noteDefault: '#4A90D9',
    noteSelected: '#e94560',
    notePlaying: '#4ecca3',
    noteGhost: 'rgba(255,255,255,0.12)',
    whiteKey: '#ccc',
    blackKey: '#333',
    grid: 'rgba(255,255,255,0.05)',
    gridBeat: 'rgba(255,255,255,0.12)',
    gridBar: 'rgba(255,255,255,0.2)',
    velocityBar: '#4A90D9',
    velocitySelected: '#e94560',
    selectionFill: 'rgba(233,69,96,0.18)',
    selectionBorder: 'rgba(233,69,96,0.7)',
    scaleHighlight: 'rgba(78,204,163,0.06)'
  };

  var PIANO_WIDTH = 60;
  var VELOCITY_HEIGHT = 60;
  var HEADER_HEIGHT = 20;
  var MIN_NOTE = 24;  // C1
  var MAX_NOTE = 96;  // C7
  var NOTE_RANGE = MAX_NOTE - MIN_NOTE;
  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var BLACK_KEYS = [1, 3, 6, 8, 10];

  // Scale patterns (semitone intervals from root)
  var SCALE_PATTERNS = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    pentatonic: [0, 2, 4, 7, 9],
    blues: [0, 3, 5, 6, 7, 10],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  };

  // --- State ---
  var canvas, ctx, container;
  var dpr = 1;
  var canvasW = 0, canvasH = 0;
  var gridH = 0; // height of note grid area

  var clip = null;
  var ghostClips = [];
  var snapGrid = 0.25; // beats (1/16 = 0.0625, 1/8 = 0.125, 1/4 = 0.25, etc.)
  var tool = 'select'; // 'select', 'draw', 'erase', 'velocity'
  var bpm = 120;
  var timeSignature = { numerator: 4, denominator: 4 };

  var scrollX = 0, scrollY = 0;
  var zoomX = 1.0; // horizontal zoom
  var zoomY = 1.0; // vertical zoom
  var pixelsPerBeat = 60;
  var noteHeight = 12;

  var playheadBeat = 0;
  var selectedNoteIds = {};
  var playingNoteIds = {};
  var selectionRect = null;
  var dragState = null;
  var scaleRoot = null; // 0-11 (null = no scale highlight)
  var scaleType = null;

  // Callbacks
  var callbacks = {
    onNoteAdded: null,
    onNoteRemoved: null,
    onNoteChanged: null,
    onNotesSelected: null
  };

  function fire(name, data) {
    if (callbacks[name]) callbacks[name](data);
  }

  // --- HiDPI ---
  function resizeCanvas() {
    dpr = window.devicePixelRatio || 1;
    var rect = container.getBoundingClientRect();
    canvasW = rect.width;
    canvasH = rect.height;
    canvas.width = canvasW * dpr;
    canvas.height = canvasH * dpr;
    canvas.style.width = canvasW + 'px';
    canvas.style.height = canvasH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gridH = canvasH - HEADER_HEIGHT - VELOCITY_HEIGHT;
  }

  // --- Coordinate helpers ---
  function beatToX(beat) {
    return PIANO_WIDTH + (beat * pixelsPerBeat * zoomX) - scrollX;
  }

  function xToBeat(x) {
    return ((x - PIANO_WIDTH) + scrollX) / (pixelsPerBeat * zoomX);
  }

  function snapBeat(beat) {
    if (snapGrid <= 0) return beat;
    return Math.round(beat / snapGrid) * snapGrid;
  }

  function pitchToY(pitch) {
    var row = MAX_NOTE - pitch;
    return HEADER_HEIGHT + (row * noteHeight * zoomY) - scrollY;
  }

  function yToPitch(y) {
    var row = ((y - HEADER_HEIGHT) + scrollY) / (noteHeight * zoomY);
    return MAX_NOTE - Math.floor(row);
  }

  function isBlackKey(pitch) {
    return BLACK_KEYS.indexOf(pitch % 12) !== -1;
  }

  function noteName(pitch) {
    return NOTE_NAMES[pitch % 12] + Math.floor(pitch / 12 - 1);
  }

  function isInScale(pitch) {
    if (scaleRoot === null || scaleType === null) return true;
    var pattern = SCALE_PATTERNS[scaleType];
    if (!pattern) return true;
    var interval = ((pitch % 12) - scaleRoot + 12) % 12;
    return pattern.indexOf(interval) !== -1;
  }

  // --- Hit testing ---
  function hitNote(mx, my) {
    if (!clip || !clip.notes) return null;
    var notes = clip.notes;
    for (var i = notes.length - 1; i >= 0; i--) {
      var n = notes[i];
      var nx = beatToX(n.start);
      var nw = n.duration * pixelsPerBeat * zoomX;
      var ny = pitchToY(n.pitch);
      var nh = noteHeight * zoomY;
      if (mx >= nx && mx <= nx + nw && my >= ny && my < ny + nh) {
        var edge = (mx > nx + nw - 6) ? 'right' : null;
        return { note: n, x: nx, w: nw, y: ny, h: nh, edge: edge, index: i };
      }
    }
    return null;
  }

  function hitVelocityBar(mx, my) {
    if (!clip || !clip.notes) return null;
    var velY = canvasH - VELOCITY_HEIGHT;
    if (my < velY) return null;
    var notes = clip.notes;
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      var nx = beatToX(n.start);
      var nw = Math.max(n.duration * pixelsPerBeat * zoomX, 4);
      if (mx >= nx && mx <= nx + nw) {
        return { note: n, index: i };
      }
    }
    return null;
  }

  // --- Drawing ---
  function drawHeader() {
    ctx.fillStyle = COLORS.surface;
    ctx.fillRect(0, 0, canvasW, HEADER_HEIGHT);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.moveTo(0, HEADER_HEIGHT - 0.5);
    ctx.lineTo(canvasW, HEADER_HEIGHT - 0.5);
    ctx.stroke();

    // Beat numbers
    var startBeat = xToBeat(PIANO_WIDTH);
    if (startBeat < 0) startBeat = 0;
    var endBeat = xToBeat(canvasW);
    var beatsPerBar = timeSignature.numerator;

    ctx.fillStyle = COLORS.textDim;
    ctx.font = '9px monospace';
    var beat = Math.floor(startBeat);
    while (beat <= endBeat) {
      var x = beatToX(beat);
      if (x >= PIANO_WIDTH) {
        if (beat % beatsPerBar === 0) {
          var barNum = Math.floor(beat / beatsPerBar) + 1;
          ctx.fillStyle = COLORS.text;
          ctx.fillText(barNum + '', x + 3, 13);
        } else {
          ctx.fillStyle = COLORS.textDim;
          ctx.fillText((beat % beatsPerBar + 1) + '', x + 2, 13);
        }
      }
      beat++;
    }

    // Corner
    ctx.fillStyle = COLORS.surface2;
    ctx.fillRect(0, 0, PIANO_WIDTH, HEADER_HEIGHT);
    ctx.fillStyle = COLORS.textDim;
    ctx.font = '9px monospace';
    ctx.fillText(tool.toUpperCase(), 4, 13);
  }

  function drawPianoKeys() {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HEADER_HEIGHT, PIANO_WIDTH, gridH);
    ctx.clip();

    for (var p = MAX_NOTE - 1; p >= MIN_NOTE; p--) {
      var y = pitchToY(p);
      var h = noteHeight * zoomY;
      if (y + h < HEADER_HEIGHT || y > canvasH - VELOCITY_HEIGHT) continue;

      var black = isBlackKey(p);
      ctx.fillStyle = black ? COLORS.blackKey : COLORS.whiteKey;

      if (playingNoteIds[p]) {
        ctx.fillStyle = COLORS.green;
      }

      ctx.fillRect(0, y, PIANO_WIDTH, h);

      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y + h - 0.5);
      ctx.lineTo(PIANO_WIDTH, y + h - 0.5);
      ctx.stroke();

      // Note label on C notes
      if (p % 12 === 0) {
        ctx.fillStyle = '#000';
        ctx.font = '9px monospace';
        ctx.fillText(noteName(p), 4, y + h - 3);
      }
    }
    ctx.restore();

    // Piano border
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PIANO_WIDTH - 0.5, HEADER_HEIGHT);
    ctx.lineTo(PIANO_WIDTH - 0.5, canvasH - VELOCITY_HEIGHT);
    ctx.stroke();
  }

  function drawGrid() {
    ctx.save();
    ctx.beginPath();
    ctx.rect(PIANO_WIDTH, HEADER_HEIGHT, canvasW - PIANO_WIDTH, gridH);
    ctx.clip();

    var beatsPerBar = timeSignature.numerator;

    // Horizontal lines (pitch rows) and scale highlighting
    for (var p = MAX_NOTE - 1; p >= MIN_NOTE; p--) {
      var y = pitchToY(p);
      var h = noteHeight * zoomY;
      if (y + h < HEADER_HEIGHT || y > canvasH - VELOCITY_HEIGHT) continue;

      // Scale row highlight
      if (scaleRoot !== null && isInScale(p)) {
        ctx.fillStyle = COLORS.scaleHighlight;
        ctx.fillRect(PIANO_WIDTH, y, canvasW - PIANO_WIDTH, h);
      }

      // Black key row tint
      if (isBlackKey(p)) {
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(PIANO_WIDTH, y, canvasW - PIANO_WIDTH, h);
      }

      // Row line
      ctx.strokeStyle = (p % 12 === 0) ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.03)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(PIANO_WIDTH, y + h - 0.5);
      ctx.lineTo(canvasW, y + h - 0.5);
      ctx.stroke();
    }

    // Vertical lines (beats/subdivisions)
    var startBeat = xToBeat(PIANO_WIDTH);
    if (startBeat < 0) startBeat = 0;
    var endBeat = xToBeat(canvasW);

    // Draw subdivisions if zoomed in enough
    var subDiv = snapGrid > 0 ? snapGrid : 0.25;
    var subStart = Math.floor(startBeat / subDiv) * subDiv;
    for (var sb = subStart; sb <= endBeat; sb += subDiv) {
      var sx = beatToX(sb);
      if (sx < PIANO_WIDTH) continue;
      var isBar = Math.abs(sb % beatsPerBar) < 0.001;
      var isBeat = Math.abs(sb % 1) < 0.001;
      if (isBar) {
        ctx.strokeStyle = COLORS.gridBar;
        ctx.lineWidth = 1;
      } else if (isBeat) {
        ctx.strokeStyle = COLORS.gridBeat;
        ctx.lineWidth = 0.5;
      } else {
        ctx.strokeStyle = COLORS.grid;
        ctx.lineWidth = 0.5;
      }
      ctx.beginPath();
      ctx.moveTo(Math.floor(sx) + 0.5, HEADER_HEIGHT);
      ctx.lineTo(Math.floor(sx) + 0.5, HEADER_HEIGHT + gridH);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawGhostNotes() {
    if (!ghostClips || ghostClips.length === 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(PIANO_WIDTH, HEADER_HEIGHT, canvasW - PIANO_WIDTH, gridH);
    ctx.clip();

    for (var g = 0; g < ghostClips.length; g++) {
      var gc = ghostClips[g];
      var notes = gc.notes || [];
      var gcOffset = gc.startTime || 0;
      // Convert startTime from seconds to beats
      var offsetBeats = gcOffset * (bpm / 60);
      for (var i = 0; i < notes.length; i++) {
        var n = notes[i];
        var nx = beatToX(n.start + offsetBeats);
        var nw = Math.max(n.duration * pixelsPerBeat * zoomX, 2);
        var ny = pitchToY(n.pitch);
        var nh = noteHeight * zoomY;
        ctx.fillStyle = COLORS.noteGhost;
        ctx.fillRect(nx, ny + 1, nw, nh - 2);
      }
    }
    ctx.restore();
  }

  function drawNotes() {
    if (!clip || !clip.notes) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(PIANO_WIDTH, HEADER_HEIGHT, canvasW - PIANO_WIDTH, gridH);
    ctx.clip();

    var notes = clip.notes;
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      var nx = beatToX(n.start);
      var nw = Math.max(n.duration * pixelsPerBeat * zoomX, 2);
      var ny = pitchToY(n.pitch);
      var nh = noteHeight * zoomY;

      if (nx + nw < PIANO_WIDTH || nx > canvasW || ny + nh < HEADER_HEIGHT || ny > HEADER_HEIGHT + gridH) continue;

      var isSelected = !!selectedNoteIds[n.id];
      var isPlaying = !!playingNoteIds[n.pitch];

      // Note body with velocity-based alpha
      var alpha = 0.4 + (n.velocity / 127) * 0.6;
      ctx.globalAlpha = alpha;
      if (isPlaying) {
        ctx.fillStyle = COLORS.notePlaying;
      } else if (isSelected) {
        ctx.fillStyle = COLORS.noteSelected;
      } else {
        ctx.fillStyle = clip.color || COLORS.noteDefault;
      }
      ctx.fillRect(nx, ny + 1, nw, nh - 2);
      ctx.globalAlpha = 1;

      // Border
      ctx.strokeStyle = isSelected ? COLORS.accent : 'rgba(255,255,255,0.2)';
      ctx.lineWidth = isSelected ? 1.5 : 0.5;
      ctx.strokeRect(nx, ny + 1, nw, nh - 2);

      // Note name if big enough
      if (nw > 20 && nh > 10) {
        ctx.fillStyle = COLORS.text;
        ctx.font = '8px monospace';
        ctx.fillText(noteName(n.pitch), nx + 2, ny + nh - 4);
      }

      // Resize handle
      if (isSelected && nw > 10) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillRect(nx + nw - 4, ny + 1, 4, nh - 2);
      }
    }
    ctx.restore();
  }

  function drawVelocityLane() {
    var velY = canvasH - VELOCITY_HEIGHT;
    ctx.fillStyle = COLORS.surface;
    ctx.fillRect(0, velY, canvasW, VELOCITY_HEIGHT);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.moveTo(0, velY + 0.5);
    ctx.lineTo(canvasW, velY + 0.5);
    ctx.stroke();

    // Label
    ctx.fillStyle = COLORS.textDim;
    ctx.font = '9px monospace';
    ctx.fillText('VEL', 4, velY + 12);

    if (!clip || !clip.notes) return;

    // Velocity bars
    var notes = clip.notes;
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      var nx = beatToX(n.start);
      var nw = Math.max(n.duration * pixelsPerBeat * zoomX, 4);
      if (nx + nw < PIANO_WIDTH || nx > canvasW) continue;

      var velH = (n.velocity / 127) * (VELOCITY_HEIGHT - 8);
      var isSelected = !!selectedNoteIds[n.id];
      ctx.fillStyle = isSelected ? COLORS.velocitySelected : COLORS.velocityBar;
      ctx.fillRect(nx, velY + VELOCITY_HEIGHT - velH - 2, Math.max(nw - 1, 2), velH);
    }
  }

  function drawPlayhead() {
    var x = beatToX(playheadBeat);
    if (x < PIANO_WIDTH || x > canvasW) return;
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvasH);
    ctx.stroke();
  }

  function drawSelectionRect() {
    if (!selectionRect) return;
    var x = Math.min(selectionRect.x0, selectionRect.x1);
    var y = Math.min(selectionRect.y0, selectionRect.y1);
    var w = Math.abs(selectionRect.x1 - selectionRect.x0);
    var h = Math.abs(selectionRect.y1 - selectionRect.y0);
    ctx.fillStyle = COLORS.selectionFill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = COLORS.selectionBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }

  // --- Main render ---
  function render() {
    if (!canvas || !container) return;
    resizeCanvas();
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, canvasW, canvasH);

    drawGrid();
    drawGhostNotes();
    drawNotes();
    drawPianoKeys();
    drawHeader();
    drawVelocityLane();
    drawPlayhead();
    drawSelectionRect();
  }

  // --- Mouse handlers ---
  function getMousePos(e) {
    var rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onMouseDown(e) {
    var m = getMousePos(e);
    if (e.button !== 0) return;

    // Velocity lane
    if (m.y >= canvasH - VELOCITY_HEIGHT) {
      if (tool === 'velocity' || tool === 'select') {
        var vHit = hitVelocityBar(m.x, m.y);
        if (vHit) {
          dragState = { type: 'velocity', note: vHit.note, startY: m.y };
        }
      }
      return;
    }

    // Piano keys area
    if (m.x < PIANO_WIDTH && m.y >= HEADER_HEIGHT) {
      return;
    }

    // Header
    if (m.y < HEADER_HEIGHT) return;

    // Grid area
    var beat = xToBeat(m.x);
    var pitch = yToPitch(m.y);

    if (tool === 'select') {
      var hit = hitNote(m.x, m.y);
      if (hit) {
        if (!e.shiftKey && !selectedNoteIds[hit.note.id]) {
          selectedNoteIds = {};
        }
        selectedNoteIds[hit.note.id] = true;
        fire('onNotesSelected', { noteIds: Object.keys(selectedNoteIds) });

        if (hit.edge === 'right') {
          dragState = {
            type: 'resize', note: hit.note,
            origDuration: hit.note.duration, startX: m.x
          };
        } else {
          dragState = {
            type: 'moveNote', note: hit.note,
            origStart: hit.note.start, origPitch: hit.note.pitch,
            startX: m.x, startY: m.y
          };
        }
        render();
        return;
      }
      // Rubber band
      if (!e.shiftKey) selectedNoteIds = {};
      selectionRect = { x0: m.x, y0: m.y, x1: m.x, y1: m.y };
      render();
      return;
    }

    if (tool === 'draw') {
      if (!clip) return;
      var snappedBeat = snapBeat(beat);
      if (pitch < MIN_NOTE || pitch > MAX_NOTE) return;
      var newNote = {
        id: 'pr_note_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        pitch: pitch,
        start: snappedBeat,
        duration: snapGrid || 0.25,
        velocity: 100,
        channel: 0
      };
      clip.notes.push(newNote);
      dragState = {
        type: 'drawDuration', note: newNote, startX: m.x,
        origBeat: snappedBeat
      };
      fire('onNoteAdded', newNote);
      render();
      return;
    }

    if (tool === 'erase') {
      var eraseHit = hitNote(m.x, m.y);
      if (eraseHit && clip) {
        for (var r = 0; r < clip.notes.length; r++) {
          if (clip.notes[r].id === eraseHit.note.id) {
            var removed = clip.notes.splice(r, 1)[0];
            fire('onNoteRemoved', removed);
            break;
          }
        }
        delete selectedNoteIds[eraseHit.note.id];
        render();
      }
      return;
    }
  }

  function onMouseMove(e) {
    var m = getMousePos(e);

    if (dragState) {
      if (dragState.type === 'moveNote') {
        var dBeat = xToBeat(m.x) - xToBeat(dragState.startX);
        var dPitch = yToPitch(m.y) - yToPitch(dragState.startY);
        var newStart = snapBeat(dragState.origStart + dBeat);
        var newPitch = dragState.origPitch + dPitch;
        newPitch = Math.max(MIN_NOTE, Math.min(MAX_NOTE - 1, newPitch));
        newStart = Math.max(0, newStart);
        dragState.note.start = newStart;
        dragState.note.pitch = newPitch;
        render();
        return;
      }
      if (dragState.type === 'resize') {
        var dBeatR = (m.x - dragState.startX) / (pixelsPerBeat * zoomX);
        var newDur = snapBeat(dragState.origDuration + dBeatR);
        dragState.note.duration = Math.max(snapGrid || 0.0625, newDur);
        render();
        return;
      }
      if (dragState.type === 'drawDuration') {
        var endBeat = snapBeat(xToBeat(m.x));
        var dur = Math.max(snapGrid || 0.0625, endBeat - dragState.origBeat);
        dragState.note.duration = dur;
        render();
        return;
      }
      if (dragState.type === 'velocity') {
        var velY = canvasH - VELOCITY_HEIGHT;
        var relY = canvasH - 2 - m.y;
        var newVel = Math.round((relY / (VELOCITY_HEIGHT - 4)) * 127);
        newVel = Math.max(1, Math.min(127, newVel));
        dragState.note.velocity = newVel;
        render();
        return;
      }
    }

    if (selectionRect) {
      selectionRect.x1 = m.x;
      selectionRect.y1 = m.y;
      updateRubberBand();
      render();
      return;
    }

    // Cursor hint
    if (tool === 'select') {
      var noteHit = hitNote(m.x, m.y);
      if (noteHit && noteHit.edge) {
        canvas.style.cursor = 'ew-resize';
      } else if (noteHit) {
        canvas.style.cursor = 'pointer';
      } else {
        canvas.style.cursor = 'default';
      }
    } else if (tool === 'draw') {
      canvas.style.cursor = 'crosshair';
    } else if (tool === 'erase') {
      canvas.style.cursor = 'pointer';
    } else {
      canvas.style.cursor = 'default';
    }
  }

  function onMouseUp(e) {
    if (dragState) {
      if (dragState.type === 'moveNote' || dragState.type === 'resize') {
        fire('onNoteChanged', dragState.note);
      }
      if (dragState.type === 'drawDuration') {
        fire('onNoteChanged', dragState.note);
      }
      if (dragState.type === 'velocity') {
        fire('onNoteChanged', dragState.note);
      }
      dragState = null;
    }
    if (selectionRect) {
      selectionRect = null;
      fire('onNotesSelected', { noteIds: Object.keys(selectedNoteIds) });
    }
    render();
  }

  function onKeyDown(e) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      deleteSelected();
      e.preventDefault();
    }
    if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      selectAll();
      e.preventDefault();
    }
  }

  function updateRubberBand() {
    if (!selectionRect || !clip) return;
    selectedNoteIds = {};
    var x0 = Math.min(selectionRect.x0, selectionRect.x1);
    var x1 = Math.max(selectionRect.x0, selectionRect.x1);
    var y0 = Math.min(selectionRect.y0, selectionRect.y1);
    var y1 = Math.max(selectionRect.y0, selectionRect.y1);

    var notes = clip.notes || [];
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      var nx = beatToX(n.start);
      var nw = n.duration * pixelsPerBeat * zoomX;
      var ny = pitchToY(n.pitch);
      var nh = noteHeight * zoomY;
      if (nx + nw >= x0 && nx <= x1 && ny + nh >= y0 && ny <= y1) {
        selectedNoteIds[n.id] = true;
      }
    }
  }

  function deleteSelected() {
    if (!clip) return;
    var ids = Object.keys(selectedNoteIds);
    for (var i = clip.notes.length - 1; i >= 0; i--) {
      if (selectedNoteIds[clip.notes[i].id]) {
        var removed = clip.notes.splice(i, 1)[0];
        fire('onNoteRemoved', removed);
      }
    }
    selectedNoteIds = {};
    render();
  }

  function selectAll() {
    if (!clip) return;
    selectedNoteIds = {};
    for (var i = 0; i < clip.notes.length; i++) {
      selectedNoteIds[clip.notes[i].id] = true;
    }
    fire('onNotesSelected', { noteIds: Object.keys(selectedNoteIds) });
    render();
  }

  // --- Public API ---
  function init(containerEl) {
    container = containerEl;
    canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.tabIndex = 1; // Make focusable for keyboard
    container.appendChild(canvas);
    ctx = canvas.getContext('2d');

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('keydown', onKeyDown);

    render();
  }

  function setClip(c) {
    clip = c;
    selectedNoteIds = {};
    scrollX = 0;
    scrollY = 0;
    // Auto-center vertically on note content
    if (clip && clip.notes && clip.notes.length > 0) {
      var minP = 127, maxP = 0;
      for (var i = 0; i < clip.notes.length; i++) {
        if (clip.notes[i].pitch < minP) minP = clip.notes[i].pitch;
        if (clip.notes[i].pitch > maxP) maxP = clip.notes[i].pitch;
      }
      var midP = Math.floor((minP + maxP) / 2);
      var midY = pitchToY(midP);
      scrollY = midY - gridH / 2;
      if (scrollY < 0) scrollY = 0;
    }
    render();
  }

  function setSnap(gridSize) {
    snapGrid = gridSize;
  }

  function setTool(toolName) {
    var validTools = ['select', 'draw', 'erase', 'velocity'];
    if (validTools.indexOf(toolName) !== -1) {
      tool = toolName;
    }
    render();
  }

  function setScale(root, type) {
    scaleRoot = (typeof root === 'number') ? root : null;
    scaleType = type || null;
    render();
  }

  function setGhostClips(clips) {
    ghostClips = clips || [];
    render();
  }

  function setPlayhead(beat) {
    playheadBeat = beat;
  }

  function setPlayingNotes(pitchMap) {
    playingNoteIds = pitchMap || {};
  }

  function setZoom(hZoom, vZoom) {
    if (typeof hZoom === 'number') zoomX = Math.max(0.1, Math.min(hZoom, 20));
    if (typeof vZoom === 'number') zoomY = Math.max(0.5, Math.min(vZoom, 5));
    render();
  }

  function setScrollPos(x, y) {
    scrollX = Math.max(0, x);
    scrollY = Math.max(0, y);
    render();
  }

  function setBPMValue(val) {
    bpm = val;
  }

  return {
    init: init,
    render: render,
    setClip: setClip,
    setSnap: setSnap,
    setTool: setTool,
    setScale: setScale,
    setGhostClips: setGhostClips,
    setPlayhead: setPlayhead,
    setPlayingNotes: setPlayingNotes,
    setZoom: setZoom,
    setScroll: setScrollPos,
    setBPM: setBPMValue,
    deleteSelected: deleteSelected,
    selectAll: selectAll,

    get onNoteAdded() { return callbacks.onNoteAdded; },
    set onNoteAdded(fn) { callbacks.onNoteAdded = fn; },
    get onNoteRemoved() { return callbacks.onNoteRemoved; },
    set onNoteRemoved(fn) { callbacks.onNoteRemoved = fn; },
    get onNoteChanged() { return callbacks.onNoteChanged; },
    set onNoteChanged(fn) { callbacks.onNoteChanged = fn; },
    get onNotesSelected() { return callbacks.onNotesSelected; },
    set onNotesSelected(fn) { callbacks.onNotesSelected = fn; }
  };
})();
