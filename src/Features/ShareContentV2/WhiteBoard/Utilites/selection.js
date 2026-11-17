import { BasicShapes } from "./basic-shapes.js";
import { SvgPlus, Vector } from "../../../../SvgPlus/4.js";
import { FixedSizeCircle } from "../svg-view.js";
const {abs, max, min, PI, round, atan} = Math;


function fixOctant(v, dir) {
    let theta = round(abs(atan(v.y/v.x) * 180 / PI));
    let diff45 = abs(theta-45)
    
    if (diff45 < theta && diff45 < abs(theta-90) ) {
        let oldV = v.clone()
        if ((v.x > 0 && v.y < 0) ||( v.x < 0 && v.y > 0)){
            v.x = -v.y;
        } else {
            v.x = v.y
        }
        let d = v.dot(oldV) / v.norm()
        v = v.div(v.norm()).mul(d);
    } else {
        if (theta > 45) {
            v.x = 0;
        } else {
            v.y = 0;
        }
    }

    return v;
}

function fixDiag(v, oc){
    let proj = oc.dot(v)/(oc.norm())
    let oc_dir = oc.div(oc.norm())
    let nv = oc_dir.mul(proj);
    return nv;
}

const corners = {
    x: [["e", 1, "w"], ["", 0.5, ""], ["w", 0, "e"]],
    y: [["s", 1, "n"], ["", 0.5, ""], ["n", 0, "s"]]
}

function setIntersection(a, b) {
    let _c = new Set(a);
    for (let e of b) _c.add(e);

    let c = new Set();
    for (let e of _c) {
        if (a.has(e) && b.has(e)) c.add(e);
    }
    return c;
}
class SelectTransform extends SvgPlus {
    constructor(element){
        super("g");
        this.class = "selection-box"
        this.bounding = this.createChild("g")
        this.guides = this.createChild("g", {class: "guides"})
        this.selection = element;
    }


    set waiting(val){
        this.styles = {opacity: val ? 0.5 : 1}
        this._waiting = val;
    }
    get waiting(){
        return this._waiting;
    }


    get selection(){
        return this._selection;
    }
    set selection(selection) {
        this.bound(selection);
        this.startPos = this.pos.clone();
        this.startSize = this.size.clone()
    }

    set showGuides(val){
        this.guides.innerHTML = "";
        if (val) {
            let ls = [
                this.startPos.add(this.startSize.div(2)),
                this.pos.add(this.size.div(2)),
            ]
    
             this.guides.createChild("path", {d: "M"+ls.join("L") })
        }
        this._guidesShown = val;
    }

    get showGuides(){
        return this._guidesShown
    }

    bound(element, addResizeAnchors = true, keepOrigins = false){
        let bbox = {x: 0, y: 0, height: 0, width: 0}
        if (Array.isArray(element)) {
            let bboxes = element.map(e => e.getExtendedBBox())

            let min_x = min(...bboxes.map(({x}) => x));
            let min_y = min(...bboxes.map(({y}) => y));
            bbox = {
                x: min_x,
                y: min_y,
                width: max(...bboxes.map(({x, width}) => x + width)) - min_x,
                height: max(...bboxes.map(({y, height}) => y + height)) - min_y,
            }
            this._selection = element
        } else {
            bbox = element.getExtendedBBox();
            this._selection = [element];
        }

        let pos = new Vector(bbox);
        let size = new Vector(bbox.width, bbox.height);
        pos = pos.sub(1);
        size = size.add(2);

        this.pos = pos;
        this.size = size;
        this.minRadius = min(size.x, size.y)/8;
        
        this.bounding.innerHTML = "";
        this.rect = this.bounding.createChild("rect", {
            x: pos.x,
            y: pos.y,
            width: size.x,
            height: size.y
        });

        
        if (addResizeAnchors) {
            if (!keepOrigins) this.anchorCenters = {};
            this.anchors = []
            for (let [ky, y, oy] of corners.y) {
                for (let [kx, x, ox] of corners.x) {
                    let cursor = ky+kx + "-resize"
                    let origin = oy+ox + "-resize";
                    if (cursor != "-resize") {
                        let p = pos.add(size.mul(x, y))
                        let c = this.bounding.createChild(FixedSizeCircle, {
                            cx: p.x,
                            cy: p.y,
                        }, 4)
                        c.cursor = cursor;
                        c.center = p;
                        if (!keepOrigins) this.anchorCenters[origin] = p;
                        this.anchors.push(c);
                    }
                }
            }
        }
    }

    fixTransformDelta(save = true){
        let ts = (new Date()).getTime();
        this.transbox = null;
        for (let element of this.selection) {
            element.saveTransformation(ts, !save);
        }
        this.bound(this.selection, true, false)
        this.showGuides = false;
        this.startPos = this.pos.clone();
        this.startSize = this.size.clone()
    }

    setDragDelta(delta, isShift) {
        if (isShift) {
            delta = fixOctant(delta);
            this.showGuides = true;
        } else {
            this.showGuides = false;
        }
        for (let element of this.selection) {
            element.dragDelta = delta;
        }
        this.bound(this.selection, true, true)
    }

    setScaleDelta(cursor, delta, isShift, isAlt) {
        if (this.transbox == null) {
            this.transbox = [this.pos.clone(), this.size.clone()];
        }

        let [pos, size] = this.transbox;
        let o = this.anchorCenters[cursor];
        let c = pos.add(size.div(2));
        let oc = o.sub(c);

        if (isShift) {
            delta = fixDiag(delta, oc);
        }
        delta.x = oc.x < 0 ? delta.x : delta.x * -1;
        delta.y = oc.y < 0 ? delta.y : delta.y * -1;
      
        if (isAlt) {
            o = c;
            delta = delta.mul(2);
        }
        

        if (cursor == "n-resize" || cursor == "s-resize") delta.x = 0;
        else if (cursor == "e-resize" || cursor == "w-resize") delta.y = 0;


        for (let element of this.selection) {
            element.scaleDelta = [o, delta.add(size).div(size)];
        }
        this.bound(this.selection, true, true)
    }

    getCursor(v) {
        let cursor = null;
       
        if (this.anchors && !this.waiting) {
            let dists = this.anchors.map(a => [a.center.dist(v), a.cursor])
            dists.sort((a,b) => a[0] - b[0])
            if (dists[0][0] < this.minRadius) {
                cursor =  dists[0][1]
            }
        }

        if (cursor == null) {
            let {pos} = this;
            let end = pos.add(this.size);
            if (v.x > pos.x && v.x < end.x && v.y > pos.y && v.y < end.y) {
                cursor = this.waiting ? "wait" : "grab"
            }
        }
        return cursor;
    }

    /** The style keys (e.g. "stroke", "fill-opacity") that every element
     *  in the selection supports.
     * @return {Set<string>} */
    get styleKeys() {
        let sets = this.selection.map(e => new Set(e.observedStyles));
        if (sets.length == 0) return new Set();
        return sets.reduce((a, b) => setIntersection(a, b));
    }

    get styleSet(){
        let sset = {};
        for (let e of this.selection) {
            let esset = e.styleSet;
            for (let key in esset) {
                if (!(key in sset)) {
                    sset[key] = esset[key];
                } else {
                    sset[key] = sset[key] === esset[key] ? sset[key] : null;
                }
            }
        }
        let sset_nn = {}
        for (let key in sset) {
            if (sset[key] != null) 
                sset_nn[key] = sset[key]
        }
        return sset_nn;
    }

    set styleSet(sset){
        let ts = (new Date()).getTime()
        for (let el of this.selection) {
            // only apply the styles this element supports, merged with its
            // current styles so a partial style set only changes those keys
            let changes = {};
            for (let key of el.observedStyles) if (key in sset) changes[key] = sset[key];
            if (Object.keys(changes).length > 0) {
                el.applyStyleSet({...el.styleSet, ...changes}, ts)
            }
        }
        this.selection = this.selection;
    }
}


class SelectionBox extends SvgPlus {
    constructor(){
        super("g");
        this.rect = this.createChild(BasicShapes.rectangle);
        this.props = {
            stroke: "gray",
            "stroke-width": 1,
            "stroke-dasharray": "3 3",
            fill: "none",
        }
    }

    set coords(coord) {
        this.rect.coords = coord
    }
}

export {SelectTransform, SelectionBox}