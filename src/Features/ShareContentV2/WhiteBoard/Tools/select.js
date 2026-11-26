import { SvgPlus, Vector } from "../../../../SvgPlus/4.js";
import { toCursor } from "../Utilites/basic-funcs.js";


/**
 * @typedef {import('../whiteboard.js').WhiteBoard} WhiteBoard
 */
const icon = `<polygon class="cls-1" points="78.11 63.58 29.28 15.44 29.28 84.56 49.57 63.93 78.11 63.58"/>`


/**
 * @param {any} selectionBox
 * @param {WhiteBoard} wb
 */
function getElementsInSelectionBox(selectionBox, wb) {
    let sbbox = selectionBox.getBBox();
    let p1 = new Vector(sbbox);
    let p2 = p1.add(sbbox.width, 0);
    let p3 = p1.add(sbbox.width, sbbox.height);
    let p4 = p1.add(0, sbbox.height);

    let path = [p1,p2,p3,p4,p1]
    
    return wb.elements.filter((s) => {
        let ii = s.isIntersection(path) || s.isOneInside(path);
        let bbox = s.getExtendedBBox();
        let e_sx = bbox.x;
        let e_sy = bbox.y
        let e_ex = bbox.width + e_sx;
        let e_ey = bbox.height + e_sy;
        ii = ii || (e_sx > p1.x && e_ex < p3.x && e_sy > p1.y && e_ey < p3.y);
        return ii;
    })
}


function selectCursor(color = "black"){
   return toCursor(`<svg xmlns = "http://www.w3.org/2000/svg" height = "20" width = "20" viewBox="29 15 71 100">${icon}</svg>`)
}
const SCursor = selectCursor();


let start = null;
let selectionBox = null;
// let selectTransform = null;
let lastDelta = 0;

let down = false;
let mode = null;

let selectionCurrent = null;
let selectionCopy = null;
export function mousedown(e, wb) {
    start = wb.screenToSVG(e);
    down = true;
    mode = "select";
    
    // If there is a select transform check to see if the user is interacting 
    // with it, if so set the mode to the interaction type (move/scale)
    if (wb.isSelection) {
        let cursor = wb.selectTransform.getCursor(start);
        if (cursor != null) {
            mode = cursor;
        }
    }

    if (mode == "grab") {
        selectionCurrent = [...wb.selection];
        selectionCopy = wb.selection.map(s => s.duplicate());
        // selectionCopy.forEach(s => s.dispatchLightCreationEvent());
    }

    lastAlt = false;
    wb.disableCommands = true;
    e.preventDefault();
}


let lastAlt = false;
export function mousemove(e, wb) {
    let end = wb.screenToSVG(e);

    // If the mouse is up, update the cursor
    if (!down) {
        let cursor = SCursor;
        if (wb.isSelection) {
            let c = wb.selectTransform.getCursor(end);
            if (c != null) cursor = c;
        } 
        wb.cursor = cursor;

    // The mouse is down, i.e. the user is draging 
    } else {
        // If the mode is selection update the selection box if one exists, otherwise create one first
        if (mode == "select") {
            if (selectionBox == null) 
                selectionBox = wb.createSelectionBox();
            selectionBox.coords = [start, end];

        // If the mode is a select transform, update it accordingly
        } else if (wb.isSelection && mode != "wait") {
            let delta = end.sub(start);
            if (mode == "grab") {
                wb.cursor = "grabbing"
                if (isAlt != lastAlt) {
                    wb.selectTransform.setDragDelta(new Vector(0))
                    if (isAlt) {
                        selectionCopy.forEach(e => {
                            wb.tempLayer.appendChild(e)
                        })
                        wb.createSelection(selectionCopy);
                    
                    } else {
                        selectionCopy.forEach(e => {
                            e.remove()
                        })
                        wb.createSelection(selectionCurrent)
                    }
                }
                lastAlt = isAlt
                wb.selectTransform.setDragDelta(delta, isShift);

            } else {
                wb.selectTransform.setScaleDelta(mode, delta, isShift, isAlt)
            }
        }
    }


    e.preventDefault();
}

let makingSelection = false;
let lastLockedSelection = null;
async function makeSelection(end, wb){
    
    // compute the distance traveled during the selection
    let lastDelta = 0;
    if (start instanceof Vector) {
        lastDelta = end.dist(start);
    }

    // remove any zero sized selection boxes
    if (lastDelta < 5 && selectionBox) {
        selectionBox.remove();
        selectionBox = null;
    }

    let newSelection = [];

    // if there is a valid selection box, select the contents in the box
    if (selectionBox) {
        newSelection = getElementsInSelectionBox(selectionBox, wb);
        selectionBox.remove();
        selectionBox = null;
        
    // overwise do a point selection, i.e. the top element at the mouse
    } else {
        let selectedElement = wb.elements.filter(s => s.isInside(end));
        if (selectedElement.length > 0) {
            newSelection = [selectedElement.pop()];
        }
    }

    if (isShift && wb.isSelection) {
        newSelection = [...newSelection, ...wb.selection];
    }

    if (makingSelection) return;
    makingSelection = true;


    if (lastLockedSelection != null) {
        wb.releaseElements(lastLockedSelection);
    }

    // A selection has been made
    if (newSelection.length > 0) {
        wb.createSelection(newSelection);

        // wait for the elements to lock
        wb.selectTransform.waiting = true;
        let locked = await wb.lockElements(newSelection);
        if (locked.length > 0) {
            lastLockedSelection = locked;
            wb.createSelection(locked);
            wb.selectTransform.waiting = false;
        } else {
            wb.clearSelection();
            lastLockedSelection = null;
        }
    } else {
        wb.clearSelection();
    }
    makingSelection = false;
}

// Called when the user releases the mouse 
// or moves out of the control region
function release(e, wb){
    down = false;
    let end = wb.screenToSVG(e)

    // The user was selecting something
    if (mode == "select") {
        makeSelection(end, wb)
    
    // Some transformation
    } else if (mode != null && mode != "wait" && wb.isSelection) {
        if (lastAlt) {
            let ts = (new Date()).getTime();
            // wb.releaseElements(selectionCurrent);
            wb.selectTransform.fixTransformDelta(false)
            for (let el of selectionCopy) {
                wb.mainLayer.appendChild(el);
                el.dispatchCreationEvent(ts);
            }
            for (let el of selectionCurrent) {
                el.dispatchTransformChange();
            }
        } else {
            wb.selectTransform.fixTransformDelta();
        }
    }

    // reset start
    // mode is now reset
    wb.disableCommands = false;
    mode = null;
    start = null;
}

let isAlt = false;
let isShift = false;
export function keydown(e, wb) {
    if (e.key == "Backspace" && wb.isSelection && !wb.disableCommands) {
        wb.deleteElement(wb.selection);
        wb.clearSelection();
        mode = null;
        e.preventDefault();
    } 
    isShift = e.shiftKey;
    isAlt = e.altKey;
}

export function keyup(e){
    isShift = e.shiftKey
    isAlt = e.altKey;
}


export function mouseup(e, wb){
    release(e, wb)
    e.preventDefault();
}


export function mouseleave(e, wb){
    release(e, wb)
    e.preventDefault();
}


export function onSelect(wb){
    wb.cursor = selectCursor();
    wb.isZoomLocked = false;
    wb.isPanLocked = true;
    wb.readOnly = true;
}

export function clearSelectionOnSelect(){
    return false;
}

export function getName(){
    return "select"
}


export function getIcon(){
    let i = new SvgPlus("svg");
    i.innerHTML = icon
    i.props = {
        viewBox: "0 0 100 100"
    }
    return i;
}
