var DAW = DAW || {};

DAW.SessionView = (function () {
  'use strict';

  // ─── Colors ──────────────────────────────────────────────────────────

  var COLORS = {
    bg: '#1a1a2e',
    surface: '#16213e',
    surface2: '#0f3460',
    accent: '#e94560',
    accent2: '#533483',
    text: '#eee',
    textDim: '#888',
    green: '#4ecca3',
    yellow: '#f0c040'
  };

  // ─── Layout constants ───────────────────────────────────────────────

  var SCENE_COL_W = 40;       // left scene number column
  var TRACK_HEADER_H = 60;    // top track header row
  var CELL_W = 80;            // clip slot width
  var CELL_H = 40;            // clip slot height
  var LAUNCH_COL_W = 32;      // right scene launch column
  var STOP_ROW_H = 28;        // stop buttons row at bottom

  // ─── State ──────────────────────────────────────────────────────────

  var canvas, ctx, container;
  var dpr = 1;
  var canvasW = 0, canvasH = 0;

  var tracks = [];   // [{id, name, color, type, armed}]
  var scenes = [];   // [{id, name, clips: [{slotId, trackId, sceneId, name, color, state}]}]
  var playingClipIds = {};

  var blinkPhase = 0;
  var animFrame = null;

  // Callbacks
  var callbacks = {
    onClipLaunch: null,
    onClipStop: null,
    onSceneLaunch: null,
    onStopAll: null
  };

  function fire(name) {
    var fn = callbacks[name];
    if (!fn) return;
    var args = [];
    for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
    fn.apply(null, args);
  }

  // ─── HiDPI ──────────────────────────────────────────────────────────

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

  // ─── Helpers ────────────────────────────────────────────────────────

  function trackIndex(trackId) {
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].id === trackId) return i;
    }
    return -1;
  }

  function findClip(trackId, sceneId) {
    for (var si = 0; si < scenes.length; si++) {
      var sc = scenes[si];
      if (sc.id !== sceneId) continue;
      if (!sc.clips) continue;
      for (var ci = 0; ci < sc.clips.length; ci++) {
        if (sc.clips[ci].trackId === trackId) return sc.clips[ci];
      }
    }
    return null;
  }

  function isPlaying(clip) {
    if (!clip) return false;
    return clip.state === 'playing' || !!playingClipIds[clip.slotId];
  }

  function isQueued(clip) {
    return clip && clip.state === 'queued';
  }

  // ─── Drawing ────────────────────────────────────────────────────────

  function render() {
    if (!canvas || !container) return;
    blinkPhase = (blinkPhase + 0.06) % (Math.PI * 2);

    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, canvasW, canvasH);

    drawTrackHeaders();
    drawSceneColumn();
    drawClipGrid();
    drawLaunchColumn();
    drawStopRow();
  }

  // ── Track headers (top row) ─────────────────────────────────────────

  function drawTrackHeaders() {
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      var x = SCENE_COL_W + i * CELL_W;
      var y = 0;

      // Background
      ctx.fillStyle = COLORS.surface;
      ctx.fillRect(x, y, CELL_W, TRACK_HEADER_H);

      // Border right
      ctx.strokeStyle = COLORS.surface2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + CELL_W, y);
      ctx.lineTo(x + CELL_W, y + TRACK_HEADER_H);
      ctx.stroke();

      // Color bar
      ctx.fillStyle = t.color || COLORS.accent;
      ctx.fillRect(x + 4, y + 4, CELL_W - 8, 4);

      // Track name
      ctx.fillStyle = COLORS.text;
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var nameStr = t.name || ('Track ' + (i + 1));
      if (nameStr.length > 9) nameStr = nameStr.substring(0, 9);
      ctx.fillText(nameStr, x + CELL_W / 2, y + 22);

      // Arm button (circle)
      var armCx = x + CELL_W / 2;
      var armCy = y + 42;
      var armR = 7;
      ctx.beginPath();
      ctx.arc(armCx, armCy, armR, 0, Math.PI * 2);
      if (t.armed) {
        ctx.fillStyle = COLORS.accent;
        ctx.fill();
      } else {
        ctx.strokeStyle = COLORS.textDim;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Inner dot when armed
      if (t.armed) {
        ctx.beginPath();
        ctx.arc(armCx, armCy, 3, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.text;
        ctx.fill();
      }
    }
  }

  // ── Scene column (left) ─────────────────────────────────────────────

  function drawSceneColumn() {
    ctx.fillStyle = COLORS.surface;
    ctx.fillRect(0, TRACK_HEADER_H, SCENE_COL_W, canvasH - TRACK_HEADER_H);

    for (var i = 0; i < scenes.length; i++) {
      var sy = TRACK_HEADER_H + i * CELL_H;

      // Scene number
      ctx.fillStyle = COLORS.textDim;
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), SCENE_COL_W / 2, sy + CELL_H / 2);

      // Separator
      ctx.strokeStyle = COLORS.surface2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, sy + CELL_H);
      ctx.lineTo(SCENE_COL_W, sy + CELL_H);
      ctx.stroke();
    }
  }

  // ── Clip grid ───────────────────────────────────────────────────────

  function drawClipGrid() {
    for (var si = 0; si < scenes.length; si++) {
      var sc = scenes[si];
      var sy = TRACK_HEADER_H + si * CELL_H;

      for (var ti = 0; ti < tracks.length; ti++) {
        var tx = SCENE_COL_W + ti * CELL_W;
        var clip = findClip(tracks[ti].id, sc.id);

        drawClipSlot(tx, sy, clip, tracks[ti]);
      }
    }
  }

  function drawClipSlot(x, y, clip, track) {
    var pad = 1;

    if (!clip || clip.state === 'empty') {
      // Empty slot
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(x + pad, y + pad, CELL_W - pad * 2, CELL_H - pad * 2);
      ctx.strokeStyle = COLORS.surface2;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + pad + 0.5, y + pad + 0.5, CELL_W - pad * 2 - 1, CELL_H - pad * 2 - 1);
      return;
    }

    var playing = isPlaying(clip);
    var queued = isQueued(clip);
    var clipColor = clip.color || track.color || COLORS.accent2;

    // Clip background
    ctx.fillStyle = clipColor;
    ctx.globalAlpha = playing ? 1.0 : 0.7;
    ctx.fillRect(x + pad, y + pad, CELL_W - pad * 2, CELL_H - pad * 2);
    ctx.globalAlpha = 1.0;

    // Clip name
    ctx.fillStyle = COLORS.text;
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    var displayName = clip.name || '';
    if (displayName.length > 9) displayName = displayName.substring(0, 9);
    ctx.fillText(displayName, x + 6, y + CELL_H / 2);

    // Play triangle in top-right corner
    var triX = x + CELL_W - 14;
    var triY = y + 6;
    var triSize = 8;
    ctx.beginPath();
    ctx.moveTo(triX, triY);
    ctx.lineTo(triX + triSize, triY + triSize / 2);
    ctx.lineTo(triX, triY + triSize);
    ctx.closePath();
    if (playing) {
      ctx.fillStyle = COLORS.text;
      ctx.fill();
    } else {
      ctx.strokeStyle = COLORS.text;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Playing border pulse
    if (playing) {
      var pulse = 0.5 + 0.5 * Math.sin(blinkPhase * 3);
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5 + pulse * 0.5;
      ctx.strokeRect(x + pad, y + pad, CELL_W - pad * 2, CELL_H - pad * 2);
      ctx.globalAlpha = 1.0;
    }

    // Queued blinking border
    if (queued) {
      var blink = Math.sin(blinkPhase * 4) > 0 ? 1.0 : 0.3;
      ctx.strokeStyle = COLORS.yellow;
      ctx.lineWidth = 2;
      ctx.globalAlpha = blink;
      ctx.strokeRect(x + pad, y + pad, CELL_W - pad * 2, CELL_H - pad * 2);
      ctx.globalAlpha = 1.0;
    }
  }

  // ── Scene launch column (right) ─────────────────────────────────────

  function drawLaunchColumn() {
    var lx = SCENE_COL_W + tracks.length * CELL_W;

    ctx.fillStyle = COLORS.surface;
    ctx.fillRect(lx, TRACK_HEADER_H, LAUNCH_COL_W, canvasH - TRACK_HEADER_H);

    for (var i = 0; i < scenes.length; i++) {
      var sy = TRACK_HEADER_H + i * CELL_H;
      var cx = lx + LAUNCH_COL_W / 2;
      var cy = sy + CELL_H / 2;

      // Play triangle button
      var ts = 7;
      ctx.beginPath();
      ctx.moveTo(cx - ts / 2, cy - ts);
      ctx.lineTo(cx + ts, cy);
      ctx.lineTo(cx - ts / 2, cy + ts);
      ctx.closePath();
      ctx.fillStyle = COLORS.green;
      ctx.fill();

      // Separator
      ctx.strokeStyle = COLORS.surface2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lx, sy + CELL_H);
      ctx.lineTo(lx + LAUNCH_COL_W, sy + CELL_H);
      ctx.stroke();
    }
  }

  // ── Stop row (bottom) ───────────────────────────────────────────────

  function drawStopRow() {
    var stopY = TRACK_HEADER_H + scenes.length * CELL_H;

    for (var i = 0; i < tracks.length; i++) {
      var sx = SCENE_COL_W + i * CELL_W;

      ctx.fillStyle = COLORS.surface;
      ctx.fillRect(sx, stopY, CELL_W, STOP_ROW_H);

      // Stop square
      var sqSize = 8;
      var sqX = sx + (CELL_W - sqSize) / 2;
      var sqY = stopY + (STOP_ROW_H - sqSize) / 2;
      ctx.fillStyle = COLORS.textDim;
      ctx.fillRect(sqX, sqY, sqSize, sqSize);

      // Border
      ctx.strokeStyle = COLORS.surface2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx + CELL_W, stopY);
      ctx.lineTo(sx + CELL_W, stopY + STOP_ROW_H);
      ctx.stroke();
    }

    // Stop All button (bottom-right corner)
    var allX = SCENE_COL_W + tracks.length * CELL_W;
    ctx.fillStyle = COLORS.surface2;
    ctx.fillRect(allX, stopY, LAUNCH_COL_W, STOP_ROW_H);

    var allSqSize = 10;
    ctx.fillStyle = COLORS.accent;
    ctx.fillRect(
      allX + (LAUNCH_COL_W - allSqSize) / 2,
      stopY + (STOP_ROW_H - allSqSize) / 2,
      allSqSize, allSqSize
    );
  }

  // ─── Hit testing ────────────────────────────────────────────────────

  function getMousePos(e) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  function hitTest(mx, my) {
    var stopY = TRACK_HEADER_H + scenes.length * CELL_H;
    var launchX = SCENE_COL_W + tracks.length * CELL_W;

    // Stop All button
    if (mx >= launchX && mx < launchX + LAUNCH_COL_W &&
        my >= stopY && my < stopY + STOP_ROW_H) {
      return { type: 'stopAll' };
    }

    // Scene launch column
    if (mx >= launchX && mx < launchX + LAUNCH_COL_W &&
        my >= TRACK_HEADER_H && my < stopY) {
      var sceneIdx = Math.floor((my - TRACK_HEADER_H) / CELL_H);
      if (sceneIdx >= 0 && sceneIdx < scenes.length) {
        return { type: 'sceneLaunch', sceneId: scenes[sceneIdx].id };
      }
    }

    // Stop row
    if (my >= stopY && my < stopY + STOP_ROW_H && mx >= SCENE_COL_W && mx < launchX) {
      var trackIdx = Math.floor((mx - SCENE_COL_W) / CELL_W);
      if (trackIdx >= 0 && trackIdx < tracks.length) {
        return { type: 'trackStop', trackId: tracks[trackIdx].id };
      }
    }

    // Clip slots
    if (mx >= SCENE_COL_W && mx < launchX &&
        my >= TRACK_HEADER_H && my < stopY) {
      var ti = Math.floor((mx - SCENE_COL_W) / CELL_W);
      var si = Math.floor((my - TRACK_HEADER_H) / CELL_H);
      if (ti >= 0 && ti < tracks.length && si >= 0 && si < scenes.length) {
        var clip = findClip(tracks[ti].id, scenes[si].id);
        return {
          type: 'clip',
          trackId: tracks[ti].id,
          sceneId: scenes[si].id,
          clip: clip
        };
      }
    }

    return null;
  }

  // ─── Mouse handlers ────────────────────────────────────────────────

  function onMouseDown(e) {
    var pos = getMousePos(e);
    var hit = hitTest(pos.x, pos.y);
    if (!hit) return;

    switch (hit.type) {
      case 'clip':
        if (hit.clip && hit.clip.state !== 'empty') {
          if (isPlaying(hit.clip)) {
            fire('onClipStop', hit.trackId, hit.sceneId);
          } else {
            fire('onClipLaunch', hit.trackId, hit.sceneId);
          }
        } else {
          fire('onClipLaunch', hit.trackId, hit.sceneId);
        }
        break;
      case 'sceneLaunch':
        fire('onSceneLaunch', hit.sceneId);
        break;
      case 'trackStop':
        // Stop track's clips - fire stop for each scene in this track
        for (var i = 0; i < scenes.length; i++) {
          var cl = findClip(hit.trackId, scenes[i].id);
          if (cl && isPlaying(cl)) {
            fire('onClipStop', hit.trackId, scenes[i].id);
          }
        }
        break;
      case 'stopAll':
        fire('onStopAll');
        break;
    }

    render();
  }

  // ─── Animation loop ─────────────────────────────────────────────────

  function animate() {
    render();
    animFrame = requestAnimationFrame(animate);
  }

  // ─── Public API ─────────────────────────────────────────────────────

  function init(cont) {
    container = cont;
    canvas = container.querySelector('canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      container.appendChild(canvas);
    }
    ctx = canvas.getContext('2d');

    resizeCanvas();
    window.addEventListener('resize', function () {
      resizeCanvas();
      render();
    });

    canvas.addEventListener('mousedown', onMouseDown);

    animate();
  }

  function setData(data) {
    if (data.tracks) tracks = data.tracks;
    if (data.scenes) scenes = data.scenes;
    render();
  }

  function setPlayingClips(clipIds) {
    playingClipIds = {};
    if (clipIds) {
      for (var i = 0; i < clipIds.length; i++) {
        playingClipIds[clipIds[i]] = true;
      }
    }
  }

  return {
    init: init,
    render: render,
    setData: setData,
    setPlayingClips: setPlayingClips,
    onClipLaunch: function (fn) { callbacks.onClipLaunch = fn; },
    onClipStop: function (fn) { callbacks.onClipStop = fn; },
    onSceneLaunch: function (fn) { callbacks.onSceneLaunch = fn; },
    onStopAll: function (fn) { callbacks.onStopAll = fn; }
  };

})();
