import { SvgPlus } from "../../../../SvgPlus/4.js";
import { toCursor } from "../Utilites/basic-funcs.js";
// import { PenPath } from "../Shapes/whiteboard-shapes.js";

let currentPath = null

let init = false;
export function mousedown(e, wb) {
    let start_pos = wb.screenToSVG(e);
    currentPath = wb.createElement("elbow-path")
    currentPath.addAnchorPoint(start_pos);
    currentPath.styleSet = wb.styleSet;
    init = false;
    e.preventDefault();
}

let lastPoint = null;
export function mousemove(e, wb) {
    let pos = wb.screenToSVG(e);
    lastPoint = pos;
    if (currentPath) {
        currentPath.addPoint(pos, isShift)
        if (!init) {
            init = true;
            currentPath.dispatchLightCreationEvent()
        } else {
            currentPath.dispatchLightDataChange();
        }
        e.preventDefault();
    }
}


function release(e, wb){
    let end_pos = wb.screenToSVG(e);
    if (currentPath != null) {
        try {
            currentPath.addAnchorPoint(end_pos);
        } catch(e){}
        if (currentPath.length > 0) {
            currentPath.endPath()
            currentPath = null;
        } else {
            currentPath.remove();
        }
        e.preventDefault()
    }
}

export function mouseup(e, wb){
   release(e, wb)
}

export function mouseleave(e, wb){
    release(e, wb)
}

export function onSelect(wb){
    wb.cursor = "crosshair"
    wb.isZoomLocked = false;
    wb.isPanLocked = true;
    wb.readOnly = true;
}

let anchorAdded = false;
let isShift = false;
export function keydown(e, wb) {
    isShift = e.shiftKey
    if (!anchorAdded && currentPath != null && e.key == " " && lastPoint != null) {
        anchorAdded = true;
        currentPath.addAnchorPoint(lastPoint, true);
        e.preventDefault();
    }
}
export function keyup(e){
    isShift = e.shiftKey
    if (e.key == " ") anchorAdded = false;
}

export function getName(){
    return "elbow-path"
}

export function getIcon(){
    let i = new SvgPlus("svg");
    i.innerHTML = `<path d="M18.04,83.79c-2.49,0-4.5-2.01-4.5-4.5s2.01-4.5,4.5-4.5c28.67,0,29-10.84,29.46-25.85.44-14.58,1-32.72,34.46-32.72,2.49,0,4.5,2.01,4.5,4.5s-2.01,4.5-4.5,4.5c-24.74,0-25.03,9.55-25.47,24-.44,14.59-1.05,34.58-38.45,34.58Z"/>`
    i.props = {
        viewBox: "0 0 100 100"
    }
    return i;
}
