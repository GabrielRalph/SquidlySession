import { relURL } from '../Utilities/usefull-funcs.js';

/** @typedef {import('./ToolBar/tool-bar.js').default} ToolBarFeature */
/** @typedef {import('./Settings/settings.js').default} SettingsFeature */
/** @typedef {import('./VideoCall/video-call.js').default} VideoCall */
/** @typedef {import('./Cursors/cursors.js').default} Cursors */
/** @typedef {import('./EyeGaze/eye-gaze.js').default} EyeGazeFeature */
/** @typedef {import('./Text2Speech/text2speech.js').default} Text2Speech */
/** @typedef {import('./Keyboard/keyboard.js').default} KeyboardFeature */
/** @typedef {import('./Notifications/notifications.js').default} Notifications */
/** @typedef {import('./AccessControl/access-control.js').default} AccessControl */
/** @typedef {import('./AAC/grid.js').default} AACGrid */
/** @typedef {import('./Apps/apps.js').default} Apps */
/** @typedef {import('./Chat/chat.js').default} ChatFeature */
/** @typedef {import('./Quiz/quiz.js').default} QuizFeature */
/** @typedef {import('./ShareContent/share-content.js').default} ShareContent */
/** @typedef {import('./WalkThrough/walk-through.js').default} WalkThroughFeature */

export class SquildyFeatureProxy {

	/** @return {ToolBarFeature} */
	get toolBar() { return this.getFeature("toolBar"); }

	/** @return {SettingsFeature} */
	get settings() { return this.getFeature("settings"); }

	/** @return {VideoCall} */
	get videoCall() { return this.getFeature("videoCall"); }

	/** @return {Cursors} */
	get cursors() { return this.getFeature("cursors"); }

	/** @return {EyeGazeFeature} */
	get eyeGaze() { return this.getFeature("eyeGaze"); }

	/** @return {Text2Speech} */
	get text2speech() { return this.getFeature("text2speech"); }

	/** @return {KeyboardFeature} */
	get keyboard() { return this.getFeature("keyboard"); }

	/** @return {Notifications} */
	get notifications() { return this.getFeature("notifications"); }

	/** @return {AccessControl} */
	get accessControl() { return this.getFeature("accessControl"); }

	/** @return {AACGrid} */
	get aacGrid() { return this.getFeature("aacGrid"); }

	/** @return {Apps} */
	get apps() { return this.getFeature("apps"); }

	/** @return {ChatFeature} */
	get chat() { return this.getFeature("chat"); }

	/** @return {QuizFeature} */
	get quiz() { return this.getFeature("quiz"); }

	/** @return {ShareContent} */
	get shareContent() { return this.getFeature("shareContent"); }

	/** @return {WalkThroughFeature} */
	get walkThrough() { return this.getFeature("walkThrough"); }

	/** @override */
	getFeature() { }

}

export const FeaturesList = [
	[() => import("./ToolBar/tool-bar.js"), "toolBar"],
	[() => import("./Settings/settings.js"), "settings"],
	[() => import("./VideoCall/video-call.js"), "videoCall"],
	[() => import("./Cursors/cursors.js"), "cursors"],
	[() => import("./EyeGaze/eye-gaze.js"), "eyeGaze"],
	[() => import("./Text2Speech/text2speech.js"), "text2speech"],
	[() => import("./Keyboard/keyboard.js"), "keyboard"],
	[() => import("./Notifications/notifications.js"), "notifications"],
	[() => import("./AccessControl/access-control.js"), "accessControl"],
	[() => import("./AAC/grid.js"), "aacGrid"],
	[() => import("./Apps/apps.js"), "apps"],
	[() => import("./Chat/chat.js"), "chat"],
	[() => import("./Quiz/quiz.js"), "quiz"],
	[() => import("./ShareContent/share-content.js"), "shareContent"],
	[() => import("./WalkThrough/walk-through.js"), "walkThrough"]
];