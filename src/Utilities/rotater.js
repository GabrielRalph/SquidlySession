import { SvgPlus } from "../SvgPlus/4.js";
import { HideShowTransition } from "./hide-show.js";
import { delay, relURL } from "./usefull-funcs.js";


class RotaterFrame extends HideShowTransition {
    constructor(){
        super("div");

        // Setup initial state
        // 0deg angle and not flipped (shown state)
        this.angle = 0;
        this._shown = true;
        this.hiddenStyle = {
            "display": null,
        }
        this.styles = {
            ...this.hiddenStyle,
            "transform": `rotateY(${this.angle}deg)`,
            "opacity": 1,
        }
    }

    async flip(duration = 800, direction = 1){
        direction = direction >= 0 ? 1 : -1;
        let start = this.angle;
        let end = this.angle + direction * 180;
        this.angle = end;

        // Disable pointer events during animation
        this.styles = {
            "pointer-events": "none"
        }

        // Create animation sequence and reverse if currently shown
        this.animationSequence = [
            {"transform": `rotateY(${start}deg)`},
            {"transform": `rotateY(${end}deg)`},
        ];
        if (this.shown) this.animationSequence.reverse();

        // Toggle shown state to start the animation
        await this.toggle(!this.shown, duration);

        // Re-enable pointer events after animation
        this.styles = {
            "pointer-events": null
        }
    }

    get flipped(){
        let isFlipped = Math.floor(this.angle / 180) % 2 ==! 0;
        return isFlipped;
    }

}

class SlotTransition extends SvgPlus {
    constructor() {
        super("div");
        this.contentSets = []
        this.transitionTime = 0.68;
    }

    async setContent(...args) {
        if (this._settingContent) {
            this.contentSets.push(args);
        } else {
            this._settingContent = true;
            await this._applyTransition(...args);
            this._settingContent = false;
            if (this.contentSets.length > 0) {
                this.setContent(...this.contentSets.pop());
                this.contentSets = [];
            }
        }
    }

    async _applyTransition() {}
}

/** Rotates between two elements */
export class Rotater extends SlotTransition {
    constructor(){
        super("div");
        this.class = "rotater";
        this.flipper = this.createChild(RotaterFrame);
        this.slot1 = this.flipper.createChild("div", {class: "slot-1"});
        this.slot2 = this.flipper.createChild("div", {class: "slot-2"});
    }


    /**
     * Set the content of the rotater
     * @param {Element} content
     * @param {boolean} immediate whether to use rotation transition or immediate.
     * @returns {Promise<void>}
     */
    async setContent(content, immediate = false) {
        super.setContent(content, immediate);
    }

    /** Set the content of the rotater
     * @param {Element} content
     * @param {boolean} immediate whether to use rotation transition or immediate.
     * @returns {Promise<void>}
     */
    async _applyTransition(content, immediate = false) {
        let element = immediate ? this.shownSlot : this.hiddenSlot;
        element.innerHTML = "";
        if (content instanceof Element) {
            element.appendChild(content);
        }

        if (!immediate) {
            let lastShown = this.shownSlot;
            await this.flipper.flip(this.transitionTime * 1000);
            lastShown.innerHTML = "";
        }
    }

    get flipped(){return !this.flipper.flipped;}
    get shownSlot(){ return this.flipped ? this.slot1 : this.slot2; }
    get hiddenSlot(){ return this.flipped ? this.slot2 : this.slot1; }


    static get styleSheet(){
        return [relURL("./rotater.css", import.meta)];
    }
}



export class Slider extends SlotTransition {
    constructor(mode = "vertical"){
        super("div");
        this.class = "slider";
        this.slots = this.createChild(HideShowTransition, {class: "slider-transitioner"}, "div", "up");
        this.slots.hiddenStyle = {"display": null};
        this.slots.shown = true;

        this.slot1 = this.slots.createChild("div", {class: "slot"});
        this.slot2 = this.slots.createChild("div", {class: "slot", mode: "none"});
        this.mode = mode;
    }

    /**
     * Set the mode of the slider
     * @param {"vertical"|"horizontal"} mode
     */
    set mode(mode){
        if (mode === "horizontal") {
            this.setAttribute("mode", "horizontal");
            this._directions = ["left", "right"];
            this._mode = "horizontal";
        } else {
            this.setAttribute("mode", "vertical");
            this._directions = ["down", "up"];
            this._mode = "vertical";
        }
    }
    get mode(){
        return this._mode;
    }

    /** @return {string} The slider mode */
    get mode(){
        return this._directions[0] === "down" ? "vertical" : "horizontal";
    }


    /**
     * Set the content of the rotater. Direction can be set to the following values:
     * ~  1: right or down,
     * ~ -1: left or up, 
     * ~ any other value: immediate transition without animation.
     * @param {Element} content
     * @param {(1|2|any)} direction 
     * @returns {Promise<void>}
     */
    async setContent(content, direction) {
        super.setContent(content, direction);
    }


    async _applyTransition(content, direction = 1) {
        let immediate = !(direction === 1 || direction === -1);
       
        let element = immediate ? this.slot1 : this.slot2;
        
        element.innerHTML = "";
        if (content instanceof Element) {
            element.appendChild(content);
        }

        if (!immediate) {
            let [dL, dR] = this._directions;
            let dir = direction > 0 ? dL : dR;
            let opDir = direction > 0 ? dR : dL;
            if (this.mode == "vertical") {
                this.slot2.setAttribute("mode", opDir);
                this.slots.animationSequence = dir
            } else {
                this.slot2.setAttribute("mode", dir);
                this.slots.animationSequence = dir;
            }
            await this.slots.hide();

            this.slot2.setAttribute("mode", "none");
            this.slot1.innerHTML = "";
            this.slot1.appendChild(content)
            this.slots.shown = true;
        }
    }


    async _slide(direction = false){
        
    }

    get shownSlot(){
        return this.slot1;
    }
    get hiddenSlot() {
        return this.slot2;
    }

    static get styleSheet(){
        return [relURL("./rotater.css", import.meta)];
    }
}