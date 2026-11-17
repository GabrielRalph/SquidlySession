import { SvgPlus, Vector } from "../../../../SvgPlus/4.js";

let start_pos = null;
let currentShape = null;
let init = false;
/**
 * @param {WhiteBoard} 
 */
export function mousedown(e, wb) {
    start_pos = wb.screenToSVG(e);
    wb.disableCommands = true;
    init = false;
    e.preventDefault();
}

export function mousemove(e, wb) {
    let end_pos = wb.screenToSVG(e);
    if (start_pos instanceof Vector) {
        if (currentShape == null) {
            let styleSet = wb.styleSet;
            currentShape = wb.createElement("basic-shape", styleSet.shape);
            currentShape.styleSet = styleSet;
        }
        currentShape.coords = [start_pos, end_pos];
        if (!init) {
            init = true;
            currentShape.dispatchLightCreationEvent()
        } else {
            if (currentShape.mode == "triangle" || currentShape.mode == "star") {
                currentShape.dispatchLightDataChange();
            } else {
                currentShape.dispatchLightTransformChange();
            }
        }
        e.preventDefault();
    }
}

function release(e, wb){
    wb.disableCommands = false;
    if (currentShape != null) {
        currentShape.dispatchCreationEvent();
    }
    start_pos = null;
    currentShape = null;
}
export function mouseleave(e, wb){release(e, wb)}
export function mouseup(e, wb){release(e, wb)}


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