import { Vector } from "../../SvgPlus/vector.js";
import { hsl2rgb, rgb2hsl } from "../usefull-funcs.js";

const CANVAS = document.createElement("canvas");
const CTX = CANVAS.getContext("2d");
const {PI} = Math;

class BBox {
    constructor(pos, size) {
        this.pos = new Vector(pos);
        this.size =  new Vector(size);
    }

    union(other) {
        const minX = Math.min(this.pos.x, other.pos.x);
        const minY = Math.min(this.pos.y, other.pos.y);
        const maxX = Math.max(this.pos.x + this.size.x, other.pos.x + other.size.x);
        const maxY = Math.max(this.pos.y + this.size.y, other.pos.y + other.size.y);
        return new BBox(new Vector(minX, minY), new Vector(maxX - minX, maxY - minY));
    }

    pad(x, y = x) {
        return new BBox(this.pos.sub(new Vector(x, y)), this.size.add(new Vector(2*x, 2*y)));
    }

    toString() {
        return `${this.pos.x} ${this.pos.y} ${this.size.x} ${this.size.y}`;
    }

    get bottom() {  
        return this.pos.y + this.size.y;
    }

    get right() {
        return this.pos.x + this.size.x;
    }

    get top() {
        return this.pos.y;
    }

    get left() {
        return this.pos.x;
    }

    static fromPoints(points, flipY = false) {
        let minX = null;
        let minY = null;
        let maxX = null;
        let maxY = null;
        for (let point of points) {
            if (!(point instanceof Vector)) {
                point = new Vector(point);
            }
            if (minX === null || point.x < minX) minX = point.x;
            if (minY === null || point.y < minY) minY = point.y;
            if (maxX === null || point.x > maxX) maxX = point.x;
            if (maxY === null || point.y > maxY) maxY = point.y;
        }
        if (flipY) {
            const temp = minY;
            minY = maxY;
            maxY = temp;
        }
        return new BBox(new Vector(minX, minY), new Vector(maxX - minX, maxY - minY));
    }


}

class DataClass {
    /**
     * Creates an instance of the class and populates its properties based on the provided arguments object.
    * @template {DataClass} T
    * @this {new() => T}
    * @param {Object} argsObject
    * @returns {T}
    */
    static make(argsObject) {
        if (typeof argsObject !== "object" || argsObject === null) {
            argsObject = {};
        }
        const instance = new this();
        for (const key in instance) {
            const hasParser = (key + "_parser") in this && this[key + "_parser"] instanceof Function;
            if (!(instance[key] instanceof Function) || hasParser) {
                if (key in argsObject) {
                    let parser = key + "_parser";
                    if (parser in this && this[parser] instanceof Function) {
                        instance[key] = this[parser](argsObject[key]);
                    } else {
                        instance[key] = argsObject[key];
                    }
                } else if (instance[key] === undefined) {
                    throw new Error(`${this.constructor.name}: Missing required property: ${key}`);
                }
            }
        }

        if ("validate" in instance && instance.validate instanceof Function) {
            instance.validate();
        }
        return instance;
    }


    /**
     * Creates an instance of the class and populates its properties based on the provided arguments object.
    * @template {DataClass} T
    * @this {new() => T}
    * @param {string} url - The URL to load the data from, which should return a JSON object.
    * @param {function(number):void} onprogress - An optional callback function that receives progress updates as a number between 0 and 1.
    * @returns {Promise<T>}
    */
    static async load(url, onprogress) {
        const data = await loadFile(url, "json", onprogress);
        return this.make(data);
    }
}

class Renderable extends DataClass {
    
    get pos() {
        return this.position || new Vector(0, 0);
    }
  
    get size() {
        return new Vector(this.width, this.height);
    }

    get boundingBox() {
        return new BBox(this.pos, this.size);
    }

    toString() {
        return this.render();
    }
    toJSON() {
        return this.render();
    }
    render() {
        return "";
    }
}

class StyleClass extends DataClass {
    get cssText() {
        let css = "";
        for (const key in this) {
            if (!(this[key] instanceof Function)) {
                const cssKey = key.replace(/([A-Z])/g, "-$1").toLowerCase();
                css += ` ${cssKey}= "${this[key]}"`;
            }
        }
        return css.trim();
    }
    toString() {
        return this.cssText;
    }
}

class LineStyles extends StyleClass {
    stroke = "#000";
    strokeWidth = 1;
    fill = "none";
    strokeLinecap = "round";
    strokeLinejoin = "round";
    clipPath = null;
    class = null;

    validate() {
        if (this.stroke === "none") {
            delete this.strokeWidth;
            delete this.strokeLinecap;
            delete this.strokeLinejoin;
            delete this.stroke;
        }
        if (this.clipPath instanceof ClipPath) {
            this.clipPath = this.clipPath.link;
        } else if (this.clipPath === null) {
            delete this.clipPath;
        }

        if (this.class === null) {
            delete this.class;
        }
    }
}

class Line extends Renderable {
    points = [new Vector(0, 0), new Vector(100, 100)];
    dp = 1;
    static points_parser(value) {
        if (Array.isArray(value)) {
            if (value.length > 0) {
                return value.map(v => new Vector(v));
            } else {
                throw new Error("Line: Points array cannot be empty");
            }
        } else {
            throw new Error(`Line: Invalid points value: ${value}`);
        }
    }

    styles = LineStyles.make();
    static styles_parser(value) { return LineStyles.make(value); }


    validate() {
        let maxX = null;
        let maxY = null;
        let minX = null;
        let minY = null;
        for (const point of this.points) {
            if (maxX === null || point.x > maxX) maxX = point.x;
            if (maxY === null || point.y > maxY) maxY = point.y;
            if (minX === null || point.x < minX) minX = point.x;
            if (minY === null || point.y < minY) minY = point.y;
        }
        this.width = maxX - minX;
        this.height = maxY - minY;
        this.position = new Vector(minX, minY);
    }

    render() {
        const pointsString = this.points.map(p => `${p.x.toFixed(this.dp)} ${p.y.toFixed(this.dp)}`).join(" ");
        return `<polyline points="${pointsString}" ${this.styles}/>`;
    }
}

class Rect extends Renderable {
    dp = 1;

    position = new Vector(0, 0);
    static position_parser(value) { return new Vector(value); }

    width = 100;
    height = 100;
    borderRadius = 0;

    styles = LineStyles.make();
    static styles_parser(value) { return LineStyles.make(value); }

    render() {
        const {x, y} = this.position;
        const {width, height} = this;
        const br = this.borderRadius > 0 ? `rx="${this.borderRadius.toFixed(this.dp)}" ry="${this.borderRadius.toFixed(this.dp)}"` : "";
        return `<rect x="${x.toFixed(this.dp)}" y="${y.toFixed(this.dp)}" width="${width.toFixed(this.dp)}" height="${height.toFixed(this.dp)}" ${br} ${this.styles} />`;
    }
}

class Circle extends Renderable {
    dp = 1;

    position = new Vector(0, 0);
    static position_parser(value) { return new Vector(value); }

    radius = 50
    styles = LineStyles.make();
    static styles_parser(value) { return LineStyles.make(value); }

    render() {
        const {x, y} = this.position;
        const r = this.radius;
        return `<circle cx="${x.toFixed(this.dp)}" cy="${y.toFixed(this.dp)}" r="${r.toFixed(this.dp)}" ${this.styles} />`;
    }
}

class Group extends Renderable {
    children = [];
    clipPath = null;
    static children_parser(value) {
        if (Array.isArray(value)) {
            for (const child of value) {
                if (!(child instanceof Renderable)) {
                    throw new Error(`Group: Invalid child: ${child}`);
                }
            }
            return value;
        }
    }   

    validate() {
        if (this.children.length > 0) {
            let bbox = this.children[0].boundingBox;
            for (let i = 1; i < this.children.length; i++) {
                bbox = bbox.union(this.children[i].boundingBox);
            }
            this.position = bbox.pos;
            this.width = bbox.size.x;
            this.height = bbox.size.y;
        } else {
            this.position = new Vector(0, 0);
            this.width = 0;
            this.height = 0;
        }

        if (this.clipPath instanceof ClipPath) {
            this.clipPath = this.clipPath.link;
        } 
    }

    render() {
        let cpstr = this.clipPath ? ` clip-path="${this.clipPath}"` : "";
        return `<g ${cpstr}>${this.children.join("")}</g>`;
    }

}

class ClipPath extends Group {
    id = `clip-${Math.random().toString(16).slice(2)}`;

    get link() {
        return `url(#${this.id})`;
    }

    render() {
        return `<clipPath id="${this.id}">${this.children.join("")}</clipPath>`;
    }
}

class Defs extends Group {

    get pos() {
        return new Vector(0, 0);
    }

    get size() {
        return new Vector(0, 0);
    }

    render() {
        return `<defs>${this.children.join("")}</defs>`;
    }
}

class TextStyles extends LineStyles {
    fontSize = 12;
    fontFamily = "sans-serif";
    fill = "#000";
    stroke = "none";
}

class Text extends Renderable {
    dp = 1;

    content = "";

    rotation = 0;

    log = false;
    
    styles = TextStyles.make();
    static styles_parser(value) { return TextStyles.make(value); }

    position = new Vector(0, 0);
    static position_parser(value) { return new Vector(value); }

    anchor = "center";
    static anchor_parser(value) { return value in this.anchorToTextAnchor ? value : "center"; }
       
    get pos() {
        const pos = this.position.add(this.size.mul(Text.anchorToPositionDelta[this.anchor]));        
        // pos.y += this.abboxDec || 0;
        return pos;
    }

    validate() {
        CTX.font = `${this.styles.fontSize}px ${this.styles.fontFamily}`;
        const metrics = CTX.measureText(this.content);
        this.log && console.log(metrics);
        this.width = metrics.width;
        this.height = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
        this.abboxDec = metrics.fontBoundingBoxDescent;
    }

    get boundingBox() {
        if (!this.rotation) {
            return new BBox(this.pos, this.size);
        }
        const theta = this.rotation * PI / 180;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        const delta = Text.anchorToPositionDelta[this.anchor];
        const w = this.width;
        const h = this.height;
        // 4 corners of the unrotated bbox relative to the anchor point
        const corners = [
            new Vector(delta.x * w,       delta.y * h),
            new Vector((delta.x + 1) * w, delta.y * h),
            new Vector(delta.x * w,       (delta.y + 1) * h),
            new Vector((delta.x + 1) * w, (delta.y + 1) * h),
        ];
        // rotate each corner around the anchor
        const rotated = corners.map(c => new Vector(
            c.x * cosT - c.y * sinT,
            c.x * sinT + c.y * cosT,
        ));
        const minX = Math.min(...rotated.map(c => c.x));
        const minY = Math.min(...rotated.map(c => c.y));
        const maxX = Math.max(...rotated.map(c => c.x));
        const maxY = Math.max(...rotated.map(c => c.y));
        return new BBox(
            this.position.add(new Vector(minX, minY)),
            new Vector(maxX - minX, maxY - minY)
        );
    }

    render() {
        const yOffset = this.height * Text.textAnchorToYOffset[this.anchor] - this.abboxDec;  
        const rotateAttr = this.rotation ? ` transform="rotate(${this.rotation}, ${this.position.x.toFixed(this.dp)}, ${this.position.y.toFixed(this.dp)})"` : "";
        let str = `<text x="${this.position.x.toFixed(this.dp)}" y="${(this.position.y + yOffset).toFixed(this.dp)}" text-anchor="${Text.anchorToTextAnchor[this.anchor]}"${rotateAttr} ${this.styles}>${this.content}</text>`;
        if (this.log) {
            str = Rect.make({
                position: this.boundingBox.pos,
                width: this.boundingBox.size.x,
                height: this.boundingBox.size.y,
                styles: {fill: "rgba(247, 0, 255, 0.24)", stroke: "none"}
            }) + Circle.make({
                position: this.position,
                radius: 1,
                styles: {fill: "red", stroke: "none"}
            }) + str;
        }
        return str;
    }

    static get anchorToPositionDelta() {
        return {
            "center": new Vector(-0.5, -0.5),
            "center-top": new Vector(-0.5, 0),
            "center-bottom": new Vector(-0.5, -1),
            "left": new Vector(0, -0.5),
            "left-top": new Vector(0, 0),
            "left-bottom": new Vector(0, -1),
            "right": new Vector(-1, -0.5),
            "right-top": new Vector(-1, 0),
            "right-bottom": new Vector(-1, -1)
        }
    }

    static get anchorToTextAnchor() {
        return {
            "center": "middle",
            "center-top": "middle",
            "center-bottom": "middle",
            "left": "start",
            "left-top": "start",
            "left-bottom": "start",
            "right": "end",
            "right-top": "end",
            "right-bottom": "end"
        }
    }

    static get textAnchorToYOffset() {
        return {
            "center": 0.5,
            "center-top": 1,
            "center-bottom": 0,
            "left": 0.5,
            "left-top": 1,
            "left-bottom": 0,
            "right": 0.5,
            "right-top": 1,
            "right-bottom": 0
        }
    }
}

class Tick extends Renderable {
    dp = 1;
    content = "";

    position = new Vector(0, 0);
    static position_parser(value) { return new Vector(value); }

    tickDirection = PI/2

    value = null;

    tickLength = 10;
    tickSpace = 0;

    lineStyles = LineStyles.make();
    static tickStyle_parser(value) { return LineStyles.make(value); }

    textStyles = TextStyles.make();
    static styles_parser(value) { return TextStyles.make(value); }

    render() {
        let vstr = this.value ? ` value="${this.value}"` : "";
        return `<g ${vstr} class = "tick">${this.line}${this.text}</g>`;
    }

    validate() {
        const theta = this.tickDirection;
        let dir = new Vector(Math.cos(theta), -Math.sin(theta));
        const tickEnd = this.position.add(dir.mul(this.tickLength));
        const textStart = tickEnd.add(dir.mul(this.tickSpace));
        const anchor = Tick.tickDirectionToTextAnchor[Math.floor(4 * theta / PI) % 8];

        const text = Text.make({
            content: this.content,
            styles: this.textStyles,
            position: textStart,
            anchor,
            dp: this.dp
        });

        const line = Line.make({
            points: [this.position, tickEnd],
            styles: this.lineStyles,
            dp: this.dp
        })

        // calculate bbox pos and size
        const textBox = text.boundingBox
        const lineBox = line.boundingBox;

        const thisBBox = textBox.union(lineBox);
        this.position = thisBBox.pos;
        this.width = thisBBox.size.x;
        this.height = thisBBox.size.y;
        this.text = text;
        this.line = line;
    }

    static get tickDirectionToTextAnchor() {
        return {
            0: "left",
            1: "center-bottom",
            2: "center-bottom",
            3: "right",
            4: "right",
            5: "center-top",
            6: "center-top",
            7: "left"
        }
    }
}

class Axis extends Renderable {
    position = new Vector(0, 0);
    static position_parser(value) { return new Vector(value); }

    minValue = 0;
    maxValue = 1;
    tickIncrements = 10;

    ticks = [];
    static ticks_parser(value) {return Array.isArray(value) ? [...value] : [];}

    axisLength = 100;
    portrait = false;
    flipTickSide = false;

    tickLength = 10;
    
    tickLineStyles = LineStyles.make()
    static tickLineStyles_parser(value) { return LineStyles.make(value); }

    axisLineStyles = null;
    static axisLineStyles_parser(value) { return value ? LineStyles.make(value) : null; }

    tickTextStyles = TextStyles.make()
    static tickTextStyles_parser(value) { return TextStyles.make(value); }

    get pos() {
        return this._realPos || this.position;
    }

    tickFormatFunction = (value) => value.toFixed(2);
    static tickFormatFunction_parser(value) {
        if (typeof value === "string") {
            return (v) => value.replace("${value}", v.toFixed(1));
        } else if (value instanceof Function) {
            return value;
        } else {
            throw new Error(`TickAxis: Invalid tick format function: ${value}`);
        }
    }

    validate() {
        const {portrait, flipTickSide, minValue, maxValue, tickIncrements, tickLength, tickLineStyles, tickTextStyles} = this;
        let ticks = this.ticks;
        if (ticks.length === 0) {
            ticks = new Array(this.tickIncrements + 1).fill(0).map((_, i) => 
                [this.axisLength * (i/this.tickIncrements), minValue + (maxValue - minValue) * i / tickIncrements]
            );
        } else {
            ticks = ticks.map(tick => {
                return [
                    this.axisLength * (tick - minValue) / (maxValue - minValue),
                    tick
                ]
            }).filter(([pos, value]) => pos >= -1e-4 && pos <= this.axisLength + 1e-4);
        }

        this.tickPositions = ticks.map(([pos, value]) => pos);

        let bbox = new BBox(this.position, new Vector(0, 0));
        let ticksR = []
        for (let [pos, value] of ticks) {

            const tickX = portrait ? this.position.x : this.position.x + pos;
            const tickY = portrait ? this.position.y + pos : this.position.y;

            const tick = Tick.make({
                position: new Vector(tickX, tickY),
                tickDirection: portrait ? (flipTickSide ? 0 : PI) : (flipTickSide ?  3*PI/2 : PI/2),
                tickLength: tickLength,
                tickSpace: portrait ? this.tickTextStyles.fontSize * 0.25 : 0,
                lineStyles: tickLineStyles,
                content: this.tickFormatFunction(value),
                value: value,
                textStyles: tickTextStyles
            });

            bbox = bbox.union(tick.boundingBox);
            ticksR.push(tick)
        }

        this._realPos = bbox.pos;
        this.width = bbox.size.x;
        this.height = bbox.size.y;
        this.ticksRenders = ticksR;
        this.axisLine = Line.make({
            points: portrait ? [
                [this.position.x, this.position.y],
                [this.position.x, this.position.y + this.axisLength]
            ] : [   
                [this.position.x, this.position.y],
                [this.position.x + this.axisLength, this.position.y]
            ],
            styles: this.axisLineStyles || tickLineStyles
        });
    }

    render() {        
        return `<g class = "axis">${this.axisLine}${this.ticksRenders.join("")}</g>`;
    }

}

class Grid extends Renderable {
    xPositions = [];
    static xPositions_parser(value) { return Array.isArray(value) ? [...value] : [];}

    yPositions = [];
    static yPositions_parser(value) { return Array.isArray(value) ? [...value] : [];}

    lineStyles = LineStyles.make()

    position = new Vector(0, 0);
    static position_parser(value) { return new Vector(value); }

    width = 100;
    height = 100;

    validate() {
        let lines = [];
        for (const x of this.xPositions) {
            lines.push(Line.make({
                points: [
                    [this.position.x + x, this.position.y],
                    [this.position.x + x, this.position.y + this.height]
                ],
                styles: this.lineStyles
            }))
        }
        for (const y of this.yPositions) {
            lines.push(Line.make({
                points: [
                    [this.position.x, this.position.y + y],
                    [this.position.x + this.width, this.position.y + y]
                ],
                styles: this.lineStyles
            }))
        }
        this.lines = lines;
    }

    render() {
        return `<g class = "grid">${this.lines.join("")}</g>`;
    }

}


export { 
    Line, Rect, Text, Circle,
    Tick, Axis, Grid,
    TextStyles, LineStyles,
    Group, ClipPath, Defs,
    StyleClass, Renderable, DataClass, BBox
};