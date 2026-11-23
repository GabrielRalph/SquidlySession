import { HideShowTransition } from "../../Utilities/hide-show.js";
import { Icon } from "../../Utilities/Icons/icons.js";
import { relURL } from "../../Utilities/usefull-funcs.js";
import { SquidlyFeatureWindow } from "../features-interface.js";

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

    async toggle(isShow, time){
        const changed = isShow !== this._shown;
        const promise = super.toggle(isShow, time);
        if (changed) {
            this.dispatchEvent(new Event("toggle"));
        }
        await promise;
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
    set videoMuted(value) {
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
    set audioMuted(value) {
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

    onResize(w, h) {
        this.W = w;
        this.H = h;
    }

    captureFrame(video) {
        if (video != null) {
            const { videoWidth, videoHeight } = video;
            if (videoWidth > 5 && videoHeight > 5) {
                let sizeString = videoWidth + "x" + videoHeight;
                if (this._sizeString !== sizeString) {
                    this._sizeString = sizeString;
                    console.log("Video size changed to", sizeString);
                }

                this.waiting = false;

                this.aspect = videoWidth / videoHeight;

                let cW = Math.min(this.W, videoWidth);
                let cH = Math.min(this.H, videoHeight);

                if (this.canvas.width != cW || this.canvas.height != cH) {
                    this.canvas.width = cW;
                    this.canvas.height = cH;
                }
                this.ctx.drawImage(video, 0, 0, videoWidth, videoHeight, 0, 0, cW, cH);
            }
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
    
class VideoPanelWidget extends SquidlyFeatureWindow {
    /** @type {VideoDisplay} */
    host = null;

    /** @type {VideoDisplay} */
    participant = null;

    border = 2;

    constructor() {
        super("video-panel-widget");

        this.stack = this.createChild("div", {class: "stack"})

        let layoutEvents = {
            aspect: this._update_layout.bind(this),
            toggle: this._update_layout.bind(this),
        }
        this.participant = this.stack.createChild(VideoDisplay, {events: {
            ...layoutEvents,
            mute: (e) => this.dispatchEvent(new MuteEvent(e.track, "participant")),
        }});
        this.participant.userName = "participant";

        this.host = this.stack.createChild(VideoDisplay, {events: {
            ...layoutEvents,
            mute: (e) => this.dispatchEvent(new MuteEvent(e.track, "host")),
        }});
        this.host.userName = "host";


        let robs = new ResizeObserver((e) => {
            this.W = e[0].contentRect.width;
            this.H = e[0].contentRect.height;
            this._update_layout()
        })
        robs.observe(this.root);
    }


    _update_layout() {
        let aspectA = this.host.shown ? this.host.aspect : 0;
        let aspectB = this.participant.shown ? this.participant.aspect : 0;

        let fullHeight = this.H - 2 * this.border;
        let fullWidth = this.W - 2 * this.border;

        let layouts = Object.keys(stackModes).map(mode => {
            let [w, h] = stackModes[mode](aspectA, aspectB, fullWidth, fullHeight, this.border);
            let area = w * h;
            let valid = (w <= fullWidth) && (h <= fullHeight);
            return {mode, w, h, area, valid};
        });

        layouts.sort((a, b) => b.area - a.area);
        layouts = layouts.filter(l => l.valid);
        
        let choice = layouts[0];
        if (choice) {
            this.stack.styles = {
                "--s-width": choice.w + "px",
                "--s-height": choice.h + "px",
            }
            this.stack.setAttribute("stack-mode", choice.mode);
    
            this.host.onResize(
                choice.mode.startsWith("horizontal") ? choice.h * aspectA : choice.w,
                choice.mode.startsWith("vertical") ? choice.w / (aspectA) : choice.h
            );
            this.participant.onResize(
                choice.mode.startsWith("horizontal") ? choice.h * aspectB : choice.w,
                choice.mode.startsWith("vertical") ? choice.w / (aspectB) : choice.h
            );
        }
    }

    static get usedStyleSheets(){
        return [relURL("./style.css", import.meta)]
    }
}


class WidgetManager {
    #widgetLibrary = {};
    #waitTimeouts = {};
    #widgetProperties = {};


    #all() {return Object.values(this.#widgetLibrary).map(info => info.widget);}

    setWidgetProperty(user, prop, value) {
        if (!this.#widgetProperties[user]) {
            this.#widgetProperties[user] = {};
        }
        this.#widgetProperties[user][prop] = value;

        this.#all().forEach(widget => {
            if (widget[user] && typeof widget[user] === "object" ) {
                widget[user][prop] = value;
            }
        });
    }

    getWidgetProperty(user, prop) {
        return this.#widgetProperties[user]?.[prop] ?? null;
    }


    render(user, video) {
        if (video != null) {
            for (const name in this.#widgetLibrary) {
                const widgetInfo = this.#widgetLibrary[name]
                if (widgetInfo.visible()) {
                    widgetInfo.widget[user] .captureFrame(video);
                }
            }
        }
    }

    setMuteState(user, state, track) {
        const prop =  track + "Muted";
        this.setWidgetProperty(user, prop, state);
    }

    setUserName(user, name) {
        this.setWidgetProperty(user, "userName", name);
    }

    setUserImage(user, image) {
        this.setWidgetProperty(user, "userImage", image);
    }

    setTalking(user, talking) {
        this.setWidgetProperty(user, "isTalking", talking);
    }

    setWaitingState(user, state, wait = 0) {
        clearTimeout(this.#waitTimeouts[user]);
        if (wait > 0) {
            this.#waitTimeouts[user] = setTimeout(() => {
                this.setWaitingState(user, state);
            }, wait);
        } else {
            const lastState = this.getWidgetProperty(user, "waiting");
            if (lastState !== state) {
                this.setWidgetProperty(user, "waiting", state);
            }
        }
    }

    setVisibility(user, isVisible) {
        this.setWidgetProperty(user, "shown", isVisible)
    }

    clear(user) {
        this.setVisibility(user, false);
    }

        

    remove(name){
        delete this.#widgetLibrary[name];
    }

    create(name, isVisibleMethod){
        const widget = new VideoPanelWidget();
        this.#widgetLibrary[name] = {
            widget: widget,
            visible: isVisibleMethod
        };

        // Listen for mute events from the widget
        widget.addEventListener("mute", (event) => {
            this.onMuteClick?.(
                event.track,
                event.user,
                event
            );
        });

        // Apply existing widget properties 
        // to the new widget instance
        Object.entries(this.#widgetProperties).forEach(([user, props]) => {
            Object.entries(props).forEach(([prop, value]) => {
                if (widget[user] && typeof widget[user] === "object") {
                    widget[user][prop] = value;
                }
            })
        });
        return widget;
    }
}


export { VideoPanelWidget, WidgetManager };