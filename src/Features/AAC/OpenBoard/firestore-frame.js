import { FStore } from "../../../Firebase/firebase.js";

const { collection, doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, where, limit, query, and, or, serverTimestamp } = FStore;

/**
 * Add a clone method to the Firestore Timestamp prototype 
 * to create a new instance with the same 
 * seconds and nanoseconds values.
 */
FStore.Timestamp.prototype.clone = function() {
    return new FStore.Timestamp(this.seconds, this.nanoseconds);
}

const TimestampSymbol = Symbol("TimeStamp");

function replaceWithTimeStamp(obj) {
    if (obj && typeof obj === 'object') {
        for (let key in obj) {
            if (obj[key] === TimestampSymbol) {
                obj[key] = serverTimestamp();
            } else {
                replaceWithTimeStamp(obj[key]);
            }
        }
    }
}

/**
 * @typedef {string} DocumentID
 * @typedef {("added"|"modified"|"removed")} ChangeType
 * @typedef {[DocumentID, Object, ChangeType, Object]} Change
 */
class FirestoreFrame {
    listenerTerminators = new Set()
    constructor(collectionName) {
        this.collectionName = collectionName;
    }

    get colRef() {
        return collection(this.collectionName);
    }

    clearListeners() {
        for (const terminate of this.listenerTerminators) {
            terminate();
        }
        this.listenerTerminators = [];
    }

    /**
     * @param {...any} queryArgs - The arguments to pass to the Firestore query function.
     * @returns {FStore.Query}
     */
    query(...queryArgs) {
        return query(this.colRef, ...queryArgs);
    }

    doc(id) {
        return doc(this.colRef, id);
    }

    newDocID() {
        return doc(this.colRef).id;
    }


    /**
     * @param {string|FStore.Query} id - The document ID or a Firestore Query.
     * @param {function} callback - The callback function to be called when the document value changes.
     * @param {function} errorCallback - The callback function to be called when an error occurs.
     * @returns {function} A function that can be called to remove the listener.
     * 
     * @overload
     * @param {string} id - The document ID.
     * @param {(args: Object) => any} callback - The callback function to be called when the document value changes.
     * @param {function} errorCallback - The callback function to be called when an error occurs.
     * @returns {function} A function that can be called to remove the listener.
     * 
     * @overload
     * @param {FStore.Query} id - A Firestore Query.
     * @param {(args: Change[]) => any} callback - The callback function to be called when the query results change.
     * @param {function} errorCallback - The callback function to be called when an error occurs.
     * @returns {function} A function that can be called to remove the listener.
     */
    onValue(id, callback, errorCallback) {
        let docRef = null;
        let isQuery = false;
        if (typeof id === "string") {
            docRef = this.doc(id);
        } else if (id instanceof FStore.Query) {
            docRef = id;
            isQuery = true;
        } else {
            throw new Error("Invalid argument: id must be a string or a Firestore Query.");
        }
        const end = FStore.onSnapshot(docRef, {
            next: (docSnap) => {
                if (isQuery) {
                    const data = docSnap.docChanges().map(change => [
                        change.doc.id,
                        change.doc.data(),
                        change.type,
                        change
                    ])
                    callback(data);
                } else {
                    if (docSnap.exists()) {
                        callback(docSnap.data());
                    } else {
                        callback(null);
                    }
                }
            },
            error: errorCallback
        });
        this.listenerTerminators.add(end);
        return () => {
            end();
            this.listenerTerminators.delete(end);
        }
    }   

    /**
     * @param {string|FStore.Query} id - The document ID or a Firestore Query.
     * @param {function} callback - The callback function to be called when the document value changes.
     * @returns {Promise<function>} A function that can be called to remove the listener.
     * 
     * @overload
     * @param {string} id - The document ID.
     * @param {(args: Object) => any} callback - The callback function to be called when the document value changes.
     * @returns {Promise<function>} A function that can be called to remove the listener.
     * 
     * @overload
     * @param {FStore.Query} id - A Firestore Query.
     * @param {(args: Change[]) => any} callback - The callback function to be called when the query results change.
     * @returns {Promise<function>} A function that can be called to remove the listener.
     */
    async onValuePromise(id, callback) {
        let end;
        await new Promise((resolve, reject) => {
            end = this.onValue(id, async (data) => {
                let value = callback(data);
                if (value instanceof Promise) { await value }
                resolve();
            }, reject);
        });
        return end;
    }

   
    async get(id) {
        let res = null;
        if (typeof id === "string") {
            let doc = await getDoc(this.doc(id));
            if (doc.exists()) {
                res = doc.data();
            }
        } else if (id instanceof FStore.Query) {
            docs = await getDocs(id);
            res = Object.fromEntries(docs.docs.map(doc => [doc.id, doc.data()]));
        } else {
            throw new Error("Invalid argument: id must be a string or a Firestore Query.");
        }
        return res;
    }

    async set(id, data, options = { merge: false }) {
        replaceWithTimeStamp(data);
        const docRef = this.doc(id);
        await setDoc(docRef, data, options);
    }

    async update(id, data) {
        replaceWithTimeStamp(data);
        const docRef = this.doc(id);
        await updateDoc(docRef, data);
    }

    async delete(id) {
        const docRef = this.doc(id);
        await deleteDoc(docRef);
    }

    async batchUpdate(updates) {
        const batch = writeBatch();
        for (const [id, data] of Object.entries(updates)) {
            const docRef = this.doc(id);
            batch.update(docRef, data);
        }
        await batch.commit();
    }

    async batchSet(sets, options = { merge: false }) {
        const batch = writeBatch();
        for (const [id, data] of Object.entries(sets)) {
            replaceWithTimeStamp(data);
            const docRef = this.doc(id);
            batch.set(docRef, data, options);
        }
        await batch.commit();
    }

    static get TimestampSymbol() {
        return TimestampSymbol
    }
}


export { FirestoreFrame };