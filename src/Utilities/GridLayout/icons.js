import { SvgPlus } from "../../SvgPlus/4.js";
import { delay } from "../usefull-funcs.js";

class IBW extends HTMLElement {
    async onConnectedCallback() {
        console.log("Connected callback called");
        await delay();
        await delay();
        await delay();
        await delay();

        let layers = getComputedStyle(this).getPropertyValue("--layers");
        layers = parseInt(layers);
        if (Number.isNaN(layers)) {
            layers = 1;
        }
        console.log(layers, this.getAttribute("i"));
        this.innerHTML = ""
        for (let i = 0; layers > 1 && i < layers; i++) {
            this.appendChild(new SvgPlus("i"))
        }
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === "i" && oldValue !== newValue) {
            this.onConnectedCallback();
        }
    }

    static get observedAttributes() {
        return ["i"];
    }
}
customElements.define("i-bw", IBW);

export class Icon extends SvgPlus {
    #value = null;
    constructor(icon, colored = false) {
        super(colored ? "i-c" : "i-bw")
        this.#value = icon;
        this.setAttribute("i", icon);
    }
    get value() {
        return this.#value;
    }
    set value(value) {
        this.setAttribute("i", value)
        this.#value = value;
    }
}

