var DAW = DAW || {};

DAW.Recorder = (function () {
  'use strict';

  var ac = null;
  var isRecording = false;
  var armedTracks = {};
  var recordingState = null;
  var takes = {};
  var takeIdCounter = 0;
  var latencyCompensationSamples = 0;
  var inputDeviceId = null;
  var inputMonitoringEnabled = false;
  var punchRange = null;
  var punchEnabled = false;
  var loopRecordingEnabled = false;
  var loopRange = null;

  // ─── Utility ────────────────────────────────────────────────────────

  function clamp(val, min, max) {
    return val < min ? min : val > max ? max : val;
  }

  function getAudioContext() {
    if (!ac) {
      ac = DAW.AudioEngine ? DAW.AudioEngine.getContext() : null;
    }
    return ac;
  }

  function generateId() {
    return 'take_' + (++takeIdCounter) + '_' + Date.now();
  }

  // ─── Input Device Selection ─────────────────────────────────────────

  function enumerateInputDevices() {
    return navigator.mediaDevices.enumerateDevices().then(function (devices) {
      var audioInputs = [];
      for (var i = 0; i < devices.length; i++) {
        if (devices[i].kind === 'audioinput') {
          audioInputs.push({
            deviceId: devices[i].deviceId,
            label: devices[i].label || ('Input ' + (audioInputs.length + 1)),
            groupId: devices[i].groupId
          });
        }
      }
      return audioInputs;
    });
  }

  function selectInputDevice(deviceId) {
    inputDeviceId = deviceId;
  }

  function getMediaConstraints() {
    var constraints = {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    };
    if (inputDeviceId) {
      constraints.audio.deviceId = { exact: inputDeviceId };
    }
    return constraints;
  }

  // ─── Latency Compensation ──────────────────────────────────────────

  function setLatencyCompensation(samples) {
    latencyCompensationSamples = Math.max(0, Math.floor(samples));
  }

  function getLatencyCompensation() {
    return latencyCompensationSamples;
  }

  function measureInputLatency() {
    var context = getAudioContext();
    if (!context) return Promise.resolve(0);

    // Use baseLatency and outputLatency if available
    var baseLatency = context.baseLatency || 0;
    var outputLatency = context.outputLatency || 0;
    var totalLatency = baseLatency + outputLatency;
    var samples = Math.round(totalLatency * context.sampleRate);

    return Promise.resolve({
      latencySeconds: totalLatency,
      latencySamples: samples,
      baseLatency: baseLatency,
      outputLatency: outputLatency
    });
  }

  function applyLatencyCompensation(audioBuffer) {
    if (latencyCompensationSamples <= 0 || !audioBuffer) return audioBuffer;

    var context = getAudioContext();
    var sampleRate = audioBuffer.sampleRate;
    var numChannels = audioBuffer.numberOfChannels;
    var originalLength = audioBuffer.length;
    var offset = Math.min(latencyCompensationSamples, originalLength);
    var newLength = originalLength - offset;

    if (newLength <= 0) return audioBuffer;

    var newBuffer = context.createBuffer(numChannels, newLength, sampleRate);
    for (var ch = 0; ch < numChannels; ch++) {
      var oldData = audioBuffer.getChannelData(ch);
      var newData = newBuffer.getChannelData(ch);
      for (var i = 0; i < newLength; i++) {
        newData[i] = oldData[i + offset];
      }
    }
    return newBuffer;
  }

  // ─── Input Monitoring ──────────────────────────────────────────────

  function setInputMonitoring(enabled) {
    inputMonitoringEnabled = !!enabled;
    if (recordingState && recordingState.monitorGain) {
      recordingState.monitorGain.gain.value = inputMonitoringEnabled ? 1 : 0;
    }
  }

  function getInputMonitoring() {
    return inputMonitoringEnabled;
  }

  // ─── Punch In/Out ──────────────────────────────────────────────────

  function setPunchRange(startTime, endTime) {
    if (startTime >= 0 && endTime > startTime) {
      punchRange = { start: startTime, end: endTime };
    }
  }

  function clearPunchRange() {
    punchRange = null;
  }

  function enablePunch(state) {
    punchEnabled = (state !== undefined) ? !!state : !punchEnabled;
    return punchEnabled;
  }

  function isPunchEnabled() {
    return punchEnabled && punchRange !== null;
  }

  // ─── Loop Recording ────────────────────────────────────────────────

  function enableLoopRecording(state) {
    loopRecordingEnabled = (state !== undefined) ? !!state : !loopRecordingEnabled;
    return loopRecordingEnabled;
  }

  function setLoopRange(startTime, endTime) {
    if (startTime >= 0 && endTime > startTime) {
      loopRange = { start: startTime, end: endTime };
    }
  }

  function clearLoopRange() {
    loopRange = null;
  }

  // ─── PCM Capture via ScriptProcessor ────────────────────────────────

  function createPCMCapture(context, channelCount) {
    var bufferSize = 4096;
    var capturedChunks = [];
    var totalSamples = 0;
    var capturing = false;

    // Use ScriptProcessorNode for raw PCM capture
    var processor = context.createScriptProcessor(bufferSize, channelCount, channelCount);

    processor.onaudioprocess = function (e) {
      if (!capturing) return;

      var chunk = [];
      for (var ch = 0; ch < channelCount; ch++) {
        var inputData = e.inputBuffer.getChannelData(ch);
        var copy = new Float32Array(inputData.length);
        copy.set(inputData);
        chunk.push(copy);
      }
      capturedChunks.push(chunk);
      totalSamples += bufferSize;
    };

    return {
      node: processor,
      start: function () {
        capturedChunks = [];
        totalSamples = 0;
        capturing = true;
      },
      stop: function () {
        capturing = false;
      },
      getBuffer: function () {
        if (capturedChunks.length === 0) return null;

        var numChannels = capturedChunks[0].length;
        var buffer = context.createBuffer(numChannels, totalSamples, context.sampleRate);

        for (var ch = 0; ch < numChannels; ch++) {
          var channelData = buffer.getChannelData(ch);
          var offset = 0;
          for (var i = 0; i < capturedChunks.length; i++) {
            channelData.set(capturedChunks[i][ch], offset);
            offset += capturedChunks[i][ch].length;
          }
        }
        return buffer;
      },
      clear: function () {
        capturedChunks = [];
        totalSamples = 0;
      }
    };
  }

  // ─── Arm / Disarm Tracks ───────────────────────────────────────────

  function armTrack(trackId) {
    armedTracks[trackId] = true;
  }

  function disarmTrack(trackId) {
    delete armedTracks[trackId];
  }

  function isTrackArmed(trackId) {
    return !!armedTracks[trackId];
  }

  function getArmedTracks() {
    return Object.keys(armedTracks);
  }

  // ─── Start / Stop Recording ────────────────────────────────────────

  function startRecording(armedTrackIds) {
    if (isRecording) {
      return Promise.reject(new Error('Already recording'));
    }

    var context = getAudioContext();
    if (!context) {
      return Promise.reject(new Error('No AudioContext available'));
    }

    // Use provided track IDs or currently armed tracks
    var trackIds = armedTrackIds || getArmedTracks();
    if (trackIds.length === 0) {
      return Promise.reject(new Error('No tracks armed for recording'));
    }

    var constraints = getMediaConstraints();

    return navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
      var sourceNode = context.createMediaStreamSource(stream);
      var splitter = context.createChannelSplitter(sourceNode.channelCount);
      sourceNode.connect(splitter);

      // Monitor node
      var monitorGain = context.createGain();
      monitorGain.gain.value = inputMonitoringEnabled ? 1 : 0;
      sourceNode.connect(monitorGain);
      monitorGain.connect(context.destination);

      // Create a PCM capture for each track
      var trackCaptures = {};
      var channelCount = Math.min(sourceNode.channelCount, 2);

      for (var i = 0; i < trackIds.length; i++) {
        var trackId = trackIds[i];
        var capture = createPCMCapture(context, channelCount);

        // Connect source -> capture processor -> (silent) destination
        sourceNode.connect(capture.node);
        // ScriptProcessorNode needs to be connected to destination to process
        var silentGain = context.createGain();
        silentGain.gain.value = 0;
        capture.node.connect(silentGain);
        silentGain.connect(context.destination);

        capture.start();
        trackCaptures[trackId] = {
          capture: capture,
          silentGain: silentGain
        };
      }

      var startTime = context.currentTime;

      recordingState = {
        stream: stream,
        sourceNode: sourceNode,
        splitter: splitter,
        monitorGain: monitorGain,
        trackCaptures: trackCaptures,
        trackIds: trackIds.slice(),
        startTime: startTime,
        loopPassCount: 0,
        loopTakes: {}
      };

      isRecording = true;

      // If loop recording is enabled, set up loop pass tracking
      if (loopRecordingEnabled && loopRange) {
        for (var j = 0; j < trackIds.length; j++) {
          recordingState.loopTakes[trackIds[j]] = [];
        }
        startLoopWatcher();
      }

      return recordingState;
    });
  }

  function startLoopWatcher() {
    if (!recordingState || !loopRecordingEnabled || !loopRange) return;

    var context = getAudioContext();
    var loopDuration = loopRange.end - loopRange.start;

    recordingState._loopInterval = setInterval(function () {
      if (!isRecording || !recordingState) {
        clearInterval(recordingState._loopInterval);
        return;
      }

      var elapsed = context.currentTime - recordingState.startTime;
      var currentPass = Math.floor(elapsed / loopDuration);

      if (currentPass > recordingState.loopPassCount) {
        // Save current pass as a take, start new capture
        saveLoopPass();
        recordingState.loopPassCount = currentPass;
      }
    }, 50);
  }

  function saveLoopPass() {
    if (!recordingState) return;

    var trackIds = recordingState.trackIds;
    var context = getAudioContext();

    for (var i = 0; i < trackIds.length; i++) {
      var trackId = trackIds[i];
      var captureInfo = recordingState.trackCaptures[trackId];
      if (!captureInfo) continue;

      var buffer = captureInfo.capture.getBuffer();
      if (buffer) {
        buffer = applyLatencyCompensation(buffer);

        var takeId = generateId();
        var take = {
          id: takeId,
          trackId: trackId,
          audioBuffer: buffer,
          passNumber: recordingState.loopPassCount,
          startTime: loopRange.start,
          duration: buffer.duration,
          selected: false,
          timestamp: Date.now()
        };

        if (!takes[trackId]) takes[trackId] = {};
        var position = loopRange.start.toFixed(3);
        if (!takes[trackId][position]) takes[trackId][position] = [];
        takes[trackId][position].push(take);

        if (recordingState.loopTakes[trackId]) {
          recordingState.loopTakes[trackId].push(take);
        }
      }

      // Reset capture for next pass
      captureInfo.capture.clear();
      captureInfo.capture.start();
    }
  }

  function stopRecording() {
    if (!isRecording || !recordingState) {
      return Promise.resolve([]);
    }

    isRecording = false;

    // Clear loop watcher
    if (recordingState._loopInterval) {
      clearInterval(recordingState._loopInterval);
    }

    // If in loop mode, save the final partial pass
    if (loopRecordingEnabled && loopRange) {
      saveLoopPass();
    }

    var context = getAudioContext();
    var results = [];
    var trackIds = recordingState.trackIds;

    for (var i = 0; i < trackIds.length; i++) {
      var trackId = trackIds[i];
      var captureInfo = recordingState.trackCaptures[trackId];
      if (!captureInfo) continue;

      captureInfo.capture.stop();
      var buffer = captureInfo.capture.getBuffer();

      if (buffer) {
        buffer = applyLatencyCompensation(buffer);

        // Apply punch range if enabled
        if (punchEnabled && punchRange) {
          buffer = applyPunchRange(buffer, recordingState.startTime);
        }

        var result = {
          trackId: trackId,
          audioBuffer: buffer,
          startTime: recordingState.startTime,
          duration: buffer.duration
        };

        // Create audio clip if DAW.Clip is available
        if (DAW.Clip && DAW.Clip.createAudioClip) {
          result.clip = DAW.Clip.createAudioClip({
            trackId: trackId,
            buffer: buffer,
            startTime: recordingState.startTime,
            duration: buffer.duration
          });
        }

        results.push(result);

        // Store as take
        var takeId = generateId();
        var take = {
          id: takeId,
          trackId: trackId,
          audioBuffer: buffer,
          startTime: recordingState.startTime,
          duration: buffer.duration,
          selected: true,
          timestamp: Date.now()
        };

        if (!takes[trackId]) takes[trackId] = {};
        var position = recordingState.startTime.toFixed(3);
        if (!takes[trackId][position]) takes[trackId][position] = [];
        takes[trackId][position].push(take);
      }

      // Clean up capture nodes
      try { captureInfo.capture.node.disconnect(); } catch (e) { /* */ }
      try { captureInfo.silentGain.disconnect(); } catch (e) { /* */ }
    }

    // Clean up stream and nodes
    if (recordingState.stream) {
      recordingState.stream.getTracks().forEach(function (t) { t.stop(); });
    }
    try { recordingState.sourceNode.disconnect(); } catch (e) { /* */ }
    try { recordingState.monitorGain.disconnect(); } catch (e) { /* */ }
    try { recordingState.splitter.disconnect(); } catch (e) { /* */ }

    var loopTakesResult = null;
    if (loopRecordingEnabled && recordingState.loopTakes) {
      loopTakesResult = recordingState.loopTakes;
    }

    recordingState = null;

    if (loopTakesResult) {
      return Promise.resolve({ recordings: results, loopTakes: loopTakesResult });
    }

    return Promise.resolve(results);
  }

  // ─── Punch Range Processing ─────────────────────────────────────────

  function applyPunchRange(buffer, recordingStartTime) {
    if (!punchRange || !buffer) return buffer;

    var context = getAudioContext();
    var sampleRate = buffer.sampleRate;
    var numChannels = buffer.numberOfChannels;

    // Calculate punch boundaries relative to recording start
    var punchInSample = Math.max(0, Math.floor((punchRange.start - recordingStartTime) * sampleRate));
    var punchOutSample = Math.min(buffer.length, Math.floor((punchRange.end - recordingStartTime) * sampleRate));

    if (punchInSample >= punchOutSample) return buffer;

    var punchLength = punchOutSample - punchInSample;
    var newBuffer = context.createBuffer(numChannels, punchLength, sampleRate);

    for (var ch = 0; ch < numChannels; ch++) {
      var sourceData = buffer.getChannelData(ch);
      var destData = newBuffer.getChannelData(ch);
      for (var i = 0; i < punchLength; i++) {
        destData[i] = sourceData[i + punchInSample];
      }
    }

    return newBuffer;
  }

  function spliceWithExisting(existingBuffer, newBuffer, spliceStartTime, sampleRate) {
    if (!existingBuffer || !newBuffer) return newBuffer || existingBuffer;

    var context = getAudioContext();
    sampleRate = sampleRate || existingBuffer.sampleRate;
    var numChannels = Math.max(existingBuffer.numberOfChannels, newBuffer.numberOfChannels);

    var spliceSample = Math.floor(spliceStartTime * sampleRate);
    var totalLength = Math.max(existingBuffer.length, spliceSample + newBuffer.length);
    var result = context.createBuffer(numChannels, totalLength, sampleRate);

    for (var ch = 0; ch < numChannels; ch++) {
      var destData = result.getChannelData(ch);

      // Copy existing data
      if (ch < existingBuffer.numberOfChannels) {
        var existData = existingBuffer.getChannelData(ch);
        destData.set(existData);
      }

      // Overlay new data at splice point
      if (ch < newBuffer.numberOfChannels) {
        var newData = newBuffer.getChannelData(ch);
        for (var i = 0; i < newData.length; i++) {
          var destIdx = spliceSample + i;
          if (destIdx < totalLength) {
            destData[destIdx] = newData[i];
          }
        }
      }
    }

    return result;
  }

  // ─── Take Management ───────────────────────────────────────────────

  function getTakes(trackId, position) {
    if (!takes[trackId]) return [];
    if (position !== undefined) {
      var posKey = (typeof position === 'number') ? position.toFixed(3) : position;
      return (takes[trackId][posKey] || []).slice();
    }
    // Return all takes for track
    var allTakes = [];
    var positions = Object.keys(takes[trackId]);
    for (var i = 0; i < positions.length; i++) {
      var positionTakes = takes[trackId][positions[i]];
      for (var j = 0; j < positionTakes.length; j++) {
        allTakes.push(positionTakes[j]);
      }
    }
    return allTakes;
  }

  function selectTake(takeId) {
    var keys = Object.keys(takes);
    for (var i = 0; i < keys.length; i++) {
      var positions = Object.keys(takes[keys[i]]);
      for (var j = 0; j < positions.length; j++) {
        var positionTakes = takes[keys[i]][positions[j]];
        for (var k = 0; k < positionTakes.length; k++) {
          if (positionTakes[k].id === takeId) {
            // Deselect all takes at this position, select this one
            for (var m = 0; m < positionTakes.length; m++) {
              positionTakes[m].selected = false;
            }
            positionTakes[k].selected = true;
            return positionTakes[k];
          }
        }
      }
    }
    return null;
  }

  function deleteTake(takeId) {
    var keys = Object.keys(takes);
    for (var i = 0; i < keys.length; i++) {
      var positions = Object.keys(takes[keys[i]]);
      for (var j = 0; j < positions.length; j++) {
        var positionTakes = takes[keys[i]][positions[j]];
        for (var k = 0; k < positionTakes.length; k++) {
          if (positionTakes[k].id === takeId) {
            var wasSelected = positionTakes[k].selected;
            positionTakes.splice(k, 1);
            // If deleted take was selected, select the last remaining
            if (wasSelected && positionTakes.length > 0) {
              positionTakes[positionTakes.length - 1].selected = true;
            }
            // Clean up empty arrays
            if (positionTakes.length === 0) {
              delete takes[keys[i]][positions[j]];
            }
            return true;
          }
        }
      }
    }
    return false;
  }

  function getSelectedTake(trackId, position) {
    var trackTakes = getTakes(trackId, position);
    for (var i = 0; i < trackTakes.length; i++) {
      if (trackTakes[i].selected) return trackTakes[i];
    }
    return trackTakes.length > 0 ? trackTakes[trackTakes.length - 1] : null;
  }

  // ─── Comping ────────────────────────────────────────────────────────

  function compTakes(trackId, regions) {
    // regions: [{takeId, startTime, endTime}, ...]
    // Combines sections from different takes into one buffer
    var context = getAudioContext();
    if (!context || !regions || regions.length === 0) return null;

    // Find all referenced takes
    var allTakes = getTakes(trackId);
    var takeMap = {};
    for (var i = 0; i < allTakes.length; i++) {
      takeMap[allTakes[i].id] = allTakes[i];
    }

    // Determine total duration
    var maxEnd = 0;
    for (var j = 0; j < regions.length; j++) {
      if (regions[j].endTime > maxEnd) maxEnd = regions[j].endTime;
    }

    if (maxEnd <= 0) return null;

    var sampleRate = context.sampleRate;
    var totalSamples = Math.ceil(maxEnd * sampleRate);
    var numChannels = 2;

    // Determine channel count from first take
    var firstTake = takeMap[regions[0].takeId];
    if (firstTake && firstTake.audioBuffer) {
      numChannels = firstTake.audioBuffer.numberOfChannels;
    }

    var compBuffer = context.createBuffer(numChannels, totalSamples, sampleRate);

    for (var r = 0; r < regions.length; r++) {
      var region = regions[r];
      var take = takeMap[region.takeId];
      if (!take || !take.audioBuffer) continue;

      var srcBuffer = take.audioBuffer;
      var srcStart = Math.floor(region.startTime * sampleRate);
      var srcEnd = Math.min(Math.floor(region.endTime * sampleRate), srcBuffer.length);
      var destStart = Math.floor(region.startTime * sampleRate);

      for (var ch = 0; ch < numChannels && ch < srcBuffer.numberOfChannels; ch++) {
        var srcData = srcBuffer.getChannelData(ch);
        var destData = compBuffer.getChannelData(ch);
        for (var s = srcStart; s < srcEnd; s++) {
          var destIdx = destStart + (s - srcStart);
          if (destIdx >= 0 && destIdx < totalSamples) {
            destData[destIdx] = srcData[s];
          }
        }
      }
    }

    return compBuffer;
  }

  // ─── Query State ────────────────────────────────────────────────────

  function getIsRecording() {
    return isRecording;
  }

  function getRecordingDuration() {
    if (!isRecording || !recordingState) return 0;
    var context = getAudioContext();
    return context.currentTime - recordingState.startTime;
  }

  function dispose() {
    if (isRecording) {
      stopRecording();
    }
    armedTracks = {};
    takes = {};
    recordingState = null;
    punchRange = null;
    punchEnabled = false;
    loopRecordingEnabled = false;
    loopRange = null;
  }

  // ─── Public API ─────────────────────────────────────────────────────

  return {
    // Track arming
    armTrack: armTrack,
    disarmTrack: disarmTrack,
    isTrackArmed: isTrackArmed,
    getArmedTracks: getArmedTracks,

    // Recording
    startRecording: startRecording,
    stopRecording: stopRecording,
    isRecording: getIsRecording,
    getRecordingDuration: getRecordingDuration,

    // Punch in/out
    setPunchRange: setPunchRange,
    clearPunchRange: clearPunchRange,
    enablePunch: enablePunch,
    isPunchEnabled: isPunchEnabled,

    // Loop recording
    enableLoopRecording: enableLoopRecording,
    setLoopRange: setLoopRange,
    clearLoopRange: clearLoopRange,

    // Take management
    getTakes: getTakes,
    selectTake: selectTake,
    deleteTake: deleteTake,
    getSelectedTake: getSelectedTake,
    compTakes: compTakes,

    // Latency
    setLatencyCompensation: setLatencyCompensation,
    getLatencyCompensation: getLatencyCompensation,
    measureInputLatency: measureInputLatency,

    // Input
    setInputMonitoring: setInputMonitoring,
    getInputMonitoring: getInputMonitoring,
    enumerateInputDevices: enumerateInputDevices,
    selectInputDevice: selectInputDevice,

    // Splice utility
    spliceWithExisting: spliceWithExisting,

    // Cleanup
    dispose: dispose
  };
})();
