var DAW = DAW || {};

DAW.AudioEditor = (function () {
  'use strict';

  // ─── Utility helpers ──────────────────────────────────────────────

  function getContext() {
    return DAW.AudioEngine.getContext();
  }

  function createBuffer(numChannels, length, sampleRate) {
    var ac = getContext();
    return ac.createBuffer(numChannels, length, sampleRate);
  }

  function duplicateBuffer(audioBuffer) {
    var buf = createBuffer(
      audioBuffer.numberOfChannels,
      audioBuffer.length,
      audioBuffer.sampleRate
    );
    for (var ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      buf.copyToChannel(audioBuffer.getChannelData(ch).slice(), ch);
    }
    return buf;
  }

  function timeToSample(time, sampleRate) {
    return Math.round(time * sampleRate);
  }

  function clamp(val, min, max) {
    return val < min ? min : val > max ? max : val;
  }

  function dBToLinear(db) {
    return Math.pow(10, db / 20);
  }

  function linearToDb(linear) {
    if (linear <= 0) return -Infinity;
    return 20 * Math.log10(linear);
  }

  // ─── Non-destructive operations ───────────────────────────────────

  function cut(audioBuffer, startTime, endTime) {
    var sr = audioBuffer.sampleRate;
    var ch = audioBuffer.numberOfChannels;
    var startSample = timeToSample(startTime, sr);
    var endSample = timeToSample(endTime, sr);
    startSample = clamp(startSample, 0, audioBuffer.length);
    endSample = clamp(endSample, 0, audioBuffer.length);

    var cutLength = endSample - startSample;
    var newLength = audioBuffer.length - cutLength;
    if (newLength <= 0) return createBuffer(ch, 1, sr);

    var buf = createBuffer(ch, newLength, sr);
    for (var c = 0; c < ch; c++) {
      var src = audioBuffer.getChannelData(c);
      var dst = buf.getChannelData(c);
      var idx = 0;
      for (var i = 0; i < startSample; i++) {
        dst[idx++] = src[i];
      }
      for (var j = endSample; j < audioBuffer.length; j++) {
        dst[idx++] = src[j];
      }
    }
    return buf;
  }

  function copy(audioBuffer, startTime, endTime) {
    var sr = audioBuffer.sampleRate;
    var ch = audioBuffer.numberOfChannels;
    var startSample = timeToSample(startTime, sr);
    var endSample = timeToSample(endTime, sr);
    startSample = clamp(startSample, 0, audioBuffer.length);
    endSample = clamp(endSample, 0, audioBuffer.length);

    var copyLength = endSample - startSample;
    if (copyLength <= 0) return createBuffer(ch, 1, sr);

    var buf = createBuffer(ch, copyLength, sr);
    for (var c = 0; c < ch; c++) {
      var src = audioBuffer.getChannelData(c);
      var dst = buf.getChannelData(c);
      for (var i = 0; i < copyLength; i++) {
        dst[i] = src[startSample + i];
      }
    }
    return buf;
  }

  function paste(targetBuffer, sourceBuffer, insertTime) {
    var sr = targetBuffer.sampleRate;
    var ch = Math.max(targetBuffer.numberOfChannels, sourceBuffer.numberOfChannels);
    var insertSample = timeToSample(insertTime, sr);
    insertSample = clamp(insertSample, 0, targetBuffer.length);

    var newLength = targetBuffer.length + sourceBuffer.length;
    var buf = createBuffer(ch, newLength, sr);

    for (var c = 0; c < ch; c++) {
      var dst = buf.getChannelData(c);
      var tSrc = c < targetBuffer.numberOfChannels
        ? targetBuffer.getChannelData(c)
        : new Float32Array(targetBuffer.length);
      var sSrc = c < sourceBuffer.numberOfChannels
        ? sourceBuffer.getChannelData(c)
        : new Float32Array(sourceBuffer.length);

      var idx = 0;
      for (var i = 0; i < insertSample; i++) {
        dst[idx++] = tSrc[i];
      }
      for (var j = 0; j < sourceBuffer.length; j++) {
        dst[idx++] = sSrc[j];
      }
      for (var k = insertSample; k < targetBuffer.length; k++) {
        dst[idx++] = tSrc[k];
      }
    }
    return buf;
  }

  function trim(audioBuffer, startTime, endTime) {
    return copy(audioBuffer, startTime, endTime);
  }

  function silence(audioBuffer, startTime, endTime) {
    var buf = duplicateBuffer(audioBuffer);
    var sr = buf.sampleRate;
    var startSample = timeToSample(startTime, sr);
    var endSample = timeToSample(endTime, sr);
    startSample = clamp(startSample, 0, buf.length);
    endSample = clamp(endSample, 0, buf.length);

    for (var c = 0; c < buf.numberOfChannels; c++) {
      var data = buf.getChannelData(c);
      for (var i = startSample; i < endSample; i++) {
        data[i] = 0;
      }
    }
    return buf;
  }

  // ─── Processing operations ────────────────────────────────────────

  function reverse(audioBuffer) {
    var buf = duplicateBuffer(audioBuffer);
    for (var c = 0; c < buf.numberOfChannels; c++) {
      var data = buf.getChannelData(c);
      var len = data.length;
      for (var i = 0; i < Math.floor(len / 2); i++) {
        var tmp = data[i];
        data[i] = data[len - 1 - i];
        data[len - 1 - i] = tmp;
      }
    }
    return buf;
  }

  function normalize(audioBuffer, targetPeak) {
    if (typeof targetPeak === 'undefined') targetPeak = -0.1;
    var buf = duplicateBuffer(audioBuffer);
    var peak = 0;

    for (var c = 0; c < buf.numberOfChannels; c++) {
      var data = buf.getChannelData(c);
      for (var i = 0; i < data.length; i++) {
        var abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
    }

    if (peak === 0) return buf;

    var targetLinear = dBToLinear(targetPeak);
    var scale = targetLinear / peak;

    for (var c2 = 0; c2 < buf.numberOfChannels; c2++) {
      var d = buf.getChannelData(c2);
      for (var j = 0; j < d.length; j++) {
        d[j] *= scale;
      }
    }
    return buf;
  }

  function computeFadeCurve(position, curve) {
    // position: 0 to 1
    if (curve === 'exponential') {
      return position * position;
    } else if (curve === 'sCurve') {
      // Smoothstep
      return position * position * (3 - 2 * position);
    }
    // linear
    return position;
  }

  function fadeIn(audioBuffer, duration, curve) {
    curve = curve || 'linear';
    var buf = duplicateBuffer(audioBuffer);
    var sr = buf.sampleRate;
    var fadeSamples = Math.min(timeToSample(duration, sr), buf.length);

    for (var c = 0; c < buf.numberOfChannels; c++) {
      var data = buf.getChannelData(c);
      for (var i = 0; i < fadeSamples; i++) {
        var pos = i / fadeSamples;
        data[i] *= computeFadeCurve(pos, curve);
      }
    }
    return buf;
  }

  function fadeOut(audioBuffer, duration, curve) {
    curve = curve || 'linear';
    var buf = duplicateBuffer(audioBuffer);
    var sr = buf.sampleRate;
    var fadeSamples = Math.min(timeToSample(duration, sr), buf.length);
    var startSample = buf.length - fadeSamples;

    for (var c = 0; c < buf.numberOfChannels; c++) {
      var data = buf.getChannelData(c);
      for (var i = 0; i < fadeSamples; i++) {
        var pos = 1 - (i / fadeSamples);
        data[startSample + i] *= computeFadeCurve(pos, curve);
      }
    }
    return buf;
  }

  function crossfade(buffer1, buffer2, crossfadeDuration, curve) {
    curve = curve || 'linear';
    var sr = buffer1.sampleRate;
    var ch = Math.max(buffer1.numberOfChannels, buffer2.numberOfChannels);
    var xfadeSamples = timeToSample(crossfadeDuration, sr);
    xfadeSamples = Math.min(xfadeSamples, buffer1.length, buffer2.length);

    var newLength = buffer1.length + buffer2.length - xfadeSamples;
    var buf = createBuffer(ch, newLength, sr);

    for (var c = 0; c < ch; c++) {
      var dst = buf.getChannelData(c);
      var src1 = c < buffer1.numberOfChannels
        ? buffer1.getChannelData(c)
        : new Float32Array(buffer1.length);
      var src2 = c < buffer2.numberOfChannels
        ? buffer2.getChannelData(c)
        : new Float32Array(buffer2.length);

      // Copy non-crossfade portion of buffer1
      var nonXfade1 = buffer1.length - xfadeSamples;
      for (var i = 0; i < nonXfade1; i++) {
        dst[i] = src1[i];
      }

      // Crossfade region
      for (var j = 0; j < xfadeSamples; j++) {
        var pos = j / xfadeSamples;
        var fadeOutVal = computeFadeCurve(1 - pos, curve);
        var fadeInVal = computeFadeCurve(pos, curve);
        dst[nonXfade1 + j] = src1[nonXfade1 + j] * fadeOutVal + src2[j] * fadeInVal;
      }

      // Copy remainder of buffer2
      for (var k = xfadeSamples; k < buffer2.length; k++) {
        dst[nonXfade1 + k] = src2[k];
      }
    }
    return buf;
  }

  function gain(audioBuffer, gainValue) {
    var buf = duplicateBuffer(audioBuffer);
    for (var c = 0; c < buf.numberOfChannels; c++) {
      var data = buf.getChannelData(c);
      for (var i = 0; i < data.length; i++) {
        data[i] *= gainValue;
      }
    }
    return buf;
  }

  function invertPhase(audioBuffer) {
    return gain(audioBuffer, -1);
  }

  // ─── Time/pitch manipulation ──────────────────────────────────────

  function timeStretch(audioBuffer, rate) {
    if (rate <= 0) rate = 0.1;
    var sr = audioBuffer.sampleRate;
    var ch = audioBuffer.numberOfChannels;
    var grainSize = Math.round(sr * 0.05); // 50ms grains
    var hopIn = Math.round(grainSize * 0.5);  // 50% overlap input
    var hopOut = Math.round(hopIn / rate);     // adjusted output spacing

    var inputLength = audioBuffer.length;
    var outputLength = Math.round(inputLength / rate);
    if (outputLength <= 0) outputLength = 1;

    var buf = createBuffer(ch, outputLength, sr);

    // Hann window
    var window = new Float32Array(grainSize);
    for (var w = 0; w < grainSize; w++) {
      window[w] = 0.5 * (1 - Math.cos(2 * Math.PI * w / (grainSize - 1)));
    }

    for (var c = 0; c < ch; c++) {
      var src = audioBuffer.getChannelData(c);
      var dst = buf.getChannelData(c);

      var inPos = 0;
      var outPos = 0;

      while (inPos < inputLength - grainSize && outPos < outputLength) {
        for (var g = 0; g < grainSize; g++) {
          var outIdx = outPos + g;
          if (outIdx < outputLength) {
            dst[outIdx] += src[inPos + g] * window[g];
          }
        }
        inPos += hopIn;
        outPos += hopOut;
      }
    }
    return buf;
  }

  function pitchShift(audioBuffer, semitones) {
    // Pitch shift via time stretch + resample
    var pitchRatio = Math.pow(2, semitones / 12);
    // First stretch to compensate for pitch change
    var stretched = timeStretch(audioBuffer, pitchRatio);
    // Then resample to change pitch while restoring original duration
    var sr = audioBuffer.sampleRate;
    var ch = stretched.numberOfChannels;
    var originalLength = audioBuffer.length;
    var buf = createBuffer(ch, originalLength, sr);

    for (var c = 0; c < ch; c++) {
      var src = stretched.getChannelData(c);
      var dst = buf.getChannelData(c);

      for (var i = 0; i < originalLength; i++) {
        var srcPos = i * (stretched.length / originalLength);
        var idx = Math.floor(srcPos);
        var frac = srcPos - idx;

        if (idx + 1 < src.length) {
          dst[i] = src[idx] * (1 - frac) + src[idx + 1] * frac;
        } else if (idx < src.length) {
          dst[i] = src[idx];
        }
      }
    }
    return buf;
  }

  // ─── Noise processing ────────────────────────────────────────────

  function noiseProfile(audioBuffer, startTime, endTime) {
    var sr = audioBuffer.sampleRate;
    var startSample = timeToSample(startTime, sr);
    var endSample = timeToSample(endTime, sr);
    startSample = clamp(startSample, 0, audioBuffer.length);
    endSample = clamp(endSample, 0, audioBuffer.length);

    var fftSize = 2048;
    var segmentLength = endSample - startSample;
    if (segmentLength < fftSize) fftSize = nextPow2(segmentLength);
    if (fftSize < 4) fftSize = 4;

    var numSegments = Math.floor(segmentLength / (fftSize / 2)) - 1;
    if (numSegments < 1) numSegments = 1;

    var avgSpectrum = new Float32Array(fftSize);

    // Simple DFT-based noise profiling (average magnitude spectrum)
    for (var c = 0; c < audioBuffer.numberOfChannels; c++) {
      var data = audioBuffer.getChannelData(c);

      for (var seg = 0; seg < numSegments; seg++) {
        var offset = startSample + seg * Math.floor(fftSize / 2);
        if (offset + fftSize > audioBuffer.length) break;

        var real = new Float32Array(fftSize);
        var imag = new Float32Array(fftSize);

        // Apply Hann window and copy
        for (var i = 0; i < fftSize; i++) {
          var winVal = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1)));
          real[i] = data[offset + i] * winVal;
        }

        fft(real, imag, fftSize);

        for (var k = 0; k < fftSize; k++) {
          avgSpectrum[k] += Math.sqrt(real[k] * real[k] + imag[k] * imag[k]);
        }
      }
    }

    var totalSegs = numSegments * audioBuffer.numberOfChannels;
    for (var s = 0; s < fftSize; s++) {
      avgSpectrum[s] /= totalSegs;
    }

    return {
      spectrum: avgSpectrum,
      fftSize: fftSize,
      sampleRate: sr
    };
  }

  function noiseReduction(audioBuffer, profile, amount) {
    amount = clamp(typeof amount === 'number' ? amount : 0.5, 0, 1);
    var buf = duplicateBuffer(audioBuffer);
    var sr = buf.sampleRate;
    var fftSize = profile.fftSize;
    var hopSize = Math.floor(fftSize / 2);

    // Hann window
    var window = new Float32Array(fftSize);
    for (var w = 0; w < fftSize; w++) {
      window[w] = 0.5 * (1 - Math.cos(2 * Math.PI * w / (fftSize - 1)));
    }

    for (var c = 0; c < buf.numberOfChannels; c++) {
      var data = buf.getChannelData(c);
      var output = new Float32Array(data.length);
      var windowSum = new Float32Array(data.length);

      var pos = 0;
      while (pos + fftSize <= data.length) {
        var real = new Float32Array(fftSize);
        var imag = new Float32Array(fftSize);

        for (var i = 0; i < fftSize; i++) {
          real[i] = data[pos + i] * window[i];
        }

        fft(real, imag, fftSize);

        // Spectral subtraction
        for (var k = 0; k < fftSize; k++) {
          var mag = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]);
          var phase = Math.atan2(imag[k], real[k]);
          var noiseMag = profile.spectrum[k] * amount;
          var newMag = mag - noiseMag;
          if (newMag < 0) newMag = mag * 0.01; // spectral floor
          real[k] = newMag * Math.cos(phase);
          imag[k] = newMag * Math.sin(phase);
        }

        ifft(real, imag, fftSize);

        for (var j = 0; j < fftSize; j++) {
          output[pos + j] += real[j] * window[j];
          windowSum[pos + j] += window[j] * window[j];
        }

        pos += hopSize;
      }

      // Normalize by window sum
      for (var n = 0; n < data.length; n++) {
        if (windowSum[n] > 0.0001) {
          data[n] = output[n] / windowSum[n];
        }
      }
    }
    return buf;
  }

  // ─── Simple FFT implementation ────────────────────────────────────

  function nextPow2(n) {
    var p = 1;
    while (p < n) p <<= 1;
    return p;
  }

  function fft(real, imag, n) {
    // Cooley-Tukey in-place radix-2
    var bits = Math.round(Math.log(n) / Math.log(2));
    // Bit reversal
    for (var i = 0; i < n; i++) {
      var rev = 0;
      var tmp = i;
      for (var b = 0; b < bits; b++) {
        rev = (rev << 1) | (tmp & 1);
        tmp >>= 1;
      }
      if (rev > i) {
        var tr = real[i]; real[i] = real[rev]; real[rev] = tr;
        var ti = imag[i]; imag[i] = imag[rev]; imag[rev] = ti;
      }
    }

    for (var size = 2; size <= n; size *= 2) {
      var halfSize = size / 2;
      var angle = -2 * Math.PI / size;
      var wR = Math.cos(angle);
      var wI = Math.sin(angle);

      for (var start = 0; start < n; start += size) {
        var curR = 1, curI = 0;
        for (var k = 0; k < halfSize; k++) {
          var evenIdx = start + k;
          var oddIdx = start + k + halfSize;
          var tR = curR * real[oddIdx] - curI * imag[oddIdx];
          var tI = curR * imag[oddIdx] + curI * real[oddIdx];
          real[oddIdx] = real[evenIdx] - tR;
          imag[oddIdx] = imag[evenIdx] - tI;
          real[evenIdx] += tR;
          imag[evenIdx] += tI;
          var newCurR = curR * wR - curI * wI;
          curI = curR * wI + curI * wR;
          curR = newCurR;
        }
      }
    }
  }

  function ifft(real, imag, n) {
    // Conjugate, FFT, conjugate, scale
    for (var i = 0; i < n; i++) imag[i] = -imag[i];
    fft(real, imag, n);
    for (var j = 0; j < n; j++) {
      real[j] /= n;
      imag[j] = -imag[j] / n;
    }
  }

  // ─── Analysis ─────────────────────────────────────────────────────

  function detectSilence(audioBuffer, threshold, minDuration) {
    threshold = typeof threshold === 'number' ? threshold : -60;
    minDuration = typeof minDuration === 'number' ? minDuration : 0.1;

    var thresholdLinear = dBToLinear(threshold);
    var sr = audioBuffer.sampleRate;
    var minSamples = timeToSample(minDuration, sr);
    var regions = [];
    var silenceStart = -1;

    for (var i = 0; i < audioBuffer.length; i++) {
      var maxSample = 0;
      for (var c = 0; c < audioBuffer.numberOfChannels; c++) {
        var val = Math.abs(audioBuffer.getChannelData(c)[i]);
        if (val > maxSample) maxSample = val;
      }

      if (maxSample < thresholdLinear) {
        if (silenceStart === -1) silenceStart = i;
      } else {
        if (silenceStart !== -1) {
          var dur = i - silenceStart;
          if (dur >= minSamples) {
            regions.push({
              start: silenceStart / sr,
              end: i / sr
            });
          }
          silenceStart = -1;
        }
      }
    }

    // Handle trailing silence
    if (silenceStart !== -1) {
      var trailingDur = audioBuffer.length - silenceStart;
      if (trailingDur >= minSamples) {
        regions.push({
          start: silenceStart / sr,
          end: audioBuffer.length / sr
        });
      }
    }

    return regions;
  }

  function getPeakLevel(audioBuffer) {
    var peak = 0;
    for (var c = 0; c < audioBuffer.numberOfChannels; c++) {
      var data = audioBuffer.getChannelData(c);
      for (var i = 0; i < data.length; i++) {
        var abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
    }
    return linearToDb(peak);
  }

  function getRMSLevel(audioBuffer) {
    var sumSquared = 0;
    var totalSamples = 0;

    for (var c = 0; c < audioBuffer.numberOfChannels; c++) {
      var data = audioBuffer.getChannelData(c);
      for (var i = 0; i < data.length; i++) {
        sumSquared += data[i] * data[i];
        totalSamples++;
      }
    }

    var rms = Math.sqrt(sumSquared / totalSamples);
    return linearToDb(rms);
  }

  function getWaveformData(audioBuffer, numPoints) {
    numPoints = numPoints || 1000;
    var data = audioBuffer.getChannelData(0); // Use first channel
    var samplesPerPoint = Math.floor(data.length / numPoints);
    if (samplesPerPoint < 1) samplesPerPoint = 1;

    var result = [];
    for (var i = 0; i < numPoints; i++) {
      var start = i * samplesPerPoint;
      var end = Math.min(start + samplesPerPoint, data.length);
      var min = 0;
      var max = 0;

      for (var j = start; j < end; j++) {
        if (data[j] < min) min = data[j];
        if (data[j] > max) max = data[j];
      }
      result.push({ min: min, max: max });
    }
    return result;
  }

  // ─── Utility ──────────────────────────────────────────────────────

  function mixBuffers(buffers, gains) {
    if (!buffers || buffers.length === 0) return null;

    var maxLength = 0;
    var maxChannels = 0;
    var sr = buffers[0].sampleRate;

    for (var b = 0; b < buffers.length; b++) {
      if (buffers[b].length > maxLength) maxLength = buffers[b].length;
      if (buffers[b].numberOfChannels > maxChannels) {
        maxChannels = buffers[b].numberOfChannels;
      }
    }

    var buf = createBuffer(maxChannels, maxLength, sr);

    for (var bi = 0; bi < buffers.length; bi++) {
      var g = (gains && bi < gains.length) ? gains[bi] : 1.0;
      for (var c = 0; c < maxChannels; c++) {
        var dst = buf.getChannelData(c);
        var srcCh = c < buffers[bi].numberOfChannels ? c : 0;
        var src = buffers[bi].getChannelData(srcCh);
        for (var i = 0; i < src.length; i++) {
          dst[i] += src[i] * g;
        }
      }
    }
    return buf;
  }

  function convertSampleRate(audioBuffer, newSampleRate) {
    var ch = audioBuffer.numberOfChannels;
    var ratio = newSampleRate / audioBuffer.sampleRate;
    var newLength = Math.round(audioBuffer.length * ratio);
    var buf = createBuffer(ch, newLength, newSampleRate);

    for (var c = 0; c < ch; c++) {
      var src = audioBuffer.getChannelData(c);
      var dst = buf.getChannelData(c);

      for (var i = 0; i < newLength; i++) {
        var srcPos = i / ratio;
        var idx = Math.floor(srcPos);
        var frac = srcPos - idx;

        if (idx + 1 < src.length) {
          dst[i] = src[idx] * (1 - frac) + src[idx + 1] * frac;
        } else if (idx < src.length) {
          dst[i] = src[idx];
        }
      }
    }
    return buf;
  }

  function splitChannels(audioBuffer) {
    var result = [];
    for (var c = 0; c < audioBuffer.numberOfChannels; c++) {
      var mono = createBuffer(1, audioBuffer.length, audioBuffer.sampleRate);
      mono.copyToChannel(audioBuffer.getChannelData(c).slice(), 0);
      result.push(mono);
    }
    return result;
  }

  function mergeToStereo(leftBuffer, rightBuffer) {
    var length = Math.max(leftBuffer.length, rightBuffer.length);
    var sr = leftBuffer.sampleRate;
    var buf = createBuffer(2, length, sr);

    var leftData = leftBuffer.getChannelData(0);
    var rightData = rightBuffer.getChannelData(0);
    var dstL = buf.getChannelData(0);
    var dstR = buf.getChannelData(1);

    for (var i = 0; i < leftData.length; i++) {
      dstL[i] = leftData[i];
    }
    for (var j = 0; j < rightData.length; j++) {
      dstR[j] = rightData[j];
    }
    return buf;
  }

  // ─── Public API ───────────────────────────────────────────────────

  return {
    // Non-destructive
    cut: cut,
    copy: copy,
    paste: paste,
    trim: trim,
    silence: silence,

    // Processing
    reverse: reverse,
    normalize: normalize,
    fadeIn: fadeIn,
    fadeOut: fadeOut,
    crossfade: crossfade,
    gain: gain,
    invertPhase: invertPhase,

    // Time/pitch
    timeStretch: timeStretch,
    pitchShift: pitchShift,

    // Noise
    noiseProfile: noiseProfile,
    noiseReduction: noiseReduction,

    // Analysis
    detectSilence: detectSilence,
    getPeakLevel: getPeakLevel,
    getRMSLevel: getRMSLevel,
    getWaveformData: getWaveformData,

    // Utility
    createBuffer: createBuffer,
    duplicateBuffer: duplicateBuffer,
    mixBuffers: mixBuffers,
    convertSampleRate: convertSampleRate,
    splitChannels: splitChannels,
    mergeToStereo: mergeToStereo
  };
})();
