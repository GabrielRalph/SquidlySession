import {Vector, SvgPlus } from "../../../SvgPlus/4.js";


function bBoxToVV(bbox) {
  return [new Vector(bbox), new Vector(bbox.width, bbox.height)]
}

let lastScale = 1;
let fixedsSizeElements = []
export class FixedSizeElement extends SvgPlus {
  constructor(el) {
    super(el)
    fixedsSizeElements.push(this);
  }

  onScale(scale){

  }
}
export class FixedSizeCircle extends FixedSizeElement {
  constructor(radius) {
    super("circle");
    this.radius = radius;
    this.onScale(lastScale)
  }

  onScale(scale){
    this.props = {r: this.radius * scale}
  }
}

class ViewBox {
  constructor(svg) {
    this._offset = new Vector;
    this._scale = 1;
    this._pos = new Vector;
    this._size = new Vector(1);
    this.svg = svg;

    this.minScale = 1;
    this.maxScale = 4.5;

    /** @type {?function} called after the user pans or zooms */
    this.onuserchange = null;

    let updating = false
    this.update = () => {
      if (!updating) {
        updating = true;
        window.requestAnimationFrame(() => {
          this.updateViewBox();
          updating = false;
        })
      }

      window.onresize = () => {
        this.updateSize();
      }
    }
  }

  getContentBBox(){
    let bbox = this.svg.getBBox();
    return bBoxToVV(bbox);
  }

  updateViewBox() {
    let {size, pos, svg} = this;
    let viewBox = "";

    if (!this.linked_element) {
      size = size.mul(this.scale).round(3);
      pos = pos.add(this.offset).round(3);
    } else {
      this.linked_element.style.setProperty("transform", `translate(${this.offset.x}px, ${this.offset.y}px) scale(${this.scale})`)
    }
    if (pos && size) viewBox = `${pos.x} ${pos.y} ${size.x} ${size.y}`
    // this.pos = pos;
    // this.size = size;
    svg.setAttribute("viewBox", viewBox);
    if (this.onupdate instanceof Function) {
      this.onupdate();
    }

  }

  updateSize(){
    let {size, pos, svg} = this;
    if (this.linked_element) {
      this.linkToElement(this.linked_element)
    } else {
      let [spos, ssize] = bBoxToVV(svg.getBoundingClientRect())
      if (!size.isZero) {
        let sr = ssize.dir().mul(size.norm());
        let ratio = sr.div(size);
        this.size = sr;
    
        size = size.mul(this.scale).round(3);
        let delta = size.mul(ratio.mul(-0.5).add(0.5));
        this.pos = pos.add(delta);
      } else {
        this.size = ssize;
        this.pos = new Vector();
      }
    }
  }

  getScreenBBox() {
    let {svg} = this;
    let bbox = svg.getBoundingClientRect();
    this._spos = new Vector(bbox);
    this._ssize = new Vector(bbox.width, bbox.height);
    return [this._spos.clone(), this._ssize.clone()]
  }

  get ssize(){return this._ssize;}
  get spos(){return this._spos;}

  set scale(v) {
    this._scale = v;

    this.update();
  }

  set offset(v) {
    if (v instanceof Vector) {
      this._offset = v;
      this.update();
    }
  }

  get offset(){return this._offset;}
  get scale(){return this._scale;}


  displayRealSize(){
    let [spos, ssize] = this.getScreenBBox();
    let [cpos, csize] = this.getContentBBox();

    let ratio = 254 / 96;
    let pr = window.devicePixelRatio
    if (pr) ratio = pr;
    let vsize = ssize.mul(ratio);

    let vpos = cpos.add(csize.div(2)).sub(vsize.div(2));


    this.viewbox = [vpos, vsize];
  }

  displayPixelSize(){
    let [spos, ssize] = this.getScreenBBox();
    this.viewbox = [spos, ssize];
  }


  linkToElement(element, sratio = 1000){
    this.linked_element = element;

    let [pos, size] = bBoxToVV(element.getBoundingClientRect())
    let maxdim = Math.max(size.x, size.y);
    if (maxdim == 0) return;

    let norm = size.div(maxdim);
    let tsize = norm.mul(sratio);
    let [spos, ssize] = this.getScreenBBox();

    let rsize = ssize.div(size);
    let rpos = spos.sub(pos).div(size);
    let vsize = rsize.mul(tsize);
    let vpos = rpos.mul(tsize);

    this.viewbox = [vpos, vsize];
  }

  get hasLinkedChanged() {
    if (!this._last_linked_i) {
      this._last_linked_i = [new Vector(), new Vector()];
    }
    let res = false;
    if (this.linked_element) {
      let [lastp, lasts] = this._last_linked_i;
      let [pos, size] = this.linkedElementViewbox;
      if (!pos.sub(lastp).isZero || !size.sub(lasts).isZero ) res = true;
      this._last_linked_i = [pos, size]
    } 
    return res;
  }

  set viewbox([pos, size]) {
    this._size = size;
    this._pos = pos;
    this.update();
  }

  get viewbox(){return [this.pos, this.size]}

  get transformedViewbox() {
    let viewbox = this.viewbox;
    if (this.linked_element) {
      return viewbox
    } else {
      let [pos, size] = this.viewbox;
      return [pos.add(this.offset), size.mul(this.scale)]
    }
  }
  get linkedElementViewbox(){
    return bBoxToVV(this.linked_element.getBoundingClientRect())
  }

  get absoluteViewbox() {return [this.pos.add(this.offset), this.size.mul(this.scale)]}

  get size() {
    if (this._size instanceof Vector) {
      return this._size.clone();
    }
    return null;
  }
  set size(size) {
    size = new Vector(size);
    this._size = size;
    this.update();
  }

  get pos() {
    if (this._pos instanceof Vector) {
      return this._pos.clone();
    }
    return null;
  }
  set pos(pos) {
    pos = new Vector(pos);
    this._pos = pos;
    this.update();
  }

  scaleAtPoint(sDelta, screenPoint, e) {
    if (this.isZoomLocked) return

    let {scale, offset} = this;
    sDelta = 1 + sDelta;
    let newScale = sDelta * scale;


    if (newScale > this.maxScale) newScale = this.maxScale;
    if (newScale < this.minScale) newScale = this.minScale;

    let delta = new Vector();
    if (this.linked_element) {
      let spos = new Vector(e);
      let [pos, size] = this.linkedElementViewbox
      let relP = spos.sub(pos.add(size.div(2)))

      delta = relP.sub(relP.mul(newScale/scale))

    } else {
      let [pos, size] = this.transformedViewbox;

      let relP = screenPoint.sub(pos);
      delta = relP.sub(relP.mul(newScale/scale));
    }


    // min scale
    // if (scale + sDelta > 0.05) {
    this.offset = offset.add(delta);
    this.scale = newScale;
    // }
    e.preventDefault();
    this._userChange();
  }

  /** Called after the user pans or zooms (not when set programmatically) */
  _userChange() {
    if (this.onuserchange instanceof Function) this.onuserchange();
  }

  drag(delta, e) {
    if (this.isPanLocked) return

    if (this.linked_element) {
      this.offset = this.offset.add(delta);
    } else {
      let [spos, ssize] = this.getScreenBBox();
      
      delta = delta.mul(this.size.div(ssize)).mul(this.scale);
      this.offset = this.offset.sub(delta);
    }
    e.preventDefault();
    this._userChange();
  }

  screenToSVG(p) {
    p = new Vector(p);
    let [spos, ssize] = this.getScreenBBox();
    let [vpos, vsize] = this.transformedViewbox;
    let deltaPercent = p.sub(spos).mul(vsize.div(ssize));
    let pos = vpos.add(deltaPercent);
    return pos;
  }

  addPanAndZoomEvents(svg) {
    let mdown = false;
    svg.addEventListener("mousedown", () => {
      mdown = true;
    })

    let lastDragPoint = null;
    svg.addEventListener("mousemove", (e) => {
      if (mdown) {
        let point = new Vector(e);
        if (lastDragPoint == null) lastDragPoint = point.clone();

        let delta = point.sub(lastDragPoint);

        this.drag(delta, e);
        

        lastDragPoint = point;
      }
    });

    svg.addEventListener("mouseleave", (e) => {
        mdown = false
        lastDragPoint = null;
    })

    svg.addEventListener("wheel", (e) => {
      let deltaS = e.deltaY * 0.002;
      let point = this.screenToSVG(e);

      this.scaleAtPoint(deltaS, point, e);

    })

    svg.addEventListener("mouseup", () => {
      mdown = false;
      lastDragPoint = null;
    })
  }
}

export class SvgView extends SvgPlus {
    constructor(){
      super("svg");
      let viewBox = new ViewBox(this);
      this.viewBoxX = viewBox;
      viewBox.isLocked = () => this.locked;
      viewBox.displayPixelSize();
      viewBox.addPanAndZoomEvents(this);
      viewBox.update = () => {
        this.render_flag = true;
        this.styles = {
          "--scale": this.scale
        }
      }
      this.start_renderer();

    }

    set isZoomLocked(val){
        this.viewBoxX.isZoomLocked = val
    }

    set isPanLocked(val) {
        this.viewBoxX.isPanLocked = val
    }
  
    set data(value){
      this.render_flag = true;
      this._data = value;
    }

    get data(){
      return this._data;
    }

    get size(){
      return this.viewBoxX.size;
    }
    
    get scale(){
      if (this.viewBoxX.linked_element) {
        return 1/this.viewBoxX.scale;
      }
      return this.viewBoxX.scale;
    }


    resetView(){
      this.reset_start = performance.now();
      this.reset_scale = this.viewBoxX.scale;
      this.reset_offset = this.viewBoxX.offset;
    }

    async start_renderer(){
      let lastSize = this.bbox[1];
      while (!this.stop_render) {
        let currentSize = this.bbox[1]

        if (!currentSize.sub(lastSize).isZero) {
          this.render_flag = true;
        }
        if (this.viewBoxX.hasLinkedChanged) {
          this.render_flag = true;
        }
        lastSize = currentSize;

        

        let reset = false;
        if (this.reset_start) {
          reset = true;
          let dt = (performance.now() - this.reset_start) / 300;
          if (dt > 1) {
            dt = 1;
            this.reset_start = false;
          } 
          dt = (1 - Math.cos(dt * Math.PI))/2;
          this.viewBoxX.scale = dt + (1- dt) * this.reset_scale;
          this.viewBoxX.offset = this.reset_offset.mul(1 - dt);
        }

        if (this.render_flag || reset) {
          this.viewBoxX.updateSize();
          this.viewBoxX.updateViewBox();

          lastScale = this.scale;
          fixedsSizeElements.forEach(e => e.onScale(this.scale))
          this.render_flag = false;
        }
        

        await new Promise((resolve, reject) => {
          window.requestAnimationFrame(resolve);
        })
      }
    }
}

