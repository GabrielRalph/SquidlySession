import { SvgPlus } from "../../SvgPlus/4.js";
import { delay } from "../usefull-funcs.js";

async function waitForAncestorStyles(el) {
    let node = el;
    while (true) {
        const root = node.getRootNode();
        if (!(root instanceof ShadowRoot)) break;
        const host = root.host;
        if (typeof host.waitStyles === "function") await host.waitStyles();
        node = host;
    }
}

class IBW extends HTMLElement {
    connectedCallback() {
        this.render();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === "i" && oldValue !== newValue && this.isConnected) {
            this.render();
        }
    }

    static get observedAttributes() {
        return ["i"];
    }

    async render() {
        const token = (this._renderToken = {});   // only the latest call is allowed to finish
        await waitForAncestorStyles(this);
        if (token !== this._renderToken || !this.isConnected) return;

        let layers = parseInt(getComputedStyle(this).getPropertyValue("--layers"));
        if (Number.isNaN(layers)) layers = 1;

        this.replaceChildren();
        for (let i = 0; layers > 1 && i < layers; i++) {
            this.appendChild(new SvgPlus("i"));
        }
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

