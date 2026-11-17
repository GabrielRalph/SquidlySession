import { SvgPlus, Vector } from "../../../../SvgPlus/4.js";


function randomKey() {
    let a = (new Date()).getTime();
    a = "E-"+(a * 1000 + Math.round(Math.random()*1000)).toString(16)
    return a;
}

export class ElementChangeEvent extends Event {
    constructor(id, type, data, ts = (new Date()).getTime(), light = false){
        super("e-change", {bubbles: true});
        this.elementId = id;
        this.changeType = type;
        this.data = data;
        this.ts = ts;
        this.light = light;
    }

    getSimple(){
        let {elementId, data, changeType} = this;
        if (changeType == "styleSet" || changeType == "data"  || changeType == "trans" ) {
            return {id: elementId, data: {[changeType]: data}, type: changeType};
        } else {
            return {id: elementId, data: data, type: changeType};
        }
    }
}

export class WhiteBoardElementBase extends SvgPlus {
    constructor(whiteboard){
        super("g");
        this.toggleAttribute("wb-element", true)
        this.whiteboard = whiteboard;
        this.preventTransEvents = false;
        let id;
        this.getId = () => id;
        this.setId = (_id) => {
            id = _id;
            this.id = id;
        }
        this.setId(randomKey());
    }

    dispatchDataChange(ts = (new Date()).getTime()){
        const event = new ElementChangeEvent(this.id, "data", this.data, ts);
        this.dispatchEvent(event);
    }
    dispatchLightDataChange(ts = (new Date()).getTime()){
        const event = new ElementChangeEvent(this.id, "data", this.data, ts, true);
        this.dispatchEvent(event);
    }

    dispatchTransformChange(ts = (new Date()).getTime()){
        const event = new ElementChangeEvent(this.id, "trans", this.trans, ts);
        this.dispatchEvent(event);
    }
    dispatchLightTransformChange(ts = (new Date()).getTime()){
        const event = new ElementChangeEvent(this.id, "trans", this.trans, ts, true);
        this.dispatchEvent(event);
    }

    dispatchCreationEvent(ts = (new Date()).getTime()) {
        if (!this._creationInitialised) {
            let i = 0;
            let el = this;
            while (el.previousElementSibling) {
                i++;
                el = el.previousElementSibling;
            }
            this._order = i;
            this._creationInitialised = true;
            const event = new ElementChangeEvent(this.id, "creation", this.serialise(), ts);
            this.dispatchEvent(event);
        }
    }
    dispatchLightCreationEvent(ts = (new Date()).getTime()) {
        if (!this._creationInitialised) {
            let i = 0;
            let el = this;
            while (el.previousElementSibling) {
                i++;
                el = el.previousElementSibling;
            }
            this._order = i;
            const event = new ElementChangeEvent(this.id, "creation", this.serialise(), ts, true);
            this.dispatchEvent(event);
        }
    }


    dispatchDeletionEvent(ts = (new Date()).getTime()) {
        this._creationInitialised = true;
        const event = new ElementChangeEvent(this.id, "deletion", this.serialise(), ts);
        this.dispatchEvent(event);
    }
    dispatchOrderEvent(ts = (new Date()).getTime()) {
        const event = new ElementChangeEvent(this.id, "order", {order: this.order}, ts);
        this.dispatchEvent(event);
    }



   

    
    // ~~~~~~~~~~~~~~~~~~~~~ Transformation Methods ~~~~~~~~~~~~~~~~~~~~~
    setDragDelta(delta){}

    setScaleDelta(origin, delta){}

    fixTransformDelta(){}


    saveTransformation(ts, light = false){
        this.fixTransformDelta();
        if (light) {
            this.dispatchLightTransformChange(ts);
        } else {
            this.dispatchTransformChange(ts);
        }
    }


    // ~~~~~~~~~~~~~~~~~~~~~ Main Data Set/Get Methods ~~~~~~~~~~~~~~~~~~~~~
    getTransform(){}

    setTransform([delta, scale]){}


    setStyleSet(){}


    getData(){return {}}

    setData(data){}

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~



    serialise(){
        return this.json;
    }

    get json(){
        return {
            type: this.name,
            order: {order: this.order},
            data: this.data,
            styleSet: this.styleSet,
            trans: this.trans
        }
    }

    set json(json){
        let {data, styleSet, trans} = json;
        this.styleSet = styleSet;
        this.data = data;
        this.trans = trans;
    }

    
    // Dont override
    getExtendedBBox(){
        let bbox = this.getBBox();
        let sw = this.strokeWidth;
        bbox.x -= sw/2;
        bbox.y -= sw/2;
        bbox.width += sw;
        bbox.height += sw;
        return bbox;
    }

    delete(){
        if (this.whiteBoard) {
            this.whiteBoard.deleteShape(this);
        }
    }

    isInBBox(v) {
        let bbox = this.getExtendedBBox();
        return (v.x > bbox.x && v.x < bbox.x + bbox.width) && (v.y > bbox.y && v.y < bbox.y + bbox.height)
    }

    isIntersection(v) {
    }

    isInside(v) {
        return false;
    }

    isOneInside(points) {
        // let ts = performance.now();
        let inside = false;
        for (let p of points) {
            if (this.isInBBox(p)) {
                if (this.isInside(p)) {
                    inside = true;
                    break;
                }
            }
        }
        return inside;
    }

    duplicate(){
        return this["__+"].deserialise(this.whiteboard, this.serialise())
    }
  
    applyStyleSet(styleSet, ts = (new Date()).getTime()) {
        let oldStyleSet = this.styleSet;
        this.styleSet = styleSet;
        let newStyleSet = this.styleSet;

        // check for any change
        let change = false;
        for (let key in oldStyleSet) {
            if (key in newStyleSet) {
                if (oldStyleSet[key] != newStyleSet[key]) {
                    change = true;
                    break;
                } else {
                    change = true;
                    break;
                }
            }
        }
        if (this._creationInitialised && change) {
            this.dispatchEvent(new ElementChangeEvent(this.id, "styleSet", this.styleSet, ts))
        }
    }



    get strokeWidth(){
        let sw = parseFloat(this._strokeWidth);
        let so = parseFloat(this._strokeOpacity);
        if (Number.isNaN(sw)) sw = 0;
        if (!Number.isNaN(so) && so == 0) sw = 0;
        return sw;
    }
    get sw(){
        return this.strokeWidth;
    }


    set dragDelta(delta) {
        this.setDragDelta(delta);
        this.dispatchLightTransformChange();
    }

    set scaleDelta([origin, delta]) {
        this.setScaleDelta(origin, delta);
        this.dispatchLightTransformChange();

    }


    set data(data){this.setData(data);}

    get data(){return this.getData()}


    set trans(transform){
        transform = transform.map(p => new Vector(p))
        this.setTransform(transform);
    }
    get trans(){
        let t = this.getTransform().map(p => [p.x, p.y])
        if (Array.isArray(t)) {
            t = this.getTransform().map(p => [p.x, p.y])
        }
        return t;
    }

    set styleSet(styleSet) {
        this._strokeWidth = styleSet["stroke-width"];
        this._strokeOpacity = styleSet["stroke-opacity"];
        this.setStyleSet(styleSet);
        this._styleSet = {};
        for (let sname of this.observedStyles) this._styleSet[sname] = styleSet[sname];
    }
    get styleSet(){
        let sset = {};
        for (let key in this._styleSet) {
            let value = this._styleSet[key]
            if (value != null && typeof value !== "undefined") {
                sset[key] = this._styleSet[key];
            }
        }
        return sset
    }


    set order(value) {
        if (typeof value === "number") {
            this._order = value;
        } else if (value !== null && typeof value === "object" && typeof value.order === "number") {
            this._order = value.order;
        }
    }
    get order() {
        return this._order;
    }


    get observedStyles(){
        return this["__+"].observedStyles;
    }

    get name(){
        return this["__+"].name;
    }

    // override
    static deserialise(whiteboard, json) {
        let element = new this(whiteboard);
        element.json = json;
        return element;
    }

    static get name(){
        return "shape-name"
    }

    static get observedStyles(){return [
        "stroke"
    ]}
}
