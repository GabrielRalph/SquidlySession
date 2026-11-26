import { SvgPlus, Vector } from "../../../../SvgPlus/4.js";

let start_pos = null;
let currentBox = null;

/**
 * @param {WhiteBoard} wb
 */
export function editText(e, wb) {
    currentBox = e.element;
}

/**
 * @param {WhiteBoard} 
 */
let init = false;
export function mousedown(e, wb) {
    let v = wb.screenToSVG(e);
    let els = wb.elements.filter(s => s.isInBBox(v) && s.isTextElement);  
    if (els.length == 0) {
        start_pos = v;
        currentBox = null;
        wb.disableCommands = true;
        init = false;
        e.preventDefault();
    }
}

export function styleChange(changes, wb) {
    // apply the changed styles to the text box last being edited/created
    if (currentBox && currentBox.isConnected) {
        let sset = {...currentBox.styleSet};
        let changed = false;
        for (let key of currentBox.observedStyles) {
            if (key in changes) {
                sset[key] = changes[key];
                changed = true;
            }
        }
        if (changed) currentBox.applyStyleSet(sset);
    }
}

export function mousemove(e, wb) {
    let end_pos = wb.screenToSVG(e);
    if (start_pos instanceof Vector) {
        e.preventDefault();
        if (currentBox == null) {
            currentBox = wb.createElement("text-box");
            currentBox.styleSet = wb.styleSet;

        }
        currentBox.coords = [start_pos, end_pos];
        if (!init) {
            init = true;
            currentBox.dispatchLightCreationEvent()
        } else {
            currentBox.dispatchLightTransformChange();
        }
    }
}

export function release(e, wb){
    wb.disableCommands = false;
    if (currentBox && start_pos instanceof Vector) {
        currentBox.dispatchCreationEvent();
        currentBox.focusOn();
        e.preventDefault();

    }
    start_pos = null;
}
export function mouseup(e, wb){
    release(e, wb)
}
export function mouseleave(e, wb){
    release(e, wb)
}

export function onSelect(wb){
    wb.cursor = "cell";
    wb.isZoomLocked = false;
    wb.isPanLocked = true;
    wb.readOnly = false;
}

export function onDeselect(wb) {
    currentBox = null;
}

export function getName(){
    return "textbox"
}

export function getIcon(){
    let i = new SvgPlus("svg");
    i.innerHTML = `<polygon points="49.69 75.11 66.34 75.11 66.34 70.2 56.92 68.14 56.92 33.39 66.63 33.39 69.58 39.11 75.01 39.11 75.02 24.89 49.69 24.89 27.14 24.89 27.15 39.11 32.58 39.11 35.53 33.39 45.25 33.39 45.24 68.14 35.82 70.2 35.82 75.11 49.69 75.11"/>
    <path d="M91.58,18.79v-10.7h-10.7v3.35H21.28v-3.35h-10.7v10.7h3.35v62.43h-3.35v10.7h10.7v-3.35h59.6v3.35h10.7v-10.7h-3.35V18.79h3.35ZM84.23,81.21h-3.35v3.35H21.28v-3.35h-3.35V18.79h3.35v-3.35h59.6v3.35h3.35v62.43Z"/>`
    i.props = {viewBox: "0 0 100 100"}
    return i;
}