import { Vector } from "../../SvgPlus/4.js";
import { AccessEvent } from "../../Utilities/Buttons/access-buttons.js";
import { addProcessListener, startProcessing, startWebcam, stopProcessing } from "../../Utilities/webcam.js";
import { Features, SquidlyFeatureWindow } from "../features-interface.js";
import { load } from "./Algorithm/index.js";
import { CalibrationFrame } from "./calibration-frame.js";
import { FeedbackWindow } from "./feedback-frame.js";
import { addPointToHeatmaps, Heatmap } from "./heatmap.js";
import { TestScreen } from "./test-screen.js";

function clampV(v, min, max) {
    return new Vector(
        v.x < min.x ? min.x : (v.x > max.x ? max.x : v.x),
        v.y < min.y ? min.y : (v.y > max.y ? max.y : v.y)
    );
}

function clampV0_1(v) {
    return clampV(v, new Vector(0, 0), new Vector(1, 1));
}

class CalibrationScreenArea extends SquidlyFeatureWindow {
   constructor(){
        super("calibration-window");
        this.calibrationFrame = this.createChild(CalibrationFrame)
   }
}

export default class EyeGazeFeature extends Features {
    /**@type {CalibrationFrame} */
    calibrationFrame = null;

    /**@type {FeedbackWindow} */
    feedbackWindow = null;

    eyeDataListeners = new Set();

    _eyeDataHidden = false;

    _lastEyeGazeState = false;

    constructor(session, sdata) {
        super(session, sdata);

        this.testScreen = new TestScreen();
        this.feedbackWindow = new FeedbackWindow(session, sdata);
        this.calibrationWindow = new CalibrationScreenArea();
        this.dummyFrame = new SquidlyFeatureWindow("div"); // Used to measure calibration frame bbox

        this.calibrationFrame = this.calibrationWindow.calibrationFrame;

        this.feedbackWindow.events = {
            "exit": (e) => e.waitFor(this.session.openWindow("default")),
            "calibrate-participant": (e) => this.startCalibration("participant", e),
            "calibrate-host": (e) => this.startCalibration("host", e),
            "test-participant": (e) => e.waitFor(this._showTestScreen("participant")),
            "test-host": (e) => e.waitFor(this._showTestScreen("host")),
            "open": () => this._openCloseFeedback(true),
            "close": () => this._openCloseFeedback(false)
        }

        // Pass eye data to the test screen
        this.addEyeDataListener((p) => {
            if (this.eyeDataDisabled) p = null;
            this.testScreen.setEyeData(p, this.me);
         })

        // Close the test screen when "close" event is fired
        this.testScreen.events = {
            "close": (e) => e.waitFor(this._showTestScreen(null)),
        }
        
        // Update cursor positions
        this.addEyeDataListener((eyeP, bbox, hidden) => {
            let key = this.sdata.me + "-eyes";
            if (eyeP == null || hidden) {
                this.session.cursors.updateCursorPosition(key, null);
            } else {
                eyeP = clampV0_1(eyeP);
                this.session.cursors.updateCursorPosition(key, eyeP, bbox)
            }
        });

        // Add heatmap eye data listener
        this.addEyeDataListener((eyeP, bbox, hidden) => {
            // add point to heatmaps if the eye position is a Vector
            if (eyeP instanceof Vector && !hidden) {
                let v = clampV0_1(eyeP);
                addPointToHeatmaps(v.x, v.y, 1);
            }
        })
    }

    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ PUBLIC ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */

    set eyeDataHidden(bool) {
        if (bool !== this._eyeDataHidden) {
            this._eyeDataHidden = !!bool;
            this.sdata.set(`hidden/${this.me}`, this._eyeDataHidden);
        }
    }
    get eyeDataHidden() { return this._eyeDataHidden; }


    set eyeGazeOn(bool) {
        bool = !!bool;
        if (bool !== this._eyeGazeOn) {
            this._eyeGazeOn = bool;
            this._updateProcessingState();
            this.session.toolBar.setMenuItemProperty("access/eye/symbol", bool ? "eye" : "noeye");
            this.sdata.set("on", bool);
        }
    }
    get eyeGazeOn() { return this._eyeGazeOn; }


    /**
     * Sets which user's feedback to show in the feedback window
      * @param {"host"|"participant"} user
     */
    setFeebackShownUser(user) {
        this.feedbackWindow.setShownUser(user);
    }

    addEyeDataListener(cb) {
        if (cb instanceof Function) {
            this.eyeDataListeners.add(cb);
        }
    }

    startCalibration(user, e) {
        let p = this.sdata.set(`calibrating/${user}`, true);
        if (e instanceof AccessEvent) e.waitFor(p);
    }
    
    get isProcessing() {
        return this.__isProcessing;
    }
    
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ PRIVATE ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */

    set _isProcessing(bool) {
        bool = !!bool;
        if (bool != this.__isProcessing) {
            if (bool) {
                startProcessing();
            } else {
                stopProcessing();
                console.log("%cEye gaze stopped", "background: rgb(180, 45, 4); font-weight: bold; color: white; padding: 2px 5px; border-radius: 3px;");
                this._lastEyeGazeState = false;
                this.sdata.logChange("eye-gaze.processing", {value: false});
                this._onEyeData(null); // Clear eye data
            }
        }
        this.__isProcessing = bool;
    }

    _updateProcessingState() {
        this._isProcessing = (this._eyeGazeEnabled) && (this._eyeGazeOn || this._feedbackIsOpen || this._calibrating) ;
    } 

    _openCloseFeedback(state){
        this._feedbackIsOpen = state;
        this._updateProcessingState();
    }

    async _showTestScreen(user){
        if (this.testScreen.shownUser !== user) {
            if (user == null) {
                this.session.cursors.updateReferenceArea("fullAspectArea");
                this.testScreen.shownUser = null;
                await this.testScreen.hide();
            } else {
                this.session.cursors.updateReferenceArea("entireScreen");
                await this.testScreen.showFor(user);
            }
            this.sdata.set("test-screen", user)
        }
    }

    _onEyeData(data){
        let eyeP = null;
        let bbox = null;
        
        // If there is a gaze position and the user isn't calibrating
        if (typeof data === "object" && data != null && data.result && !this._calibrating) {
            eyeP = data.result.clone();

            // Get the bounding box of the calibration frame
            bbox = [new Vector(0,0), new Vector(window.innerWidth, window.innerHeight)];

            // Update rest watcher
            // this.restWatcher.set(eyeP.y > 1 ? 1 : 0);

            if (!this.eyeDataHidden && !this._lastEyeGazeState) {
                this._lastEyeGazeState = true;
                console.log("%cEye gaze started", "background: rgb(29, 196, 3); font-weight: bold; color: white; padding: 2px 5px; border-radius: 3px;");
                this.sdata.logChange("eye-gaze.processing", {value: true});
            }

            // If the eye data is disabled and the y-coordinate is less than or equal to 1, set eyeP to null
            if (this.eyeDataHidden && eyeP.y <= 1) {
                eyeP = null;
            }
        }

        this._callEyeDataListeners(eyeP, bbox);
    }

    _callEyeDataListeners(eyeP, bbox) {
        // Update the eye data listeners
        for (let cb of this.eyeDataListeners) {
            try {
                // If eyeP is a Vector, clone it to avoid mutation
                let v = eyeP instanceof Vector ? eyeP.clone() : null;

                // If bbox is an array, clone the vectors to avoid mutation
                let b = Array.isArray(bbox) ? [bbox[0].clone(), bbox[1].clone()] : null;

                // Call the callback with the eye position and bounding box
                cb(v, b, this.eyeDataHidden)
            } catch (e) {
                // console.error(e);
            }
        }
    }

    async _beginCalibrationSequence(bool){
        if (this._calibrating) return;

        if (bool) {
            this._calibrating = true;
            this._updateProcessingState();
            this.session.accessControl.endSwitching(true);
            
            await this.calibrationFrame.show()
            let validation = await this.calibrationFrame.calibrate();

            let mse = null;
            if (validation?.validation?.mse) {
                mse = validation.validation.mse;
            }

            let me = this.sdata.isHost ? "host": "participant";
            await this.sdata.set(`validation/${me}`, mse);
            this.sdata.set(`calibrating/${me}`, false)
            await this.calibrationFrame.hide();
            if (mse) {  
                let onion = validation.sampleStats.avg;
                let acc = Math.round((1 - 2 * mse) * 100);
                this.sdata.logChange("calibration.results", {value: acc})
                this.session.notifications.notify(`Calibration completed with score of ${acc}%`, "success");
                this.feedbackWindow.setOnion(onion);
            }

            this._calibrating = false;
        }
        this._updateProcessingState();
    }

    async initialise(){
        await this.calibrationFrame.loadGuides();
        if (!await startWebcam()) {
            this.throwInitialisationError("Could not start webcam. Please check your camera permissions.", "https://firebasestorage.googleapis.com/v0/b/eyesee-d0a42.appspot.com/o/videopermissions.mp4?alt=media&token=743c04cc-974e-4ed9-bb21-8f0ac56c2d83s");
        }

        this.session.toolBar.addMenuItems("access", [
            {
                name: "calibrate",
                index: 0,
                color: "danger",
                onSelect: e => e.waitFor(this.session.openWindow("eyeGaze"))
            },
            {
                name: "eye",
                text: "eye-gaze",
                index: 45,
                onSelect: () => {
                    this.eyeGazeOn = !this.eyeGazeOn
                }
            }
        ])

        this.session.cursors.updateCursorProperties("host-eyes", {
            size: 50,
            class: "blob",
            text: "host"
        });

        this.session.cursors.updateCursorProperties("participant-eyes", {
            size: 50,
            class: "blob",
            text: "participant"
        });

        this.session.settings.onValue(`${this.sdata.me}/calibration/guide`, (val) => this.calibrationFrame.guide = val);
        this.session.settings.onValue(`${this.sdata.me}/calibration/size`, (val) => this.calibrationFrame.size = val);
        this.session.settings.onValue(`${this.sdata.me}/calibration/speed`, (val) => this.calibrationFrame.speed = val);
        this.session.settings.onValue(`${this.sdata.me}/eye-gaze-enabled`, (val) => {
            console.log("eye-gaze-enabled", val);
            this._eyeGazeEnabled = val === true;
            this._updateProcessingState();
        });

        addProcessListener(this._onEyeData.bind(this));

        await this.feedbackWindow.initialise();

        const {me, them} = this;
        this.session.cursors.addEventListener(them+"-eyes", (e) => {
            this.testScreen.setEyeData(e.screenPos, them);
        })
        
        this.sdata.onValue(`on`, (bool) => {
            if (bool !== null) this._eyeGazeOn = !!bool;
            this.session.toolBar.setMenuItemProperty("access/eye/symbol", this.eyeGazeOn ? "eye" : "noeye");
            this._updateProcessingState();
        });

        this.sdata.onValue(`hidden/${me}`, (val) => {
            if (val !== null) this._eyeDataHidden = !!val;   
        });
        
        // Set calibrating state to null
        await this.sdata.set(`calibrating/${me}`, null);

        // On calibration state change, start the calib
        // ration sequence
        this.sdata.onValue(`calibrating/${me}`, this._beginCalibrationSequence.bind(this));

        let initC = true;

        // Calibration state of the other user
        this.sdata.onValue(`calibrating/${them}`, async (isCalibrating) => {
            this._areTheyCalibrating = isCalibrating;

            // If it isn't the initial onValue call and isCalibrating is either true or false
            if (!initC && isCalibrating !== null) {
                // The other user is calibrating
                if (isCalibrating === true) {
                    this.session.notifications.notify(`The ${them} is calibrating`, "info");
                
                // The other has finished calibrating
                } else {
                    // Check if there is validation data
                    let validationData = await this.sdata.get(`validation/${them}`);

                    // If there is validation data, notify the user of the score
                    if (validationData) {
                        this.session.notifications.notify(`The ${them} has completed calibration with a score of ${Math.round((1 - 2 * validationData) * 100)}%`, "success");
                    
                    // Otherwise, notify the user that the calibration was cancelled
                    }else {
                        this.session.notifications.notify(`The ${them} has cancelled calibration`, "error");
                    }
                }
            }
            initC = false;
        });

        // Opening and closing the test window 
        this.sdata.onValue("test-screen", (val) => {
            this._showTestScreen(val);
        })
    }

    createHeatmap(resolution = 300, kernal = 30) {
        return new Heatmap(resolution, kernal);
    }

    get me() { return this.sdata.me } 
    get them() { return this.sdata.them }

    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ STATIC ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */

    static async loadResources() {
        await Promise.all([
            load(), 
            FeedbackWindow.loadStyleSheets()
        ]);
    }

    static get layers() {
        return {
            feedbackWindow: {   // EyeGaze feedback window
                type: "area",
                area: "fullAspectArea",
                index: 85,
                mode: "occupy",
                name: "main",
                fix: {
                    toolbar: true
                }
            },
            calibrationWindow: { // Calibration window
                type: "area",
                area: "entireScreen",
                index: 500,
                mode: "overlay",
            },
            testScreen: { // Test window
                type: "area",
                area: "entireScreen",
                index: 215,
                mode: "overlay",
            }
        };
    }

    static get name() {
        return "eyeGaze";
    }

    static get firebaseName(){
        return "eye-gaze";
    }
}
