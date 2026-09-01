import { getStream, startWebcam } from "../../Utilities/webcam.js";
import { Features } from "../features-interface.js";
import { setupVoiceDetection } from "./AudioUtils/voice-detector.js";
import { getHostPresets } from "./presets.js";
import { RTCSignaler } from "../../Utilities/WebRTC/rtc-signaler.js";
import * as WebRTC from "../../Utilities/WebRTC/webrtc-base.js"
import { VideoPanelWidget } from "./widgets.js";
import { addDeviceChangeCallback } from "../../Utilities/device-manager.js";
import {
    background,
    setBackgroundEffect as applyBackgroundEffect,
    setBeautyStrength as applyBeautyStrength,
} from "./background.js";



function getDefaulIceServers(){
    return {iceServers: [
        {urls: "stun:stun.l.google.com:19302"},
        {urls: "stun:stun1.l.google.com:19302"},
        {urls: "stun:stun2.l.google.com:19302"},
        {urls: "stun:stun3.l.google.com:19302"},
        {urls: "stun:stun4.l.google.com:19302"},
        {urls: "stun:stun01.sipphone.com"},
        {urls: "stun:stun.ekiga.net"},
        {urls: "stun:stun.fwdnet.net"},
        {urls: "stun:stun.ideasip.com"},
        {urls: "stun:stun.iptel.org"},
        {urls: "stun:stun.rixtelecom.se"},
        {urls: "stun:stun.schlund.de"},
        {urls: "stun:stunserver.org"},
        {urls: "stun:stun.softjoys.com"},
        {urls: "stun:stun.voiparound.com"},
        {urls: "stun:stun.voipbuster.com"},
        {urls: "stun:stun.voipstunt.com"},
        {urls: "stun:stun.voxgratia.org"},
        {urls: "stun:stun.xten.com"},
        {urls: "stun:stun.xten.com"},
        {urls: "turn:13.239.38.47:80?transport=udp", 
        credential: "key1", username: "username1"},
        {urls: "turn:13.239.38.47:80?transport=tcp", 
        credential: "key1", username: "username1"},
        {urls: "stun:stun.xten.com"},
    ]}
}

const MuteIconNames = {
    video: ["novideo", "video"],
    audio: ["mute", "unmute"]
}

const DATA_DELIMITER = ":::"
const MAX_BACKGROUND_IMAGE_BYTES = 20 * 1024 * 1024;

async function decodeBackgroundImage(file) {
    if (!(file instanceof File) || !file.type.startsWith("image/")) {
        throw new TypeError("Please select an image file.");
    }
    if (file.size > MAX_BACKGROUND_IMAGE_BYTES) {
        throw new RangeError("Background images must be 20 MB or smaller.");
    }

    if (typeof createImageBitmap === "function") {
        try {
            return await createImageBitmap(file, { imageOrientation: "from-image" });
        } catch {
            return await createImageBitmap(file);
        }
    }

    const url = URL.createObjectURL(file);
    try {
        const image = new Image();
        image.decoding = "async";
        image.src = url;
        await image.decode();
        return image;
    } finally {
        URL.revokeObjectURL(url);
    }
}

function dummyVideo() {
    let video = document.createElement("video");
    video.width = 640;
    video.height = 480;
    video.toggleAttribute("autoplay", true);
    video.toggleAttribute("playsinline", true);
    video.style.position = "fixed";
    video.style.left = "0";
    video.style.top = "0";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.zIndex = "-1";
    video.style.opacity = "0";
    return video;
}
export default class VideoCall extends Features {
    _backgroundEffectAvailable = false;
    _backgroundImageAvailable = false;
    _backgroundEffectMode = "none";
    _backgroundEffectTransition = null;
    _backgroundImageName = null;
    _beautyEffectAvailable = false;
    _beautyStrength = 0;
    _beautyControl = null;

    _muteState = {
        host: {
            video: undefined,
            audio: undefined
        },
        participant: {
            video: undefined,
            audio: undefined,
        }
    }
    
    /**
     * @param {import("../features-interface.js").SquidlySession} session
     * @param {import("../features-interface.js").SessionDataFrame} sdata
     */
    constructor(session, sdata){
        super(session, sdata);
        this.topPanelWidget = new VideoPanelWidget();
        this.sidePanelWidget = new VideoPanelWidget();
        this.mainAreaWidget = new VideoPanelWidget();

        this.mainAreaWidget.isVisibleForUser = () => !session.isOccupied
        this.sidePanelWidget.isVisibleForUser = () => session.getToggleState("sidePanel").some(s => s === true);
        this.topPanelWidget.isVisibleForUser = () => session.getToggleState("topPanel").some(s => s === true);
        

        /** @type {[VideoPanelWidget]} */
        this._allWidgets = [this.topPanelWidget, this.sidePanelWidget, this.mainAreaWidget]

        // store video elements for each user
        /** @type {Object.<string, HTMLVideoElement>} */
        this.videos = {
            host: dummyVideo(),
            participant: dummyVideo()
        }
        this.videos[sdata.me].muted = true;
       
        this._setupVideoFrameCapture();
        this._setWidgetEvents();
    }

    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ PRIVATE ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */


    _setupVideoFrameCapture(){
         // For each video, set up a loop to capture frames and send them to the widgets
        for (let user in this.videos) {
            const video = this.videos[user];

            this.mainAreaWidget.appendChild(video); // needed to get frames from some browsers
           
            if (!video.requestVideoFrameCallback instanceof Function) {
                video.requestVideoFrameCallback = window.requestAnimationFrame.bind(window);
            }
            let next = () => {
                if (video.videoWidth > 5 && video.videoHeight > 5) {
                    this._setWidgetWaitingState(user, false);
                }
                for (let w of this._allWidgets) {
                    if (w.isVisibleForUser()) {
                        w[user].captureFrame(this._muteState[user].video ? video : null);
                    }
                }
                video.requestVideoFrameCallback(next);
            }
            video.requestVideoFrameCallback(next);
        }

    }


    /**
     * Updates the user name for all widgets
     * @param {string} name 
     * @param {("host"|"participant")} user
     */
    _setWidgetUserName(name, user) {
        this._allWidgets.forEach(w => {
            w[user].userName = name;
        })
    }

    /**
     * Updates the user image for all widgets
     * @param {string} url 
     * @param {("host"|"participant")} user
     */
    _setWidgetUserImage(url, user) {
        this._allWidgets.forEach(w => {
            w[user].userImage = url;
        })
    }

    /**
     * Sets the talking state icon for all widgets
     * @param {boolean} bool
     * @param {("host"|"participant")} user
     */
    _setWidgetTalking(bool, user) {
        this._allWidgets.forEach(w => {
            w[user].isTalking = bool;
        })
    }

    _updateBackgroundButton() {
        const symbols = {
            none: "blur-off",
            blur: "blur",
            image: "upload-img",
        };
        const text = !this._backgroundEffectAvailable
            ? "background effects unavailable"
            : this._backgroundEffectMode === "image"
                ? `background: ${this._backgroundImageName ?? "image"}`
                : `background: ${this._backgroundEffectMode}`;
        this.session.toolBar.setMenuItemProperty(
            "control/background/symbol",
            symbols[this._backgroundEffectMode] ?? "blur-off",
        );
        this.session.toolBar.setMenuItemProperty(
            "control/background/text",
            text,
        );
    }

    _updateBeautyButton() {
        this.session.toolBar.setMenuItemProperty(
            "control/beauty/text",
            this._beautyStrength > 0
                ? `beauty: ${this._beautyStrength}%`
                : "beauty: off",
        );
    }

    _createBeautyControl() {
        if (this._beautyControl) return this._beautyControl;

        const panel = document.createElement("div");
        const label = document.createElement("label");
        const slider = document.createElement("input");
        const output = document.createElement("output");
        const close = document.createElement("button");

        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", "Beauty level");
        Object.assign(panel.style, {
            position: "fixed",
            left: "50%",
            bottom: "96px",
            transform: "translateX(-50%)",
            zIndex: "10000",
            display: "none",
            alignItems: "center",
            gap: "12px",
            padding: "12px 16px",
            color: "white",
            background: "rgba(30, 30, 30, 0.92)",
            border: "1px solid rgba(255, 255, 255, 0.35)",
            borderRadius: "12px",
            boxShadow: "0 6px 24px rgba(0, 0, 0, 0.35)",
            font: "16px sans-serif",
        });

        label.textContent = "Beauty";
        label.htmlFor = "video-call-beauty-level";
        slider.id = label.htmlFor;
        slider.type = "range";
        slider.min = "0";
        slider.max = "100";
        slider.step = "1";
        slider.value = String(this._beautyStrength);
        slider.setAttribute("aria-label", "Beauty level");
        Object.assign(slider.style, {
            width: "min(42vw, 320px)",
            accentColor: "#7ec8ff",
        });

        output.value = `${this._beautyStrength}%`;
        output.style.minWidth = "3.5em";
        close.type = "button";
        close.textContent = "Done";
        Object.assign(close.style, {
            padding: "6px 10px",
            color: "white",
            background: "rgba(255, 255, 255, 0.14)",
            border: "1px solid rgba(255, 255, 255, 0.35)",
            borderRadius: "8px",
            cursor: "pointer",
        });

        const hide = () => {
            panel.style.display = "none";
        };
        slider.addEventListener("input", () => {
            const result = applyBeautyStrength(Number(slider.value));
            if (result.ok) {
                this._beautyStrength = result.strength;
                output.value = `${this._beautyStrength}%`;
                this._updateBeautyButton();
            }
        });
        close.addEventListener("click", hide);
        panel.addEventListener("keydown", (event) => {
            if (event.key === "Escape") hide();
        });

        panel.append(label, slider, output, close);
        document.body.appendChild(panel);
        this._beautyControl = { panel, slider, output };
        return this._beautyControl;
    }

    _toggleBeautyControl() {
        if (!this._beautyEffectAvailable) {
            this._notifyBackground(
                "Beauty requires the Gregblur WebGL2 video engine.",
                "error",
            );
            return;
        }
        const control = this._createBeautyControl();
        const show = control.panel.style.display === "none";
        control.panel.style.display = show ? "flex" : "none";
        if (show) control.slider.focus();
    }

    _notifyBackground(message, type = "info") {
        if (this.session.notifications?.notify instanceof Function) {
            this.session.notifications.notify(message, type);
        } else {
            console[type === "error" ? "warn" : "info"](`[VideoCall] ${message}`);
        }
    }

    _selectBackgroundImageFile() {
        if (!this._backgroundImageAvailable) {
            this._notifyBackground("Image backgrounds are unavailable.", "error");
            return;
        }

        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/png,image/jpeg,image/webp,image/gif";
        input.hidden = true;
        document.body.appendChild(input);

        let cleaned = false;
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            input.remove();
        };
        input.addEventListener("change", () => {
            const file = input.files?.[0] ?? null;
            cleanup();
            if (file) void this._applyBackgroundImageFile(file);
        }, { once: true });
        window.addEventListener("focus", () => {
            setTimeout(cleanup, 1000);
        }, { once: true });
        input.click();
    }

    async _applyBackgroundImageFile(file) {
        let image;
        try {
            this._notifyBackground("Loading background image.");
            image = await decodeBackgroundImage(file);
            const result = await this.setBackgroundEffect("image", {
                image,
                imageName: file.name,
            });
            if (!result.ok) {
                image.close?.();
                throw new Error(result.reason ?? "Image background could not be enabled.");
            }
            this._notifyBackground("Background image applied.", "success");
        } catch (error) {
            console.warn("[VideoCall] Background image could not be applied.", error);
            this._notifyBackground(
                error instanceof Error ? error.message : String(error),
                "error",
            );
        }
    }

    /**
     * Sets up event listeners for all widgets 
     */
    _setWidgetEvents() {
        this._allWidgets.forEach(w => {
            w.addEventListener("mute", (e) => {
                this.toggleMuted(e.track, e.user);
            })
        })
    }

    /**
     * Sets the video stream for a user
     * @param {MediaStream|null} stream 
     * @param {("host"|"participant")} user 
     */
    _setUserStream(stream, user) {
        this.videos[user].srcObject = stream;
    }

    /** Sets the mute state for all widgets
     * @param {("audio"|"video")} type
     * @param {boolean} bool
     * @param {("host"|"participant")} user
     */
    _setWidgetMuteState(type, bool, user) {
        this._allWidgets.forEach(w => {
            w[user][type+"_muted"] = bool;
        })
    }

    _setWidgetWaitingState(user, bool, wait = 0) {
        clearTimeout(this._setWidgetWaitingStateTimeout);
        if (wait > 0) {
            this._setWidgetWaitingStateTimeout = setTimeout(() => {
                this._setWidgetWaitingState(user, bool);
            }, wait)
        } else {
            let k = "_waitingState"+user;
            if (this[k] !== bool) {
                this[k] = bool;
                console.log("Setting waiting state for", user, "to", bool);
                this._allWidgets.forEach(w => {
                    w[user].waiting = bool;
                })
            }
        }
    }

    /**
     * Clears the video frames for all widgets
     * @param {("host"|"participant")} user
     */
    _clearWidgets(user) {
        this._setWidgetVisibility(user, false);
    }


    _setWidgetVisibility(user, isVisible) {

        console.log((!isVisible ? "Clearing" : "Showing") + " widgets for user", user);
        this._allWidgets.forEach(w => {
            w.toggleUserVideoDisplay(user, isVisible);
        })
    }


    /**
     * If the webRTC state changes, update the video streams accordingly
     * @param {Object} state
     */
    _onWebRTCState(state) {
        let stream = state.remoteStream;
        if (state.isRemoteStreamReady) {
            this._setUserStream(stream, this.sdata.them);
            this._setWidgetWaitingState(this.sdata.them, false);
        } else {
            this._setWidgetWaitingState(this.sdata.them, true, 1500);
        }
    }

    /**
     * Parses data received from the webrtc data channel and dispatches events accordingly
     * @param {string} data
     */
    _onWebRTCData(data) {
        let resData = null;
        let path = null;
        
        try {
            let match = data.match(DATA_DELIMITER);
            path = data.slice(0, match.index);
            let type = data[match.index + DATA_DELIMITER.length];
            let dataString = data.slice(match.index + DATA_DELIMITER.length + 1);
            
            switch (type) {
                case "J": resData = JSON.parse(dataString); break;
                case "N": resData = Number(dataString); break;
                case "B": resData = dataString === "1"; break;
                case "S": resData = dataString;
            }
        } catch (e) {
            console.warn("Error parsing data from webrtc channel", e)
        }

        if (path != null) {
            const event = new Event(path);
            event.data = resData;
            this.dispatchEvent(event);
        }
    }

    /**
     * @param {("audio"|"video")} type
     * @param {boolean} bool
     * @param {("host"|"participant")} user
     * @param {boolean} setDB - whether to update the database state as well
     */
    async _updateMutedState(type, bool, user, setDB = true) {
        const muteState = this._muteState;
        if (user in muteState && type in muteState[user]) {
            if (typeof bool !== "boolean") {
                bool = true
            }
            
            // only update database if the state has changed 
            if (muteState[user][type] != bool) {
                if (setDB) await this.sdata.set(`${user}/${type}`, bool);
            }

            // update local state
            muteState[user][type] = bool;

            // if the user is the local user, update the toolbar icon and mute the track
            if (user === this.sdata.me) {
                let iconName = MuteIconNames[type][bool ? 1 : 0];
                this.session.toolBar.setMenuItemProperty(`control/${type}/symbol`, iconName);
                this._mainConnection.muteTrack(type, bool)
            }

            // update the widget mute state
            this._setWidgetMuteState(type, !bool, user);
        }
    }


    /**
     * Sets up listeners to monitor mute state changes in the database
     * @param {Object} presets
     */
    async _setupMuteStateListeners(presets){
        const {sdata} = this;
        const {me, them} = sdata;

        // get initial mute states from the database for the local user
        let [videoMuted, audioMuted] = await Promise.all([
            sdata.get(`${me}/video`),
            sdata.get(`${me}/audio`)
        ]);

        // set initial mute states based on database or presets
        await Promise.all([
            videoMuted == null ? this._updateMutedState("video", !!presets[me+"-video"], me) : null,
            audioMuted == null ? this._updateMutedState("audio", !!presets[me+"-audio"], me) : null,
        ]);
      
        // listen to changes in the database mute state
        sdata.onValue(`${me}/audio`, (value) => {
            this._updateMutedState('audio', value, me, false);
        })
        sdata.onValue(`${me}/video`, (value) => {
            this._updateMutedState('video', value, me, false)
        })
        sdata.onValue(`${them}/audio`, (value) => {
            this._updateMutedState('audio', value, them, false)
        })
        sdata.onValue(`${them}/video`, (value) => {
            this._updateMutedState('video', value, them, false)
        })
    }


    async _onUserLeft(){
        this._setWidgetWaitingState(this.sdata.them, true);
        clearTimeout(this._onUserLeftTimeout);
        this._onUserLeftTimeout = setTimeout(() => {
            if (!this.sdata.isUserActive(this.sdata.them)) {
                this._clearWidgets(this.sdata.them);
            }
        }, 5000);
    }

    async _onUserJoined(){
        clearTimeout(this._onUserLeftTimeout);
        this._setWidgetVisibility(this.sdata.them, true);
    }




    /**
     * Sets the volume for all video elements
     * @param {number} value - 0 to 100
     */
    _setVolume(value){
        if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
            value = 75;
        }
        value = value / 100; // convert to 0-1 rang
        for (const user in this.videos) {
            this.videos[user].volume = value;
        }
    }


    async initialise(){
        let connection = new WebRTC.ConnectionManager();
        connection.on("state", this._onWebRTCState.bind(this));
        connection.on("data", this._onWebRTCData.bind(this));
        if (await startWebcam()) {

            // Get presets from the host
            let presets = await getHostPresets(this.sdata.hostUID);
            this.presets = presets;
            
            // set the host's name
            let name = (presets.name || "host") + (presets.pronouns ? ` (${presets.pronouns})` : "")
            this._setWidgetUserName(name, "host");

            // set the host's image
            if (presets.image) {
                this._setWidgetUserImage(presets.image, "host");
            }


            // get new stream from webcam
            let stream = getStream(2);
            // Apply background processing while keeping one stable output track.
            stream = await background(stream);
            const backgroundState = window.squidlyBackground?.getState()?.engineState;
            this._backgroundEffectAvailable =
                typeof backgroundState?.effectMode === "string" ||
                typeof backgroundState?.enabled === "boolean";
            this._backgroundImageAvailable =
                Boolean(backgroundState?.imageSupported);
            this._backgroundEffectMode = backgroundState?.effectMode ??
                (backgroundState?.enabled ? "blur" : "none");
            this._backgroundImageName = backgroundState?.imageName ?? null;
            this._beautyEffectAvailable =
                Boolean(backgroundState?.beautySupported);
            this._beautyStrength =
                Number(backgroundState?.beautyStrength) || 0;
            // set up voice detection
            setupVoiceDetection(stream, (d) => {
                this._setWidgetTalking(d, this.sdata.me)
            })
            
            // Start the webrtc connection
            let signaler = new RTCSignaler(this.sdata);
            let config = this.sdata.iceServers; 
            connection.start(config, stream, signaler);
            this._mainConnection = connection;

            // set the local video stream to the widget
            this._setUserStream(stream, this.sdata.me)
            this._setupMuteStateListeners(presets);


            this.session.toolBar.addMenuItems("control", [
                {
                    name: "video",
                    symbol: "novideo",
                    text: "video",
                    index: 0,
                    onSelect: (e) => this.toggleMuted("video", this.sdata.me)
                },
                {
                    name: "beauty",
                    symbol: "show-face",
                    text: this._beautyStrength > 0
                        ? `beauty: ${this._beautyStrength}%`
                        : "beauty: off",
                    hidden: !this._beautyEffectAvailable,
                    index: 225,
                    onSelect: () => this._toggleBeautyControl(),
                },
                {
                    name: "background",
                    symbol: this._backgroundEffectMode === "blur"
                        ? "blur"
                        : this._backgroundEffectMode === "image"
                            ? "upload-img"
                            : "blur-off",
                    text: this._backgroundEffectAvailable
                        ? `background: ${this._backgroundEffectMode}`
                        : "background effects unavailable",
                    index: 270,
                    subMenu: [
                        {
                            name: "background-none",
                            symbol: "blur-off",
                            text: "no background effect",
                            index: 0,
                            onSelect: (e) =>
                                e.waitFor(this.setBackgroundEffect("none")),
                        },
                        {
                            name: "background-blur",
                            symbol: "blur",
                            text: "blur background",
                            index: 120,
                            onSelect: (e) =>
                                e.waitFor(this.setBackgroundEffect("blur")),
                        },
                        {
                            name: "background-image",
                            symbol: "upload-img",
                            text: "upload background image",
                            hidden: !this._backgroundImageAvailable,
                            index: 240,
                            onSelect: () => this._selectBackgroundImageFile(),
                        },
                    ],
                },
                {
                    name: "audio",
                    symbol: "mute",
                    text: "audio",
                    index: 360,
                    onSelect: (e) => this.toggleMuted("audio", this.sdata.me)
                }
            ])
            
            this.session.settings.onValue(`${this.sdata.me}/volume/level`, (value) => {
                this._setVolume(value);
            })
            this.session.settings.onValue("participant/profileSettings/name", (value) => {
                this._setWidgetUserName(value, "participant");
            })
            this.session.settings.onValue("participant/profileSettings/image", (value) => {
                this._setWidgetUserImage(value, "participant");
            })


            // Listen to changes in audio output device and update sinkId accordingly
            let lastSinkId = null;
            addDeviceChangeCallback((devices) => {
                let activeOutput = Object.values(devices.audiooutput || {}).find(d => d.active);
                if (activeOutput && activeOutput.deviceId !== lastSinkId) {
                    lastSinkId = activeOutput.deviceId;
                    for (const user in this.videos) {
                        this.videos[user].setSinkId(lastSinkId)
                    }
                }
            })

            //listen to active users 
            this.sdata.onUser("left", (key) => {
                if (key == this.sdata.them) {
                    this._onUserLeft();
                }
            })

            this.sdata.onUser("joined", (key) => {
                if (key == this.sdata.them) {
                    this._onUserJoined();
                    this._setWidgetWaitingState(this.sdata.them, true);
                }
            });


            this._setWidgetVisibility(this.sdata.me, true);
        } else {
            this.throwInitialisationError("Could not start webcam. Please check your camera permissions.", "https://firebasestorage.googleapis.com/v0/b/eyesee-d0a42.appspot.com/o/videopermissions.mp4?alt=media&token=743c04cc-974e-4ed9-bb21-8f0ac56c2d83");
        }
    }

    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ PUBLIC ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */


    /**
     * Sends data across the webrtc data channel. A path must 
     * be specified in order to route data to the correct location.
     * 
     * @param {string} path 
     * @param {Object|string|number|boolean} data
     */
    async sendData(path, data) {
        if (typeof path === "string" && path.length > 0) {
            let dataString = null;
            switch (typeof data) {
                case "object": dataString = 'J' + JSON.stringify(data); break;
                case "number": dataString = 'N' + data; break;
                case "boolean": dataString = 'B' + (data ? 1 : 0); break;
                case "string": dataString = 'S' + data; break;
                default:
                    console.warn(`Cannot send ${typeof data} accross webrtc data channel.`);
                    break;
            }
            
            if (dataString !== null && this._mainConnection != null) {
                let fullString = path + ":::" + dataString;
                this._mainConnection.send(fullString);
            }
        }
    }


    /**
     * Toggles the mute state for a user and type
     * @param {("audio"|"video")} type
     * @param {("host"|"participant")} user
     */
    async toggleMuted(type, user) {
        const muteState = this._muteState;
        if (user in muteState && type in muteState[user]) {
            let oldState = muteState[user][type];
            await this._updateMutedState(type, !oldState, user);
        }
    }

    async setBackgroundEffect(mode, options = {}) {
        const previous = this._backgroundEffectTransition ?? Promise.resolve();
        const transition = previous
            .catch(() => {})
            .then(() => applyBackgroundEffect(mode, options));
        this._backgroundEffectTransition = transition;
        try {
            const result = await transition;
            if (result.ok) {
                this._backgroundEffectAvailable = true;
                this._backgroundImageAvailable =
                    result.imageSupported || this._backgroundImageAvailable;
                this._backgroundEffectMode = result.mode;
                this._backgroundImageName = result.imageName ??
                    (result.mode === "image" ? this._backgroundImageName : null);
                this._updateBackgroundButton();
            } else {
                console.warn(
                    "[VideoCall] Background effect could not be changed.",
                    result.reason,
                );
                this._notifyBackground(
                    result.reason ?? "Background effect could not be changed.",
                    "error",
                );
            }
            return result;
        } finally {
            if (this._backgroundEffectTransition === transition) {
                this._backgroundEffectTransition = null;
            }
        }
    }

    async toggleBackgroundBlur() {
        return await this.setBackgroundEffect(
            this._backgroundEffectMode === "blur" ? "none" : "blur",
        );
    }


    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ STATIC ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */

    static async loadResources() {
        await VideoPanelWidget.loadStyleSheets();
    }

    static get name() {
        
        return "videoCall"
    }
    static get layers() {
        return {
            topPanelWidget: {
                type: "panel",
                area: "top",
            },
            sidePanelWidget: {
                type: "panel",
                area: "side",
            },
            mainAreaWidget: {
                type: "area",
                area: "fullAspectArea",
                index: 50,
            }
        }
    }
   

    static get firebaseName(){
        return "video-call"
    }
}
