import { delay } from "../../Utilities/usefull-funcs.js";
import { Features, OccupiableWindow } from "../features-interface.js";
import { AACBoardSetViewer } from "./aac-display.js";
import { BoardSetWatcher, getBoardMetadata } from "./OpenBoard/boards.js";
import { SharedBoardSetWatcher } from "./OpenBoard/shared-board-set-watcher.js";
import { AACExplore } from "./Search/index.js";

/**
 * A getText request, shared with the other user through the session data.
 * @typedef {Object} TextRequest
 * @property {string} id
 * @property {string} by "host" | "participant", the user that called getText
 * @property {string} returnFeature
 * @property {string} returnIconSymbol
 * @property {string} sendIconSymbol
 * @property {{sent: boolean, text: ?string}} [result] set when the other user sends the text
 */

const DEFAULT_BOARD_ID = "JLYix9KezJaosLusUhkl"
class AACViewer extends OccupiableWindow {
    constructor(feature) {
        super("aac-viewer");
        this.main = this.createChild(AACBoardSetViewer);
        this.search = this.createChild(AACExplore, {}, "aac-explore"); 
        

        this.search.close();
        this.main.onSearch = (e) => {
            this.search.open();
            e.waitFor(delay(300))
        }

    }

    get text() {
        return this.main.text;
    }

    async close() {
        this.onCloseWindow?.();
        await super.close();
    }


    static get fixToolBarWhenOpen() {return true}
    static get usedStyleSheets() {
        return AACBoardSetViewer.usedStyleSheets;
    }
}


export default class AACFeature extends Features {
    #boardID = null;

    /** "host" | "participant" | null - who is sharing the current board if it is private. */
    #sharedBy = null;

    /** @type {BoardSetWatcher | SharedBoardSetWatcher | null} */
    #manager = null;

    /** Incremented on every setBoard call so stale loads can be discarded. */
    #loadCount = 0;

    #init = true;

    /** The pending getText request made by this user, if any.
     * @type {?TextRequest & {resolve: (value: ?string) => void}} */
    #textRequest = null;

    /** The pending getText request made by the other user, if any. It is
     *  shared through the session data so this user sees the same close
     *  icons and can also send the text.
     * @type {?TextRequest} */
    #remoteRequest = null;

    constructor(sesh, sdata) {
        super(sesh, sdata);
        this.board = new AACViewer(this);
        const root = this.board.main;

        this.board.search.onClose = (e) => {
            if (this.#init) {
                // no board has been picked yet, so return without any text
                e.waitFor(this.#hasTextRequest ? this.#sendText(null) : this.session.openWindow("default"));
                return false;
            } else {
                return true;
            }
        }

        root.addEventListener("change", () => this.#pushState());
        root.onClose = (e) => {
            e.waitFor(this.#hasTextRequest ? this.#sendText(this.board.text) : this.session.openWindow("default"));
        }

        // the window was closed some other way (e.g. another feature was
        // opened), so cancel this user's request
        this.board.onCloseWindow = () => this.#endTextRequest(null);

        this.session.toolBar.addMenuItem("access", {
            name: "aac",
            index: 270,
            onSelect: e => e.waitFor(this.session.openWindow("aacGrid"))
        })
    }


    #pushState() {
        console.log("Pushing state");
        this.sdata.set("state", {
            state: this.board.main.state,
            boardID: this.#boardID,
            sharedBy: this.#sharedBy,
        });
    }

    /**
     * Creates the watcher for the board set. Private boards are watched with a
     * SharedBoardSetWatcher so the other party, who may not have access, receives
     * the boards through the session data from the party sharing them.
     * @param {string} boardID
     * @param {?string} sharedBy - "host" | "participant" | null if the board is public
     */
    #makeManager(boardID, sharedBy) {
        if (sharedBy) {
            const frame = this.sdata.child(`shared-boards/${boardID}`);
            return new SharedBoardSetWatcher(sharedBy === this.sdata.me, boardID, frame);
        } else {
            return new BoardSetWatcher(boardID);
        }
    }

    /**
     * @param {string} boardID
     * @param {?string} [sharedBy] - who is sharing the board. When undefined, the board 
     *                               was selected locally and its metadata decides whether
     *                               this user needs to share it.
     */
    async setBoard(boardID = DEFAULT_BOARD_ID, sharedBy) {
        const main = this.board.main;
        main.toggleAttribute("loading", true);

        const loadCount = ++this.#loadCount;

        if (sharedBy === undefined) {
            const meta = await getBoardMetadata(boardID);
            sharedBy = meta.public ? null : this.sdata.me;
        }
        if (loadCount !== this.#loadCount) return;
        this.#boardID = boardID;
        this.#sharedBy = sharedBy;

        const manager = this.#makeManager(boardID, sharedBy);
        await manager.load();

        // A newer board was selected while this one was loading.
        if (loadCount !== this.#loadCount) {
            manager.destroy();
            return;
        }

        this.#manager?.destroy();
        this.#manager = manager;

        main.manager = manager;
        // if (this.lastState && this.lastState)

        main.state = this.lastState;
        this.#pushState();
        main.toggleAttribute("loading", false);
        console.log("Board set to:", this.#boardID, sharedBy ? `(shared by ${sharedBy})` : "");
    }


    /**
     * Opens the AAC grid feature and then waits for a user
     * to form a message, when the aac grid board is closed
     * then the provided returnFreature is opened and the
     * text value in the aac textfield is returned.
     * 
     * Resolves to null if no text was sent, i.e. the search window was
     * closed before a board was picked, the aac window was closed some
     * other way, or getText was called again.
     *
     * @param {string} returnFeature the name of the window to open afterwards
     * @param {Object} [options]
     * @param {string} [options.returnIconSymbol="back"] the search window's close
     *        icon, shown when no board has been picked yet
     * @param {string} [options.sendIconSymbol="back"] the aac grid's close icon
     * @return {Promise<?string>}
     */
    async getText(returnFeature, options) {
        let {
            returnIconSymbol = "leftArrow",
            sendIconSymbol = "leftArrow",
        } = options || {}

        await this.session.openWindow("aacGrid");

        // cancel any earlier request
        this.#endTextRequest(null);

        /** @type {TextRequest} */
        const info = {
            id: `${this.sdata.me}-${Date.now()}`,
            by: this.sdata.me,
            returnFeature, returnIconSymbol, sendIconSymbol
        };
        const value = new Promise((resolve) => {
            this.#textRequest = {...info, resolve};
        });

        // the close icons are changed to the "returnIconSymbol" (search window)
        // and the "sendIconSymbol" (aac grid), for both users
        this.#updateCloseSymbols();
        this.sdata.set("text-request", info);

        // wait for either user to click the send (i.e. the close button),
        // see the onClose handlers in the constructor and #onTextRequest
        return await value;
    }

    /** True if either user is waiting for text (see getText) */
    get #hasTextRequest() {
        return !!(this.#textRequest || this.#remoteRequest);
    }

    /** Sends the value for the pending getText request (the user clicked
     *  send) and opens its returnFeature instead of the default window. */
    async #sendText(value) {
        if (this.#textRequest) {
            await this.#finishTextRequest(value);
        } else if (this.#remoteRequest) {
            // the request belongs to the other user, send them the value
            const request = this.#remoteRequest;
            this.#remoteRequest = null;
            this.#updateCloseSymbols();
            // set before opening the window, so the other user has the
            // value before their aac window closes (which would cancel it)
            await this.sdata.set("text-request", {...request, result: {sent: true, text: value}});
            await this.session.openWindow(request.returnFeature);
        }
    }

    /** Ends this user's getText request with the given value and opens its
     *  returnFeature (instead of the default window). */
    async #finishTextRequest(value) {
        const request = this.#endTextRequest(value);
        if (request) await this.session.openWindow(request.returnFeature);
    }

    /** Resolves this user's getText request, if any, clears it from the
     *  session data and restores the close icons.
     *  @return the request that was ended */
    #endTextRequest(value) {
        const request = this.#textRequest;
        if (request) {
            this.#textRequest = null;
            this.#updateCloseSymbols();
            this.sdata.set("text-request", null);
            request.resolve(value);
        }
        return request;
    }

    /** Handles the getText request in the session data changing.
     *  @param {?TextRequest} value */
    #onTextRequest(value) {
        const me = this.sdata.me;
        const local = this.#textRequest;
        if (value?.by === me) {
            this.#remoteRequest = null;
            if (local?.id === value.id) {
                // the other user sent the text for this user's request
                if (value.result?.sent) this.#finishTextRequest(value.result.text ?? null);
            } else if (!value.result) {
                // left over from before (e.g. the page was reloaded)
                this.sdata.set("text-request", null);
            }
        } else {
            // the other user's request, unless it has been sent
            this.#remoteRequest = value && !value.result ? value : null;
        }
        this.#updateCloseSymbols();
    }

    /** Sets the close icons of the search window and aac grid to suit the
     *  current getText request (if any) and whether a board has been picked. */
    #updateCloseSymbols() {
        const request = this.#textRequest ?? this.#remoteRequest;
        this.board.search.closeButton.symbol = this.#init ? (request?.returnIconSymbol ?? "close") : "downArrow";
        this.board.main.closeSymbol = request?.sendIconSymbol ?? "close";
    }

    async initialise() {
        const main = this.board.main;
        main.toggleAttribute("loading", true);

        this.sdata.onValue("state", (value) => {
            if (!value) {
                // open search
                this.#updateCloseSymbols();
                this.board.search.open();
                main.toggleAttribute("loading", false);

            } else {
                this.#init = false;
                this.#updateCloseSymbols();

                const state = value?.state ?? {};
                const boardID = value?.boardID ?? DEFAULT_BOARD_ID;
                const sharedBy = value?.sharedBy ?? null;
        
                if (Array.isArray(state.history) && (state.history.length == 0 || state.history[0] !== boardID)) {
                    state.history = [boardID];
                    state.text = "";
                    state.holdBoard = null;
                    state.caretPosition = 0;
                }
        
        
                this.lastState = state
                if (this.#boardID !== boardID || this.#sharedBy !== sharedBy) {
                    this.setBoard(boardID, sharedBy);
                    this.board.search.close();
                } else {
                    main.state = value.state;
                    main.toggleAttribute("loading", false);
                }
            }
        });
        
        this.sdata.onValue("text-request", (value) => this.#onTextRequest(value));

        this.board.search.root.addEventListener("board-selection", (e) => {
            // console.log("Board selected:", e.boardID);
            this.lastState = {text: "", history: [], caretPosition: 0};
            this.setBoard(e.boardID);
            this.board.search.close();
        });

    }

    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ STATIC ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
    /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */

    static get layers() {
        return {
            board: {
                type: "area",
                area: "fullAspectArea",
                index: 80,
                mode: "occupy",
            }
        }
    }

    static get name() {
        return "aacGrid";
    }

    static get firebaseName(){
        return "aac";
    }
    
    static async loadResources(){
        await Promise.all([
            AACViewer.loadStyleSheets(),
            AACExplore.loadStyleSheets()
        ]);
    }

}