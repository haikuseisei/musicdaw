var DAW = DAW || {};

DAW.TrackManager = (function () {
  var tracks = [];
  var nextId = 1;

  var colorPalette = [
    '#4A90D9', '#D94A4A', '#4AD97A', '#D9A84A',
    '#9B59B6', '#1ABC9C', '#E74C3C', '#3498DB',
    '#2ECC71', '#F39C12', '#E67E22', '#9B59B6',
    '#1ABC9C', '#34495E', '#E84393', '#00CEC9'
  ];
  var colorIndex = 0;

  var callbacks = {
    onTrackAdded: null,
    onTrackRemoved: null,
    onTrackChanged: null
  };

  function fire(name, data) {
    if (callbacks[name]) {
      callbacks[name](data);
    }
  }

  function nextColor() {
    var c = colorPalette[colorIndex % colorPalette.length];
    colorIndex++;
    return c;
  }

  function generateId() {
    return 'track_' + (nextId++);
  }

  function createTrackObject(type, name) {
    var track = {
      id: generateId(),
      name: name || (type.charAt(0).toUpperCase() + type.slice(1) + ' ' + nextId),
      type: type,
      color: nextColor(),
      mute: false,
      solo: false,
      armed: false,
      volume: 1.0,
      pan: 0,
      clips: [],
      effects: [],
      sends: [],
      automationLanes: [],
      input: null,
      output: 'master',
      height: 80,
      collapsed: false,
      frozen: false,
      parentId: null
    };
    return track;
  }

  function initMasterTrack() {
    if (getMasterTrack()) return;
    var master = createTrackObject('master', 'Master');
    master.output = null;
    tracks.push(master);
  }

  function createTrack(type, name) {
    var validTypes = ['audio', 'midi', 'bus', 'return'];
    if (validTypes.indexOf(type) === -1) {
      throw new Error('Invalid track type: ' + type + '. Valid types: ' + validTypes.join(', '));
    }

    initMasterTrack();

    var track = createTrackObject(type, name);

    if (type === 'bus') {
      track.output = 'master';
    } else if (type === 'return') {
      track.output = 'master';
    }

    // Insert before master track
    var masterIdx = -1;
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].type === 'master') {
        masterIdx = i;
        break;
      }
    }
    if (masterIdx >= 0) {
      tracks.splice(masterIdx, 0, track);
    } else {
      tracks.push(track);
    }

    fire('onTrackAdded', track);
    return track;
  }

  function deleteTrack(id) {
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].id === id) {
        if (tracks[i].type === 'master') {
          throw new Error('Cannot delete master track');
        }
        var removed = tracks.splice(i, 1)[0];

        // Unparent any children
        for (var j = 0; j < tracks.length; j++) {
          if (tracks[j].parentId === id) {
            tracks[j].parentId = null;
          }
        }

        fire('onTrackRemoved', removed);
        return removed;
      }
    }
    return null;
  }

  function duplicateTrack(id) {
    var original = getTrack(id);
    if (!original) return null;
    if (original.type === 'master') {
      throw new Error('Cannot duplicate master track');
    }

    var dup = createTrack(original.type, original.name + ' (Copy)');
    dup.volume = original.volume;
    dup.pan = original.pan;
    dup.color = original.color;
    dup.height = original.height;
    dup.output = original.output;

    // Deep copy clips
    for (var i = 0; i < original.clips.length; i++) {
      var clipCopy = {};
      var keys = Object.keys(original.clips[i]);
      for (var k = 0; k < keys.length; k++) {
        clipCopy[keys[k]] = original.clips[i][keys[k]];
      }
      clipCopy.trackId = dup.id;
      dup.clips.push(clipCopy);
    }

    // Copy effects list (shallow)
    for (var e = 0; e < original.effects.length; e++) {
      dup.effects.push(original.effects[e]);
    }

    // Copy sends
    for (var s = 0; s < original.sends.length; s++) {
      var sendCopy = {};
      var sKeys = Object.keys(original.sends[s]);
      for (var sk = 0; sk < sKeys.length; sk++) {
        sendCopy[sKeys[sk]] = original.sends[s][sKeys[sk]];
      }
      dup.sends.push(sendCopy);
    }

    fire('onTrackChanged', dup);
    return dup;
  }

  function moveTrack(id, newIndex) {
    var oldIndex = -1;
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].id === id) {
        oldIndex = i;
        break;
      }
    }
    if (oldIndex === -1) return;
    if (tracks[oldIndex].type === 'master') return;

    // Ensure newIndex doesn't go past or onto the master track
    var masterIdx = -1;
    for (var m = 0; m < tracks.length; m++) {
      if (tracks[m].type === 'master') {
        masterIdx = m;
        break;
      }
    }
    if (newIndex >= masterIdx) newIndex = masterIdx - 1;
    if (newIndex < 0) newIndex = 0;

    var track = tracks.splice(oldIndex, 1)[0];
    tracks.splice(newIndex, 0, track);
    fire('onTrackChanged', track);
  }

  function getTrack(id) {
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].id === id) return tracks[i];
    }
    return null;
  }

  function getTracks() {
    return tracks.slice();
  }

  function getTracksByType(type) {
    var result = [];
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].type === type) result.push(tracks[i]);
    }
    return result;
  }

  function getMasterTrack() {
    var masters = getTracksByType('master');
    return masters.length > 0 ? masters[0] : null;
  }

  function updateSoloState() {
    var anySoloed = false;
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].solo) {
        anySoloed = true;
        break;
      }
    }
    // Return effective mute state for each track
    return anySoloed;
  }

  function isTrackAudible(id) {
    var track = getTrack(id);
    if (!track) return false;
    if (track.type === 'master') return !track.mute;

    var anySoloed = updateSoloState();
    if (track.mute) return false;
    if (anySoloed && !track.solo) return false;
    return true;
  }

  function setTrackProperty(id, prop, value) {
    var track = getTrack(id);
    if (!track) return;
    if (track.hasOwnProperty(prop)) {
      track[prop] = value;
      fire('onTrackChanged', track);
    }
  }

  function getChildren(parentId) {
    var result = [];
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].parentId === parentId) {
        result.push(tracks[i]);
      }
    }
    return result;
  }

  function setParent(childId, parentId) {
    var child = getTrack(childId);
    if (!child) return;
    child.parentId = parentId;
    fire('onTrackChanged', child);
  }

  function on(eventName, fn) {
    if (callbacks.hasOwnProperty(eventName)) {
      callbacks[eventName] = fn;
    }
  }

  // Initialize master track on load
  initMasterTrack();

  return {
    createTrack: createTrack,
    deleteTrack: deleteTrack,
    duplicateTrack: duplicateTrack,
    moveTrack: moveTrack,
    getTrack: getTrack,
    getTracks: getTracks,
    getTracksByType: getTracksByType,
    getMasterTrack: getMasterTrack,
    isTrackAudible: isTrackAudible,
    setTrackProperty: setTrackProperty,
    getChildren: getChildren,
    setParent: setParent,
    on: on
  };
})();
