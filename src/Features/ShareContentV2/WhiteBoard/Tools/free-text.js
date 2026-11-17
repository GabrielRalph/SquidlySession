import { SvgPlus, Vector } from "../../../../SvgPlus/4.js";

let currentBox = null;


/**
 * @param {WhiteBoard} wb
 */
export function editText(e, wb) {
    currentBox = e.element;
}

export function click(e, wb) {
    let v = wb.screenToSVG(e);
    let els = wb.elements.filter(s => s.isInBBox(v) && s.isTextElement);  
    if (els.length == 0) {
        let end_pos = wb.screenToSVG(e);
        let styleSet = wb.styleSet;
        let el = wb.createElement("free-text", end_pos, styleSet);
        el.styleSet = styleSet;
        e.preventDefault();
        el.focusOn();
        el.dispatchCreationEvent();
    } 
}

export function styleChange(changes, wb) {
    // apply the changed styles to the text element last being edited
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
    return "free-text"
}

export function getIcon(){
    let i = new SvgPlus("svg");
    i.innerHTML = `<polygon points="49.24 83.21 71.26 83.21 71.26 76.72 58.8 73.99 58.8 28.03 71.65 28.03 75.55 35.6 82.73 35.6 82.75 16.79 49.24 16.79 19.41 16.79 19.43 35.6 26.62 35.6 30.51 28.03 43.36 28.03 43.36 73.99 30.9 76.72 30.9 83.21 49.24 83.21"/>`
    i.props = {viewBox: "0 0 100 100"}
    return i;
}