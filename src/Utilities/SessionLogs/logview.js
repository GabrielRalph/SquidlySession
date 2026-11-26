import { SvgPlus } from "../../SvgPlus/4.js"
import { DiscreteHeatmap } from "../discreteHeatmap.js";
const example1 = {
    "calibrationScores": [],
    "settings": [],
    "metadata": {
      "duration": 8.356633333333333,
      "time": 1780459681757,
      "profile": "default"
    },
    "apps": [
      [
        "letter-app",
        {
          "duration": 1.795116666666667,
          "host": {
            "interactions": {
              "click": 0,
              "dwell": 0,
              "switch": 0
            },
            "heatmaps": {
              "0": "AAAAAAoAAAAKAAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAgAAABUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAEQAAAAHAAAAFQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAANAAAABQAAABYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAADsAAAALAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="
            }
          },
          "participant": {
            "interactions": {
              "click": 0,
              "dwell": 0,
              "switch": 0
            },
            "heatmaps": {
              "0": "AAAAAAoAAAAKAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABoAAAAgAAAABgAAABsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAmAAAALAEAAJgAAABhAAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACgAAAAAAAABYAAAAMQAAAIgAAAAKAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAgAAAAAAAAAFgAAAAAAAAAAAAAAAAAAAAAAAAAFAAAAAAAAAAAAAAAKAAAAAAAAABIAAAAAAAAAAAAAAAAAAAAAAAAACgAAAAAAAAAAAAAAAwAAAAAAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="
            }
          }
        }
      ],
      [
        "fruit-ninja-3d",
        {
          "duration": 0.09013333333333333,
          "host": {
            "interactions": {
              "click": 0,
              "dwell": 0,
              "switch": 0
            },
            "heatmaps": {
              "0": "AAAAAAoAAAAKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJAAAABEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADkAAAARAAAAWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+AAAARgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="
            }
          },
          "participant": {
            "interactions": {
              "click": 0,
              "dwell": 0,
              "switch": 0
            },
            "heatmaps": {}
          }
        }
      ],
      [
        "LampAAC",
        {
          "duration": 3.3816166666666665,
          "host": {
            "interactions": {
              "click": 18,
              "dwell": 0,
              "switch": 0
            },
            "heatmaps": {
              "0": "AAAAAAoAAAAKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABMAAAAeAAAADQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKAAAACMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYAAAAKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="
            }
          },
          "participant": {
            "interactions": {
              "click": 76,
              "dwell": 0,
              "switch": 0
            },
            "heatmaps": {
              "0": "AAAAAAoAAAAKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA6AAAAAgAAAAAAAAAaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAFAAAAPgAAAA8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKAAAADAAAABkAAABIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADEAAACLAAAAawAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABYAAAAfwAAAMkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHQAAAAIAAAB1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="
            }
          }
        }
      ]
    ],
    "quizzes": [],
    "aac": [],
    "access": {
      "eye-gaze": 0,
      "switch": 0
    }
}

const example2 ={
    "calibrationScores": [],
    "settings": [],
    "metadata": {
      "duration": 183.29471666666666,
      "time": 1780466008703,
      "profile": "default"
    },
    "apps": [
      [
        "Noci",
        {
          "duration": 2.26405,
          "host": {
            "interactions": {
              "click": 48,
              "dwell": 0,
              "switch": 0
            },
            "heatmaps": {
              "0": "AAAAAAoAAAAKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAGkAAAAAAAAAAAAAABcAAAA6AAAACAAAAAsAAAABAAAACQAAAGUAAABZAgAAFAAAAAAAAAAEAAAAQwAAABgAAAAKAAAACAAAAB0AAACFAAAAowEAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAwAAAAMAAAAEAAAAnQAAAFsAAAAAAAAAAAAAAAAAAAAAAAAAEQAAAAEAAAAAAAAAPAAAAKUAAABcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAAAHQAAACsAAAC0AAAAOgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACEAAABKAAAA0wAAAGMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABXAAAAWAAAAJsAAAAjAQAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJgAAADcAAAA2AAAAgQEAABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeAAAABQAAADgAAAAHAAAACgAAAA=="
            }
          },
          "participant": {
            "interactions": {
              "click": 4,
              "dwell": 6,
              "switch": 0
            },
            "heatmaps": {
              "0": "AAAAAAoAAAAKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAHAAAAAAAAAA4AAAADAAAAAQAAAAIAAAAAAAAAAAAAAAAAAAAFAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAEAAAAKAAAACAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAANAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACMAAAABAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
              "1": "AQAAAAoAAAAKAAAAAAAAAAAAAAAAAAAABwAAAAIAAAAPAAAAFwAAAD0AAAAmAAAAJwAAAAAAAAAAAAAAEAAAAAUAAAARAAAADQAAACEAAABAAAAAXwAAAJcAAAAAAAAAAAAAAAAAAAAFAAAABwAAAAsAAAAbAAAAEgAAADQAAAB+AAAACQAAAAMAAAADAAAAFAAAAAoAAAAjAAAAIQAAABMAAAAJAAAAIgAAAAsAAAAJAAAACgAAAB0AAAAWAAAAQAAAACoAAAAVAAAAAAAAAAYAAAAHAAAABwAAABcAAAANAAAAGwAAABgAAAASAAAAEQAAAAMAAAABAAAABQAAAAkAAAARAAAABwAAAA0AAAALAAAAFgAAAD4AAAAqAAAAHAAAAAAAAAAAAAAAGQAAABAAAAA2AAAANQAAAFkAAABsAAAAFgAAAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAASAAAAJAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAA=="
            }
          }
        }
      ],
      [
        "LampAAC",
        {
          "duration": 0.5946,
          "host": {
            "interactions": {
              "click": 0,
              "dwell": 0,
              "switch": 0
            },
            "heatmaps": {
              "0": "AAAAAAoAAAAKAAAABQAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABaAAAABQAAAAAAAAAAAAAAAAAAAAAAAAA8AAAAAgAAAAIAAAAlAAAASwAAAAgAAAAGAAAABwAAAAAAAAAeAAAAiAEAAAEAAAAAAAAAAQAAAAcAAABCAAAAAQAAAAMAAAAZAAAASwAAAAgAAAAAAAAAAAAAAAEAAAAAAAAADQAAABAAAAAnAAAAOQAAABcAAAAAAAAAAAAAAAAAAAABAAAAAAAAAB8AAAAgAAAAGAAAAAIAAAAxAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAVAAAABAAAAAAAAAAAAAAAEQAAAAAAAAAAAAAAAAAAAAIAAAACAAAALwAAABgAAAAHAAAAAAAAABMAAAAAAAAAAAAAAAAAAADqAAAATQAAAAIAAAAAAAAADgAAABEAAAAWAAAAJAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACgAAAAAAAAAAAAAAA=="
            }
          },
          "participant": {
            "interactions": {
              "click": 0,
              "dwell": 0,
              "switch": 0
            },
            "heatmaps": {}
          }
        }
      ],
      [
        "letter-app",
        {
          "duration": 98.88128333333333,
          "host": {
            "interactions": {
              "click": 0,
              "dwell": 0,
              "switch": 0
            },
            "heatmaps": {
              "0": "AAAAAAoAAAAKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAFwHAABHAAAArwMAAAAAAAB1AAAAEwAAAAQAAAABAAAAAgAAAA4AAABtAAAAAAAAAJUAAAAAAAAALQAAAAIAAAAAAAAAAAAAAAYAAAAMAAAAAAAAAAUAAAAEAAAAAAAAAAQAAAAGAAAAAAAAAAUAAAAAAAAABQAAAAsAAAACAAAAAAAAAAAAAAACAAAADwAAADQAAAAIAAAAMQAAAAgAAAAAAAAABAAAAAAAAAAAAAAAAwAAABkAAAAKAAAABgAAAAsAAAAKAAAAAQAAAAAAAAACAAAAAAAAAAMAAAAYAAAADgAAABYAAAASAAAAEAAAAAsAAAAUAAAAAAAAAAAAAAAUAAAAGwAAAAkAAAAPAAAAGwAAAEEAAAAJAAAAFwAAAAAAAAAAAAAAsQAAAFQAAAAAAAAAAAAAAAAAAABkAAAAEgAAAAAAAAAAAAAAAAAAAA8AAAAKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="
            }
          },
          "participant": {
            "interactions": {
              "click": 0,
              "dwell": 0,
              "switch": 0
            },
            "heatmaps": {
              "0": "AAAAAAoAAAAKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAsAAAAAAAAAAEAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKAAAAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAABEAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAADAAAAA8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="
            }
          }
        }
      ],
      [
        "Quick Core 40",
        {
          "duration": 5.3525833333333335,
          "host": {
            "interactions": {
              "click": 11,
              "dwell": 5,
              "switch": 4
            },
            "heatmaps": {
              "0": "AAAAAAoAAAAKAAAAAAAAAA0AAAACAAAABQAAAAEAAAACAAAAAQAAAAIAAACuAAAAvwAAABgAAACCAAAAPQAAABIAAAALAAAANwAAAAkAAAAIAAAAXgEAAJkAAAAAAAAAAgAAACsAAAAFAAAAFQAAABEAAAAAAAAAAAAAACcAAAAAAAAAAAAAABUAAAAMAAAACQAAACoAAAAbAAAAGgAAAAgAAAAuAAAAAQAAAAAAAAAuAAAABAAAAAQAAAAAAAAACAAAAFgAAAAWAAAAYAAAAAUAAAAAAAAAIgAAACQAAACzAAAATwAAAGUAAABXAQAAhwAAAAoAAAAAAAAAAAAAAB8AAABPAAAA7gAAAFwAAAAyAAAAHQAAAEIAAABZAAAADwAAAAAAAABWAAAAJAAAAAAAAAAAAAAAAAAAAAUAAAAsAAAAEwAAAAEAAAAXAAAAfQAAAAkAAAAJAAAAEwAAAAQAAAAPAAAAGgAAAGsAAAAKAAAAAAAAAA0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA6AAAAPAAAAA==",
              "1": "AQAAAAoAAAAKAAAAsQAAABoAAAAdAAAAJwAAAA0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGsAAAAoAAAAJgAAABQAAAAQAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAApAAAAMwAAABMAAAAbAAAAHAAAAA8AAAAAAAAAAAAAAAAAAAAAAAAACQAAAA0AAAAhAAAANQAAABwAAAAaAAAABwAAAAAAAAAAAAAAAAAAABUAAAAZAAAALAAAAAwAAAApAAAAKgAAAA0AAAAAAAAAAAAAAAAAAAANAAAAIQAAADEAAAAmAAAAHAAAACcAAAAfAAAAAAAAAAAAAAAAAAAABgAAAAUAAAAKAAAAQgAAABgAAAAUAAAAGAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAgAAAAgAAAAQAAAAMAAAAA8AAAANAAAACgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="
            }
          },
          "participant": {
            "interactions": {
              "click": 2,
              "dwell": 0,
              "switch": 0
            },
            "heatmaps": {
              "0": "AAAAAAoAAAAKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACyAAAAKgAAABcAAAAXAAAADwAAABUAAAASAAAAIQAAAAAAAAAAAAAALQAAAB4AAAACAAAAGgAAAA0AAAAAAAAAKAAAAD8AAAABAAAAAAAAAAAAAAAVAAAADwAAABsAAAANAAAADQAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAUAAABEAAAAOQAAABwAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAFwAAAC0AAAADAAAAFwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAaAAAAAAAAABgAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABgAAACMAAAAAAAAAAQAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWwAAAA4AAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJ8AAAAAAAAAAAAAAA==",
              "1": "AQAAAAoAAAAKAAAAOwAAAAEAAAAAAAAAJQAAAAcAAAAFAAAAIgAAABcAAAAPAAAAKwAAABYAAAADAAAAAAAAAAAAAAADAAAAEgAAAAgAAAAHAAAAAgAAABgAAAAsAAAABAAAAAEAAAADAAAABwAAABkAAAAuAAAABQAAAAUAAAAeAAAAIwAAAAUAAAADAAAAAQAAAA4AAAAaAAAADgAAAAQAAAADAAAAFgAAABAAAAADAAAAAwAAAAIAAAAAAAAAHQAAAAcAAAAJAAAAAQAAACgAAAASAAAAAQAAAAIAAAAEAAAAAAAAAAAAAAADAAAADwAAAAgAAAAiAAAAKAAAAAMAAAAAAAAAAgAAAAIAAAAAAAAABgAAAAUAAAACAAAAEQAAAA8AAAAFAAAABQAAAAQAAAANAAAACAAAAAwAAAADAAAAAwAAAAkAAAACAAAAAQAAAAMAAAAAAAAAAAAAAAIAAAAGAAAADgAAAAkAAAACAAAAAwAAAAIAAAADAAAAAAAAAAAAAAAFAAAAAwAAABgAAAAuAAAASQAAAA=="
            }
          }
        }
      ]
    ],
    "quizzes": [],
    "aac": [],
    "access": {
      "eye-gaze": 4.208983333333333,
      "switch": 0
    }
  }
const mode2name = {
    "0": "Mouse",
    "1": "Eye Gaze"
}
// for (let [appName, appData] of example2.apps) {
//     for (let userType of ["host", "participant"]) {
//         for (let i in appData[userType].heatmaps) {
            
//         }
//     }
// }

/**
 * @param {number} minutes - The duration in minutes to format.
 */
function formatMinutes(minutes) {
  let res = ""
  if (typeof minutes === "boolean") {
    res = minutes ? "On" : "Off";
  } else if (minutes < 1) {
    res =  `${Math.round(minutes * 60)}s`;
  } else if (minutes < 60) {
    const minute1dp = minutes.toFixed(1);
    if (minute1dp.endsWith(".0")) {
      res = `${Math.round(minutes)}m`;
    } else {
      res = `${minute1dp}m`;
    }
  } else {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.round(minutes % 60);
    if (remainingMinutes === 0) {
      res = `${hours}h`;
    } else {
      res = `${hours}h ${remainingMinutes}m`;
    }
  }
  return res;
}


function getValueElement(value) {
    if (Array.isArray(value)) {
        return new ArrayView(value);
    } else if (value instanceof Element) {
        return value;
    } else if (typeof value === "object") {
        return new JSONView(value);
    } else {
        let e = new SvgPlus("div");
        e.props = {class: "value", content: value+""};
        return e;
    } 
}

class KeyValue extends SvgPlus {
    constructor(key, value) {
        super("div");
        this.class = "key-value";
        this.createChild("div", {class: "key", content: key});
        this.createChild("div", {class: "value", content: value});
    }
}

class AppUserDataView extends SvgPlus {
    constructor(user, data) {
        super("div");
        this.class = "user-data-view";
        this.createChild("div", {class: "user-type", content: user});
        let main = this.createChild("main");
        let dataTable = main.createChild("div", {class: "data"});

        let totalInteractions = Object.values(data.interactions).reduce((a, b) => a + b, 0);
        dataTable.createChild(KeyValue, {styles: {"font-weight": "bold"}}, "Interactions", totalInteractions);
        for (let key in data.interactions) {
            let value = data.interactions[key];
            if (value > 0)
                dataTable.createChild(KeyValue, {styles: {"margin-left": "1em"}}, key, data.interactions[key]);
        }

        for (let mode of [0, 1]){
            let heatmap = data.heatmaps[mode]; 
            let svg = "";
            if (heatmap) {
                heatmap = DiscreteHeatmap.fromString(heatmap);
                svg = heatmap.getSVG(1, {
                    width: 250,
                    title: mode2name[heatmap.mode] + " Heatmap"
                });
            }
            main.createChild("div", {class: "heatmap-container", content: svg});
        }
    }
}

class AppView extends SvgPlus {
    constructor(appName, appData) {
        super("div");
        this.class = "app-view";
        let t = this.createChild("div", {class: "app-title"});
        t.createChild("div", {class: "app-name", content: appName});
        t.createChild("div", {class: "app-duration", content: formatMinutes(appData.duration)});
        this.createChild(AppUserDataView, {}, "Host Data", appData.host);
        this.createChild(AppUserDataView, {}, "Participant Data", appData.participant);
    }
}

class AppInfoPopup extends SvgPlus {
    constructor(apps) {
        super("div");
        this.class = "app-info-popup";
        let list = this.createChild("div", {class: "list"});
        let main = this.createChild("div", {class: "info-area"});
        let items = apps.map(([appName, appData]) => {
            let app = new AppView(appName, appData);
            let item = list.createChild("div", {class: "list-item", content: appName});
            item.addEventListener("click", () => {
                main.innerHTML = "";
                main.appendChild(app);
                [...list.children].forEach(child =>child.toggleAttribute("selected", child === item));
            });
            return item;
        });
        
        items[0].click();
    }
}



document.body.appendChild(new AppInfoPopup(example2.apps));