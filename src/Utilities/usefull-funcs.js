
export function isIOS() {
  if (/iPad|iPhone|iPod/.test(navigator.platform)) {
    return true;
  } else {
    return navigator.maxTouchPoints &&
      navigator.maxTouchPoints > 2 &&
      /MacIntel/.test(navigator.platform);
  }
}

export function isIpadOS() {
  return navigator.maxTouchPoints &&
    navigator.maxTouchPoints > 2 &&
    /MacIntel/.test(navigator.platform);
}

export function isExactSame(obj1, obj2) {
  if (typeof obj1 !== typeof obj2) return false;
  else if (typeof obj1 === "object") {
      if (obj1 === null && obj2 === null ) return true;
      else if (obj1 === null || obj2 === null) return false;
      else {
          let k1 = new Set(Object.keys(obj1));
          let k2 = new Set(Object.keys(obj2));
          let k3 = new Set();
          for (let v of k1) k3.add(v);
          for (let v of k2) k3.add(v);
      
          if (k1.size !== k3.size) {
              return false;
          } else {
              for (let key of k1) {
                  let v1 = obj1[key];
                  let v2 = obj2[key];
                  if (!isExactSame(v1, v2)) return false;
              }
          }
      }
  } else if ( obj1 !== obj2 ) return false;

  return true;
}

/**
 * @TODO Make this work for all devices
 */
export function getDevice(){
  if (isIOS()) {
    if (isIpadOS()) {
      return "tablet"
    } else {
      return "phonoe"
    }
  } else {
    return "computer"
  }
}


export function isPageHidden(){
  return document.hidden || document.msHidden || document.webkitHidden || document.mozHidden;
}

export function getCursorPosition(){
  return {x: window.XPos, y: window.YPos}
}

export function elementAtCursor(){
  return document.elementFromPoint(window.XPos, window.YPos);
}

/** @param {() => Promise[]} */
export async function series(arr) {
    for (let promise of arr) {
        await promise();
    }
}

export function uncamelCase(str) {
    str = str.replace(/([a-z])([A-Z])/g, '$1 $2');
    str = str.replace(/([a-zA-Z])(\d+)([a-zA-Z])/g, '$1 $2 $3');
    str = str.charAt(0).toUpperCase() + str.slice(1);
    return str;
}

export async function transition(callBack, duration) {
  if (callBack instanceof Function) {
    let end = false;
    return new Promise((resolve, reject) => {
      let t0 = null
      callBack(0);
      let dt = 0;
			let tn = 0;
      let next = (tnow) => {
				tn = tnow;
        if (t0 == null) t0 = window.performance.now();
        dt = window.performance.now() - t0;
        let t = dt/duration;
        if (t > 1) {
          t = 1;
          end = true;
        }
        callBack(t);
        if (!end) {
          window.requestAnimationFrame(next);
        } else {
          resolve(true);
        }
      }
      window.requestAnimationFrame(next)
    });
  }
}

export function argmin(arr) {
  let mini = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < arr[mini]) {
      mini = i;
    }
  }
  return mini;
}

export function argmax(arr) {
  let maxi = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > arr[maxi]) {
      maxi = i;
    }
  }
  return maxi;
}

export function lurp4(x, y, tl, tr, bl, br) {
	let xt = tl.mul(1-x).add(tr.mul(x));
	let xb = bl.mul(1-x).add(br.mul(x));
	let p = xt.mul(1-y).add(xb.mul(y));
	return p;
}

export function dotGrid(size, tl, tr, bl, br) {

  let points = [];
  if (size == 1) {
    points.push(tl.add(br).div(2));
  } else {
    let dd = 1 / (size - 1);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let p = lurp4(x*dd, y*dd, tl, tr, bl, br);
        points.push(p);
      }
    }
  }
	return points;
}

export function linspace(start, end, incs) {
  let range = end - start;
  let dx = range / (incs - 1);
  let space = [];
  for (let i = 0; i < incs; i ++) space.push(start + i * dx);
  return space;
}


export async function delay(time){
  return new Promise((resolve, reject) => {
    if (time) {
      setTimeout(resolve, time);
    } else {
      window.requestAnimationFrame(resolve);
    }
  })
}

export function relURL(url, meta) {
  let root = meta.url;
  url = url.replace(/^\.\//, "/");
  if (url[0] != "/") url = "/" + url;
  return root.split("/").slice(0, -1).join("/") + url;
}

export class TransitionVariable {
  constructor(initialValue, durationPerUnit, onupdate) {
    if (onupdate instanceof Function) this.onupdate = onupdate;
    this.duration = durationPerUnit;
    this.reverseDuration = durationPerUnit;
    this.hardSet(initialValue);
    this._updating = null;
  }

  onupdate() {

  }

  async waitTransition(){
    if (this._updating instanceof Promise) {
      await this._updating;
    }
  }

  async startUpdating(){
    if (this._updating instanceof Promise) return this._updating;

    let update = async () => {
      let t0 = performance.now();
      while(this.goalValue != this.transValue) {
        await delay();
        let t1 = performance.now();
        let duration = this.transValue > this.goalValue ? this.reverseDuration : this.duration;
        let dv = (t1 - t0) / (1000 * duration);
        t0 = t1;

        let value = this.goalValue;
        if (Math.abs(this.transValue - value) <= dv) {
          this.transValue = this.goalValue
        } else {
          this.transValue += this.transValue > value ? -dv : dv;
        }

        if (this.onupdate instanceof Function) {
          this.onupdate(this.getTransValue(), this.goalValue);
        }
      }
    }

    this._updating = update();
    await this._updating;
    this._updating = null;
  }

  async set(value) {
    this.goalValue = value;
    await this.startUpdating();  
  }

  hardSet(value) {
    this.goalValue = value;
    this.transValue = value;
    this.onupdate(this.getTransValue());
  }

  get(){
    return this.goalValue;
  }

  getTransValue() {
    return this.transValue;
  }
}

export class WaveStateVariable extends TransitionVariable {
  constructor(initialState, duration, onupdate) {
    super(initialState, duration, onupdate);
  }

  async set(value) {
    value = value ? 1 : 0;
    await super.set(value);
  }

  hardSet(value) {
    value = value ? 1 : 0;
    super.hardSet(value);
  }

  getTransValue(){
    return (1 - Math.cos(this.transValue * Math.PI))/2
  }
}

export function getQueryKey(string = window.location.search) {
  let query = new URLSearchParams(string);
  let key = [...query.entries()].find(([k, v]) => 
    k.match(/^([-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz]{20})$/) 
    && v == "" 
  );
  let isProxy = query.get("proxy") != null;
  return {
    key: key ? key[0] : null,
    options: query,
    isProxy: isProxy
  };
}

export function makeLogger(name, style) {
  return (...args) => {
    console.log("%c" + name + ": " + args.map(t => t + "").join(" "), style);
  }
}

export class PromiseChain {
  constructor(){
      this.head = null;
      this.tail = null;

  }
  /** 
   * @param {() => Promise} func
   * @return {Promise}
   * */
  async addPromise(func, override = false) {
      let item = {next: null, prom: null, override: override};

      // Add item to chain
      if (this.head == null) {
          this.head = item;
          this.tail = item;
      } else {
        let node = this.head;
          while (node.next != null) {
              let nextNode = node.next;
              if (nextNode.override && nextNode.prom === null) {
                break;
              }
              node = nextNode;
          }
          node.next = item;
          this.tail = item;
      }

      // wait for previous promises in the chain
      let node = this.head;
      while (node !== null && node != item) {
          await node.prom;
          node = node.next;
      }

      let res = null;
      // If the node is not null, it means that the promise was not overridden
      if (node !== null) {
        // call the promise added.
        item.prom = func();
        res = await item.prom;

        // remove the item from the chain
        if (this.tail == item) {
            this.tail = null;
            this.head = null;
        } else {
            this.head = item.next;
        }
      }
     
      return res;
  }

  async wait(){
    let node = this.head;
    while (node != null) {
      await node.prom;
      node = node.next;
    }
  }
}

class ProxyObjectError extends Error{
  constructor(message) {
    super(message);
    this.stack = this.stack.replace(/\sat\s+Object.set[^\n]+\n/, "")
  }
}
class ProxyObjectSetError extends ProxyObjectError {}
class ProxyObjectGetError extends ProxyObjectError {}

class ProxyClass {
  constructor(...args) {
      return new Proxy(...args)
  }
}
export class PublicProxy extends ProxyClass {
  constructor(instance, restrict) {
    if (typeof restrict !== "object" || restrict == null) restrict = {}
    let isPrivate = (prop) => {
      return prop[0] == "_" ||
              prop in restrict || 
              prop[0] == "$"
    }
    super(instance, {
      get: (target, prop, receiver) => {
        if (prop in target) {
          let isF = target[prop] instanceof Function
          if (isPrivate(prop)) {
            throw new ProxyObjectGetError(`Failed to ${isF ? "call" : "get"} ${prop} as it's a private ${isF ? "function" : "property"}.`)
          } else {
            return isF ? instance[prop].bind(instance) : target[prop];
          }
        } else {
          throw new ProxyObjectGetError(`No property or function named '${prop}'.`)
        }
      },
      set: (target, prop, receiver) => {
        if (prop in instance) {
          if (isPrivate(prop)) {
            throw new PrivacyError(`The ${target[prop] instanceof Function ? "function" : "property"} '${prop}' is private.`)
          } else if (instance[prop] instanceof Function) {
            throw new ProxyObjectSetError(`Cannot set function '${prop}'.`)
          } else {
            instance[prop] = receiver;
          }
        } else {
          throw new PrivacyError(`No property or function '${prop}'.`)
        }
        return true
      }
    })
  }
}

/**
 * Converts HSL color values to RGB.
 * @param {number} h - Hue (0-360)
 * @param {number} s - Saturation (0-100)
 * @param {number} l - Lightness (0-100)
 * @returns {Array} An array containing the RGB values [r, g, b] (each 0-255)
 */
export function hsl2rgb(h, s, l) {
  h /= 360;
  s /= 100;
  l /= 100;
  let r, g, b;

  if (s === 0) {
      r = g = b = l; // achromatic
  } else {
      const hue2rgb = (p, q, t) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
      };

      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

/**
 * Converts RGB color values to HSL.
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {Array} An array containing the HSL values [h, s, l] (h: 0-360, s: 0-100, l: 0-100)
 */
export function rgb2hsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
      h = s = 0; // achromatic
  } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
          case r: h = (g - b) / d + (g < b ? 6 : 0); break;
          case g: h = (b - r) / d + 2; break;
          case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
  }

  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

const DEBUG = false;

function vnum(number) {
    return typeof number === "number" && !Number.isNaN(number)
}
export class Debugger {
    constructor(name, style = "background: #b43113; color: white; padding: 5px; border-radius: 5px;") {
        this.name = name;
        this.style = style;
        this.times = {}
    }

    get isLogOn() {
        return (DEBUG && !this.disable) || this.forced;
    }

    tic(log) {
        this.times[log] = performance.now();
    }

    toc(log, extraInfo = "") {
        const end = performance.now();
        const duration = end - (this.times[log] || end);
        extraInfo = extraInfo ? ` ${extraInfo}` : "";
        this.logBasic(`${log}${extraInfo}: ${Debugger.fTime(duration)}`);
        return duration;
    }

    logStart(mode, info, ...args) {
        if (this.isLogOn) {
            console.groupCollapsed(`%c${this.name}: ${mode}`, this.style, info);
            if (args.length > 0) {
                console.log(...args);
            }
        }
    }

    logBasic(...args) {
        if (this.isLogOn) {
            console.log(`%c${this.name}:`, this.style, ...args);
        }
    }

    logEnd() {
        if (this.isLogOn) console.groupEnd();
    }

    log(mode, info, ...args) {
        if (this.isLogOn) {
            this.logStart(mode, info);
            let error = new Error();
            let stack = error.stack.split("\n").slice(2).join("\n");
            args.forEach(arg => console.log(arg));
            console.log(stack);
            this.logEnd();
        }
    }

    static fTime(n) {
        return n < 1000 ? Math.round(n) + "ms" : (n/1000).toFixed(2) + "s";
    }
}

export class Color {
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

