import { Vector } from "../../SvgPlus/vector.js";
import { GridIcon, GridLayout } from "../../Utilities/Buttons/grid-icon.js";
import { HideShowTransition } from "../../Utilities/hide-show.js";
import { Icon } from "../../Utilities/Icons/icons.js";
import { ShadowElement } from "../../Utilities/shadow-element.js";
import { delay, relURL } from "../../Utilities/usefull-funcs.js";
import { Features, SquidlyFeatureWindow } from "../features-interface.js";
import { MaskOverlay } from "./mask-overlay.js";
import { SetUpWindow } from "./setup-window.js";

/**
 * @typedef {Object} WalkthroughStep
 * @property {string} id - Unique identifier for the step
 * @property {string} title - Step title
 * @property {string} subtitle - Step indicator text
 * @property {string} content - HTML content for the step
 * @property {string} position - Modal position: 'left', 'right', 'center'
 * @property {function(number, number): {pos: Vector, size: Vector, border: number}} [area] - Area function
 * @property {string} [settingsPath] - Settings path to navigate to
 * @property {string} [window] - Window to open
 * @property {function} [onEnter] - Custom function to run when entering this step
 * @property {function} [onExit] - Custom function to run when exiting this step
 * @property {boolean} [canGoBack] - Whether back button is enabled
 * @property {boolean} [canGoNext] - Whether next button is enabled
 * @property {string} [nextStepId] - ID of next step (null for end)
 * @property {string} [prevStepId] - ID of previous step (null for start)
 */

/**
 * @typedef {Object} WalkthroughState
 * @property {string} currentStepId - Current step ID
 * @property {boolean} isActive - Whether walkthrough is active
 * @property {boolean} modalShown - Whether modal is shown
 * @property {boolean} maskShown - Whether mask is shown
 * @property {string} contentHash - Hash of current step content
 * @property {Object} buttonStates - Button enable/disable states
 * @property {Array} customModals - Array of custom modal configs
 */

/**
 * Helper that loops a switch loader on a single button only,
 * bypassing the _switching guard each iteration.
 */
async function loopSwitchOnButton(overlay, button, getActive) {
    while (getActive()) {
        overlay._switching = false;
        await overlay.addSwichLoader(button);
        if (!getActive()) break;
    }
}

class InstructionModal extends HideShowTransition {
    constructor() {
        super("instruction-modal");

        this.modal = this.createChild("div", { class: "modal-container" });

        this.closeButton = this.modal.createChild("access-button", {
            class: "modal-close-btn",
            events: {
                "access-click": (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    this.dispatchEvent(new CustomEvent('modal-close', { bubbles: true }));
                }
            }
        });

        this.closeButton.createChild(Icon, {}, "close");

        let info = this.modal.createChild("div", {
            class: "modal-info"
        });

        this.titleElement = info.createChild("h2", {
            class: "modal-title",
            content: "Step Title"
        });

        this.stepIndicator = info.createChild("div", {
            class: "step-indicator",
            content: "Step 1 of 3"
        });

        this.contentBox = info.createChild("div", {
            class: "content-box"
        });

        this.contentElement = this.contentBox.createChild("div", {
            class: "modal-content",
            content: "Content goes here"
        });

        this.navButtons = this.modal.createChild(GridLayout, {}, 1, 2);

        this.prevButton = this.navButtons.add(new GridIcon({
            type: "action",
            symbol: "back",
            displayValue: "Previous",
            events: {
                "access-click": (e) => {
                    e.stopPropagation();
                    this.dispatchEvent(new CustomEvent('modal-previous', { bubbles: true }));
                }
            }
        }), 0, 0);

        this.nextButton = this.navButtons.add(new GridIcon({
            type: "action",
            symbol: "next",
            displayValue: "Next",
            events: {
                "access-click": (e) => {
                    e.stopPropagation();
                    this.dispatchEvent(new CustomEvent('modal-next', { bubbles: true }));
                }
            }
        }), 0, 1);

        this.prevButton.style.pointerEvents = 'auto';
        this.nextButton.style.pointerEvents = 'auto';
        this.closeButton.style.pointerEvents = 'auto';
        this.modal.style.pointerEvents = 'auto';
    }

    updateContent(title, step, content) {
        this.titleElement.innerHTML = title || "Step Title";
        this.stepIndicator.innerHTML = step || "Step 1 of 1";
        this.contentElement.innerHTML = content || "";
    }

    setButtonStates(canGoBack, canGoNext) {
        this.prevButton.disabled = !canGoBack;
        this.nextButton.disabled = !canGoNext;
    }

    setPosition(position = 'center', areaInfo = null) {
        this.modal.style.left = '';
        this.modal.style.right = '';
        this.modal.style.top = '';
        this.modal.style.bottom = '';
        this.modal.style.transform = '';

        if (!areaInfo) return;

        const { pos, size } = areaInfo;

        switch (position) {
            case 'right':
                this.modal.style.left = 'calc(0.75 * var(--width) - var(--gap) * 0.25)';
                this.modal.style.top = '50%';
                this.modal.style.transform = 'translate(-50%, -50%)';
                break;

            case 'left':
                this.modal.style.left = 'calc(0.25 * var(--width) - var(--gap) * 0.25)';
                this.modal.style.top = '50%';
                this.modal.style.transform = 'translate(-50%, -50%)';
                break;

            case 'center':
                this.modal.style.left = 'calc(0.5 * var(--width))';
                this.modal.style.top = `50%`;
                this.modal.style.transform = `translate(-50%, -50%)`;
                break;
        }
    }

    applyCustomStyles(styles) {
        if (styles) {
            Object.entries(styles).forEach(([key, value]) => {
                this.modal.style.setProperty(key, value, 'important');
            });
        }
    }

    clearCustomStyles() {
        this.modal.style.removeProperty('left');
        this.modal.style.removeProperty('right');
        this.modal.style.removeProperty('top');
        this.modal.style.removeProperty('bottom');
        this.modal.style.removeProperty('width');
        this.modal.style.removeProperty('max-height');
        this.modal.style.removeProperty('min-height');
    }
}

class DwellTestModal extends HideShowTransition {
    constructor() {
        super("dwell-test-modal");

        this.modal = this.createChild("div", { class: "dwell-modal-container" });
        this.modal.style.cssText = `
            width: 330px;
            height: 700px;
            background: linear-gradient(135deg, rgb(0, 180, 216) 0%, rgb(0, 150, 199) 100%);
            border-radius: 12px;
            padding: 30px;
            color: white;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            font-family: system-ui, -apple-system, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            box-sizing: border-box;
        `;

        const heading = this.modal.createChild("h2");
        heading.textContent = "Test the speed";
        heading.style.cssText = 'font-size: 48px; font-weight: bold; margin: 0 0 20px 0; text-align: center;';

        this.testButton = new GridIcon({
            type: "action",
            symbol: "",
            displayValue: "",
            events: {
                "access-click": (e) => {
                    e.stopPropagation();
                    this.dispatchEvent(new CustomEvent('dwell-test-click', { bubbles: true }));
                }
            }
        });
        this.testButton.style.cssText = 'width: 100%; height: 500px; background: #dc143c; border-radius: 12px; margin: 0 auto 30px auto; display: block;';
        this.modal.appendChild(this.testButton);

        const caption = this.modal.createChild("p");
        caption.textContent = 'Focus on the white circle and follow the instructions';
        caption.style.cssText = 'font-size: 36px; opacity: 0.9; text-align: center; margin-top: 10px;';

        this.modal.style.pointerEvents = 'auto';
    }
}

class WalkThroughOverlayElement extends SquidlyFeatureWindow {
    constructor() {
        super("walk-through-overlay");

        this.mask = this.createChild(MaskOverlay, {
            class: "mask-overlay",
        });

        this.instructionModal = this.createChild(InstructionModal, {
            events: {
                'modal-next': (e) => this.dispatchEvent(new CustomEvent('walkthrough-next', { bubbles: true })),
                'modal-previous': (e) => this.dispatchEvent(new CustomEvent('walkthrough-previous', { bubbles: true })),
                'modal-close': (e) => this.dispatchEvent(new CustomEvent('walkthrough-close', { bubbles: true }))
            }
        });

        this.dwellTestModal = this.createChild(DwellTestModal, {
            styles: {
                position: 'fixed',
                left: '80px',
                top: '65px',
                zIndex: '999999',
            }
        });

        this.instructionModal.shown = false;
        this.dwellTestModal.shown = false;
        this.mask.shown = false;
    }

    static get usedStyleSheets() {
        return [
            relURL("./style.css", import.meta),
            GridIcon.styleSheet
        ]
    }
}

/**
 * Manages the walkthrough state and step transitions with full synchronization
 */
class WalkthroughController {
    constructor(session, overlay, sdata) {
        this.session = session;
        this.overlay = overlay;
        this.sdata = sdata;
        this.steps = new Map();
        this.currentStepId = null;
        this.isActive = false;
        this._customModals = [];
        this._isUpdatingFromRemote = false;
        this._fullScreenMask = null;
        this._stateUpdateInProgress = false;
        this._stateUpdateDebounce = null;
    }

    registerStep(step) {
        this.steps.set(step.id, step);
    }

    _generateContentHash(step) {
        if (!step) return null;
        const contentStr = JSON.stringify({
            title: step.title,
            subtitle: step.subtitle,
            content: step.content,
            position: step.position
        });
        return this._simpleHash(contentStr);
    }

    _simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(36);
    }

    _debounceStateUpdate(newState) {
        if (this._stateUpdateDebounce) {
            clearTimeout(this._stateUpdateDebounce);
        }

        this._stateUpdateDebounce = setTimeout(() => {
            if (!this._isUpdatingFromRemote) {
                console.log("Pushing state update to Firebase:", newState);
                this.sdata.set("state", newState);
            }
        }, 50);
    }

    _buildStateObject(stepId) {
        const step = this.steps.get(stepId);
        const contentHash = this._generateContentHash(step);

        const canGoBack = step && step.canGoBack !== false && step.prevStepId !== undefined;
        const canGoNext = step && step.canGoNext !== false && step.nextStepId !== undefined;

        return {
            currentStepId: stepId,
            isActive: this.isActive,
            modalShown: this.overlay.instructionModal.shown,
            maskShown: this.overlay.mask.shown,
            contentHash: contentHash,
            buttonStates: {
                canGoBack,
                canGoNext
            }
        };
    }

    getArea(rows = 3, cols = 4, rowStart = 0, colStart = 0, rowEnd = rowStart + 1, colEnd = colStart + 1) {
        return (W, H) => {
            const h1 = this.session.settings.settingsPathClientHeight;
            const border = 4;
            const gap = 1.25 * border;

            let iw = (W - (cols + 1) * gap) / cols;
            let ih = (H - h1 - (rows + 1) * gap) / rows;

            let y = h1 + rowStart * (ih + gap) + gap / 2;
            let x = colStart * (iw + gap) + gap / 2;

            let wr = (colEnd - colStart) * (iw + gap);
            let hr = (rowEnd - rowStart) * (ih + gap);

            let br = 0.015 * Math.min(window.innerWidth, window.innerHeight) + gap / 2;

            return {
                pos: new Vector(x, y),
                size: new Vector(wr, hr),
                border: br
            }
        }
    }

    async start(stepId) {
        console.log("start() called with stepId:", stepId, "isActive:", this.isActive);

        if (this.isActive) {
            console.warn("Walkthrough already active");
            return;
        }

        this.isActive = true;
        this.overlay.mask.start();

        const initialState = this._buildStateObject(stepId);
        this._debounceStateUpdate(initialState);

        await this.goToStep(stepId);
    }

    async goToStep(stepId) {
        console.log("=== goToStep called:", stepId);

        if (!stepId) {
            await this.end();
            return;
        }

        const step = this.steps.get(stepId);
        if (!step) {
            console.error(`Step ${stepId} not found`);
            return;
        }

        if (this.currentStepId !== stepId) {
            console.log("Cleaning up previous step modals");
            this._customModals.forEach(modal => {
                if (modal.element && modal.element.style.display !== 'none') {
                    modal.element.style.display = 'none';
                }
            });
            this._customModals = [];
            if (this._fullScreenMask) {
                this._fullScreenMask.remove();
                this._fullScreenMask = null;
            }
        }

        this.currentStepId = stepId;

        const newState = this._buildStateObject(stepId);
        this._debounceStateUpdate(newState);

        if (step.settingsPath) {
            console.log(">>> Navigating to settings path:", step.settingsPath);
            await this.session.settings.gotoPath(step.settingsPath);
        } else {
            console.log(">>> No settingsPath for step:", stepId);
        }

        if (step.window) {
            console.log(">>> Opening window:", step.window);
            await this.session.openWindow(step.window);
        } else {
            console.log(">>> No window for step:", stepId);
        }

        if (step.onEnter) {
            console.log(">>> Running onEnter for step:", stepId);
            await step.onEnter(this);
        }

        if (!this.overlay.mask.started) {
            console.log("Starting mask");
            this.overlay.mask.start();
        }

        this.overlay.mask.clearAreas();
        if (step.area) {
            console.log("Adding mask area");
            this.overlay.mask.addArea(step.area);
            if (step.area2) {
                this.overlay.mask.addArea(step.area2);
            }
            if (!this.overlay.mask.shown) {
                console.log("Showing mask");
                await this.overlay.mask.show();
            }
        } else {
            console.log("No area for this step, hiding mask");
            if (this.overlay.mask.shown) {
                await this.overlay.mask.hide();
            }
        }

        this.overlay.instructionModal.clearCustomStyles();
        this.overlay.instructionModal.updateContent(
            step.title,
            step.subtitle,
            step.content
        );

        const canGoBack = step.canGoBack !== false && step.prevStepId !== undefined;
        const canGoNext = step.canGoNext !== false && step.nextStepId !== undefined;
        this.overlay.instructionModal.setButtonStates(canGoBack, canGoNext);

        let areaInfo = null;
        if (step.area) {
            areaInfo = step.area(window.innerWidth, window.innerHeight);
        }
        this.overlay.instructionModal.setPosition(step.position || 'center', areaInfo);

        if (step.modalStyles) {
            this.overlay.instructionModal.applyCustomStyles(step.modalStyles);
        }

        if (step.title || step.content) {
            console.log("Showing instruction modal");
            if (!this.overlay.instructionModal.shown) {
                await this.overlay.instructionModal.show();
            }
        } else {
            if (this.overlay.instructionModal.shown) {
                await this.overlay.instructionModal.hide();
            }
        }

        const finalState = this._buildStateObject(stepId);
        finalState.modalShown = this.overlay.instructionModal.shown;
        finalState.maskShown = this.overlay.mask.shown;
        this._debounceStateUpdate(finalState);

        console.log("=== Step", stepId, "complete ===\n");
    }

    async next() {
        const currentStep = this.steps.get(this.currentStepId);
        if (!currentStep) return;
        if (currentStep.onExit) {
            await currentStep.onExit(this);
        }
        await this.goToStep(currentStep.nextStepId);
    }

    async previous() {
        
        const currentStep = this.steps.get(this.currentStepId);
        if (!currentStep) return;
        if (currentStep.onExit) {
            await currentStep.onExit(this);
        }

        const prevStepId = currentStep.prevStepId;
        console.log(">>> Previous step ID:", prevStepId);

        if (prevStepId) {
            const prevStep = this.steps.get(prevStepId);

            if (prevStepId.includes('eye-gaze-setup')) {
                console.log(">>> Going back to eye-gaze step - onEnter will open eyeGaze window");
            } else if (prevStep && prevStep.settingsPath) {
                console.log(">>> Pre-navigating to previous step's settings path:", prevStep.settingsPath);
                await this.session.settings.gotoPath(prevStep.settingsPath);
            }

            if (prevStep && prevStep.window) {
                console.log(">>> Pre-opening previous step's window:", prevStep.window);
                await this.session.openWindow(prevStep.window);
            }
        }

        await this.goToStep(prevStepId);
    }

    async end() {
        console.log("end() called");

        this.isActive = false;
        this.currentStepId = null;

        this._debounceStateUpdate(null);

        if (this._dwellModalCloseListener) {
            this.overlay.removeEventListener('walkthrough-close', this._dwellModalCloseListener);
            this._dwellModalCloseListener = null;
        }

        if (this.overlay.dwellTestModal.shown) {
            await this.overlay.dwellTestModal.hide();
        }

        this._customModals.forEach(modal => {
            if (modal && modal.style) {
                modal.remove();
            } else if (modal && modal.element) {
                modal.element.remove();
            }
        });
        this._customModals = [];

        if (this._fullScreenMask) {
            this._fullScreenMask.remove();
            this._fullScreenMask = null;
        }

        await this.overlay.mask.hide();
        await this.overlay.instructionModal.hide();
        this.overlay.mask.stop();

        await this.overlay.mask.hide();
        await this.overlay.instructionModal.hide();
        this.overlay.mask.stop();

        if (!this._isUpdatingFromRemote) {
            const sid = window.sessionConnection?.sid;
            const { set, ref } = await import("../../Firebase/firebase.js");
            await set(ref(`session-data/${sid}/session-main/occupier`), "default");
        }
    }

    createCustomModal(htmlContent, styles = {}) {
        const modal = document.createElement('div');
        Object.assign(modal.style, {
            position: 'fixed',
            display: 'none',
            zIndex: '999999',
            ...styles
        });
        modal.innerHTML = htmlContent;
        document.body.appendChild(modal);

        this._customModals.push(modal);

        return {
            show: async () => { modal.style.display = 'block'; },
            hide: async () => { modal.style.display = 'none'; },
            element: modal
        };
    }

    async setState(state) {
        console.log("setState called with:", state, "isActive:", this.isActive);

        if (state == null) {
            if (this.isActive) {
                this._isUpdatingFromRemote = true;
                await this.end();
                this._isUpdatingFromRemote = false;
            }
            return;
        }

        const { currentStepId, isActive } = state;

        if (isActive && !this.isActive) {
            console.log("Starting walkthrough from remote");
            this._isUpdatingFromRemote = true;
            this.isActive = true;
            await this.goToStep(currentStepId);
            this._isUpdatingFromRemote = false;
        } else if (isActive && this.isActive && currentStepId !== this.currentStepId) {
            console.log("Changing step from remote:", this.currentStepId, "->", currentStepId);
            this._isUpdatingFromRemote = true;

            const currentStep = this.steps.get(this.currentStepId);
            if (currentStep && currentStep.onExit) {
                await currentStep.onExit(this);
            }

            await this.goToStep(currentStepId);
            this._isUpdatingFromRemote = false;
        } else if (!isActive && this.isActive) {
            console.log("Ending walkthrough from remote");
            this._isUpdatingFromRemote = true;
            await this.end();
            this._isUpdatingFromRemote = false;
        }
    }
}

export default class WalkThroughFeature extends Features {
    constructor(session, sdata) {
        super(session, sdata);
        this.walkThroughOverlay = new WalkThroughOverlayElement();
        this.controller = new WalkthroughController(session, this.walkThroughOverlay, sdata);
        this.setUpWindow = new SetUpWindow(this);

        this.walkThroughOverlay.addEventListener('walkthrough-next', () => this.controller.next());
        this.walkThroughOverlay.addEventListener('walkthrough-previous', () => this.controller.previous());
        this.walkThroughOverlay.addEventListener('walkthrough-close', () => this.controller.end());

        this.initializeCalibrationWalkthrough();
        this.initializeSwitchWalkthrough();
        this.initializeCursorWalkthrough();

        this.initialising = new Promise((resolve) => {
            sdata.onValue("state", (state) => {
                console.log("Walkthrough state update:", state);
                this.state = state;
                resolve();
            });
        });
    }

    set state(state) {
        this.controller.setState(state);
    }

    get state() {
        return {
            currentStepId: this.controller.currentStepId,
            isActive: this.controller.isActive
        };
    }

    initializeCalibrationWalkthrough() {
        console.log("Initialising calibration walkthrough")
        const ctrl = this.controller;

        ctrl.registerStep({
            id: 'calibration-size',
            title: 'Choose your calibration size',
            subtitle: 'Step 1 of 3',
            content: `
                <h4>Recommendations:</h4>
                <p>👶 Children → 5</p>
                <p>♿ Impairments → 7</p>
                <p>🏥 Clinicians → 3/4</p>
            `,
            position: 'right',
            area: ctrl.getArea(3, 4, 0, 1, 3, 2),
            settingsPath: 'home/participant/calibration',
            window: 'settings',
            nextStepId: 'calibration-speed',
            prevStepId: null
        });

        ctrl.registerStep({
            id: 'calibration-speed',
            title: 'Choose your calibration speed',
            subtitle: 'Step 2 of 3',
            content: `
                <h4>Recommendations:</h4>
                <p>👶 Children → Medium</p>
                <p>♿ Impairments → Slow</p>
                <p>🏥 Clinicians → Fast</p>
            `,
            position: 'left',
            area: ctrl.getArea(3, 4, 0, 2, 3, 3),
            settingsPath: 'home/participant/calibration',
            window: 'settings',
            nextStepId: 'calibration-guide',
            prevStepId: 'calibration-size'
        });

        ctrl.registerStep({
            id: 'calibration-guide',
            title: 'Choose your calibration guide',
            subtitle: 'Step 3 of 3',
            content: `
                <h4>Recommendations:</h4>
                <p>👶 Children → Balloon</p>
                <p>♿ Impairments → Squidly</p>
                <p>🏥 Clinicians → Default</p>
            `,
            position: 'center',
            area: ctrl.getArea(3, 4, 0, 3, 3, 4),
            settingsPath: 'home/participant/calibration',
            window: 'settings',
            nextStepId: 'eye-gaze-setup-1',
            prevStepId: 'calibration-speed',
            onExit: async (controller) => {
                await controller.overlay.mask.hide();
                await controller.overlay.instructionModal.hide();
                controller.overlay.mask.stop();
            }
        });

        ctrl.registerStep({
            id: 'eye-gaze-setup-1',
            title: 'Calibration <br> Setup',
            subtitle: 'Step 1 of 4',
            content: `
                <p>If Squidly can see your eyes, Squidly can follow where you look. Try to fill up the green bar as much as possible.</p>
            `,
            position: 'left',
            area: ctrl.getArea(3, 4, 0, 2, 3, 4),
            area2: ctrl.getArea(3, 4, 2, 3, 3, 4),
            nextStepId: 'eye-gaze-setup-2',
            prevStepId: 'calibration-guide',
            modalStyles: {
                'left': '20px',
                'width': '45%',
                'top': '50%',
                'max-height': '85vh',
                'transform': 'translateY(-50%)',
                'right': 'auto',
                'min-height': '300px'
            },
            onEnter: async (controller) => {
                console.log(">>> onEnter eye-gaze-setup-1: Opening eyeGaze window");
                controller.session.settings.setValue("host/eye-gaze-enabled", false);
                controller.session.settings.setValue("participant/eye-gaze-enabled", true);
                await controller.session.openWindow("eyeGaze");
                const participantWidget = document.querySelector('feedback-widget');
                if (participantWidget) {
                    participantWidget.classList.remove('static', 'relative', 'absolute');
                    participantWidget.style.setProperty('position', 'relative', 'important');
                    participantWidget.style.setProperty('left', '300px', 'important');
                    participantWidget.style.setProperty('width', '45%', 'important');
                    participantWidget.style.setProperty('top', '50%', 'important');
                    participantWidget.style.setProperty('transform', 'translateY(-50%)', 'important');
                    participantWidget.style.setProperty('z-index', '1000', 'important');
                }

                if (controller.overlay.instructionModal.prevButton) {
                    controller.overlay.instructionModal.prevButton.style.setProperty('height', '250px', 'important');
                }
                if (controller.overlay.instructionModal.nextButton) {
                    controller.overlay.instructionModal.nextButton.style.setProperty('height', '250px', 'important');
                }
            },
            onExit: async (controller) => {
                if (controller.overlay.instructionModal.prevButton) {
                    controller.overlay.instructionModal.prevButton.style.removeProperty('height');
                }
                if (controller.overlay.instructionModal.nextButton) {
                    controller.overlay.instructionModal.nextButton.style.removeProperty('height');
                }
            }
        });

        ctrl.registerStep({
            id: 'eye-gaze-setup-2',
            title: 'Calibration<br> Setup',
            subtitle: 'Step 2 of 4',
            content: `
                <p>Make yourself comfortable. Squidly works best when you calibrate in the same position you'll use afterward.</p>
            `,
            position: 'left',
            area: ctrl.getArea(3, 4, 0, 2, 3, 4),
            area2: ctrl.getArea(3, 4, 2, 3, 3, 4),
            nextStepId: 'eye-gaze-setup-3',
            prevStepId: 'eye-gaze-setup-1',
            modalStyles: {
                'left': '20px',
                'width': '45%',
                'top': '50%',
                'max-height': '85vh',
                'transform': 'translateY(-50%)',
                'right': 'auto',
                'min-height': '300px'
            },
            onEnter: async (controller) => {
                console.log(">>> onEnter eye-gaze-setup-2: Opening eyeGaze window");
                await controller.session.openWindow("eyeGaze");
            },
            onExit: async (controller) => {
                console.log("Exiting eye-gaze-setup-2");
            }
        });

        ctrl.registerStep({
            id: 'eye-gaze-setup-3',
            title: 'Calibration <br> Setup',
            subtitle: 'Step 3 of 4',
            content: `
                <p>Click Calibrate to start. Squidly's ready to track your eyes!</p>
            `,
            position: 'left',
            area: ctrl.getArea(3, 4, 0, 2, 3, 4),
            area2: ctrl.getArea(3, 4, 2, 3, 3, 4),
            nextStepId: 'eye-gaze-setup-4',
            prevStepId: 'eye-gaze-setup-2',
            modalStyles: {
                'left': '20px',
                'width': '45%',
                'top': '50%',
                'max-height': '85vh',
                'transform': 'translateY(-50%)',
                'right': 'auto',
                'min-height': '300px'
            },
            onEnter: async (controller) => {
                console.log(">>> onEnter eye-gaze-setup-3: Opening eyeGaze window");
                await controller.session.openWindow("eyeGaze");
            },
            onExit: async (controller) => {
                console.log("Exiting eye-gaze-setup-3");
            }
        });

        ctrl.registerStep({
            id: 'eye-gaze-setup-4',
            title: 'Calibration<br> Setup',
            subtitle: 'Step 4 of 4',
            content: `
                <p>Score below 75? Click Calibrate to try again.</p>
                <p>Score 75+? You're ready! Click Test Squidly.</p>
            `,
            position: 'left',
            area: ctrl.getArea(3, 4, 0, 2, 3, 4),
            nextStepId: 'dwell-time-setup',
            prevStepId: 'eye-gaze-setup-3',
            modalStyles: {
                'left': '20px',
                'width': '45%',
                'top': '50%',
                'max-height': '85vh',
                'transform': 'translateY(-50%)',
                'right': 'auto',
                'min-height': '300px'
            },
            onEnter: async (controller) => {
                console.log(">>> onEnter eye-gaze-setup-4: Opening eyeGaze window");
                await controller.session.openWindow("eyeGaze");
            },
            onExit: async (controller) => {
                console.log("Exiting eye-gaze-setup-4");
                await controller.overlay.instructionModal.hide();
            }
        });

        ctrl.registerStep({
            id: 'dwell-time-setup',
            title: 'Choose your <br> dwell times',
            subtitle: 'Step 1 of 2',
            content: `
                <h4>Recommendations:</h4>
                <p>👶 Children → 2s–3s</p>
                <p>🏥 Clinicians → 2s-4s</p>
                <p>♿ Impairments → 1s-1.5s</p>
            `,
            position: 'left',
            area: ctrl.getArea(3, 4, 0, 2, 3, 3),
            nextStepId: 'keyboard-setup-1',
            prevStepId: 'eye-gaze-setup-4',
            settingsPath: 'home/participant/access',
            window: 'settings',
            modalStyles: {
                'max-height': '85vh'
            }
        });

        ctrl.registerStep({
            id: 'keyboard-setup-1',
            title: 'Keyboard <br> Shortcuts',
            subtitle: 'Step 1 of 3',
            content: `
                <p><b>s</b> — Open Settings</p>
                <p><b>g</b> — Open AAC Grid</p>
                <p><b>x</b> — Start Switch Access</p>
                <p>You can use these shortcuts anytime.</p>
            `,
            position: 'right',
            area: ctrl.getArea(3, 4, 0, 1, 3, 2),
            nextStepId: 'keyboard-setup-2',
            prevStepId: 'dwell-time-setup',
            settingsPath: 'home/participant/keyboardShortcuts',
            onEnter: async (controller) => {
            },
            onExit: async (controller) => {
                if (controller.overlay.dwellTestModal.shown) {
                    await controller.overlay.dwellTestModal.hide();
                }
            }
        });

        ctrl.registerStep({
            id: 'keyboard-setup-2',
            title: 'Keyboard <br> Shortcuts',
            subtitle: 'Step 2 of 3',
            content: `
                <p><b>s</b> — Open Settings</p>
                <p><b>g</b> — Open AAC Grid</p>
                <p><b>x</b> — Start Switch Access</p>
                <p>You can use these shortcuts anytime.</p>
            `,
            position: 'left',
            area: ctrl.getArea(3, 4, 0, 2, 3, 3),
            nextStepId: 'keyboard-setup-3',
            prevStepId: 'dwell-time-setup',
            settingsPath: 'home/participant/keyboardShortcuts',
            onEnter: async (controller) => {
            },
            onExit: async (controller) => {
                if (controller.overlay.dwellTestModal.shown) {
                    await controller.overlay.dwellTestModal.hide();
                }
            }
        });
         ctrl.registerStep({
            id: 'keyboard-setup-3',
            title: 'Keyboard <br> Shortcuts',
            subtitle: 'Step 3 of 3',
            content: `
                <p><b>s</b> — Open Settings</p>
                <p><b>g</b> — Open AAC Grid</p>
                <p><b>x</b> — Start Switch Access</p>
                <p>You can use these shortcuts anytime.</p>
            `,
            position: 'center',
            area: ctrl.getArea(3, 4, 0, 3, 3, 4),
            nextStepId: 'walkthrough-complete',
            prevStepId: 'keyboard-setup-2',
            settingsPath: 'home/participant/keyboardShortcuts',
            onEnter: async (controller) => {
            },
            onExit: async (controller) => {
                
            }
        });

        ctrl.registerStep({
            id: 'walkthrough-complete',
            title: 'Walkthrough Complete!',
            subtitle: 'Step 3 of 3',
            content: `
                <p><strong>Yay! You've finished the walkthrough.</strong> Press <b>Exit</b> to return to the home screen and start using Squidly.</p>
            `,
            position: 'center',
            area: ctrl.getArea(3, 4, 0, 0, 0, 0),
            nextStepId: null,
            prevStepId: 'keyboard-setup-3',
            onEnter: async (controller) => {
                const modal = document.querySelector('.walkthrough-modal');
                if (modal) {
                    modal.style.width = '1000px';
                    modal.style.maxWidth = '90vw';
                }
            },
            onExit: async (controller) => {
            
            }
        });
    }

    initializeSwitchWalkthrough() {
        const ctrl = this.controller;

        ctrl.registerStep({
            id: 'switch-setup',
            title: 'Choose your <br> switch time',
            subtitle: 'Step 1 of 1',
            content: `
                <h4>Recommendations:</h4>
                <p>👶 Children → 2s–3s</p>
                <p>🏥 Clinicians → 2s-4s</p>
                <p>♿ Impairments → 1s-1.5s</p>
            `,
            position: 'right',
            area: ctrl.getArea(3, 4, 0, 1, 3, 2),
            settingsPath: 'home/participant/access',
            window: 'settings',
            nextStepId: 'keyboard-1',
            prevStepId: null,

            onEnter: async (controller) => {
                await controller.overlay.dwellTestModal.show();

                const accessControl = controller.session.getFeature("accessControl");
                const testButton = controller.overlay.dwellTestModal.testButton;

                if (accessControl.isSwitching) {
                    await accessControl.endSwitching();
                }

                controller._dwellTestActive = true;

                controller._dwellTestClickHandler = () => {
                    controller.overlay.dwellTestModal.removeEventListener('dwell-test-click', controller._dwellTestClickHandler);
                    controller._dwellTestClickHandler = null;

                    accessControl.addLoaderToButton(
                        testButton, "dwell"
                    );
                };

                controller.overlay.dwellTestModal.addEventListener('dwell-test-click', controller._dwellTestClickHandler);

                const onModalClose = () => controller.overlay.dwellTestModal.hide();
                controller._dwellModalCloseListener = onModalClose;
                controller.overlay.addEventListener('walkthrough-close', onModalClose);
            },

            onExit: async (controller) => {
                controller._dwellTestActive = false;

               
                if (controller._dwellTestClickHandler) {
                    controller.overlay.dwellTestModal.removeEventListener('dwell-test-click', controller._dwellTestClickHandler);
                    controller._dwellTestClickHandler = null;
                }

                const accessControl = controller.session.getFeature("accessControl");
                if (accessControl) {
                
                    await accessControl.endSwitching();
                }

                if (controller._dwellModalCloseListener) {
                    controller.overlay.removeEventListener('walkthrough-close', controller._dwellModalCloseListener);
                    controller._dwellModalCloseListener = null;
                }

                if (controller.overlay.dwellTestModal.shown) {
                    await controller.overlay.dwellTestModal.hide();
                }
            }
        });
        ctrl.registerStep({
            id: 'keyboard-1',
            title: 'Keyboard <br> Shortcuts',
            subtitle: 'Step 1 of 3',
            content: `
                <p><b>s</b> — Open Settings</p>
                <p><b>g</b> — Open AAC Grid</p>
                <p><b>x</b> — Start Switch Access</p>
                <p>You can use these shortcuts anytime.</p>
            `,
            position: 'right',
            area: ctrl.getArea(3, 4, 0, 1, 3, 2),
            nextStepId: 'keyboard-2',
            prevStepId: 'switch-setup',
            settingsPath: 'home/participant/keyboardShortcuts',
            onEnter: async (controller) => {
            },
            onExit: async (controller) => {
                if (controller.overlay.dwellTestModal.shown) {
                    await controller.overlay.dwellTestModal.hide();
                }
            }
        });

        ctrl.registerStep({
            id: 'keyboard-2',
            title: 'Keyboard <br> Shortcuts',
            subtitle: 'Step 2 of 3',
            content: `
                <p><b>s</b> — Open Settings</p>
                <p><b>g</b> — Open AAC Grid</p>
                <p><b>x</b> — Start Switch Access</p>
                <p>You can use these shortcuts anytime.</p>
            `,
            position: 'left',
            area: ctrl.getArea(3, 4, 0, 2, 3, 3),
            nextStepId: 'keyboard-3',
            prevStepId: 'keyboard-2',
            settingsPath: 'home/participant/keyboardShortcuts',
            onEnter: async (controller) => {
            },
            onExit: async (controller) => {
                if (controller.overlay.dwellTestModal.shown) {
                    await controller.overlay.dwellTestModal.hide();
                }
            }
        });
        ctrl.registerStep({
            id: 'keyboard-3',
            title: 'Keyboard <br> Shortcuts',
            subtitle: 'Step 3 of 3',
            content: `
                <p><b>s</b> — Open Settings</p>
                <p><b>g</b> — Open AAC Grid</p>
                <p><b>x</b> — Start Switch Access</p>
                <p>You can use these shortcuts anytime.</p>
            `,
             position: 'center',
            area: ctrl.getArea(3, 4, 0, 3, 3, 4),
            nextStepId: 'switch-complete',
            prevStepId: 'keyboard-2',
            settingsPath: 'home/participant/keyboardShortcuts',
            onEnter: async (controller) => {
            },
            onExit: async (controller) => {
                if (controller.overlay.dwellTestModal.shown) {
                    await controller.overlay.dwellTestModal.hide();
                }
            }
        });


        ctrl.registerStep({
            id: 'switch-complete',
            title: 'Walkthrough Complete!',
            subtitle: 'Step 2 of 2',
            content: `
                <p><strong>Yay! You've finished the walkthrough.</strong> Press <b>Exit</b> to return to the home screen and start using Squidly.</p>
            `,
            position: 'center',
            area: ctrl.getArea(3, 4, 0, 0, 0, 0),
            nextStepId: null,
            prevStepId: 'keyboard-3',
            onExit: async (controller) => {
        
            }
        });
    }

    initializeCursorWalkthrough() {
        const ctrl = this.controller;

        ctrl.registerStep({
            id: 'cursor-setup-1',
            title: 'Choose your <br> cursor style',
            subtitle: 'Step 1 of 3',
            content: `
                <h4>Recommendations:</h4>
                <p>👶 Children → Arrow</p>
                <p>🏥 Clinicians → Arrow</p>
                <p>♿ Impairments → Arrow</p>
            `,
            position: 'right',
            area: ctrl.getArea(3, 4, 0, 1, 3, 2),
            settingsPath: 'home/participant/cursors',
            window: 'settings',
            nextStepId: 'cursor-setup-2',
            prevStepId: null
        });

        ctrl.registerStep({
            id: 'cursor-setup-2',
            title: 'Choose your <br> click size',
            subtitle: 'Step 2 of 3',
            content: `
                <h4>Recommendations:</h4>
                <p>👶 Children → None</p>
                <p>🏥 Clinicians → Small</p>
                <p>♿ Impairments → Large</p>
            `,
            position: 'left',
            area: ctrl.getArea(3, 4, 0, 2, 3, 3),
            settingsPath: 'home/participant/cursors',
            window: 'settings',
            nextStepId: 'cursor-setup-3',
            prevStepId: 'cursor-setup-1'
        });

        ctrl.registerStep({
            id: 'cursor-setup-3',
            title: 'Choose your <br> Cursor colour',
            subtitle: 'Step 3 of 3',
            content: `
                <h4>Recommendations:</h4>
                <p>👶 Children → Black/White</p>
                <p>🏥 Clinicians → Small</p>
                <p>♿ Impairments → Large</p>
            `,
            position: 'center',
            area: ctrl.getArea(3, 4, 0, 3, 3, 4),
            settingsPath: 'home/participant/cursors',
            window: 'settings',
            nextStepId: 'keyboard-set-1',
            prevStepId: 'cursor-setup-2',
            onExit: async (controller) => {
                await controller.overlay.mask.hide();
                await controller.overlay.instructionModal.hide();
                controller.overlay.mask.stop();
            }
        });

        ctrl.registerStep({
            id: 'keyboard-set-1',
            title: 'Keyboard <br> Shortcuts',
            subtitle: 'Step 1 of 3',
            content: `
                <p><b>s</b> — Open Settings</p>
                <p><b>g</b> — Open AAC Grid</p>
                <p><b>x</b> — Start Switch Access</p>
                <p>You can use these shortcuts anytime.</p>
            `,
            position: 'right',
            area: ctrl.getArea(3, 4, 0, 1, 3, 2),
            nextStepId: 'keyboard-set-2',
            prevStepId: 'cursor-setup-3',
            settingsPath: 'home/participant/keyboardShortcuts',
            onEnter: async (controller) => {
            },
            onExit: async (controller) => {
                if (controller.overlay.dwellTestModal.shown) {
                    await controller.overlay.dwellTestModal.hide();
                }
            }
        });

        ctrl.registerStep({
            id: 'keyboard-set-2',
            title: 'Keyboard <br> Shortcuts',
            subtitle: 'Step 2 of 3',
            content: `
                <p><b>s</b> — Open Settings</p>
                <p><b>g</b> — Open AAC Grid</p>
                <p><b>x</b> — Start Switch Access</p>
                <p>You can use these shortcuts anytime.</p>
            `,
            position: 'left',
            area: ctrl.getArea(3, 4, 0, 2, 3, 3),
            nextStepId: 'keyboard-set-3',
            prevStepId: 'keyboard-set-1',
            settingsPath: 'home/participant/keyboardShortcuts',
            onEnter: async (controller) => {
            },
            onExit: async (controller) => {
                if (controller.overlay.dwellTestModal.shown) {
                    await controller.overlay.dwellTestModal.hide();
                }
            }
        });

         ctrl.registerStep({
            id: 'keyboard-set-3',
            title: 'Keyboard <br> Shortcuts',
            subtitle: 'Step 3 of 3',
            content: `
                <p><b>s</b> — Open Settings</p>
                <p><b>g</b> — Open AAC Grid</p>
                <p><b>x</b> — Start Switch Access</p>
                <p>You can use these shortcuts anytime.</p>
            `,
            position: 'center',
            area: ctrl.getArea(3, 4, 0, 3, 3, 4),
            nextStepId: 'cursor-complete',
            prevStepId: 'keyboard-set-2',
            settingsPath: 'home/participant/keyboardShortcuts',
            onEnter: async (controller) => {
            },
            onExit: async (controller) => {
                if (controller.overlay.dwellTestModal.shown) {
                    await controller.overlay.dwellTestModal.hide();
                }
            }
        });

        

        ctrl.registerStep({
            id: 'cursor-complete',
            title: 'Walkthrough Complete!',
            subtitle: 'Step 4 of 4',
            content: `
                <p><strong>Yay! You've finished the walkthrough.</strong> Press <b>Exit</b> to return to the home screen and start using Squidly.</p>
            `,
            position: 'center',
            area: ctrl.getArea(3, 4, 0, 0, 0, 0),
            nextStepId: null,
            prevStepId: 'keyboard-set-3',
            onExit: async (controller) => {
            }
        });
    }

    async startCalibrationWalkthrough() {
        await this.controller.start('calibration-size');
    }

    async startSwitchWalkthrough() {
        await this.controller.start('switch-setup');
    }

    async startCursorWalkthrough() {
        await this.controller.start('cursor-setup-1');
    }

    async initialise() {
        await this.initialising;

        this.session.toolBar.addMenuItem("access", {
            name: "walk-through",
            symbol: "user",
            onSelect: e => e.waitFor(this.session.openWindow("walkThrough"))
        });
    }

    async onOpenWindow(name) {
        console.log("onOpenWindow called with:", name);
        if (name === "walkThrough") {
            await this.setUpWindow.open();
            return true;
        }
        return false;
    }

    static async loadResources() {
        WalkThroughOverlayElement.loadStyleSheets();
        SetUpWindow.loadStyleSheets();
    }

    static get name() {
        return "walkThrough"
    }

    static get layers() {
        return {
            walkThroughOverlay: {
                type: "area",
                area: "fullAspectArea",
                index: 230,
            },
            setUpWindow: {
                type: "area",
                area: "fullAspectArea",
                index: 230,
            }
        }
    }

    static get firebaseName() {
        return "walk-through";
    }
}