import { SvgPlus, Vector} from "../../../../SvgPlus/4.js"
import {DPath} from "../../../../SvgPlus/svg-path.js"
import {findPathIntersections} from "./intersection.js";

const {abs, max, min} = Math;

function rectCoords([start, end]) {
    let {x,y} = start.sub(end);
    let [size_x, size_y] = [abs(x), abs(y)]
    let min_x = min(start.x, end.x);
    let min_y = min(start.y, end.y);
    let coords = {
        x: min_x,
        y: min_y,
        width: size_x,
        height: size_y
    }
    return coords;
}

const star_ratio = 0.38198831803552274;
class RootShape extends SvgPlus {
    constructor(el){super(el)}
    setDragDelta(delta) {}
    setScaleDelta(origin, delta) {}
    fixTransformDelta() {}

    getData(){return null}
    setData(data){}

    getTransform(){}
    setTransform(data){}

    get data(){
        return this.getData();
    }
    set data(data){
        return this.setData(data);
    }

    get trans(){
        return this.getTransform();
    }
    set trans(trans){
        return this.setTransform(trans);
    }

}

const BasicShapes = {
    ellipse: class Ellipse extends RootShape {
        constructor() {
            super("ellipse");
            this.coords = [new Vector(15), new Vector(85)]
        }

        setTransform(transform) {
            this.coords = transform;
        }
        getTransform(){
            return [this.transCenter.sub(this.transRadius), this.transCenter.add(this.transRadius)];
        }

        set coords([start, end]) {
            let c = start.add(end).div(2)
            let r = start.sub(end);
            r = new Vector(abs(r.x/2), abs(r.y/2));
            let {x, y} = c;
            this.center = c;
            this.transCenter = c;
            this.radius = r;
            this.transRadius = r;
            this.props = {
                cx: x,
                cy: y,
                rx: r.x, 
                ry: r.y,
            }
        }

        setDragDelta(delta) {
            let nc = this.center.add(delta);
            this.props = {
                cx: nc.x,
                cy: nc.y,
            }
            this.transCenter = nc;
        }


        setScaleDelta(origin, scale) {
            let center = this.center
            let oc = origin.sub(center);
            
            let nr = this.radius.mul(scale);
            nr = new Vector(abs(nr.x), abs(nr.y))
            let nc = scale.mul(center.sub(origin)).add(origin);

            this.props = {
                cx: nc.x,
                cy: nc.y,
                rx: nr.x,
                ry: nr.y
            }

            this.transCenter = nc;
            this.transRadius = nr;

        }


        fixTransformDelta(){
            this.center = this.transCenter;
            this.radius = this.transRadius;
        }

        get dpath(){
            let r = this.radius;
            let c = this.center;
            let p1 = c.add(r.x, 0);
            let p2 = c.add(0, r.y);
            let p3 = c.sub(r.x, 0);
            let p4 = c.sub(0, r.y);

            let kappa = 0.5522848;

            let c1 = p1.add(0, r.y * kappa);
            let c2 = p2.add(r.x * kappa, 0);

            let c3 = p2.sub(r.x * kappa, 0);
            let c4 = p3.add(0, r.y * kappa);

            let c5 = p3.sub(0, r.y * kappa);
            let c6 = p4.sub(r.x * kappa, 0);

            let c7 = p4.add(r.x*kappa, 0);
            let c8 = p1.sub(0, r.y*kappa);


            let dpath = new DPath();
            dpath.M(p1).C(c1, c2, p2).C(c3, c4, p3).C(c5, c6, p4).C(c7, c8, p1)

            return dpath + "";
        }

        isIntersection(points) {
            let intersection = findPathIntersections(this.dpath, "M"+points.join("L"));
            let isIntrsection = intersection.length > 0;
            return isIntrsection;
        }
    },

    rectangle: class Rectangle extends RootShape {
        constructor() {
            super("rect");
            this.coords = [new Vector(15), new Vector(85)]
        }

        fixTransformDelta(){
            this.rcoords = this.transRcoords;
        }

        setDragDelta(delta) {
            let corner = new Vector(this.rcoords)
            let nc = corner.add(delta);
            this.transRcoords = {
                x: nc.x,
                y: nc.y,
                width: this.rcoords.width,
                height: this.rcoords.height
            }
            this.props = {
                x: nc.x,
                y: nc.y
            }
        }

        setScaleDelta(origin, scale) {
            let corner = new Vector(this.rcoords);
            let size = new Vector(this.rcoords.width, this.rcoords.height);


            let nsize = size.mul(scale);
            let nc = scale.mul(corner.sub(origin)).add(origin);
            
            let ne = nc.add(nsize);

            let x = min(ne.x, nc.x);
            let y = min(nc.y, ne.y);

            let trc = {
                x: x,
                y: y,
                width: abs(nsize.x),
                height: abs(nsize.y)
            }
            this.props = trc;
            this.transRcoords = trc;
        }


        set coords(coords) {
            let rcoords = rectCoords(coords);
            this.props = rcoords;
            this.rcoords = rcoords;
            this.transRcoords = rcoords;
        }

        setTransform(transform) {
            this.coords = transform
        }

        getTransform(){
            let rcoords = this.transRcoords;
            let pos = new Vector(rcoords);
            let size = new Vector(rcoords.width, rcoords.height);
            return [pos, pos.add(size)];
        }

        isIntersection(points){
            let c = new Vector(this.rcoords);
            let {x, y} = new Vector(this.rcoords.width, this.rcoords.height);
            let path = "M" +[
                c, 
                c.add(x, 0),
                c.add(x, y),
                c.add(0, y),
                c,
            ].join("L");
            let intersection = findPathIntersections(path, "M"+points.join("L"));
            let isIntrsection = intersection.length > 0;
            return isIntrsection;
        }
    },
    star: class Star extends RootShape {
        constructor() {
            super("path");
            this.trans = [new Vector(0), new Vector(1)];
            this.coords = [new Vector(50), new Vector(50, 10)];
        }

        getData(){
            return [this.center, this.radius].map(p => [p.x, p.y])
        }

        setData(data) {
            let [center, radius] = data.map(a => new Vector(a));
            this.drawStar(center, radius);
        }

        setTransform([delta, scale]) {
            this.startTrans = [delta, scale];
            this.realTrans = [delta, scale];
            this.updateStar();
        }

        getTransform(){
            return this.realTrans;
        }

        set coords([start, end]) {
            let radius = end.sub(start);
            let center = start;
            this.drawStar(center, radius);
        }

        drawStar(center, radius) {
            this.radius = radius;
            this.center = center;
            let points = []
            for (let i = 0; i < 10; i++) {
                let p = radius.rotate(Math.PI * i  / 5).mul(i % 2 == 0 ? 1 : star_ratio).add(center);
                points.push(p)
            }
            this.points = points
            this.updateStar()
        }

        updateStar(){
            if (this.points) {
                let [delta, scale] = this.realTrans;
                this.transPoints = this.points.map(p => p.mul(scale).add(delta))
                this.d = this.transPoints;
            }
        }

        set d(points) {
            this.props = {
                d:"M" + points.join("L") + "Z"
            }
        }


        fixTransformDelta(){
            this.trans = this.realTrans;
        }

        setDragDelta(delta) {
            this.realTrans[0] = this.startTrans[0].add(delta);
            this.updateStar();
        }
    
        setScaleDelta(origin, scale) {
            let [delta_0, scale_0] = this.startTrans;
            this.realTrans = [scale.mul(delta_0.sub(origin)).add(origin), scale_0.mul(scale)];
            this.updateStar();
        }

        isIntersection(points){
            let path = "M" +this.transPoints.join("L") + "Z";
            let intersection = findPathIntersections("M"+points.join("L"), path);
            let isIntrsection = intersection.length > 0;
            return isIntrsection;
        }

    },
    triangle: class Triangle extends RootShape {
        constructor() {
            super("path");
            this.trans = [new Vector(0), new Vector(1)];
            this.coords = [new Vector(50), new Vector(50, 10)]
        }

        getData(){
            return [this.center, this.radius].map(p => [p.x, p.y])
        }
        
        setData(data) {
            let [center, radius] = data.map(a => new Vector(a));
            this.drawTriangle(center, radius);
        }

        setTransform([delta, scale]) {
            this.startTrans = [delta, scale];
            this.realTrans = [delta, scale];
            this.updateTriangle();
        }

        getTransform(){
            return this.realTrans;
        }

        drawTriangle(center, radius) {
            this.radius = radius;
            this.center = center;

            let points = []
            for (let i = 0; i < 3; i++) {
                let p = radius.rotate(Math.PI * i  / 1.5).add(center);
                points.push(p)
            }
            this.points = points;
            this.updateTriangle()
        }

        updateTriangle(){
            if (this.points) {
                let [delta, scale] = this.realTrans;
                this.transPoints = this.points.map(p => p.mul(scale).add(delta))
                this.d = this.transPoints;
            }
        }

        set coords([start, end]) {
            this.drawTriangle(start, end.sub(start))
        }

        set d(points) {
            this.props = {
                d:"M" + points.join("L") + "Z"
            }
        }

        fixTransformDelta(){
            this.trans = this.realTrans;
        }

        setDragDelta(delta) {
            this.realTrans[0] = this.startTrans[0].add(delta);
            this.updateTriangle();
        }
        setScaleDelta(origin, scale) {
            let [delta_0, scale_0] = this.startTrans;
            this.realTrans = [scale.mul(delta_0.sub(origin)).add(origin), scale_0.mul(scale)];
            this.updateTriangle();
        }


        isIntersection(points){
            let path = "M" +this.transPoints.join("L") + "Z";
            let intersection = findPathIntersections("M"+points.join("L"), path);
            let isIntrsection = intersection.length > 0;
            return isIntrsection;
        }
    },
    cloud: class Triangle extends RootShape {
        constructor() {
            super("path");
            
            this.styles = {
                "stroke-linejoin": "round"
            }
            this.coords = [new Vector(15, 30), new Vector(85, 70)]
        }

        setTransform([pos, size]) {
            this.tPos = pos;
            this.pos = pos;
            this.tSize = size;
            this.size = size;
            this.drawCloud();
        }

        getTransform(){
            return [this.tPos, this.tSize]
        }

        drawCloud(pos = this.tPos, size = this.tSize) {
            let path = new DPath("M4.33,0c-.34.02-.65.15-.94.4-.36.31-.66.76-.88,1.35-.07.18-.14.39-.19.6-.01.05-.02.1-.03.1,0,0-.02,0-.05-.02-.07-.03-.17-.06-.25-.07-.06-.01-.1-.01-.21,0-.13,0-.18.01-.3.05-.56.17-1.04.8-1.3,1.68-.25.86-.26,1.89-.01,2.76.26.92.76,1.57,1.34,1.74.13.04.32.05.45.04.2-.03.39-.11.56-.23.03-.03.06-.04.07-.04,0,0,.02.06.04.12.1.31.23.58.38.8.25.37.55.58.89.65.08.01.28.01.36,0,.35-.08.68-.33.93-.74.02-.04.05-.07.05-.07s.01.02.02.04c.01.02.04.07.07.11.29.41.61.65.98.73.09.02.32.02.41,0,.43-.09.81-.41,1.11-.94.19-.33.32-.71.42-1.16v-.03s.13,0,.13,0c.13,0,.18-.01.3-.05.21-.07.43-.23.62-.44.11-.13.26-.37.35-.55.18-.38.29-.82.34-1.28.02-.18.02-.25.02-.49,0-.25,0-.32-.03-.52-.12-1.07-.6-1.94-1.21-2.2-.23-.1-.5-.11-.73-.02-.02,0-.04.01-.05.01,0,0-.02-.05-.04-.1-.11-.35-.26-.62-.45-.84-.22-.25-.46-.37-.73-.37-.22,0-.41.08-.61.25l-.08.07-.03-.06c-.05-.09-.13-.24-.19-.32C5.49.4,5.04.07,4.57.01c-.07,0-.19-.01-.24-.01Z");
            path.makeAbsolute();
            for (let cp of path) {
                cp.mul(size.div(10));
                cp.add(pos);
            }
            this.d = path;
            this._dpath = path + "";
        }

        set coords(coords) {
            let rect = rectCoords(coords);
            this.pos = new Vector(rect);
            this.tPos = this.pos;
            this.size = new Vector(rect.width, rect.height);
            this.tSize = this.size
            this.drawCloud()
        }

        set d(dpath) {
            this.props = {
                d: dpath + "",
            }
        }


        fixTransformDelta(){
            this.pos = this.tPos;
            this.size = this.tSize;
        }

        setDragDelta(delta) {
            this.tPos = this.pos.add(delta);
            this.drawCloud()
        }
    
        setScaleDelta(origin, scale) {
            this.tSize = this.size.mul(scale);
            this.tPos = scale.mul(this.pos.sub(origin)).add(origin)
            this.drawCloud();
        }

        isIntersection(points){
            let intersection = findPathIntersections("M"+points.join("L"), this._dpath);
            let isIntrsection = intersection.length > 0;
            return isIntrsection;
        }
        
    },
}

const DASH_STYLES = {
    "solid": () => {return {
         "stroke-linecap": "round", 
         "stroke-linejoin": "round",
         "stroke-dasharray": null,
     }},
     "square-dot": (sw) => {return {
         "stroke-linecap": null,
         "stroke-linejoin": null,
         "stroke-dasharray": `${sw} ${sw}`
     }},
     "dash": (sw) => {return {
         "stroke-linecap": null,
         "stroke-linejoin": null,
         "stroke-dasharray": `${sw*5} ${sw * 5}`
     }},
     "dash-dot": (sw) => {return {
         "stroke-linecap": null,
         "stroke-linejoin": null,
         "stroke-dasharray": `${sw*5} ${sw * 1} ${sw * 1} ${sw * 1} ${sw * 1} ${sw * 1}`
     }},
     "round-dot": (sw) => {return {
         "stroke-linecap": "round",
         "stroke-linejoin": "round",
         "stroke-dasharray": `${sw*0.001} ${sw * 2}`
     }}
 }

export {BasicShapes, rectCoords, DASH_STYLES}