import { WhiteBoardElementBase } from "./interface.js"
import { Vector } from "../../../../SvgPlus/4.js";
import { rectCoords } from "../Utilites/basic-shapes.js";
import { findPathIntersections } from "../Utilites/intersection.js";

const {abs, max, min} = Math;

class TextShape extends WhiteBoardElementBase {
    constructor(whiteboard){
        super(whiteboard);
        this.toggleAttribute("text-element", true)
    }

    converToSvgText(value){
        if (value) {
            // convert to svg text
        } else {
            // convert back
        }
    }

    addFocusEvents(text) {
        let lastValue = ""
        text.addEventListener("focus", (e) => {
            this.editing = true;
        })
        text.addEventListener("focusout", (e) => {
            this.editing = false;
            if (text.value != lastValue) {
                this.dispatchDataChange();
            }
            lastValue = text.value;
        })
    }

    focusOn(){
        this.text.focus();
        this.text.setSelectionRange(0,0);
    }

    setStyleSet(sset) {
        this._fs = sset["font-size"];
        this._align = sset["text-align"];
    }



    set editing(value){
        if (value) {
            const event = new Event("editText", {bubbles: true})
            event.element = this;
            this.dispatchEvent(event)
        } else {
            const event = new Event("editTextDone", {bubbles: true})
            event.element = this;
            this.dispatchEvent(event)
        }
    }

    get isTextElement(){
        return true;
    }
    
    get fs(){
        let fs = parseFloat(this._fs);
        fs = Number.isNaN(fs) ? 10 : fs;
        return fs;
    }
    get align(){
        return this._align;
    }

    set readOnly(val) {
        this.text.toggleAttribute("readonly", val)
    }

    set capture(value) {
        this.converToSvgText(value);
    }

}


function computeTextWrap(line, lw, tw) {
    let wrapLines = [];
    let lastSpace = null;
    let start = 0;

    // for each character
    for (let j = 0; j < line.length; j++) {
        // if space store the index char after the space
        if (line[j] == " ") {
            lastSpace = j + 1; 
        
        // if this (non space) character causes the line to exceed the width
        // create a line from the start to the end
        } else if ((j + 1 - start)*lw > tw) { 
            // choose the end to be the last space or char before the line overflows
            let end = lastSpace != null ? lastSpace : j; 

            // push the line 
            wrapLines.push(line.slice(start, end));
            start = end; // start is now end

            lastSpace = null; 
        }
    }
    if (start != line.length) {
        wrapLines.push(line.slice(start, line.length))
    }
    return wrapLines;
}

const FS2Height = 1.34375;
const FS2Width = 0.728;
const PlaceHolder = "text here"
class TextBox extends TextShape {
    constructor(whiteboard){
        super(whiteboard);
        this.classList.add("text-box")
        this.rect = this.createChild("rect");
        this.svgText = this.createChild("g");
        this.fo = this.createChild("foreignObject");

        this.text = this.fo.createChild("textarea", {
            xmlns: "http://www.w3.org/1999/xhtml",
            events: {
                "input": (e) => {
                    this.dispatchLightDataChange();
                }
            }
        })
        this.padding = new Vector(0.4, 0.1);
        this.addFocusEvents(this.text);
    }

    converToSvgText(value){
        this.svgText.innerHTML="";
        this.fo.styles = {
            display: value ? "none" : null
        }
        if (value) {
            let {fs, styleSet, textAnchorAlign} = this;
            const r1 = 1.089;
            const r2 = FS2Height - 1e-2 - 3e-4;
            let lines = this.textLines.slice(0, this.maxLines);
            let anchor = this.textAnchor;
            let i = 0; 
            for (let line of lines) {
                this.svgText.createChild("text", {
                    "text-anchor": textAnchorAlign,
                    x: anchor.x,
                    y: anchor.y + fs * r1 + i,
                    fill: styleSet["text-color"],
                    "fill-opacity": styleSet["text-color-opacity"],
                    content: line,
                    "font-size": fs + "pt",
                    "font-family": 'Anonymous Pro'
                })
                i+= fs * r2;
            }
        }
    }
   
    fixTransformDelta(){
        this.corner = this.tCorner;
        this.size = this.tSize;
    }

    setDragDelta(delta) {
        let nc = this.corner.add(delta);
        this.tCorner = nc
        this.rect.props = {
            x: nc.x,
            y: nc.y
        }
        this.updateFO(true);
    }

    setScaleDelta(origin, scale) {
        let corner = this.corner;
        let size = this.size;


        let nsize = size.mul(scale);
        let nc = scale.mul(corner.sub(origin)).add(origin);
        
        let ne = nc.add(nsize);

        let x = min(ne.x, nc.x);
        let y = min(nc.y, ne.y);

        this.tCorner = new Vector(x,y);
        this.tSize = new Vector(abs(nsize.x), abs(nsize.y))

        let trc = {
            x: x,
            y: y,
            width: abs(nsize.x),
            height: abs(nsize.y)
        }
        this.rect.props = trc;
        this.updateFO(true)
    }

    getTextLines(text) {
        let lines = text.split("\n");
        let tw = this.textWidth;
        let fs = this.fs;
        let lw = fs * FS2Width;

        let wrapLines = [];
        for (let line of lines) {
            for (let wr of computeTextWrap(line, lw, tw)) {
                wrapLines.push(wr);
            }
        }

        return wrapLines;
    }

    get textLines() {
        return this.getTextLines(this.text.value)
    }

    updateFO(useTrans = false){
        let {sw, corner, size, padding} = this;
        if (useTrans) {
            corner = this.tCorner;
            size = this.tSize;
        }

        if (corner instanceof Vector) {
            let {x, y} = corner.add(sw/2);
            size = size.sub(sw)
            if (size.x < 0) size.x = 0;
            if (size.y < 0) size.y = 0;
            this.fo.props = {
                x: x, 
                y: y,
                width: size.x,
                height: size.y,
            }

            padding = padding.mul(this.fs);

            // For use in text to svg text
            let align = this.align;
            let tw = size.x - 2*padding.x;
            let x_anch = x + padding.x + (align == "center" ? tw/2 : (align == "right" ? tw : 0));
            this.textWidth = tw;
            this.textAnchor = new Vector(x_anch, y + padding.y);
            this.textAnchorAlign = (align == "center" ? "middle" : (align == "right" ? "end" : null));
            this.maxLines = Math.floor((size.y - 2*padding.y) / (this.fs * FS2Height));
            if (this.maxLines == 0) this.maxLines = 1;

            this.text.styles = {
                padding: `${padding.y}px ${padding.x}px`,
                width: `calc(100% - 2 * ${padding.x}px)`,
                height: `calc(100% - 2 * ${padding.y}px)`
            }
        }
    }

    setStyleSet(sset) {
        super.setStyleSet(sset);
        this.rect.styles = {
            ...sset,
            rx: sset["stroke-width"] * 2,
            ry: sset["stroke-width"] * 2,
        };
        this.text.styles = {
            color: sset["text-color"],
            "font-size": sset["font-size"] + "pt",
            "text-align": sset["text-align"],
            opacity: sset["text-color-opacity"]
        }
        this.updateFO();
    }

    isInside(v) {
        return this.isInBBox(v);
    }

    isIntersection(points){
        let c = this.corner
        let {x, y} = this.size
        let path = "M" +[
            c, 
            c.add(x, 0),
            c.add(x, y),
            c.add(0, y),
            c,
        ].join("L");
        let intersection = findPathIntersections(path, "M"+points.join("L"));
        let isIntrsection = intersection.length > 0;
 
        return isIntrsection;
    }


    getTransform(){
        return [this.tCorner, this.tCorner.add(this.tSize)];
    }
    setTransform(trans){
        this.coords = trans;
    }

    getData(){
        return {
            content: this.text.value,
        }
    }
    setData(data) {
        this.text.value = data.content;
    }
   
    /** @param {[Vector, Vector]} */
    set coords([start, end]){
        let coords = rectCoords([start, end]);
        this.corner = new Vector(coords.x, coords.y);
        this.size = new Vector(coords.width, coords.height);
        this.tCorner = this.corner;
        this.tSize = this.size;
        this.rect.props = coords;
        this.updateFO();
    } 

    static get name(){
        return "text-box"
    }

    static get observedStyles(){ return [
        "font-size",
        "text-color",
        "text-color-opacity",
        "stroke",
        "fill",
        "stroke-opacity",
        "fill-opacity",
        "stroke-width",
        "text-align",
    ]}
}

const PaddingRatio = 0.1;
class FreeText extends TextShape {
    constructor(whiteboard, pos){
        super(whiteboard);

        this.anchor = pos;
        this.tanchor = pos;
        this.classList.add("free-text")
        this.svgText = this.createChild("g")
        this.fo = this.createChild("foreignObject");
        this.text = this.fo.createChild("textarea", {
            xmlns: "http://www.w3.org/1999/xhtml",
            placeholder: PlaceHolder,
        })
        this.text.addEventListener("input", (e) => {
            this.resize();
            this.dispatchLightDataChange();
        })

        this.addFocusEvents(this.text);
    }

    converToSvgText(value){
        this.svgText.innerHTML="";
        this.fo.styles = {
            display: value ? "none" : null
        }
        if (value) {
            const r1 = 0.411;
            const r2 = FS2Height - 1e-2 - 3e-4;
            let lines = this.text.value.split("\n");
            let anchor = this.anchor;
            let ao = this.alignOffset;
            let anchorAlign = ao == 0.5 ? "middle" : (ao == 1 ? "end" : null);
            let i = 0; 
            for (let line of lines) {
                this.svgText.createChild("text", {
                    "text-anchor": anchorAlign,
                    x: anchor.x,
                    y: anchor.y + this.fs * r1 + i,
                    fill: this.styleSet["text-color"],
                    "fill-opacity": this.styleSet["text-color-opacity"],
                    content: line,
                    "font-size": this.fs + "pt",
                    "font-family": 'Anonymous Pro'
                })
                i+= this.fs * r2;
            }
        }
    }

    fixTransformDelta(){
        this.anchor = this.tanchor
    }

    setDragDelta(delta) {
        let anchor = this.anchor.add(delta);
        this.tanchor = anchor;
        this.resize();

    }

    setScaleDelta(origin, scale) {
        let anchor = scale.mul(this.anchor.sub(origin)).add(origin)
        this.tanchor = anchor;
        this.resize();
    }

    resize(){
        let [maxl, lines] = this.textShape;

        // Compute the padding, corner and size of the bounding box
        let {tanchor, fs, alignOffset} = this;
        let padding = PaddingRatio * fs;
        let corner = tanchor.sub(fs * maxl * alignOffset * FS2Width , fs * FS2Height / 2).sub(padding);
        let height = lines * fs * FS2Height + 2 * padding;
        let width =  maxl  * fs * FS2Width  + 2 * padding;

        // apply position and size to foreign object
        this.size = new Vector(width, height);
        this.corner = corner;
        this.fo.props = {
            x: corner.x,
            y: corner.y,
            height: height,
            width: width,
        }

        // apply padding to text
        this.text.styles = {
            "padding": padding + "px",
            "width": `calc(100% - ${2*padding}px)`,
            "height": `calc(100% - ${2*padding}px)`,
        }
    }

    setStyleSet(sset) {
        super.setStyleSet(sset);
        this.text.styles = {
            color: sset["text-color"],
            opacity: sset["text-color-opacity"],
            "font-size": sset["font-size"] + "pt",
            "text-align": sset["text-align"]
        }
        this.resize();
    }

    isIntersection(points){
        let isIntersection =false;
        if (this.size && this.anchor) {
            let c = this.corner
            let {x, y} = this.size
            let path = "M" +[
                c, 
                c.add(x, 0),
                c.add(x, y),
                c.add(0, y),
                c,
            ].join("L");
            let intersection = findPathIntersections(path, "M"+points.join("L"));
            isIntersection = intersection.length > 0;
            // if (!isIntersection) {
            //     isIntersection = isIntersection || points.map(p => this.isInBBox(p)).reduce((a, b) => a|b, false);
            // }
        }
        return isIntersection;
    }

    isInside(point){
        return this.isInBBox(point)
    }

    getTransform(){
        return [this.tanchor, new Vector()]
    }
    setTransform([anchor]){
        this.anchor = anchor
        this.tanchor = this.anchor;
        this.resize();
    }

    getData(){
        return {
            content: this.text.value,
        }
    }

    setData(data){
        this.text.value = data.content;
        this.resize();
    }

    get textShape(){
        let value = this.text.value;
        if (value != this._lastValue) {
            // get the number of lines, if 0 lines then set it to 1 line
            let lines = value.split("\n")
            let n = lines.length; 
            n = n == 0 ? 1 : n;
    
            // get the number of characters in the longest line, if empty
            // text use the length of the placeholder
            let maxl = max(...lines.map(l => l.length));
            if (value === "") maxl = PlaceHolder.length;
    
            this._max_line = maxl;
            this._num_lines = n;
        }
        this._lastValue = value;
        return [this._max_line, this._num_lines]
    }

    get alignOffset(){
        return (this.align === "right" ? 1 : (this.align === "center" ? 0.5 : 0));
    }


    static deserialise(whiteboard, json){
        let freeText = new FreeText(whiteboard, new Vector(json.trans[0]));
        freeText.json = json;
        return freeText;
    }

    static get name(){
        return "free-text";
    }

    static get observedStyles(){ return [
        "font-size",
        "text-color",
        "text-color-opacity",
        "text-align"
    ]}
}


export default [FreeText, TextBox]