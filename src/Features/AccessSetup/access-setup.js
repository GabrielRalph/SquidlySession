import { SvgPlus } from "../../SvgPlus/4.js";
import { AccessEvent } from "../../Utilities/Buttons/access-buttons.js";
import { GridIcon, GridLayout } from "../../Utilities/Buttons/grid-icon.js";
import { Slider } from "../../Utilities/rotater.js";
import { relURL } from "../../Utilities/usefull-funcs.js";
import { Features, SquidlyFeatureWindow } from "../features-interface.js";
import { ProfileSelector } from "./profile-selector.js";
import { WalkThroughOverlayElement } from "./walk-through-overlay.js";
import * as Yaml from "../../Utilities/yaml.js";
import { HideShowTransition } from "../../Utilities/hide-show.js";


class MethodChooseIcon extends GridIcon {
    constructor(item) {
        super(item);
        this.events = {"access-click": async (e) => {
            let e2 = new AccessEvent("method-select", e, {bubbles: true});
            e2.method = item.mode;
            this.dispatchEvent(e2);
        }};
    }
}

class AccessMethodChooser extends GridLayout {
    constructor(messageHTML) {
        super(4, 5);
        this.addGridIcon({
            type: "action", displayValue: "Back", symbol: "leftArrow",
            events: {
                "access-click": async (e) => {
                    this.dispatchEvent(new AccessEvent("back", e, {bubbles: true}));
                }
            }
        }, 0,0 )
        this.addItemInstances(MethodChooseIcon, [
            {
                type: "lightGold", mode: "eyegaze", displayValue: "Eye-Gaze", symbol: "eye",
            },
            {
                type: "darkRed", mode: "switch", displayValue: "Switch", symbol: "switch",
            },
            {
                type: "lightBlue", mode: "mouse", displayValue: "Mouse", symbol: "cursor",
            }
        ], 2, [1,3]);
        let message = this.add(new SvgPlus("div"), 1, [1,3])
        message.class = "info"
        message.innerHTML = messageHTML
    }
}

class AccessSetupStartingWindow extends SquidlyFeatureWindow {
    constructor() {
        super("access-setup-starting-window", new HideShowTransition("access-setup-starting-window"));
        this.slider = this.createChild(Slider, {
            events: {
                "profile-select": async (e) => {
                    const {profileID} = e;
                    this._selectedProfile = profileID;
                    e.waitFor(this.slider.setContent(this.methodChooser, -1))
                },
                "back": async (e) => {
                    this.profileSelector.clear();
                    e.waitFor(this.slider.setContent(this.profileSelector, 1))
                },
            }
        }, "horizontal");
        this.profileSelector = new ProfileSelector(`
            <h1>Welcome!</h1>
            <p>Follow this quick setup to customise each client's accessibility needs. You can choose an existing profile or create a new one.</p>
        `);
        this.methodChooser = new AccessMethodChooser(`<div class ="centered"><h1>Choose Your Access Method</h1></div>`);
        this.slider.setContent(this.profileSelector, null);
    }  
    
    open(){
        this.reset();
        this.root.show();
    }

    toggle(show) {
        if (show !== this.root.shown) {
            if (show) {
                this.open();
            } else {
                this.root.hide();
            }
        }
    }

    reset() {
        this.slider.setContent(this.profileSelector, null);
        this.profileSelector.clear();
    }

    static get fixToolBarWhenOpen() {
        return true;
    }

    static get usedStyleSheets() {
        return [
            ...ProfileSelector.usedStyleSheets,
        ]
    }
}

export default class AccessSetup extends Features {

    /**
     * @param {import("../features-interface.js").SquidlySession} session
     * @param {import("../features-interface.js").SessionDataFrame} sdata
     */
    constructor(session, sdata){
        super(session, sdata);
        
        this.startWindow = new AccessSetupStartingWindow();
        this.startWindow.root.events = {
            "profile-select": async (e) => {
                session.settings.chooseProfile(e.profileID);
            },
            "close": async (e) => {
                this.sdata.set("state", null);
            },
            "method-select": async (e) => {
                let {method} = e;
                this.sdata.set("state", {method, step: 0});
            }
        }
        
        const {profileSelector} = this.startWindow;
        profileSelector.getInputFromKeyboard = session.keyboard.getInput.bind(session.keyboard);
        profileSelector.makeUserProfile = session.settings.createProfile.bind(session.settings);
        this.profileSelector = profileSelector;

        this.setupOverlay = new WalkThroughOverlayElement();
        this.setupOverlay.addLoader = async (button, mode) => {
            let time = session.settings.get("participant/access/"+mode);
            await session.accessControl.addLoaderToButton(button, time);
        }

        this.setupOverlay.getSettingsPathHeight = () => session.settings.settingsPathClientHeight
        this.setupOverlay.root.events = {
            "modal-next": async (e) => {
                let step = this.currentStep + 1;
                if (step >= AccessSetup.STEPS[this.currentMethod].length) {
                    this.sdata.set("state", null);
                } else {
                    this.sdata.set("state", {method: this.currentMethod, step});
                }
            },
            "modal-previous": async (e) => {
                let step = this.currentStep - 1;
                this.sdata.set("state", {method: this.currentMethod, step});
            },
            "modal-close": async (e) => {
                this.sdata.set("state", null);
            },
        }
    }


    get currentMethod() {
        return this._currentMethod;
    }

    get currentStep() {
        return this._currentStep;
    }



    async initialise() {
        if (this.sdata.isHost) {
            this.session.toolBar.addMenuItem("access", {
                name: "access-setup",
                text: "access</br>setup",
                symbol: "access",
                onSelect: (e) => {
                    this.sdata.set("state", "start");
                }
            })
        }

        this.profileSelector.list.profiles = this.session.settings.profiles;
        this.session.settings.addEventListener("profiles-change", (e) => {
            this.profileSelector.list.profiles = this.session.settings.profiles;
        })

        this.sdata.onValue("state", (state) => {
            this._setState(state);
        });
    }

    async _openWindowForStep({window}) {
        if (this.session.currentOpenFeature !== window) {
            let prom = this.session.openWindow(window);
            this.setupOverlay.mask.renderMask();
            await prom;
            this.setupOverlay.mask.renderMask();
        }
    }

    async _setState(state) {4
        let shownStep = null;
        let isStart = false;

        if (typeof state === "object" && state !== null) {
            const {method, step} = state;
            if (method in AccessSetup.STEPS && typeof step === "number" && step >= 0 && step < AccessSetup.STEPS[method].length) {
                const steps = AccessSetup.STEPS[method];
                const s = steps[step];
                this.setupOverlay.setStep(s, step, steps.length);
                this._currentMethod = method;
                this._currentStep = step;
                shownStep = s;


                if (method === "switch") {
                    this.session.settings.setValue("participant/keyboardShortcuts/x", true);
                    this.session.settings.setValue("host/keyboardShortcuts/x", true);
                }
            }
        } else if (state === "start" && this.sdata.isHost) {
            isStart = true;
        }

        this.startWindow.toggle(isStart);

        if (shownStep === null) {
            //if no valid step to show, close everything and return to default window
            this.setupOverlay.root.hide();
        } else {
            if (shownStep.window === "eyeGaze") {
                this.session.eyeGaze.setFeebackShownUser("participant")
                this.session.settings.setValue("participant/eye-gaze-enabled", true);
                this.session.settings.setValue("host/eye-gaze-enabled", false);
                this.session.settings.setValue("host/keyboardShortcuts/e", true);
                this.session.settings.setValue("participant/keyboardShortcuts/e", true);
                this.session.eyeGaze.eyeGazeOn = true;
            }

            if (shownStep.window === "settings" && shownStep.settingsPath) {
                this.session.settings.gotoPath(shownStep.settingsPath);
            }

            this._openWindowForStep(shownStep);

            if (this.setupOverlay.root.shown === false) {
                this.setupOverlay.root.show();
            }
        }
    }

    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ STATIC ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */

    static async loadWalkThroughSteps() {
        let res = await fetch(relURL("./walkthrough.yaml", import.meta));
        let text = await res.text();
        this.STEPS = Yaml.load(text);
    }

    static async loadResources() {
        //load any resources required for this feature
        await Promise.all([
            WalkThroughOverlayElement.loadStyleSheets(),
            AccessSetupStartingWindow.loadStyleSheets(),
            this.loadWalkThroughSteps(),
        ]);
    }

    /* Must have name static getter 
       for feature to be recognised 
    */
    static get name() {
        return "accessSetup";
    }

    static get layers() {
        return {
            startWindow: {
                type: "area",
                area: "entireScreen",
                index: 260,
            },
            setupOverlay: {
                type: "area",
                area: "fullAspectArea",
                index: 110,
            }
        }
    }

    static get firebaseName() {
        return "walk-through";
    }
}