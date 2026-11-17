
import { WhiteBoardElementBase } from "../interface.js"
import { Vector } from "../../../../../SvgPlus/4.js";
import { DPath } from "../../../../../SvgPlus/svg-path.js";
import { findPathIntersections } from "../../Utilites/intersection.js";
import { DASH_STYLES } from "../../Utilites/basic-shapes.js";

const cpoint_serialise = {
    "M": (cp) => ["M", cp.x, cp.y],
    "C": (cp) => ["C", cp.c1.x, cp.c1.y, cp.c2.x, cp.c2.y, cp.x, cp.y],
    "L": (cp) => ["L", cp.x, cp.y],
    "Z": (cp) => ["Z"],
}


export class PathElement extends WhiteBoardElementBase {
    constructor(whiteboard){
        super(whiteboard);
        this.path = this.createChild("path", {
            styles: {
                "stroke-linecap": "round", 
                fill: "none",
                "stroke-linejoin": "round",
            }
        });
        this.isFilled = false;
        this.trans = [new Vector(), new Vector(1)]
    }

     /** * @param {string|DPath} */
    set dPath(dpath) {
        this._dpath = dpath;
        this.transformPath();
    }

    /** * @return {string|DPath} */
    get dPath(){
        return this._dpath;
    }

     /** * @param {string|DPath} */
    set d(value) {
        this.path.props = {d: value + ""};
        this.actualPath = value + "";
    }

    get length(){
        return this.path.getTotalLength();
    }

    set dashStyle(dashType) {
        let style = dashType in DASH_STYLES ? DASH_STYLES[dashType](this.sw) : DASH_STYLES.solid(this.sw);
        this.path.styles = style;
    }

    isInside(point) {
        let isInside = this.path.isVectorInStroke(point);
        if (!isInside && this.isFilled) isInside = this.path.isVectorInFill(point);
        return isInside;
    }

    isIntersection(points) {
        let intersection = findPathIntersections(this.actualPath, "M"+points.join("L"));
        let isIntrsection = intersection.length > 0;
        return isIntrsection;
    }


    fixTransformDelta(){
        this.trans = this.realTrans;
    }

    setDragDelta(delta) {
        this.realTrans[0] = this.startTrans[0].add(delta);
        this.transformPath()
    }

    setScaleDelta(origin, scale) {
        let [delta_0, scale_0] = this.startTrans;
        this.realTrans = [scale.mul(delta_0.sub(origin)).add(origin), scale_0.mul(scale)];
        this.transformPath();
    }


    transformPath(){
        let [delta, scale] = this.realTrans;
        let dpath = new DPath(this.dPath);
        if (!(delta.norm() < 1e-7 && scale.x == 1 && scale.y == 1)) {
            for (let cp of dpath) {
                cp.mul(scale);
                cp.add(delta);
            }
        }
        dpath = dpath.toString();
        this.d = dpath;
    }

    setTransform([position, size]) {
        this.realTrans = [position, size];
        this.startTrans = [position, size];
        this.transformPath();
    }

    getTransform(){
        return this.realTrans;
    }

    setStyleSet(sset){
        this.path.props = {
            stroke: sset.stroke,
            "stroke-width": sset["stroke-width"],
            "marker-end": `url(#${sset['marker-end']})`,
            "marker-start": `url(#${sset['marker-start']})`,
            "stroke-opacity": sset["stroke-opacity"],
            "fill-opacity": sset['fill-opacity'],
        }
        this.dashStyle = sset["dash-style"];
        this.pFill = sset.fill;
    }


    set pFill(pFill){
        this._pFill = pFill;
        if (this.isFilled) {
            this.path.styles = {
                "fill": pFill
            }
        }
    }
    get pFill(){
        return this._pFill;
    }

    get isFilled(){
        return this._isFilled;
    }
    set isFilled(bool) {
        this._isFilled = !!bool;
        if (this.pFill && this.isFilled) {
            this.path.styles = {
                "fill": this.pFill,
            }
        }
    }

    getData(){
        let dpath = new DPath(this.dPath);
        let value = [...dpath].map(cp => cpoint_serialise[cp.cmd_TYPE](cp));
        let d = {
            path: value,
            filled: this.isFilled
        }
        return d;
    }

    setData(data){
        let dpath = data.path.map(cmd => `${cmd.shift()}${cmd.join(",")}`).join("");
        this.dPath = dpath;
        this.isFilled = data.filled;
    }


 
    static get name(){
        return "path-element"
    }

    static get observedStyles(){ return [
        "stroke",
        "stroke-opacity",
        "stroke-width",
        "marker-end",
        "marker-start",
        "dash-style",
        "fill",
        "fill-opacity", 
    ]}
}