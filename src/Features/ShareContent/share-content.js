import { SvgPlus } from "../../SvgPlus/4.js";
import { Features } from "../features-interface.js";
import { ContentViewer } from "./content-view.js";
import { RTCSignaler } from "../../Utilities/WebRTC/rtc-signaler.js";
import { ConnectionManager } from "../../Utilities/WebRTC/webrtc-base.js";
import {
    FirstValueGuard,
    RC_KEY_KEY,
    RC_MOVE_KEY,
    RC_STATE_KEY,
    RemoteControlPublisher,
    parseKeyPayload,
    parseStreamPayload,
    toAgentCommand,
} from "./remote-control-protocol.js";


export default class ShareContent extends Features {
    _isSharing = false;
    _captureController = null;
    _displaySurface = null;
    _rcPublisher = null;
    _rcState = null;
    _rcKeysArmed = false;
    _rcHeldKeys = new Set();
    _rcFbGuard = new FirstValueGuard();

    constructor(session, sdata){
        super(session, sdata)
        this.contentView = new ContentViewer(this);
        this.contentView.root.events = {
            transform: (e) => this.sdata.set("content-transform", e.transform),
            page: () => this.sdata.set("content-info/page", this.contentView.page),
            close: (e) => e.waitFor(this.close()),
            upload: (e) => {
                this.shareFile()
            },
            screen: (e) => this.shareScreen(),
            "remote-control": (e) => e.waitFor(this.toggleRemoteControl(e)),
            "rc-input": (e) => this._onRemoteInput(e.detail),
        }
        this.session.toolBar.addMenuItems("share", [
            {
                name: "screen",
                index: 0,
                onSelect: e => e.waitFor(this.shareScreen())
            },
            {
                name: "file",
                index: 90,
                onSelect: e => {
                    if (e.clickMode === "click")
                        e.waitFor(this.shareFile())
                }
            }
        ]);
    }


    /**
     * Uploads a file to storage and sets the content info in the database
     * @param {File} file The file to upload
     * @return {Promise<void>}
     */
    async uploadFile(file) {
        // Bring up the file loader 
        this.contentView.loader.show(400);

        let type = file.type == "application/pdf" ? "pdf" : "image";

        // upload file to storage and update progress bar
        let url = await this.sdata.uploadFile(file, "content", (e) => {
            this.contentView.loader.progress = 0.7 * e.bytesTransferred / e.totalBytes
        });

        // Set content info to database
        await this.sdata.set("content-info", {
            type: type,
            url: url,
            page: 0,
        });
    }


    /**
     * Prompts the user to share their screen and sets up the stream for sharing
     * @return {Promise<void>}
     */
    async shareScreen(){
        let stream = null;
        let oldStream = this._shareScreen.stream;

        // share screen media options
        let displayMediaOptions = {
            video: {
                displaySurface: "window",
                
            },
            audio: false,
            surfaceSwitching: "include",
            selfBrowserSurface: "exclude",
        }

        this._captureController = null;
        if (typeof CaptureController === "function") {
            this._captureController = new CaptureController();
            displayMediaOptions.controller = this._captureController;
        }

        try {
            // promt user to select a screen/window to share
            try {
                stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
            } catch (err) {
                if (displayMediaOptions.controller && err?.name === "TypeError") {
                    delete displayMediaOptions.controller;
                    this._captureController = null;
                    stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
                } else {
                    throw err;
                }
            }

            // add stream events
            stream.oninactive = () => {
                this.contentView.setStream(null, this.sdata.me);
                this.sdata.set("content-info", null);
                this.clearRemoteControl();
                this.session.openWindow("default");
            }

            // clear old stream events
            if (oldStream instanceof MediaStream) oldStream.oninactive = null;
         
            // set the stream to the connection manager and content view
            this.contentView.stream = stream;
            this._shareScreen.replaceStream(stream);
            this.contentView.setStream(stream, this.sdata.me);
            this.contentView.streamUser = this.sdata.me;
            this._isSharing = true;

            const track = stream.getVideoTracks()[0];
            this._displaySurface = track?.getSettings?.().displaySurface || null;

            this.sdata.set("content-info", {
                type: "stream",
                url: Math.random(),
                page: this.sdata.me,
            });

            this.sdata.set(`remote-control/${RC_STATE_KEY}`, {
                enabled: false,
                controller: null,
                sharer: this.sdata.me,
                surface: this._displaySurface,
            });

            this._tryForwardWheel();

            this.session.openWindow("shareContent");
        } catch (err) {
            
        }
    }

    /**
     * Prompts the user to select a file and uploads it for sharing
     * @return {Promise<void>}
     */
    async shareFile() {
        let input = new SvgPlus("input");
        input.props = {
            type: "file",
            accept: "image/*,application/pdf",
        }

        await new Promise((r) => {
            input.addEventListener("input", r)
            let res = input.click();
            console.log(res);
        })

        if (input.files.length > 0) {
            this.uploadFile(input.files[0])
            await this.session.openWindow("shareContent")
        }        
    }

    /**
     * Toggle the browser remote-control channel. The non-sharer becomes
     * the controller; the sharer receives events (agent injection is next step).
     */
    async toggleRemoteControl(){
        if (this.contentView.displayType !== "stream") return;

        const sharer = this._currentSharer();
        const me = this.sdata.me;
        const state = this._rcState || {};

        if (state.enabled) {
            if (state.controller === me || sharer === me) {
                await this._writeRemoteControlState(false);
            }
            return;
        }

        if (!sharer || me === sharer) return;
        await this._writeRemoteControlState(true);
    }

    _currentSharer() {
        return this.contentView.streamUser
            || this._rcState?.sharer
            || null;
    }

    async _writeRemoteControlState(enabled) {
        const sharer = this._currentSharer();
        await this.sdata.set(`remote-control/${RC_STATE_KEY}`, {
            enabled,
            controller: enabled ? this.sdata.me : null,
            sharer,
            surface: this._displaySurface || this._rcState?.surface || null,
        });
    }

    async _tryForwardWheel() {
        const controller = this._captureController;
        if (!controller || this._displaySurface !== "browser") return;
        if (typeof controller.forwardWheel !== "function") return;
        const tile = this.contentView.content?.streamCanvas;
        if (!tile) return;
        try {
            await controller.forwardWheel(tile);
        } catch {
            // Permission or unsupported surface — browser channel still works.
        }
    }

    _applyRemoteControlState(state) {
        this._rcState = state;
        const streaming = this.contentView.displayType === "stream";
        const enabled = !!(state && state.enabled && streaming);
        const me = this.sdata.me;
        const isController = enabled && state.controller === me;
        const isReceiver = enabled && state.sharer === me;

        if (isController) {
            if (!this._rcPublisher) {
                this._rcPublisher = new RemoteControlPublisher((key, payload) => {
                    this.sdata.set(`remote-control/${key}`, payload);
                });
            }
            this._setKeysArmed(true);
        } else {
            this._setKeysArmed(false);
            if (this._rcPublisher) {
                this._rcPublisher.stop();
                this._rcPublisher = null;
            }
        }

        this.contentView.setRemoteControl({
            enabled,
            isController,
            isReceiver,
            surface: state?.surface || this._displaySurface,
        });
    }

    _onRemoteInput(detail) {
        const pub = this._rcPublisher;
        if (!pub || !detail) return;
        const { type } = detail;
        if (type === "pointerdown") {
            pub.pressed = true;
            pub.sentButtonDown = false;
            pub.queueMove(detail);
            return;
        }
        if (type === "pointermove") {
            pub.queueMove(detail);
            if (pub.pressed && !pub.sentButtonDown && detail.drag) {
                pub.emitButton(detail.start, "down", detail.button);
                pub.sentButtonDown = true;
            }
            return;
        }
        if (type === "pointerup") {
            if (!pub.pressed) return;
            pub.pressed = false;
            if (pub.sentButtonDown) {
                pub.emitButton(detail, "up", detail.button);
            } else {
                pub.emitClick(detail, detail.button);
            }
            pub.sentButtonDown = false;
            return;
        }
        if (type === "scroll") {
            pub.emitScroll(detail, detail.dx, detail.dy);
        }
    }

    _setKeysArmed(on) {
        const next = !!on;
        if (next === this._rcKeysArmed) return;
        if (!next) this._releaseHeldKeys();
        this._rcKeysArmed = next;
        if (next) {
            window.addEventListener("keydown", this._onRcKeyDown);
            window.addEventListener("keyup", this._onRcKeyUp);
            window.addEventListener("blur", this._onRcWindowBlur);
        } else {
            window.removeEventListener("keydown", this._onRcKeyDown);
            window.removeEventListener("keyup", this._onRcKeyUp);
            window.removeEventListener("blur", this._onRcWindowBlur);
        }
    }

    _isEditableTarget(ev) {
        const t = ev.target;
        if (!t) return false;
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
        return !!t.isContentEditable;
    }

    _onRcKeyDown = (ev) => {
        if (!this._rcKeysArmed || !this._rcPublisher) return;
        if (ev.isComposing || ev.key === "Process" || ev.key === "Dead" || ev.repeat || !ev.code) return;
        if (this._isEditableTarget(ev)) return;
        if (ev.code === "Escape") {
            this._setKeysArmed(false);
            return;
        }
        if (ev.metaKey && (ev.code === "KeyQ" || ev.key === "q" || ev.key === "Q")) {
            ev.preventDefault();
            return;
        }
        ev.preventDefault();
        this._rcHeldKeys.add(ev.code);
        this._rcPublisher.emitKey("key.down", ev);
    };

    _onRcKeyUp = (ev) => {
        if (!this._rcKeysArmed || !this._rcPublisher) return;
        if (ev.isComposing || ev.key === "Process" || ev.key === "Dead" || !ev.code) return;
        if (this._isEditableTarget(ev)) return;
        ev.preventDefault();
        this._rcHeldKeys.delete(ev.code);
        this._rcPublisher.emitKey("key.up", ev);
    };

    _onRcWindowBlur = () => {
        this._releaseHeldKeys();
    };

    _releaseHeldKeys() {
        const pub = this._rcPublisher;
        const codes = [...this._rcHeldKeys];
        this._rcHeldKeys.clear();
        if (!pub || !codes.length) return;
        for (const code of codes) {
            pub.publish(RC_KEY_KEY, pub.formatKey("key.up", code, "", []));
        }
        pub.emitReleaseAll();
    }

    _onRemoteMoveValue(value) {
        if (this._rcFbGuard.shouldIgnore(RC_MOVE_KEY, value)) return;
        if (!this._rcState?.enabled || this._rcState.sharer !== this.sdata.me) return;
        const parsed = parseStreamPayload(value);
        if (!parsed) return;
        if (parsed.kind === "kd" || parsed.kind === "ku" || parsed.kind === "kr") {
            this._previewRemoteCommand(toAgentCommand(parsed));
            return;
        }
        this.contentView.setRemotePreview(parsed.nx, parsed.ny, parsed.kind);
        this._previewRemoteCommand(toAgentCommand(parsed));
    }

    _onRemoteKeyValue(value) {
        if (this._rcFbGuard.shouldIgnore(RC_KEY_KEY, value)) return;
        if (!this._rcState?.enabled || this._rcState.sharer !== this.sdata.me) return;
        this._previewRemoteCommand(toAgentCommand(parseKeyPayload(value)));
    }

    _previewRemoteCommand(command) {
        if (!command) return;
        console.log("%cremote-control", "color:#3d9a6a", command);
    }

    clearRemoteControl() {
        this._captureController = null;
        this._displaySurface = null;
        this._setKeysArmed(false);
        if (this._rcPublisher) {
            this._rcPublisher.stop();
            this._rcPublisher = null;
        }
        this.sdata.set("remote-control", null);
    }

    /**
     * Stops sharing the current screen
     */
    stopSharing(){
        if (this._isSharing) {
            let stream = this._shareScreen.stream;
            stream.oninactive = null;
            if (stream instanceof MediaStream) {
                stream.getTracks().forEach((track) => {
                    track.stop();
                })
            }
            this._isSharing = false;
            this.clearRemoteControl();
        }
    }


    async close(){
        this.stopSharing()
        await this.session.openWindow("default");
    }

    async initialise(){
        let signaler = new RTCSignaler(this.sdata.child("rtc"));

        // create dummy stream
        let [width, height] = [640, 480];
        
        let canvas = Object.assign(new SvgPlus("canvas"), {width, height});
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        let stream = canvas.captureStream();
        ctx.fillRect(0, 0, width, height);

        this._shareScreen = new ConnectionManager(false, {video: true}, (connection) => {
            return !connection.isICEConnected;
        });
        
        this._shareScreen.on("state", (data) => {
            if (data.remoteStream && data.video != null) {
                this.contentView.setStream(data.remoteStream, this.sdata.them);
            }
        })
        this._shareScreen.start(this.sdata.iceServers, stream, signaler);

        let contentInfo = await this.sdata.get("content-info");
        if (contentInfo !== null && contentInfo.type === "stream" && contentInfo.page === this.sdata.me) {
            await this.session.openWindow("default");
        }

        this.sdata.onValue("content-info", (contentInfo) => {
            if (contentInfo !== null && contentInfo.type === "stream" && contentInfo.page !== this.sdata.me) {
                this.stopSharing();
            }
            if ((!contentInfo || contentInfo.type !== "stream") && this._isSharing) {
                this.stopSharing();
            }
            this.contentView.updateContentInfo(contentInfo);
            this._applyRemoteControlState(this._rcState);
        })

        this.sdata.onValue("content-transform", (t) => {
            if (t !== null) {
                this.contentView.content.contentTransform = t;
            }
        })

        this.sdata.onValue(`remote-control/${RC_STATE_KEY}`, (state) => {
            this._applyRemoteControlState(state);
        });
        this.sdata.onValue(`remote-control/${RC_MOVE_KEY}`, (value) => {
            this._onRemoteMoveValue(value);
        });
        this.sdata.onValue(`remote-control/${RC_KEY_KEY}`, (value) => {
            this._onRemoteKeyValue(value);
        });
    }

    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ STATIC ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    
    static get layers() {
        return {
            contentView: {
                type: "area",
                area: "fullAspectArea",
                index: 60,
            }
        }
    }


    static get name(){
        return "shareContent"
    }

    static get firebaseName(){
        return "share-content"
    }
}