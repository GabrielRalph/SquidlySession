import { GridLayout } from "../../Utilities/GridLayout/grid-icons.js";
import { ColorPickerGroup } from "./gl-colorpicker.js";
import { EMOJI_SHAPES } from "./WhiteBoard/Utilites/basic-shapes.js";
import HINT_TEXT from "./hint-text.js";
class SelectionGroups extends GridLayout {
    #values = {}
    selectionGroups = {}

    toIndex = {}
    fromIndex = {}

    bestOp(value, array) {
        let dist = array.map((val, i) => [Math.abs(val - value), i]);
        dist.sort((a, b) => a[0] - b[0]);
        return dist[0][1];
    }

    /** Selects an option in a group. A "change" event is only dispatched
     *  when the selection was made by the user (an event is passed). */
    select(group, value, event) {
        let cats = this.selectionGroups[group];
        cats.forEach((cat, i) => {
            cat.highlight = (i === value);
            cat.toggleAttribute("selected", i === value);
        });
        this.#values[group] = value;
        if (event) {
            this.dispatchEvent(new CustomEvent("change", {detail: {group, value: this.value}}));
        }
    }

    evm(key, value) {
        return {events: {"access-click": (e) => this.select(key, value, e)}}
    }

    get value() {
        return Object.fromEntries(
            Object.entries(this.#values).map(([k, v]) => [k, k in this.fromIndex ? this.fromIndex[k](v) : v])
        );
    }

    set value(value) {
        for (let key in this.selectionGroups) {
            let v = 0;
            if (key in value) {
                v = value[key];
                v = key in this.toIndex ? this.toIndex[key](v) : v;
            }
            this.select(key, v);
        }
    }
}


class StrokeStylePicker extends SelectionGroups {
    toIndex = {
        stroke: (v) => this.bestOp(v, StrokeStylePicker.STROKE_VALUES),
        arrowStart: (v) => Math.max(0, StrokeStylePicker.ARROW_VALUES.indexOf(v)),
        arrowEnd: (v) => Math.max(0, StrokeStylePicker.ARROW_VALUES.indexOf(v)),
    }
    fromIndex = {
        stroke: (i) => StrokeStylePicker.STROKE_VALUES[i],
        arrowStart: (i) => StrokeStylePicker.ARROW_VALUES[i] || null,
        arrowEnd: (i) => StrokeStylePicker.ARROW_VALUES[i] || null,
    }
   
    constructor() {
        super(5, 5);
        this.selectionGroups = {
            stroke: this.addGridIcons(
                new Array(5).fill(0).map((_,i) => ({
                    symbol: `stroke${i+1}`,
                    colorTheme: "dark-s",
                    ...this.evm("stroke", i)
                })),
            0, 0).flat(),
            arrowStart: this.addGridIcons(
                new Array(4).fill(0).map((_,i) => [{
                    symbol: `arrow-${i}-start`,
                    colorTheme: "dark-a",
                    ...this.evm("arrowStart", i)
                }]),
            1, 3).flat(),
            arrowEnd: this.addGridIcons(
                new Array(4).fill(0).map((_,i) => [{
                    symbol: `arrow-${i}-end`,
                    colorTheme: "dark-a",
                    ...this.evm("arrowEnd", i)
                }]),
            1, 4).flat()
        }
        this.value = {stroke: 4}
    }

    static get STROKE_VALUES() {
        return [1, 3, 6, 10, 22];
    }

    /** Whiteboard arrow head names, in the order of the arrow-<i> icons */
    static get ARROW_VALUES() {
        return [null, "arrow3", "arrow2", "arrow1"];
    }
}

/** Icon props that make `target` dispatch an "action" event with {action}
 *  as detail when the icon is clicked */
function actionIcon(target, action, props) {
    return {
        ...props,
        events: {
            "access-click": (e) => target.dispatchEvent(new CustomEvent("action", {detail: {action, event: e}}))
        }
    }
}

class MoreOptions extends GridLayout {
    constructor() {
        super(4, 1);
        this.eraser = this.addGridIcons(
            ["eraser", "undo", "redo", "camera"].map(action => {
                const i = actionIcon(this, action, {symbol: action, colorTheme: "starter"});
                let capitalizedAction = action.charAt(0).toUpperCase() + action.slice(1);
                i.props = {hint: HINT_TEXT[capitalizedAction], "hint-position": "left"};
                return [i]
            })
        )[0][0];
    }
}

class TextOptions extends SelectionGroups {
    toIndex = {
        align: (v) => {
            if (typeof v !== "number") {
                v = TextOptions.ALIGN_VALUES.indexOf(v);
                v = v < 0 ? 0 : v;
            }
            return v;
        },
        fontSize: (v) => this.bestOp(v, TextOptions.FONT_SIZE_VALUES)

    }
    fromIndex = {
        align: (v) => TextOptions.ALIGN_VALUES[v] || TextOptions.ALIGN_VALUES[0],
        fontSize: (v) => TextOptions.FONT_SIZE_VALUES[v] || TextOptions.FONT_SIZE_VALUES[0]
    }


    constructor() {
        super(5, 4);
        this.selectionGroups = {
            mode: this.addGridIcons([
                {
                    symbol: "font-size-3",
                    colorTheme: "text-tool-op",
                    ...this.evm("mode", 0)
                },
                {
                    symbol: "textbox",
                    colorTheme: "text-tool-op",
                    ...this.evm("mode", 1)
                }
            ], 0, 0).flat(),
            align: this.addGridIcons(
                TextOptions.ALIGN_VALUES.map((m,i) => 
                    [{
                        symbol: "align-"+m,
                        colorTheme: "dark-s",
                        ...this.evm("align", i)
                    }]
                )
            , 0, 2).flat(),

            fontSize: this.addGridIcons(
                TextOptions.FONT_SIZE_VALUES.map((_,i) => 
                    [{
                        symbol: "font-size-"+i,
                        colorTheme: "dark-a",
                        ...this.evm("fontSize", i)
                    }]
                )
            , 0, 3).flat()
        }
        this.value = {fontSize: 18}
    }


    static get ALIGN_VALUES() {
        return ["left", "center", "right"]
    }

    static get FONT_SIZE_VALUES() {
        return [14, 18, 25, 32, 46]
    }
}

class ShapeOptions extends SelectionGroups {
    toIndex = {
        shape: (v) => {
            if (typeof v !== "number") {
                v = ShapeOptions.SHAPE_VALUES.indexOf(v);
                v = v < 0 ? 0 : v;
            }
            return v;
        }
    }
    fromIndex = {
        shape: (v) => ShapeOptions.SHAPE_VALUES[v] || ShapeOptions.SHAPE_VALUES[0]
    }
    constructor() {
        super(2, 6);
        const values = ShapeOptions.SHAPE_VALUES;
        const icon = (shape) => ({
            symbol: shape in EMOJI_SHAPES ? {url: EMOJI_SHAPES[shape]} : shape,
            colorTheme: "shapes-op",
            ...this.evm("shape", values.indexOf(shape))
        });
        // shapes on the first row, emoji on the second
        this.selectionGroups = {
            shape: this.addGridIcons([
                ShapeOptions.BASIC_SHAPES.map(icon),
                ShapeOptions.EMOJI.map(icon),
            ], 0, 0).flat()
        }
        this.value = {};
    }

    static get BASIC_SHAPES() {
        return ["ellipse", "rectangle", "triangle", "star", "line", "elbow"]
    }

    static get EMOJI() {
        return Object.keys(EMOJI_SHAPES);
    }

    static get SHAPE_VALUES() {
        return [...ShapeOptions.BASIC_SHAPES, ...ShapeOptions.EMOJI]
    }
}

class ArrangeOptions extends GridLayout {
    constructor() {
        super(1, 4);
        this.addGridIcons(["bottom", "down", "up", "top"].map((m, i) =>
            actionIcon(this, "arrange-" + m, {
                symbol: "arrange-"+m,
                colorTheme: "dark-s",
            })
        ))
    }
}

class WhiteBoardTools {
    #currentTool = null;
    #lastMenu = null;
    constructor(GL) {
        const tools = new GL(1,8) 
        tools.class = "dynamic"
        const tls = {};
        [
            tls.select, 
            tls.pen, 
            tls.shapes, 
            tls.text, 
            tls.colors, 
            tls.strokeWidth, 
            tls.trash, 
            tls.more
        ] = tools.addGridIcons([
            {
                symbol: "select",
                colorTheme: "select-tool",
                events: {
                    "access-click": (e) => {
                        this.selectTool("select", e)
                        this.openMenu("select", e)
                    }
                },
                props: {hint: HINT_TEXT.Select}
                
            },
            {
                symbol: "pen",
                colorTheme: "pen-tool",
                events: {
                    "access-click": (e) => this.selectTool("pen", e)
                },
                props: {hint: HINT_TEXT.Pen}
            },
            {
                // type: "folder",
                symbol: "shapes",
                colorTheme: "shapes",
                events: {
                    "access-click": (e) => {
                        this.selectTool("shapes", e)
                        this.openMenu("shapes", e)
                    }
                },
                props: {hint: HINT_TEXT.Shapes}
            },
            {
                symbol: "textbox",
                colorTheme: "text-tool",
                events: {
                    "access-click": (e) => {
                        this.selectTool("text", e)
                        this.openMenu("text", e)
                    }
                },
                props: {hint: HINT_TEXT.Text}
            },
            
            {
                symbol: "colors",
                colorTheme: "dark",
                type: "folder",
                events: {
                    "access-click": (e) => this.openMenu("colors", e)
                },
                props: {hint: HINT_TEXT.Colours}
            },

            {
                symbol: "stroke-width",
                colorTheme: "dark",
                type: "folder",
                events: {
                    "access-click": (e) => this.openMenu("stroke-width", e)
                },
                props: {hint: HINT_TEXT.LineStyle, "hint-position": "bottom-left"}
            },
            {
                symbol: "delete",
                colorTheme: "action",
                events: {
                    "access-click": () => {
                        this.whiteboard?.clearSelection();
                        this.whiteboard?.deleteAll();
                    }
                },
                props: {hint: HINT_TEXT.ClearAll, "hint-position": "bottom-left"}
            },
            {
                symbol: "more",
                colorTheme: "action",
                type: "folder",
                events: {
                    "access-click": (e) => this.openMenu("more", e)
                },
                props: {hint: HINT_TEXT.MoreTools, "hint-position": "bottom-left"}
            }   
        ])
        this.tls = tls;
        this.tools = tools;

        const options = new GL(7, 8)
        options.class = "dynamic-options";
        this.options = options;

        this.colorPicker = new ColorPickerGroup();
        this.colorPicker.addEventListener("change", () => this.updateColorStyles());
        this.updateColorStyles();

        this.strokePicker = new StrokeStylePicker();
        this.moreOptions = new MoreOptions();
        this.textOptions = new TextOptions();
        this.shapeOptions = new ShapeOptions();
        this.arrangeOptions = new ArrangeOptions();

    }

    /** Selects a tool ("select", "pen", "shapes", "text", "eraser" or null)
     *  and, if connected, sets the matching tool on the whiteboard. */
    selectTool(tool) {
        this.#highlightTool(tool);
        if (tool == "pen") {
            this.openMenu(null);
        }
        this.#applyTool();
    }

    #highlightTool(tool) {
        this.tls.select.highlight = tool == "select";
        this.tls.pen.highlight = tool == "pen";
        this.tls.shapes.highlight = tool == "shapes";
        this.tls.text.highlight = tool == "text";
        this.moreOptions.eraser.highlight = tool == "eraser";
        this.#currentTool = tool;
    }

    #applyTool() {
        const wb = this.whiteboard;
        if (!wb) return;
        const tool = this.selectedTool || "pan";
        const options = tool === "shape" ? {shape: this.shapeOptions.value.shape} : undefined;
        if (wb.tool !== tool || options) wb.setTool(tool, options);
    }

    /** Connects the tools to a WhiteBoard so that tool, style and action
     *  selections are applied to it, and the tools reflect its selection.
     * @param {import("./WhiteBoard/whiteboard.js").WhiteBoard} whiteboard */
    connect(whiteboard) {
        this.whiteboard = whiteboard;
        const wb = whiteboard;

        // styles
        this.colorPicker.addEventListener("change", () => wb.setStyles(this.colorStyles));
        this.strokePicker.addEventListener("change", () => wb.setStyles(this.strokeStyles));
        this.textOptions.addEventListener("change", (e) => {
            if (e.detail.group === "mode") this.#applyTool();
            else wb.setStyles(this.textStyles);
        });
        this.shapeOptions.addEventListener("change", () => this.selectTool("shapes"));

        // actions
        this.moreOptions.addEventListener("action", (e) => {
            switch (e.detail.action) {
                case "eraser": this.selectTool(this.#currentTool === "eraser" ? null : "eraser"); break;
                case "undo": wb.undo(); break;
                case "redo": wb.redo(); break;
                case "camera": wb.screenshot(); break;
            }
        });
        this.arrangeOptions.addEventListener("action", (e) => {
            wb.arrange(e.detail.action.replace("arrange-", ""));
        });

        // whiteboard -> tools
        wb.addEventListener("toolchange", (e) => {
            const tool = WB_TOOL_TO_UI[e.detail.tool] ?? null;
            if (tool !== this.#currentTool) this.#highlightTool(tool);
        });
        wb.addEventListener("selectionchange", (e) => {
            const {styles, styleKeys} = e.detail;
            if (styleKeys.length > 0) this.#showStyles(styles);

            // show / hide the arrange options with the selection, unless
            // another menu is open
            const menu = this.#lastMenu;
            if (menu === "select" || (menu === null && this.#currentTool === "select")) {
                this.#renderMenu("select");
            }
        });
        wb.addEventListener("textedit", (e) => this.#showStyles(e.detail.styles));

        wb.setStyles(this.styles);
        this.#applyTool();
    }

    /** Updates the pickers to show the given whiteboard styles (no events) */
    #showStyles(styles) {
        const colors = {...this.colorPicker.value};
        if ("fill" in styles) colors.fill = styles.fill;
        if ("stroke" in styles) colors.stroke = styles.stroke;
        if ("text-color" in styles) colors.text = styles["text-color"];
        this.colorPicker.value = colors;
        this.updateColorStyles();

        const stroke = this.strokePicker.value;
        if ("stroke-width" in styles) stroke.stroke = styles["stroke-width"];
        if ("marker-start" in styles) stroke.arrowStart = styles["marker-start"];
        if ("marker-end" in styles) stroke.arrowEnd = styles["marker-end"];
        this.strokePicker.value = stroke;

        const text = this.textOptions.value;
        if ("font-size" in styles) text.fontSize = styles["font-size"];
        if ("text-align" in styles) text.align = styles["text-align"];
        this.textOptions.value = text;
    }

    /** Opens a menu, or closes it if it is already open.
     * @param {?string} menu */
    openMenu(menu) {
        if (this.#lastMenu === menu) {
            menu = null;
        }
        this.#renderMenu(menu);
    }

    /** True when an element on the whiteboard is selected */
    get hasSelection() {
        return (this.whiteboard?.selection.length ?? 0) > 0;
    }

    /** Shows the given menu in the options area. The "select" menu (the
     *  arrange options) is only visible while something is selected.
     * @param {?string} menu */
    #renderMenu(menu) {
        this.tls.colors.highlight = menu == "colors";
        this.tls.strokeWidth.highlight = menu == "stroke-width";
        this.tls.more.highlight = menu == "more";
        this.options.innerHTML = "";
        switch (menu) {
            case "colors":
                this.options.add(this.colorPicker, [0, 4], [2, 7])
                break;
            case "stroke-width":
                // Implement logic to open stroke-width menu
                this.options.add(this.strokePicker, [0, 4], [3, 7])
                break;
            case "more":
                // Implement logic to open more menu
                this.options.add(this.moreOptions, [0, this.moreOptions.size[0]-1], [7 - this.moreOptions.size[1] + 1, 7])
                break;
            case "text": 
                // Implement logic to open text menu
                this.options.add(this.textOptions, [0, this.textOptions.size[0]-1], [7 - this.textOptions.size[1] + 1, 7])
                break;
            case "shapes":
                // Implement logic to open shapes menu
                this.options.add(this.shapeOptions, [0, this.shapeOptions.size[0]-1], [7 - this.shapeOptions.size[1] + 1, 7])
                break;
            case "select":
                if (this.hasSelection) this.options.add(this.arrangeOptions, [0, this.arrangeOptions.size[0]-1], [0, this.arrangeOptions.size[1]-1])
                break;
            
        }
        this.#lastMenu = menu;
    }

    updateColorStyles() {
        const {fill, stroke, text} = this.colorPicker.value;
        this.tls.colors.styles = {
            "--icon-color": stroke,
            "--icon-color-hover": stroke,
            "--i-color-1": fill,
            "--i-color-2": text,
            "--i-color-3": "white"
        }
    }

    /** Color styles in the whiteboard's format */
    get colorStyles() {
        const {fill, stroke, text} = this.colorPicker.value;
        return {fill, stroke, "text-color": text};
    }

    /** Stroke styles in the whiteboard's format */
    get strokeStyles() {
        const {stroke, arrowStart, arrowEnd} = this.strokePicker.value;
        return {"stroke-width": stroke, "marker-start": arrowStart, "marker-end": arrowEnd};
    }

    /** Text styles in the whiteboard's format */
    get textStyles() {
        const {fontSize, align} = this.textOptions.value;
        // the whiteboard does not support justify
        return {"font-size": fontSize, "text-align": align === "justify" ? "left" : align};
    }

    /** All styles in the whiteboard's format (see WhiteBoard.setStyles) */
    get styles() {
        const styles = {...this.colorStyles, ...this.strokeStyles, ...this.textStyles};
        const {shape} = this.shapeOptions.value;
        if (shape !== "line" && shape !== "elbow") styles.shape = shape;
        return styles;
    }

    /** The whiteboard tool name for the current selection, or null */
    get selectedTool() {
        let tool = this.#currentTool;
        if (tool === "text") {
            tool = this.textOptions.value.mode == 0 ? "free-text" : "textbox";
        } else if (tool === "shapes") {
            const {shape} = this.shapeOptions.value;
            if (shape === "line") tool = "line";
            else if (shape === "elbow") tool = "elbow-path";
            else tool = "shape";
        } else if (tool === "pen") {
            tool = "draw";
        } else if (tool === "eraser") {
            tool = "erasor";
        }
        return tool;
    }
}

/** Maps whiteboard tool names to the toolbar's tools */
const WB_TOOL_TO_UI = {
    "select": "select",
    "draw": "pen",
    "shape": "shapes",
    "line": "shapes",
    "elbow-path": "shapes",
    "free-text": "text",
    "textbox": "text",
    "erasor": "eraser",
}


export {WhiteBoardTools}
