var DAW = DAW || {};

DAW.MeterBridge = (function () {
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
    red: '#e94560'
  };

  // ─── Utility ─────────────────────────────────────────────────────────

  function dbToLinear(db) {
    return Math.pow(10, db / 20);
  }

  function linearToDb(linear) {
    if (linear <= 0) return -Infinity;
    return 20 * Math.log10(linear);
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  /**
   * Map a dB value to a normalised 0-1 position within the meter range.
   * -60 dB => 0, 0 dB => 1
   */
  function dbToNorm(db) {
    return clamp((db + 60) / 60, 0, 1);
  }

  /**
   * Build a vertical green->yellow->red gradient for a given rect.
   * Bottom is green, top is red.
   */
  function meterGradient(ctx, x, y, h) {
    var grad = ctx.createLinearGradient(x, y + h, x, y);
    grad.addColorStop(0.0, COLORS.green);   // -60 dB (bottom)
    grad.addColorStop(0.8, COLORS.yellow);  // ~ -12 dB
    grad.addColorStop(0.9, COLORS.yellow);  // ~ -6 dB
    grad.addColorStop(1.0, COLORS.red);     //   0 dB (top)
    return grad;
  }

  // ─── drawPeakMeter ───────────────────────────────────────────────────

  /**
   * Draws a stereo peak meter with two vertical bars.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x       Left edge
   * @param {number} y       Top edge
   * @param {number} w       Total width (both bars + gap + scale)
   * @param {number} h       Height
   * @param {number} levelL  Left level  0-1 linear
   * @param {number} levelR  Right level 0-1 linear
   * @param {number} peakHoldL  Peak hold left 0-1
   * @param {number} peakHoldR  Peak hold right 0-1
   */
  function drawPeakMeter(ctx, x, y, w, h, levelL, levelR, peakHoldL, peakHoldR) {
    var scaleW = 24;
    var gap = 2;
    var barW = Math.floor((w - scaleW - gap * 3) / 2);
    var barXL = x + scaleW + gap;
    var barXR = barXL + barW + gap;
    var grad = meterGradient(ctx, x, y, h);

    // Background
    ctx.fillStyle = COLORS.surface;
    ctx.fillRect(barXL, y, barW, h);
    ctx.fillRect(barXR, y, barW, h);

    // Filled portion - left
    var normL = dbToNorm(linearToDb(clamp(levelL, 0, 1.5)));
    var fillHL = normL * h;
    ctx.fillStyle = grad;
    ctx.fillRect(barXL, y + h - fillHL, barW, fillHL);

    // Filled portion - right
    var normR = dbToNorm(linearToDb(clamp(levelR, 0, 1.5)));
    var fillHR = normR * h;
    ctx.fillStyle = grad;
    ctx.fillRect(barXR, y + h - fillHR, barW, fillHR);

    // Peak hold lines
    var peakNormL = dbToNorm(linearToDb(clamp(peakHoldL, 0, 1.5)));
    var peakYL = y + h - peakNormL * h;
    ctx.strokeStyle = COLORS.text;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(barXL, peakYL);
    ctx.lineTo(barXL + barW, peakYL);
    ctx.stroke();

    var peakNormR = dbToNorm(linearToDb(clamp(peakHoldR, 0, 1.5)));
    var peakYR = y + h - peakNormR * h;
    ctx.beginPath();
    ctx.moveTo(barXR, peakYR);
    ctx.lineTo(barXR + barW, peakYR);
    ctx.stroke();

    // Clip indicators
    if (levelL >= 1.0) {
      ctx.fillStyle = COLORS.red;
      ctx.fillRect(barXL, y, barW, 4);
    }
    if (levelR >= 1.0) {
      ctx.fillStyle = COLORS.red;
      ctx.fillRect(barXR, y, barW, 4);
    }

    // Scale markings
    var marks = [0, -6, -12, -24, -48];
    ctx.fillStyle = COLORS.textDim;
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < marks.length; i++) {
      var my = y + h - dbToNorm(marks[i]) * h;
      ctx.fillText(marks[i] === 0 ? ' 0' : String(marks[i]), x + scaleW - 2, my);
      // tick
      ctx.fillStyle = COLORS.textDim;
      ctx.fillRect(x + scaleW - 1, my, gap + 1, 1);
      ctx.fillStyle = COLORS.textDim;
    }
  }

  // ─── drawSpectrumAnalyzer ────────────────────────────────────────────

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {Float32Array|Array} fftData  Magnitude data (dB or 0-1 normalised)
   * @param {number} [numBands]           Number of bands to draw (default 32)
   */
  function drawSpectrumAnalyzer(ctx, x, y, w, h, fftData, numBands) {
    numBands = numBands || 32;
    if (!fftData || fftData.length === 0) return;

    var barGap = 1;
    var barW = Math.floor((w - barGap * (numBands - 1)) / numBands);
    if (barW < 1) barW = 1;
    var grad = meterGradient(ctx, x, y, h);

    // Background
    ctx.fillStyle = COLORS.surface;
    ctx.fillRect(x, y, w, h);

    // Map FFT bins to bands (log-frequency distribution)
    var binCount = fftData.length;
    for (var b = 0; b < numBands; b++) {
      // Log-frequency mapping: more bins assigned to lower bands
      var fLow = Math.pow(b / numBands, 2);
      var fHigh = Math.pow((b + 1) / numBands, 2);
      var idxLow = Math.floor(fLow * binCount);
      var idxHigh = Math.max(Math.floor(fHigh * binCount), idxLow + 1);

      // Average the bins in this band
      var sum = 0;
      var count = 0;
      for (var j = idxLow; j < idxHigh && j < binCount; j++) {
        var val = fftData[j];
        // If data looks like dB values (negative), convert to 0-1
        if (val < 0) {
          val = clamp((val + 60) / 60, 0, 1);
        }
        sum += val;
        count++;
      }
      var amp = count > 0 ? sum / count : 0;
      amp = clamp(amp, 0, 1);

      var bx = x + b * (barW + barGap);
      var barH = amp * h;

      ctx.fillStyle = grad;
      ctx.fillRect(bx, y + h - barH, barW, barH);
    }

    // Frequency labels
    var freqLabels = ['60', '250', '1k', '4k', '16k'];
    var freqPositions = [0.05, 0.15, 0.35, 0.65, 0.9];
    ctx.fillStyle = COLORS.textDim;
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (var fl = 0; fl < freqLabels.length; fl++) {
      ctx.fillText(freqLabels[fl], x + freqPositions[fl] * w, y + h + 2);
    }
  }

  // ─── drawGoniometer ──────────────────────────────────────────────────

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x        Centre-x
   * @param {number} y        Centre-y
   * @param {number} size     Diameter
   * @param {Float32Array|Array} leftData   Left channel samples
   * @param {Float32Array|Array} rightData  Right channel samples
   */
  function drawGoniometer(ctx, x, y, size, leftData, rightData) {
    var r = size / 2;

    // Background circle
    ctx.fillStyle = COLORS.surface;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // Cross-hair lines
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    // Vertical (mono axis)
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x, y + r);
    ctx.stroke();
    // Horizontal (side axis)
    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.lineTo(x + r, y);
    ctx.stroke();

    if (!leftData || !rightData) return;

    var len = Math.min(leftData.length, rightData.length);
    var fadeStep = 1.0 / len;
    var scale = r * 0.85;
    // 45-degree rotation factor
    var cos45 = 0.7071067811865476;

    for (var i = 0; i < len; i++) {
      var l = leftData[i];
      var rr = rightData[i];
      // Lissajous: M = L+R (sum), S = L-R (diff)
      var mid = (l + rr) * cos45;
      var side = (l - rr) * cos45;
      var px = x + side * scale;
      var py = y - mid * scale;

      // Fade trail: newer points are brighter
      var alpha = 0.15 + 0.85 * (i * fadeStep);
      ctx.fillStyle = 'rgba(78,204,163,' + alpha.toFixed(3) + ')';
      ctx.fillRect(px, py, 1.5, 1.5);
    }
  }

  // ─── drawCorrelation ─────────────────────────────────────────────────

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {number} value  -1 to +1
   */
  function drawCorrelation(ctx, x, y, w, h, value) {
    value = clamp(value, -1, 1);

    // Background
    ctx.fillStyle = COLORS.surface;
    ctx.fillRect(x, y, w, h);

    // Centre line
    var cx = x + w / 2;
    ctx.strokeStyle = COLORS.textDim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.lineTo(cx, y + h);
    ctx.stroke();

    // Fill bar from centre
    var barH = h - 6;
    var barY = y + 3;
    var barW;
    var barX;
    if (value >= 0) {
      barW = (value * w) / 2;
      barX = cx;
    } else {
      barW = (-value * w) / 2;
      barX = cx - barW;
    }

    // Color by value
    var color;
    if (value < 0) {
      color = COLORS.red;
    } else if (value < 0.5) {
      color = COLORS.yellow;
    } else {
      color = COLORS.green;
    }
    ctx.fillStyle = color;
    ctx.fillRect(barX, barY, barW, barH);

    // Labels: -1, 0, +1
    ctx.fillStyle = COLORS.textDim;
    ctx.font = '9px monospace';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText('-1', x + 2, y + h);
    ctx.textAlign = 'center';
    ctx.fillText('0', cx, y + h);
    ctx.textAlign = 'right';
    ctx.fillText('+1', x + w - 2, y + h);
  }

  // ─── drawLUFS ────────────────────────────────────────────────────────

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {number} integrated  Integrated LUFS value
   * @param {number} shortTerm   Short-term LUFS
   * @param {number} truePeak    True-peak dBTP
   */
  function drawLUFS(ctx, x, y, w, h, integrated, shortTerm, truePeak) {
    // Background
    ctx.fillStyle = COLORS.surface;
    ctx.fillRect(x, y, w, h);

    var rowH = Math.floor(h / 3);
    var labels = ['INT', 'ST', 'TP'];
    var values = [integrated, shortTerm, truePeak];

    for (var i = 0; i < 3; i++) {
      var ry = y + i * rowH;
      var val = values[i];

      // Color coding
      var color;
      if (val > -6) {
        color = COLORS.red;
      } else if (val > -10) {
        color = COLORS.yellow;
      } else {
        color = COLORS.green;
      }

      // Label
      ctx.fillStyle = COLORS.textDim;
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(labels[i], x + 4, ry + rowH / 2);

      // Numeric value
      var valStr = isFinite(val) ? val.toFixed(1) : '-inf';
      ctx.fillStyle = color;
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(valStr, x + w * 0.65, ry + rowH / 2);

      // Unit
      ctx.fillStyle = COLORS.textDim;
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(i < 2 ? 'LUFS' : 'dBTP', x + w * 0.67, ry + rowH / 2);

      // Bar visualisation
      var barX = x + w * 0.04;
      var barW = w * 0.92;
      var barY = ry + rowH - 6;
      var barH = 3;
      ctx.fillStyle = COLORS.surface2;
      ctx.fillRect(barX, barY, barW, barH);

      // Fill: map -60..0 to 0..1
      var norm = clamp((val + 60) / 60, 0, 1);
      ctx.fillStyle = color;
      ctx.fillRect(barX, barY, norm * barW, barH);
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────

  return {
    drawPeakMeter: drawPeakMeter,
    drawSpectrumAnalyzer: drawSpectrumAnalyzer,
    drawGoniometer: drawGoniometer,
    drawCorrelation: drawCorrelation,
    drawLUFS: drawLUFS,
    dbToLinear: dbToLinear,
    linearToDb: linearToDb
  };

})();
