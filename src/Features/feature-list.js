import { relURL } from '../Utilities/usefull-funcs.js';

/** @typedef {import('./ToolBar/tool-bar.js').default} ToolBarFeature */
/** @typedef {import('./Settings/settings.js').default} SettingsFeature */
/** @typedef {import('./Cursors/cursors.js').default} Cursors */
/** @typedef {import('./VideoCall/video-call.js').default} VideoCall */
/** @typedef {import('./EyeGaze/eye-gaze.js').default} EyeGazeFeature */
/** @typedef {import('./Keyboard/keyboard.js').default} KeyboardFeature */
/** @typedef {import('./AccessControl/access-control.js').default} AccessControl */
/** @typedef {import('./Text2Speech/text2speech.js').default} Text2Speech */
/** @typedef {import('./Notifications/notifications.js').default} Notifications */
/** @typedef {import('./Heatmap/heatmap-feature.js').default} HeatmapFeature */
/** @typedef {import('./AAC/grid.js').default} AACGrid */
/** @typedef {import('./AccessSetup/access-setup.js').default} AccessSetup */
/** @typedef {import('./Apps/apps.js').default} Apps */
/** @typedef {import('./Chat/chat.js').default} ChatFeature */
/** @typedef {import('./Quiz/quiz.js').default} QuizFeature */
/** @typedef {import('./ShareContent/share-content.js').default} ShareContent */

export class SquildyFeatureProxy {

	/** @return {ToolBarFeature} */
	get toolBar() { return this.getFeature("toolBar"); }

	/** @return {SettingsFeature} */
	get settings() { return this.getFeature("settings"); }

	/** @return {Cursors} */
	get cursors() { return this.getFeature("cursors"); }

	/** @return {VideoCall} */
	get videoCall() { return this.getFeature("videoCall"); }

	/** @return {EyeGazeFeature} */
	get eyeGaze() { return this.getFeature("eyeGaze"); }

	/** @return {KeyboardFeature} */
	get keyboard() { return this.getFeature("keyboard"); }

	/** @return {AccessControl} */
	get accessControl() { return this.getFeature("accessControl"); }

	/** @return {Text2Speech} */
	get text2speech() { return this.getFeature("text2speech"); }

	/** @return {Notifications} */
	get notifications() { return this.getFeature("notifications"); }

	/** @return {HeatmapFeature} */
	get heatmaps() { return this.getFeature("heatmaps"); }

	/** @return {AACGrid} */
	get aacGrid() { return this.getFeature("aacGrid"); }

	/** @return {AccessSetup} */
	get accessSetup() { return this.getFeature("accessSetup"); }

	/** @return {Apps} */
	get apps() { return this.getFeature("apps"); }

	/** @return {ChatFeature} */
	get chat() { return this.getFeature("chat"); }

	/** @return {QuizFeature} */
	get quiz() { return this.getFeature("quiz"); }

	/** @return {ShareContent} */
	get shareContent() { return this.getFeature("shareContent"); }

	/** @override */
	getFeature() { }

}

export const FeaturesList = [
	[() => import("./ToolBar/tool-bar.js"), "toolBar"],
	[() => import("./Settings/settings.js"), "settings"],
	[() => import("./Cursors/cursors.js"), "cursors"],
	[() => import("./VideoCall/video-call.js"), "videoCall"],
	[() => import("./EyeGaze/eye-gaze.js"), "eyeGaze"],
	[() => import("./Keyboard/keyboard.js"), "keyboard"],
	[() => import("./AccessControl/access-control.js"), "accessControl"],
	[() => import("./Text2Speech/text2speech.js"), "text2speech"],
	[() => import("./Notifications/notifications.js"), "notifications"],
	[() => import("./Heatmap/heatmap-feature.js"), "heatmaps"],
	[() => import("./AAC/grid.js"), "aacGrid"],
	[() => import("./AccessSetup/access-setup.js"), "accessSetup"],
	[() => import("./Apps/apps.js"), "apps"],
	[() => import("./Chat/chat.js"), "chat"],
	[() => import("./Quiz/quiz.js"), "quiz"],
	[() => import("./ShareContent/share-content.js"), "shareContent"]
];