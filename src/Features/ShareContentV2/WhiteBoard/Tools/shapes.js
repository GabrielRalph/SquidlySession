import { SvgPlus, Vector } from "../../../../SvgPlus/4.js";
import { isEmojiShape } from "../Utilites/basic-shapes.js";

/** Emoji drags shorter than this (screen px) count as a click */
const EMOJI_CLICK_DISTANCE = 4;
/** Radius (screen px, half the width) of an emoji spawned by a click */
const EMOJI_CLICK_RADIUS = 40;

let start_pos = null;
let start_screen = null;
let currentShape = null;
let init = false;

/** Shapes whose drag changes their data (center / radius) rather than
 *  their transform. */
function usesDataForCoords(mode) {
    return mode == "triangle" || mode == "star" || isEmojiShape(mode);
}

/**
 * @param {WhiteBoard}
 */
export function mousedown(e, wb) {
    start_pos = wb.screenToSVG(e);
    start_screen = new Vector(e);
    wb.disableCommands = true;
    init = false;
    e.preventDefault();
}

export function mousemove(e, wb) {
    let end_pos = wb.screenToSVG(e);
    if (start_pos instanceof Vector) {
        if (currentShape == null) {
            let styleSet = wb.styleSet;
            // wait until an emoji is dragged far enough so a click spawns
            // a full size one instead of a tiny one
            if (isEmojiShape(styleSet.shape) && new Vector(e).dist(start_screen) < EMOJI_CLICK_DISTANCE) {
                return;
            }
            currentShape = wb.createElement("basic-shape", styleSet.shape);
            currentShape.styleSet = styleSet;
        }
        currentShape.coords = [start_pos, end_pos];
        if (!init) {
            init = true;
            currentShape.dispatchLightCreationEvent()
        } else {
            if (usesDataForCoords(currentShape.mode)) {
                currentShape.dispatchLightDataChange();
            } else {
                currentShape.dispatchLightTransformChange();
            }
        }
        e.preventDefault();
    }
}

/** Creates an upright emoji of a reasonable size centered at the click. */
function spawnEmoji(e, wb) {
    let styleSet = wb.styleSet;
    let radius = wb.screenToSVG(new Vector(e).add(0, EMOJI_CLICK_RADIUS)).sub(start_pos);
    let shape = wb.createElement("basic-shape", styleSet.shape);
    shape.styleSet = styleSet;
    shape.coords = [start_pos, start_pos.add(radius)];
    shape.dispatchCreationEvent();
}

function release(e, wb, isClick = false){
    wb.disableCommands = false;
    if (currentShape != null) {
        currentShape.dispatchCreationEvent();
    } else if (isClick && start_pos instanceof Vector && isEmojiShape(wb.styleSet.shape)) {
        spawnEmoji(e, wb);
    }
    start_pos = null;
    start_screen = null;
    currentShape = null;
}
export function mouseleave(e, wb){release(e, wb)}
export function mouseup(e, wb){release(e, wb, true)}


/**
 * @param {WhiteBoard} wb
 * @param {{shape?: string}} [options] optionally pick the shape to draw
 */
export function onSelect(wb, options){
    if (options && typeof options.shape === "string") {
        wb.setShape(options.shape);
    }
    wb.cursor = "crosshair";
    wb.isZoomLocked = false;
    wb.isPanLocked = true;
    wb.readOnly = true;
}

export function getName(){
    return "shape"
}

export function getIcon(){
    let icon = new SvgPlus("svg")
    icon.innerHTML = `<path d="M80.61,34.24h-19.22c-2.26-11.71-12.32-20.56-24.36-20.56-13.69,0-24.84,11.46-24.84,25.55,0,13.21,9.79,24.11,22.3,25.42v17.18c0,2.49,2.01,4.5,4.5,4.5h41.62c2.49,0,4.5-2.01,4.5-4.5v-43.09c0-2.49-2.01-4.5-4.5-4.5ZM34.49,38.74v16.81c-7.53-1.28-13.3-8.1-13.3-16.32,0-9.13,7.1-16.55,15.84-16.55,7.07,0,13.07,4.87,15.1,11.56h-13.14c-2.49,0-4.5,2.01-4.5,4.5Z"/>`

    icon.props = {
        viewBox: "0 0 100 100"
    }

    return icon;
}
