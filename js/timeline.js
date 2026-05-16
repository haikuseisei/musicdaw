var DAW = DAW || {};

DAW.Timeline = (function () {
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
    grid: 'rgba(255,255,255,0.06)',
    gridBar: 'rgba(255,255,255,0.14)',
    loopFill: 'rgba(78,204,163,0.10)',
    selectionFill: 'rgba(233,69,96,0.18)',
    selectionBorder: 'rgba(233,69,96,0.7)'
  };
  var RULER_HEIGHT = 28;
  var HEADER_WIDTH = 180;
  var MIN_TRACK_HEIGHT = 28;
  var DEFAULT_TRACK_HEIGHT = 80;
  var AUTOMATION_LANE_HEIGHT = 50;
  var BUTTON_SIZE = 18;
  var BUTTON_GAP = 3;

  // --- State ---
  var canvas, ctx, container;
  var dpr = 1;
  var canvasW = 0, canvasH = 0;

  var tracks = [];
  var scrollX = 0, scrollY = 0;
  var zoom = 1.0; // pixels per second at zoom=1 is 100
  var pixelsPerSecond = 100;
  var bpm = 120;
  var timeSignature = { numerator: 4, denominator: 4 };
  var playheadSec = 0;
  var loopRegion = { start: 0, end: 0, enabled: false };
  var markers = []; // {time, label, color}
  var sectionMarkers = []; // {start, end, label, color}

  var selectedClipIds = {};
  var selectedTrackId = null;
  var selectionRect = null; // rubber band {x0,y0,x1,y1} in canvas coords
  var dragState = null; // {type, clipId, trackId, startX, startY, offsetX, offsetY, edge}

  // Callbacks
  var callbacks = {
    onClipSelected: null,
    onClipMoved: null,
    onPlayheadSet: null,
    onTrackAction: null,
    onClipDoubleClick: null,
    onContextMenu: null
  };

  function fire(name, data) {
    if (callbacks[name]) callbacks[name](data);
  }

  // --- HiDPI helpers ---
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
  }

  // --- Coordinate helpers ---
  function secToX(sec) {
    return HEADER_WIDTH + (sec * pixelsPerSecond * zoom) - scrollX;
  }

  function xToSec(x) {
    return ((x - HEADER_WIDTH) + scrollX) / (pixelsPerSecond * zoom);
  }

  function trackYPositions() {
    var positions = [];
    var y = RULER_HEIGHT - scrollY;
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      var h = t.collapsed ? MIN_TRACK_HEIGHT : (t.height || DEFAULT_TRACK_HEIGHT);
      var autoH = 0;
      if (!t.collapsed && t.automationLanes && t.automationLanes.length > 0) {
        for (var a = 0; a < t.automationLanes.length; a++) {
          if (t.automationLanes[a].visible) autoH += AUTOMATION_LANE_HEIGHT;
        }
      }
      positions.push({ y: y, h: h, autoH: autoH, totalH: h + autoH, track: t });
      y += h + autoH;
    }
    return positions;
  }

  function hitTrack(my) {
    var pos = trackYPositions();
    for (var i = 0; i < pos.length; i++) {
      if (my >= pos[i].y && my < pos[i].y + pos[i].totalH) return pos[i];
    }
    return null;
  }

  function hitClip(mx, my) {
    var pos = trackYPositions();
    for (var i = 0; i < pos.length; i++) {
      var p = pos[i];
      if (my < p.y || my > p.y + p.h) continue;
      var clips = p.track.clips || [];
      for (var c = 0; c < clips.length; c++) {
        var clip = clips[c];
        var cx = secToX(clip.startTime);
        var cw = clip.duration * pixelsPerSecond * zoom;
        if (mx >= cx && mx <= cx + cw) {
          var edge = null;
          if (mx - cx < 5) edge = 'left';
          else if (cx + cw - mx < 5) edge = 'right';
          return { clip: clip, track: p.track, x: cx, w: cw, y: p.y, h: p.h, edge: edge };
        }
      }
    }
    return null;
  }

  function hitHeaderButton(mx, my, tp) {
    // Returns button id or null
    if (mx >= HEADER_WIDTH) return null;
    var btnY = tp.y + 22;
    var bx = 36;
    var buttons = ['mute', 'solo', 'arm'];
    for (var b = 0; b < buttons.length; b++) {
      if (mx >= bx && mx < bx + BUTTON_SIZE && my >= btnY && my < btnY + BUTTON_SIZE) {
        return buttons[b];
      }
      bx += BUTTON_SIZE + BUTTON_GAP;
    }
    // Collapse button
    if (mx >= 4 && mx < 20 && my >= tp.y + 4 && my < tp.y + 20) return 'collapse';
    return null;
  }

  // --- Beat/bar helpers ---
  function beatInterval() {
    return 60.0 / bpm;
  }

  function barInterval() {
    return beatInterval() * timeSignature.numerator;
  }

  // --- Drawing ---
  function drawRuler() {
    ctx.fillStyle = COLORS.surface;
    ctx.fillRect(0, 0, canvasW, RULER_HEIGHT);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, RULER_HEIGHT - 0.5);
    ctx.lineTo(canvasW, RULER_HEIGHT - 0.5);
    ctx.stroke();

    // Section markers
    for (var s = 0; s < sectionMarkers.length; s++) {
      var sm = sectionMarkers[s];
      var sx = secToX(sm.start);
      var sw = (sm.end - sm.start) * pixelsPerSecond * zoom;
      if (sx + sw < HEADER_WIDTH || sx > canvasW) continue;
      ctx.fillStyle = sm.color || COLORS.accent2;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(Math.max(sx, HEADER_WIDTH), 0, sw - Math.max(0, HEADER_WIDTH - sx), RULER_HEIGHT - 10);
      ctx.globalAlpha = 1;
      ctx.fillStyle = COLORS.text;
      ctx.font = '9px monospace';
      ctx.fillText(sm.label || '', Math.max(sx + 3, HEADER_WIDTH + 3), 9);
    }

    // Time markings
    var bi = beatInterval();
    var bari = barInterval();
    var startSec = xToSec(HEADER_WIDTH);
    if (startSec < 0) startSec = 0;
    var endSec = xToSec(canvasW);

    var barNum = Math.floor(startSec / bari);
    var sec = barNum * bari;
    ctx.font = '10px monospace';
    while (sec <= endSec) {
      var x = secToX(sec);
      if (x >= HEADER_WIDTH) {
        var isBar = Math.abs(sec - barNum * bari) < 0.001;
        ctx.strokeStyle = isBar ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.moveTo(Math.floor(x) + 0.5, RULER_HEIGHT - (isBar ? 14 : 6));
        ctx.lineTo(Math.floor(x) + 0.5, RULER_HEIGHT);
        ctx.stroke();
        if (isBar) {
          ctx.fillStyle = COLORS.text;
          ctx.fillText((barNum + 1) + '', x + 3, RULER_HEIGHT - 16);
        }
      }
      sec += bi;
      if (Math.abs(sec - (barNum + 1) * bari) < 0.0001) barNum++;
    }

    // Markers (triangles)
    for (var m = 0; m < markers.length; m++) {
      var mk = markers[m];
      var mx = secToX(mk.time);
      if (mx < HEADER_WIDTH || mx > canvasW) continue;
      ctx.fillStyle = mk.color || COLORS.yellow;
      ctx.beginPath();
      ctx.moveTo(mx, 2);
      ctx.lineTo(mx - 6, 12);
      ctx.lineTo(mx + 6, 12);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = COLORS.text;
      ctx.font = '9px monospace';
      ctx.fillText(mk.label || '', mx + 8, 11);
    }

    // Header corner
    ctx.fillStyle = COLORS.surface2;
    ctx.fillRect(0, 0, HEADER_WIDTH, RULER_HEIGHT);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.strokeRect(0, 0, HEADER_WIDTH, RULER_HEIGHT);
  }

  function drawGrid() {
    ctx.save();
    ctx.beginPath();
    ctx.rect(HEADER_WIDTH, RULER_HEIGHT, canvasW - HEADER_WIDTH, canvasH - RULER_HEIGHT);
    ctx.clip();

    var bi = beatInterval();
    var bari = barInterval();
    var startSec = xToSec(HEADER_WIDTH);
    if (startSec < 0) startSec = 0;
    var endSec = xToSec(canvasW);

    var barNum = Math.floor(startSec / bari);
    var sec = barNum * bari;
    while (sec <= endSec) {
      var x = secToX(sec);
      var isBar = Math.abs(sec / bari - Math.round(sec / bari)) < 0.001;
      ctx.strokeStyle = isBar ? COLORS.gridBar : COLORS.grid;
      ctx.lineWidth = isBar ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(Math.floor(x) + 0.5, RULER_HEIGHT);
      ctx.lineTo(Math.floor(x) + 0.5, canvasH);
      ctx.stroke();
      sec += bi;
    }
    ctx.restore();
  }

  function drawLoopRegion() {
    if (!loopRegion.enabled) return;
    var x0 = secToX(loopRegion.start);
    var x1 = secToX(loopRegion.end);
    if (x1 < HEADER_WIDTH || x0 > canvasW) return;
    x0 = Math.max(x0, HEADER_WIDTH);
    x1 = Math.min(x1, canvasW);

    // Ruler highlight
    ctx.fillStyle = 'rgba(78,204,163,0.25)';
    ctx.fillRect(x0, 0, x1 - x0, RULER_HEIGHT);

    // Track area highlight
    ctx.fillStyle = COLORS.loopFill;
    ctx.fillRect(x0, RULER_HEIGHT, x1 - x0, canvasH - RULER_HEIGHT);
  }

  function drawTrackHeader(tp, index) {
    var t = tp.track;
    var y = tp.y;
    var h = tp.h;

    // Background
    ctx.fillStyle = (selectedTrackId === t.id) ? COLORS.surface2 : COLORS.surface;
    ctx.fillRect(0, y, HEADER_WIDTH, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.strokeRect(0, y, HEADER_WIDTH, h);

    // Color indicator
    ctx.fillStyle = t.color || COLORS.accent;
    ctx.fillRect(0, y, 4, h);

    // Collapse toggle
    ctx.fillStyle = COLORS.textDim;
    ctx.font = '10px monospace';
    ctx.fillText(t.collapsed ? '▶' : '▼', 7, y + 14);

    // Track type icon
    var icon = t.type === 'audio' ? '♫' : (t.type === 'midi' ? '♩' : (t.type === 'bus' ? 'B' : 'M'));
    ctx.fillStyle = COLORS.textDim;
    ctx.font = '11px monospace';
    ctx.fillText(icon, 20, y + 14);

    // Track name
    ctx.fillStyle = COLORS.text;
    ctx.font = '11px sans-serif';
    ctx.fillText(truncate(t.name, 14), 36, y + 14);

    // Buttons: M S R
    if (!t.collapsed) {
      var btnY = y + 22;
      var bx = 36;
      drawButton(bx, btnY, 'M', t.mute, COLORS.yellow);
      bx += BUTTON_SIZE + BUTTON_GAP;
      drawButton(bx, btnY, 'S', t.solo, COLORS.green);
      bx += BUTTON_SIZE + BUTTON_GAP;
      drawButton(bx, btnY, 'R', t.armed, COLORS.accent);

      // Volume mini-slider
      var sliderX = 36;
      var sliderY = y + 46;
      var sliderW = HEADER_WIDTH - 46;
      var sliderH = 6;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(sliderX, sliderY, sliderW, sliderH);
      var vol = typeof t.volume === 'number' ? t.volume : 1.0;
      ctx.fillStyle = t.color || COLORS.accent;
      ctx.fillRect(sliderX, sliderY, sliderW * Math.min(vol, 1.5) / 1.5, sliderH);
      ctx.fillStyle = COLORS.textDim;
      ctx.font = '9px monospace';
      var db = vol > 0 ? (20 * Math.log10(vol)).toFixed(1) : '-inf';
      ctx.fillText(db + ' dB', sliderX, sliderY + 16);

      // Pan
      ctx.fillText('P:' + ((t.pan || 0) > 0 ? '+' : '') + ((t.pan || 0) * 100).toFixed(0) + '%', sliderX + 70, sliderY + 16);
    }
  }

  function drawButton(x, y, label, active, activeColor) {
    ctx.fillStyle = active ? activeColor : 'rgba(255,255,255,0.08)';
    ctx.fillRect(x, y, BUTTON_SIZE, BUTTON_SIZE);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.strokeRect(x, y, BUTTON_SIZE, BUTTON_SIZE);
    ctx.fillStyle = active ? '#000' : COLORS.textDim;
    ctx.font = 'bold 10px monospace';
    ctx.fillText(label, x + 4, y + 13);
  }

  function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.substring(0, max - 1) + '…' : str;
  }

  function drawClip(clip, tp) {
    var cx = secToX(clip.startTime);
    var cw = clip.duration * pixelsPerSecond * zoom;
    var cy = tp.y + 2;
    var ch = tp.h - 4;

    if (cx + cw < HEADER_WIDTH || cx > canvasW) return;

    // Clip body
    var clipColor = clip.color || tp.track.color || COLORS.accent;
    ctx.fillStyle = clipColor;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(cx, cy, cw, ch);
    ctx.globalAlpha = 1;

    // Border
    var isSelected = !!selectedClipIds[clip.id];
    ctx.strokeStyle = isSelected ? COLORS.accent : 'rgba(255,255,255,0.15)';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.strokeRect(cx, cy, cw, ch);

    // Clip content preview
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx, cy, cw, ch);
    ctx.clip();

    if (clip.type === 'audio') {
      drawAudioClipPreview(clip, cx, cy, cw, ch, clipColor);
    } else if (clip.type === 'midi') {
      drawMidiClipPreview(clip, cx, cy, cw, ch, clipColor);
    }

    // Clip name
    ctx.fillStyle = COLORS.text;
    ctx.font = '10px sans-serif';
    ctx.fillText(truncate(clip.name, Math.floor(cw / 7)), cx + 4, cy + 12);
    ctx.restore();

    // Resize handles
    if (isSelected) {
      ctx.fillStyle = COLORS.text;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(cx, cy, 3, ch);
      ctx.fillRect(cx + cw - 3, cy, 3, ch);
      ctx.globalAlpha = 1;
    }
  }

  function drawAudioClipPreview(clip, cx, cy, cw, ch, color) {
    // Simplified waveform preview - draw random-ish blocks for visual
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.4;
    var midY = cy + ch / 2;
    var steps = Math.min(Math.floor(cw / 2), 80);
    for (var i = 0; i < steps; i++) {
      var x = cx + (i / steps) * cw;
      var amp = 0.3 + 0.5 * Math.abs(Math.sin(i * 0.7 + (clip.startTime || 0) * 3));
      var barH = amp * (ch * 0.4);
      ctx.fillRect(x, midY - barH, Math.max(cw / steps - 1, 1), barH * 2);
    }
    ctx.globalAlpha = 1;
  }

  function drawMidiClipPreview(clip, cx, cy, cw, ch, color) {
    var notes = clip.notes || [];
    if (notes.length === 0) return;

    var minPitch = 127, maxPitch = 0;
    for (var i = 0; i < notes.length; i++) {
      if (notes[i].pitch < minPitch) minPitch = notes[i].pitch;
      if (notes[i].pitch > maxPitch) maxPitch = notes[i].pitch;
    }
    var pitchRange = Math.max(maxPitch - minPitch, 1);

    ctx.fillStyle = color;
    ctx.globalAlpha = 0.7;
    var clipDur = clip.duration || 1;
    for (var j = 0; j < notes.length; j++) {
      var n = notes[j];
      var nx = cx + (n.start / clipDur) * cw;
      var nw = Math.max((n.duration / clipDur) * cw, 2);
      var ny = cy + ch - 16 - ((n.pitch - minPitch) / pitchRange) * (ch - 20);
      ctx.fillRect(nx, ny, nw, 3);
    }
    ctx.globalAlpha = 1;
  }

  function drawAutomationLane(tp, lane, laneY) {
    var laneH = AUTOMATION_LANE_HEIGHT;
    // Background
    ctx.fillStyle = 'rgba(15,52,96,0.3)';
    ctx.fillRect(HEADER_WIDTH, laneY, canvasW - HEADER_WIDTH, laneH);

    // Label
    ctx.fillStyle = COLORS.textDim;
    ctx.font = '9px monospace';
    ctx.fillText(lane.parameter || 'Automation', HEADER_WIDTH + 6, laneY + 12);

    // Draw curve
    var points = lane.points || [];
    if (points.length === 0) return;

    ctx.strokeStyle = COLORS.green;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (var p = 0; p < points.length; p++) {
      var px = secToX(points[p].time);
      var py = laneY + laneH - (points[p].value * laneH);
      if (p === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Draw points
    ctx.fillStyle = COLORS.green;
    for (var q = 0; q < points.length; q++) {
      var qx = secToX(points[q].time);
      var qy = laneY + laneH - (points[q].value * laneH);
      ctx.beginPath();
      ctx.arc(qx, qy, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Separator line
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(HEADER_WIDTH, laneY + laneH - 0.5);
    ctx.lineTo(canvasW, laneY + laneH - 0.5);
    ctx.stroke();
  }

  function drawPlayhead() {
    var x = secToX(playheadSec);
    if (x < HEADER_WIDTH || x > canvasW) return;
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvasH);
    ctx.stroke();

    // Playhead triangle at ruler
    ctx.fillStyle = COLORS.accent;
    ctx.beginPath();
    ctx.moveTo(x, RULER_HEIGHT);
    ctx.lineTo(x - 6, RULER_HEIGHT - 10);
    ctx.lineTo(x + 6, RULER_HEIGHT - 10);
    ctx.closePath();
    ctx.fill();
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
    resizeCanvas();
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, canvasW, canvasH);

    drawGrid();
    drawLoopRegion();

    // Draw tracks
    var pos = trackYPositions();
    for (var i = 0; i < pos.length; i++) {
      var tp = pos[i];
      // Track lane background
      ctx.fillStyle = (i % 2 === 0) ? 'rgba(22,33,62,0.3)' : 'rgba(26,26,46,0.3)';
      ctx.fillRect(HEADER_WIDTH, tp.y, canvasW - HEADER_WIDTH, tp.h);

      // Track separator
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(HEADER_WIDTH, tp.y + tp.h - 0.5);
      ctx.lineTo(canvasW, tp.y + tp.h - 0.5);
      ctx.stroke();

      // Clips
      var clips = tp.track.clips || [];
      for (var c = 0; c < clips.length; c++) {
        drawClip(clips[c], tp);
      }

      // Automation lanes
      if (!tp.track.collapsed && tp.track.automationLanes) {
        var autoY = tp.y + tp.h;
        for (var a = 0; a < tp.track.automationLanes.length; a++) {
          var lane = tp.track.automationLanes[a];
          if (lane.visible) {
            drawAutomationLane(tp, lane, autoY);
            autoY += AUTOMATION_LANE_HEIGHT;
          }
        }
      }

      // Track header
      drawTrackHeader(tp, i);
    }

    drawRuler();
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

    // Right click
    if (e.button === 2) {
      e.preventDefault();
      var hitC = hitClip(m.x, m.y);
      var hitT = hitTrack(m.y);
      fire('onContextMenu', {
        x: m.x, y: m.y, clientX: e.clientX, clientY: e.clientY,
        clip: hitC ? hitC.clip : null,
        track: hitT ? hitT.track : null
      });
      return;
    }

    // Ruler click - set playhead
    if (m.y < RULER_HEIGHT && m.x > HEADER_WIDTH) {
      var sec = xToSec(m.x);
      if (sec >= 0) {
        playheadSec = sec;
        fire('onPlayheadSet', playheadSec);
        render();
      }
      return;
    }

    // Header click
    if (m.x < HEADER_WIDTH) {
      var tp = hitTrack(m.y);
      if (tp) {
        var btn = hitHeaderButton(m.x, m.y, tp);
        if (btn === 'mute') {
          tp.track.mute = !tp.track.mute;
          fire('onTrackAction', { action: 'mute', track: tp.track });
        } else if (btn === 'solo') {
          tp.track.solo = !tp.track.solo;
          fire('onTrackAction', { action: 'solo', track: tp.track });
        } else if (btn === 'arm') {
          tp.track.armed = !tp.track.armed;
          fire('onTrackAction', { action: 'arm', track: tp.track });
        } else if (btn === 'collapse') {
          tp.track.collapsed = !tp.track.collapsed;
          fire('onTrackAction', { action: 'collapse', track: tp.track });
        } else {
          selectedTrackId = tp.track.id;
        }
        render();
      }
      return;
    }

    // Clip hit
    var hitInfo = hitClip(m.x, m.y);
    if (hitInfo) {
      if (!e.shiftKey) selectedClipIds = {};
      selectedClipIds[hitInfo.clip.id] = true;
      fire('onClipSelected', { clipIds: Object.keys(selectedClipIds) });

      if (hitInfo.edge) {
        dragState = {
          type: 'resize', clip: hitInfo.clip, track: hitInfo.track,
          edge: hitInfo.edge, origStart: hitInfo.clip.startTime,
          origDuration: hitInfo.clip.duration, startX: m.x
        };
      } else {
        dragState = {
          type: 'move', clip: hitInfo.clip, track: hitInfo.track,
          origStart: hitInfo.clip.startTime, origTrackId: hitInfo.clip.trackId,
          startX: m.x, startY: m.y
        };
      }
      render();
      return;
    }

    // Start rubber band selection
    if (!e.shiftKey) selectedClipIds = {};
    selectionRect = { x0: m.x, y0: m.y, x1: m.x, y1: m.y };
    render();
  }

  function onMouseMove(e) {
    var m = getMousePos(e);

    if (dragState) {
      if (dragState.type === 'move') {
        var dxSec = (m.x - dragState.startX) / (pixelsPerSecond * zoom);
        var newStart = Math.max(0, dragState.origStart + dxSec);
        dragState.clip.startTime = newStart;

        // Check if we moved to a different track
        var tp = hitTrack(m.y);
        if (tp && tp.track.id !== dragState.clip.trackId) {
          // Move clip to new track
          var oldTrack = findTrack(dragState.clip.trackId);
          if (oldTrack) {
            for (var r = 0; r < oldTrack.clips.length; r++) {
              if (oldTrack.clips[r].id === dragState.clip.id) {
                oldTrack.clips.splice(r, 1);
                break;
              }
            }
          }
          dragState.clip.trackId = tp.track.id;
          if (tp.track.clips.indexOf(dragState.clip) === -1) {
            tp.track.clips.push(dragState.clip);
          }
        }
        render();
      } else if (dragState.type === 'resize') {
        var dxS = (m.x - dragState.startX) / (pixelsPerSecond * zoom);
        if (dragState.edge === 'right') {
          dragState.clip.duration = Math.max(0.05, dragState.origDuration + dxS);
        } else if (dragState.edge === 'left') {
          var newSt = Math.max(0, dragState.origStart + dxS);
          var diff = newSt - dragState.origStart;
          dragState.clip.startTime = newSt;
          dragState.clip.duration = Math.max(0.05, dragState.origDuration - diff);
        }
        render();
      }
      return;
    }

    if (selectionRect) {
      selectionRect.x1 = m.x;
      selectionRect.y1 = m.y;
      updateRubberBandSelection();
      render();
      return;
    }

    // Cursor changes
    var hitInfo = hitClip(m.x, m.y);
    if (hitInfo && hitInfo.edge) {
      canvas.style.cursor = 'ew-resize';
    } else if (hitInfo) {
      canvas.style.cursor = 'pointer';
    } else {
      canvas.style.cursor = 'default';
    }
  }

  function onMouseUp(e) {
    if (dragState) {
      if (dragState.type === 'move' || dragState.type === 'resize') {
        fire('onClipMoved', {
          clip: dragState.clip,
          startTime: dragState.clip.startTime,
          duration: dragState.clip.duration,
          trackId: dragState.clip.trackId
        });
      }
      dragState = null;
    }
    if (selectionRect) {
      selectionRect = null;
      fire('onClipSelected', { clipIds: Object.keys(selectedClipIds) });
    }
    render();
  }

  function onDblClick(e) {
    var m = getMousePos(e);
    var hitInfo = hitClip(m.x, m.y);
    if (hitInfo) {
      fire('onClipDoubleClick', { clip: hitInfo.clip, track: hitInfo.track });
    }
  }

  function onContextMenuEvt(e) {
    e.preventDefault();
  }

  function updateRubberBandSelection() {
    if (!selectionRect) return;
    selectedClipIds = {};
    var x0 = Math.min(selectionRect.x0, selectionRect.x1);
    var x1 = Math.max(selectionRect.x0, selectionRect.x1);
    var y0 = Math.min(selectionRect.y0, selectionRect.y1);
    var y1 = Math.max(selectionRect.y0, selectionRect.y1);

    var pos = trackYPositions();
    for (var i = 0; i < pos.length; i++) {
      var tp = pos[i];
      var clips = tp.track.clips || [];
      for (var c = 0; c < clips.length; c++) {
        var clip = clips[c];
        var cx = secToX(clip.startTime);
        var cw = clip.duration * pixelsPerSecond * zoom;
        var cy = tp.y;
        var ch = tp.h;
        // AABB intersection
        if (cx + cw >= x0 && cx <= x1 && cy + ch >= y0 && cy <= y1) {
          selectedClipIds[clip.id] = true;
        }
      }
    }
  }

  function findTrack(id) {
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].id === id) return tracks[i];
    }
    return null;
  }

  // --- Public API ---
  function init(containerEl) {
    container = containerEl;
    canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);
    ctx = canvas.getContext('2d');

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('contextmenu', onContextMenuEvt);

    // Try loading tracks from TrackManager
    if (typeof DAW !== 'undefined' && DAW.TrackManager && DAW.TrackManager.getAllTracks) {
      tracks = DAW.TrackManager.getAllTracks();
    }

    if (tracks.length === 0) {
      tracks = createDemoTracks();
    }

    render();
  }

  function createDemoTracks() {
    return [
      {
        id: 'demo_1', name: 'Drums', type: 'audio', color: '#D94A4A',
        mute: false, solo: false, armed: false, volume: 0.8, pan: 0,
        height: 80, collapsed: false, automationLanes: [],
        clips: [
          { id: 'dc1', type: 'audio', name: 'Kick Loop', startTime: 0, duration: 4, color: '#D94A4A', trackId: 'demo_1' },
          { id: 'dc2', type: 'audio', name: 'Fill', startTime: 4, duration: 2, color: '#D94A4A', trackId: 'demo_1' }
        ]
      },
      {
        id: 'demo_2', name: 'Bass', type: 'midi', color: '#4A90D9',
        mute: false, solo: false, armed: false, volume: 1.0, pan: 0,
        height: 80, collapsed: false, automationLanes: [],
        clips: [
          {
            id: 'dc3', type: 'midi', name: 'Bass Line', startTime: 0, duration: 8, color: '#4A90D9', trackId: 'demo_2',
            notes: [
              { id: 'n1', pitch: 36, start: 0, duration: 0.5, velocity: 100 },
              { id: 'n2', pitch: 40, start: 1, duration: 0.5, velocity: 90 },
              { id: 'n3', pitch: 43, start: 2, duration: 1, velocity: 110 },
              { id: 'n4', pitch: 36, start: 4, duration: 0.5, velocity: 100 }
            ]
          }
        ]
      },
      {
        id: 'demo_3', name: 'Synth Lead', type: 'midi', color: '#4ecca3',
        mute: false, solo: false, armed: false, volume: 0.7, pan: 0.2,
        height: 80, collapsed: false,
        automationLanes: [
          { parameter: 'Volume', visible: true, points: [
            { time: 0, value: 0.5 }, { time: 4, value: 1.0 }, { time: 8, value: 0.3 }
          ]}
        ],
        clips: [
          {
            id: 'dc4', type: 'midi', name: 'Lead Melody', startTime: 2, duration: 6, color: '#4ecca3', trackId: 'demo_3',
            notes: [
              { id: 'n5', pitch: 60, start: 0, duration: 0.25, velocity: 80 },
              { id: 'n6', pitch: 64, start: 0.5, duration: 0.25, velocity: 85 },
              { id: 'n7', pitch: 67, start: 1, duration: 0.5, velocity: 90 },
              { id: 'n8', pitch: 72, start: 2, duration: 1, velocity: 100 }
            ]
          }
        ]
      }
    ];
  }

  function setTracks(t) {
    tracks = t || [];
    selectedClipIds = {};
    render();
  }

  function setPlayheadPosition(sec) {
    playheadSec = sec;
  }

  function setZoom(level) {
    zoom = Math.max(0.1, Math.min(level, 20));
    render();
  }

  function setVZoom(level) {
    var clamped = Math.max(0.25, Math.min(level, 4));
    for (var i = 0; i < tracks.length; i++) {
      tracks[i].height = Math.max(MIN_TRACK_HEIGHT, Math.round(DEFAULT_TRACK_HEIGHT * clamped));
    }
    render();
  }

  function setScroll(x, y) {
    scrollX = Math.max(0, x);
    scrollY = Math.max(0, y);
    render();
  }

  function setLoopRegion(start, end, enabled) {
    loopRegion.start = start;
    loopRegion.end = end;
    loopRegion.enabled = typeof enabled === 'boolean' ? enabled : true;
    render();
  }

  function setBPM(val) {
    bpm = val;
  }

  function setTimeSignature(num, den) {
    timeSignature.numerator = num;
    timeSignature.denominator = den;
  }

  function setMarkers(arr) {
    markers = arr || [];
  }

  function setSectionMarkers(arr) {
    sectionMarkers = arr || [];
  }

  return {
    init: init,
    render: render,
    setTracks: setTracks,
    setPlayheadPosition: setPlayheadPosition,
    setZoom: setZoom,
    setVZoom: setVZoom,
    setScroll: setScroll,
    setLoopRegion: setLoopRegion,
    setBPM: setBPM,
    setTimeSignature: setTimeSignature,
    setMarkers: setMarkers,
    setSectionMarkers: setSectionMarkers,

    get onClipSelected() { return callbacks.onClipSelected; },
    set onClipSelected(fn) { callbacks.onClipSelected = fn; },
    get onClipMoved() { return callbacks.onClipMoved; },
    set onClipMoved(fn) { callbacks.onClipMoved = fn; },
    get onPlayheadSet() { return callbacks.onPlayheadSet; },
    set onPlayheadSet(fn) { callbacks.onPlayheadSet = fn; },
    get onTrackAction() { return callbacks.onTrackAction; },
    set onTrackAction(fn) { callbacks.onTrackAction = fn; },
    get onClipDoubleClick() { return callbacks.onClipDoubleClick; },
    set onClipDoubleClick(fn) { callbacks.onClipDoubleClick = fn; },
    get onContextMenu() { return callbacks.onContextMenu; },
    set onContextMenu(fn) { callbacks.onContextMenu = fn; }
  };
})();
