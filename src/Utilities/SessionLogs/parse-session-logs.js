import { DiscreteHeatmap } from "../discreteHeatmap.js";

function logDuration(log1, log2) {
  return (log2.time - log1.time) / (1000 * 60); // duration in minutes
}

/**
 * @typedef {Object} LogMetadata
 * @property {number} duration - Duration of the session in minutes.
 * @property {string} date - Date of the session in "DD MMM YYYY" format.
 * @property {string} time - Start time of the session in "h:mm AM/PM" format.
 * @property {string|("default")} profile - profile id or "default"
 * 
 * 
 * @typedef {Object} SessionLogData
 * @property {LogMetadata} metadata - Metadata about the session.
 * @property {Array.<number>} calibrationScores - Array of calibration scores recorded during the session.
 * @property {[string, Object][]} apps - Object mapping app names to total time spent in minutes.
 * @property {[string, number][]} quizzes - Object mapping quiz names to total time spent in minutes.
 * @property {[string, boolean][]} aac - Array of AAC words used during the session, with a boolean indicating if it was the host or not.
 * @property {[string, {newValue: string, oldValue:string}][]} settings - Object mapping setting names to their old and new values.
 * @property {Object<string, boolean>} access - Object indicating access methods used (e.g., eye-gaze, switch).
 */


/**
 * Parses an array of session logs and extracts meaningful data about the session.
 * @param {Array.<Object>} logsArr - Array of log objects, each containing keys like 'key', 'value', 'time', 'isHost', and 'note'.
 * @returns {?SessionLogData} An object containing structured data about the session, including metadata, calibration scores, app usage, quiz usage, AAC words, settings changes, and access methods.
 */
export function parseSessionLogs(logsArr) {
  if (logsArr.length === 0 || logsArr.every(log => log.isHost)) {
    return null;
  }

  const sessionData = {
    "calibrationScores": [],
    "settings": {}, 
    "metadata": {},
    "apps": {},
    "quizzes": {}, 
    "aac": [],
    "access": {
      "eye-gaze": 0,
      "switch": 0
    },
  }

  // Metadata
  const [firstLog, lastLog] = [logsArr[0], logsArr[logsArr.length - 1]];
  
  sessionData.metadata = { 
    duration: logDuration(firstLog, lastLog),
    time: firstLog.time,
  };

  let currentApp = null;
  
  for (let i = 0; i < logsArr.length; i++) {
    const log = logsArr[i];

    function durationToNextLog(method) {
      const nextLog = logsArr.slice(i + 1).find(method) || lastLog; // If no more logs, use the last log as the end time
      return logDuration(log, nextLog);
    }
    
    switch (log.key) {

      case "window.open":
        if (log.value === "apps" && currentApp) {
            sessionData.apps[currentApp].duration += durationToNextLog((l) => 
                l.key == "window.open" || l.key == "app.selected"
            )
        }
        break;
   
      case "calibration.results":
        sessionData.calibrationScores.push([log.value, log.isHost]);
        break;

      case "app.selected":
        const appName = log.value;
        currentApp = appName;
        if (!sessionData.apps[appName]) sessionData.apps[appName] = {
            duration: 0, 
            host: {
                interactions: {click: 0, dwell: 0, switch: 0}, 
                heatmaps: {}
            },
            participant: {
                interactions: {click: 0, dwell: 0, switch: 0}, 
                heatmaps: {}
            },
        };
        sessionData.apps[appName].duration += durationToNextLog((l) => 
          l.key == "window.open" || l.key == "app.selected"
        )
        break;

      case "app.interaction":
        if (sessionData.apps[currentApp]) {
          const userType = log.isHost ? "host" : "participant";
          sessionData.apps[currentApp][userType].interactions[log.value] += 1;
        }
        break;
     
      case "app.heatmap":
        if (sessionData.apps[log.note]) {
            const userType = log.isHost ? "host" : "participant";
            let heatmap = DiscreteHeatmap.fromString(log.value);
            const lastHeatmap = sessionData.apps[log.note][userType].heatmaps[heatmap.mode];
            if (lastHeatmap) {
                heatmap = heatmap.add(lastHeatmap);
            }
            sessionData.apps[log.note][userType].heatmaps[heatmap.mode] = heatmap;
        }
        break;

      case "quiz.start":
        const quizID = log.note;
        if (!sessionData.quizzes[quizID]) sessionData.quizzes[quizID] = 0;
        sessionData.quizzes[quizID] += durationToNextLog((l) =>
          l.key == "window.open" || l.key == "quiz.start"
        )
        break;

      case "aac.word":
        if (sessionData.aac.at(-1)?.[0] !== log.value) {
          sessionData.aac.push([log.value, log.isHost]);
        }
        break;

      case "access.switch":
        if (!log.isHost && log.value) {
          sessionData.access["switch"] += durationToNextLog((l) =>
            l.key == "access.switch" && l.isHost === log.isHost
          );
        }
        break;

      case "eye-gaze.processing":
        if (!log.isHost && log.value) {
          // Find the duration from turning the eye-gaze on until the 
          // next time it is turned off or the session ends
          sessionData.access["eye-gaze"] += durationToNextLog((l) =>
            l.key == "eye-gaze.processing" && l.isHost === log.isHost
          );
        }
        break;

      case "settings.value":
        const settingKey = log.note;
        if (!settingKey.startsWith("host")) {
          if (sessionData.settings[log.note]) {
            sessionData.settings[log.note].newValue = log.value;
          } else {
            sessionData.settings[log.note] = {
              oldValue: log.oldValue,
              newValue: log.value,
            };
          } 

          if (settingKey.endsWith("eye-gaze-enabled")) {
            eyeGazeDisabled = !log.value;
          }
        }
        break;

      case "settings.profile": 
        sessionData.metadata["profile"] = log.value;
        sessionData.settings = {};
        break;
     
      default:
        break;
    }
  }
  sessionData.apps = Object.entries(sessionData.apps);
  sessionData.quizzes = Object.entries(sessionData.quizzes);
  sessionData.settings = Object.entries(sessionData.settings);

  if (!sessionData.metadata["profile"]) {
    sessionData.metadata["profile"] = "default";
  }
  return sessionData;
}
