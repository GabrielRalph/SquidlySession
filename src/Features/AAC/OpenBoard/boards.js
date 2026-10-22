import * as FB from "../../../Firebase/firebase.js";
import { OBBoard, OBButton } from "./openboard.js";
import { FirestoreFrame } from "./firestore-frame.js";
import { DataClass } from "./dataclass.js";
import { copy,  isEqual } from "../shared.js";
import { Path } from "./Path.js";
import { Debugger, relURL } from "../../../Utilities/usefull-funcs.js";
const {FStore: {where}} = FB;
const timerLogger = new Debugger("T", "background: #1a73e8; color: white; padding: 5px; border-radius: 5px;");


/** 
 * @typedef {OBBoard<OBButton>} OBBoardType
 */
/***********************
 * CONSTANTS AND CAHCES
 /**********************/
const debug = new Debugger("OB-Boards", "background: black; color: limegreen; padding: 5px; border-radius: 5px;");

const META = new FirestoreFrame("boards");
const DRAFTS = new FirestoreFrame("draft-boards");

const MAX_RECENT_BOARDS = 10;

const BOARD_CACHE = {};
const BOARD_LISTENERS = {}
const BOARD_META_CACHE = {};
const META_DATA_CALLBACKS = {};
const BOARD_LISTENERS_RESOLVED = {}
const DRAFT_VERSION_CACHE = {};

const USER_NAME_CACHE = {
    squidly: Promise.resolve({
        name: "Squidly", 
        pronouns: "they/them", 
        displayPhoto: relURL("../../Assets/logo.svg", import.meta)
    })
};

let RECENT_BOARDS = [];


async function getUserInfo(uid) {
    if (!(uid in USER_NAME_CACHE)) {
        USER_NAME_CACHE[uid] = (async () => {
            let [dName, firstName, lastName, pronouns, displayPhoto] = await Promise.all([
                (await FB.get(FB.ref(`users/${uid}/info/displayName`))).val(),
                (await FB.get(FB.ref(`users/${uid}/info/firstName`))).val(),
                (await FB.get(FB.ref(`users/${uid}/info/lastName`))).val(),
                (await FB.get(FB.ref(`users/${uid}/info/pronouns`))).val(),
                (await FB.get(FB.ref(`users/${uid}/info/displayPhoto`))).val(),
            ]);
        
            let name = !dName || dName.trim() === "" ? 
                `${firstName || ""} ${lastName || ""}`.trim() 
                : 
                dName;
            return {name, pronouns, displayPhoto};
        })();
    }
    return await USER_NAME_CACHE[uid];
}



/***************
 * RECENT BOARDS
 ***************/

try {
    RECENT_BOARDS = JSON.parse(window.localStorage.getItem("recentBoards") || "[]");
    RECENT_BOARDS = RECENT_BOARDS.filter(board => typeof board === "string");
} catch (e) {}


function addBoardToRecent(boardID) {
    if (!boardID || typeof boardID !== "string") return;
    const index = RECENT_BOARDS.indexOf(boardID);
    if (index !== -1) {
        RECENT_BOARDS.splice(index, 1);
    }
    RECENT_BOARDS.unshift(boardID);
    if (RECENT_BOARDS.length >  MAX_RECENT_BOARDS) {
        RECENT_BOARDS = RECENT_BOARDS.slice(0, MAX_RECENT_BOARDS);
    }
    window.localStorage.setItem("recentBoards", JSON.stringify(RECENT_BOARDS));
}

function getRecentBoards() {
    return [...RECENT_BOARDS];
}

/*****************************************
 * DATA CLASSES AND OTHER CLASS STRUCTURES
 *****************************************/

class ServerTimestamp {
    constructor(value) {
        this.value = value;
        if (!value || typeof value !== "object" || !("seconds" in value) || !("nanoseconds" in value)) {
            this.date = null;
            this.time = 0
        } else {
            this.time = value.seconds * 1000 + value.nanoseconds / 1000000;
            this.date = new Date(value.seconds * 1000 + value.nanoseconds / 1000000);
        }
    }

    get valid() {
        return this.date !== null;
    }

    newer(other) {
        return this.time > other.time;
    }

    toString() {
        if (!this.date) return "-";
        return this.date.toISOString();
    }

    toJSON() {
        return copy(this.value);
    }
}

class MetadataError {
    constructor(code = 500, sourceError = null) {
        this.code = code;
        this.sourceError = sourceError;
    }

    toJSON() {
        return {
            code: this.code,
            sourceError: this.sourceError
        };
    }
}

class BoardMetadata extends DataClass {
 

    error = null;
    static error_parser(value) { 
        if (typeof value === "number") {
            return new MetadataError(value, null);
        } else if (typeof value === "object" && value !== null) {
            return new MetadataError(value?.code ?? 500, value?.sourceError ?? null);
        } else {
            return null;
        }
    }

    /** @type {string} */
    path = null;
    static path_parser(value) { return Path.parse(value); }

    /** @type {string} */
    owner = null;

    /** @type {ServerTimestamp} */
    createdAt = new ServerTimestamp(null);
    static createdAt_parser(value) { return new ServerTimestamp(value); }

    /** @type {ServerTimestamp} */
    updatedAt = new ServerTimestamp(null);
    static updatedAt_parser(value) { return new ServerTimestamp(value); }

    /** @type {ServerTimestamp} */
    deletedAt = new ServerTimestamp(null);
    static deletedAt_parser(value) { return new ServerTimestamp(value); }

    /** @type {boolean} */
    isDirectory = false;

    /** @type {boolean} */
    public = false;

    /** @type {boolean} */
    favourite = false;

    /** @type {boolean} */
    effectivePublic = false;

    /** @type {boolean | string} */
    thumbnail = false;

    get valid() {
        return this.error === null && !this.deletedAt.valid;
    }

    newer(other) {
        if (other instanceof BoardMetadata) {
            return this.updatedAt.newer(other.updatedAt);
        } else if (other instanceof ServerTimestamp) {
            return this.updatedAt.newer(other);
        }
    }

    static make(data) {
        let boardMetadata = null;
        if (!data || typeof data !== "object") {
            boardMetadata = this.error(404, null);
        } else {
            boardMetadata = super.make(data);
        }
        return boardMetadata;
    }

    static error(code, sourceError) {
        let error;
        if (code instanceof MetadataError) {
            error = code;
        } else {
            error = new MetadataError(code, sourceError);
        }
        return this.make({error});
    }

    /**
     * @returns {Promise<{name: string, pronouns: string, displayPhoto: string}>}
     */
    async getOwnerName() {
        return await getUserInfo(this.owner);
    }


    clone() {
        return BoardMetadata.make(this.toJSON());
    }

}

/***********************************
 * METADATA AND BOARD CACHING SYSTEM
 ***********************************/

/**
 * Returns weather the board needs to be reloaded.
 * If the board is not in the cache, or if the metadata 
 * is newer than the cached board, it needs to be reloaded.
 *  
 * @param {string} boardID
 * @param {BoardMetadata} metadata
 * @return {boolean}
 */
function needsReload(boardID, metadata) {
    if (!(boardID in BOARD_CACHE)) {
        return true;
    }
    const cachedBoard = BOARD_CACHE[boardID];
    return metadata.newer(cachedBoard.lastUpdated);
}


/**
 * Loads a board by its ID, either from a URL or from Firestore.
 * @param {string} id
 * 
 * @returns {Promise<OBBoardType>}
 */
async function _loadBoard(id) {
    let board = null;

    timerLogger.tic("download " + id); 
    if (id.startsWith("http")) {
        try {
            const response = await fetch(id);
            const text = await response.text();
            board = OBBoard.make(JSON.parse(text));
        } catch (e) {
            console.warn(`Error loading board from URL ${id}:`, e);
        }
    } else {
        try {
            const blob = await FB.getFile(`boards/${id}`);
            const text = await blob.text();
            board = OBBoard.make(JSON.parse(text));
        } catch (e) {
            console.warn(`Error loading board from Firestore ${id}:`, e);
        }
    }
    timerLogger.toc("download " + id);
    return board;
}

/**
 * Calls all registered metadata callbacks for a given board ID.
 * @param {string} id
 */
function _callMetadataCallbacks(id) {
    if (id in META_DATA_CALLBACKS) {
        for (const callback of META_DATA_CALLBACKS[id]) {
            callback(BOARD_META_CACHE[id].clone());
        }
    }
}

/**
 * Registers a callback function to be called whenever 
 * the metadata for the specified board ID is updated.
 * @param {string} id
 * @param {(metadata: BoardMetadata) => void} callback
 */
function _registerMetadataCallback(id, callback) {
    if (callback instanceof Function) {
        if (!(id in META_DATA_CALLBACKS)) {
            META_DATA_CALLBACKS[id] = new Set()
        }
        META_DATA_CALLBACKS[id].add(callback);
    }
}

/**
 * Unregisters a callback function for the specified board ID.
 * @param {string} id
 * @param {(metadata: BoardMetadata) => void} callback
 */
async function _unregisterMetadataCallback(id, callback, stopListener = true) {
    if (callback instanceof Function && id in META_DATA_CALLBACKS) {
        META_DATA_CALLBACKS[id].delete(callback);
        if (META_DATA_CALLBACKS[id].size === 0) {
            delete META_DATA_CALLBACKS[id];
            if (stopListener) {
                await _stopMetadataListener(id);
            }
        }
    }
}


/**
 * @param {string} id
 * @param {(metadata: BoardMetadata) => void} [callback] - A function to be called when the metadata is updated.
 * 
 * @returns {Promise<BoardMetadata>}
 */
async function _setupMetadataListener(id, callback = null) {
    timerLogger.tic("get metadata " + id);
    let deregister = () => {}

    try {
        // Register the metadata callback and set up the deregister function.
        _registerMetadataCallback(id, callback);
        deregister = () => _unregisterMetadataCallback(id, callback);

        // If the board metadata is not already being
        // listened to, set up a listener.
        if (!(id in BOARD_LISTENERS)) {
            debug.log("listening", id);

            // Create the listener for the board metadata.
            BOARD_LISTENERS[id] = META.onValuePromise(id, async (data) => {
                // Create the BoardMetadata object from the data.
                const metadata = BoardMetadata.make(data);

                // Error cases
                //  data = null: 404, no metadata available 
                //  metadata.updatedAt.invalid: 204, no board file saved yet
                if (data === null || typeof data !== "object") {
                    metadata.error = new MetadataError(404);
                } else if (!metadata.updatedAt.valid) {
                    metadata.error = new MetadataError(204);
                } else if (metadata.deletedAt.valid) {
                    metadata.error = new MetadataError(410);
                }

                // Store metadata in the cache.
                BOARD_META_CACHE[id] = metadata;

                // Trigger all registered metadata callbacks for this board.
                _callMetadataCallbacks(id);

                // Mark the listener as resolved.
                BOARD_LISTENERS_RESOLVED[id] = true;
                debug.log("metadata ", id, metadata);
            });
        } 

        // If the listener has already been resolved, and a callback 
        // is provided, call the provided callback immediately.
        if (BOARD_LISTENERS_RESOLVED[id] === true && callback instanceof Function) {
            _callMetadataCallbacks(id);

        // Otherwise if the listener has not yet been resolved, 
        // wait for it to resolve. In this case the callback will 
        // be called once the listener resolves.
        } else if (BOARD_LISTENERS_RESOLVED[id] != true) {
            await BOARD_LISTENERS[id];
        }

    } catch (e) {
        // If an error occurs while fetching the metadata the
        // default code is 500.
        let newError = new MetadataError(500, e);

        // Check for permission-denied errors and set 
        // the appropriate error code.
        if (e.code === "permission-denied") {
            newError.code = 403;
        } 

        // Create an invalid BoardMetadata object with the error.
        BOARD_META_CACHE[id] = BoardMetadata.error(newError);

        // Trigger all registered metadata callbacks for this board.
        _callMetadataCallbacks(id);
    }

    timerLogger.toc("get metadata " + id);

    return deregister;
}

async function _stopMetadataListener(id) {
    if (BOARD_LISTENERS[id]) {
        // Remove the entry synchronously so that a listener set up while
        // this one is closing creates a fresh listener instead of reusing it.
        const listener = BOARD_LISTENERS[id];
        delete BOARD_LISTENERS[id];
        BOARD_LISTENERS_RESOLVED[id] = false;
        (await listener)();
    }
}

/**
 * Fetches the Squidly board for the given ID, using the cache if possible.
 * If the board cannot be found or loaded, the promise resolves to null.
 * 
 * @param {string} id
 * @returns {Promise<?OBBoardType>}
 */
async function _getSquidlyBoard(id) {
    // Ensure the metadata listener is set up before proceeding.
    await _setupMetadataListener(id);

    // Get the current metadata for the board from the cache.
    const metadata = BOARD_META_CACHE[id];

    let board = null;

    // If metadata exists, there is no error and it is valid, 
    // proceed to check if the board needs updating.
    if (metadata && !metadata.error && metadata.valid) {

        // If the board needs to be reloaded based 
        // on the metadata, load it from the server.
        if (needsReload(id, metadata)) {
            debug.log("get board", id, "is new or updated, loading from server");
            BOARD_CACHE[id] = {
                board: _loadBoard(id), 
                lastUpdated: metadata.updatedAt
            };
        } else {
            debug.log("get board", id, "is up to date, using cached version");
        }

        // Wait for the board to be loaded from the cache or server.
        board = await BOARD_CACHE[id].board;
    }

    return board;
}

/**
 * Fetches the metadata for the specified board.
 * This function also begins listening for metadata
 * updates if it hasn't already.
 * 
 * @param {string} id
 * @returns {Promise<BoardMetadata>}
 */
async function getBoardMetadata(id) {
    await _setupMetadataListener(id);
    return BOARD_META_CACHE[id].clone();
}


/**
 * Starts listening for metadata updates for the specified board.
 * When metadata updates are received for the specified board, 
 * the provided callback is invoked. The function will resolve
 * after the listener has been successfully set up and the callback 
 * is invoked at least once with the current metadata. 
 * The returned function can be called 
 * to stop listening for updates.
 * 
 * @param {string} id
 * @param {(metadata: BoardMetadata) => void}
 * 
 * @returns {Promise<() => void>}
 */
async function setupMetadataListener(id, callback) {
    return await _setupMetadataListener(id, callback);
}



/**
 * Gets the board for the specified ID. 
 * If the ID is a URL, it loads the board directly 
 * from the server. Otherwise, it retrieves the board
 * from the cache or loads it if necessary.
 * 
 * @param {string} id
 * 
 * @returns {Promise<OBBoardType>}
 */
async function getBoard(id) {
    if (id.startsWith("http")) {
        return await _loadBoard(id);
    } else {
        return await _getSquidlyBoard(id);
    }
}

/*****************************************
 * BOARD WATCHER
 *****************************************/

class BoardWatcher {
    #id = null;

    #savedBoardPromise = Promise.resolve();

    /** @type {Promise<void> | null} */
    #watchProm = null;

    #savedBoard = null;
    #draftBoard= null;

    #version = 0;

    #callback = null;
    
    #metadata = null;
    #enders = [];
    
    #initalised = false;
    #saving = false;

    #isPendingChanges = false;

    #editable = false;

    constructor(id, callback) {
        if (id.startsWith("http")) {
            throw new Error("Drafts cannot be watched from URL");
        }

        this.#id = id;
        this.#callback = callback;
        this.debugger = new Debugger(`BW-${id.slice(-5)}`, "background: black; color: orange; padding: 5px; border-radius: 5px;");
    }

   
    #triggerCallback() { 
        this.#isPendingChanges =!isEqual(this.#draftBoard, this.#savedBoard);
        if (this.#initalised && this.#callback instanceof Function) {
            this.log("Call")
            this.#callback();
        }
    }


    #onDraftUpdate(data) {
        let [draft, version] = [null, 0];
        if (data !== null && typeof data === "object") {
            try {
                version = data.version || 0;
                draft = OBBoard.make(JSON.parse(data.board || "{}"));
            } catch (e) {
                this.log("Failed to parse draft data", e);
            }
        }
        
        if (version !== this.#version || !isEqual(draft, this.#draftBoard)) {
            this.#version = version;
            this.#draftBoard = draft;
            this.log("Draft updated", { version: this.#version, draft: this.#draftBoard });
            this.#triggerCallback();
        }
    }

    async #onMetadataUpdate(metadata) {
        if (!isEqual(metadata, this.#metadata)) {
            this.#metadata = metadata;
            this.#savedBoardPromise = getBoard(this.#id);
            this.#savedBoard = await this.#savedBoardPromise;
            this.#triggerCallback();
        }
    }
     
    log(...args) {
        this.debugger.logBasic(...args);
    }

    stop() {
        this.#enders.forEach(end => end());
        this.#watchProm = null;
    }

    async watch() { 
        if (!this.#watchProm) {
            this.#editable = true;
            this.#watchProm = (async () => {
                this.#enders = await Promise.all([
                    (async () => {
                        try {
                            return await DRAFTS.onValuePromise(this.#id, this.#onDraftUpdate.bind(this))
                        } catch (e) {
                            this.#editable = false;
                            return () => {};
                        }
                    })(),
                    setupMetadataListener(this.#id, this.#onMetadataUpdate.bind(this))
                ])
                await this.#savedBoardPromise
                this.#initalised = true;
                this.#triggerCallback();
            })();
        } 
        await this.#watchProm;
    }
   

    async save() {
        if (this.#saving) return;
        this.#saving = true;
        this.log("Calling update function");
        let response = await FB.callFunction('OBBoards-update', {
            boardID: this.id,
        }, "australia-southeast1");
        this.log("Save response", response);
        this.#saving = false;
    }

    async updateDraft(data) {
        this.#version = (this.#version || 0) + 1;
        this.#draftBoard = OBBoard.make(data);

        let update = {
            board: JSON.stringify(this.#draftBoard),
            version: this.#version,
            timestamp: FirestoreFrame.TimestampSymbol
        }

        this.#isPendingChanges = !isEqual(this.#draftBoard, this.#savedBoard);

        try {
            this.log("Updating draft");
            await DRAFTS.set(this.#id, update);
        } catch (error) {
            this.log("Failed to update draft for board", this.id, "with data", update, "Error:", error);
        }
    }

    sameAsDraft(data) {
        return isEqual(this.#draftBoard, data ? OBBoard.make(data) : null);
    }
  
    get metadata() {
        return this.#metadata ? this.#metadata.clone() : null;
    }
    
    get draft() {
        return this.#draftBoard ? OBBoard.make(this.#draftBoard) : null;
    }

    get saved() {
        return this.#savedBoard ? OBBoard.make(this.#savedBoard) : null;
    }

    get pendingChanges() {
        return this.#isPendingChanges;
    }

    get editable() {
        return this.#editable;
    }

    get currentBoard() {
        if (this.#draftBoard) {
            return this.draft;
        } else if (this.#savedBoard) {
            return this.saved;
        } else {
            return this.defaultBoard()
        }
    }

    get isSaving() {
        return this.#saving;
    }

    get id() {
        return this.#id;
    }

    defaultBoard() {
        return OBBoard.makeEmptyBoard(4, 5, this.id);
    }

    static async forceSave(boardData, boardID) {
        const lastDraft = await DRAFTS.get(boardID);
        const board = OBBoard.make(boardData);
        board.id = boardID;
        await DRAFTS.set(boardID, {
            board: JSON.stringify(board),
            version: (lastDraft?.version ?? 0) + 1,
            timestamp: FirestoreFrame.TimestampSymbol
        });
        let response = await FB.callFunction('OBBoards-update', {
            boardID,
        }, "australia-southeast1");
        return response;
    }
}


/*****************************************
 * BOARD SET WATCHER
 *****************************************/

const REPLACEMENT_BOARDS = {
    410: {"id":"410","grid":{"rows":4,"columns":5,"order":[[null,null,null,null,null],[null,"a","a","a",null],[null,"a","a","a",null],[null,null,null,null,null]]},"name":"empty board","buttons":[{"id":"a","font_size":"huge","label":"This board has been deleted","image_id":"PFREWmqwNlOtWgm0gES4","actions":[":home"],"label_at_bottom":true,"background_color":"transparent","border_color":"transparent","text_color":"#ffffff"}],"images":[{"id":"PFREWmqwNlOtWgm0gES4","width":72,"height":72,"url":"deleted-board","content_type":"image/svg","name":"delete"}]},
    403: {"id":"403","grid":{"rows":4,"columns":5,"order":[[null,null,null,null,null],[null,"a","a","a",null],[null,"a","a","a",null],[null,null,null,null,null]]},"name":"empty board","buttons":[{"id":"a","font_size":"huge","label":"You do not have access to this board","image_id":"ERJvjORWjgjBI7gKXkfM","actions":[":home"],"label_at_bottom":true,"background_color":"transparent","border_color":"transparent","text_color":"#ffffff"}],"images":[{"id":"ERJvjORWjgjBI7gKXkfM","width":72,"height":72,"url":"lock","content_type":"image/svg","name":"locked"}]},
    404: {"id":"404","grid":{"rows":4,"columns":5,"order":[[null,null,null,null,null],[null,"a","a","a",null],[null,"a","a","a",null],[null,null,null,null,null]]},"name":"empty board","buttons":[{"id":"a","font_size":"huge","label":"This board no longer exists","image_id":"XjRJeDtwU55bUR1RjmNB","actions":[":home"],"label_at_bottom":true,"background_color":"transparent","border_color":"transparent","text_color":"#ffffff"}],"images":[{"id":"XjRJeDtwU55bUR1RjmNB","width":72,"height":72,"url":"no-board","content_type":"image/svg","name":"broken chain"}]},
    204: OBBoard.makeEmptyBoard(4, 5, "204")
}


class BoardSetWatcherBaseClass {
    #rootID = null;
    #boardPaths = {};
    
    constructor(rootID) {
        this.#rootID = rootID;
    }

    get rootBoardID() {
        return this.#rootID;
    }


    #buildBoardPathMap() {
        const parentsOf = {};
        const allBoards = this.getAllBoards();
        for (const id in allBoards) {
            const board = allBoards[id];
            for (const linked of board.linkedBoards) {
                const linkedID = linked.id || linked.data_url;
                if (!parentsOf[linkedID]) parentsOf[linkedID] = new Set()
                parentsOf[linkedID].add(id);
            }
        }

        // Perform a breadth-first search to build paths from the root board to all other boards.
        const visited = new Set();
        const boardPaths = { [this.#rootID]: [this.#rootID] };
        const queue = [this.#rootID];
        while (queue.length > 0) {
            const currentID = queue.shift();
            if (!visited.has(currentID)) {
                visited.add(currentID);
                if (!boardPaths[currentID]) {
                    let parentPath = [...parentsOf[currentID]]
                        .map(pid => boardPaths[pid])
                        .reduce((a, b) => 
                            (a?.length ?? Infinity) <= (b?.length ?? Infinity) ? a : b
                        ); // Choose the shortest path among the parents
                    
                    let parentID = parentPath[parentPath.length - 1];
                    let parent = allBoards[parentID];
                    let button = parent.buttons.find(b => (b.load_board?.id || b.load_board?.data_url) === currentID);
                    boardPaths[currentID] = [...parentPath, button.id, currentID];
                }
                
                queue.push(...(allBoards[currentID]
                        ?.linkedBoards || [])
                        .map(b => b.id || b.data_url)
                )
            }
        }
        this.#boardPaths = boardPaths;
    }


    async #loadSet(boardSet) {

        const newBoards = await Promise.all(
            boardSet.map(id => this._loadBoard(id))
        )
        this.#buildBoardPathMap();
        return newBoards.flatMap(board => board.linkedBoards)
                        .map(linked => linked.id || linked.data_url);
    }

    async #deepLoad(rootBoards) {
        let newSet = rootBoards.flatMap(board => board.linkedBoards)
                        .map(linked => linked.id || linked.data_url);
        while (newSet.length > 0) {
            newSet = await this.#loadSet(newSet);
        }
       
    }

    async #loadChildren(board) {
        const linkedBoards = board.linkedBoards || [];
        const newSet = linkedBoards.map(linked => linked.id || linked.data_url);
        await this.#loadSet(newSet);
    }


    hasBoard(boardID) {
        const allBoards = this.getAllBoards();
        return boardID in allBoards;
    }


    /**
     * TO be implemented by the subclass.
     * @param {string} id - The board ID to load.
     * @returns {Promise<OBBoardType>} - A promise that resolves to the loaded board.
     */
    async _loadBoard(id) { }

    
    /**
     * TO be implemented by the subclass.
     * @returns {Object<string, OBBoardType>} - An object mapping board IDs to board instances.
     */
    getAllBoards() {
        return {}
    }

    /**
     * TO be implemented by the subclass.
     * Cleans up any resources used by the board manager.
     * @returns {Promise<void>} - A promise that resolves when the destruction is complete.
     */
    async destroy() {
    }


    
    /**
     * @param {string} boardID - The board ID to load.
     * @param {boolean} waitForLinkedBoards - Whether to wait for all linked boards to be loaded before returning.
     * @returns {Promise<OBBoardType>} - A promise that resolves to the loaded board.
     */
    async getBoard(boardID, waitForLinkedBoards = false) {
        const board = await this._loadBoard(boardID);
        if (board) {
            let childrenPromise = this.#loadChildren(board);
            if (waitForLinkedBoards) await childrenPromise;
        }
        return board;
    }

    /**
     * @param {string} word - The word to search for.
     * @returns {Array<{boardID: string, button: Object, path: Array<string>}>} - An array of matches, each containing the board ID, the button object, and the path to the button.
     */
    findWord(word) {
        let matches = []
        const allBoards = this.getAllBoards();
        for (const boardID in allBoards) {
            const board = allBoards[boardID];
            for (const button of board.buttons) {
                let text = button.label || "";
                if (text.startsWith(word) || (word.length > 4 && text.includes(word))) {
                    matches.push({ boardID, button });
                }
            }
        }

        matches.forEach(m => {
            m.path = [...this.#boardPaths[m.boardID], m.button.id];
        })
        return matches;
    }

    searchWord(word) {
        const allBoards = this.getAllBoards();
        console.log(this.findWord(word).map(m => {
            let path = m.path;
            let buttons = []
            for (let i = 0; i < path.length; i+= 2) {
                buttons.push(allBoards[path[i]].getButtonByID(path[i+1])?.label );
            }
            return buttons.join(" -> ")
        }).join("\n"))
    }



    async forceFullLoad() {
        let boards = Object.values(this.getAllBoards());
        await this.#deepLoad(boards);
    }
    
    async load(bool = false) {
        await this.getBoard(this.#rootID, bool);
    }


    static get REPLACEMENT_BOARDS() {
        return REPLACEMENT_BOARDS;
    }
}


class BoardSetWatcher extends BoardSetWatcherBaseClass {
    /**  @type {Object<string, OBBoardType>} - A map of board IDs to OBBoard instances. */
    #boards = {}


    /** @type {Object<string, Promise<OBBoardType>>} - A map of board IDs to their loading promises. */
    #boardPromises = {};
    #watchedBoards = {};
    #watchedBoardsPromises = {};

    constructor(rootID) {
        super(rootID);
    }

    hasBoard(boardID) {
        return boardID in this.#boards;
    }

    
    /**
     * @param {string} id - The board ID to load.
     * @returns {Promise<OBBoardType>} - A promise that resolves to the loaded board.
     */
    async _loadBoard(id) {
        try {
            if (!(id in this.#watchedBoardsPromises)) {
                console.log(`Setting up metadata listener for board with ID ${id}`);
                let callback = async (metadata) => {
                    console.log(`Metadata received for board with ID ${id}:`, metadata);
                    if (metadata.error) {
                        this.#boardPromises[id] = Promise.resolve(
                            OBBoard.make(REPLACEMENT_BOARDS[metadata.error.code])
                        );
                    } else {
                        this.#boardPromises[id] = getBoard(id);
                    }
                    this.#boards[id] = await this.#boardPromises[id];
                }
                this.#watchedBoardsPromises[id] = (async () => {
                    const unsubscribe = await setupMetadataListener(id, callback);
                    this.#watchedBoards[id] = unsubscribe;
                })()
            } else {
                console.log(`Board with ID ${id} is already being watched.`);
            }
            await this.#watchedBoardsPromises[id];
            await this.#boardPromises[id];
        } catch (error) {
            console.error(`Failed to load board with ID ${id}:`, error);
        }
       
        return this.#boards[id];
    }



    async destroy() {
        for (const id in this.#watchedBoards) {
            this.#watchedBoards[id]();
        }
        this.#watchedBoardsPromises = {};
        this.#watchedBoards = {};
    }
}


/*****************************************
 * FAVOURITE / PUBLIC METADATA WATCHERS
 *****************************************/

/**
 * Watches the favourite boards of a specific user and
 * triggers a callback whenever there are changes.
 * @param {string} uid - The user ID whose favourite boards are being watched.
 * @param {(boards: Object<string, BoardMetadata>) => void} callback - The callback function to be triggered on changes.
 * @returns {function} - A function to unsubscribe from the watcher.
 */
function watchMyFavouriteBoards(uid, callback) {
    const boards = {};

    const q = META.query(
        where("owner", "==", uid), 
        where("deletedAt", "==", false)
    );

    const unSubscribe = META.onValue(q, (changes) => {
            changes.forEach(([id, data, type]) => {
                if (data.favourite && type !== "removed") {
                    boards[id] = data;
                } else if (id in boards) {
                    delete boards[id];
                }
            })
            callback(
                Object.fromEntries(
                    Object.entries(boards).map(
                        ([id, data]) => [id, BoardMetadata.make(data)]
                    ).filter(([_, data]) => data.updatedAt.valid) // remove empty boards
                )
            );
        }
    );
    return unSubscribe;
}


/**
 * Watches the public favourite boards and triggers a callback whenever there are changes.
 * @param {(boards: Object<string, BoardMetadata>) => void} callback - The callback function to be triggered on changes.
 * @returns {function} - A function to unsubscribe from the watcher.
 */
async function watchPublicBoards(callback) {
    const boards = {};
    const q = META.query(
        where("public", "==", true), 
        where("favourite", "==", true),
        where("deletedAt", "==", false)
    );

    const unSubscribe = META.onValue(q, (changes) => {
            changes.forEach(([id, data, type]) => {
                if (data.favourite && type !== "removed") {
                    boards[id] = data;

                } else if (id in boards) {
                    delete boards[id];
                }
            })
            callback(
                Object.fromEntries(
                    Object.entries(boards).map(
                        ([id, data]) => [id, BoardMetadata.make(data)]
                    ).filter(([_, data]) => data.updatedAt.valid) // remove empty boards
                )
            );
        }
    );
    return unSubscribe;
}



export { 
    BoardMetadata,


    getBoard, 
    getBoardMetadata, 

    BoardWatcher, 
    BoardSetWatcher,
    BoardSetWatcherBaseClass,
    setupMetadataListener,

    watchMyFavouriteBoards,
    watchPublicBoards,

    addBoardToRecent,
    getRecentBoards,
    getUserInfo,
};