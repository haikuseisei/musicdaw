var DAW = DAW || {};

DAW.MixerView = (function () {
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
    yellow: '#f0c040',
    red: '#e94560',
    meterGreen: '#4ecca3',
    meterYellow: '#f0c040',
    meterRed: '#e94560'
  };

  // ─── Layout ──────────────────────────────────────────────────────────

  var STRIP_W = 80;
  var MASTER_W = 100;
  var DIVIDER_W = 2;

  // Vertical section heights (relative from strip top)
  var NAME_H = 20;
  var COLOR_BAR_H = 4;
  var EQ_H = 50;
  var INSERTS_H = 56;    // 4 slots x 14px
  var SENDS_H = 24;      // 2 mini bars
  var PAN_H = 20;
  var FADER_H = 120;
  var METER_W = 6;        // per channel of stereo meter
  var BUTTONS_H = 24;
  var DB_LABEL_H = 16;

  // ─── State ──────────────────────────────────────────────────────────

  var canvas, ctx, container;
  var dpr = 1;
  var canvasW = 0, canvasH = 0;

  var channels = [];     // array of channel objects
  var levelsMap = {};    // {channelId: {peakL, peakR}}
  var peakHold = {};     // {channelId: {peakL, peakR, timeL, timeR}}

  var dragState = null;  // {type:'fader'|'pan', channelId, startY|startX, startValue}

  // Callbacks
  var callbacks = {
    onFaderChange: null,
    onPanChange: null,
    onMuteToggle: null,
    onSoloToggle: null
  };

  function fire(name) {
    var fn = callbacks[name];
    if (!fn) return;
    var args = [];
    for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
    fn.apply(null, args);
  }

  // ─── Utilities ──────────────────────────────────────────────────────

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function linearToDb(lin) {
    if (lin <= 0) return -Infinity;
    return 20 * Math.log10(lin);
  }

  function volumeToDb(vol) {
    // vol 0-1 maps to roughly -inf to +6dB  (0.8 = 0dB)
    if (vol <= 0) return -Infinity;
    return 20 * Math.log10(vol / 0.8);
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

  // ─── Channel geometry ───────────────────────────────────────────────

  function getRegularChannels() {
    var list = [];
    for (var i = 0; i < channels.length; i++) {
      var t = channels[i].type;
      if (t !== 'bus' && t !== 'return' && t !== 'master') {
        list.push(channels[i]);
      }
    }
    return list;
  }

  function getBusChannels() {
    var list = [];
    for (var i = 0; i < channels.length; i++) {
      var t = channels[i].type;
      if (t === 'bus' || t === 'return') {
        list.push(channels[i]);
      }
    }
    return list;
  }

  function getMasterChannel() {
    for (var i = 0; i < channels.length; i++) {
      if (channels[i].type === 'master') return channels[i];
    }
    return null;
  }

  /**
   * Returns {x, w} for a given channel id.
   */
  function channelRect(channelId) {
    var regulars = getRegularChannels();
    var buses = getBusChannels();
    var master = getMasterChannel();
    var xOff = 0;

    for (var i = 0; i < regulars.length; i++) {
      if (regulars[i].id === channelId) return { x: xOff, w: STRIP_W };
      xOff += STRIP_W;
    }

    if (buses.length > 0) {
      xOff += DIVIDER_W;
      for (var b = 0; b < buses.length; b++) {
        if (buses[b].id === channelId) return { x: xOff, w: STRIP_W };
        xOff += STRIP_W;
      }
    }

    if (master && master.id === channelId) {
      xOff += DIVIDER_W;
      return { x: xOff, w: MASTER_W };
    }

    return null;
  }

  // ─── Section Y offsets (computed from container height) ─────────────

  function sectionLayout(stripH) {
    // Distribute remaining space equally, but keep fader dominant
    var fixedH = NAME_H + COLOR_BAR_H + EQ_H + INSERTS_H + SENDS_H + PAN_H + BUTTONS_H + DB_LABEL_H;
    var availFader = stripH - fixedH;
    var faderH = Math.max(60, availFader);

    var y = 0;
    var layout = {};
    layout.name = y;         y += NAME_H;
    layout.colorBar = y;     y += COLOR_BAR_H;
    layout.eq = y;           y += EQ_H;
    layout.inserts = y;      y += INSERTS_H;
    layout.sends = y;        y += SENDS_H;
    layout.pan = y;          y += PAN_H;
    layout.fader = y;        y += faderH;
    layout.buttons = y;      y += BUTTONS_H;
    layout.dbLabel = y;      y += DB_LABEL_H;
    layout.faderH = faderH;
    layout.total = y;
    return layout;
  }

  // ─── Drawing ────────────────────────────────────────────────────────

  function render() {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, canvasW, canvasH);

    var regulars = getRegularChannels();
    var busChans = getBusChannels();
    var master = getMasterChannel();

    var stripH = canvasH;
    var lay = sectionLayout(stripH);
    var xOff = 0;

    // Regular channels
    for (var i = 0; i < regulars.length; i++) {
      drawStrip(regulars[i], xOff, 0, STRIP_W, lay, false);
      xOff += STRIP_W;
    }

    // Divider before buses
    if (busChans.length > 0) {
      ctx.fillStyle = COLORS.accent2;
      ctx.fillRect(xOff, 0, DIVIDER_W, stripH);
      xOff += DIVIDER_W;

      for (var b = 0; b < busChans.length; b++) {
        drawStrip(busChans[b], xOff, 0, STRIP_W, lay, false);
        xOff += STRIP_W;
      }
    }

    // Master channel
    if (master) {
      ctx.fillStyle = COLORS.accent2;
      ctx.fillRect(xOff, 0, DIVIDER_W, stripH);
      xOff += DIVIDER_W;
      drawStrip(master, xOff, 0, MASTER_W, lay, true);
    }
  }

  function drawStrip(ch, x, y, w, lay, isMaster) {
    // Strip background
    ctx.fillStyle = COLORS.surface;
    ctx.fillRect(x, y, w, lay.total);

    // Right border
    ctx.strokeStyle = COLORS.surface2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + w, y);
    ctx.lineTo(x + w, y + lay.total);
    ctx.stroke();

    drawName(ch, x, y + lay.name, w, isMaster);
    drawColorBar(ch, x, y + lay.colorBar, w);
    drawEQ(ch, x, y + lay.eq, w);
    drawInserts(ch, x, y + lay.inserts, w);
    drawSends(ch, x, y + lay.sends, w);
    drawPan(ch, x, y + lay.pan, w);
    drawFader(ch, x, y + lay.fader, w, lay.faderH);
    drawMeter(ch, x, y + lay.fader, w, lay.faderH);
    drawButtons(ch, x, y + lay.buttons, w);
    drawDbLabel(ch, x, y + lay.dbLabel, w);
  }

  // ── Name ───────────────────────────────────────────────────────────

  function drawName(ch, x, y, w, isMaster) {
    ctx.fillStyle = COLORS.text;
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var label = ch.name || 'Track';
    if (isMaster) label = 'MASTER';
    if (label.length > 10) label = label.substring(0, 10);
    ctx.fillText(label, x + w / 2, y + NAME_H / 2);
  }

  // ── Color bar ──────────────────────────────────────────────────────

  function drawColorBar(ch, x, y, w) {
    ctx.fillStyle = ch.color || COLORS.accent;
    ctx.fillRect(x + 4, y, w - 8, COLOR_BAR_H);
  }

  // ── Mini EQ curve ──────────────────────────────────────────────────

  function drawEQ(ch, x, y, w) {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(x + 4, y + 2, w - 8, EQ_H - 4);

    var eqW = w - 8;
    var eqH = EQ_H - 4;
    var ex = x + 4;
    var ey = y + 2;
    var midY = ey + eqH / 2;

    // Centre line
    ctx.strokeStyle = COLORS.surface2;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(ex, midY);
    ctx.lineTo(ex + eqW, midY);
    ctx.stroke();

    // Simulated EQ curve (if no data, draw flat with slight bumps)
    ctx.strokeStyle = COLORS.green;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (var i = 0; i <= eqW; i++) {
      var t = i / eqW;
      // Simple parametric curve: gentle low boost, slight mid scoop, high roll-off
      var curve = Math.sin(t * Math.PI) * 0.3;
      curve += Math.sin(t * Math.PI * 3) * 0.12;
      var py = midY - curve * eqH * 0.4;
      if (i === 0) {
        ctx.moveTo(ex + i, py);
      } else {
        ctx.lineTo(ex + i, py);
      }
    }
    ctx.stroke();
  }

  // ── Insert effect slots ────────────────────────────────────────────

  function drawInserts(ch, x, y, w) {
    var inserts = ch.inserts || [];
    var slotH = 14;
    for (var i = 0; i < 4; i++) {
      var sy = y + i * slotH;
      var hasInsert = i < inserts.length && inserts[i];

      ctx.fillStyle = hasInsert ? COLORS.surface2 : COLORS.bg;
      ctx.fillRect(x + 4, sy, w - 8, slotH - 2);

      if (hasInsert) {
        ctx.fillStyle = COLORS.text;
        ctx.font = '8px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        var insertName = (typeof inserts[i] === 'string') ? inserts[i] : (inserts[i].name || 'FX');
        if (insertName.length > 9) insertName = insertName.substring(0, 9);
        ctx.fillText(insertName, x + 6, sy + (slotH - 2) / 2);
      }
    }
  }

  // ── Send levels ────────────────────────────────────────────────────

  function drawSends(ch, x, y, w) {
    var sends = ch.sends || [];
    var barH = 8;
    var gap = 4;
    var maxSends = 2;

    for (var i = 0; i < maxSends; i++) {
      var by = y + i * (barH + gap) + 2;
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(x + 4, by, w - 8, barH);

      if (i < sends.length) {
        var level = (typeof sends[i] === 'number') ? sends[i] : (sends[i].level || 0);
        var fillW = clamp(level, 0, 1) * (w - 8);
        ctx.fillStyle = COLORS.accent2;
        ctx.fillRect(x + 4, by, fillW, barH);
      }
    }
  }

  // ── Pan control ────────────────────────────────────────────────────

  function drawPan(ch, x, y, w) {
    var panY = y + PAN_H / 2;
    var panX = x + 10;
    var panW = w - 20;
    var pan = (ch.pan !== undefined) ? ch.pan : 0; // -1 to +1
    var dotPos = panX + (pan + 1) / 2 * panW;

    // Track line
    ctx.strokeStyle = COLORS.textDim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(panX, panY);
    ctx.lineTo(panX + panW, panY);
    ctx.stroke();

    // Centre tick
    ctx.beginPath();
    ctx.moveTo(panX + panW / 2, panY - 3);
    ctx.lineTo(panX + panW / 2, panY + 3);
    ctx.stroke();

    // Dot
    ctx.beginPath();
    ctx.arc(dotPos, panY, 4, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.text;
    ctx.fill();
  }

  // ── Fader ──────────────────────────────────────────────────────────

  function drawFader(ch, x, y, w, faderH) {
    var faderX = x + 16;
    var faderW = 12;
    var slotX = faderX + faderW / 2 - 2;
    var slotW = 4;
    var handleH = 10;
    var vol = (ch.volume !== undefined) ? ch.volume : 0.8;
    var handleY = y + faderH - vol * faderH - handleH / 2;
    handleY = clamp(handleY, y, y + faderH - handleH);

    // Slot background
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(slotX, y + 4, slotW, faderH - 8);

    // Slot filled portion
    ctx.fillStyle = COLORS.accent2;
    var fillTop = handleY + handleH / 2;
    ctx.fillRect(slotX, fillTop, slotW, (y + faderH - 4) - fillTop);

    // 0dB mark (at vol=0.8)
    var zeroDbY = y + faderH - 0.8 * faderH;
    ctx.strokeStyle = COLORS.textDim;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(faderX - 2, zeroDbY);
    ctx.lineTo(faderX + faderW + 2, zeroDbY);
    ctx.stroke();

    // Handle
    ctx.fillStyle = COLORS.text;
    ctx.fillRect(faderX - 2, handleY, faderW + 4, handleH);

    // Handle groove
    ctx.strokeStyle = COLORS.surface;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(faderX, handleY + handleH / 2);
    ctx.lineTo(faderX + faderW, handleY + handleH / 2);
    ctx.stroke();
  }

  // ── Level meters (next to fader) ───────────────────────────────────

  function drawMeter(ch, x, y, w, faderH) {
    var meterX = x + 38;
    var meterH = faderH - 8;
    var meterY = y + 4;

    var levels = levelsMap[ch.id] || { peakL: 0, peakR: 0 };
    var hold = getPeakHold(ch.id, levels.peakL, levels.peakR);

    // Build gradient
    var grad = ctx.createLinearGradient(meterX, meterY + meterH, meterX, meterY);
    grad.addColorStop(0.0, COLORS.meterGreen);
    grad.addColorStop(0.8, COLORS.meterYellow);
    grad.addColorStop(0.9, COLORS.meterYellow);
    grad.addColorStop(1.0, COLORS.meterRed);

    // Background
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(meterX, meterY, METER_W, meterH);
    ctx.fillRect(meterX + METER_W + 1, meterY, METER_W, meterH);

    // Left bar
    var normL = clamp(levels.peakL, 0, 1);
    var fillL = normL * meterH;
    ctx.fillStyle = grad;
    ctx.fillRect(meterX, meterY + meterH - fillL, METER_W, fillL);

    // Right bar
    var normR = clamp(levels.peakR, 0, 1);
    var fillR = normR * meterH;
    ctx.fillStyle = grad;
    ctx.fillRect(meterX + METER_W + 1, meterY + meterH - fillR, METER_W, fillR);

    // Peak hold lines
    ctx.strokeStyle = COLORS.text;
    ctx.lineWidth = 1;
    var holdYL = meterY + meterH - clamp(hold.peakL, 0, 1) * meterH;
    ctx.beginPath();
    ctx.moveTo(meterX, holdYL);
    ctx.lineTo(meterX + METER_W, holdYL);
    ctx.stroke();

    var holdYR = meterY + meterH - clamp(hold.peakR, 0, 1) * meterH;
    ctx.beginPath();
    ctx.moveTo(meterX + METER_W + 1, holdYR);
    ctx.lineTo(meterX + METER_W * 2 + 1, holdYR);
    ctx.stroke();

    // Clip indicators
    if (levels.peakL >= 1.0) {
      ctx.fillStyle = COLORS.meterRed;
      ctx.fillRect(meterX, meterY, METER_W, 3);
    }
    if (levels.peakR >= 1.0) {
      ctx.fillStyle = COLORS.meterRed;
      ctx.fillRect(meterX + METER_W + 1, meterY, METER_W, 3);
    }
  }

  // ── Peak hold logic ────────────────────────────────────────────────

  function getPeakHold(channelId, currentL, currentR) {
    var now = Date.now();
    if (!peakHold[channelId]) {
      peakHold[channelId] = { peakL: 0, peakR: 0, timeL: now, timeR: now };
    }
    var ph = peakHold[channelId];

    // Update peak L
    if (currentL >= ph.peakL) {
      ph.peakL = currentL;
      ph.timeL = now;
    } else if (now - ph.timeL > 1000) {
      // Decay ~3dB per frame (~16ms at 60fps)
      ph.peakL = Math.max(0, ph.peakL * 0.93);
    }

    // Update peak R
    if (currentR >= ph.peakR) {
      ph.peakR = currentR;
      ph.timeR = now;
    } else if (now - ph.timeR > 1000) {
      ph.peakR = Math.max(0, ph.peakR * 0.93);
    }

    return ph;
  }

  // ── Mute / Solo buttons ────────────────────────────────────────────

  function drawButtons(ch, x, y, w) {
    var btnW = 22;
    var btnH = 18;
    var gap = 4;
    var totalW = btnW * 2 + gap;
    var bx = x + (w - totalW) / 2;

    // Mute
    ctx.fillStyle = ch.mute ? COLORS.accent : COLORS.surface2;
    ctx.fillRect(bx, y + 3, btnW, btnH);
    ctx.fillStyle = ch.mute ? COLORS.text : COLORS.textDim;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('M', bx + btnW / 2, y + 3 + btnH / 2);

    // Solo
    var sx = bx + btnW + gap;
    ctx.fillStyle = ch.solo ? COLORS.yellow : COLORS.surface2;
    ctx.fillRect(sx, y + 3, btnW, btnH);
    ctx.fillStyle = ch.solo ? COLORS.bg : COLORS.textDim;
    ctx.font = 'bold 10px monospace';
    ctx.fillText('S', sx + btnW / 2, y + 3 + btnH / 2);
  }

  // ── dB label ───────────────────────────────────────────────────────

  function drawDbLabel(ch, x, y, w) {
    var vol = (ch.volume !== undefined) ? ch.volume : 0.8;
    var db = volumeToDb(vol);
    var label = isFinite(db) ? db.toFixed(1) + ' dB' : '-inf';
    ctx.fillStyle = COLORS.textDim;
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + DB_LABEL_H / 2);
  }

  // ─── Hit testing ────────────────────────────────────────────────────

  function getMousePos(e) {
    var rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function hitTestChannel(mx) {
    for (var i = 0; i < channels.length; i++) {
      var r = channelRect(channels[i].id);
      if (r && mx >= r.x && mx < r.x + r.w) {
        return channels[i];
      }
    }
    return null;
  }

  function hitTestFader(ch, mx, my) {
    var r = channelRect(ch.id);
    if (!r) return false;
    var lay = sectionLayout(canvasH);
    var faderX = r.x + 10;
    var faderRight = r.x + r.w - 10;
    var faderTop = lay.fader;
    var faderBottom = lay.fader + lay.faderH;
    return mx >= faderX && mx <= faderRight && my >= faderTop && my <= faderBottom;
  }

  function hitTestPan(ch, mx, my) {
    var r = channelRect(ch.id);
    if (!r) return false;
    var lay = sectionLayout(canvasH);
    var panTop = lay.pan;
    var panBottom = panTop + PAN_H;
    return mx >= r.x && mx < r.x + r.w && my >= panTop && my <= panBottom;
  }

  function hitTestMute(ch, mx, my) {
    var r = channelRect(ch.id);
    if (!r) return false;
    var lay = sectionLayout(canvasH);
    var btnW = 22;
    var btnH = 18;
    var gap = 4;
    var totalW = btnW * 2 + gap;
    var bx = r.x + (r.w - totalW) / 2;
    var by = lay.buttons + 3;
    return mx >= bx && mx < bx + btnW && my >= by && my < by + btnH;
  }

  function hitTestSolo(ch, mx, my) {
    var r = channelRect(ch.id);
    if (!r) return false;
    var lay = sectionLayout(canvasH);
    var btnW = 22;
    var btnH = 18;
    var gap = 4;
    var totalW = btnW * 2 + gap;
    var bx = r.x + (r.w - totalW) / 2;
    var sx = bx + btnW + gap;
    var by = lay.buttons + 3;
    return mx >= sx && mx < sx + btnW && my >= by && my < by + btnH;
  }

  // ─── Mouse handlers ────────────────────────────────────────────────

  function faderValueFromY(ch, my) {
    var lay = sectionLayout(canvasH);
    var norm = 1.0 - (my - lay.fader) / lay.faderH;
    return clamp(norm, 0, 1);
  }

  function panValueFromX(ch, mx) {
    var r = channelRect(ch.id);
    if (!r) return 0;
    var panX = r.x + 10;
    var panW = r.w - 20;
    var norm = (mx - panX) / panW;
    return clamp(norm * 2 - 1, -1, 1);
  }

  function onMouseDown(e) {
    var pos = getMousePos(e);
    var ch = hitTestChannel(pos.x);
    if (!ch) return;

    // Mute / Solo buttons
    if (hitTestMute(ch, pos.x, pos.y)) {
      fire('onMuteToggle', ch.id);
      ch.mute = !ch.mute;
      render();
      return;
    }
    if (hitTestSolo(ch, pos.x, pos.y)) {
      fire('onSoloToggle', ch.id);
      ch.solo = !ch.solo;
      render();
      return;
    }

    // Fader drag start
    if (hitTestFader(ch, pos.x, pos.y)) {
      dragState = {
        type: 'fader',
        channelId: ch.id,
        startY: pos.y,
        startValue: ch.volume !== undefined ? ch.volume : 0.8
      };
      // Immediately set fader to click position
      ch.volume = faderValueFromY(ch, pos.y);
      fire('onFaderChange', ch.id, ch.volume);
      render();
      return;
    }

    // Pan drag start
    if (hitTestPan(ch, pos.x, pos.y)) {
      dragState = {
        type: 'pan',
        channelId: ch.id,
        startX: pos.x,
        startValue: ch.pan !== undefined ? ch.pan : 0
      };
      ch.pan = panValueFromX(ch, pos.x);
      fire('onPanChange', ch.id, ch.pan);
      render();
      return;
    }
  }

  function onMouseMove(e) {
    if (!dragState) return;
    var pos = getMousePos(e);

    var ch = findChannel(dragState.channelId);
    if (!ch) { dragState = null; return; }

    if (dragState.type === 'fader') {
      ch.volume = faderValueFromY(ch, pos.y);
      fire('onFaderChange', ch.id, ch.volume);
      render();
    } else if (dragState.type === 'pan') {
      ch.pan = panValueFromX(ch, pos.x);
      fire('onPanChange', ch.id, ch.pan);
      render();
    }
  }

  function onMouseUp() {
    dragState = null;
  }

  function onDblClick(e) {
    var pos = getMousePos(e);
    var ch = hitTestChannel(pos.x);
    if (!ch) return;

    if (hitTestFader(ch, pos.x, pos.y)) {
      ch.volume = 0.8;   // 0dB
      fire('onFaderChange', ch.id, ch.volume);
      render();
    }
  }

  function findChannel(id) {
    for (var i = 0; i < channels.length; i++) {
      if (channels[i].id === id) return channels[i];
    }
    return null;
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
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseUp);
    canvas.addEventListener('dblclick', onDblClick);

    render();
  }

  function setChannels(chans) {
    channels = chans || [];
    peakHold = {};
    render();
  }

  function updateLevels(map) {
    levelsMap = map || {};
  }

  return {
    init: init,
    render: render,
    setChannels: setChannels,
    updateLevels: updateLevels,
    onFaderChange: function (fn) { callbacks.onFaderChange = fn; },
    onPanChange: function (fn) { callbacks.onPanChange = fn; },
    onMuteToggle: function (fn) { callbacks.onMuteToggle = fn; },
    onSoloToggle: function (fn) { callbacks.onSoloToggle = fn; }
  };

})();
