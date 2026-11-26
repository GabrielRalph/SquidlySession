import { Vector } from "../../SvgPlus/vector.js";
import { AccessEvent } from "../../Utilities/Buttons/access-buttons.js";
import { GridIcon, GridLayout } from "../../Utilities/Buttons/grid-icon.js";
import { HideShowTransition } from "../../Utilities/hide-show.js";
import { Icon } from "../../Utilities/Icons/icons.js";
import { relURL } from "../../Utilities/usefull-funcs.js";
import { SquidlyFeatureWindow } from "../features-interface.js";
import { MaskOverlay } from "./mask-overlay-clip.js";

class Modal extends HideShowTransition {
    constructor(el) {
        super(el);
        this.modal = this.createChild("div", { class: "modal-positioner" });
        let rel = this.modal.createChild("div", { class: "modal-relative" });
        this.rel = rel;
    }

    setPosition(xSpan, ySpan, rows = 3, cols = 3) {
        const [xStart, xEnd] = xSpan;
        const [yStart, yEnd] = ySpan;

        this._xSpan = [xStart, xEnd];
        this._ySpan = [yStart, yEnd];
        this._rows = rows;
        this._cols = cols;
        
        const left = (xStart / cols) * 100 + "%";
        const width = ((xEnd - xStart + 1) / cols) * 100 + "%";

        const top = (yStart / rows) * 100 + "%";
        const height = ((yEnd - yStart + 1) / rows) * 100 + "%";

        this.modal.styles = {
            left, top, width, height
        }
    }

    clearCustomStyles() {
        this.modal.styles = {
            left: null, top: null, width: null, height: null
        }
    }
}

class InstructionModal extends Modal {
    constructor() {
        super("instruction-modal");
        let mcont = this.rel.createChild("div", { class: "modal-container"  });

        this.closeButton = mcont.createChild("access-button", {
            class: "modal-close-btn",
            events: {
                "access-click": (e) => {
                    const close = new AccessEvent("modal-close", e, { bubbles: true });
                    this.dispatchEvent(close);
                }
            }
        });
        this.closeButton.createChild(Icon, {}, "close");


        let info = mcont.createChild("div", {
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

        this.navButtons = mcont.createChild(GridLayout, {}, 1, 2);
        [this.prevButton, this.nextButton] = this.navButtons.addGridIcons([{
            type: "action",
            symbol: "back",
            displayValue: "Previous",
            events: {
                "access-click": (e) => {
                    this.dispatchEvent(new AccessEvent('modal-previous', e, { bubbles: true }));
                }
            }
        }, {
            type: "action",
            symbol: "next",
            displayValue: "Next",
            class: "next-btn",
            events: {
                "access-click": (e) => {
                    this.dispatchEvent(new AccessEvent('modal-next', e, { bubbles: true }));
                }
            }
        }], 0, 0);
    }


    updateStep(step, index, total) {
        this.stepIndicator.innerHTML = `Step ${index+1} of ${total}`;
        this.contentElement.innerHTML = step.content || "";
        this.titleElement.innerHTML = step.title || "";
        this.setButtonStates(index > 0, index < total);
        this.nextButton.displayValue = (index === total - 1) ? "Finish" : "Next";
        this.setPosition(...step.modalArea, ...step.gridSize);
    }
  
    setButtonStates(canGoBack, canGoNext) {
        this.prevButton.disabled = !canGoBack;
        this.nextButton.disabled = !canGoNext;
    }
}


class DwellTestModal extends Modal {
    constructor() {
        super("dwell-test-modal");

        this.button = this.rel.createChild(GridIcon, {}, {
            type: "adjective", 
            // symbol: "nown",
            displayValue: "Test the Speed",
            events: {
                // "access-click": (e) => {
                //     const e2 = new AccessEvent("dwell-test-click", e, { bubbles: true });
                    
                //     this.dispatchEvent(new AccessEvent('dwell-test-click', e, { bubbles: true }));
                // }
            }
        }, "test");
      
    }

    
}

export class WalkThroughOverlayElement extends SquidlyFeatureWindow {
    constructor() {
        super("walk-through-overlay", new HideShowTransition("walk-through-overlay"));

        this.mask = this.createChild(MaskOverlay, {
            class: "mask-overlay",
        });

        this.instructionModal = this.createChild(InstructionModal);
        this.dwellTestModal = this.createChild(DwellTestModal);
        this.instructionModal.shown = true;
    }

    async addLoader() {}

    async startDwelling(mode) {
        let button = this.dwellTestModal.button;
        if (this._dwellShowing) return;
        this._dwellShowing = true;
        console.log("adding dwell loader")
        while (this._dwellShowing) {
            await this.addLoader(button, mode);
            console.log(button.isVisible);
            if (!button.isVisible) {
                break;
            }
        }
        this._dwellShowing = false;
    }

    stopDwelling() {
        this._dwellShowing = false;
    }


    getSettingsPathHeight(){return 40}


    setStep(step, index, total) {
        this.instructionModal.topMargin = this.getSettingsPathHeight() + "px";
        this.instructionModal.updateStep(step, index, total);

        const gap = 5;
        const border = 2;

        if (step.dwellTestArea) {
            this.dwellTestModal.setPosition(...step.dwellTestArea, ...step.gridSize);
            this.dwellTestModal.show();
            if (step.dwellMode) this.startDwelling(step.dwellMode);
        } else {
            this.dwellTestModal.hide();
            this.stopDwelling();
        }

        this.mask.areas = (step.shownAreas || []).map(([[xStart, xEnd], [yStart, yEnd]]) => {
            return (w, h) => {
                const [rows, cols] = step.gridSize || [3, 3];
                const y0 = (step.window === "settings" ? this.getSettingsPathHeight() : 0);
                let H = h - y0  - gap * (rows + 1);
                let W = w - gap * (cols + 1);

                let cH = H / rows;
                let cW = W / cols;

                let sX = xEnd - xStart + 1;
                let sW = sX * (cW + gap) - gap + 2 * border;

                let sY = yEnd - yStart + 1;
                let sH = sY * (cH + gap) - gap + 2 * border;

                let posX = xStart * (cW + gap) + gap - border;
                let posY = yStart * (cH + gap) + gap + y0 - border;

                return {
                    pos: new Vector(posX, posY),
                    size: new Vector(sW, sH),
                    border: (1.5 * Math.min(window.innerWidth, window.innerHeight) / 100 + border)
                }
            }
        });
    }

    static get usedStyleSheets() {
        return [
            relURL("./walk-through-overlay.css", import.meta),
            GridIcon.styleSheet
        ]
    }
}