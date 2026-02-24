import { Vector } from "../../SvgPlus/vector.js";
import { HideShowTransition } from "../../Utilities/hide-show.js";
import { POINTERS, SvgResize } from "../../Utilities/svg-resize.js";
import { Features, SquidlyFeatureWindow } from "../features-interface.js";

const MAXTIME = 5000;
const USE_FIREBASE_FOR_POSITIONS = false;
console.log("Cursor position updates using " + (USE_FIREBASE_FOR_POSITIONS ? "Firebase" : "VideoCall data channel"))

const size2num = {
    "small": 1,
    "medium": 2,
    "large": 3,
}
const col2num = {
    "colour-1":0,
    "colour-2":1,
    "colour-3":2,
    "colour-4":3,
    "colour-5": 4,
}
const style2Key = {
    "arrow": "a",
    "guide": "r",
    "circle": "c",
}

/**
 * @typedef {Object} CursorProperties
 * @property {string} class - the class of the cursor (i.e. simple, cursor)
 * @property {number} size - the size of the cursor
 * @property {string} text - the fill colour of the cursor
 * @property {string} type - the type of the cursor (i.e. [size = 0-3][color = 0-4])
 * @property {string} guide - the svg path data for the guide
 */

class Cursor extends HideShowTransition {
    cursorIcon = null;
    constructor(){
        super("g")
    }

    /**
     * @param {CursorProperties} properties
     */
    set properties(properties) {
        let position = this.position;
        this.innerHTML = "";
        let icon = this.createChild(POINTERS[properties.class], {}, 0);
        for (let key in properties) {
            if (key !== "class")
                icon[key] = properties[key];
        }
        icon.shown = true;
        icon.position = position;
        this.cursorIcon = icon;
    }


    /**
     * @param {Vector} vector
     */
    set position(vector) {
        if (this.cursorIcon) {
            this.cursorIcon.position = vector;
        }
        this._position = vector;
    }

    get position(){
        return this._position;
    }
}

function getDefaultCursorProperties() {
    return {
        class: "simple",
        size: 20,
    }
}

export default class Cursors extends Features {
    cursorLibrary = {};
    referenceArea = "entireScreen";
    cursorTimeouts = {};

    constructor(session, sDataFrame){
        super(session, sDataFrame);
        this.cursorsPanel = new SquidlyFeatureWindow("cursors-panel");
        this.svg = this.cursorsPanel.createChild(SvgResize);
        this.svg.shown = true;
        this.svg.start();
        this.fixedAspectArea = new SquidlyFeatureWindow("fixed-aspect-reference");
        this.fullAspectArea = new SquidlyFeatureWindow("full-aspect-reference");
        this.entireScreen = this.cursorsPanel;
    }   

    
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ PUBLIC ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    
    /**
     * @param {string} name the name of the cursor who's properties are to be updated
     * @param {Object} properties the properties of the cursor
    */
   updateCursorProperties(name, properties) {

       if (typeof properties !== "object") properties = null;
       this.sdata.set(`properties/${name}`, properties);
       this._updateProperties(properties, name)
    }
    
    /**
     * @param {string} name the name of the cursor who's position is to be updated
     * @param {Vector} position of the cursor in units (i.e. [0, 1]) relative to the 
     *                          the given bounding box
     * @param {[Vector, Vector]} bbox the position and size of the bounding box to which
     *                                the position vector is relative too.
    */
    updateCursorPosition(name, position, bbox) {
        if (position !== null) {
            position = this.rel_bbox2rel_ref(position, bbox);
        }
       if (position == null) {
           this._sendCursorPosition(name, null);
           this._updatePosition(null, name)
        } else {
            position.timeStamp = new Date().getTime()
            this._sendCursorPosition(name, position);
            
            this._updatePosition(position, name)
        }
    }
    
    updateReferenceArea(name){
        this._referenceArea = name;
        this.sdata.set("reference", name);
    }
    
    rel_bbox2rel_ref(point, bbox){
        let newPos = null;
        try {
            point = point.mul(bbox[1]).add(bbox[0]);
            let [pos, size] = this.referenceBBox;
            newPos =  point.sub(pos).div(size);
        } catch (e) {
            newPos = null;
        }
        return newPos;
    }

    rel_ref2rel_entire(relPoint) {
        let newPos = null;
        try {
            let [pos, size] = this.referenceBBox;
            let screen = relPoint.mul(size).add(pos);
            let [pose, sizee] = this.cursorsPanel.bbox;
            newPos = screen.sub(pose).div(sizee);
        } catch (e) {
            newPos = null;
        }
        return newPos;
    }

    get me() {return this.sdata.isHost ? "host" : "participant"}

    get referenceBBox() {
        if (this._referenceArea in this) {
            return this[this._referenceArea].bbox;
        } else {
            return [new Vector, new Vector]
        }
    }

    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ PRIVAE ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    
    _getMouseCursorProperties(user) {
        let size = this.session.settings.get(`${user}/cursors/cursorSize`);
        let colour = this.session.settings.get(`${user}/cursors/cursorColour`);
        let style = this.session.settings.get(`${user}/cursors/cursorStyle`);
        let type = null;
        if (size != "none" && size != null) {
            size = size2num[size];
            colour = col2num[colour];
            style = style2Key[style] || "a";
            type = `${size}${colour}${style}`;
        } else {
            type = "-";
        }
        return {type, class: "cursor"}
    }

    _watchMouseCursorPosition() {
        let update = false;

        let updatef = () => {
            let props = this._getMouseCursorProperties(this.me);
            update = props.type !== null;
            if (props.type !== null) {
                this.updateCursorProperties(this.me + "-mouse", props);
            } else {
                this.updateCursorPosition(this.me + "-mouse", null, null);
            }
        }
        updatef();
        this.session.settings.addEventListener("change", (e) => {
            let {user, group} = e;
            if (user == this.me && group == "cursors") {
                updatef();
            }
        });

        window.addEventListener("mousemove", (e) => {
            if (update) {
                let pos = null;
                let size = null;
                try {
                    pos = new Vector(e.clientX, e.clientY);
                    size = new Vector(window.innerWidth, window.innerHeight);
                    pos = pos.div(size);
                } catch (e) {
                    pos = null;
                }
                this.updateCursorPosition(this.me + "-mouse", pos, [new Vector(0, 0), size]);
            } 
        });
    }

    _createNewCursor(name) {
        if (!(name in this.cursorLibrary)) {
            this.cursorLibrary[name] = {};
        }
        if (!this.cursorLibrary[name].properties) {
            this.cursorLibrary[name].properties = getDefaultCursorProperties();
        }

        let icon = new Cursor();
        icon.properties = this.cursorLibrary[name].properties;
        this.svg.appendChild(icon);
        this.cursorLibrary[name].icon = icon;
    }

    _removeCursor(name) {
        if (name in this.cursorLibrary) {
            let cursor = this.cursorLibrary[name];
            if (cursor.icon) {
                cursor.icon.remove();
            }
            delete this.cursorLibrary[name];
        }
    }

    _updateProperties(props, name) {
        if (!(name in this.cursorLibrary)) {
            this.cursorLibrary[name] = {}
        }
        this.cursorLibrary[name].properties = props
        if (this.cursorLibrary[name].icon) {
            this.cursorLibrary[name].icon.properties = props;
        }
    }

    _updatePosition(pos, name) {
        if (USE_FIREBASE_FOR_POSITIONS && pos !== null && new Date().getTime() - pos.timeStamp > MAXTIME) {
            pos = null;
        } 

        if (pos !== null) {
            clearTimeout(this.cursorTimeouts[name]);
            pos = new Vector(pos);
            pos = this.rel_ref2rel_entire(pos);
            if (!(name in this.cursorLibrary) || !this.cursorLibrary[name].icon) {
                this._createNewCursor(name);
            }
            this.cursorLibrary[name].icon.position = new Vector(pos);
            this.cursorLibrary[name].icon.show();
            this.cursorTimeouts[name] = setTimeout(() => {
                this._updatePosition(null,name);
            }, MAXTIME)

            const event = new Event(name);
            event.screenPos = pos;
            this.dispatchEvent(event)
        } else if (name in this.cursorLibrary && this.cursorLibrary[name].icon) {
            this.cursorLibrary[name].icon.hide();
        }
    }


    _sendCursorPosition(name, pos) {
        if (USE_FIREBASE_FOR_POSITIONS) {
            let value = pos == null ? null : {x: position.x, y: position.y, timeStamp: position.timeStamp};
            this.sdata.set(`positions/${name}`, value);
        } else {
            let cmd = pos ? `${name},${pos.x},${pos.y}` : `${name},0`;
            this.session.videoCall.sendData("CSR", cmd);
        }
    }

    async initialise(){
        this.sdata.onValue("reference", (val) => {
            this.referenceArea = val;
        })

        this.sdata.onChildAdded("properties", this._updateProperties.bind(this))
        this.sdata.onChildChanged("properties", this._updateProperties.bind(this))
        this.sdata.onChildRemoved("properties", (_, name) => {
            this._removeCursor(name)
        })

        if (USE_FIREBASE_FOR_POSITIONS) {
            this.sdata.onChildAdded("positions", this._updatePosition.bind(this))
            this.sdata.onChildChanged("positions", this._updatePosition.bind(this))
            this.sdata.onChildRemoved("positions", (_, name) => {
                this._updatePosition(null, name)
            })
        } else {
            this.session.videoCall.addEventListener("CSR", ({data}) => {
                let split = data.split(",");
                if (split.length == 2) {
                    this._updatePosition(null, split[0]);
                } else if (split.length == 3) {
                    let pos = new Vector(parseFloat(split[1]), parseFloat(split[2]));
                    pos.timeStamp = new Date().getTime();
                    this._updatePosition(pos, split[0]);
                }
               
            })
        }
        this._watchMouseCursorPosition();
    }

    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ STATIC ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */

    static get privatePropertyNames(){return ["svg", "cursorLibrary", "entireScreen"]}

    static get layers() {
        return {
            cursorsPanel: {
                type: "area",
                area: "entireScreen",
                index: 320,
                mode: "overlay"
            },
            fullAspectArea: {
                type: "area",
                area: "fullAspectArea",
                mode: "overlay",
                index: -1,
            },
            fixedAspectArea: {
                type: "area",
                area: "fixedAspectArea",
                mode: "overlay",
                index: -1,
            }
        }
    }

    static get name(){
        return "cursors";
    }

    static get firebaseName(){
        return "cursors";
    }
}
