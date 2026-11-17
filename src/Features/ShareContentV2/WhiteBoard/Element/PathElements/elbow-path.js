import { Vector } from "../../../../../SvgPlus/4.js";
import { DPath } from "../../../../../SvgPlus/svg-path.js";
import {findPathIntersections} from "../../Utilites/intersection.js";
import { PathElement } from "./path-elements.js";

const {abs, max, min, PI, round, atan} = Math;

function fixOctant(v, is45) {
    let theta = round(abs(atan(v.y/v.x) * 180 / PI));
    let diff45 = abs(theta-45)
    
    if (is45 && (diff45 < theta && diff45 < abs(theta-90)) ) {
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

function isAnchorComplete(a){
    if (a == null) {
        return true
    } else {
        return a.start instanceof Vector && a.end instanceof Vector;
    }
}

const ratio = 0.6;
class ElbowPath extends PathElement {
    constructor(whiteboard){
        super(whiteboard);
        this.classList.add("elbow-path")
        this.anchors = [];
        this.ewa_smoothing = 0.2;
        this.ewa_c1 = null;
        this.ewa_c2 = null;
        this.threshold_ratio = 10;
        this.end_threshold_ratio = 2;
    }
    
    get currentAnchor() {
        let anchor = null;
        if (this.anchors.length > 0) {
            anchor = this.anchors[this.anchors.length-1]
        }
        return anchor;
    }

    get threshold(){
        return this.threshold_ratio * this.sw;
    }
    get end_threshold(){
        return this.end_threshold_ratio * this.sw;
    }

    addAnchorPoint(v, isShift = false){
        this.lastPoint = v;
        let {currentAnchor, anchors} = this
        if (isAnchorComplete(currentAnchor)) {
            this.lastStartPoint = v;
            anchors.push({
                start: v,
                end: null,
                c1: null,
                c2: null
            })
        } else {
            currentAnchor.end = v;
            if (!isShift) {
                this.ended = true;
                this.dispatchCreationEvent();
            } else {
                anchors.push({
                    start: v,
                    end: null,
                    c1: null,
                    c2: null
                })
            }
        } 
        this.renderPath()
        return this.ended;
    }


    endPath(){
        this.dispatchCreationEvent();
    }
 

    renderPath(){
        let {anchors, lastPoint} = this;
        let dpath = (new DPath()).M(anchors[0].start)
        let i = 0;
        let lastC2Dir = null;
        for (let anchor of anchors) {
            let start = anchor.start;
            let c1 = start;
            let end = lastPoint;
            if (isAnchorComplete(anchor)) {
                end = anchor.end;
            }

            let c2 = end;
            let delta = end.sub(start);

            if (i > 0 && lastC2Dir instanceof Vector) {
                c1 = start.add(lastC2Dir.mul(lastC2Dir.dot(delta) * ratio))
            } else if (anchor.c1) {
                let dir = fixOctant(anchor.c1, false).dir();
                c1 = start.add(dir.mul(dir.dot(delta) * ratio))
            } 
    
            if (anchor.c2) {
                let dir = fixOctant(anchor.c2, false).dir()
                c2 = end.sub(dir.mul(dir.dot(delta) * ratio))
                lastC2Dir = dir;
            } 
            dpath = dpath.C(c1, c2, end);
            i++;
        }
        this.dPath = dpath + "";
    }
   

    /** @param {Vector} v */
    addPoint(v) {   
        if (this.ended) return;
        let {lastStartPoint, currentAnchor, threshold, lastPoint, ewa_smoothing} = this;
        let delta = null;
        let e = null;

        let start2v = v.sub(lastStartPoint);
        let start2lastv = lastPoint.sub(lastStartPoint)
        if (v.dist(lastStartPoint) < threshold) {
            delta = start2v
            e = "c1"
        } else if (start2v.norm() > start2lastv.norm()) {
            delta = v.sub(lastPoint);
            e = "c2";
        }

        if (delta != null) {
            if (this["ewa"+e] == null) this["ewa"+e] = delta;
            delta = delta.mul(ewa_smoothing).add(this["ewa"+e].mul(1-ewa_smoothing));
            this["ewa"+e] = delta;
            currentAnchor[e] = delta
        }

        this.lastPoint = v;
        this.renderPath();
    }

   

    static get name(){
        return "elbow-path"
    }
    static get observedStyles(){ return [
        "stroke",
        "stroke-opacity",
        "stroke-width",
        "marker-end",
        "marker-start",
        "dash-style",
    ]}
}


export default ElbowPath