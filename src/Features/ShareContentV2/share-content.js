import { SvgPlus } from "../../SvgPlus/4.js";
import { Features } from "../features-interface.js";
import { ShareContentView } from "./share-content-view.js";
import { RTCSignaler } from "../../Utilities/WebRTC/rtc-signaler.js";
import { ConnectionManager } from "../../Utilities/WebRTC/webrtc-base.js";

/**
 * @typedef {import("./content-display.js").ContentInfo} ContentInfo
 */

/**
 * Creates a silent audio track, used so the connection always has an audio
 * sender that the screen share sound can replace.
 * @return {MediaStreamTrack}
 */
function createSilentAudioTrack() {
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    const track = dest.stream.getAudioTracks()[0];
    track._isSilent = true;
    // stop() does not fire "ended", so close the context here
    const stop = track.stop.bind(track);
    track.stop = () => {
        stop();
        if (ctx.state !== "closed") ctx.close();
    };
    return track;
}

/** @param {?MediaStream} stream */
function clearEndedEvents(stream) {
    if (stream instanceof MediaStream) {
        stream.getTracks().forEach((track) => track.onended = null);
    }
}

/**
 * Share content feature: share a file (pdf or image) or your screen with the
 * other participant, with a whiteboard on top for annotating.
 *
 * Database (share-content):
 *   content-info       {ContentInfo} what is being shared
 *   content-transform  {{scale, x, y}} the pan/zoom of the content and annotations
 *   rtc                signalling for the screen share stream
 *   whiteboard         the annotations (see WhiteBoardSync)
 *   view-size/{user}   {{x, y}} the size of each user's content area (px)
 */
export default class ShareContent extends Features {
    _isSharing = false;

    constructor(session, sdata){
        super(session, sdata)
        this.contentView = new ShareContentView(this);
        this.contentView.root.events = {
            viewchange: (e) => this.sdata.set("content-transform", e.view),
            page: () => this.sdata.set("content-info/page", this.contentView.page),
            close: (e) => e.waitFor(this.close()),
            // the screen / file buttons toggle: they stop the share when
            // a screen / file is shared, otherwise they start one
            screen: (e) => e.waitFor(this.contentView.contentType === "stream" ?
                this.clearContent() : this.shareScreen()),
            clear: (e) => e.waitFor(this.clearContent()),
            file: (e) => e.waitFor(["pdf", "image"].includes(this.contentView.contentType) ?
                this.clearContent() : this.shareFile()),
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

        // stop any screen share, the file replaces it
        this.stopSharing();
        await this.sdata.set("content-transform", null);

        // Set content info to database
        await this.sdata.set("content-info", {
            type: type,
            url: url,
            page: 1,
        });
    }

    /**
     * Prompts the user to share their screen and sets up the stream for sharing.
     * Audio is requested so the browser's picker offers a "share audio" option,
     * the user chooses there whether to include the sound.
     * @return {Promise<void>}
     */
    async shareScreen(){
        let oldStream = this._shareScreen.stream;

        // share screen media options
        let displayMediaOptions = {
            video: {
                displaySurface: "window",
            },
            audio: true,
            surfaceSwitching: "include",
            selfBrowserSurface: "exclude",
            systemAudio: "include",
        }

        let stream;
        try {
            // prompt user to select a screen/window to share
            stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
        } catch (err) {
            // user cancelled (NotAllowedError), or the capture could not start
            // e.g. NotReadableError / InvalidStateError (no user gesture)
            console.warn(`share screen failed: ${err.name}: ${err.message}`);
            return;
        }

        // open the video call in picture in picture so the call stays visible
        // while the user is on the shared tab / window. Do this straight away,
        // requestWindow needs the user activation from the share click, which
        // may have expired after the picker (it then fails quietly).
        this.openPictureInPicture();

        // always send an audio track so the connection keeps an audio sender
        // (the user may not have ticked "share audio")
        if (stream.getAudioTracks().length === 0) {
            stream.addTrack(createSilentAudioTrack());
        }

        // when the user stops sharing from the browser UI (the video track
        // ends, the stream stays active while the silent audio track runs)
        stream.getVideoTracks()[0].onended = () => {
            this.endScreenShare();
            this.session.openWindow("default");
        }

        // clear old stream events
        clearEndedEvents(oldStream);

        // set the stream to the connection manager and content view
        this._shareScreen.replaceStream(stream);
        this.contentView.setStream(stream, this.sdata.me);
        this._isSharing = true;

        this.sdata.set("content-transform", null);
        this.sdata.set("content-info", {
            type: "stream",
            url: Math.random(),
            page: this.sdata.me,
        });

        await this.session.openWindow("shareContent");
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

        // resolve when a file is picked or the dialog is cancelled, otherwise
        // the click's promise never settles (a dwell click would block the
        // eye tracking until it times out). Browsers without the "cancel"
        // event fall back to the window regaining focus.
        await new Promise((r) => {
            input.addEventListener("input", r, {once: true});
            input.addEventListener("cancel", r, {once: true});
            window.addEventListener("focus", () => setTimeout(r, 1000), {once: true});
            input.click();
        })

        if (input.files?.length > 0) {
            this.uploadFile(input.files[0])
            await this.session.openWindow("shareContent")
        }
    }

    /**
     * Stops sharing the current screen
     */
    stopSharing(){
        if (this._isSharing) {
            let stream = this._shareScreen.stream;
            if (stream instanceof MediaStream) {
                clearEndedEvents(stream);
                stream.getTracks().forEach((track) => track.stop());
            }
            this._isSharing = false;
            // the PiP window was opened for the screen share
            this.session.videoCall?.closePictureInPicture();
        }
    }

    /**
     * Stops our screen share and, if the shared content is our stream, clears
     * it from the database, so it doesn't stay set to a stream that has
     * stopped (the screen button would then show "stop" with nothing shared).
     * @return {Promise<void>}
     */
    async endScreenShare() {
        this.stopSharing();
        const info = this._contentInfo;
        if (info?.type === "stream" && info.page === this.sdata.me) {
            this.contentView.setStream(null, this.sdata.me);
            await Promise.all([
                this.sdata.set("content-transform", null),
                this.sdata.set("content-info", null),
            ]);
        }
    }

    /**
     * Stops sharing any file or screen (ours or the other user's) leaving
     * just the whiteboard, the annotations are kept.
     * @return {Promise<void>}
     */
    async clearContent() {
        this.stopSharing();
        this.contentView.setStream(null, this.sdata.me);
        await Promise.all([
            this.sdata.set("content-transform", null),
            this.sdata.set("content-info", null),
        ]);
    }

    async close(){
        this.endScreenShare();
        await this.session.openWindow("default");
    }

    /**
     * Opens the video call in a picture in picture window while sharing the
     * screen. It is closed again when the screen share stops.
     * @return {Promise<void>}
     */
    async openPictureInPicture() {
        const videoCall = this.session.videoCall;
        if (!videoCall || videoCall.pictureInPicture || this._openingPIP) return;
        if (!("documentPictureInPicture" in window)) return;

        this._openingPIP = true;
        try {
            await videoCall.createPictureInPicture();
        } catch (err) {
            // e.g. NotAllowedError when not triggered by a user gesture
            console.warn(`picture in picture failed: ${err.name}: ${err.message}`);
        }
        this._openingPIP = false;

        // the share stopped while the window was opening
        if (!this._isSharing) videoCall.closePictureInPicture();
    }

    /**
     * Shares the size of each user's content area, so that everyone sees
     * the content framed with the participant's aspect ratio. On a larger
     * screen (normally the host's) the parts the participant can not see
     * are dimmed by the view's border frame.
     */
    _initialiseViewAspect() {
        const { me } = this.sdata;
        const view = this.contentView;
        const sizes = { host: null, participant: null };

        const isValid = (s) => s != null && s.x > 1 && s.y > 1;
        const chooseAspect = () => {
            let size = sizes[me];
            if (this.sdata.isUserActive("participant") && isValid(sizes.participant)) {
                size = sizes.participant;
            }
            view.viewAspect = isValid(size) ? size.x / size.y : null;
        }

        const publish = (size) => {
            sizes[me] = size;
            this.sdata.set(`view-size/${me}`, size);
            chooseAspect();
        }
        view.root.addEventListener("areasize", (e) => publish(e.size));
        if (view.areaSize) publish(view.areaSize);

        this.sdata.onValue("view-size", (val) => {
            for (let user of ["host", "participant"]) {
                if (user !== me) sizes[user] = val?.[user] ?? null;
            }
            chooseAspect();
        });

        this.sdata.onUser("joined", chooseAspect);
        this.sdata.onUser("left", chooseAspect);
    }

    async initialise(){
        // sync the annotations with the other user
        this.contentView.whiteboard.setFirebaseFrame(this.sdata.child("whiteboard"));



        this._initialiseViewAspect();

        let signaler = new RTCSignaler(this.sdata.child("rtc"));

        // create a placeholder stream until a screen is shared
        let [width, height] = [640, 480];
        let canvas = Object.assign(new SvgPlus("canvas"), {width, height});
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        let stream = canvas.captureStream();
        ctx.fillRect(0, 0, width, height);
        // a silent audio track so that screen share sound can be sent later
        stream.addTrack(createSilentAudioTrack());

        this.contentView.display.localUser = this.sdata.me;

        this._shareScreen = new ConnectionManager(false, {video: true}, (connection) => {
            return !connection.isICEConnected;
        });

        this._shareScreen.on("state", (data) => {
            if (data.remoteStream && data.video != null) {
                this.contentView.setStream(data.remoteStream, this.sdata.them);
            }
        })
        this._shareScreen.start(this.sdata.iceServers, stream, signaler);

        // a screen share of ours from a previous session can not be resumed
        let contentInfo = await this.sdata.get("content-info");
        this._contentInfo = contentInfo;
        if (contentInfo !== null && contentInfo.type === "stream" && contentInfo.page === this.sdata.me) {
            await this.endScreenShare();
            await this.session.openWindow("default");
        }

        this.sdata.onValue("content-info", (contentInfo) => {
            this._contentInfo = contentInfo;
            // the other user started sharing, or shared a file
            if (contentInfo === null || contentInfo.type !== "stream" || contentInfo.page !== this.sdata.me) {
                this.stopSharing();
            }
            this.contentView.updateContentInfo(contentInfo);
        })

        this.sdata.onValue("content-transform", (view) => {
            // ignore the old string format "scale,x,y,mode"
            if (typeof view === "object" && view !== null) {
                this.contentView.view = view;
            }
        })
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
