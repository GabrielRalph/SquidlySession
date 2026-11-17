import { GridIcon, GridLayout } from "../../Utilities/GridLayout/grid-icons.js";
import { Color } from "../../Utilities/usefull-funcs.js";

class CIcon extends GridIcon {
    constructor(opts, group) {
        super(opts, group);
        const color = opts.color;
        if (color.a === 0) {
            this.toggleAttribute("transparent")
        } else if (color.isWhite) {
            this.toggleAttribute("white")
        } 
        this.styles = {
            "--main": color,
        }
        this.highlight = opts.selected || false;
        this.classList.add("c-icon");
    }
}

class ColorPicker extends GridLayout {
    HUES = [0, 30, 60, 110, 195, 240, 315]
    BLACK = new Color(0,0,0)
    WHITE = new Color(255,255,255)

    #last_i = 0;
    #last_j = 0;
    #last_k = 0;
    #last_h = 0;    

    constructor() {
        super(5, 5)
        this.setHue(0)
    }

    getColor(h, i, j) {
        if (h < 0) {
            let l = -255 * (h + 1) / 3;
            return new Color(l, l, l);
        } else {
            i = Math.min(Math.max(i, 0), 2);
            j = Math.min(Math.max(j, 0), 2);
            const hue = this.HUES[h];
            let baseColor = new Color(`hsl(${hue}, 100%, 50%)`)
            return baseColor.lurp(this.BLACK, i/3).lurp(this.WHITE, j/3)
        }
    }

    #buildHues(h) {
        this.HUES.forEach((hue, i) => {
            const c = new CIcon({
                color: `hsl(${hue}, 100%, 50%)`,
                events: {
                    "access-click": (e) => {
                        this.setHue(i);
                    }
                }
            })
            c.highlight = i == h;
            this.add(c, i < 4 ? 3 : (6 - i), i < 4 ? i : 3);
        })

        for (let i = 0; i < 4; i++) {
            let l = 255 * i / 3;
            const c = new CIcon({
                color: new Color(l, l, l),
                events: {
                    "access-click": (e) => {
                        this.setHue(-(i+1))
                    }
                },
                selected: h == -(i+1)
            })
            this.add(c, i, 4);
        }
    }

    #buildTones(h, si, sj) {
        if (h >= 0) {
            const ops = new Array(3).fill(0).map((_, i) => 
                new Array(3).fill(0).map((_, j) => {
                    return {
                        color: this.getColor(h, i, j),
                        events: {
                            "access-click": (e) => {
                                this.setHue(h, i, j);
                            }
                        },
                        selected: i == si && j == sj
                    }
                })
            )
            this.addItemInstances(CIcon,ops, 0, 0);
        }
    }

    #buildTransparency(h, i, j, sk) {
        let color = this.getColor(h, i, j);
        for (let k = 0; k < 5; k++) {
            let alpha = 1 - k / 4;
            color.a = alpha;
            const c = new CIcon({
                color,
                events: {
                    "access-click": (e) => {
                        this.setHue(h, i, j, k);
                    }
                },
                selected: k == sk
            })
            this.add(c, 4, k);
        }
    }

    #setHue(h, i = null, j = null, k = null) {
        i = i ?? this.#last_i;
        j = j ?? this.#last_j;
        k = k ?? this.#last_k;
        this.#last_h = h;
        this.#last_i = h < 0 ? 0 : i;
        this.#last_j = h < 0 ? 0 : j;
        this.#last_k = k;

        this.innerHTML = "";
        this.#buildHues(h);
        this.#buildTones(h, i, j);
        this.#buildTransparency(h, i, j, k);
    }

    setHue(h, i = null, j = null, k = null) {
        this.#setHue(h, i, j, k);
        this.dispatchEvent(new CustomEvent("change", {detail: this.value}));
    }

    set value(color) {
        color = new Color(color);
        let isGray = color.r == color.g && color.g == color.b;
        if (isGray) {
            let l = color.r / 255;
            let k = Math.round((1 - color.a) * 4);
            this.#setHue(-Math.round(l * 3 + 1), null, null, k);
        } else {
            const hue = color.h;
            const hueDiff = this.HUES.map(h2 => Math.min(Math.abs(h2 - hue - 360), Math.abs(h2 - hue), Math.abs(h2 - hue + 360)));
            const minDiff = Math.min(...hueDiff);
            const h =  hueDiff.indexOf(minDiff)
      

            const max = Math.max(color.r, color.g, color.b);
            const min = Math.min(color.r, color.g, color.b);

            const j = min / 255;
            const i = min === 255 ? 0 : 1 - (max - min) / (255 - min);
            const k = color.a === 1 ? 0 : Math.round((1 - color.a) * 4);
            this.#setHue(h, Math.round(i * 3), Math.round(j * 3), k);
        }


    }

    get value() {
        const c0 = this.getColor(this.#last_h, this.#last_i, this.#last_j);
        c0.a = 1 - (this.#last_k / 4);
        return c0;
    }
}
class ColorPickerGroup extends GridLayout {
    #value = {fill: "#f00", stroke: "#f00", text: "#000"}
    #selectedType = "fill"

    constructor() {
        super(5, 6);
        [[this.strokeEl], [this.fillEl], [this.textEl]] = this.addGridIcons([
            [{
                // displayValue: "stroke",
                symbol: ["stroke", false],
                colorTheme: "dark",

                events: {
                    "access-click": (e) => this.select("stroke")
                }
            }],
            [{
                // displayValue: "fill",
                colorTheme: "dark",
                symbol: ["fill", false],
                events: {
                    "access-click": (e) => this.select("fill")
                }
            }],
            [{
                colorTheme: "dark",
                // displayValue: "text",
                symbol: ["text", false],
                events: {
                    "access-click": (e) => this.select("text")
                }
            }]
        ], 0, 0)
        this.colorPicker = this.add(new ColorPicker(), [0,4], [1,5]);
        this.colorPicker.addEventListener("change", (e) => {
            this.#value[this.#selectedType] = this.colorPicker.value.toString();
            this.#onValueUpdate(true);
        });

        this.select("stroke")
    }

    #onValueUpdate(e = false) {
        this.fillEl.styles = {
            "--icon-color": this.#value["fill"],
            "--icon-color-hover": this.#value["fill"]
        }
        this.strokeEl.styles = {
            "--icon-color": this.#value["stroke"],
            "--icon-color-hover": this.#value["stroke"]
        }
        this.textEl.styles = {
            "--icon-color": this.#value["text"],
            "--icon-color-hover": this.#value["text"]
        }
        if (e) this.dispatchEvent(new CustomEvent("change", {detail: this.#value}));
    }

    select(type) {
        this.#selectedType = type;
        this.fillEl.highlight = type === "fill";
        this.strokeEl.highlight = type === "stroke";
        this.textEl.highlight = type === "text";
        let color = this.#value[type];
        if (this.colorPicker) {
            this.colorPicker.value = color;
        }

    }

    set value(val) {
        this.#value = val;
        this.#onValueUpdate();
    }

    get value() {
        return this.#value;
    }
}


export { ColorPickerGroup, ColorPicker };