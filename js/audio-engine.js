var DAW = DAW || {};

DAW.AudioEngine = (function () {
  var ctx = null;
  var recordedBuffer = null;
  var mediaStream = null;
  var mediaRecorder = null;
  var chunks = [];
  var isRecording = false;
  var sourceNode = null;
  var gainRecording = null;
  var gainDrums = null;
  var masterGain = null;

  function getContext() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return ctx;
  }

  function ensureResumed() {
    var ac = getContext();
    if (ac.state === 'suspended') {
      return ac.resume();
    }
    return Promise.resolve();
  }

  function initGains() {
    var ac = getContext();
    if (!masterGain) {
      masterGain = ac.createGain();
      masterGain.connect(ac.destination);
      gainRecording = ac.createGain();
      gainRecording.gain.value = 0.8;
      gainRecording.connect(masterGain);
      gainDrums = ac.createGain();
      gainDrums.gain.value = 0.7;
      gainDrums.connect(masterGain);
    }
  }

  function startRecording(onDataAvailable) {
    return ensureResumed().then(function () {
      return navigator.mediaDevices.getUserMedia({ audio: true });
    }).then(function (stream) {
      mediaStream = stream;
      chunks = [];
      isRecording = true;

      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = function (e) {
        if (e.data.size > 0) chunks.push(e.data);
      };
      mediaRecorder.onstop = function () {
        var blob = new Blob(chunks, { type: 'audio/webm' });
        var reader = new FileReader();
        reader.onload = function () {
          getContext().decodeAudioData(reader.result).then(function (buffer) {
            recordedBuffer = buffer;
            if (onDataAvailable) onDataAvailable(buffer);
          });
        };
        reader.readAsArrayBuffer(blob);
        stream.getTracks().forEach(function (t) { t.stop(); });
      };
      mediaRecorder.start();
    });
  }

  function stopRecording() {
    isRecording = false;
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
  }

  function getRecordedBuffer() {
    return recordedBuffer;
  }

  function playRecording(startTime) {
    if (!recordedBuffer) return null;
    var ac = getContext();
    initGains();
    sourceNode = ac.createBufferSource();
    sourceNode.buffer = recordedBuffer;
    sourceNode.connect(gainRecording);
    sourceNode.start(0, startTime || 0);
    return sourceNode;
  }

  function stopPlayback() {
    if (sourceNode) {
      try { sourceNode.stop(); } catch (e) { /* already stopped */ }
      sourceNode = null;
    }
  }

  function setRecordingVolume(v) {
    if (gainRecording) gainRecording.gain.value = v;
  }

  function setDrumsVolume(v) {
    if (gainDrums) gainDrums.gain.value = v;
  }

  function getDrumsGain() {
    initGains();
    return gainDrums;
  }

  function getRecordingIsActive() {
    return isRecording;
  }

  return {
    getContext: getContext,
    ensureResumed: ensureResumed,
    startRecording: startRecording,
    stopRecording: stopRecording,
    getRecordedBuffer: getRecordedBuffer,
    playRecording: playRecording,
    stopPlayback: stopPlayback,
    setRecordingVolume: setRecordingVolume,
    setDrumsVolume: setDrumsVolume,
    getDrumsGain: getDrumsGain,
    isRecording: getRecordingIsActive
  };
})();
