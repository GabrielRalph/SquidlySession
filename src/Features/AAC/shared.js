

function isEqual(obj1, obj2) {
    if (typeof obj1 !== typeof obj2) return false;
    if (obj1 && obj2 && typeof obj1 === 'object') {
        const keys1 = Object.keys(obj1);
        const keys2 = Object.keys(obj2);
        if (keys1.length !== keys2.length) return false;
        for (let key of keys1) {
            if (!isEqual(obj1[key], obj2[key])) return false;
        }
        return true;
    }
    return obj1 === obj2;
}

/**
 * Creates a deep copy of the given object.
 * @template {Object} T
 * @param {T} obj
 * @returns {Partial<T>} a deep copy of the object
 */
function copy(obj) {
    if (obj && typeof obj === 'object') {
        if (obj.clone instanceof Function || obj.copy instanceof Function) {
            return obj.clone ? obj.clone() : obj.copy();
        }
        const c = Array.isArray(obj) ? [] : {};
        for (let key in obj) {
            c[key] = copy(obj[key]);
        }
        return c;
    }
    return obj;
}


function vnum(number) {
    return typeof number === "number" && !Number.isNaN(number)
}
class Color {
    #r = 0;
    #g = 0;
    #b = 0;
    #a = 1;
    #h = 0;
    #s = 0;
    #l = 0;
    constructor(...args) {
        let [r, g, b, a] = [null, null, null, 1];
        let [h, s, l] = [null, null, null];
        if (args.length === 1) {
            const value = args[0];
            if (value instanceof Color) {
                [r,g,b,a] = [value.r, value.g, value.b, value.a];
                [h,s,l] = Color.rgbToHsl(r,g,b);
            } else if (typeof value === "string") {
                if (value === "transparent") {
                    [h,s,l,r,g,b,a] = [0,0,0,0,0,0,0];
                } else {
                    let match = value.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(\d+(\.\d+)?))?\s*\)/);
                    if (match) {
                        [r,g,b,a] = [parseInt(match[1]), parseInt(match[2]), parseInt(match[3]), match[4] ? parseFloat(match[4]) : 1];
                        [h,s,l] = Color.rgbToHsl(r,g,b);
                    } else if (value.startsWith("#")) {
                        let hex = value.slice(1);
                        if (hex.length === 3) {
                            hex = hex.split("").map(c => c + c).join("") + "ff";
                        } else if (hex.length === 4) {
                            hex = hex.split("").map(c => c + c).join("");
                        } else if (hex.length === 6) {
                            hex += "ff"; 
                        } 
                        r = parseInt(hex.slice(0, 2), 16);
                        g = parseInt(hex.slice(2, 4), 16);
                        b = parseInt(hex.slice(4, 6), 16);
                        a = parseInt(hex.slice(6, 8), 16) / 255;
                        [h,s,l] = Color.rgbToHsl(r,g,b);
                    } else if (value.startsWith("hsl")) {
                        let match = value.match(/hsla?\((\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%(?:\s*,\s*(\d+(\.\d+)?))?\s*\)/);
                        if (match) {
                            h = parseInt(match[1]);
                            s = parseInt(match[2]) / 100;
                            l = parseInt(match[3]) / 100;
                            a = match[4] ? parseFloat(match[4]) : 1;
                            [r, g, b] = Color.hslToRgb(h, s, l);
                        }
                    }
                }
            }
        } else if (args.length === 3 || args.length === 4) {
            [r, g, b] = args;
            a = args[3] !== undefined ? args[3] : 1;
            [h,s,l] = Color.rgbToHsl(r,g,b);
        }
        this.#h = h;
        this.#s = s;
        this.#l = l;
        this.#r = r;
        this.#g = g;
        this.#b = b;
        this.#a = a;
    }

    clone() {
        return new Color(this)
    }

    lurp(other, t) {
        const r = this.r + (other.r - this.r) * t;
        const g = this.g + (other.g - this.g) * t;
        const b = this.b + (other.b - this.b) * t;
        const a = this.a + (other.a - this.a) * t;
        return new Color(r, g, b, a);
    }

    get brightness() {
        return 0.2126*this.#r + 0.7152*this.#g + 0.0722*this.#b;
    }

    get valid() {
        return vnum(this.#r) && vnum(this.#g) && vnum(this.#b) && vnum(this.#a) && vnum(this.#h) && vnum(this.#s) && vnum(this.#l);
    }

    set r(value) {
        this.#r = value;
        [this.#h, this.#s, this.#l] = Color.rgbToHsl(this.#r, this.#g, this.#b);
    }
    get r() { return this.#r; } 

    set g(value) {
        this.#g = value;
        [this.#h, this.#s, this.#l] = Color.rgbToHsl(this.#r, this.#g, this.#b);
    }
    get g() { return this.#g; }

    set b(value) {
        this.#b = value;
        [this.#h, this.#s, this.#l] = Color.rgbToHsl(this.#r, this.#g, this.#b);
    }
    get b() { return this.#b; }

    set a(value) {
        this.#a = value;
    }
    get a() { return this.#a; }

    set h(value) {
        this.#h = value % 360;
        [this.#r, this.#g, this.#b] = Color.hslToRgb(this.#h, this.#s, this.#l);
    }
    get h() { return this.#h; }

    set s(value) {
        this.#s = Math.max(0, Math.min(value, 1)) ;
        [this.#r, this.#g, this.#b] = Color.hslToRgb(this.#h, this.#s, this.#l);
    }
    get s() { return this.#s; }

    set l(value) {
        this.#l = Math.max(0, Math.min(value, 1));
        [this.#r, this.#g, this.#b] = Color.hslToRgb(this.#h, this.#s, this.#l);
    }
    get l() { return this.#l; }

    toString() {
        return this.toHex();
    }   

    toRGBString() {
        if (!this.valid) {
            return null;
        }
        if (this.a === 1) {
            return `rgb(${this.r}, ${this.g}, ${this.b})`;
        } else {
            return `rgba(${this.r}, ${this.g}, ${this.b}, ${this.a})`;
        }
    }

    toHex() {
        if (!this.valid) {
            return null;
        } 
        const r = this.r.toString(16).padStart(2, "0");
        const g = this.g.toString(16).padStart(2, "0");
        const b = this.b.toString(16).padStart(2, "0");
        if (this.a === 1) {
            return `#${r}${g}${b}`;
        } else {
            const a = Math.round(this.a * 255).toString(16).padStart(2, "0");
            return `#${r}${g}${b}${a}`;
        }
    }

    toHslString() {
        if (!this.valid) {
            return null;
        }
        if (this.a === 1) {
            return `hsl(${this.h}, ${this.s * 100}%, ${this.l * 100}%)`;
        } else {
            return `hsla(${this.h}, ${this.s * 100}%, ${this.l * 100}%, ${this.a})`;
        }
    }
    
    toJSON() {
        if (this.valid) {
            return null;
        }
        return this.toHex();
    }

    static rgbToHsl(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;
        let max = Math.max(r, g, b);
        let min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;

        if (max === min) {
            h = s = 0; // achromatic
        } else {
            let d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }

        return [h * 360, s, l];         
    }

    static hslToRgb(h, s, l) {
        let c = (1 - Math.abs(2 * l - 1)) * s;
        let x = c * (1 - Math.abs((h / 60) % 2 - 1));
        let m = l - c / 2;
        let r, g, b;
        if (h < 60) {
            [r, g, b] = [c, x, 0];
        } else if (h < 120) {
            [r, g, b] = [x, c, 0];
        } else if (h < 180) {
            [r, g, b] = [0, c, x];
        } else if (h < 240) {
            [r, g, b] = [0, x, c];
        } else if (h < 300) {
            [r, g, b] = [x, 0, c];
        } else {
            [r, g, b] = [c, 0, x];
        }
        return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
    }
}


export { isEqual, copy, Color };