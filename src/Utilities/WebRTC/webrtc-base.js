import { RTCSignaler } from "./rtc-signaler.js";
const GetTrackMethods = {
    "video": "getVideoTracks",
    "audio": "getAudioTracks"
}
const MinTimeTillRestart = 10000; // 5 seconds

console.log(`%cWebRTC Base Loaded ${MinTimeTillRestart}`, 'color:rgb(252, 113, 7); background:rgb(27, 30, 33); padding: 10px; border-radius: 10px;');

window.show_rtc_base = true
/* Log Functions
    */

let LOGS = {}
window.WebRTCLogs = LOGS;

// function rtc_base_log(str) {
//     if (window.show_rtc_base) {
//         LOGS.m += str + "\n";
//         console.log("%c\t" + str, 'color:rgb(186, 218, 85); background:rgb(27, 30, 33); padding: 10px; border-radius: 10px;');
//     }
// }

// function rtc_l1_log(str) {
//     LOGS.m += str + "\n";
//     console.log("%c" + str, 'color:#00a3fd; background:rgb(27, 30, 33); padding: 10px; border-radius: 10px;');
// }

function preferOpus(description) {
    return description;
}

let GlobalCount = 0;
class WebRTCConnection {

    /** @type {MediaStream} */
    RemoteStream = null;
    
    /** @type {MediaStream} */
    LocalStream = null;
    
    /** @type {RTCPeerConnection} */
    PC = null;
    
    /** @type {RTCSignaler} */
    Signaler = null;
    
    RemoteContentStatus = {
        video: null,
        audio: null,
        data_send: null,
        data_receive: null,
        ice_state: null,
        sent: null,
        recv: null,
    }
    
    /** @type {RTCDataChannel?} */
    ReceiveChannel = null;

    /** @type {RTCDataChannel?} */
    SendChannel = null;
    
    makingOffer = false;
    ignoreOffer = false;
    sessionState = "closed";
    
    EventListeners = {};
    LastConfig = null;

    monitorTracks = {video: true, audio: true}

    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ CHANNEL RECEIVERS ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
      
    receiverModes = {
        "S": () => {
      
        },
        "J": (d) => {
            try {
                this.callEvent("data", JSON.parse(d))
            } catch (e) {}
        },
        "N": (d) => {
            this.callEvent("data", d);
        },
        // "A": () => {
        //     this.sessionState = "open"
        //     this.RemoteContentStatus.recv = true;
        //     this.updateHandler();
        // }
    }

    constructor(config, stream, signaler, useDataChannel = true) {
        this.id = GlobalCount;
        LOGS[this.id] = "";
        this.config = config;
        this.LocalStream = stream;
        this.Signaler = signaler;
        this.useDataChannel = useDataChannel;
        GlobalCount++;
    }

    async start() {
        this.timeOfStart = new Date().getTime();
        await this.Signaler.restart();

        this.PC = new RTCPeerConnection(this.config);
        const {PC, Signaler, LocalStream} = this;

        PC.ondatachannel = this.ondatachannel.bind(this);
        PC.ontrack = this.ontrackadded.bind(this)
        PC.onnegotiationneeded = this.onnegotiationneeded.bind(this);
        PC.oniceconnectionstatechange = this.oniceconnectionstatechange.bind(this);
        PC.onicecandidate = this.onicecandidate.bind(this);

        Signaler.on("candidate", this.onCandidate.bind(this));
        Signaler.on("description", this.onDescription.bind(this));

       
        if (this.useDataChannel) this.startMessageChannel();
        for (const track of LocalStream.getTracks()) {
            PC.addTrack(track, LocalStream);
        }
    
        await Signaler.start();    
        this.updateHandler();
    }

    get isICEConnected(){
        return this.RemoteContentStatus.ice_state === "connected";
    }

    get isRemoteStreamReady(){
        const {RemoteContentStatus: {video, audio, ice_state}, RemoteStream} = this;
        return RemoteStream instanceof MediaStream && 
            ("video" in this.monitorTracks ? video : true) &&
            ("audio" in this.monitorTracks ? audio : true) &&
            ice_state == "connected";
    }

    get isDataChannelReady(){
        const {useDataChannel} = this;
        const {data_send, data_receive} = this.RemoteContentStatus;
        return (!useDataChannel) || (data_send == "open" && data_receive == "open");
    }
    
    get isStatusReady(){
        const {isRemoteStreamReady, isDataChannelReady} = this;
        return isDataChannelReady && isRemoteStreamReady;
    }


    logState(){
        let vidAud = Object.keys(this.monitorTracks);
        const values = vidAud.map((v) => [v.slice(0, 3), this.RemoteContentStatus[v]]);

        values.push(["ice", this.RemoteContentStatus.ice_state == "connected"]);

        if (this.useDataChannel) {
            values.push(["in", this.RemoteContentStatus.data_receive == "open"]);
            values.push(["out", this.RemoteContentStatus.data_send == "open"]);
        }

        let cc = (val, isLast) => `color: ${val ? "#bada55" : "#eb5533"}; background: rgb(18, 17, 17); padding: 3px; ${isLast ? "border-radius: 0px 10px 10px 0px; padding-right: 5px;" : ""}`;

        let logStr = values.map(v => `${v[0]}: ${v[1] ? "ready" : "not ready"}`).join(" | ");
        LOGS[this.id] += logStr + "\n";

        console.log(
        `%c${this.id}: ${values.map(v => `%c${v[0]}`).join(" ")}`, 
        `background: ${this.isStatusReady ? "rgb(8, 143, 17)" : "rgb(203, 13, 13)"}; padding: 3px 3px 3px 5px; color: white; border-radius: 10px 0px 0px 10px;`,
        ...values.map((v, i) => cc(v[1], i == values.length - 1)));
    }

    log(string, color = "rgb(7, 166, 252)") {
        LOGS[this.id] += string + "\n";
        if (window.show_rtc_base) {
            console.log(
            `%c${this.id}: %c${string}`, 
            `background: ${this.isStatusReady ? "rgb(8, 143, 17)" : "rgb(203, 13, 13)"}; padding: 3px 3px 3px 5px; color: white; border-radius: 10px 0px 0px 10px;`,
            `color: ${color}; background: rgb(18, 17, 17); padding: 3px; border-radius: 0px 10px 10px 0px; padding-right: 5px;`
            );
        }
    }
      
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ UPDATE HANDLER ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    callEvent(key, data) {
        if (key in this.EventListeners) {
            for (let cb of this.EventListeners[key]) cb(data);
        }
    }
    

    updateHandler(){
        const {sessionState, RemoteContentStatus, isStatusReady, RemoteStream} = this;
        // if (this.useDataChannel) {
        //     // Session is open and has now started
        //     // Send message to remote caller telling them we are open
        //     if (!RemoteContentStatus.sent && isStatusReady) {
        //         this.sendMessage("A");
        //         RemoteContentStatus.sent = true;
        
        //     // Session has closed
        //     } else if (sessionState == "open" && !isStatusReady) {
        //         this.sessionState = "closed";
        //         rtc_l1_log("closed");
        //     }
        // } else {
        this.sessionState = this.isStatusReady ? "open" : "closed";
        // }
    
        this.logState();
        let copy = {};
        for (let key in RemoteContentStatus) copy[key] = RemoteContentStatus[key];
        copy.state = sessionState;
        copy.remoteStream = RemoteStream;
        copy.isRemoteStreamReady = this.isRemoteStreamReady;
        this.callEvent("state", copy);
    }
    
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ WEBRTC BASE METHODS ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    
    /**
     * @param {{track: MediaStreamTrack, streams: MediaStream[]}} param0
     */
    ontrackadded({ track, streams }){
        streams[0].oninactive = () => {
            this.log("STream inactive")
        }
        this.log(`track received ${track.kind} [${streams[0].id.split("-")[0]}] (${track.enabled ? "enabled" : "disabled"}) (${track.muted ? "muted" : "unmuted"})`);
        this.RemoteStream = streams[0];
    
        let onunmute = () => {
            this.log("track unmuted " + track.kind);
            this.RemoteContentStatus[track.kind] = track;
            this.updateHandler();
        };
        track.addEventListener("unmute", onunmute);
        if (!track.muted && track.enabled) onunmute();

        track.addEventListener("mute", () => {
            this.log("track muted " + track.kind);
            this.RemoteContentStatus[track.kind] = null;
            this.updateHandler();
        });
    }
    
    async onnegotiationneeded(){
        if (!this.Signaler.isPolite || this.PC.remoteDescription !== null) {
            this.log("negotiation needed", "rgb(252, 207, 7)");
            try {
                this.makingOffer = true;

                await this.PC.setLocalDescription();
                this.log("description --> " + this.PC.localDescription.type);
                this.Signaler.send(preferOpus(this.PC.localDescription));
            } catch (err) {
                this.log("negotion error " + err, "rgb(252, 27, 7)");
            } finally {
                this.makingOffer = false;
            }
        } else {
            this.log("negotiation ignored", "rgb(252, 113, 7)");
        }
    }
    
    oniceconnectionstatechange(){
        const {PC, RemoteContentStatus} = this;
        if (PC.iceConnectionState === "failed") {
          PC.restartIce();
        } else if (PC.iceConnectionState == "connected"){
        } else if (PC.iceConnectionState === "disconnected") {
            this.closeSendMessageChannel();
        }
        RemoteContentStatus.ice_state = PC.iceConnectionState;
        this.updateHandler();
    }
    
    onicecandidate(data) {
        this.log("candidate -->");
        this.Signaler.send(data.candidate);
    }
    
    
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ DATA CHANNEL METHODS ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    
    ondatachannel(event) {
        if (this.SendChannel == null) {
            this.startMessageChannel();
        }
        this.ReceiveChannel = event.channel;
        this.ReceiveChannel.onmessage = this.handleReceiveMessage.bind(this);
        this.ReceiveChannel.onopen = this.handleReceiveChannelStatusChange.bind(this);
        this.ReceiveChannel.onclose = this.handleReceiveChannelStatusChange.bind(this);
    }
    
    startMessageChannel(){
        if (this.SendChannel) {
            this.SendChannel.close();
        }
        this.SendChannel = this.PC.createDataChannel("sendChannel");
        this.SendChannel.onopen = this.handleSendChannelStatusChange.bind(this);
        this.SendChannel.onclose = this.handleSendChannelStatusChange.bind(this);
    }

    closeSendMessageChannel(){
        if (this.SendChannel) {
            this.SendChannel.close();
        }
        this.RemoteContentStatus.recv = false;
        this.RemoteContentStatus.send = false;
        this.SendChannel = null;
    }

    closeReceiveMessageChannel(){
        if (this.ReceiveChannel) {
            this.ReceiveChannel.close();
        }
        this.RemoteContentStatus.recv = false;
        this.RemoteContentStatus.send = false;
        this.ReceiveChannel = null;
    }
    
    /* Send message sends a message accros the data channel*/
    sendMessage(message) {
        const {SendChannel} = this;
        if (SendChannel && SendChannel.readyState == "open") {
            SendChannel.send(message);
        }
    }
    
    /* Send message sends a message accros the data channel*/
    handleReceiveMessage(event) {
        const {data} = event;
        const mode = data[0];
        if (mode in this.receiverModes) {
            this.receiverModes[mode](data.slice(1))
        }
    }
    
    handleReceiveChannelStatusChange(event) {
        const {RemoteContentStatus, ReceiveChannel} = this;
        if (ReceiveChannel) {
            const state = ReceiveChannel.readyState;
            RemoteContentStatus.data_receive = state;
            if (state == "closed") {
                this.closeReceiveMessageChannel();
            }
            this.updateHandler("state");
        }
    }
      
    handleSendChannelStatusChange(event) {
        const {SendChannel, RemoteContentStatus} = this;
        if (SendChannel) {
            const state = SendChannel.readyState;
            RemoteContentStatus.data_send = state
            if (state == "closed") {
                this.closeSendMessageChannel();
            }
            this.updateHandler("state")
        }
    }
    
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ SIGNALER CALLBACKS ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    
    
    async onDescription(description) {
        const {PC, Signaler, makingOffer} = this;
        this.log("description <-- " + description.type);
        this.log("signalingState: " + PC.signalingState);
    
        if (description.type === "answer" && PC.signalingState !== "have-local-offer") {
            this.log(`stale answer ignored (state: ${PC.signalingState})`, "rgb(253, 166, 120)");
        } else {
            const offerCollision = description.type === "offer" &&
                                  (makingOffer || PC.signalingState !== "stable");
        
            this.ignoreOffer = !Signaler.isPolite && offerCollision;
            if (!this.ignoreOffer) {
                 try {
                    await PC.setRemoteDescription(description);
                    if (description.type === "offer") {
                        await PC.setLocalDescription();
                        this.log("description --> " + PC.localDescription.type);
                        Signaler.send(preferOpus(PC.localDescription));
                    }
                } catch (e) {
                    this.log("description error " + e, "rgb(252, 27, 7)");
                }
            }
        }
    }
    
    async onCandidate(candidate) {
        this.log("candidate <--");
    
        try {
            await this.PC.addIceCandidate(candidate);
            this.log("candidate <--");
        } catch (e) {
            if (!this.ignoreOffer) {
            }
        }
    }
    
    close(){
        this.EventListeners = {};
        this.PC.close();
        this.closeSendMessageChannel();
        this.closeReceiveMessageChannel();
        this.Signaler.removeAllListeners();
    }

    on(key, cb) {
        if (cb instanceof Function) {
            if (!(key in this.EventListeners)) {
                this.EventListeners[key] = [];
            }
            this.EventListeners[key].push(cb);
        }
    }
}

export class ConnectionManager {
    EventListeners = {};
    restartTimeout = null;
    stream = null;
    signaler = null;
    config = null;
    restartCondition = (connection) => !connection.isStatusReady;

    constructor(useDataChannel = true, monitorTracks = {video: true, audio: true}, restartCondition = null) {
        this.useDataChannel = useDataChannel;
        this.monitorTracks = monitorTracks;
        if (restartCondition instanceof Function) {
            this.restartCondition = restartCondition;
        }
    }

    async getStats() {
        if (this.connection && this.connection.PC instanceof RTCPeerConnection) {
            return await this.connection.PC.getStats();
        }
        return null;
    }

    closeConnection(){
        if (this.connection) {
            this.connection.close();
            this.connection = null;
        }
    }

    async start(config = this.config, stream = this.stream, signaler = this.signaler) {
        this.closeConnection();
        this.config = config;
        this.stream = stream;

        let func = (e) => {
            if (e.srcElement === this.stream) {
                const {newTrack, oldTrack} = e;
                this.replaceTrack(oldTrack, newTrack);
            } else {
                e.srcElement.removeEventListener("trackchanged", func);
            }
        }
        this.stream.addEventListener("trackchanged", func);
    
        this.signaler = signaler;
    
        this.connection = new WebRTCConnection(config, stream, signaler, this.useDataChannel);
        const {connection} = this;
        connection.monitorTracks = this.monitorTracks;
        connection.id = signaler.fb.getFirebaseName() + "-" + connection.id
        connection.EventListeners = this.EventListeners;
        await connection.start();


        signaler.on("restart", (timeOfStart) => {
            clearTimeout(this.restartTimeout);
            let timeSinceStart = new Date().getTime() - timeOfStart;
            this.connection.log(`${signaler.fb.them} started`, "rgb(255, 134, 237)");

            // Polite peer with no remote description is waiting for the impolite peer's
            // offer. Restarting here causes a loop — the host will initiate when it
            // receives this peer's restart signal.
            if (signaler.isPolite && this.connection?.PC?.remoteDescription === null) {
                this.connection.log("restart ignored (polite, awaiting offer)", "rgb(255, 152, 195)");
                return;
            }

            const doRestart = () => {
                let isRestart = this.restartCondition(this.connection);
                this.connection.log("restart check" + (isRestart ? ", restarting" : ""), "rgb(255, 152, 241)");
                if (isRestart) this.start();
            };

            // If connection is already broken, restart immediately — no point waiting.
            // Only delay if the connection is currently healthy (debounce against loops).
            if (timeSinceStart >= MinTimeTillRestart) {
                if (this.restartCondition(this.connection)) {
                    doRestart();
                } else {
                    this.connection.log("restart not needed", "rgb(255, 152, 195)");
                }
            } else {
                this.restartTimeout = setTimeout(doRestart, MinTimeTillRestart - timeSinceStart);
            }
        });
    }

    on(key, cb) {
        if (cb instanceof Function) {
            if (!(key in this.EventListeners)) {
                this.EventListeners[key] = [];
            }
            this.EventListeners[key].push(cb);
        }
    }

    send(data) {
        if (this.connection !== null ) {
            if (typeof data === "object" && data !== null) {
                data = JSON.stringify(data);
                this.connection.sendMessage("J"+data);
            } else {
                this.connection.sendMessage("N"+data);
            }
        }
    }

    /** Mutes a local track, either video or audio.
     * @param {("audio"|"video")} type
     * @param {boolean?} bool whether the track is enabled 
     *                        if set null toggles the track state
     * @return {boolean?} returns the enable state of the track 
     *                    null if no track was set.
     */
    muteTrack(type, bool) {
        if (type in GetTrackMethods) {
            let tracks = this.stream[GetTrackMethods[type]]();
            let t = tracks[0];
            if (bool == null) bool = !t.enabled;
            t.enabled = bool;
        } else {
            bool = null;
        }
        return bool;
    }

    /** @param {MediaStream} stream */
    replaceStream(stream){
        let oldStream = this.stream;
        if (this.connection && this.connection.PC instanceof RTCPeerConnection) {
            for (let track of stream.getTracks()) {
                const sender = this.connection.PC.getSenders().find((s) => s.track?.kind === track.kind);
                if (sender) {
                    sender.replaceTrack(track);
                }
            }
        }
        for (let track of oldStream.getTracks()) {
            track.stop();
        }
        this.stream = stream;
    }

    /** @param {MediaStreamTrack} track */
    replaceTrack(oldTrack, newTrack){
        console.log(`replacing track\n OLD: ${oldTrack.label}\n NEW: ${newTrack.label}`);
        
        if (this.connection && this.connection.PC instanceof RTCPeerConnection) {
            const sender = this.connection.PC.getSenders().find((s) => s.track === oldTrack);
            if (sender) {
                sender.replaceTrack(newTrack);
            }
        }
    }
    
}