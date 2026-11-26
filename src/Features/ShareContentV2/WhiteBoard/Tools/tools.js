import * as pan from "./pan.js";
import * as select from "./select.js";
import * as draw from "./draw.js";
import * as shapes from "./shapes.js";
import * as line from "./line.js";
import * as elbowPath from "./elbow-path.js";
import * as textbox from "./textbox.js";
import * as freeText from "./free-text.js";
import * as erasor from "./erasor.js";

/**
 * Tool registry.
 *
 * A tool is a module that reacts to user input on the drawing area. Every
 * tool may export any of the following:
 *
 *   getName()                 (required) the tool's key, e.g. "draw"
 *   getIcon()                 an SvgPlus <svg> icon, useful for building a toolbar
 *   onSelect(wb, options)     called when the tool becomes active
 *   onDeselect(wb)            called when another tool becomes active
 *   clearSelectionOnSelect()  return false to keep the current selection on select
 *   styleChange(changes, wb)  called after WhiteBoard.setStyles(changes)
 *   mousedown/mousemove/mouseup/mouseleave/click/dblclick(e, wb)
 *   editText/editTextDone(e, wb)
 *   keydown/keyup(e, wb)
 */
const Interface = {
    "getName": {
        type: "function",
        required: true,
    },

    "getIcon": {
        type: "function",
        required: false,
        default: () => () => null
    },

    "onSelect": {
        type: "function",
        required: false,
        default: () => () => {}
    },

    "onDeselect": {
        type: "function",
        required: false,
        default: () => () => {}
    },
    "clearSelectionOnSelect": {
        type: "function",
        required: false,
        default: () => () => true
    }
}

const toolModules = [
    pan,
    select,
    draw,
    shapes,
    line,
    elbowPath,
    textbox,
    freeText,
    erasor,
]

/** Wraps a tool module, filling in defaults for optional interface functions.
 *  Returns null if a required function is missing. */
function makeTool(toolModule){
    let toolModuleProxy = {};
    for (let key in Interface) {
        let prop = Interface[key];
        let value = toolModule[key];
        if (typeof value !== prop.type) {
            if (prop.required) {
                console.warn(`A tool module does not have the required ${prop.type} ${key} specified in the interface.`, toolModule)
                return null;
            } else if (prop.default instanceof Function) {
                value = prop.default()
            }
        }
        toolModuleProxy[key] = value;
    }
    for (let key in toolModule) {
        if (!(key in Interface)) {
            toolModuleProxy[key] = toolModule[key]
        }
    }
    return toolModuleProxy;
}

/** Tools keyed by name, in the order of toolModules */
const Tools = {};
for (let toolModule of toolModules) {
    let tool = makeTool(toolModule);
    if (tool) Tools[tool.getName()] = tool;
}

export {Tools}
