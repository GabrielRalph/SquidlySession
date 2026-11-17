import { SvgPlus } from "../../../../SvgPlus/4.js";
import { toCursor } from "../Utilites/basic-funcs.js";

export function drawIcon(color = "black") {
    return  `<svg xmlns = "http://www.w3.org/2000/svg" height = "14.84" width = "20" viewBox="0 0 10 7.42">
    <path  d="m2.57,3.55s7,4.47,7.41,3.79S4.02,1.8,4.02,1.8c-.15.96-.69,1.53-1.45,1.75Z"/>
    <path  fill = "${color}" d="m3.18,2.59c.58-.82.41-1.78-.21-2.26s-1.74.05-2.97-.33c0,0,.04,1.57.73,2.46.55.71,1.88.93,2.45.13Z"/>
    </svg>`
}

export function drawCursor(color = "black"){
   return toCursor(drawIcon(color))
}


let currentPath = null
let init = false;
export function styleChange(changes, wb) {
    wb.cursor = drawCursor(wb.styleSet.stroke);
}


export function mousedown(e, wb) {
    let start_pos = wb.screenToSVG(e);
    currentPath = wb.createElement("pen-path")
    currentPath.addPoint(start_pos);
    currentPath.styleSet = wb.styleSet;
    init = false;
    e.preventDefault();
}

export function mousemove(e, wb) {
    if (currentPath) {
        let end_pos = wb.screenToSVG(e);
        currentPath.addPoint(end_pos)
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
    if (currentPath != null) {
        currentPath.endPath()
        currentPath = null;
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
    wb.cursor = drawCursor(wb.styleSet.stroke);
    wb.isZoomLocked = false;
    wb.isPanLocked = true;
    wb.readOnly = true;
}


export function getName(){
    return "draw"
}

export function getIcon(){
    let i = new SvgPlus("svg");
    i.innerHTML = `<path  d="m2.57,3.55s7,4.47,7.41,3.79S4.02,1.8,4.02,1.8c-.15.96-.69,1.53-1.45,1.75Z"/>
    <path   d="m3.18,2.59c.58-.82.41-1.78-.21-2.26s-1.74.05-2.97-.33c0,0,.04,1.57.73,2.46.55.71,1.88.93,2.45.13Z"/>`
    i.props = {
        viewBox: "0 0 10 7.42"
    }
    return i;
}
