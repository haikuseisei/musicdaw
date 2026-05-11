var DAW = DAW || {};

DAW.WaveformRenderer = (function () {

  function drawWaveform(canvas, audioBuffer, color, playheadRatio) {
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    var w = rect.width;
    var h = rect.height;

    ctx.fillStyle = 'transparent';
    ctx.clearRect(0, 0, w, h);

    if (!audioBuffer) return;

    var data = audioBuffer.getChannelData(0);
    var step = Math.ceil(data.length / w);
    var midY = h / 2;

    ctx.strokeStyle = color || '#4ecca3';
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (var x = 0; x < w; x++) {
      var start = x * step;
      var min = 1, max = -1;
      for (var j = 0; j < step && start + j < data.length; j++) {
        var val = data[start + j];
        if (val < min) min = val;
        if (val > max) max = val;
      }
      var yMin = midY + min * midY * 0.9;
      var yMax = midY + max * midY * 0.9;
      ctx.moveTo(x, yMin);
      ctx.lineTo(x, yMax);
    }
    ctx.stroke();

    if (typeof playheadRatio === 'number' && playheadRatio >= 0) {
      var px = playheadRatio * w;
      ctx.strokeStyle = '#e94560';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
  }

  function drawChords(canvas, chords, totalDuration, playheadRatio) {
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    var w = rect.width;
    var h = rect.height;
    ctx.clearRect(0, 0, w, h);

    if (!chords || chords.length === 0 || totalDuration <= 0) return;

    var colors = [
      '#e94560', '#533483', '#0f3460', '#4ecca3',
      '#f0c040', '#e07020', '#3060e0', '#a040c0'
    ];

    chords.forEach(function (c, i) {
      if (c.chord === 'N') return;
      var x = (c.time / totalDuration) * w;
      var cw = (c.duration / totalDuration) * w;
      var colorIdx = i % colors.length;

      ctx.fillStyle = colors[colorIdx];
      ctx.globalAlpha = 0.3;
      ctx.fillRect(x, 0, cw, h);
      ctx.globalAlpha = 1;

      ctx.strokeStyle = colors[colorIdx];
      ctx.lineWidth = 1;
      ctx.strokeRect(x, 0, cw, h);

      ctx.fillStyle = '#eee';
      ctx.font = Math.min(16, h * 0.4) + 'px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (cw > 20) {
        ctx.fillText(c.chord, x + cw / 2, h / 2);
      }
    });

    if (typeof playheadRatio === 'number' && playheadRatio >= 0) {
      var px = playheadRatio * w;
      ctx.strokeStyle = '#e94560';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
  }

  function drawDrumPattern(canvas, drumData, playheadRatio) {
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    var w = rect.width;
    var h = rect.height;
    ctx.clearRect(0, 0, w, h);

    if (!drumData || !drumData.events || drumData.events.length === 0) return;

    var totalDuration = drumData.totalDuration;
    var rowHeight = h / 4;
    var typeOrder = ['crash', 'hihat', 'snare', 'kick'];
    var typeColors = {
      kick: '#e94560',
      snare: '#f0c040',
      hihat: '#4ecca3',
      crash: '#533483'
    };

    typeOrder.forEach(function (type, row) {
      ctx.fillStyle = '#888';
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(type.charAt(0).toUpperCase() + type.slice(1, 3), 2, row * rowHeight + rowHeight / 2);
    });

    var labelOffset = 30;
    var laneW = w - labelOffset;

    drumData.events.forEach(function (evt) {
      var row = typeOrder.indexOf(evt.type);
      if (row < 0) return;
      var x = labelOffset + (evt.time / totalDuration) * laneW;
      var y = row * rowHeight + 2;
      var dotH = rowHeight - 4;

      ctx.fillStyle = typeColors[evt.type] || '#888';
      ctx.globalAlpha = 0.7;
      ctx.fillRect(x, y, Math.max(2, laneW * drumData.stepDuration / totalDuration - 1), dotH);
      ctx.globalAlpha = 1;
    });

    typeOrder.forEach(function (_, row) {
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, (row + 1) * rowHeight);
      ctx.lineTo(w, (row + 1) * rowHeight);
      ctx.stroke();
    });

    if (typeof playheadRatio === 'number' && playheadRatio >= 0) {
      var px = labelOffset + playheadRatio * laneW;
      ctx.strokeStyle = '#e94560';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
  }

  return {
    drawWaveform: drawWaveform,
    drawChords: drawChords,
    drawDrumPattern: drawDrumPattern
  };
})();
