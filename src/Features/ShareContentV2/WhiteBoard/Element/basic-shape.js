import { WhiteBoardElementBase } from "./interface.js"
import { BasicShapes } from "../Utilites/basic-shapes.js";



class BasicShape extends WhiteBoardElementBase {
    constructor(whiteboard, mode){
        super(whiteboard);
        this.mode = mode;
        this.shape = this.createChild(BasicShapes[mode]);
    }

    /**
     * @param {[Vector, Vector]} coords
     */
    set coords(coords){
        this.shape.coords = coords;
    } 
    get coords(){
        return this.shape.coords;
    }

  
    setDragDelta(delta) {
        this.shape.setDragDelta(delta)
    }

    setScaleDelta(origin, scale) {
        this.shape.setScaleDelta(origin, scale);
    }

    fixTransformDelta() {
        this.shape.fixTransformDelta();
    }

    setTransform(transform){
        this.shape.trans = transform;
    }
    
    getTransform(){
        return this.shape.trans;
    }

    getData(){
        return {sdata: this.shape.data, mode: this.mode};
    }

    setData(data) {
        this.shape.data = data.sdata;
    }

    setStyleSet(sset) {
        this.shape.styles = sset;
    }


    isIntersection(points) {
      return this.shape.isIntersection(points);
    }

    isInside(point) {
        return this.shape.isVectorInFill(point) || this.shape.isVectorInStroke(point);
    }

    static deserialise(whiteboard, json){
        let element = new BasicShape(whiteboard, json.data.mode);
        element.json = json;
        return element;
    }

    static get name(){
        return "basic-shape"
    }

    static get observedStyles(){ return [
        "stroke",
        "fill",
        "stroke-opacity",
        "fill-opacity",
        "stroke-width",
    ]}
}

export default BasicShape

