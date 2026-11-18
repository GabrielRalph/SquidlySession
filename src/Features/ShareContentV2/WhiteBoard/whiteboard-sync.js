import { ElementChangeEvent } from "./Element/interface.js";

/**
 * Keeps a WhiteBoard in sync with a Firebase realtime database location.
 *
 * This is the logic that used to live in WhiteboardFirebaseFrame. It is no
 * longer a FirebaseFrame subclass, it is given one. You normally don't
 * create it yourself. Pass a frame to the WhiteBoard instead:
 *
 *     whiteboard.setFirebaseFrame(frame)
 *
 * The frame can be any object that implements the FirebaseFrame interface
 * used here: `uid`, `get(path)`, `set(path, value)`, `onValue(path, cb)`,
 * `onChildAdded(path, cb)` and `onChildRemoved(path, cb)`, where each `on*`
 * method returns a function that removes the listener.
 *
 * @typedef {import("../../../Firebase/firebase-frame.js").FirebaseFrame} FirebaseFrame
 * @typedef {import("./whiteboard.js").WhiteBoard} WhiteBoard
 */

const minimumUpdateInterval = 40; //ms
const instanceID = Math.round(Math.random() * 100000) + "";

const specific_change_types = ["styleSet", "data", "trans", "order"];

export function toFBData(json) {
    let r = (o) => {
        let res = o;
        if (Array.isArray(o)) {
            res = {isArray: o.length}
            if ("light" in o) res.light = o.light;
            if ("upid" in o) res.upid = o.upid;
            for (let i = 0; i < o.length; i++) res[i] = r(o[i])
        } else if (o !== null && typeof o === "object") {
            res = {};
            for (let key in o) res[key] = r(o[key]);
        }
        return res;
    }

    return r(json);
}

export function fromFBData(json) {
    let r = (o) => {
        let res = o;
        if (o !== null && typeof o === "object") {
            if (o.isArray) {
                res = new Array(o.isArray);
                for (let i = 0; i < o.isArray; i++) res[i] = r(o[i])
            } else {
                res = {};
                for (let key in o) {
                    if (key !== "upid" && key !== "light") {
                        res[key] = r(o[key])
                    }
                }
            }
        }
        return res;
    }

    return r(json);
}

export class WhiteBoardSync {
    /**
     * @param {FirebaseFrame} frame
     * @param {WhiteBoard} whiteboard
     */
    constructor(frame, whiteboard) {
        this.frame = frame;
        this.whiteboard = whiteboard;

        this.sentUpdateIds = new Set();
        this.lastUpdatTS = {};
        this.changeBuffers = {};

        /** listener removers for each element id */
        this.elementListeners = {};
        /** listener removers for the root listeners */
        this.rootListeners = [];
        this.closed = false;

        let isInit = {};

        this.rootListeners.push(frame.onChildRemoved(null, (oldData, id) => {
            if (id in this.elementListeners) {
                for (let end of this.elementListeners[id]) end();
                delete this.elementListeners[id]
                this._onChange({
                    type: "deletion",
                    data: fromFBData(oldData),
                    id: id,
                    upid: oldData.upid,
                    light: oldData.light
                })
            }
        }));

        this.rootListeners.push(frame.onChildAdded(null, (data, id) => {
            this._onChange({
                type: "creation",
                data: fromFBData(data),
                id: id,
                upid: data.upid,
                light: data.light
            })
            isInit[id] = {};
            this.elementListeners[id] = specific_change_types.map(k => {
                isInit[id][k] = false;
                return frame.onValue(`${id}/${k}`, (d) => {
                    if (!isInit[id][k]) {
                        isInit[id][k] = true;
                    } else if (d != null) {
                        this._onChange({
                            type: k,
                            data: fromFBData(d),
                            id: id,
                            upid: d.upid,
                            light: d.light
                        })
                    }
                })
            })
            if (data.light) {
                let createdListener = frame.onValue(`${id}/light`, async (light) => {
                    if (light === false) {
                        createdListener();

                        let cdata = await frame.get(id);
                        if (this.closed || cdata == null) return;
                        this._onChange({
                            type: "creation",
                            data: fromFBData(cdata),
                            id: id,
                            upid: cdata.upid,
                            light: cdata.light
                        })
                    }
                })
                this.elementListeners[id].push(createdListener);
            }
        }));

        this.watchChanges();
    }

    get uid() {
        return this.frame.uid;
    }

    /** Called with changes made by other users/instances.
     * @param {ElementChangeEvent} cData */
    onChange(cData) {
        this.whiteboard.pushChange(cData)
        this.whiteboard.updateSelection();
    }

    _onChange(e) {
        if (this.closed) return;
        if (e.upid) {
            if (this.sentUpdateIds.has(e.upid)) {
                this.sentUpdateIds.delete(e.upid);
            } else {
                let [ts, uid, iid] = e.upid.split("-");
                let e2 = new ElementChangeEvent(e.id, e.type, e.data, parseFloat(ts), e.light)
                e2.isMe = uid === this.uid;
                e2.isInstance = iid === instanceID;
                this.onChange(e2);
            }
        }
    }

    async lockElement(e) {
        // Send a buffered creation first. Otherwise the lock would create the
        // element's database entry, so other users' onChildAdded fires
        // without the element and they never see it.
        const pending = this.changeBuffers.creation?.[e.id];
        if (pending != null) {
            delete this.changeBuffers.creation[e.id];
            this.sendChange(pending);
        }
        try {
            await this.frame.set(`${e.id}/locked`, this.uid);
            return true;
        } catch (err) {
            console.log(err);
            return false;
        }
    }

    async releaseElement(e) {
        try {
            await this.frame.set(`${e.id}/locked`, false);
        } catch (err) {}
    }

    async watchChanges(){
        if (this._isWatching) return;
        this._isWatching = true;
        this.stopWatching = false;
        while (!this.stopWatching) {
            this.sendChanges();
            await new Promise((resolve) => {setTimeout(resolve, minimumUpdateInterval)})
        }
        this._isWatching = false;
    }

    sendChanges(){
        // for every change type and changes for that type
        for (let type of ["creation", ...specific_change_types, "deletion"]) {
            if (type in this.changeBuffers) {
                for (let id in this.changeBuffers[type]) {
                    let change = this.changeBuffers[type][id];
                    if (change != null) {
                        // send the most recent change
                        this.sendChange(change);
                        delete this.changeBuffers[type][id]
                    }
                }
            }
        }
    }

    async sendChange(e) {
        try {
            let type = e.changeType
            let id = e.elementId;
            let path = id;
            let json = e.data;
            let upid = `${e.ts}-${this.uid}-${instanceID}`
            json.light = e.light;
            json.upid = upid;

            switch (type) {
                case "deletion":
                    json = null;
                    break;
                case "styleSet":
                case "trans":
                case "data":
                case "order":
                    path = `${id}/${type}`
                    break;
            }

            this.sentUpdateIds.add(upid);
            if (type === "deletion") {
                await this.frame.set(`${id}/upid`, upid)
            }
            this.lastUpdatTS[id] = e.ts;
            let parsed = toFBData(json)
            await this.frame.set(path, parsed);
        } catch (x) {

        }
    }

    /** Buffers a local change, only the latest change of each type
     *  per element is sent every `minimumUpdateInterval` ms.
     * @param {ElementChangeEvent} e */
    addChange(e){
        if (this.closed) return;
        let type = e.changeType
        let id = e.elementId;

        if (!(type in this.changeBuffers)) {
            this.changeBuffers[type] = {}
        }
        this.changeBuffers[type][id] = e;
    }

    /** Sends any pending changes, then removes all listeners and stops
     *  syncing. Does NOT delete anything from the database. */
    close() {
        if (this.closed) return;
        this.sendChanges();
        this.closed = true;
        this.stopWatching = true;
        for (let end of this.rootListeners) if (end instanceof Function) end();
        for (let id in this.elementListeners) {
            for (let end of this.elementListeners[id]) if (end instanceof Function) end();
        }
        this.rootListeners = [];
        this.elementListeners = {};
    }
}
