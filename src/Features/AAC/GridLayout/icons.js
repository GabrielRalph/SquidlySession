import { SvgPlus } from "../../../SvgPlus/4.js";

export class Icon extends SvgPlus {
    #value = null;
    constructor(icon, colored = false) {
        super(colored ? "i-c" : "i-bw")
        this.#value = icon;
        this.setAttribute("i", icon);
    }

    set value(value) {
        this.setAttribute("i", value)
        this.#value = value;
    }
}

