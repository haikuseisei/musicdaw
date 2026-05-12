var DAW = DAW || {};

DAW.Mixer = (function () {
  'use strict';

  var ac = null;
  var channels = {};
  var buses = {};
  var returnChannels = {};
  var masterChannel = null;
  var soloActive = false;
  var channelIdCounter = 0;

  // ─── Utility ────────────────────────────────────────────────────────

  function clamp(val, min, max) {
    return val < min ? min : val > max ? max : val;
  }

  function dBToLinear(db) {
    return Math.pow(10, db / 20);
  }

  function linearToDB(lin) {
    if (lin <= 0) return -Infinity;
    return 20 * Math.log10(lin);
  }

  function getAudioContext() {
    if (!ac) {
      ac = DAW.AudioEngine ? DAW.AudioEngine.getContext() : null;
    }
    return ac;
  }

  // ─── Metering ───────────────────────────────────────────────────────

  function createMeter(context) {
    var splitter = context.createChannelSplitter(2);
    var analyserL = context.createAnalyser();
    analyserL.fftSize = 2048;
    analyserL.smoothingTimeConstant = 0.3;
    var analyserR = context.createAnalyser();
    analyserR.fftSize = 2048;
    analyserR.smoothingTimeConstant = 0.3;

    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);

    var bufferL = new Float32Array(analyserL.fftSize);
    var bufferR = new Float32Array(analyserR.fftSize);

    return {
      input: splitter,
      getLevel: function () {
        analyserL.getFloatTimeDomainData(bufferL);
        analyserR.getFloatTimeDomainData(bufferR);

        var peakL = 0, peakR = 0;
        var sumL = 0, sumR = 0;

        for (var i = 0; i < bufferL.length; i++) {
          var absL = Math.abs(bufferL[i]);
          var absR = Math.abs(bufferR[i]);
          if (absL > peakL) peakL = absL;
          if (absR > peakR) peakR = absR;
          sumL += bufferL[i] * bufferL[i];
          sumR += bufferR[i] * bufferR[i];
        }

        var rmsL = Math.sqrt(sumL / bufferL.length);
        var rmsR = Math.sqrt(sumR / bufferR.length);

        return {
          peakL: linearToDB(peakL),
          peakR: linearToDB(peakR),
          rmsL: linearToDB(rmsL),
          rmsR: linearToDB(rmsR)
        };
      },
      dispose: function () {
        try {
          splitter.disconnect();
          analyserL.disconnect();
          analyserR.disconnect();
        } catch (e) { /* */ }
      }
    };
  }

  // ─── Effects Chain ──────────────────────────────────────────────────

  function rebuildInsertChain(channel) {
    var context = getAudioContext();
    var inserts = channel.inserts;
    var chainSource = channel._insertInputNode;
    var chainDest = channel._insertOutputNode;

    // Disconnect all existing insert routing
    try { chainSource.disconnect(); } catch (e) { /* */ }
    for (var i = 0; i < inserts.length; i++) {
      try { inserts[i].output.disconnect(); } catch (e) { /* */ }
    }

    if (inserts.length === 0) {
      chainSource.connect(chainDest);
    } else {
      chainSource.connect(inserts[0].input);
      for (var j = 0; j < inserts.length - 1; j++) {
        inserts[j].output.connect(inserts[j + 1].input);
      }
      inserts[inserts.length - 1].output.connect(chainDest);
    }
  }

  // ─── Solo / Mute Logic ─────────────────────────────────────────────

  function updateSoloMuteState() {
    var keys = Object.keys(channels);
    var anySolo = false;
    var i;

    for (i = 0; i < keys.length; i++) {
      if (channels[keys[i]].solo) {
        anySolo = true;
        break;
      }
    }

    soloActive = anySolo;

    for (i = 0; i < keys.length; i++) {
      var ch = channels[keys[i]];
      if (anySolo) {
        // Solo overrides mute: audible only if soloed
        if (ch.solo) {
          ch._muteNode.gain.value = 1;
        } else {
          ch._muteNode.gain.value = 0;
        }
      } else {
        // No solo: use mute state
        ch._muteNode.gain.value = ch.muted ? 0 : 1;
      }
    }
  }

  // ─── Channel Strip ──────────────────────────────────────────────────

  function createChannel(trackId) {
    var context = getAudioContext();
    if (!context) {
      throw new Error('DAW.Mixer.createChannel: no AudioContext available');
    }

    ensureMaster();

    var id = trackId || ('ch_' + (++channelIdCounter));

    // Input gain stage
    var inputGain = context.createGain();
    inputGain.gain.value = 1;

    // Phase invert: gain of -1 or 1
    var phaseNode = context.createGain();
    phaseNode.gain.value = 1;

    // Pre-insert point (for pre-fader sends and metering)
    var insertInput = context.createGain();
    insertInput.gain.value = 1;
    var insertOutput = context.createGain();
    insertOutput.gain.value = 1;

    // Fader
    var fader = context.createGain();
    fader.gain.value = 1;

    // Pan
    var pan = context.createStereoPanner();
    pan.pan.value = 0;

    // Mute node
    var muteNode = context.createGain();
    muteNode.gain.value = 1;

    // Pre-fader meter
    var preFaderMeter = createMeter(context);

    // Post-fader meter
    var postFaderMeter = createMeter(context);

    // Chain: input -> phase -> insertInput -> [inserts] -> insertOutput -> preFaderMeter -> fader -> pan -> mute -> postFaderMeter -> master
    inputGain.connect(phaseNode);
    phaseNode.connect(insertInput);
    insertInput.connect(insertOutput); // direct (no inserts yet)
    insertOutput.connect(preFaderMeter.input);
    insertOutput.connect(fader);
    fader.connect(pan);
    pan.connect(muteNode);
    muteNode.connect(postFaderMeter.input);
    muteNode.connect(masterChannel.input);

    var channel = {
      id: id,
      trackId: trackId,
      input: inputGain,
      inputGain: inputGain,
      fader: fader,
      pan: pan,
      inserts: [],
      sends: [],
      preFaderMeter: preFaderMeter,
      postFaderMeter: postFaderMeter,
      muted: false,
      solo: false,
      phaseInverted: false,
      _muteNode: muteNode,
      _phaseNode: phaseNode,
      _insertInputNode: insertInput,
      _insertOutputNode: insertOutput,

      setVolume: function (db) {
        fader.gain.value = dBToLinear(clamp(db, -Infinity, 12));
      },

      setPan: function (value) {
        pan.pan.value = clamp(value, -1, 1);
      },

      setInputGain: function (db) {
        inputGain.gain.value = dBToLinear(clamp(db, -60, 24));
      },

      setMute: function (state) {
        channel.muted = (state !== undefined) ? !!state : !channel.muted;
        updateSoloMuteState();
        return channel.muted;
      },

      setSolo: function (state) {
        channel.solo = (state !== undefined) ? !!state : !channel.solo;
        updateSoloMuteState();
        return channel.solo;
      },

      setPhaseInvert: function (state) {
        channel.phaseInverted = (state !== undefined) ? !!state : !channel.phaseInverted;
        phaseNode.gain.value = channel.phaseInverted ? -1 : 1;
        return channel.phaseInverted;
      },

      addInsert: function (effectType, index) {
        var effect = DAW.Effects.create(effectType, context);
        if (index !== undefined && index >= 0 && index < channel.inserts.length) {
          channel.inserts.splice(index, 0, effect);
        } else {
          channel.inserts.push(effect);
        }
        rebuildInsertChain(channel);
        return effect;
      },

      removeInsert: function (index) {
        if (index >= 0 && index < channel.inserts.length) {
          var removed = channel.inserts.splice(index, 1)[0];
          removed.dispose();
          rebuildInsertChain(channel);
          return removed;
        }
        return null;
      },

      getLevel: function () {
        return postFaderMeter.getLevel();
      },

      getPreFaderLevel: function () {
        return preFaderMeter.getLevel();
      },

      dispose: function () {
        for (var s = 0; s < channel.sends.length; s++) {
          channel.sends[s].dispose();
        }
        for (var e = 0; e < channel.inserts.length; e++) {
          channel.inserts[e].dispose();
        }
        preFaderMeter.dispose();
        postFaderMeter.dispose();
        try {
          inputGain.disconnect();
          phaseNode.disconnect();
          insertInput.disconnect();
          insertOutput.disconnect();
          fader.disconnect();
          pan.disconnect();
          muteNode.disconnect();
        } catch (err) { /* */ }
        delete channels[id];
        updateSoloMuteState();
      }
    };

    channels[id] = channel;
    return channel;
  }

  // ─── Master Channel ─────────────────────────────────────────────────

  function ensureMaster() {
    if (masterChannel) return masterChannel;
    var context = getAudioContext();

    var input = context.createGain();
    input.gain.value = 1;

    var insertInput = context.createGain();
    insertInput.gain.value = 1;
    var insertOutput = context.createGain();
    insertOutput.gain.value = 1;

    var fader = context.createGain();
    fader.gain.value = 1;

    var meter = createMeter(context);

    input.connect(insertInput);
    insertInput.connect(insertOutput);
    insertOutput.connect(fader);
    fader.connect(meter.input);
    fader.connect(context.destination);

    masterChannel = {
      id: 'master',
      input: input,
      fader: fader,
      inserts: [],
      meter: meter,
      _insertInputNode: insertInput,
      _insertOutputNode: insertOutput,

      setVolume: function (db) {
        fader.gain.value = dBToLinear(clamp(db, -Infinity, 12));
      },

      addInsert: function (effectType, index) {
        var effect = DAW.Effects.create(effectType, context);
        if (index !== undefined && index >= 0 && index < masterChannel.inserts.length) {
          masterChannel.inserts.splice(index, 0, effect);
        } else {
          masterChannel.inserts.push(effect);
        }
        rebuildInsertChain(masterChannel);
        return effect;
      },

      removeInsert: function (index) {
        if (index >= 0 && index < masterChannel.inserts.length) {
          var removed = masterChannel.inserts.splice(index, 1)[0];
          removed.dispose();
          rebuildInsertChain(masterChannel);
          return removed;
        }
        return null;
      },

      getLevel: function () {
        return meter.getLevel();
      },

      getDestinationNode: function () {
        return input;
      },

      dispose: function () {
        for (var e = 0; e < masterChannel.inserts.length; e++) {
          masterChannel.inserts[e].dispose();
        }
        meter.dispose();
        try {
          input.disconnect();
          insertInput.disconnect();
          insertOutput.disconnect();
          fader.disconnect();
        } catch (err) { /* */ }
        masterChannel = null;
      }
    };

    return masterChannel;
  }

  // ─── Send / Return ──────────────────────────────────────────────────

  function createReturn(name) {
    var context = getAudioContext();
    ensureMaster();

    var id = 'return_' + (name || (++channelIdCounter));

    var input = context.createGain();
    input.gain.value = 1;

    var insertInput = context.createGain();
    var insertOutput = context.createGain();

    var fader = context.createGain();
    fader.gain.value = 1;

    var pan = context.createStereoPanner();
    pan.pan.value = 0;

    var muteNode = context.createGain();
    muteNode.gain.value = 1;

    var meter = createMeter(context);

    input.connect(insertInput);
    insertInput.connect(insertOutput);
    insertOutput.connect(fader);
    fader.connect(pan);
    pan.connect(muteNode);
    muteNode.connect(meter.input);
    muteNode.connect(masterChannel.input);

    var ret = {
      id: id,
      name: name,
      input: input,
      fader: fader,
      pan: pan,
      inserts: [],
      muted: false,
      _muteNode: muteNode,
      _insertInputNode: insertInput,
      _insertOutputNode: insertOutput,

      setVolume: function (db) {
        fader.gain.value = dBToLinear(clamp(db, -Infinity, 12));
      },

      setPan: function (value) {
        pan.pan.value = clamp(value, -1, 1);
      },

      setMute: function (state) {
        ret.muted = (state !== undefined) ? !!state : !ret.muted;
        muteNode.gain.value = ret.muted ? 0 : 1;
        return ret.muted;
      },

      addInsert: function (effectType, index) {
        var effect = DAW.Effects.create(effectType, context);
        if (index !== undefined && index >= 0 && index < ret.inserts.length) {
          ret.inserts.splice(index, 0, effect);
        } else {
          ret.inserts.push(effect);
        }
        rebuildInsertChain(ret);
        return effect;
      },

      removeInsert: function (index) {
        if (index >= 0 && index < ret.inserts.length) {
          var removed = ret.inserts.splice(index, 1)[0];
          removed.dispose();
          rebuildInsertChain(ret);
          return removed;
        }
        return null;
      },

      getLevel: function () {
        return meter.getLevel();
      },

      dispose: function () {
        for (var e = 0; e < ret.inserts.length; e++) {
          ret.inserts[e].dispose();
        }
        meter.dispose();
        try {
          input.disconnect();
          insertInput.disconnect();
          insertOutput.disconnect();
          fader.disconnect();
          pan.disconnect();
          muteNode.disconnect();
        } catch (err) { /* */ }
        delete returnChannels[id];
      }
    };

    returnChannels[id] = ret;
    return ret;
  }

  function createSend(channelId, returnId, level, preFader) {
    var context = getAudioContext();
    var channel = channels[channelId];
    var ret = returnChannels[returnId];

    if (!channel) {
      throw new Error('DAW.Mixer.createSend: channel "' + channelId + '" not found');
    }
    if (!ret) {
      throw new Error('DAW.Mixer.createSend: return "' + returnId + '" not found');
    }

    var sendGain = context.createGain();
    sendGain.gain.value = (level !== undefined) ? clamp(level, 0, 2) : 1;

    var sourceNode = preFader ? channel._insertOutputNode : channel._muteNode;
    sourceNode.connect(sendGain);
    sendGain.connect(ret.input);

    var send = {
      channelId: channelId,
      returnId: returnId,
      gain: sendGain,
      preFader: !!preFader,

      setLevel: function (v) {
        sendGain.gain.value = clamp(v, 0, 2);
      },

      setPreFader: function (pre) {
        try { sendGain.disconnect(); } catch (e) { /* */ }
        var src = pre ? channel._insertOutputNode : channel._muteNode;
        try {
          // disconnect old source from sendGain
          // (we can't selectively disconnect, so reconnect everything)
        } catch (e) { /* */ }
        src.connect(sendGain);
        sendGain.connect(ret.input);
        send.preFader = !!pre;
      },

      dispose: function () {
        try { sendGain.disconnect(); } catch (e) { /* */ }
        var idx = channel.sends.indexOf(send);
        if (idx !== -1) channel.sends.splice(idx, 1);
      }
    };

    channel.sends.push(send);
    return send;
  }

  // ─── Bus Routing ────────────────────────────────────────────────────

  function createBus(name) {
    var context = getAudioContext();
    ensureMaster();

    var id = 'bus_' + (name || (++channelIdCounter));

    var input = context.createGain();
    input.gain.value = 1;

    var insertInput = context.createGain();
    var insertOutput = context.createGain();

    var fader = context.createGain();
    fader.gain.value = 1;

    var pan = context.createStereoPanner();
    pan.pan.value = 0;

    var muteNode = context.createGain();
    muteNode.gain.value = 1;

    var meter = createMeter(context);

    input.connect(insertInput);
    insertInput.connect(insertOutput);
    insertOutput.connect(fader);
    fader.connect(pan);
    pan.connect(muteNode);
    muteNode.connect(meter.input);
    muteNode.connect(masterChannel.input);

    var bus = {
      id: id,
      name: name,
      input: input,
      fader: fader,
      pan: pan,
      inserts: [],
      muted: false,
      _muteNode: muteNode,
      _insertInputNode: insertInput,
      _insertOutputNode: insertOutput,
      _routedChannels: [],

      setVolume: function (db) {
        fader.gain.value = dBToLinear(clamp(db, -Infinity, 12));
      },

      setPan: function (value) {
        pan.pan.value = clamp(value, -1, 1);
      },

      setMute: function (state) {
        bus.muted = (state !== undefined) ? !!state : !bus.muted;
        muteNode.gain.value = bus.muted ? 0 : 1;
        return bus.muted;
      },

      addInsert: function (effectType, index) {
        var effect = DAW.Effects.create(effectType, context);
        if (index !== undefined && index >= 0 && index < bus.inserts.length) {
          bus.inserts.splice(index, 0, effect);
        } else {
          bus.inserts.push(effect);
        }
        rebuildInsertChain(bus);
        return effect;
      },

      removeInsert: function (index) {
        if (index >= 0 && index < bus.inserts.length) {
          var removed = bus.inserts.splice(index, 1)[0];
          removed.dispose();
          rebuildInsertChain(bus);
          return removed;
        }
        return null;
      },

      getLevel: function () {
        return meter.getLevel();
      },

      dispose: function () {
        for (var e = 0; e < bus.inserts.length; e++) {
          bus.inserts[e].dispose();
        }
        meter.dispose();
        try {
          input.disconnect();
          insertInput.disconnect();
          insertOutput.disconnect();
          fader.disconnect();
          pan.disconnect();
          muteNode.disconnect();
        } catch (err) { /* */ }
        delete buses[id];
      }
    };

    buses[id] = bus;
    return bus;
  }

  function routeToBus(channelId, busId) {
    var channel = channels[channelId];
    var bus = buses[busId];

    if (!channel) {
      throw new Error('DAW.Mixer.routeToBus: channel "' + channelId + '" not found');
    }
    if (!bus) {
      throw new Error('DAW.Mixer.routeToBus: bus "' + busId + '" not found');
    }

    // Disconnect channel from master and connect to bus instead
    try { channel._muteNode.disconnect(masterChannel.input); } catch (e) { /* */ }
    channel._muteNode.connect(bus.input);
    bus._routedChannels.push(channelId);

    return {
      remove: function () {
        try { channel._muteNode.disconnect(bus.input); } catch (e) { /* */ }
        channel._muteNode.connect(masterChannel.input);
        var idx = bus._routedChannels.indexOf(channelId);
        if (idx !== -1) bus._routedChannels.splice(idx, 1);
      }
    };
  }

  // ─── Sidechain ──────────────────────────────────────────────────────

  function setupSidechain(compressorEffect, sourceChannelId) {
    // Web Audio DynamicsCompressorNode does not support external sidechain
    // input natively. We implement a simplified gain-duck approach:
    // Monitor the source channel level and modulate a gain node.
    var context = getAudioContext();
    var sourceChannel = channels[sourceChannelId];

    if (!sourceChannel) {
      throw new Error('DAW.Mixer.setupSidechain: source channel "' + sourceChannelId + '" not found');
    }
    if (!compressorEffect || compressorEffect.type !== 'compressor') {
      throw new Error('DAW.Mixer.setupSidechain: invalid compressor effect');
    }

    var analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.5;

    sourceChannel._muteNode.connect(analyser);

    var buffer = new Float32Array(analyser.fftSize);
    var active = true;
    var animFrameId = null;

    // Modulate the compressor's input gain based on sidechain source
    var threshold = compressorEffect.getParams().threshold || -24;
    var ratio = compressorEffect.getParams().ratio || 4;

    function process() {
      if (!active) return;

      analyser.getFloatTimeDomainData(buffer);
      var peak = 0;
      for (var i = 0; i < buffer.length; i++) {
        var abs = Math.abs(buffer[i]);
        if (abs > peak) peak = abs;
      }

      var peakDB = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
      var now = context.currentTime;

      if (peakDB > threshold) {
        var overshoot = peakDB - threshold;
        var reduction = overshoot * (1 - 1 / ratio);
        var targetGain = Math.pow(10, -reduction / 20);
        compressorEffect.input.gain.setTargetAtTime(
          targetGain, now, compressorEffect.getParams().attack || 0.003
        );
      } else {
        compressorEffect.input.gain.setTargetAtTime(
          1, now, compressorEffect.getParams().release || 0.25
        );
      }

      animFrameId = requestAnimationFrame(process);
    }

    process();

    return {
      dispose: function () {
        active = false;
        if (animFrameId) cancelAnimationFrame(animFrameId);
        try { analyser.disconnect(); } catch (e) { /* */ }
        compressorEffect.input.gain.value = 1;
      }
    };
  }

  // ─── Query helpers ──────────────────────────────────────────────────

  function getChannel(id) {
    return channels[id] || null;
  }

  function getBus(id) {
    return buses[id] || null;
  }

  function getReturn(id) {
    return returnChannels[id] || null;
  }

  function getMaster() {
    return ensureMaster();
  }

  function getLevel(channelId) {
    var ch = channels[channelId];
    if (!ch) return null;
    return ch.getLevel();
  }

  function getAllChannels() {
    var result = [];
    var keys = Object.keys(channels);
    for (var i = 0; i < keys.length; i++) {
      result.push(channels[keys[i]]);
    }
    return result;
  }

  function init(audioContext) {
    ac = audioContext || getAudioContext();
    channels = {};
    buses = {};
    returnChannels = {};
    masterChannel = null;
    soloActive = false;
    channelIdCounter = 0;
    ensureMaster();
  }

  function dispose() {
    var key;
    for (key in channels) {
      if (channels.hasOwnProperty(key)) {
        channels[key].dispose();
      }
    }
    for (key in buses) {
      if (buses.hasOwnProperty(key)) {
        buses[key].dispose();
      }
    }
    for (key in returnChannels) {
      if (returnChannels.hasOwnProperty(key)) {
        returnChannels[key].dispose();
      }
    }
    if (masterChannel) {
      masterChannel.dispose();
    }
    channels = {};
    buses = {};
    returnChannels = {};
    masterChannel = null;
  }

  // ─── Public API ─────────────────────────────────────────────────────

  return {
    init: init,
    dispose: dispose,
    createChannel: createChannel,
    getChannel: getChannel,
    getAllChannels: getAllChannels,
    getLevel: getLevel,
    getMaster: getMaster,
    createSend: createSend,
    createReturn: createReturn,
    getReturn: getReturn,
    createBus: createBus,
    getBus: getBus,
    routeToBus: routeToBus,
    setupSidechain: setupSidechain
  };
})();
