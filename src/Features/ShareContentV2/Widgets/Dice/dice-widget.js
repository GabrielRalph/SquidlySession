import { GridCard, GridLayout } from "../../../../Utilities/GridLayout/grid-icons.js";
import { relURL } from "../../../../Utilities/usefull-funcs.js";
import { DiceRoller } from "./dice-module.js";

DiceRoller.load(relURL("./assets/die.glb", import.meta))
DiceRoller.define("dice-roller-widget-display");

function toHexColor(c) {
    return "#" + (c.toString(16)).padStart(6, 0)
}

class DiceWidget extends GridLayout {
    #currentValue = [6];
    #theme;

    constructor() {
        super(2, 5)
        this.card = this.addGridIcon({
            colorTheme: "clear",    
            events: {"access-click": () => {
                this.roll();
            }}
        }, [0,1], [1,3]);
        this.roller = new DiceRoller();
        this.card.content.appendChild(this.roller);
        [[this.lastCountIcon], [this.nextCountIcon]] = this.addGridIcons([
            [{
                symbol: "dice_1",
                colorTheme: "dark",
                disabled: true,
                events: {"access-click": (e) => {
                    this.incrementDiceCount(-1)
                }}
            }],
            [{
                symbol: "dice_2", 
                colorTheme: "dark", 
                events: {"access-click": (e) => {
                    this.incrementDiceCount(1)
                }}
            }]
        ], 0, 4)
        this.diceColorIcon = this.addGridIcon({
            symbol: "dice_colors", 
            colorTheme: "dark",
            events: {"access-click": (e) => {
                this.toggleColorTheme();
            }}
        }, 0, 0)

        this.diceCount = 1;
        this.colorTheme = 0;

    }

    set diceCount(value) {
        this.roller.diceCount = value;
        const n = this.diceCount;
        const back = n - 1;
        const next = n + 1;

        this.lastCountIcon.symbol = "dice_" + Math.max(back, 1);
        this.nextCountIcon.symbol = "dice_" + Math.min(next, 6);

        this.lastCountIcon.disabled = back == 0;
        this.nextCountIcon.disabled = next == 7;
    }
    get diceCount() { return this.roller.diceCount}



    /** @param {keyof(DiceWidget.COLOR_THEMES)} name */
    set colorTheme(i) {
        const THEMES = DiceWidget.COLOR_THEMES
        const n = THEMES.length;
        if (i < n && i >= 0) {
            [this.roller.bodyColor, this.roller.indentColor] = THEMES[i]
            this.#theme = i;
             [
                (i) % n,
                (i + 1) % n,
                (i + 2) % n
            ].forEach((ci, ii) => {
                const [body, indent] = DiceWidget.COLOR_THEMES[ci];
                let key1 = ii == 0 ? "--icon-color" : `--i-color-${ii*2}`
                this.diceColorIcon.styles = {
                    [key1 + "-hover"]: toHexColor(body),
                    [key1]: toHexColor(body),
                    [`--i-color-${ii*2 + 1}`]: toHexColor(indent)
                }
            })
        }
    }
    get colorTheme() {return this.#theme}


    get state() {
        return {
            colorTheme: this.colorTheme,
            diceCount: this.diceCount,
            value: this.#currentValue
        }
    }

    set state(state) {
        state = state || {};
        this.colorTheme = state.colorTheme;

        const oldSize = this.diceCount;
        this.diceCount = state.diceCount;
        const sizeChange = oldSize !== this.diceCount;

        let newVal = state.value;
        if (!Array.isArray(newVal)) newVal = [6]
        if (newVal.length == 0) newVal = [6]
        if (newVal.length > 6) newVal = newVal.slice(0, 6)

        let vKey = this.#currentValue.join("-");
        let nKey = newVal.join("-");

        if (nKey != vKey) {
            if (!sizeChange) {
                this.roller.roll(...newVal);
            }
            this.#currentValue = [...newVal];
        }
    }
    get currentValue() {
        return [...this.#currentValue];
    }

    roll() {
        let newVal = new Array(this.diceCount).fill(0).map(
            e => Math.ceil(Math.random() * 6 - 1e-5)
        );
        this.roller.roll(...newVal);
        this.#currentValue = [...newVal];
        this.dispatchEvent(new CustomEvent("change", {bubbles: true}))
    }

    toggleColorTheme(){
        this.colorTheme = (this.colorTheme + 1) % DiceWidget.COLOR_THEMES.length;
        this.dispatchEvent(new CustomEvent("change", {bubbles: true}))
    }


    incrementDiceCount(delta) {
        this.diceCount += delta;
        this.#currentValue = new Array(this.diceCount).fill(6);
        this.dispatchEvent(new CustomEvent("change", {bubbles: true}))
    }



    static get COLOR_THEMES() {
        return [
            [0xff0000, 0xffffff],
            [0x0000ff, 0xffffff],
            [0x000000, 0xffff00]
        ]
    }
}

export {DiceWidget}