import { addDeviceChangeCallback } from "../../Utilities/device-manager.js";
import { RTCSignaler } from "../../Utilities/WebRTC/rtc-signaler.js";
import * as WebRTC from "../../Utilities/WebRTC/webrtc-base.js";
import { getStream, startWebcam } from "../../Utilities/webcam.js";
import { Features } from "../features-interface.js";
import { deepFilterNetDenoiser } from "./AudioUtils/Denoise/DeepFilterNet/deepfilternet.js";
import { recoverDenoisedAudio } from "./AudioUtils/Denoise/denoise-recovery.js";
import { createAdapterWithFallback } from "./AudioUtils/Denoise/denoise-controller.js";
import {
	DENOISER_MODES,
	getDenoiserMode,
	subscribeDenoiserMode,
} from "./AudioUtils/Denoise/denoiser-mode.js";
import { fastEnhancerTinyDenoiser } from "./AudioUtils/Denoise/FastEnhancer/fastenhancer.js";
import { rnnoiseDenoiser } from "./AudioUtils/Denoise/RNNoise/rnnoise.js";
import { setupVoiceDetection } from "./AudioUtils/voice-detector.js";
import { getHostPresets } from "./presets.js";
import { VideoPanelWidget } from "./widgets.js";

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
		this.topPanelWidget = new VideoPanelWidget();
		this.sidePanelWidget = new VideoPanelWidget();
		this.mainAreaWidget = new VideoPanelWidget();

		this.mainAreaWidget.isVisibleForUser = () => !session.isOccupied;
		this.sidePanelWidget.isVisibleForUser = () =>
			session.getToggleState("sidePanel").some((s) => s === true);
		this.topPanelWidget.isVisibleForUser = () =>
			session.getToggleState("topPanel").some((s) => s === true);

		/** @type {[VideoPanelWidget]} */
		this._allWidgets = [
			this.topPanelWidget,
			this.sidePanelWidget,
			this.mainAreaWidget,
		];

		// store video elements for each user
		/** @type {Object.<string, HTMLVideoElement>} */
		this.videos = {
			host: dummyVideo(),
			participant: dummyVideo(),
		};
		this.videos[sdata.me].muted = true;

		this._setupVideoFrameCapture();
		this._setWidgetEvents();
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
				video.requestVideoFrameCallback =
					window.requestAnimationFrame.bind(window);
			}
			const next = () => {
				if (video.videoWidth > 5 && video.videoHeight > 5) {
					this._setWidgetWaitingState(user, false);
				}
				for (const w of this._allWidgets) {
					if (w.isVisibleForUser()) {
						w[user].captureFrame(this._muteState[user].video ? video : null);
					}
				}
				video.requestVideoFrameCallback(next);
			};
			video.requestVideoFrameCallback(next);
		}
	}

	/**
	 * Updates the user name for all widgets
	 * @param {string} name
	 * @param {("host"|"participant")} user
	 */
	_setWidgetUserName(name, user) {
		this._allWidgets.forEach((w) => {
			w[user].userName = name;
		});
	}

	/**
	 * Updates the user image for all widgets
	 * @param {string} url
	 * @param {("host"|"participant")} user
	 */
	_setWidgetUserImage(url, user) {
		this._allWidgets.forEach((w) => {
			w[user].userImage = url;
		});
	}

	/**
	 * Sets the talking state icon for all widgets
	 * @param {boolean} bool
	 * @param {("host"|"participant")} user
	 */
	_setWidgetTalking(bool, user) {
		this._allWidgets.forEach((w) => {
			w[user].isTalking = bool;
		});
	}

	/**
	 * Sets up event listeners for all widgets
	 */
	_setWidgetEvents() {
		this._allWidgets.forEach((w) => {
			w.addEventListener("mute", (e) => {
				this.toggleMuted(e.track, e.user);
			});
		});
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
		this._allWidgets.forEach((w) => {
			w[user][type + "_muted"] = bool;
		});
	}

	_setWidgetWaitingState(user, bool, wait = 0) {
		clearTimeout(this._setWidgetWaitingStateTimeout);
		if (wait > 0) {
			this._setWidgetWaitingStateTimeout = setTimeout(() => {
				this._setWidgetWaitingState(user, bool);
			}, wait);
		} else {
			const k = "_waitingState" + user;
			if (this[k] !== bool) {
				this[k] = bool;
				console.log("Setting waiting state for", user, "to", bool);
				this._allWidgets.forEach((w) => {
					w[user].waiting = bool;
				});
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
		console.log(
			(!isVisible ? "Clearing" : "Showing") + " widgets for user",
			user,
		);
		this._allWidgets.forEach((w) => {
			w.toggleUserVideoDisplay(user, isVisible);
		});
	}

	/**
	 * If the webRTC state changes, update the video streams accordingly
	 * @param {Object} state
	 */
	_onWebRTCState(state) {
		const stream = state.remoteStream;
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
			this._setWidgetMuteState(type, !bool, user);
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
		this._setWidgetWaitingState(this.sdata.them, true);
		clearTimeout(this._onUserLeftTimeout);
		this._onUserLeftTimeout = setTimeout(() => {
			if (!this.sdata.isUserActive(this.sdata.them)) {
				this._clearWidgets(this.sdata.them);
			}
		}, 5000);
	}

	async _onUserJoined() {
		clearTimeout(this._onUserLeftTimeout);
		this._setWidgetVisibility(this.sdata.them, true);
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
			const name =
				(presets.name || "host") +
				(presets.pronouns ? ` (${presets.pronouns})` : "");
			this._setWidgetUserName(name, "host");

			// set the host's image
			if (presets.image) {
				this._setWidgetUserImage(presets.image, "host");
			}

			// get new stream from webcam
			const rawStream = getStream(2);

			// Keep one published stream so a console mode change can replace only
			// its audio track while the WebRTC connection stays alive.
			let stream = null;
			this._noiseSuppressionAdapter = await createAdapterWithFallback(
				rawStream,
				{
					preferredMode: getDenoiserMode(),
					denoisers: {
						[DENOISER_MODES.FASTENHANCER_TINY]: fastEnhancerTinyDenoiser,
						[DENOISER_MODES.RNNOISE]: rnnoiseDenoiser,
						[DENOISER_MODES.DEEPFILTERNET]: deepFilterNetDenoiser,
					},
					onError: (error) => {
						console.warn(
							"Denoising failed; falling back to the microphone.",
							error,
						);
						if (stream) {
							recoverDenoisedAudio({
								rawStream,
								publishedStream: stream,
								connection,
							});
						}
					},
				},
			);
			stream = this._noiseSuppressionAdapter.stream;
			this._unsubscribeDenoiserMode?.();
			this._unsubscribeDenoiserMode = subscribeDenoiserMode((mode) =>
				this._noiseSuppressionAdapter.switchMode(mode),
			);

			// set up voice detection
			setupVoiceDetection(stream, (d) => {
				this._setWidgetTalking(d, this.sdata.me);
			});

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
				(value) => {
					this._setVolume(value);
				},
			);
			this.session.settings.onValue(
				"participant/profileSettings/name",
				(value) => {
					this._setWidgetUserName(value, "participant");
				},
			);
			this.session.settings.onValue(
				"participant/profileSettings/image",
				(value) => {
					this._setWidgetUserImage(value, "participant");
				},
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
					this._setWidgetWaitingState(this.sdata.them, true);
				}
			});

			this._setWidgetVisibility(this.sdata.me, true);
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
