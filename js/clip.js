var DAW = DAW || {};

DAW.Clip = (function () {
  var clips = {};
  var nextId = 1;
  var nextNoteId = 1;

  function generateId() {
    return 'clip_' + (nextId++);
  }

  function generateNoteId() {
    return 'note_' + (nextNoteId++);
  }

  function validate(clip) {
    if (clip.startTime < 0) clip.startTime = 0;
    if (clip.duration < 0) clip.duration = 0;
    if (clip.offset < 0) clip.offset = 0;
    if (clip.gain < 0) clip.gain = 0;
    if (clip.fadeIn < 0) clip.fadeIn = 0;
    if (clip.fadeOut < 0) clip.fadeOut = 0;
    return clip;
  }

  function createAudioClip(trackId, startTime, audioBuffer, options) {
    var opts = options || {};
    var clip = {
      id: generateId(),
      type: 'audio',
      trackId: trackId,
      startTime: startTime || 0,
      duration: audioBuffer ? audioBuffer.duration : (opts.duration || 0),
      offset: opts.offset || 0,
      audioBuffer: audioBuffer,
      gain: typeof opts.gain === 'number' ? opts.gain : 1.0,
      fadeIn: opts.fadeIn || 0,
      fadeOut: opts.fadeOut || 0,
      color: opts.color || '#4A90D9',
      name: opts.name || 'Audio Clip',
      reversed: opts.reversed || false,
      playbackRate: opts.playbackRate || 1.0,
      looped: opts.looped || false
    };
    validate(clip);
    clips[clip.id] = clip;
    return clip;
  }

  function createMIDIClip(trackId, startTime, duration) {
    var clip = {
      id: generateId(),
      type: 'midi',
      trackId: trackId,
      startTime: startTime || 0,
      duration: duration || 0,
      notes: [],
      color: '#2ECC71',
      name: 'MIDI Clip',
      looped: false
    };
    validate(clip);
    clips[clip.id] = clip;
    return clip;
  }

  function getClip(clipId) {
    return clips[clipId] || null;
  }

  function getAllClips() {
    var result = [];
    var keys = Object.keys(clips);
    for (var i = 0; i < keys.length; i++) {
      result.push(clips[keys[i]]);
    }
    return result;
  }

  function addNote(clipId, note) {
    var clip = clips[clipId];
    if (!clip || clip.type !== 'midi') return null;

    var n = {
      id: generateNoteId(),
      pitch: note.pitch,
      velocity: typeof note.velocity === 'number' ? note.velocity : 100,
      start: note.start || 0,
      duration: note.duration || 0.25,
      channel: note.channel || 0
    };

    if (n.pitch < 0) n.pitch = 0;
    if (n.pitch > 127) n.pitch = 127;
    if (n.velocity < 0) n.velocity = 0;
    if (n.velocity > 127) n.velocity = 127;
    if (n.start < 0) n.start = 0;
    if (n.duration < 0) n.duration = 0;

    clip.notes.push(n);
    return n;
  }

  function removeNote(clipId, noteId) {
    var clip = clips[clipId];
    if (!clip || clip.type !== 'midi') return null;

    for (var i = 0; i < clip.notes.length; i++) {
      if (clip.notes[i].id === noteId) {
        return clip.notes.splice(i, 1)[0];
      }
    }
    return null;
  }

  function updateNote(clipId, noteId, props) {
    var clip = clips[clipId];
    if (!clip || clip.type !== 'midi') return null;

    for (var i = 0; i < clip.notes.length; i++) {
      if (clip.notes[i].id === noteId) {
        var note = clip.notes[i];
        var keys = Object.keys(props);
        for (var k = 0; k < keys.length; k++) {
          if (note.hasOwnProperty(keys[k]) && keys[k] !== 'id') {
            note[keys[k]] = props[keys[k]];
          }
        }
        // Re-validate
        if (note.pitch < 0) note.pitch = 0;
        if (note.pitch > 127) note.pitch = 127;
        if (note.velocity < 0) note.velocity = 0;
        if (note.velocity > 127) note.velocity = 127;
        if (note.start < 0) note.start = 0;
        if (note.duration < 0) note.duration = 0;
        return note;
      }
    }
    return null;
  }

  function splitClip(clipId, time) {
    var clip = clips[clipId];
    if (!clip) return null;

    var splitPoint = time - clip.startTime;
    if (splitPoint <= 0 || splitPoint >= clip.duration) return null;

    if (clip.type === 'audio') {
      var clip1 = createAudioClip(clip.trackId, clip.startTime, clip.audioBuffer, {
        duration: splitPoint,
        offset: clip.offset,
        gain: clip.gain,
        fadeIn: clip.fadeIn,
        fadeOut: 0,
        color: clip.color,
        name: clip.name + ' L',
        reversed: clip.reversed,
        playbackRate: clip.playbackRate
      });
      clip1.duration = splitPoint;

      var clip2 = createAudioClip(clip.trackId, time, clip.audioBuffer, {
        duration: clip.duration - splitPoint,
        offset: clip.offset + splitPoint,
        gain: clip.gain,
        fadeIn: 0,
        fadeOut: clip.fadeOut,
        color: clip.color,
        name: clip.name + ' R',
        reversed: clip.reversed,
        playbackRate: clip.playbackRate
      });
      clip2.duration = clip.duration - splitPoint;

      delete clips[clipId];
      return [clip1, clip2];
    }

    if (clip.type === 'midi') {
      var midiClip1 = createMIDIClip(clip.trackId, clip.startTime, splitPoint);
      midiClip1.color = clip.color;
      midiClip1.name = clip.name + ' L';

      var midiClip2 = createMIDIClip(clip.trackId, time, clip.duration - splitPoint);
      midiClip2.color = clip.color;
      midiClip2.name = clip.name + ' R';

      for (var i = 0; i < clip.notes.length; i++) {
        var note = clip.notes[i];
        if (note.start + note.duration <= splitPoint) {
          addNote(midiClip1.id, {
            pitch: note.pitch, velocity: note.velocity,
            start: note.start, duration: note.duration, channel: note.channel
          });
        } else if (note.start >= splitPoint) {
          addNote(midiClip2.id, {
            pitch: note.pitch, velocity: note.velocity,
            start: note.start - splitPoint, duration: note.duration, channel: note.channel
          });
        } else {
          // Note spans the split point
          addNote(midiClip1.id, {
            pitch: note.pitch, velocity: note.velocity,
            start: note.start, duration: splitPoint - note.start, channel: note.channel
          });
          addNote(midiClip2.id, {
            pitch: note.pitch, velocity: note.velocity,
            start: 0, duration: note.duration - (splitPoint - note.start), channel: note.channel
          });
        }
      }

      delete clips[clipId];
      return [midiClip1, midiClip2];
    }

    return null;
  }

  function duplicateClip(clipId, newStartTime) {
    var clip = clips[clipId];
    if (!clip) return null;

    if (clip.type === 'audio') {
      var dup = createAudioClip(clip.trackId, newStartTime, clip.audioBuffer, {
        duration: clip.duration,
        offset: clip.offset,
        gain: clip.gain,
        fadeIn: clip.fadeIn,
        fadeOut: clip.fadeOut,
        color: clip.color,
        name: clip.name,
        reversed: clip.reversed,
        playbackRate: clip.playbackRate,
        looped: clip.looped
      });
      dup.duration = clip.duration;
      return dup;
    }

    if (clip.type === 'midi') {
      var mDup = createMIDIClip(clip.trackId, newStartTime, clip.duration);
      mDup.color = clip.color;
      mDup.name = clip.name;
      mDup.looped = clip.looped;
      for (var i = 0; i < clip.notes.length; i++) {
        addNote(mDup.id, clip.notes[i]);
      }
      return mDup;
    }
    return null;
  }

  function moveClip(clipId, newTrackId, newStartTime) {
    var clip = clips[clipId];
    if (!clip) return null;
    clip.trackId = newTrackId;
    clip.startTime = Math.max(0, newStartTime);
    return clip;
  }

  function resizeClip(clipId, newDuration) {
    var clip = clips[clipId];
    if (!clip) return null;
    clip.duration = Math.max(0, newDuration);
    return clip;
  }

  function getClipsForTrack(trackId) {
    var result = [];
    var keys = Object.keys(clips);
    for (var i = 0; i < keys.length; i++) {
      if (clips[keys[i]].trackId === trackId) {
        result.push(clips[keys[i]]);
      }
    }
    return result;
  }

  function getClipsAtTime(time) {
    var result = [];
    var keys = Object.keys(clips);
    for (var i = 0; i < keys.length; i++) {
      var clip = clips[keys[i]];
      if (time >= clip.startTime && time < clip.startTime + clip.duration) {
        result.push(clip);
      }
    }
    return result;
  }

  function deleteClip(clipId) {
    var clip = clips[clipId];
    if (!clip) return null;
    delete clips[clipId];
    return clip;
  }

  return {
    createAudioClip: createAudioClip,
    createMIDIClip: createMIDIClip,
    getClip: getClip,
    getAllClips: getAllClips,
    addNote: addNote,
    removeNote: removeNote,
    updateNote: updateNote,
    splitClip: splitClip,
    duplicateClip: duplicateClip,
    moveClip: moveClip,
    resizeClip: resizeClip,
    getClipsForTrack: getClipsForTrack,
    getClipsAtTime: getClipsAtTime,
    deleteClip: deleteClip
  };
})();
