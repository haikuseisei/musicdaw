var DAW = DAW || {};

DAW.ChordDetector = (function () {
  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  var CHORD_TEMPLATES = {};
  var MAJOR = [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0];
  var MINOR = [1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0];
  var DOM7  = [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  var MIN7  = [1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0];

  function rotate(arr, n) {
    var len = arr.length;
    n = ((n % len) + len) % len;
    return arr.slice(len - n).concat(arr.slice(0, len - n));
  }

  NOTE_NAMES.forEach(function (name, i) {
    CHORD_TEMPLATES[name]        = rotate(MAJOR, i);
    CHORD_TEMPLATES[name + 'm']  = rotate(MINOR, i);
    CHORD_TEMPLATES[name + '7']  = rotate(DOM7, i);
    CHORD_TEMPLATES[name + 'm7'] = rotate(MIN7, i);
  });

  function cosineSimilarity(a, b) {
    var dotProduct = 0, normA = 0, normB = 0;
    for (var i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  function frequencyToNoteIndex(freq) {
    if (freq <= 0) return -1;
    var noteNum = 12 * Math.log2(freq / 440) + 69;
    return Math.round(noteNum) % 12;
  }

  function computeChromagram(fftData, sampleRate, fftSize) {
    var chroma = new Float32Array(12);
    var binFreq = sampleRate / fftSize;

    for (var i = 1; i < fftData.length; i++) {
      var freq = i * binFreq;
      if (freq < 65 || freq > 2000) continue;
      var noteIdx = frequencyToNoteIndex(freq);
      if (noteIdx >= 0 && noteIdx < 12) {
        var magnitude = fftData[i];
        var linear = Math.pow(10, magnitude / 20);
        chroma[noteIdx] += linear * linear;
      }
    }

    var maxVal = 0;
    for (var j = 0; j < 12; j++) {
      if (chroma[j] > maxVal) maxVal = chroma[j];
    }
    if (maxVal > 0) {
      for (var k = 0; k < 12; k++) {
        chroma[k] /= maxVal;
      }
    }

    return chroma;
  }

  function identifyChord(chroma) {
    var bestChord = 'N';
    var bestScore = 0.5;

    var keys = Object.keys(CHORD_TEMPLATES);
    for (var i = 0; i < keys.length; i++) {
      var name = keys[i];
      var score = cosineSimilarity(Array.from(chroma), CHORD_TEMPLATES[name]);
      if (score > bestScore) {
        bestScore = score;
        bestChord = name;
      }
    }
    return { chord: bestChord, confidence: bestScore };
  }

  function analyze(audioBuffer, windowSizeSeconds) {
    windowSizeSeconds = windowSizeSeconds || 0.5;
    var ac = DAW.AudioEngine.getContext();
    var sampleRate = audioBuffer.sampleRate;
    var channelData = audioBuffer.getChannelData(0);
    var totalSamples = channelData.length;

    var fftSize = 4096;
    var windowSamples = Math.floor(windowSizeSeconds * sampleRate);
    var hopSamples = Math.floor(windowSamples / 2);

    var offlineCtx = new OfflineAudioContext(1, totalSamples, sampleRate);
    var analyserNode = offlineCtx.createAnalyser();
    analyserNode.fftSize = fftSize;
    analyserNode.smoothingTimeConstant = 0;

    var chords = [];
    var position = 0;

    while (position + windowSamples <= totalSamples) {
      var windowData = channelData.slice(position, position + windowSamples);

      var tempCtx = new OfflineAudioContext(1, windowSamples, sampleRate);
      var tempBuffer = tempCtx.createBuffer(1, windowSamples, sampleRate);
      tempBuffer.getChannelData(0).set(windowData);

      var fft = new Float32Array(fftSize / 2);
      performFFT(windowData, fft, sampleRate, fftSize);
      var chroma = computeChromagramFromFFT(fft, sampleRate, fftSize);
      var result = identifyChord(chroma);

      chords.push({
        time: position / sampleRate,
        duration: windowSizeSeconds,
        chord: result.chord,
        confidence: result.confidence
      });

      position += hopSamples;
    }

    return consolidateChords(chords);
  }

  function performFFT(samples, output, sampleRate, fftSize) {
    var n = Math.min(samples.length, fftSize);
    var real = new Float32Array(fftSize);
    var imag = new Float32Array(fftSize);

    for (var i = 0; i < n; i++) {
      var window = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
      real[i] = samples[i] * window;
    }

    fftInPlace(real, imag, fftSize);

    for (var k = 0; k < fftSize / 2; k++) {
      var magnitude = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]);
      output[k] = magnitude > 0 ? 20 * Math.log10(magnitude) : -100;
    }
  }

  function fftInPlace(real, imag, n) {
    var bits = Math.log2(n);
    for (var i = 0; i < n; i++) {
      var j = reverseBits(i, bits);
      if (j > i) {
        var tmpR = real[i]; real[i] = real[j]; real[j] = tmpR;
        var tmpI = imag[i]; imag[i] = imag[j]; imag[j] = tmpI;
      }
    }
    for (var size = 2; size <= n; size *= 2) {
      var half = size / 2;
      var angle = -2 * Math.PI / size;
      for (var idx = 0; idx < n; idx += size) {
        for (var k = 0; k < half; k++) {
          var wR = Math.cos(angle * k);
          var wI = Math.sin(angle * k);
          var eR = real[idx + k];
          var eI = imag[idx + k];
          var oR = real[idx + k + half] * wR - imag[idx + k + half] * wI;
          var oI = real[idx + k + half] * wI + imag[idx + k + half] * wR;
          real[idx + k] = eR + oR;
          imag[idx + k] = eI + oI;
          real[idx + k + half] = eR - oR;
          imag[idx + k + half] = eI - oI;
        }
      }
    }
  }

  function reverseBits(val, bits) {
    var result = 0;
    for (var i = 0; i < bits; i++) {
      result = (result << 1) | (val & 1);
      val >>= 1;
    }
    return result;
  }

  function computeChromagramFromFFT(fftData, sampleRate, fftSize) {
    return computeChromagram(fftData, sampleRate, fftSize);
  }

  function consolidateChords(rawChords) {
    if (rawChords.length === 0) return [];
    var result = [];
    var current = {
      time: rawChords[0].time,
      chord: rawChords[0].chord,
      duration: rawChords[0].duration,
      confidence: rawChords[0].confidence
    };

    for (var i = 1; i < rawChords.length; i++) {
      if (rawChords[i].chord === current.chord) {
        current.duration = (rawChords[i].time + rawChords[i].duration) - current.time;
        current.confidence = Math.max(current.confidence, rawChords[i].confidence);
      } else {
        current.duration = rawChords[i].time - current.time;
        result.push(current);
        current = {
          time: rawChords[i].time,
          chord: rawChords[i].chord,
          duration: rawChords[i].duration,
          confidence: rawChords[i].confidence
        };
      }
    }
    result.push(current);
    return result;
  }

  function estimateTempo(audioBuffer) {
    var channelData = audioBuffer.getChannelData(0);
    var sampleRate = audioBuffer.sampleRate;

    var windowSize = Math.floor(sampleRate * 0.01);
    var hopSize = Math.floor(windowSize / 2);
    var energy = [];

    for (var i = 0; i + windowSize < channelData.length; i += hopSize) {
      var sum = 0;
      for (var j = 0; j < windowSize; j++) {
        sum += channelData[i + j] * channelData[i + j];
      }
      energy.push(sum / windowSize);
    }

    var diff = [];
    for (var k = 1; k < energy.length; k++) {
      diff.push(Math.max(0, energy[k] - energy[k - 1]));
    }

    var hopSec = hopSize / sampleRate;
    var minBPM = 70, maxBPM = 180;
    var bestBPM = 120, bestCorr = 0;

    for (var bpm = minBPM; bpm <= maxBPM; bpm++) {
      var beatInterval = Math.round(60 / (bpm * hopSec));
      if (beatInterval >= diff.length) continue;
      var corr = 0;
      var count = 0;
      for (var m = 0; m + beatInterval < diff.length; m++) {
        corr += diff[m] * diff[m + beatInterval];
        count++;
      }
      if (count > 0) corr /= count;
      if (corr > bestCorr) {
        bestCorr = corr;
        bestBPM = bpm;
      }
    }

    return bestBPM;
  }

  return {
    analyze: analyze,
    estimateTempo: estimateTempo
  };
})();
