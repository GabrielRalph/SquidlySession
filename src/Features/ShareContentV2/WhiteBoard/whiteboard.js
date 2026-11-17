import { SvgPlus, Vector } from "../../../SvgPlus/4.js";
import { SvgView } from "./svg-view.js";
import { Tools } from "./Tools/tools.js"
import { Elements } from "./Element/whiteboard-elements.js";
import { WhiteBoardElementBase, ElementChangeEvent } from "./Element/interface.js";
import { SelectionBox, SelectTransform } from "./Utilites/selection.js";
import { BasicShapes, DASH_STYLES } from "./Utilites/basic-shapes.js";
import { objectDeepCopy, Svg2DataURL, dateNice } from "./Utilites/basic-funcs.js";
import { WhiteBoardSync } from "./whiteboard-sync.js";

/**
 * @typedef {string|number|boolean|null} StyleValue
 * @typedef {import("../../../Firebase/firebase-frame.js").FirebaseFrame} FirebaseFrame
 *
 * @typedef {Object} WhiteBoardOptions
 * @property {FirebaseFrame} [firebaseFrame] a frame to sync the board with
 * @property {string} [tool="pan"] the initial tool
 * @property {Object.<string,StyleValue>} [styles] initial styles, merged over DEFAULT_STYLES
 * @property {boolean} [hotkeys=true] enable keyboard shortcuts (undo/redo/tool keys)
 */

/* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ CONSTANTS ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */

/** The names of the tools that can be passed to setTool */
export const TOOL_NAMES = Object.keys(Tools);

/** Friendlier names accepted by setTool */
export const TOOL_ALIASES = {
    "pen": "draw",
    "text": "free-text",
    "eraser": "erasor",
    "elbow": "elbow-path",
    "arrow": "elbow-path",
}

/** Shape names for the shape tool (style key "shape") */
export const SHAPE_NAMES = Object.keys(BasicShapes);

/** Dash style names (style key "dash-style") */
export const DASH_STYLE_NAMES = Object.keys(DASH_STYLES);

/** Arrow head marker ids (style keys "marker-start" / "marker-end").
 *  null means no arrow head. */
export const ARROW_HEADS = {
    "arrow1": `<path fill = "context-stroke" d="M 0 0 L 10 5 L 0 10 z" />`,
    "arrow2": `<path fill = "none" stroke-width = "2.5" stroke-linecap = "round" stroke = "context-stroke" d="M 1.25 1.25 L 7.53 5 L 1.25 8.75" />`,
    "arrow3": `<circle fill = "context-stroke" cx = "5" cy = "5" r = "5" />`,
}
export const ARROW_HEAD_NAMES = Object.keys(ARROW_HEADS);

/** Friendlier names accepted for arrow heads */
export const ARROW_HEAD_ALIASES = {
    "triangle": "arrow1",
    "chevron": "arrow2",
    "circle": "arrow3",
    "dot": "arrow3",
    "none": null,
}

const TEXT_ALIGNS = ["left", "center", "right"];

/** Style keys that hold a color. Colors may include alpha, e.g.
 *  "rgba(255, 0, 0, 0.5)" or "#ff000080". */
export const COLOR_KEYS = ["stroke", "fill", "text-color"];

/** The default style set used for new elements */
export const DEFAULT_STYLES = {
    "stroke": "rgb(0, 131, 255)",
    "stroke-width": 3,
    "fill": "rgb(207, 232, 255)",
    "text-color": "rgb(0, 0, 0)",
    "font-size": 18,
    "text-align": "left",
    "marker-start": null,
    "marker-end": null,
    "dash-style": "solid",
    "shape": "ellipse",
}

/** All style keys understood by setStyle/setStyles */
export const STYLE_KEYS = Object.keys(DEFAULT_STYLES);

/* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ COLORS ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   The public API uses combined colors (color + alpha). Elements, the
   serialised data and the database store them split into a color and an
   "<key>-opacity" value, so we convert at the API boundary.
   ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */

let _colorCtx = null;

/** Parses any CSS color into {r, g, b, a}, or null if invalid
 * @param {string} color
 * @return {{r: number, g: number, b: number, a: number}|null} */
export function parseColor(color) {
    if (typeof color !== "string") return null;
    if (_colorCtx == null) _colorCtx = document.createElement("canvas").getContext("2d", {willReadFrequently: true});
    let ctx = _colorCtx;

    // an invalid color leaves fillStyle unchanged, so try two different defaults
    ctx.fillStyle = "#000000";
    ctx.fillStyle = color;
    let v1 = ctx.fillStyle;
    ctx.fillStyle = "#ffffff";
    ctx.fillStyle = color;
    if (v1 !== ctx.fillStyle) return null;

    let m;
    if ((m = v1.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i))) {
        return {r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16), a: 1};
    }
    if ((m = v1.match(/^rgba?\(([^)]+)\)$/))) {
        let [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
        return {r, g, b, a};
    }

    // other color spaces: let the canvas convert to sRGB
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    let [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return {r, g, b, a: Math.round(a / 255 * 100) / 100};
}

function rgbString({r, g, b}, a = 1) {
    return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Combines a stored color and opacity into one color string */
function combineColor(color, opacity) {
    let c = parseColor(color);
    if (c == null) return color;
    let o = parseFloat(opacity);
    let a = c.a * (Number.isNaN(o) ? 1 : o);
    return rgbString(c, Math.round(a * 1000) / 1000);
}

/** Converts a public style set (combined colors) to the stored form */
function splitStyles(styles) {
    let res = {};
    for (let key in styles) {
        if (COLOR_KEYS.includes(key)) {
            let c = parseColor(styles[key]);
            if (c != null) {
                res[key] = rgbString(c);
                res[key + "-opacity"] = c.a;
            }
        } else {
            res[key] = styles[key];
        }
    }
    return res;
}

/** Converts a stored style set to the public form (combined colors) */
function combineStyles(styles) {
    let res = {};
    for (let key in styles) {
        let colorKey = key.replace(/-opacity$/, "");
        if (colorKey !== key && COLOR_KEYS.includes(colorKey)) continue;
        if (COLOR_KEYS.includes(key)) {
            res[key] = combineColor(styles[key], styles[key + "-opacity"]);
        } else {
            res[key] = styles[key];
        }
    }
    return res;
}

const Events = {
    "mousedown": true,
    "mouseup": true,
    "mousemove": true,
    "mouseleave": true,
    "dblclick": true,
    "click": true,
    "editText": true,
    "editTextDone": true,
}

/* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ STYLESHEETS / FONTS ~~~~~~~~~~~~~~~~~~~~~ */

function getRoot(){
    let a = import.meta.url.split("/");
    a.pop();
    return a.join("/")
}

let styles = await (await fetch(getRoot() + "/styles.css")).text();
const StyleSheet = new CSSStyleSheet();
StyleSheet.replaceSync(styles);

// Font used by text elements, added to the document (not replacing the host
// app's adopted stylesheets).
const FontStyleSheet = new CSSStyleSheet();
FontStyleSheet.replaceSync(`@font-face {
    font-family: 'Anonymous Pro';
    src: url('${getRoot()}/fonts/Anonymous-Pro.woff2') format('woff2'),
        url('${getRoot()}/fonts/Anonymous-Pro.woff') format('woff'),
        url('${getRoot()}/fonts/Anonymous-Pro.ttf')  format('truetype');
}`)
document.adoptedStyleSheets = [...document.adoptedStyleSheets, FontStyleSheet];

let fonts = {}
async function getFontDataURL(fname){
    if (!(fname in fonts)) {
        fonts[fname] = (async () => {
            let font_res = await fetch(getRoot() + `/fonts/${fname}.woff2`);
            let font_blob = await font_res.blob()
            return await new Promise((resolve) => {
                var reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(font_blob);
            })
        })();
    }
    return fonts[fname]
}
getFontDataURL("Anonymous-Pro");


/* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ WHITEBOARD ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */

/**
 * The drawing area. It has no toolbar. Drive it through its methods
 * (setTool, setStyles, undo, ...) and listen to its events to keep your own
 * UI in sync:
 *
 *  - "toolchange"      detail: {tool}
 *  - "stylechange"     detail: {styles, changes}
 *  - "selectionchange" detail: {selection, styles, styleKeys}
 *  - "historychange"   detail: {canUndo, canRedo}
 */
export class WhiteBoard extends SvgPlus {
    /** @param {WhiteBoardOptions} [options] */
    constructor(options = {}) {
        super("white-board");
        let shadow = this.attachShadow({mode: "open"})
        shadow.adoptedStyleSheets = [StyleSheet];
        this.root = shadow;

        this.History = {
            times: [],
            data: {},
            index: 0,
        };
        this.TheirHistory = {
            times: [],
            data: {},
        }

        /** stored (split color/opacity) styles used for new elements
         * @type {Object.<string,StyleValue>} */
        this._styles = splitStyles(DEFAULT_STYLES);
        this._hotkeys = options.hotkeys !== false;

        /** @type {WhiteBoardSync} */
        this._sync = null;

        this.styles = {
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            "--c-dark": "#302e2e",
            "--c-darker": "#211f1f",
            "--c-light": "#555252"
        }

        this._build();

        if (options.styles) this.setStyles(options.styles);
        this.setTool(options.tool || "pan");
        if (options.firebaseFrame) this.setFirebaseFrame(options.firebaseFrame);
    }

    /* ~~~~~~~~~~~~~~~~~~ PROPERTIES ~~~~~~~~~~~~~~~~~~~~ */

    /** If set true prevents user from zooming
     * @param {boolean} val */
    set isZoomLocked(val){
        this.svgView.isZoomLocked = val
    }

    /** If set true prevents user from panning
     * @param {boolean} val */
    set isPanLocked(val) {
        this.svgView.isPanLocked = val
    }

    /** If set true prevents executing commands (undo, delete, setTool ...).
     *  Tools set this while the user is mid-drag.
     * @param {boolean} val */
    set disableCommands(val) {
        this._disableCommands = !!val;
    }
    get disableCommands() {return this._disableCommands}

    /** If set true the board ignores all user input and commands.
     * @param {boolean} val */
    set disabled(val) {
        this.styles = {"pointer-events": val ? "none" : null}
        this.disableCommands = val;
        this._disabled = !!val;
        if (val) this.clearSelection();
    }
    get disabled(){
        return this._disabled;
    }

    /** @deprecated use disabled */
    set fullyDisabled(val) {this.disabled = val}
    get fullyDisabled() {return this.disabled}

    /** If set true prevents user from interacting text
     * @param {boolean} val */
    set readOnly(val) {
        for (let textBox of this.mainLayer.querySelectorAll("textarea")) {
            textBox.toggleAttribute("readonly", val)
        }
    }

   /** Set the cursor seen on the whiteboard
     * @param {string} val */
    set cursor(val){
        this.styles = {
            "--cursor": val
        }
    }

    /** The style set used when creating new elements (a copy), in the
     *  stored form where colors are split into color and "-opacity" keys.
     *  Tools read this when they create elements. Use getStyles() for the
     *  public form.
     * @return {Object.<string,StyleValue>} */
    get styleSet(){
        return {...this._styles};
    }

    /** @deprecated use setStyles */
    set styleSet(sset) {
        this.setStyles(sset);
    }

    /** The name of the selected tool
     * @return {string} */
    get tool() {
        return this._selectedToolName;
    }

    /** Gets the list of all elements on the whiteboard
     * @return {WhiteBoardElementBase[]} */
    get elements(){
        return [...this.mainLayer.querySelectorAll("[wb-element]")];
    }

    /** Returns true if there is a current selection
     * @return {boolean} */
    get isSelection(){
        return this.selectTransform != null;
    }

    /** Returns the current select transform or null if none
     * @return {SelectTransform}
     */
    get selectTransform(){
        let st = this._selectionTransform;
        return st instanceof Element ? st : null;
    }

    /** Returns the current selection
     * @return {WhiteBoardElementBase[]} */
    get selection(){
        return this.isSelection ? this.selectTransform.selection : [];
    }

    /** @return {boolean} */
    get canUndo() {
        return this.History.index > 0;
    }

    /** @return {boolean} */
    get canRedo() {
        return this.History.index < this.History.times.length;
    }

    /** The firebase frame the board is synced with, or null
     * @return {FirebaseFrame} */
    get firebaseFrame() {
        return this._sync ? this._sync.frame : null;
    }
    set firebaseFrame(frame) {
        this.setFirebaseFrame(frame);
    }

    /* ~~~~~~~~~~~~~~~~~~ TOOLS ~~~~~~~~~~~~~~~~~~~~ */

    /** Selects the tool specified by its name.
     *
     *  Tools: "pan", "select", "draw" (alias "pen"), "shape", "line",
     *  "elbow-path", "textbox", "free-text" (alias "text"), "erasor" (alias "eraser").
     *
     * @param {string} name the name of the tool
     * @param {Object} [options] tool specific options, e.g. setTool("shape", {shape: "rectangle"})
     * @return {boolean} true if the tool was selected */
    setTool(name, options) {
        if (this.disableCommands) return false;
        if (name in TOOL_ALIASES) name = TOOL_ALIASES[name];
        if (!(name in Tools)) {
            console.warn(`WhiteBoard: unknown tool "${name}"`);
            return false;
        }

        if (this._selectedTool) {
            this._selectedTool.onDeselect(this);
        }

        this._selectedToolName = name;
        this._selectedTool = Tools[name];
        if (this._selectedTool.clearSelectionOnSelect()) this.clearSelection();
        this._selectedTool.onSelect(this, options);

        this._dispatch("toolchange", {tool: name});
        return true;
    }

    /** @deprecated use setTool */
    selectTool(key) {
        return this.setTool(key);
    }

    /* ~~~~~~~~~~~~~~~~~~ STYLES ~~~~~~~~~~~~~~~~~~~~ */

    /** Returns a copy of the current styles. Colors are combined with their
     *  opacity, e.g. {stroke: "rgba(255, 0, 0, 0.5)"}.
     * @return {Object.<string,StyleValue>} */
    getStyles() {
        return combineStyles(this._styles);
    }

    /** Sets several styles at once. The styles are used for new elements,
     *  and are also applied to the current selection and to the text
     *  element being edited.
     *
     *  Keys: stroke, stroke-width, fill, text-color, font-size, text-align,
     *  marker-start, marker-end, dash-style, shape.
     *
     *  Colors are any CSS color and may include alpha, e.g. "red",
     *  "#ff000080" or "rgba(255, 0, 0, 0.5)". null or "none" means fully
     *  transparent (e.g. no fill).
     *
     * @param {Object.<string,StyleValue>} styles
     * @return {Object.<string,StyleValue>} the changes that were applied */
    setStyles(styles) {
        let changes = {};
        for (let key in styles) {
            let value = this._normaliseStyle(key, styles[key]);
            if (value !== undefined) changes[key] = value;
        }
        if (Object.keys(changes).length == 0) return changes;

        // convert to the stored form (split colors)
        let stored = splitStyles(changes);

        // null / "none" only clears the opacity, keeping each color as is
        for (let key of COLOR_KEYS) {
            if (key in styles && (styles[key] === null || styles[key] === "none")) {
                delete stored[key];
                stored[key + "-opacity"] = 0;
            }
        }
        Object.assign(this._styles, stored);

        // apply to the current selection
        if (this.isSelection && !this.selectTransform.waiting) {
            this.selectTransform.styleSet = stored;
        }

        // let the tool react (cursor colour, text box being edited ...)
        if (this._selectedTool && this._selectedTool.styleChange instanceof Function) {
            this._selectedTool.styleChange(stored, this);
        }

        let all = this.getStyles();
        changes = {};
        for (let key in all) {
            if (key in stored || (key + "-opacity") in stored) changes[key] = all[key];
        }
        this._dispatch("stylechange", {styles: all, changes});
        return changes;
    }

    /** Sets one style
     * @param {string} key
     * @param {StyleValue} value */
    setStyle(key, value) {
        return this.setStyles({[key]: value});
    }

    /** @param {string} color any CSS color, may include alpha e.g. "rgba(255, 0, 0, 0.5)" */
    setStrokeColor(color) {return this.setStyle("stroke", color)}

    /** @param {string|null} color any CSS color, may include alpha. null or "none" for no fill */
    setFillColor(color) {return this.setStyle("fill", color)}

    /** @param {string} color any CSS color, may include alpha */
    setTextColor(color) {return this.setStyle("text-color", color)}

    /** @param {number} width stroke thickness in board units */
    setStrokeWidth(width) {return this.setStyle("stroke-width", width)}

    /** @param {string|null} arrow one of ARROW_HEAD_NAMES (or an alias), null for none */
    setStartArrow(arrow) {return this.setStyle("marker-start", arrow)}

    /** @param {string|null} arrow one of ARROW_HEAD_NAMES (or an alias), null for none */
    setEndArrow(arrow) {return this.setStyle("marker-end", arrow)}

    /** @param {string} dashStyle one of DASH_STYLE_NAMES: "solid", "square-dot",
     *  "dash", "dash-dot", "round-dot". The dash array scales with stroke width. */
    setDashStyle(dashStyle) {return this.setStyle("dash-style", dashStyle)}

    /** @param {number} size font size in board units */
    setFontSize(size) {return this.setStyle("font-size", size)}

    /** @param {"left"|"center"|"right"} align */
    setTextAlign(align) {return this.setStyle("text-align", align)}

    /** @param {string} shape one of SHAPE_NAMES, used by the shape tool */
    setShape(shape) {return this.setStyle("shape", shape)}

    /* ~~~~~~~~~~~~~~~~~~ GENERAL METHODS ~~~~~~~~~~~~~~~~~~~~ */

    /** Converts point in screen coordinates to those of the svg
     * @param {Vector} point
     * @return {Vector} */
    screenToSVG(point) {
        return this.svgView.viewBoxX.screenToSVG(point);
    }

    /** Gets whiteboard element by its id
     * @param {string} id
     * @return {WhiteBoardElementBase} */
    getElement(id) {
        return this.mainLayer.querySelector(`#${id}`);
    }

    /** Resets the pan/zoom */
    resetView() {
        this.svgView.resetView();
    }

    /** Keeps the board's view box fitted to the given element, so the board
     *  acts as an overlay on it. Panning and zooming the board then
     *  transforms the element (with a CSS transform) and the annotations
     *  follow it. Board coordinates become relative to the element: its
     *  longest side spans 1000 units, regardless of its size on screen.
     *  The view is reset when the linked element changes.
     * @param {HTMLElement} el */
    linkToElement(el) {
        const vb = this.svgView.viewBoxX;
        const old = vb.linked_element;
        if (old && old !== el) old.style.removeProperty("transform");
        if (old !== el) {
            vb.offset = new Vector();
            vb.scale = 1;
        }
        this.linked_element = true;
        vb.linkToElement(el);
    }

    /** The size used to make the view offset relative: the untransformed
     *  size of the linked element, or the board's size on screen. */
    _viewReferenceSize() {
        const el = this.svgView.viewBoxX.linked_element;
        if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
            return new Vector(el.offsetWidth, el.offsetHeight);
        }
        return this.svgView.viewBoxX.getScreenBBox()[1];
    }

    /** The pan / zoom of the board. When linked to an element (see
     *  linkToElement) the offset is relative to that element's size, so a
     *  view can be shared between screens of different sizes.
     * @return {{scale: number, x: number, y: number}} */
    get view() {
        const vb = this.svgView.viewBoxX;
        const offset = vb.linked_element ? vb.offset.div(this._viewReferenceSize()) : vb.offset;
        return {scale: vb.scale, x: offset.x, y: offset.y};
    }

    /** Sets the pan / zoom of the board (see view). Does not dispatch
     *  a "viewchange" event.
     * @param {{scale: number, x: number, y: number}} view */
    set view(view) {
        if (typeof view !== "object" || view === null) return;
        const vb = this.svgView.viewBoxX;
        let offset = new Vector(view.x || 0, view.y || 0);
        if (vb.linked_element) offset = offset.mul(this._viewReferenceSize());
        let scale = parseFloat(view.scale);
        vb.scale = Number.isFinite(scale) ? Math.min(Math.max(scale, vb.minScale), vb.maxScale) : 1;
        vb.offset = offset;
    }

    /* ~~~~~~~~~~~~~~~~~~ SELECTION ~~~~~~~~~~~~~~~~~~~~ */

    /** Selects the given element/s (does not change tool)
     * @param {WhiteBoardElementBase[]|WhiteBoardElementBase} elements */
    select(elements) {
        if (this.disableCommands) return;
        this.createSelection(elements);
    }

    /** Clears the current selection  */
    clearSelection(){
        if (this.isSelection) {
            this._selectionTransform.remove();
            this._selectionTransform = null;
            this._dispatchSelectionChange();
        }
    }

    /** updates the current selection  */
    updateSelection(){
        if (this.isSelection) {
            let onwb = {}
            this.elements.forEach(e => onwb[e.getId()] = true);
            let nonRemoved = this.selection.filter(e => e.getId() in onwb);
            if (nonRemoved.length > 0) {
                this.selectTransform.selection = nonRemoved;
            } else {
                this.clearSelection();
            }
        }
    }

    /* ~~~~~~~~~~~~~~~~~~ CREATION METHODS ~~~~~~~~~~~~~~~~~~~~
       These methods can be called by tools to create elements
       or selection boxes/transforms
      ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */

    /** Creates a select transform for the given element/s
     * @param {WhiteBoardElementBase[]|WhiteBoardElementBase} elements
     * @return {SelectTransform} */
    createSelection(elements) {
        if (this.isSelection) {
            this._selectionTransform.remove();
            this._selectionTransform = null;
        }
        if (!(Array.isArray(elements) && elements.length == 0)) {
            this._selectionTransform = this.selectionLayer.createChild(SelectTransform, {}, elements);
        }
        this._dispatchSelectionChange();
        return this.selectTransform;
    }

    /** Creates a selection box
     * @return {SelectionBox} */
    createSelectionBox(){
        return this.selectionLayer.createChild(SelectionBox);
    }

    /** Creates a whiteboard element specified by the name
     * @param {string} name
     * @return {WhiteBoardElementBase} */
    createElement(name, ...args) {
        let element = this.mainLayer.createChild(Elements[name], {}, this, ...args);
        return element;
    }

    /* ~~~~~~~~~~~~~~~~~~ SERIALISATION METHODS ~~~~~~~~~~~~~~~~~~~~ */

    serialise(){
        let json = {}
        for (let element of this.elements) {
            json[element.getId()] = element.serialise();
        }
        return json;
    }

    deserialise(json){
        this.mainLayer.innerHTML = "";
        for (let key in json) {
            let ejson = json[key];
            this.deserialiseElement(ejson, key)
        }
        this.reOrder();
    }

    deserialiseElement(json, id = null){
        let el = Elements[json.type].deserialise(this, json);
        if (id != null) {
            el.order = json.order;
            el.setId(id)
            this.mainLayer.appendChild(el);
            el._creationInitialised = true;
        }
        return el;
    }

    /* ~~~~~~~~~~~~~~~~~~~~~~ COMMANDS ~~~~~~~~~~~~~~~~~~~~~~~~ */

    /** Deletes the specified element/s
     * @param {WhiteBoardElementBase[]|WhiteBoardElementBase} element */
    deleteElement(element){
        if (this.disableCommands) return;

        let ts = (new Date()).getTime();
        if (Array.isArray(element)) {
            for (let s of element) {
                s.dispatchDeletionEvent(ts);
                s.remove()
            }
        } else {
            element.dispatchDeletionEvent(ts);
            element.remove();
        }

        this.updateSelection();
    }

    /** Deletes the selected elements */
    deleteSelection() {
        if (this.isSelection) {
            this.deleteElement([...this.selection]);
            this.clearSelection();
        }
    }

    /** Deletes all elements */
    deleteAll(){
        if (this.disableCommands) return;

        this.deleteElement([...this.mainLayer.children]);
        this.updateSelection();
    }

    /** Undo's the previous changes (if redo set true, then redo's instead) */
    undo(redo = false){
        if (this.disableCommands) return;

        let {index, data, times} = this.History
        // check that the redo/undo command can be performed given the current index
        if ((redo && index < times.length) || (!redo && index > 0)) {

            // Get the (20ms) timestamp at the history index
            let ts = times[index-(redo ? 0 : 1)];

            // Get the changes at that timestamp and get the reverse
            // change if the mode is undo
            let changes = redo ? data[ts] : data[ts].map(c => this.getReverseChange(c, ts));

            // Apply the changes, if any return a true reorder flag
            // reorder the elements
            let reorder = changes.map(c => this.applyChange(c, ts)).reduce((c1, c2) => c1||c2);
            if (reorder) this.reOrder()

            // Increment the history index accordingly
            this.History.index += redo ? 1 : -1;

            // Send changes to database listener
            changes.forEach(e => {
                let e2 = new ElementChangeEvent(e.elementId,
                    e.changeType,
                    e.data,
                    (new Date()).getTime(),
                    false);
                this.onElementChangeDB(e2);
            })
            this._dispatchHistoryChange();
        }

        this.updateSelection();
    }

    /** Redo's the undid changes */
    redo(){this.undo(true)}

    /** Changes the arrangement of the given element/s
     * @param {"top"|"up"|"down"|"bottom"} mode
     * @param {WhiteBoardElementBase[]|WhiteBoardElementBase} [elements] defaults to the selection */
    arrange(mode, elements = this.selection) {
        if (this.disableCommands) return;
        if (!Array.isArray(elements)) elements = [elements];
        elements = [...elements];
        if (elements.length == 0) return;

        let moveElement = (e, dir) => {
            let changes = new Set()
            let nsib = e[dir ? "nextSibling" : "previousSibling"];
            if (nsib) {
                nsib.order += dir ? -1 : 1;
                nsib[dir ? "after" : "before"](e)
                e.order += dir ? 1 : -1;
                changes.add(e);
                changes.add(nsib);
            }
            return changes;
        }
        let changes = new Set()
        switch (mode) {
            case "down":
            case "up":
                for (let el of elements) {
                    for (let c of moveElement(el, mode == "up")) changes.add(c);
                }
                break;

            case "bottom":
            case "top":
                elements.sort((a, b) => a.order - b.order);
                let eid = {}
                elements.forEach(e => eid[e.getId()] = true);
                let others = this.elements.filter(e => !(e.getId() in eid)).sort((a, b) => a.order - b.order);
                let all = mode == "top" ? [...others, ...elements] : [...elements, ...others];
                for (let i = 0; i < all.length; i++) all[i].order = i;
                changes = all;

        }
        this.reOrder();
        let ts = (new Date()).getTime();
        for (let e of changes) {
            e.dispatchOrderEvent(ts)
        }
        this.updateSelection()
    }

    /** Moves the element/s (default: selection) one step forward (in front) */
    moveForward(elements) {this.arrange("up", elements)}

    /** Moves the element/s (default: selection) one step backward (behind) */
    moveBackward(elements) {this.arrange("down", elements)}

    /** Moves the element/s (default: selection) in front of everything */
    moveToFront(elements) {this.arrange("top", elements)}

    /** Moves the element/s (default: selection) behind everything */
    moveToBack(elements) {this.arrange("bottom", elements)}

    copySelection(event) {
        if (this.disabled) return;
        let setClipboard = (json) => {
            let text = JSON.stringify(json);
            navigator.clipboard.writeText(text)
        }

        if (this.isSelection) {
            let st = this.selectTransform;
            let {pos, size} = st;
            if (pos instanceof Vector && size instanceof Vector) {
                let selection = [...this.selection];
                selection.sort((a, b) => a.order-b.order);
                let copyJSON = {
                    pos: [pos.x, pos.y],
                    size: [size.x, size.y],
                    elements: selection.map(e => e.serialise())
                }
                setClipboard(copyJSON);
            }
        }
    }

    cutSelection(event){
        if (this.disabled) return;

        this.copySelection(event);
        this.deleteElement(this.selection);
    }

    pasteSelection(event) {
        if (this.disabled) return;

        let text = event.clipboardData.getData("text/plain");

        let elements = []
        let pos = null;
        let size = null
        try {
            let json = JSON.parse(text);
            pos = new Vector(json.pos);
            size = new Vector(json.size);
            elements = json.elements.map(e => {
                return Elements[e.type].deserialise(this, e);
            });
        } catch (e) {console.log(e);}

        let ts = (new Date()).getTime();
        if (elements.length > 0) {
            let target = this.lastMousePosition || pos.add(size.div(2));
            let delta = target.sub(pos.add(size.div(2)))
            for (let e of elements) {
                e.setDragDelta(delta);
                e.fixTransformDelta();
                this.mainLayer.appendChild(e);
                e.dispatchCreationEvent(ts);
            }
        }

        if (!this._selectedTool.clearSelectionOnSelect()) {
            this.createSelection(elements);
        }
    }

    /* ~~~~~~~~~~~~~~~~~~ SCREENSHOT ~~~~~~~~~~~~~~~~~~~~ */

    async SVG2PNG(){
        // create image
        const {width, height} = this.svgView.getBoundingClientRect()
        let img = new Image(width, height);
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = Svg2DataURL(this.svgView.outerHTML);
        })

        // draw image in canvas
        const canvas = new SvgPlus("canvas");
        canvas.width = width*2;
        canvas.height = height*2;
        canvas.getContext("2d").drawImage(img, 0, 0, width*2, height*2);
        return canvas.toDataURL("image/png");
    }

    async SVG2SVG(){
        return Svg2DataURL(this.svgView.outerHTML);
    }

    /** Takes a screenshot of the visible board.
     * @param {Object} [options]
     * @param {"png"|"svg"} [options.mode="png"]
     * @param {boolean} [options.download=true] trigger a file download
     * @param {string} [options.filename]
     * @return {Promise<string>} the image as a data URL */
    async screenshot(options = {}) {
        if (typeof options === "string") options = {mode: options};
        let {mode = "png", download = true, filename = `whiteboard ${dateNice()}`} = options;
        mode = mode.toLowerCase() == "svg" ? "SVG" : "PNG";

        // convert textareas to svg text
        let textElements = this.elements.filter(e => e.isTextElement);
        textElements.forEach(e => e.capture = true);

        // make sure the embedded font is ready
        await this._fontReady;

        // prepare the svg
        const {width, height} = this.svgView.getBoundingClientRect()
        this.selectionLayer.styles = {display: "none"};
        this.svgView.props = {
            xmlns: "http://www.w3.org/2000/svg",
            width: width,
            height: height
        }

        let dataURL;
        try {
            dataURL = await this["SVG2" + mode]();

            if (download) {
                let link = this.root.appendChild(document.createElement("a"));
                link.href = dataURL;
                link.download = filename;
                link.click();
                link.remove();
            }
        } finally {
            // return svg to original state
            this.selectionLayer.styles = {display: null};
            textElements.forEach(e => e.capture = false);
        }
        return dataURL;
    }

    /** @deprecated use screenshot */
    screenShot(mode = "png") {
        return this.screenshot({mode});
    }

    /* ~~~~~~~~~~~~~~~~~~ DATABASE METHODS ~~~~~~~~~~~~~~~~~~~~ */

    /** Syncs the board with the given firebase frame, replacing any
     *  previous one. The board is cleared and then filled with the contents
     *  of the database. Pass null to stop syncing (the board's contents are
     *  kept, nothing is deleted from the database).
     * @param {FirebaseFrame|null} frame */
    setFirebaseFrame(frame) {
        if (this._sync) {
            this._sync.close();
            this._sync = null;
        }

        if (frame) {
            // the database is the source of truth
            this.clearSelection();
            this.mainLayer.innerHTML = "";
            this.History = {times: [], data: {}, index: 0};
            this.TheirHistory = {times: [], data: {}};
            this._dispatchHistoryChange();

            this._sync = new WhiteBoardSync(frame, this);
        }
    }

    async lockElement(e){
        return this._sync ? await this._sync.lockElement(e) : true;
    }

    releaseElement(e) {
        if (this._sync) this._sync.releaseElement(e);
    }

    async lockElements(elements){
        let isLocked = elements.map(e => this.lockElement(e));
        let locked = await Promise.all(isLocked);
        return elements.filter((e, i) => locked[i])
    }

    releaseElements(elements) {
        elements.map(e => this.releaseElement(e));
    }

    /** Called with every local change, sends it to the database if synced
     * @param {ElementChangeEvent} e */
    onElementChangeDB(e) {
        if (this._sync) this._sync.addChange(e);
    }

    /** Applies a change made elsewhere (e.g. by another user)
     * @param {ElementChangeEvent} change */
    pushChange(change) {
        let reorder = this.applyChange(change);
        if (reorder) this.reOrder();
        this.addTheirHistory(change);
    }

    /** Stops syncing, removes window listeners and removes the board from
     *  the page. */
    destroy() {
        this.setFirebaseFrame(null);
        if (this._removeKeyListeners) this._removeKeyListeners();
        this.remove();
    }

    /* ~~~~~~~~~~~~~~~~~~~~~~ PRIVATE ~~~~~~~~~~~~~~~~~~~~~~~~
       These methods should generally only be called by this class
       and should not be used by other tools.
      ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */

    _dispatch(name, detail) {
        this.dispatchEvent(new CustomEvent(name, {detail}));
    }

    _dispatchSelectionChange() {
        let st = this.selectTransform;
        let styleKeys = st ? [...st.styleKeys].filter(k => STYLE_KEYS.includes(k)) : [];
        this._dispatch("selectionchange", {
            selection: this.selection,
            styles: st ? combineStyles(st.styleSet) : {},
            styleKeys,
        });
    }

    _dispatchHistoryChange() {
        this._dispatch("historychange", {canUndo: this.canUndo, canRedo: this.canRedo});
    }

    /** Validates a style value, returns undefined if invalid */
    _normaliseStyle(key, value) {
        let warn = (msg) => {
            console.warn(`WhiteBoard: invalid value ${JSON.stringify(value)} for style "${key}". ${msg || ""}`);
            return undefined;
        }
        switch (key) {
            case "stroke":
            case "fill":
            case "text-color": {
                if (value === null || value === "none") value = "transparent";
                let c = parseColor(value);
                return c == null ? warn("Expected a CSS color.") : rgbString(c, c.a);
            }

            case "stroke-width":
            case "font-size": {
                let v = parseFloat(value);
                return Number.isNaN(v) || v < 0 ? warn("Expected a positive number.") : v;
            }

            case "marker-start":
            case "marker-end":
                if (value === false || value === null || value === undefined) return null;
                if (value in ARROW_HEAD_ALIASES) return ARROW_HEAD_ALIASES[value];
                return value in ARROW_HEADS ? value : warn(`Expected one of ${ARROW_HEAD_NAMES.join(", ")} or null.`);

            case "dash-style":
                return value in DASH_STYLES ? value : warn(`Expected one of ${DASH_STYLE_NAMES.join(", ")}.`);

            case "text-align":
                return TEXT_ALIGNS.includes(value) ? value : warn(`Expected one of ${TEXT_ALIGNS.join(", ")}.`);

            case "shape":
                return value in BasicShapes ? value : warn(`Expected one of ${SHAPE_NAMES.join(", ")}.`);

            default:
                return warn(`Unknown style. Known styles: ${STYLE_KEYS.join(", ")}.`);
        }
    }

    //  ~~~~~~~~~~~~~~~~~~~~~~ HISTORY METHODS ~~~~~~~~~~~~~~~~~~~~~~~~ //
    onElementChange(e) {
        if (!e.light) {
            let ts = Math.round(e.ts / 20) + ""; // timestamps in 20ms intervals
            let i = this.History.index;
            let {times, data} = this.History;

            while (times.length > i)
                delete data[times.pop()]

            if (!(ts in this.History.data)) {
                data[ts] = [e]
                times.push(ts);
                this.History.index += 1;
            } else {
                data[ts].push(e)
            }
            this._dispatchHistoryChange();
        }
        this.onElementChangeDB(e);
    }

    addTheirHistory(e) {
        let {times, data} = this.TheirHistory;
        let ts = Math.round(e.ts / 20) + ""; // timestamps in 20ms intervals
        // only push heavy changes
        if (!e.light) {
            if (!(ts in data)) {
                data[ts] = [e]
                times.push(ts);
            } else {
                data[ts].push(e)
            }
        }
    }

    reOrder(){
        let els = this.elements;
        els.sort((a, b) => a.order - b.order);
        els.forEach(e => this.mainLayer.appendChild(e));
    }

    getElementHistoryBefore(ts, id, H = this.History){
        let {data, times} = H;
        let changes = [];
        for (let i = times.length - 1; i >= 0; i--) {
            if (times[i] < ts) {
                for (let c of data[times[i]]) {
                    if (c.elementId == id) {
                        changes.push(c);
                    }
                }
            }
        }
        return changes;
    }

    getLastElementChange(ts, id, type) {
        let lastChange = null;
        for (let h of [this.History, this.TheirHistory]) {
            let elHistory = this.getElementHistoryBefore(ts, id, h);

            for (let c of elHistory) {
                if (type == c.changeType || c.changeType == "creation") {
                    lastChange = c;
                    break;
                }
            }
            if (lastChange != null) break;
        }

        if (lastChange != null && type !== "creation" && lastChange.changeType === "creation") {
            lastChange = new ElementChangeEvent(id, type, lastChange.data[type], lastChange.ts, lastChange.light)
        }
        return lastChange;
    }

    getReverseChange(change, ts) {
        let {changeType, elementId, data} = change;
        let rchange = {
            ts: (new Date()).getTime(),
            type: changeType,
            id: elementId,
            data: objectDeepCopy(data),
        }
        switch (changeType) {

            case "creation":
                rchange.type = "deletion"
                break;

            case "deletion":
                rchange.type = "creation";
                break;

            case "order":
            case "data":
            case "styleSet":
            case "trans":
                let lastChange = this.getLastElementChange(ts, elementId, changeType);
                if (lastChange == null) {
                    console.warn(`could find the reverse ${changeType} change`)
                } else {
                    rchange.data = objectDeepCopy(lastChange.data);
                }
                break;

        }
        return new ElementChangeEvent(rchange.id, rchange.type, rchange.data, rchange.ts, false);
    }

    revokeChange(change, ts) {
        let reverseChange = this.getReverseChange(change, ts);
        return this.applyChange(reverseChange);
    }

    applyChange(change) {
        let reOrderFlag = false
        let {changeType, elementId, data} = change;
        if (changeType !== "creation" && !this.getElement(elementId)) {
            console.warn(`element ${elementId} no longer exists to perform ${changeType} change`);
            return false;
        }
        switch (changeType) {

            case "creation":
                // check to see if the element already exists
                let element = this.getElement(elementId);
                // if so delete that version of the element
                if (element) element.remove();

                this.deserialiseElement(objectDeepCopy(data), elementId);
                reOrderFlag = true;
                break;

            case "deletion":
                this.getElement(elementId).remove();
                break;

            case "order":
                this.getElement(elementId).order = data.order;
                reOrderFlag = true;
                break;

            case "data":
            case "styleSet":
            case "trans":
                this.getElement(elementId)[changeType] = objectDeepCopy(data);
                break;

        }
        return reOrderFlag;
    }

    //  ~~~~~~~~~~~~~~~~~~~~~~ KEYS ~~~~~~~~~~~~~~~~~~~~~~~~ //
    addKeyListeners(){

        let text_mode = false;
        let text_element = null
        this.svgView.addEventListener("editText", async (e) => {
            text_mode = true;
            text_element = e.element;
            this.lockElement(e.element);
        })
        this.svgView.addEventListener("editTextDone", (e) => {
            text_mode = false;
            text_element = e.element;
            this.releaseElement(e.element);
        })

        let key_string = (e) => {
            let key_code = [e.key];
            if (e.ctrlKey || e.metaKey) key_code.unshift("cmd");
            if (e.shiftKey) key_code.unshift("shift")
            return key_code.join("-")
        }

        // Ignore key presses while the user is typing in an input outside the board
        let isTypingElsewhere = (e) => {
            let target = e.composedPath ? e.composedPath()[0] : e.target;
            if (!(target instanceof Element)) return false;
            if (this.root.contains(target)) return false;
            return target.tagName === "INPUT" || target.tagName === "TEXTAREA" ||
                target.tagName === "SELECT" || target.isContentEditable;
        }

        let keydown = (e) => {
            if (this.disabled || isTypingElsewhere(e) || !this.isConnected) return;
            e.keyString = key_string(e);

            if (!text_mode) {
                if (this._selectedTool["keydown"] instanceof Function) {
                    this._selectedTool["keydown"](e, this)
                }

                if (!e.defaultPrevented && this._hotkeys){
                    this.onKeyDown(e);
                }
            } else if (e.key == "Escape") {
                text_element.text.blur();
            }
        }

        let keyup = (e) => {
            if (this.disabled || isTypingElsewhere(e) || !this.isConnected) return;
            e.keyString = key_string(e);

            if (!text_mode) {
                if (this._selectedTool["keyup"] instanceof Function) {
                    this._selectedTool["keyup"](e, this)
                }

                if (!e.defaultPrevented && this._hotkeys) {
                    this.onKeyUp(e)
                }
            }
        }

        window.addEventListener("keydown", keydown);
        window.addEventListener("keyup", keyup);
        this._removeKeyListeners = () => {
            window.removeEventListener("keydown", keydown);
            window.removeEventListener("keyup", keyup);
        }
    }

    addClipboardListeners(){
        this.props = {events: {
            "copy": (e) => {this.copySelection(e)},
            "paste": (e) => {this.pasteSelection(e)},
            "cut": (e) => {this.cutSelection(e)},
            "mousemove": (e) => {this.lastMousePosition = this.screenToSVG(e)}
        }}
    }

    onKeyUp(e){

    }

    // HOT KEYS
    onKeyDown(e){
        const keycmds = {
            "shift-cmd-z": () => this.redo(),
            "cmd-y": () => this.redo(),
            "cmd-z": () => this.undo(),
            "p": () => this.setTool("draw"),
            "v": () => this.setTool("select"),
            "t": () => this.setTool("free-text"),
            "e": () => this.setTool("erasor"),
            "s": () => this.setTool("shape"),
            "b": () => this.setTool("textbox"),
        }

        if (e.keyString in keycmds) {
            keycmds[e.keyString](e)
            e.preventDefault();
        }
    }

    //  ~~~~~~~~~~~~~~~~~~~~~~ BUILD ~~~~~~~~~~~~~~~~~~~~~~~~ //
    async makeFontStyles(){
        this.svgStyles = this.defs.createChild("style", {
            type: "text/css",
            content: `@font-face {
                font-family: 'Anonymous Pro';
                src: url('${await getFontDataURL("Anonymous-Pro")}')
            }`
        })
    }

    makeArrowHeads() {
        for (let id in ARROW_HEADS) {
            this.defs.createChild("marker", {
                id: id,
                viewBox: "0 0 10 10",
                refX: 5,
                refY: 5,
                markerWidth: 4,
                markerHeight: 4,
                orient: "auto-start-reverse",
                content: ARROW_HEADS[id]
            })
        }
    }

    _build(){
        let main = new SvgPlus("main-board");
        this.root.appendChild(main);
        this.mainBoard = main;
        let svgView = main.createChild(SvgView);
        this.defs = svgView.createChild("defs");
        this._fontReady = this.makeFontStyles();
        this.makeArrowHeads();

        this.svgView = svgView;
        svgView.viewBoxX.onuserchange = () => this._dispatch("viewchange", {view: this.view});
        this.mainLayer = svgView.createChild("g", {
            events: {
                "e-change": (e) => this.onElementChange(e)
            }
        });
        this.tempLayer = svgView.createChild("g");
        this.selectionLayer = svgView.createChild("g");

        let events = {}
        for (let event in Events) {
            events[event] = (e) => {
                if (this._selectedTool && this._selectedTool[event] instanceof Function) {
                    this._selectedTool[event](e, this)
                }
            }
        }
        this.svgView.events = events;

        this.addKeyListeners();
        this.addClipboardListeners();
    }
}
