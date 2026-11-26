import { Vector } from "../../../../../SvgPlus/4.js";
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
class StraightLine extends PathElement {
    constructor(whiteboard){
        super(whiteboard);
        this.classList.add("elbow-path")
        this.points = [];
        // this.ewa_smoothing = 0.2;
        // this.ewa_c1 = null;
        // this.ewa_c2 = null;
        // this.threshold_ratio = 10;
        // this.end_threshold_ratio = 2;
    }
    

    set endPoint(v) {
        let points = this.points;
        if (points.length > 0)
            points[points.length-1] = v;
    }
    get endPoint() {
        let points = this.points;
        let point = null;
        if (points.length > 0) 
            point = points[points.length - 1]

        return point
    }
    get startPoint(){
        let points = this.points;
        let point = null;
        if (points.length > 1) 
            point = points[points.length - 2]

        return point
    }

  
    addAnchorPoint(){
        this.points.push(this.endPoint)
    }

    endPath(){
        let {points} = this;
        let start = points[0];
        let end = points[points.length - 1];

        // Check the distance from the start point to the end point
        // is greater than 3 times the stroke, if so join the ends 
        // and apply the stroke
        if (start.dist(end) < 3 * this.sw) {
            points.push(start);
            this.isFilled = true;
        }

        this.dispatchCreationEvent();
    }


    /** @param {Vector} v */
    addPoint(v, isShift) {   
        if (this.points.length > 1) {
            if (isShift) {
                let delta = v.sub(this.startPoint)
                delta = fixOctant(delta, true);
                v = this.startPoint.add(delta);
            }

            this.endPoint = v;
            this.dPath = "M"+this.points.join("L")
        } else {
            this.points.push(v);
            this.points.push(v);
        }
    }

   

    static get name(){
        return "straight-line"
    }

}


export default StraightLine