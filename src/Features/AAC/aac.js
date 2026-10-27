import { delay } from "../../Utilities/usefull-funcs.js";
import { Features, OccupiableWindow } from "../features-interface.js";
import { AACBoardSetViewer } from "./aac-display.js";
import { BoardSetWatcher, getBoardMetadata } from "./OpenBoard/boards.js";
import { SharedBoardSetWatcher } from "./OpenBoard/shared-board-set-watcher.js";
import { FirebaseFrame } from "../../Firebase/firebase-frame.js";
import { AACExplore } from "./Search/index.js";

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

    constructor(sesh, sdata) {
        super(sesh, sdata);
        this.board = new AACViewer(this);
        const root = this.board.main; 
        
        this.board.search.onClose = (e) => {
            if (this.#init) {
                e.waitFor(this.session.openWindow("default"));
                return false;
            } else {
                return true;
            }
        }

        root.addEventListener("change", () => this.#pushState());
        root.onClose = (e) => {
            e.waitFor(this.session.openWindow("default"));
        }

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

    async initialise() {
        const main = this.board.main;
        main.toggleAttribute("loading", true);

        this.sdata.onValue("state", (value) => {
            if (!value) {
                // open search
                this.board.search.closeButton.symbol = "close";
                this.board.search.open();
                main.toggleAttribute("loading", false);

            } else {
                this.#init = false;
                this.board.search.closeButton.symbol = "downArrow";

                // console.log("State updated:", value);
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
                } else {
                    main.state = value.state;
                    // console.log("State applied to main:", value.state);
                    main.toggleAttribute("loading", false);
                }
            }
        });
        
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