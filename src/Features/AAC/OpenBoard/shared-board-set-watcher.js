import { FirebaseFrame } from "../../../Firebase/firebase-frame.js";
import { BoardSetWatcherBaseClass, getBoard, setupMetadataListener } from "./boards.js";
import { OBBoard } from "./openboard.js";

/**
 * Realtime database keys cannot contain . $ # [ ] /
 * encodeURIComponent handles all but ".", which is replaced manually.
 * @param {string} id
 * @returns {string}
 */
function toKey(id) {
    return encodeURIComponent(id).replace(/\./g, "%2E");
}

/**
 * Shares a board set between the two parties of a session.
 *
 * The owner (the party with permission to read the boards) loads boards
 * through the normal metadata/board cache and publishes each one into the
 * session frame. The other party never touches the boards collection, it
 * only requests boards through the frame and reads what the owner publishes.
 *
 * Frame layout:
 *   requests/{key}: boardID        - written by the participant, read by the owner
 *   boards/{key}:   JSON string    - written by the owner, read by the participant
 *
 * Boards are stored as JSON strings because the realtime database drops
 * null entries from arrays, which would corrupt the grid order.
 */
class SharedBoardSetWatcher extends BoardSetWatcherBaseClass {
    #frame = null;
    #isOwner = null;

    /** @type {Object<string, OBBoard>} */
    #boards = {};

    /** @type {Object<string, Promise<OBBoard>>} */
    #boardPromises = {};

    /** Owner: the last JSON string published for each board, to avoid redundant writes. */
    #published = {};

    /** Functions to call on destroy (frame listeners and metadata deregisters). */
    #enders = [];

    #destroyed = false;

    /**
     * @param {boolean} isOwner
     * @param {string} rootID
     * @param {FirebaseFrame} frame
     */
    constructor(isOwner, rootID, frame) {
        super(rootID);
        this.#frame = frame;
        this.#isOwner = isOwner;

        // The owner serves every board the participant asks for,
        // regardless of what the owner itself is currently viewing.
        if (isOwner) {
            this.#enders.push(
                frame.onChildAdded("requests", (id) => {
                    if (typeof id === "string") this.#ownerLoad(id);
                })
            );
        }
    }

    /**
     * Owner side. Listens to the board's metadata, reloads the board through
     * the shared cache whenever it changes and publishes every new version to
     * the frame. Boards that cannot be loaded (deleted, no access, not saved
     * yet) are published as the matching replacement board.
     * @param {string} id
     * @returns {Promise<OBBoard>}
     */
    #ownerLoad(id) {
        if (!(id in this.#boardPromises)) {
            if (id.startsWith("http")) {
                this.#boardPromises[id] = this.#loadURLBoard(id);
            } else {
                let latest = Promise.resolve();
                let version = 0;
                const onMetadata = (metadata) => {
                    const v = ++version;
                    latest = (async () => {
                        const board = metadata.error ?
                            this.#replacementBoard(metadata.error.code) :
                            await getBoard(id);

                        // Ignore stale loads superseded by a newer metadata update.
                        if (v === version) this.#setBoard(id, board);
                    })();
                };

                this.#boardPromises[id] = (async () => {
                    const deregister = await setupMetadataListener(id, onMetadata);
                    if (this.#destroyed) deregister();
                    else this.#enders.push(deregister);
                    await latest;
                    return this.#boards[id];
                })();
            }
        }
        return this.#boardPromises[id];
    }

    /**
     * @param {number} code
     * @returns {OBBoard}
     */
    #replacementBoard(code) {
        const { REPLACEMENT_BOARDS } = BoardSetWatcherBaseClass;
        return OBBoard.make(REPLACEMENT_BOARDS[code] ?? REPLACEMENT_BOARDS[404]);
    }

    /**
     * Owner side. Stores the board locally and publishes it.
     * @param {string} id
     * @param {?OBBoard} board
     */
    #setBoard(id, board) {
        if (!board) board = this.#replacementBoard(404);
        this.#boards[id] = board;
        this.#publish(id, board);
    }

    /**
     * Owner side. Writes the board to the frame if it has changed.
     * @param {string} id
     * @param {OBBoard} board
     */
    #publish(id, board) {
        if (this.#destroyed) return;
        const json = JSON.stringify(board);
        if (this.#published[id] !== json) {
            this.#published[id] = json;
            this.#frame.set(`boards/${toKey(id)}`, json).catch(e => {
                console.warn(`SharedBoardSetWatcher: failed to publish board ${id}`, e);
            });
        }
    }

    /**
     * Participant side. Listens to the frame for the board and requests it
     * from the owner. Resolves once the owner has published the board,
     * after which further updates from the owner replace the cached board.
     * @param {string} id
     * @returns {Promise<OBBoard>}
     */
    #participantLoad(id) {
        if (!(id in this.#boardPromises)) {
            if (id.startsWith("http")) {
                // URL boards are not access controlled, load them directly.
                this.#boardPromises[id] = this.#loadURLBoard(id);
            } else {
                const key = toKey(id);
                this.#boardPromises[id] = new Promise((resolve) => {
                    this.#enders.push(
                        this.#frame.onValue(`boards/${key}`, (json) => {
                            if (typeof json !== "string") return;
                            try {
                                this.#boards[id] = OBBoard.make(JSON.parse(json));
                                resolve(this.#boards[id]);
                            } catch (e) {
                                console.warn(`SharedBoardSetWatcher: failed to parse board ${id}`, e);
                            }
                        })
                    );
                });
                this.#frame.set(`requests/${key}`, id).catch(e => {
                    console.warn(`SharedBoardSetWatcher: failed to request board ${id}`, e);
                });
            }
        }
        return this.#boardPromises[id];
    }

    hasBoard(boardID) {
        return boardID in this.#boards;
    }

    /**
     * @param {string} id
     * @returns {Promise<OBBoard>}
     */
    async #loadURLBoard(id) {
        const board = await getBoard(id);
        if (board) this.#boards[id] = board;
        return board;
    }

    /**
     * @param {string} id
     * @returns {Promise<OBBoard>}
     */
    async _loadBoard(id) {
        try {
            if (this.#isOwner) {
                await this.#ownerLoad(id);
            } else {
                await this.#participantLoad(id);
            }
        } catch (error) {
            console.error(`Failed to load board with ID ${id}:`, error);
        }
        return this.#boards[id];
    }

    /**
     * @returns {Object<string, OBBoard>}
     */
    getAllBoards() {
        return { ...this.#boards };
    }

    async destroy() {
        this.#destroyed = true;
        this.#enders.forEach(end => end());
        this.#enders = [];

        // Remove the owner's private boards from the session data. Requests are
        // left in place so that a new owner watcher can serve them again.
        if (this.#isOwner) {
            try {
                await this.#frame.set("boards", null);
            } catch (e) {}
        }

        this.#boardPromises = {};
        this.#published = {};
    }
}

export { SharedBoardSetWatcher };
