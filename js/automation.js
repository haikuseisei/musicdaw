var DAW = DAW || {};

DAW.Automation = (function () {
  var lanes = {};
  var nextLaneId = 1;
  var nextPointId = 1;

  var recordingLane = null;
  var recordedPoints = [];

  function generateLaneId() {
    return 'lane_' + (nextLaneId++);
  }

  function generatePointId() {
    return 'point_' + (nextPointId++);
  }

  function createLane(trackId, parameter) {
    var lane = {
      id: generateLaneId(),
      trackId: trackId,
      parameter: parameter,
      points: [],
      visible: true,
      armed: false
    };
    lanes[lane.id] = lane;
    return lane;
  }

  function getLane(laneId) {
    return lanes[laneId] || null;
  }

  function getLanes(trackId) {
    var result = [];
    var keys = Object.keys(lanes);
    for (var i = 0; i < keys.length; i++) {
      if (lanes[keys[i]].trackId === trackId) {
        result.push(lanes[keys[i]]);
      }
    }
    return result;
  }

  function getLaneByParam(trackId, parameter) {
    var keys = Object.keys(lanes);
    for (var i = 0; i < keys.length; i++) {
      var lane = lanes[keys[i]];
      if (lane.trackId === trackId && lane.parameter === parameter) {
        return lane;
      }
    }
    return null;
  }

  function deleteLane(laneId) {
    var lane = lanes[laneId];
    if (!lane) return null;
    delete lanes[laneId];
    return lane;
  }

  function sortPoints(lane) {
    lane.points.sort(function (a, b) {
      return a.time - b.time;
    });
  }

  function addPoint(laneId, time, value, curve) {
    var lane = lanes[laneId];
    if (!lane) return null;

    if (time < 0) time = 0;
    if (value < 0) value = 0;
    if (value > 1) value = 1;

    var validCurves = ['linear', 'exponential', 'step', 'bezier'];
    if (validCurves.indexOf(curve) === -1) {
      curve = 'linear';
    }

    var point = {
      id: generatePointId(),
      time: time,
      value: value,
      curve: curve
    };

    lane.points.push(point);
    sortPoints(lane);
    return point;
  }

  function removePoint(laneId, pointId) {
    var lane = lanes[laneId];
    if (!lane) return null;

    for (var i = 0; i < lane.points.length; i++) {
      if (lane.points[i].id === pointId) {
        return lane.points.splice(i, 1)[0];
      }
    }
    return null;
  }

  function movePoint(laneId, pointId, newTime, newValue) {
    var lane = lanes[laneId];
    if (!lane) return null;

    for (var i = 0; i < lane.points.length; i++) {
      if (lane.points[i].id === pointId) {
        if (typeof newTime === 'number') {
          lane.points[i].time = Math.max(0, newTime);
        }
        if (typeof newValue === 'number') {
          lane.points[i].value = Math.max(0, Math.min(1, newValue));
        }
        sortPoints(lane);
        return lane.points[i];
      }
    }
    return null;
  }

  function interpolateLinear(p1, p2, time) {
    var t = (time - p1.time) / (p2.time - p1.time);
    return p1.value + (p2.value - p1.value) * t;
  }

  function interpolateExponential(p1, p2, time) {
    var t = (time - p1.time) / (p2.time - p1.time);
    var v1 = Math.max(p1.value, 0.0001);
    var v2 = Math.max(p2.value, 0.0001);
    return v1 * Math.pow(v2 / v1, t);
  }

  function interpolateStep(p1) {
    return p1.value;
  }

  function interpolateBezier(p1, p2, time) {
    // Approximate bezier with eased linear (ease-in-out)
    var t = (time - p1.time) / (p2.time - p1.time);
    var ease = t * t * (3 - 2 * t); // smoothstep
    return p1.value + (p2.value - p1.value) * ease;
  }

  function getValueAtTime(laneId, time) {
    var lane = lanes[laneId];
    if (!lane || lane.points.length === 0) return null;

    var points = lane.points;

    // Before first point
    if (time <= points[0].time) {
      return points[0].value;
    }

    // After last point
    if (time >= points[points.length - 1].time) {
      return points[points.length - 1].value;
    }

    // Find surrounding points
    for (var i = 0; i < points.length - 1; i++) {
      if (time >= points[i].time && time < points[i + 1].time) {
        var p1 = points[i];
        var p2 = points[i + 1];

        switch (p1.curve) {
          case 'exponential':
            return interpolateExponential(p1, p2, time);
          case 'step':
            return interpolateStep(p1);
          case 'bezier':
            return interpolateBezier(p1, p2, time);
          case 'linear':
          default:
            return interpolateLinear(p1, p2, time);
        }
      }
    }

    return points[points.length - 1].value;
  }

  function clearRange(laneId, startTime, endTime) {
    var lane = lanes[laneId];
    if (!lane) return;

    var remaining = [];
    for (var i = 0; i < lane.points.length; i++) {
      if (lane.points[i].time < startTime || lane.points[i].time > endTime) {
        remaining.push(lane.points[i]);
      }
    }
    lane.points = remaining;
  }

  function startRecording(laneId) {
    var lane = lanes[laneId];
    if (!lane) return;
    recordingLane = laneId;
    recordedPoints = [];
    lane.armed = true;
  }

  function recordValue(time, value) {
    if (!recordingLane) return;
    recordedPoints.push({ time: time, value: value });
  }

  function stopRecording(thinThreshold) {
    if (!recordingLane) return [];

    var lane = lanes[recordingLane];
    if (!lane) {
      recordingLane = null;
      recordedPoints = [];
      return [];
    }

    // Thin the recorded points to reduce density
    var threshold = thinThreshold || 0.01;
    var thinned = [];
    for (var i = 0; i < recordedPoints.length; i++) {
      if (thinned.length < 2) {
        thinned.push(recordedPoints[i]);
        continue;
      }
      var last = thinned[thinned.length - 1];
      var diff = Math.abs(recordedPoints[i].value - last.value);
      if (diff >= threshold) {
        thinned.push(recordedPoints[i]);
      }
    }
    // Always include last point
    if (recordedPoints.length > 0) {
      var lastRec = recordedPoints[recordedPoints.length - 1];
      if (thinned.length === 0 || thinned[thinned.length - 1].time !== lastRec.time) {
        thinned.push(lastRec);
      }
    }

    // Add thinned points to the lane
    for (var j = 0; j < thinned.length; j++) {
      addPoint(recordingLane, thinned[j].time, thinned[j].value, 'linear');
    }

    lane.armed = false;
    var result = thinned.slice();
    recordingLane = null;
    recordedPoints = [];
    return result;
  }

  function getCommonParameters() {
    return [
      'volume', 'pan', 'mute',
      'send1', 'send2', 'send3', 'send4',
      'eq_low', 'eq_mid', 'eq_high',
      'compressor_threshold', 'compressor_ratio',
      'reverb_mix', 'delay_mix', 'delay_time',
      'filter_cutoff', 'filter_resonance'
    ];
  }

  return {
    createLane: createLane,
    getLane: getLane,
    getLanes: getLanes,
    getLaneByParam: getLaneByParam,
    deleteLane: deleteLane,

    addPoint: addPoint,
    removePoint: removePoint,
    movePoint: movePoint,

    getValueAtTime: getValueAtTime,
    clearRange: clearRange,

    startRecording: startRecording,
    recordValue: recordValue,
    stopRecording: stopRecording,

    getCommonParameters: getCommonParameters
  };
})();
