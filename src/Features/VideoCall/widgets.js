import { set } from "../../Firebase/firebase.js";
import { Vector } from "../../SvgPlus/vector.js";
import { addDeviceChangeCallback } from "../../Utilities/device-manager.js";
import { HideShowTransition } from "../../Utilities/hide-show.js";
import { Icon } from "../../Utilities/Icons/icons.js";
import { ShadowElement } from "../../Utilities/shadow-element.js";
import { delay, relURL } from "../../Utilities/usefull-funcs.js";

class MuteEvent extends Event {
    constructor(type, user) {
        super("mute");
        this.track = type;
        this.user = user;
    }
}

const DEFAULT_ASPECT_RATIO = 640/480;

class VideoDisplay extends HideShowTransition {
    
    constructor(el = "video-display") {
        super(el);

        this.class = "video-display"
        this.styles = {
            position: "relative",
        }

        this.canvas = this.createChild("canvas");
        this.ctx = this.canvas.getContext("2d");

        this.videoOverlay = this.createChild("div", {class: "video-overlay"})
        this.overlayImage = this.videoOverlay.createChild("div", {class: "overlay-image"});
        let loader = this.videoOverlay.createChild("div", {class: "simple-loader"});
        loader.createChild("b");
        loader.createChild("b");
        loader.createChild("b");

        this.topLeft = this.createChild("div", {
            class: "icon-slot top-left",
            styles: {
                position: "absolute",
                top: 0,
                left: 0
            }
        });
        this.audioMute = this.topLeft.createChild("div", {class: "icon-button"});
        this.videoMute = this.topLeft.createChild("div", {class: "icon-button"});

        this.topRight = this.createChild("div", {
            class: "icon-slot top-right",
            styles: {
                position: "absolute",
                top: 0,
                right: 0
            }
        });

        this.bottomRight = this.createChild("div", {
            class: "icon-slot name",
            styles: {
                position: "absolute",
                bottom: 0,
                left: 0
            }
        });

        this.bottomLeft = this.createChild("div", {
            class: "icon-slot",
            styles: {
                position: "absolute",
                bottom: 0,
                left: 0
            }
        });

        this.aspect = DEFAULT_ASPECT_RATIO;
    }

    _update(mode){
        this.dispatchEvent(new MuteEvent(mode, null))
    }



    /** @param {boolean} bool */
    set waiting(bool) {
        this.toggleAttribute("waiting", bool);
    }
    /** @return {boolean} */
    get waiting() {
        return this.hasAttribute("waiting");
    }

    /** @param {boolean} value */
    set video_muted(value) {
        this.toggleAttribute("disabled", false);
        if (value === false) {
            this.setIcon("videoMute", "video", () => this._update("video"));
        } else if (value === true) {
            this.toggleAttribute("disabled", true);
            this.setIcon("videoMute", "novideo", () => this._update("video"));
        } else {
            this.setIcon("videoMute", null);
        }
        this._video_muted = value;
    }
    /** @param {boolean} value */
    set audio_muted(value) {
        if (value === false) {
            this.setIcon("audioMute", "unmute", () => this._update("audio"));
        } else if (value === true) {
            this.setIcon("audioMute", "mute", () => this._update("audio"));
        } else {
            this.setIcon("audioMute", null);
        }
    }

    /**
     * Sets the aspect ratio of the video display.
     * @param {number} ratio - The aspect ratio to set. Must be a positive number.
     */
    set aspect(ratio) {
        if (typeof ratio !== "number" || Number.isNaN(ratio) || ratio <= 0.01) {
            ratio = DEFAULT_ASPECT_RATIO;
        }

        if (!this.aspect || Math.abs(this.aspect - ratio) > 1e-6) {
            this._aspect = ratio;
            this.styles = {
                "--aspect": this.aspect
            }
            this.dispatchEvent(new Event("aspect"));
        }
    }

    get aspect() {
        return this._aspect;
    }


    setIcon(location, iconName, cb) {
        if (iconName == null) {
            this[location].innerHTML = "";
            this[location].onclick = null;
        } else {
            this[location].innerHTML = "";
            this[location].createChild(Icon, {events: {click: () => {
                this[location].onclick = () => {
                    if (cb instanceof Function) cb();
                }
            }}}, iconName);
        }
    }

    onResize() {
        this.W = this.clientWidth;
        this.H = this.clientHeight;
    }

    captureFrame(video) {
        if (video != null && video.videoWidth > 0.1 && video.videoHeight > 0.1) {
            const { videoWidth, videoHeight } = video;
            this.waiting = false;

            this.aspect = videoWidth / videoHeight;

            let cW = Math.min(this.W, videoWidth);
            let cH = Math.min(this.H, videoHeight);

            this.canvas.width = cW;
            this.canvas.height = cH;
            this.ctx.drawImage(video, 0, 0, videoWidth, videoHeight, 0, 0, cW, cH);
        }
    }

    set userName(name) {
        this.bottomLeft.innerHTML = "";
        this.bottomLeft.createChild("div", {
            class: "icon-text", 
            content: name
        })
    }

    set userImage(url) {
        if (typeof url === "string" && url !== "") {
            this.overlayImage.styles = {
                "background-image": `url("${url}")`
            }
        } else {
            this.overlayImage.styles = {
                "background-image": null
            }
        }
    }

    set isTalking(bool) {
        this.toggleAttribute("talking", bool);
    }
 
    get aspect(){
        let aspect = this._aspect;
        if (typeof aspect !== "number" || Number.isNaN(aspect)) {
            aspect = 0;
        }
        return aspect;
    }

}


const stackModes = {
    "vertical-height": (a1, a2, w, h, space) => [ (h - space) / (1/a1 + 1/a2), h ],
    "vertical-width": (a1, a2, w, h, space) => [ w, (w / a1) + (w / a2) + space ],
    "horizontal-width": (a1, a2, w, h, space) => [ w, (w - space) / (a1 + a2) ],
    "horizontal-height": (a1, a2, w, h, space) => [ h * a1 + h * a2 + space, h ],
}
    
export class VideoPanelWidget extends ShadowElement {
    /** @type {VideoDisplay} */
    host = null;

    /** @type {VideoDisplay} */
    participant = null;

    border = 2;

    constructor() {
        super("video-panel-widget");

        this.stack = this.createChild("div", {class: "stack"})

        this.participant = this.stack.createChild(VideoDisplay, {events: {
            aspect: this._update_layout.bind(this),
            mute: (e) => this.dispatchEvent(new MuteEvent(e.track, "participant")),
        }});
        this.participant.userName = "participant";

        this.host = this.stack.createChild(VideoDisplay, {events: {
            aspect: this._update_layout.bind(this),
            mute: (e) => this.dispatchEvent(new MuteEvent(e.track, "host")),
        }});
        this.host.userName = "host";


        let robs = new ResizeObserver(() => {
            this._update_layout()
        })
        robs.observe(this.root);
    }


    toggleUserVideoDisplay(user, show) {
        let change = false;
        let element = user === "host" ? this.host : this.participant;
        if (element.shown !== show) {
            element.shown = show;
            this._update_layout();
        }
    }

    _update_layout() {
        let aspectA = this.host.shown ? this.host.aspect : 0;
        let aspectB = this.participant.shown ? this.participant.aspect : 0;

        let fullHeight = this.clientHeight - 2 * this.border;
        let fullWidth = this.clientWidth - 2 * this.border;

        let layouts = Object.keys(stackModes).map(mode => {
            let [w, h] = stackModes[mode](aspectA, aspectB, fullWidth, fullHeight, this.border);
            let area = w * h;
            let valid = (w <= fullWidth) && (h <= fullHeight);
            return {mode, w, h, area, valid};
        });

        layouts.sort((a, b) => b.area - a.area);
        layouts = layouts.filter(l => l.valid);
        
        let choice = layouts[0];
        this.stack.styles = {
            "--s-width": choice.w + "px",
            "--s-height": choice.h + "px",
        }
        this.stack.setAttribute("stack-mode", choice.mode);

        this.host.onResize();
        this.participant.onResize();
    }


    static get usedStyleSheets(){
        return [relURL("./style.css", import.meta)]
    }
}