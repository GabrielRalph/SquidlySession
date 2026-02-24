import { GridIcon, GridLayout } from "../../Utilities/Buttons/grid-icon.js";
import { OccupiableWindow } from "../features-interface.js";
import { relURL } from "../../Utilities/usefull-funcs.js";
import { MaskOverlay } from "./mask-overlay.js";
import { set, ref } from "../../Firebase/firebase.js";


/* ================= PROFILE ================= */

class ProfileCard extends HTMLElement {
    constructor(profile) {
        super();
        this.profile = profile;
        this.setupDOM();
    }

    setupDOM() {
        this.style.cssText = `display: contents;`;

        const button = document.createElement("access-button");
        button.style.cssText = `
            width: calc(100% - 2 * var(--b1));
            height: 240px;
            border-radius: 16px;
            background: linear-gradient(180deg, #9b59b6 0%, #8e44ad 100%);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 18px;
            cursor: pointer;
            transition: all 0.25s ease;
            border: none;
            padding: 0;
            font-size: inherit;
            color: white;
            pointer-events: all;
        `;

        button.addEventListener('access-click', (e) => {
            e.stopPropagation();
            this.dispatchEvent(new CustomEvent('profile-selected', {
                bubbles: true,
                detail: { profile: this.profile }
            }));
        });

        const iconDiv = document.createElement("div");
        iconDiv.innerHTML = `<img src="data:image/svg+xml,<svg id='Layer_1' xmlns='http://www.w3.org/2000/svg' version='1.1' viewBox='0 0 256 256'><path d='M24.77,256c0-69.4,46.22-125.66,103.23-125.66s103.23,56.26,103.23,125.66'/><ellipse cx='128' cy='62.64' rx='46.42' ry='45.2'/></svg>" style="width:90px;height:90px;filter:invert(1);"/>`;
        iconDiv.style.cssText = `width: 90px; height: 90px;`;
        button.appendChild(iconDiv);

        const name = document.createElement("div");
        name.textContent = this.profile.name;
        name.style.cssText = `color: white; font-size: 28px; font-weight: 600;`;
        button.appendChild(name);

        this.appendChild(button);
        this._button = button;
    }

    setSelected(selected) {
        this._button.style.border = selected ? "4px solid white" : "";
    }
}

customElements.define('profile-card', ProfileCard);

/* ================= ACCESS METHOD ================= */

class AccessMethodCard extends HTMLElement {
    constructor(method) {
        super();
        this.method = method;
        this.setupDOM();
    }

    setupDOM() {
        this.style.cssText = `display: contents;`;

        const button = document.createElement("access-button");
        button.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 20px;
            cursor: pointer;
            transition: transform 0.2s ease;
            background: none;
            border: none;
            padding: 0;
            pointer-events: all;
        `;

        button.addEventListener('mouseenter', () => { button.style.transform = 'scale(1.05)'; });
        button.addEventListener('mouseleave', () => { button.style.transform = 'scale(1)'; });

        button.addEventListener('access-click', (e) => {
            e.stopPropagation();
            this.dispatchEvent(new CustomEvent('method-selected', {
                bubbles: true,
                detail: { method: this.method }
            }));
        });

        const iconBox = document.createElement("div");
        iconBox.innerHTML = this.method.iconSVG;
        iconBox.style.cssText = `
            width: 340px;
            height: 340px;
            background: ${this.method.color};
            border-radius: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 8px 24px rgba(0,0,0,0.3);
            transition: all 0.2s ease;
        `;

        const svgOrImg = iconBox.querySelector('svg, img');
        if (svgOrImg) svgOrImg.style.cssText = 'width: 160px; height: 160px;';

        button.appendChild(iconBox);

        const label = document.createElement("div");
        label.textContent = this.method.name;
        label.style.cssText = `font-size: 32px; font-weight: 600; color: white; margin-top: 10px;`;
        button.appendChild(label);

        this.appendChild(button);
        this._button = button;
        this._iconBox = iconBox;
    }

    setSelected(selected) {
        if (selected) {
            this._iconBox.style.border = '6px solid white';
            this._iconBox.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3), 0 0 0 8px rgba(255,255,255,0.3)';
        } else {
            this._iconBox.style.border = '';
            this._iconBox.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)';
        }
    }
}

customElements.define('access-method-card', AccessMethodCard);


class ProfileSelectionPage {
    constructor(feature, onClose) {
        this.feature = feature;
        this.onClose = onClose;
        this._profiles = [];
        this._selectedCard = null;
        this._newName = "";
        this._isUpdatingFromRemote = false;
        this._profileCards = new Map();
        this.setupDOM();
    }

    getArea(...args) {
        return this.feature.controller.getArea(...args);
    }

    setupDOM() {
        this._root = document.createElement("div");
        this._root.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 76.5%;
            height: 100%;
            z-index: 999999;
            pointer-events: none;
            display: flex;
            flex-direction: column;
            justify-content: center;
            overflow-y: auto;
            padding: 60px 80px;
            box-sizing: border-box;
            color: white;
        `;

        this.exitBtn = document.createElement("access-button");
        this.exitBtn.style.cssText = `
            position: fixed;
            top: 40px;
            left: calc(76.5% - 120px);
            width: 100px;
            height: 100px;
            background: rgba(255, 255, 255, 0.2);
            border: 2px solid white;
            border-radius: 50%;
            color: white;
            font-size: 32px;
            font-weight: bold;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
            padding: 0;
            z-index: 1000003;
            pointer-events: all;
        `;
        this.exitBtn.textContent = "×";
        this.exitBtn.addEventListener('mouseenter', () => {
            this.exitBtn.style.background = 'rgba(255, 255, 255, 0.3)';
            this.exitBtn.style.transform = 'scale(1.1)';
        });
        this.exitBtn.addEventListener('mouseleave', () => {
            this.exitBtn.style.background = 'rgba(255, 255, 255, 0.2)';
            this.exitBtn.style.transform = 'scale(1)';
        });
        this.exitBtn.addEventListener('access-click', (e) => {
            e.stopPropagation();
            if (this.onClose) this.onClose();
        });

        document.body.appendChild(this.exitBtn);


        const h1 = document.createElement("h1");
        h1.textContent = "Welcome!";
        h1.style.cssText = `
            font-size: 56px;
            font-weight: 700;
            margin: 0 0 20px 0;
            color: white;
            text-align: center;
        `;
        this._root.appendChild(h1);


        const subtitle = document.createElement("p");
        subtitle.textContent = "Follow this quick setup to customise each client's accessibility needs. You can choose an existing profile or create a new one.";
        subtitle.style.cssText = `
            width: 80%;
            margin: 0 auto 50px auto;
            font-size: 28px;
            color: rgba(255,255,255,0.85);
            text-align: center;
            line-height: 1.5;
        `;
        this._root.appendChild(subtitle);


        const h2 = document.createElement("h2");
        h2.textContent = "Existing Profiles";
        h2.style.cssText = `
            font-size: 40px;
            font-weight: 700;
            margin: 0 0 30px 0;
            color: white;
        `;
        this._root.appendChild(h2);


        this.grid = document.createElement("div");
        this.grid.style.cssText = `
            display: flex;
            flex-direction: row;
            gap: 40px;
            margin: 0 0 50px 0;
            pointer-events: all;
            overflow-x: auto;
            overflow-y: hidden;
            padding-bottom: 16px;
            scrollbar-width: thin;
            scrollbar-color: rgba(255,255,255,0.4) transparent;
        `;
        this._root.appendChild(this.grid);


        const newprofile = document.createElement("h2");
        newprofile.textContent = "Create New Profile";
        newprofile.style.cssText = `
            font-size: 40px;
            font-weight: 700;
            margin: 0 0 20px 0;
            color: white;
        `;
        this._root.appendChild(newprofile);


        this.input = document.createElement("input");
        this.input.placeholder = "Enter name";
        this.input.style.cssText = `
            width: 100%;
            padding: 18px;
            font-size: 24px;
            border-radius: 8px;
            border: none;
            margin-bottom: 30px;
            box-sizing: border-box;
            pointer-events: all;
        `;
        this._root.appendChild(this.input);


        this.btn = document.createElement("access-button");
        this.btn.textContent = "Continue";
        this.btn.disabled = true;
        this.btn.style.cssText = `
            display: block;
            margin: 0 auto;
            padding: 25px 40px;
            font-size: 40px;
            background: #9b59b6;
            color: white;
            border: none;
            border-radius: 12px;
            opacity: .5;
            cursor: pointer;
            width: 180px;
            text-align: center;
            pointer-events: all;
        `;
        this._root.appendChild(this.btn);

        this.input.addEventListener("input", (e) => {
            if (this._isUpdatingFromRemote) return;
            this._newName = e.target.value;
            if (this._selectedCard) this._selectedCard.setSelected(false);
            this._selectedCard = null;
            this._updateBtn();
            this.feature.sdata.set("setupState", {
                screen: "profileSelection",
                selectedProfile: null,
                newName: this._newName
            });
        });

        this.btn.addEventListener("access-click", async () => {
            if (this.btn.disabled) return;
            const profileName = this._selectedCard
                ? this._selectedCard.profile.name
                : this._newName.trim();

            if (!this._selectedCard && profileName) {
                try {
                    const Settings = await import("/src/Features/Settings/settings-wrapper.js");

                   
                    

                    const hostUID = this.feature._session?.hostUID
                        || this.feature.session?.hostUID
                        || this.feature.hostUID;

                    if (hostUID) {
                        const newID = await Settings.createProfile(hostUID, profileName);
                        console.log("Created new profile:", profileName, "with ID:", newID);
                    } else {
                        console.error("Could not find hostUID to create profile");
                    }
                } catch (err) {
                    console.error("Failed to create profile:", err);
                }
            }

            this.feature.sdata.set("setupState", {
                screen: "accessMethodSelection",
                profileName: profileName
            });
        });
    }


    destroy() {
        if (this.exitBtn && this.exitBtn.parentNode) {
            this.exitBtn.remove();
        }
    }

    _updateBtn() {
        const enabled = this._selectedCard || this._newName.trim();
        this.btn.disabled = !enabled;
        this.btn.style.opacity = enabled ? "1" : ".5";
    }

    renderProfiles(profileList) {
        this.grid.innerHTML = "";
        this._profileCards.clear();

       
        const cardWidth = `calc((100% - 80px) / 3)`;

        profileList.forEach(p => {
            const card = new ProfileCard(p);
           
            card.style.cssText = `
                flex: 0 0 ${cardWidth};
                min-width: ${cardWidth};
                display: block;
            `;
            this.grid.appendChild(card);
            this._profileCards.set(p.name, card);

            card.addEventListener("profile-selected", () => {
                if (this._isUpdatingFromRemote) return;
                if (this._selectedCard) this._selectedCard.setSelected(false);
                this._selectedCard = card;
                card.setSelected(true);
                this._newName = "";
                this.input.value = "";
                this._updateBtn();
                this.feature.sdata.set("setupState", {
                    screen: "profileSelection",
                    selectedProfile: p.name,
                    newName: ""
                });
            });
        });
    }

    syncFromState(state) {
        this._isUpdatingFromRemote = true;
        if (state.selectedProfile) {
            if (this._selectedCard) this._selectedCard.setSelected(false);
            this._selectedCard = this._profileCards.get(state.selectedProfile);
            if (this._selectedCard) this._selectedCard.setSelected(true);
            this.input.value = "";
            this._newName = "";
        } else if (state.newName !== undefined) {
            if (this._selectedCard) this._selectedCard.setSelected(false);
            this._selectedCard = null;
            this.input.value = state.newName;
            this._newName = state.newName;
        }
        this._updateBtn();
        this._isUpdatingFromRemote = false;
    }
}


class AccessMethodPage {
    constructor(feature, profileName, onClose) {
        this.feature = feature;
        this.profileName = profileName;
        this.onClose = onClose;
        this._selectedMethod = null;
        this._isUpdatingFromRemote = false;
        this._methodCards = new Map();
        this.setupDOM();
    }

    getArea(...args) {
        return this.feature.controller.getArea(...args);
    }

    setupDOM() {
        this._root = document.createElement("div");
        this._root.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 76.5%;
            height: 100%;
            z-index: 999999;
            pointer-events: none;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 60px 80px;
            box-sizing: border-box;
            color: white;
        `;

      
        this.exitBtn = document.createElement("access-button");
        this.exitBtn.style.cssText = `
            position: fixed;
            top: 40px;
            left: calc(76.5% - 120px);
            width: 100px;
            height: 100px;
            background: rgba(255, 255, 255, 0.2);
            border: 2px solid white;
            border-radius: 50%;
            color: white;
            font-size: 32px;
            font-weight: bold;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
            padding: 0;
            z-index: 1000003;
            pointer-events: all;
        `;
        this.exitBtn.textContent = "×";
        this.exitBtn.addEventListener('mouseenter', () => {
            this.exitBtn.style.background = 'rgba(255, 255, 255, 0.3)';
            this.exitBtn.style.transform = 'scale(1.1)';
        });
        this.exitBtn.addEventListener('mouseleave', () => {
            this.exitBtn.style.background = 'rgba(255, 255, 255, 0.2)';
            this.exitBtn.style.transform = 'scale(1)';
        });
        this.exitBtn.addEventListener('access-click', (e) => {
            e.stopPropagation();
            if (this.onClose) this.onClose();
        });

        document.body.appendChild(this.exitBtn);


        const title = document.createElement("h1");
        title.textContent = "Choose Your Access Method";
        title.style.cssText = `
            font-size: 56px;
            font-weight: 700;
            margin-bottom: 80px;
            color: white;
            text-align: center;
        `;
        this._root.appendChild(title);


        this.methodsContainer = document.createElement("div");
        this.methodsContainer.style.cssText = `
            display: flex;
            justify-content: center;
            gap: 60px;
            margin-bottom: 80px;
            pointer-events: all;
        `;
        this._root.appendChild(this.methodsContainer);


        this.continueBtn = document.createElement("access-button");
        this.continueBtn.textContent = "Continue";
        this.continueBtn.disabled = true;
        this.continueBtn.style.cssText = `
            display: block;
            margin: 0 auto;
            padding: 20px 120px;
            font-size: 32px;
            font-weight: 600;
            background: white;
            color: black;
            border: none;
            border-radius: 12px;
            cursor: not-allowed;
            transition: opacity 0.2s ease;
            opacity: 0.5;
            width: 180px;
            pointer-events: all;
            text-align: center;
        `;
        this._root.appendChild(this.continueBtn);

        this.continueBtn.addEventListener('mouseenter', () => {
            if (!this.continueBtn.disabled) this.continueBtn.style.opacity = '0.9';
        });
        this.continueBtn.addEventListener('mouseleave', () => {
            if (!this.continueBtn.disabled) this.continueBtn.style.opacity = '1';
        });
        this.continueBtn.addEventListener('access-click', async () => {
            if (this.continueBtn.disabled) return;

            const startStepMap = {
                'Eye Gaze': 'calibration-size',
                'Switch': 'switch-setup',
                'Cursor': 'cursor-setup-1'
            };
            const startStepId = startStepMap[this._selectedMethod];

            if (this._selectedMethod === 'Eye Gaze' || this._selectedMethod === 'Switch' || this._selectedMethod === 'Cursor') {
                try {
                    try {
                        this.feature.sdata.set("selectedProfile", {
                            name: this.profileName,
                            method: this._selectedMethod
                        });
                    } catch (permError) {
                        console.warn("Could not save profile to Firebase:", permError);
                    }
                    this.feature.sdata.set("setupState", {
                        screen: "startWalkthrough",
                        profileName: this.profileName,
                        selectedMethod: this._selectedMethod,
                        startStepId: startStepId
                    });
                } catch (error) {
                    console.error("Error triggering walkthrough:", error);
                }
            } else {
                alert(`Profile: ${this.profileName}\nSelected: ${this._selectedMethod}\n\nWalkthrough coming soon!`);
            }
        });
    }


    destroy() {
        if (this.exitBtn && this.exitBtn.parentNode) {
            this.exitBtn.remove();
        }
    }

    renderMethods(methods) {
        this.methodsContainer.innerHTML = "";
        this._methodCards.clear();

        methods.forEach(method => {
            const card = new AccessMethodCard(method);
            this.methodsContainer.appendChild(card);
            this._methodCards.set(method.name, card);

            card.addEventListener('method-selected', () => {
                if (this._isUpdatingFromRemote) return;
                this._methodCards.forEach(c => c.setSelected(false));
                card.setSelected(true);
                this._selectedMethod = method.name;
                this.continueBtn.disabled = false;
                this.continueBtn.style.opacity = '1';
                this.continueBtn.style.cursor = 'pointer';
                this.feature.sdata.update("setupState", { selectedMethod: method.name });
            });
        });
    }

    syncFromState(state) {
        this._isUpdatingFromRemote = true;
        if (state.selectedMethod) {
            this._methodCards.forEach(card => card.setSelected(false));
            const card = this._methodCards.get(state.selectedMethod);
            if (card) {
                card.setSelected(true);
                this._selectedMethod = state.selectedMethod;
                this.continueBtn.disabled = false;
                this.continueBtn.style.opacity = '1';
                this.continueBtn.style.cursor = 'pointer';
            }
        }
        this._isUpdatingFromRemote = false;
    }
}



const SETUP_MASK_COLOR = 'rgba(0, 100, 180, 0.75)';

class SetUpWindow extends OccupiableWindow {
    constructor(feature) {
        super("setup-window");
        this.feature = feature;
        this._profilePage = null;
        this._accessPage = null;
        this._pageRoot = null;
        this._unwatchProfiles = null;
        this.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 999998;
        `;
    }

    getArea(...args) {
        return this.feature.controller.getArea(...args);
    }

    get _mask() {
        return this.feature.walkThroughOverlay.mask;
    }

    _setMaskColor() {
        this._mask?.classList.add('setup-mode');
    }

    _clearMaskColor() {
        this._mask?.classList.remove('setup-mode');
    }

    async open() {

        let profiles = [];
        try {
            const Settings = await import("/src/Features/Settings/settings-wrapper.js");
            profiles = Settings.getProfiles().map(p => ({ name: p.name, profileID: p.profileID }));
            if (profiles.length > 0) {
                this.feature.sdata.set("profiles", profiles);
            }
        } catch (error) {
            console.warn("Could not load profiles from Settings:", error);
        }

        const mask = this._mask;
        mask.start();
        mask.clearAreas();
        const area = this.getArea(3, 4, 0, 0, 0, 0);
        if (area) mask.addArea(area);

        await mask.show();
        this._setMaskColor(SETUP_MASK_COLOR);

        if (this._pageRoot) this._pageRoot.remove();
        this._pageRoot = document.createElement("div");
        this._pageRoot.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 999999;
            pointer-events: none;
        `;
        this.feature.walkThroughOverlay.appendChild(this._pageRoot);

        this.feature.sdata.set("setupState", {
            screen: "profileSelection",
            selectedProfile: null,
            newName: ""
        });


        await this.showProfileSelection();
    }
    async close() {
        await this.forceClose();
    }

    async showProfileSelection() {
        if (this._profilePage) this._profilePage.destroy();
        if (this._accessPage) this._accessPage.destroy();
        if (this._pageRoot) this._pageRoot.innerHTML = "";
        this._setMaskColor(SETUP_MASK_COLOR);


        let Settings;
        try {
            Settings = await import("/src/Features/Settings/settings-wrapper.js");
        } catch (error) {
            console.warn("Could not load settings-wrapper:", error);
        }

        this._profilePage = new ProfileSelectionPage(
            this.feature,
            async () => await this.forceClose(true)
        );
        this._pageRoot.appendChild(this._profilePage._root);

        if (Settings) {
          
            const hostUID = this.feature._session?.hostUID
                || this.feature.session?.hostUID
                || this.feature.hostUID;

            if (hostUID) {

                this._unwatchProfiles = Settings.watchProfiles(hostUID, () => {
                    const profiles = Settings.getProfiles().map(p => ({
                        name: p.name,
                        profileID: p.profileID
                    }));
                    if (profiles.length > 0) {
                        this.feature.sdata.set("profiles", profiles);
                    }
                    if (this._profilePage) {
                        this._profilePage.renderProfiles(profiles);
                    }
                });
            } else {
                console.warn("No hostUID found, falling back to Firebase profiles");
                await this._renderFallbackProfiles();
            }
        } else {
            await this._renderFallbackProfiles();
        }

        this.feature.sdata.onValue("setupState", (state) => {
            if (!state) return;

            if (state.screen === "accessMethodSelection") {
                this.showAccessMethodSelection(state.profileName);
                return;
            }

            if (state.screen === "startWalkthrough") {
                this.forceClose().then(async () => {
                    const session = this.feature._session || this.feature.session || this.feature;
                    const walkthroughFeature = session.getFeature("walkThrough");
                    if (walkthroughFeature) {
                        await walkthroughFeature.controller.start(state.startStepId || 'calibration-size');
                    } else {
                        console.error("Could not find walkthrough feature!");
                    }
                });
                return;
            }

            if (state.screen !== "profileSelection") return;
            if (this._profilePage) this._profilePage.syncFromState(state);
        });
    }

    async _renderFallbackProfiles() {
        let profiles = [];
        try {
            const firebaseProfiles = await new Promise((resolve) => {
                this.feature.sdata.onValue("profiles", (data) => resolve(data));
            });
            if (firebaseProfiles && Array.isArray(firebaseProfiles)) {
                profiles = firebaseProfiles;
            }
        } catch (e) {}

        if (profiles.length === 0) {
            profiles = [{ name: "Alex" }, { name: "Jordan" }, { name: "Sam" }];
            this.feature.sdata.set("profiles", profiles);
        }

        if (this._profilePage) this._profilePage.renderProfiles(profiles);
    }

    showAccessMethodSelection(profileName) {
        if (this._profilePage) this._profilePage.destroy();
        if (this._accessPage) this._accessPage.destroy();
        if (this._pageRoot) this._pageRoot.innerHTML = "";

        const mask = this._mask;
        mask.clearAreas();
        const area = this.getArea(3, 4, 0, 0, 0, 0);
        if (area) mask.addArea(area);
        this._setMaskColor(SETUP_MASK_COLOR);

        const methods = [
            { name: "Eye Gaze", color: "#F4E5A5", iconSVG: `<img src="${relURL("../../Utilities/Icons/IconLibrary/i_eye.svg", import.meta)}" style="width:160px;height:160px;"/>` },
            { name: "Switch", color: "#C41E3A", iconSVG: `<img src="${relURL("../../Utilities/Icons/IconLibrary/i_switch.svg", import.meta)}" style="width:160px;height:160px;"/>` },
            { name: "Cursor", color: "#87CEEB", icon: "➤", iconSVG: `<img src="${relURL("../../Utilities/Icons/IconLibrary/i_mouse.svg", import.meta)}" style="width:160px;height:160px;"/>` }
        ];

        this._accessPage = new AccessMethodPage(
            this.feature,
            profileName,
            async () => await this.forceClose(true)
        );

        this._pageRoot.appendChild(this._accessPage._root);
        this._accessPage.renderMethods(methods);

        this.feature.sdata.onValue("setupState", (state) => {
            if (!state) return;

            if (state.screen === "startWalkthrough") {
                this.forceClose().then(async () => {
                    const session = this.feature._session || this.feature.session || this.feature;
                    const walkthroughFeature = session.getFeature("walkThrough");
                    if (walkthroughFeature) {
                        await walkthroughFeature.controller.start(state.startStepId || 'calibration-size');
                    } else {
                        console.error("Could not find walkthrough feature!");
                    }
                });
                return;
            }

            if (state.screen !== "accessMethodSelection") return;
            if (this._accessPage) this._accessPage.syncFromState(state);
        });
    }

    async forceClose(openDefault = false) {
        if (this._unwatchProfiles) {
            this._unwatchProfiles();
            this._unwatchProfiles = null;
        }

        this._clearMaskColor();

        const mask = this._mask;
        mask.clearAreas();
        await mask.hide();
        mask.stop();

        if (this._profilePage) {
            this._profilePage.destroy();
            this._profilePage = null;
        }
        if (this._accessPage) {
            this._accessPage.destroy();
            this._accessPage = null;
        }

        if (this._pageRoot) {
            this._pageRoot.remove();
            this._pageRoot = null;
        }

        document.body.style.visibility = 'visible';
        document.body.style.pointerEvents = 'all';

        await new Promise(resolve => setTimeout(resolve, 100));

        this.dispatchEvent(new CustomEvent('close', { bubbles: true }));
        console.log("Setup window force closed");
        console.log("openDefault:", openDefault);
        console.log("feature sdata path:", this.feature.sdata?.getFirebaseName?.());

        if (openDefault) {
            const sid = window.sessionConnection?.sid;
            await set(ref(`session-data/${sid}/session-main/occupier`), "default");
        }
    }

    static get usedStyleSheets() {
        return [relURL("./Setup/setup.css", import.meta)];
    }
}

export { SetUpWindow };