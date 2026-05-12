var DAW = DAW || {};

DAW.ExportEngine = (function () {
  'use strict';

  // ─── Utility helpers ──────────────────────────────────────────────

  function getContext() {
    return DAW.AudioEngine.getContext();
  }

  function clamp(val, min, max) {
    return val < min ? min : val > max ? max : val;
  }

  // ─── WAV Export ───────────────────────────────────────────────────

  function exportWAV(audioBuffer, bitDepth) {
    bitDepth = bitDepth || 16;
    if (bitDepth !== 16 && bitDepth !== 24) bitDepth = 16;

    var numChannels = audioBuffer.numberOfChannels;
    var sampleRate = audioBuffer.sampleRate;
    var numSamples = audioBuffer.length;
    var bytesPerSample = bitDepth / 8;
    var blockAlign = numChannels * bytesPerSample;
    var dataSize = numSamples * blockAlign;
    var headerSize = 44;
    var totalSize = headerSize + dataSize;

    var buffer = new ArrayBuffer(totalSize);
    var view = new DataView(buffer);

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, totalSize - 8, true);
    writeString(view, 8, 'WAVE');

    // fmt chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);              // chunk size
    view.setUint16(20, 1, true);               // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true); // byte rate
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);

    // data chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Interleave and write samples
    var channels = [];
    for (var c = 0; c < numChannels; c++) {
      channels.push(audioBuffer.getChannelData(c));
    }

    var offset = headerSize;
    if (bitDepth === 16) {
      for (var i = 0; i < numSamples; i++) {
        for (var ch = 0; ch < numChannels; ch++) {
          var sample = clamp(channels[ch][i], -1, 1);
          var int16 = sample < 0
            ? Math.max(-32768, Math.round(sample * 32768))
            : Math.min(32767, Math.round(sample * 32767));
          view.setInt16(offset, int16, true);
          offset += 2;
        }
      }
    } else {
      // 24-bit
      for (var i24 = 0; i24 < numSamples; i24++) {
        for (var ch24 = 0; ch24 < numChannels; ch24++) {
          var s24 = clamp(channels[ch24][i24], -1, 1);
          var int24 = s24 < 0
            ? Math.max(-8388608, Math.round(s24 * 8388608))
            : Math.min(8388607, Math.round(s24 * 8388607));
          view.setUint8(offset, int24 & 0xFF);
          view.setUint8(offset + 1, (int24 >> 8) & 0xFF);
          view.setUint8(offset + 2, (int24 >> 16) & 0xFF);
          offset += 3;
        }
      }
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  function writeString(view, offset, str) {
    for (var i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // ─── MP3 Export (stub - falls back to WAV) ────────────────────────

  function exportMP3(audioBuffer, bitrate) {
    console.warn(
      'DAW.ExportEngine.exportMP3: Native MP3 encoding is not available without ' +
      'a library (e.g. lamejs). Falling back to WAV export. Requested bitrate: ' +
      (bitrate || 128) + 'kbps'
    );
    return exportWAV(audioBuffer, 16);
  }

  // ─── STEM Export ──────────────────────────────────────────────────

  function exportSTEMs(tracks, options) {
    var opts = options || {};
    var bitDepth = opts.bitDepth || 16;
    var targetSampleRate = opts.sampleRate || 44100;
    var includeEffects = opts.includeEffects !== false;
    var includeSends = opts.includeSends !== false;

    var promises = [];

    for (var t = 0; t < tracks.length; t++) {
      (function (track) {
        var p = renderTrack(track, targetSampleRate, includeEffects, includeSends)
          .then(function (renderedBuffer) {
            var finalBuffer = renderedBuffer;
            if (renderedBuffer.sampleRate !== targetSampleRate && DAW.AudioEditor) {
              finalBuffer = DAW.AudioEditor.convertSampleRate(renderedBuffer, targetSampleRate);
            }
            return {
              name: (track.name || 'Track') + '.wav',
              blob: exportWAV(finalBuffer, bitDepth)
            };
          });
        promises.push(p);
      })(tracks[t]);
    }

    return Promise.all(promises);
  }

  function renderTrack(track, sampleRate, includeEffects, includeSends) {
    // Gather clips for this track
    var clips = [];
    if (DAW.Clip) {
      clips = DAW.Clip.getClipsForTrack(track.id);
    }

    // Calculate duration from clips
    var duration = 0;
    for (var i = 0; i < clips.length; i++) {
      var clipEnd = clips[i].startTime + clips[i].duration;
      if (clipEnd > duration) duration = clipEnd;
    }
    if (duration <= 0) duration = 1;

    var numSamples = Math.ceil(duration * sampleRate);
    var offlineCtx = new OfflineAudioContext(2, numSamples, sampleRate);

    // Place audio clips
    for (var c = 0; c < clips.length; c++) {
      var clip = clips[c];
      if (clip.type === 'audio' && clip.audioBuffer) {
        var source = offlineCtx.createBufferSource();
        source.buffer = clip.audioBuffer;

        var clipGain = offlineCtx.createGain();
        clipGain.gain.value = typeof clip.gain === 'number' ? clip.gain : 1.0;

        source.connect(clipGain);
        clipGain.connect(offlineCtx.destination);

        var startTime = Math.max(0, clip.startTime);
        var offset = clip.offset || 0;
        source.start(startTime, offset, clip.duration);
      }
    }

    // Apply track volume
    // Note: this is a simplified rendering; full effect chains would need
    // recreating effects in the OfflineAudioContext

    return offlineCtx.startRendering();
  }

  // ─── MIDI Export ──────────────────────────────────────────────────

  function exportMIDI(midiClips) {
    var ppq = 480;
    if (DAW.Transport && DAW.Transport.PPQ) {
      ppq = DAW.Transport.PPQ;
    }

    var bpm = 120;
    if (DAW.Transport && DAW.Transport.getBPM) {
      bpm = DAW.Transport.getBPM();
    }

    // Build track data
    var trackChunks = [];

    // Track 0: tempo map
    var tempoTrack = [];
    addTempoEvent(tempoTrack, 0, bpm);
    addEndOfTrack(tempoTrack, 0);
    trackChunks.push(buildTrackChunk(tempoTrack));

    // One track per MIDI clip
    for (var c = 0; c < midiClips.length; c++) {
      var clip = midiClips[c];
      var events = [];
      var notes = clip.notes || [];

      // Sort notes by start time
      var sorted = notes.slice().sort(function (a, b) {
        return a.start - b.start;
      });

      // Build note on/off events
      var noteEvents = [];
      for (var n = 0; n < sorted.length; n++) {
        var note = sorted[n];
        var startTick = secondsToTicks(note.start, bpm, ppq);
        var endTick = secondsToTicks(note.start + note.duration, bpm, ppq);
        var channel = note.channel || 0;
        var velocity = clamp(note.velocity || 100, 1, 127);
        var pitch = clamp(note.pitch, 0, 127);

        noteEvents.push({
          tick: startTick,
          type: 'noteOn',
          channel: channel,
          pitch: pitch,
          velocity: velocity
        });
        noteEvents.push({
          tick: endTick,
          type: 'noteOff',
          channel: channel,
          pitch: pitch,
          velocity: 0
        });
      }

      // Sort all events by tick
      noteEvents.sort(function (a, b) {
        if (a.tick !== b.tick) return a.tick - b.tick;
        // noteOff before noteOn at same tick
        if (a.type === 'noteOff' && b.type === 'noteOn') return -1;
        if (a.type === 'noteOn' && b.type === 'noteOff') return 1;
        return 0;
      });

      // Convert to delta-time events
      var currentTick = 0;
      for (var e = 0; e < noteEvents.length; e++) {
        var evt = noteEvents[e];
        var delta = evt.tick - currentTick;
        if (delta < 0) delta = 0;
        currentTick = evt.tick;

        if (evt.type === 'noteOn') {
          events.push({
            delta: delta,
            data: [0x90 | (evt.channel & 0x0F), evt.pitch, evt.velocity]
          });
        } else {
          events.push({
            delta: delta,
            data: [0x80 | (evt.channel & 0x0F), evt.pitch, 0]
          });
        }
      }

      addEndOfTrack(events, 0);
      trackChunks.push(buildTrackChunk(events));
    }

    // Build header chunk (MThd)
    var numTracks = trackChunks.length;
    var headerSize = 14;
    var totalChunkSize = 0;
    for (var tc = 0; tc < trackChunks.length; tc++) {
      totalChunkSize += trackChunks[tc].length;
    }

    var midiData = new Uint8Array(headerSize + totalChunkSize);
    var pos = 0;

    // MThd
    midiData[pos++] = 0x4D; // M
    midiData[pos++] = 0x54; // T
    midiData[pos++] = 0x68; // h
    midiData[pos++] = 0x64; // d
    // Header length: 6
    midiData[pos++] = 0; midiData[pos++] = 0;
    midiData[pos++] = 0; midiData[pos++] = 6;
    // Format 1
    midiData[pos++] = 0; midiData[pos++] = 1;
    // Number of tracks
    midiData[pos++] = (numTracks >> 8) & 0xFF;
    midiData[pos++] = numTracks & 0xFF;
    // PPQ (ticks per quarter note)
    midiData[pos++] = (ppq >> 8) & 0xFF;
    midiData[pos++] = ppq & 0xFF;

    // Append track chunks
    for (var ti = 0; ti < trackChunks.length; ti++) {
      var chunk = trackChunks[ti];
      for (var ci = 0; ci < chunk.length; ci++) {
        midiData[pos++] = chunk[ci];
      }
    }

    return new Blob([midiData], { type: 'audio/midi' });
  }

  function secondsToTicks(seconds, bpm, ppq) {
    var ticksPerSecond = (bpm / 60) * ppq;
    return Math.round(seconds * ticksPerSecond);
  }

  function addTempoEvent(events, delta, bpm) {
    var microsecondsPerBeat = Math.round(60000000 / bpm);
    events.push({
      delta: delta,
      data: [
        0xFF, 0x51, 0x03,
        (microsecondsPerBeat >> 16) & 0xFF,
        (microsecondsPerBeat >> 8) & 0xFF,
        microsecondsPerBeat & 0xFF
      ]
    });
  }

  function addEndOfTrack(events, delta) {
    events.push({
      delta: delta,
      data: [0xFF, 0x2F, 0x00]
    });
  }

  function writeVariableLength(value) {
    var bytes = [];
    var v = value & 0x7F;
    bytes.unshift(v);
    value >>= 7;
    while (value > 0) {
      v = (value & 0x7F) | 0x80;
      bytes.unshift(v);
      value >>= 7;
    }
    return bytes;
  }

  function buildTrackChunk(events) {
    // Calculate raw event data
    var eventBytes = [];
    for (var i = 0; i < events.length; i++) {
      var deltaBytes = writeVariableLength(events[i].delta);
      for (var d = 0; d < deltaBytes.length; d++) {
        eventBytes.push(deltaBytes[d]);
      }
      for (var b = 0; b < events[i].data.length; b++) {
        eventBytes.push(events[i].data[b]);
      }
    }

    var chunkLength = eventBytes.length;
    var chunk = new Uint8Array(8 + chunkLength);
    // MTrk
    chunk[0] = 0x4D; // M
    chunk[1] = 0x54; // T
    chunk[2] = 0x72; // r
    chunk[3] = 0x6B; // k
    // Length
    chunk[4] = (chunkLength >> 24) & 0xFF;
    chunk[5] = (chunkLength >> 16) & 0xFF;
    chunk[6] = (chunkLength >> 8) & 0xFF;
    chunk[7] = chunkLength & 0xFF;
    // Event data
    for (var e = 0; e < eventBytes.length; e++) {
      chunk[8 + e] = eventBytes[e];
    }

    return chunk;
  }

  // ─── Offline Rendering ────────────────────────────────────────────

  function renderMix(tracks, duration, sampleRate, progressCallback) {
    sampleRate = sampleRate || 44100;
    if (duration <= 0) duration = 1;

    var numSamples = Math.ceil(duration * sampleRate);
    var offlineCtx = new OfflineAudioContext(2, numSamples, sampleRate);

    // Master gain
    var masterGain = offlineCtx.createGain();
    masterGain.connect(offlineCtx.destination);

    var trackCount = tracks.length;
    var tracksProcessed = 0;

    for (var t = 0; t < trackCount; t++) {
      var track = tracks[t];
      if (track.type === 'master') continue;
      if (track.mute) continue;

      // Check solo state
      var anySoloed = false;
      for (var s = 0; s < tracks.length; s++) {
        if (tracks[s].solo) { anySoloed = true; break; }
      }
      if (anySoloed && !track.solo) continue;

      var trackGain = offlineCtx.createGain();
      trackGain.gain.value = typeof track.volume === 'number' ? track.volume : 1.0;
      trackGain.connect(masterGain);

      // Get clips
      var clips = [];
      if (DAW.Clip) {
        clips = DAW.Clip.getClipsForTrack(track.id);
      }

      for (var ci = 0; ci < clips.length; ci++) {
        var clip = clips[ci];
        if (clip.type === 'audio' && clip.audioBuffer) {
          var source = offlineCtx.createBufferSource();
          source.buffer = clip.audioBuffer;

          var clipGain = offlineCtx.createGain();
          clipGain.gain.value = typeof clip.gain === 'number' ? clip.gain : 1.0;

          source.connect(clipGain);
          clipGain.connect(trackGain);

          var startAt = Math.max(0, clip.startTime);
          var clipOffset = clip.offset || 0;
          source.start(startAt, clipOffset, clip.duration);
        }
      }

      tracksProcessed++;
      if (progressCallback) {
        progressCallback(tracksProcessed / trackCount);
      }
    }

    return offlineCtx.startRendering();
  }

  // ─── Download helpers ─────────────────────────────────────────────

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  function downloadAll(files) {
    for (var i = 0; i < files.length; i++) {
      (function (idx) {
        setTimeout(function () {
          download(files[idx].blob, files[idx].name);
        }, idx * 200);
      })(i);
    }
  }

  // ─── Project Save/Load ────────────────────────────────────────────

  function audioBufferToBase64WAV(audioBuffer) {
    var wavBlob = exportWAV(audioBuffer, 16);
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onloadend = function () {
        resolve(reader.result.split(',')[1]); // strip data URL prefix
      };
      reader.readAsDataURL(wavBlob);
    });
  }

  function base64WAVToAudioBuffer(base64) {
    var binaryStr = atob(base64);
    var len = binaryStr.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return getContext().decodeAudioData(bytes.buffer);
  }

  function exportProject() {
    var project = {
      version: 1,
      timestamp: Date.now(),
      transport: {},
      tracks: [],
      clips: [],
      audioBuffers: {}
    };

    // Transport state
    if (DAW.Transport) {
      project.transport = {
        bpm: DAW.Transport.getBPM(),
        timeSignature: DAW.Transport.getTimeSignature(),
        loopRegion: DAW.Transport.getLoopRegion(),
        metronomeEnabled: DAW.Transport.getMetronomeEnabled(),
        countIn: DAW.Transport.getCountIn()
      };
    }

    // Tracks
    if (DAW.TrackManager) {
      var tracks = DAW.TrackManager.getTracks();
      for (var t = 0; t < tracks.length; t++) {
        var track = tracks[t];
        project.tracks.push({
          id: track.id,
          name: track.name,
          type: track.type,
          color: track.color,
          mute: track.mute,
          solo: track.solo,
          armed: track.armed,
          volume: track.volume,
          pan: track.pan,
          effects: track.effects,
          sends: track.sends,
          output: track.output,
          height: track.height,
          collapsed: track.collapsed,
          frozen: track.frozen,
          parentId: track.parentId
        });
      }
    }

    // Clips and audio buffers (collect promises for base64 conversion)
    var bufferPromises = [];
    var bufferIds = {};

    if (DAW.Clip) {
      var allClips = DAW.Clip.getAllClips();
      for (var c = 0; c < allClips.length; c++) {
        var clip = allClips[c];
        var clipData = {
          id: clip.id,
          type: clip.type,
          trackId: clip.trackId,
          startTime: clip.startTime,
          duration: clip.duration,
          name: clip.name,
          color: clip.color,
          looped: clip.looped
        };

        if (clip.type === 'audio') {
          clipData.offset = clip.offset;
          clipData.gain = clip.gain;
          clipData.fadeIn = clip.fadeIn;
          clipData.fadeOut = clip.fadeOut;
          clipData.reversed = clip.reversed;
          clipData.playbackRate = clip.playbackRate;

          if (clip.audioBuffer) {
            var bufferId = 'buffer_' + c;
            clipData.audioBufferId = bufferId;
            if (!bufferIds[bufferId]) {
              bufferIds[bufferId] = true;
              (function (bid, ab) {
                bufferPromises.push(
                  audioBufferToBase64WAV(ab).then(function (b64) {
                    project.audioBuffers[bid] = b64;
                  })
                );
              })(bufferId, clip.audioBuffer);
            }
          }
        } else if (clip.type === 'midi') {
          clipData.notes = clip.notes;
        }

        project.clips.push(clipData);
      }
    }

    return Promise.all(bufferPromises).then(function () {
      return JSON.stringify(project);
    });
  }

  function importProject(jsonString) {
    var project = JSON.parse(jsonString);

    // Restore transport
    if (DAW.Transport && project.transport) {
      if (project.transport.bpm) {
        DAW.Transport.setBPM(project.transport.bpm);
      }
      if (project.transport.timeSignature) {
        DAW.Transport.setTimeSignature(
          project.transport.timeSignature.numerator,
          project.transport.timeSignature.denominator
        );
      }
      if (project.transport.loopRegion) {
        DAW.Transport.setLoopRegion(
          project.transport.loopRegion.start,
          project.transport.loopRegion.end,
          project.transport.loopRegion.enabled
        );
      }
      if (typeof project.transport.metronomeEnabled === 'boolean') {
        DAW.Transport.setMetronome(project.transport.metronomeEnabled);
      }
      if (typeof project.transport.countIn === 'number') {
        DAW.Transport.setCountIn(project.transport.countIn);
      }
    }

    // Decode audio buffers
    var bufferDecodePromises = [];
    var decodedBuffers = {};
    var bufferKeys = Object.keys(project.audioBuffers || {});

    for (var b = 0; b < bufferKeys.length; b++) {
      (function (key) {
        var p = base64WAVToAudioBuffer(project.audioBuffers[key])
          .then(function (buf) {
            decodedBuffers[key] = buf;
          });
        bufferDecodePromises.push(p);
      })(bufferKeys[b]);
    }

    return Promise.all(bufferDecodePromises).then(function () {
      // Restore tracks
      if (DAW.TrackManager && project.tracks) {
        for (var t = 0; t < project.tracks.length; t++) {
          var trackData = project.tracks[t];
          if (trackData.type === 'master') continue;

          var track = DAW.TrackManager.createTrack(trackData.type, trackData.name);
          if (trackData.color) DAW.TrackManager.setTrackProperty(track.id, 'color', trackData.color);
          if (typeof trackData.volume === 'number') DAW.TrackManager.setTrackProperty(track.id, 'volume', trackData.volume);
          if (typeof trackData.pan === 'number') DAW.TrackManager.setTrackProperty(track.id, 'pan', trackData.pan);
          if (typeof trackData.mute === 'boolean') DAW.TrackManager.setTrackProperty(track.id, 'mute', trackData.mute);
          if (typeof trackData.solo === 'boolean') DAW.TrackManager.setTrackProperty(track.id, 'solo', trackData.solo);
          if (typeof trackData.height === 'number') DAW.TrackManager.setTrackProperty(track.id, 'height', trackData.height);
        }
      }

      // Restore clips
      if (DAW.Clip && project.clips) {
        for (var c = 0; c < project.clips.length; c++) {
          var clipData = project.clips[c];
          if (clipData.type === 'audio') {
            var ab = clipData.audioBufferId ? decodedBuffers[clipData.audioBufferId] : null;
            DAW.Clip.createAudioClip(clipData.trackId, clipData.startTime, ab, {
              duration: clipData.duration,
              offset: clipData.offset,
              gain: clipData.gain,
              fadeIn: clipData.fadeIn,
              fadeOut: clipData.fadeOut,
              color: clipData.color,
              name: clipData.name,
              reversed: clipData.reversed,
              playbackRate: clipData.playbackRate,
              looped: clipData.looped
            });
          } else if (clipData.type === 'midi') {
            var midiClip = DAW.Clip.createMIDIClip(
              clipData.trackId,
              clipData.startTime,
              clipData.duration
            );
            midiClip.name = clipData.name || 'MIDI Clip';
            midiClip.color = clipData.color || '#2ECC71';
            if (clipData.notes) {
              for (var n = 0; n < clipData.notes.length; n++) {
                DAW.Clip.addNote(midiClip.id, clipData.notes[n]);
              }
            }
          }
        }
      }

      return project;
    });
  }

  // ─── Public API ───────────────────────────────────────────────────

  return {
    // WAV
    exportWAV: exportWAV,

    // MP3 (stub)
    exportMP3: exportMP3,

    // STEMs
    exportSTEMs: exportSTEMs,

    // MIDI
    exportMIDI: exportMIDI,

    // Offline rendering
    renderMix: renderMix,

    // Download helpers
    download: download,
    downloadAll: downloadAll,

    // Project save/load
    exportProject: exportProject,
    importProject: importProject
  };
})();
