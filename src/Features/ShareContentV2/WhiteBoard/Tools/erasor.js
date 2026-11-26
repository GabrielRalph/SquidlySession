import { SvgPlus, Vector } from "../../../../SvgPlus/4.js"
import { toCursor } from "../Utilites/basic-funcs.js"
import { Elements } from "../Element/whiteboard-elements.js"

function erasor(w = 20.02, h = 17.1){
    return `
    <svg width = "${w}" height = "${h}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10.01 8.55">
      <path d="m8.62,4.63h0L4.55.01h-.98s-.02-.01-.03-.01c-.57,0-1.12.21-1.55.58l-2,1.76,1.39,1.58h0l4.07,4.62h.93c.61.02,1.21-.2,1.66-.61l1.96-1.72-1.39-1.58ZM.62,2.38l1.67-1.47c.35-.31.79-.47,1.25-.47h.02s.79,0,.79,0l1.26,1.43-1.63,1.43c-.46.4-1.05.62-1.66.62h-.34s-1.36-1.55-1.36-1.55Z"/>
    </svg>`
}

function erasorCursor(){return toCursor(erasor(10.01*2, 8.55*2), [4, 3.5])}


let erasorPath = null;
export function mousedown(e, wb){
    erasorPath = wb.svgView.createChild(Elements["pen-path"]);
    erasorPath.styleSet = {
        stroke: "black",
        "stroke-opacity": 0.2,
        "stroke-width":  wb.svgView.size.norm() * wb.svgView.scale / 100
    }
    erasorPath.addPoint(wb.screenToSVG(e));
    e.preventDefault();
}

export function mousemove(e, wb) {
    if (erasorPath) {
        erasorPath.addPoint(wb.screenToSVG(e));
        e.preventDefault();
    }
}

function release(e, wb){
    if (erasorPath) {

        let elements = [...wb.elements];

        // Check whether for all elements that have a size less than the stroke 
        // of the erasor if those elements are inside the stroke of the erasor 
        let isInsideErasor = elements.map((e) => {
            let inside = false;
            let bbox = e.getBBox()
            let size = new Vector(bbox.width, bbox.height)
            if (size.norm() < erasorPath.sw) {
                let center = size.div(2).add(bbox.x, bbox.y);
                inside = erasorPath.isOneInside([center])
            }
            return inside;
        })

        // Find all elements that intersect with the erasor, or are inside 
        // the erasor (as found above)
        let isIntersection = elements.map((e, i) => isInsideErasor[i] || e.isIntersection(erasorPath.points));
        let intersection = elements.filter((e, i) => isIntersection[i])

        // For all other elements (.i.e not in or intersecting with the erasor)
        // find the elements that contain at least one point in the erasor path.
        // As the erasor does not intersect these elements the erasor must be 
        // contained within these elements.
        let isInside = elements.filter((e, i) => !isIntersection[i] && e.isOneInside(erasorPath.points));

        let selection = intersection;

        // If there are elements that contain the entire erasor path we will
        // select the top element and we will remove all elements from the 
        // selection that are underneath it. As any elements underneath the 
        // element that contains the erasor path (the container) will be covered
        // by that container and all intesections will have been made under the 
        // container.
        if (isInside.length > 0) {
            let contained = isInside.pop();
            selection = selection.filter(e => e.order > contained.order);
            selection.push(contained);
        }

        wb.deleteElement(selection);

        erasorPath.remove();
        erasorPath = null;
        e.preventDefault();
    }
}
export function mouseup(e, wb) {
    release(e, wb);
}
export function mouseleave(e, wb) {
    release(e, wb)
}

export function onSelect(wb){
    wb.cursor = erasorCursor();
    wb.isZoomLocked = false;
    wb.isPanLocked = true;
    wb.readOnly = true;
    
}

export function getName(){
    return "erasor"
}

export function getIcon(){
    let i = new SvgPlus("svg");
    i.props = {
        viewBox: "-1.5 -1.5 13.01 11.55"
    }
    i.innerHTML = `<path d="m8.62,4.63h0L4.55.01h-.98s-.02-.01-.03-.01c-.57,0-1.12.21-1.55.58l-2,1.76,1.39,1.58h0l4.07,4.62h.93c.61.02,1.21-.2,1.66-.61l1.96-1.72-1.39-1.58ZM.62,2.38l1.67-1.47c.35-.31.79-.47,1.25-.47h.02s.79,0,.79,0l1.26,1.43-1.63,1.43c-.46.4-1.05.62-1.66.62h-.34s-1.36-1.55-1.36-1.55Z"/>`
    return i;
}