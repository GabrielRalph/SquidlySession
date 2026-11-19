import { addDeviceChangeCallback } from "../../Utilities/device-manager.js";
import { RTCSignaler } from "../../Utilities/WebRTC/rtc-signaler.js";
import * as WebRTC from "../../Utilities/WebRTC/webrtc-base.js";
import { getStream, startWebcam } from "../../Utilities/webcam.js";
import { Features } from "../features-interface.js";
import { createNoiseSuppressionAdapter } from "./AudioUtils/NoiseSuppress/noise-suppression.js";
import { setupVoiceDetection } from "./AudioUtils/voice-detector.js";
import { getHostPresets } from "./presets.js";
import { VideoPanelWidget, WidgetManager } from "./widgets.js";
import { relURL } from "../../Utilities/usefull-funcs.js";

function getDefaulIceServers() {
	return {
		iceServers: [
			{ urls: "stun:stun.l.google.com:19302" },
			{ urls: "stun:stun1.l.google.com:19302" },
			{ urls: "stun:stun2.l.google.com:19302" },
			{ urls: "stun:stun3.l.google.com:19302" },
			{ urls: "stun:stun4.l.google.com:19302" },
			{ urls: "stun:stun01.sipphone.com" },
			{ urls: "stun:stun.ekiga.net" },
			{ urls: "stun:stun.fwdnet.net" },
			{ urls: "stun:stun.ideasip.com" },
			{ urls: "stun:stun.iptel.org" },
			{ urls: "stun:stun.rixtelecom.se" },
			{ urls: "stun:stun.schlund.de" },
			{ urls: "stun:stunserver.org" },
			{ urls: "stun:stun.softjoys.com" },
			{ urls: "stun:stun.voiparound.com" },
			{ urls: "stun:stun.voipbuster.com" },
			{ urls: "stun:stun.voipstunt.com" },
			{ urls: "stun:stun.voxgratia.org" },
			{ urls: "stun:stun.xten.com" },
			{ urls: "stun:stun.xten.com" },
			{
				urls: "turn:13.239.38.47:80?transport=udp",
				credential: "key1",
				username: "username1",
			},
			{
				urls: "turn:13.239.38.47:80?transport=tcp",
				credential: "key1",
				username: "username1",
			},
			{ urls: "stun:stun.xten.com" },
		],
	};
}

const MuteIconNames = {
	video: ["novideo", "video"],
	audio: ["mute", "unmute"],
};

const DATA_DELIMITER = ":::";
function dummyVideo() {
	const video = document.createElement("video");
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
	_muteState = {
		host: {
			video: undefined,
			audio: undefined,
		},
		participant: {
			video: undefined,
			audio: undefined,
		},
	};

	/**
	 * @param {import("../features-interface.js").SquidlySession} session
	 * @param {import("../features-interface.js").SessionDataFrame} sdata
	 */
	constructor(session, sdata) {
		super(session, sdata);
		this.WM = new WidgetManager();
		this.WM.onMuteClick = (track, user) => this.toggleMuted(track, user);

		let isTState = (panel) => session.getToggleState(panel).some((s) => s === true);

		this.topPanelWidget = this.WM.create(
			"top", () => isTState("topPanel")
		)
		this.sidePanelWidget = this.WM.create(
			"side", () => isTState("sidePanel")
		)
		this.mainAreaWidget = this.WM.create(
			"main", () => !session.isOccupied
		);
	
		// store video elements for each user
		/** @type {Object.<string, HTMLVideoElement>} */
		this.videos = {
			host: dummyVideo(),
			participant: dummyVideo(),
		};
		this.videos[sdata.me].muted = true;

		this._setupVideoFrameCapture();
	}

	async createPictureInPicture() {
		if (!this._pictureInPicture) {
			const dWidth = (this.videos.host.videoWidth || 640) / 2;
			const dHeight = ((this.videos.host.videoHeight || 480) + (this.videos.participant.videoHeight || 480)) / 2;
			const width = 240;
			const height = width * (dHeight / dWidth);
			const pipWin = await documentPictureInPicture.requestWindow({ width, height });
			
			if (pipWin) {
				this._pictureInPicture = pipWin;
				const pipWidget = this.WM.create(
					"pip", () => true
				);
				await pipWidget.loadStyles();

				pipWidget.root.toggleAttribute("pip", true);
				pipWidget.root.styles = {
					"font-family": "sans-serif"
				}
				pipWidget.styles = {
					position: "fixed",
					left: "0",
					top: "0",
					right: "0",
					bottom: "0"
				}
				pipWin.document.body.appendChild(pipWidget);

				await pipWidget.reloadStyles({window: pipWin});
				
				pipWin.addEventListener("pagehide", () => {
					this._pictureInPicture = null;
					this.WM.remove("pip")
					console.log("Picture-in-picture closed");
					this.dispatchEvent(new Event("pip-close"));
				});

				this.dispatchEvent(new Event("pip-open"));
			}
		}
	}

	closePictureInPicture() {
		if (this._pictureInPicture) {
			this._pictureInPicture.close();
			this._pictureInPicture = null;
			this.WM.remove("pip");
			this.dispatchEvent(new Event("pip-close"));
		}
	}

	get pictureInPicture() {
		return !!this._pictureInPicture;
	}


	/* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ PRIVATE ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */

	_setupVideoFrameCapture() {
		// For each video, set up a loop to capture frames and send them to the widgets
		for (const user in this.videos) {
			const video = this.videos[user];
			this.mainAreaWidget.appendChild(video); // needed to get frames from some browsers

			if ((!video.requestVideoFrameCallback) instanceof Function) {
				video.requestVideoFrameCallback = window.requestAnimationFrame.bind(window);
			}

			const next = () => {
				if (video.videoWidth > 5 && video.videoHeight > 5) {
					this.WM.setWaitingState(user, false);
				}
				this.WM.render(
					user, 
					this._muteState[user].video ? video : null
				);
				video.requestVideoFrameCallback(next);
			};
			video.requestVideoFrameCallback(next);
		}
	}

	/**
	 * Sets the video stream for a user
	 * @param {MediaStream|null} stream
	 * @param {("host"|"participant")} user
	 */
	_setUserStream(stream, user) {
		this.videos[user].srcObject = stream;
	}

	/**
	 * If the webRTC state changes, update the video streams accordingly
	 * @param {Object} state
	 */
	_onWebRTCState(state) {
		const stream = state.remoteStream;
		if (state.isRemoteStreamReady) {
			this._setUserStream(stream, this.sdata.them);
			this.WM.setWaitingState(this.sdata.them, false);
		} else {
			this.WM.setWaitingState(this.sdata.them, true, 1500);
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
			const match = data.match(DATA_DELIMITER);
			path = data.slice(0, match.index);
			const type = data[match.index + DATA_DELIMITER.length];
			const dataString = data.slice(match.index + DATA_DELIMITER.length + 1);

			switch (type) {
				case "J":
					resData = JSON.parse(dataString);
					break;
				case "N":
					resData = Number(dataString);
					break;
				case "B":
					resData = dataString === "1";
					break;
				case "S":
					resData = dataString;
			}
		} catch (e) {
			console.warn("Error parsing data from webrtc channel", e);
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
				bool = true;
			}

			// only update database if the state has changed
			if (muteState[user][type] != bool) {
				if (setDB) await this.sdata.set(`${user}/${type}`, bool);
			}

			// update local state
			muteState[user][type] = bool;

			// if the user is the local user, update the toolbar icon and mute the track
			if (user === this.sdata.me) {
				const iconName = MuteIconNames[type][bool ? 1 : 0];
				this.session.toolBar.setMenuItemProperty(
					`control/${type}/symbol`,
					iconName,
				);
				this._mainConnection.muteTrack(type, bool);
			}

			// update the widget mute state
			this.WM.setMuteState(user, !bool, type);
		}
	}

	/**
	 * Sets up listeners to monitor mute state changes in the database
	 * @param {Object} presets
	 */
	async _setupMuteStateListeners(presets) {
		const { sdata } = this;
		const { me, them } = sdata;

		// get initial mute states from the database for the local user
		const [videoMuted, audioMuted] = await Promise.all([
			sdata.get(`${me}/video`),
			sdata.get(`${me}/audio`),
		]);

		// set initial mute states based on database or presets
		await Promise.all([
			videoMuted == null
				? this._updateMutedState("video", !!presets[me + "-video"], me)
				: null,
			audioMuted == null
				? this._updateMutedState("audio", !!presets[me + "-audio"], me)
				: null,
		]);

		// listen to changes in the database mute state
		sdata.onValue(`${me}/audio`, (value) => {
			this._updateMutedState("audio", value, me, false);
		});
		sdata.onValue(`${me}/video`, (value) => {
			this._updateMutedState("video", value, me, false);
		});
		sdata.onValue(`${them}/audio`, (value) => {
			this._updateMutedState("audio", value, them, false);
		});
		sdata.onValue(`${them}/video`, (value) => {
			this._updateMutedState("video", value, them, false);
		});
	}

	async _onUserLeft() {
		this.WM.setWaitingState(this.sdata.them, true);
		clearTimeout(this._onUserLeftTimeout);
		this._onUserLeftTimeout = setTimeout(() => {
			if (!this.sdata.isUserActive(this.sdata.them)) {
				this.WM.clear(this.sdata.them);
			}
		}, 5000);
	}

	async _onUserJoined() {
		clearTimeout(this._onUserLeftTimeout);
		this.WM.setVisibility(this.sdata.them, true);
	}

	/**
	 * Sets the volume for all video elements
	 * @param {number} value - 0 to 100
	 */
	_setVolume(value) {
		if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
			value = 75;
		}
		value = value / 100; // convert to 0-1 rang
		for (const user in this.videos) {
			this.videos[user].volume = value;
		}
	}

	async initialise() {
		const connection = new WebRTC.ConnectionManager();
		connection.on("state", this._onWebRTCState.bind(this));
		connection.on("data", this._onWebRTCData.bind(this));
		if (await startWebcam()) {
			// Get presets from the host
			const presets = await getHostPresets(this.sdata.hostUID);
			this.presets = presets;

			// set the host's name
			const name = (presets.name || "host") +
				(presets.pronouns ? ` (${presets.pronouns})` : "");
			this.WM.setUserName("host", name);

			// set the host's image
			if (presets.image) {
				this.WM.setUserImage("host", presets.image);
			}

			// get new stream from webcam
			const rawStream = getStream(2);

			// denoise here
			this._noiseSuppressionAdapter =
				await createNoiseSuppressionAdapter(rawStream);
			const stream = this._noiseSuppressionAdapter.stream;

			// set up voice detection
			setupVoiceDetection(stream, (d) => this.WM.setTalking(this.sdata.me, d));

			// Start the webrtc connection
			const signaler = new RTCSignaler(this.sdata);
			const config = this.sdata.iceServers;
			connection.start(config, stream, signaler);
			this._mainConnection = connection;

			// set the local video stream to the widget
			this._setUserStream(stream, this.sdata.me);
			this._setupMuteStateListeners(presets);

			this.session.toolBar.addMenuItems("control", [
				{
					name: "video",
					symbol: "novideo",
					text: "video",
					index: 0,
					onSelect: (e) => this.toggleMuted("video", this.sdata.me),
				},
				{
					name: "audio",
					symbol: "mute",
					text: "audio",
					index: 360,
					onSelect: (e) => this.toggleMuted("audio", this.sdata.me),
				},
			]);

			this.session.settings.onValue(
				`${this.sdata.me}/volume/level`,
				(value) => this._setVolume(value)
			);
			this.session.settings.onValue(
				"participant/profileSettings/name",
				(value) => this.WM.setUserName("participant", value)
			);
			this.session.settings.onValue(
				"participant/profileSettings/image",
				(value) => this.WM.setUserImage("participant", value)
			);

			// Listen to changes in audio output device and update sinkId accordingly
			let lastSinkId = null;
			addDeviceChangeCallback((devices) => {
				const activeOutput = Object.values(devices.audiooutput || {}).find(
					(d) => d.active,
				);
				if (activeOutput && activeOutput.deviceId !== lastSinkId) {
					lastSinkId = activeOutput.deviceId;
					for (const user in this.videos) {
						this.videos[user].setSinkId(lastSinkId);
					}
				}
			});

			//listen to active users
			this.sdata.onUser("left", (key) => {
				if (key == this.sdata.them) {
					this._onUserLeft();
				}
			});

			this.sdata.onUser("joined", (key) => {
				if (key == this.sdata.them) {
					this._onUserJoined();
					this.WM.setWaitingState(this.sdata.them, true);
				}
			});

			this.WM.setVisibility(this.sdata.me, true);
		} else {
			this.throwInitialisationError(
				"Could not start webcam. Please check your camera permissions.",
				"https://firebasestorage.googleapis.com/v0/b/eyesee-d0a42.appspot.com/o/videopermissions.mp4?alt=media&token=743c04cc-974e-4ed9-bb21-8f0ac56c2d83",
			);
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
				case "object":
					dataString = "J" + JSON.stringify(data);
					break;
				case "number":
					dataString = "N" + data;
					break;
				case "boolean":
					dataString = "B" + (data ? 1 : 0);
					break;
				case "string":
					dataString = "S" + data;
					break;
				default:
					console.warn(
						`Cannot send ${typeof data} accross webrtc data channel.`,
					);
					break;
			}

			if (dataString !== null && this._mainConnection != null) {
				const fullString = path + ":::" + dataString;
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
			const oldState = muteState[user][type];
			await this._updateMutedState(type, !oldState, user);
		}
	}

	/* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ STATIC ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */

	static async loadResources() {
		await VideoPanelWidget.loadStyleSheets();
	}

	static get name() {
		return "videoCall";
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
			},
		};
	}

	static get firebaseName() {
		return "video-call";
	}
}