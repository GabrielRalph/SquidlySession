
import { OBBoard, OBButton, OBImage } from "./OpenBoard/openboard.js";
import { GridCard, GridIcon, GridLayout } from "./GridLayout/grid-icons.js";
import { AccessTextarea } from "./Textarea/textarea.js";


import { Debugger, delay } from "../../Utilities/usefull-funcs.js";
import { AccessEvent } from "../../Utilities/Buttons/access-buttons.js";
import { loadUtterances, speak } from "../../Utilities/text2speach-proxy.js";


const debug = new Debugger(
    "AACBoard",
    "background: #b43113; color: white; padding: 5px; border-radius: 5px;"
);


class AACClick extends AccessEvent {
    /** @type {OBButton} */
    button = null;

    /** @type {AACButton} */
    element = null
    
    constructor(e, button, element) {
        super("aac-click", e, {
            bubbles: true,
        });
        this.button = button;
        this.element = element;
    }
}

class AACChange extends AccessEvent {
    constructor(e, changes) {
        super("change", e, {
            bubbles: true,
        });
        this.changes = changes;
    }
}

class AACInsert extends AccessEvent {
    constructor(e, text) {
        super("insert", e, {
            bubbles: true,
        });
        this.text = text;
        this.button = e.button;
    }
}

/**
 * @typedef {HTMLElementEventMap & {
 *   "aac-click": AACClick
 * }} AACGridEventMap
 */

/**
 * @typedef {HTMLElementEventMap & {
 *   "aac-click": AACClick,
 *   "change": AACChange,
 *   "insert": AACInsert
 * }} AACBoardEventMap
 */

class AACButton extends GridIcon {
    #button = null; 

    /**
     * @param {string} button_id
     * @param  {OBBoard} board
     * @param {string} group
     */
    constructor(button_id, board, group) {
        const button = board.getButtonByID(button_id);
        const image = board.getImageByID(button.image_id);
        const symbol = image ? image.resolvedURL : null;
        super({
            displayValue: button.label,
            symbol: symbol,
            type: button.load_board ? "folder" : "plain",
            colorTheme: "white",
            events: {
                "access-click": (e) => this.dispatchEvent(new AACClick(e, button, this))
            },
        }, group);


        let fontSize = button.font_size || "medium";
        if (fontSize !== "medium") {
            this.setAttribute("font-size", fontSize);
        }

        this.toggleAttribute("bold", button.bold);
        this.toggleAttribute("italic", button.italic);
        this.toggleAttribute("label-at-bottom", button.label_at_bottom)

        this.styles = Object.fromEntries(
            Object.entries(button.colorTheme)
                .map(([k, v]) => [`--${k}`, v])
        );
        this.#button = button;
    }

    /** @returns {OBButton} */
    get button() {
        return this.#button
    }
}

/**
 * @fires AACClick
 */
class AACGrid extends GridLayout {
    #board = null;

    /**
     * @param {OBBoard} board
     */
    constructor() {
        super(1,1);
        this.toggleAttribute("aac", true);
        this.toggleAttribute("scale-font", true);
    }

    /**
     * @template {keyof AACGridEventMap} K
     * @param {K} type
     * @param {(this: AACGrid, ev: AACGridEventMap[K]) => any} listener
     * @param {boolean | AddEventListenerOptions} [options]
     */
    addEventListener(type, listener, options) {
        EventTarget.prototype.addEventListener.call(this, type, listener, options);
    }


    /**
     * @param {OBBoard} board
     * @returns {new () => AACButton}
     */
    getAACButtonClass(board) {
        class B extends AACButton { 
            constructor(button_id, group) { super(button_id, board, "aac-"+group); } 
        }
        return B;
    }

    
    /**
     * @override
     */
    onBoardSet() { }


    /**
     * @param {OBBoard} board
     */
    set board(board) { 
        this.innerHTML = "";
        if (board instanceof OBBoard) {
            const {columns, rows} = board.grid;
            this.size = [rows, columns];
            const buttonLocations = board.getButtonLocations().filter(b => b.buttonID !== null);
            const bClass = this.getAACButtonClass(board);
            for (let {rowRange, colRange, buttonID} of buttonLocations) {
                this.add(new bClass(buttonID, rowRange[0]), rowRange, colRange)
            }
            this.#board = board;
        } else {
            this.size = [1, 1];
        }
        this.onBoardSet(board);

    }

    same(board) {
        return this.#board && this.#board.same(board);
    }
}

class AACBoardSetViewer extends GridLayout {
    keepCornerFree = false;
    showSearchButton = true;

    #history = [];
    #renderedBoardID = null;
    #boardCache = {};


    /** @type {GridLayout} */
    #rootGrid = null;

    /** @type {GridLayout} */
    #controlsGrid = null;

    /** @type {GridIcon} */
    #closeButton = null;
    #backspaceButton = null;
    #searchButton = null;

    /** @type {AccessTextarea} */
    #textArea = null;
    #loaderOverlay = null;
    #textAreaCard = null;

    #board = null;
    #holdBoard = null;
    #manager = null;

    
    constructor() {
        super(2,2);
        this.#loaderOverlay = this.createChild("div", { 
            class: "loader-overlay",
         });
        this.events = {
            "aac-click": this.#onButtonClick.bind(this)
        }
       
        // Override the computeIconBorderRadiusAndWidth method for the root grid.
        this.#controlsGrid = new GridLayout(1, 5);
        this.#closeButton = this.#controlsGrid.addGridIcon({
            symbol: "home",
            colorTheme: "action",
            events: {"access-click": (e) => {
                if (this.#history.length <= 1) {
                    this?.onClose?.(e);
                } else {
                    this.gotoBoard(this.#manager.rootBoardID)
                }
            }},
            accessGroup: "apps",
        });

        this.#backspaceButton = this.#controlsGrid.addGridIcon({
            symbol: "backspace",
            colorTheme: "action",
            events: {"access-click": (e) => this.#ACTION_SET.delete_word.call(this, e)},
            accessGroup: "apps",
        });

        this.#searchButton = this.#controlsGrid.addGridIcon({
            colorTheme: "action",
            symbol: "search",
            events: {"access-click": (e) => this?.onSearch?.(e)},
        })
    
        this.#textAreaCard = this.#controlsGrid.createChild(GridCard, {
            events: {"access-click": (e) => this.#ACTION_SET.speak.call(this, e)}
        }, "access-button", "plain", "textarea");
        this.#textArea = this.#textAreaCard.content.createChild(AccessTextarea, {});
    }

    desiredRows = 2;
    topCols = 5;

    computeIconBorderRadiusAndWidth() {
        let rows = Math.max(this.desiredRows || this.size[0], this.minRowsForBorderRadius)
        let desiredBR = (this.clientHeight / rows) * this.borderRadiusToCellHeightRatio;
        let width = this.clientWidth;
        let borderWidth = Math.min(Math.max(2, Math.ceil(this.clientWidth / 225)), 4);
        let cellWidth = (width - (this.topCols - 1) * 2 * borderWidth) / this.topCols;
        desiredBR = Math.min(desiredBR, cellWidth / 2);
        return [
            desiredBR,
            borderWidth
        ]
    }

    /**
     * @template {keyof AACBoardEventMap} K
     * @param {K} type
     * @param {(this: AACBoard, ev: AACBoardEventMap[K]) => any} listener
     * @param {boolean | AddEventListenerOptions} [options]
     */
    addEventListener(type, listener, options) {
        EventTarget.prototype.addEventListener.call(this, type, listener, options);
    }

    /**
     * @param {AACClick} e
     */
    #runActions(e, actions, button) {
        let proms = []
        for (const action of actions) {
            if (action.mode in this.#ACTION_SET) {
                debug.log("action " + action.mode, action.value, this.historyString);
                const prom = this.#ACTION_SET[action.mode].call(this, e, action.value, button);
                if (prom instanceof Promise) {
                    proms.push(prom);
                }
            }
        }
        return Promise.all(proms);
    }

    /**
     * @param {AACClick} e
     */
    async #onButtonClick(e) {
        const {element, button} = e;
        const {load_board, allActions} = button;
        debug.logStart("button click", button.id, button)
        let gotoProm = null;
        if (load_board) {
            const id = load_board.id;
            gotoProm = this.gotoBoard(id, e);
            debug.log("gotoBoard", id, this.historyString);
        }
        let actionPorm = this.#runActions(e, allActions, button);
        debug.logEnd();
        await e.waitFor(Promise.all([gotoProm, actionPorm]));
    }

    #onStateChange(e, ...changes) {
        this.dispatchEvent(new AACChange(e, changes));
    }

    /**
     * @param {OBBoard<OBButton>} board
     */
    async #loadBoardUtterances(board) {
        const utterances = board.buttons.map(button => button.utterance);
        await loadUtterances(utterances);
    }

    async #getBoardGrid(id) {
        let board = id;
        if (typeof id === "string") {

            if (!this.#manager.hasBoard(id)) {
                this.toggleAttribute("loading", true)
            }
            board = await this.#manager.getBoard(id);
            this.toggleAttribute("loading", false);
        }
        if (!(board instanceof OBBoard)) {
            console.warn("Invalid board:", board, id);
        }

        // Retrieve the grid for the current board from the cache,
        // or create a new one if it doesn't exist.
        let grid;
        if (board.id in this.#boardCache && this.#boardCache[board.id].same(board)) {
            // debug.log("Cache hit for board:", board.id);
            grid = this.#boardCache[board.id];
        } else {
            grid = new AACGrid();
            grid.board = board;
            this.#boardCache[board.id] = grid;
        }
        return [board, grid];
    }

    /**
     * @param  {OBBoard|string} board
     */
    async #setBoard(id) {
        const [board, grid] = await this.#getBoardGrid(id);
        if (this.#renderedBoardID !== board.id) {
            let {columns, rows} = board.grid;

            // The desired number of rows for the root grid is set 
            // based on the board's grid.
            this.desiredRows = rows; 

            // The actual number of rows for the root grid 
            // is adjusted to ensure a minimum size for the top
            // controls area (i.e. 1/4 of the screen height)
            rows = Math.max(rows + 1, 4);
            columns = Math.max(columns);

            // Compute the number of lines for the textarea 
            // based on the number of rows in the board's grid.
            // 1 - 3: 4 lines
            // 4 - 6: 3 lines
            // 7 and above: 2 lines
            let lines = rows == 4 ? 4 : (rows < 8 ? 3 : 2);
            this.#controlsGrid.style.setProperty("--lines", lines);

            // Clear the root grid and set its size based 
            // on the computed rows and columns.
            this.innerHTML = "";
            this.appendChild(this.#loaderOverlay)
            this.size = [rows, columns];

            // Determine if the search button and backspace 
            // should take up half a button's width.
            let halfButton = columns < 8 && this.showSearchButton;

            // Compute the total number of columns for the controls area.
            let cc = Math.max(columns, 5);
            cc *= (halfButton ? 2 : 1)
            this.topCols = cc;
            
            // Set the size of the controls 
            // grid based on the computed columns.
            this.#controlsGrid.size = [1, cc];

            // Add the controls grid to the root grid.
            this.add(this.#controlsGrid, 0, [0, columns-1]);

            // Add the close button to the controls grid.
            this.#controlsGrid.add(this.#closeButton, 0, [0, this.showSearchButton?1:0]);

            // Add the backspace and search buttons if it 
            // is enabled.
            let end = cc - 3;
            this.#closeButton.symbol = this.#history.length > 1 ? "home" : "close";
            if (this.showSearchButton) {
                this.#controlsGrid.add(this.#backspaceButton, 0, cc-1);
                this.#controlsGrid.add(this.#searchButton, 0, cc-2);
            } else {
                this.#controlsGrid.add(this.#backspaceButton, 0, cc-1);
                end = cc - 2;
            }   
            // Add the text area card to the controls grid.
            this.#controlsGrid.add(this.#textAreaCard, 0, [this.showSearchButton?2:1, end]);
            
            // Load the utterances for the current board.
            this.#loadBoardUtterances(board);
            
            // Add the board grid to the root grid and update the rendered board ID.
            this.add(grid, [1, rows-1], [0, columns-1]);
            this.#renderedBoardID = board.id;

            // Force the root grid to resize and update the text area's caret position.
            this.forceResize();

            await delay(); // Wait for a new animation frame
            this.#textArea.updateCaretPosition(true);

            // Wait for a short delay before continuing.
            await delay(200)
        }
    }

    get historyString() {
        const holdBoard = this.#holdBoard || this.#manager.rootBoardID;
        let historyStr = this.#history.map(id => id === holdBoard ? `[${id}]` : id).join(" -> ");
        return historyStr;
    }

    /**
     * @typedef {(this: AACBoard, e: Event, ...args: any[]) => boolean} ActionHandler
     * @type {Object.<string, ActionHandler>}
     */
    #ACTION_SET = {
        space(e) {
            this.#textArea.insert(" ");
            this.#onStateChange(e, "text", "caretPosition");
        },

        return(e) {
            debug.log("return", this.historyString);
            return this.gotoBoard(null, e);
        },

        home(e) {
            debug.log("home", this.historyString);
            return this.gotoBoard(this.#manager.rootBoardID, e);
        },

        back(e) {
            debug.log("back", this.historyString);
            return this.gotoBoard(this.#history[this.#history.length - 2], e);
        },

        /**  @this {AACBoard} */
        clear(e) {
            this.#textArea.clear();
            this.#onStateChange(e, "text", "caretPosition");

        },

        delete_word(e) {
            this.#textArea.deleteWord();
            this.#onStateChange(e, "text", "caretPosition");
        },

        /**  @this {AACBoard} */
        backspace(e) {
            this.#textArea.backspace();
            this.#onStateChange(e, "text", "caretPosition");
        },

        hold(e) {
            this.#ACTION_SET.hold_page.call(this, e);
        },

        hold_page(e) {
            this.#holdBoard = this.currentBoardID;
            this.#onStateChange(e, "holdBoard");
        },

        append_text(e, s, button) {
            s = s || button.label || "";
            this.#textArea.insert(s);
            this.#onStateChange(e, "text", "caretPosition");
        },

        insert_text(e, s, button) {
            s = s || button.label || "";

            let charBeforeCursor = this.#textArea.valueUpToCaret;
            let charAfterCursor = this.#textArea.valueAfterCaret;
            if (charBeforeCursor.length > 0 && !charBeforeCursor.endsWith(" ")) {
                s = " " + s;
            } 
            if (charAfterCursor.length > 0 && !charAfterCursor.startsWith(" ")) {
                s = s + " ";
            }
            this.#textArea.insert(s);
            this.dispatchEvent(new AACInsert(e, s));
            this.#onStateChange(e, "text", "caretPosition");

            speak(button.utterance);
        },

        cursor_left(e) {
            this.#textArea.moveCaret(-1);
            this.#onStateChange(e, "caretPosition");
        },

        /**  @this {AACBoard} */
        cursor_right(e) {
            this.#textArea.moveCaret(1);
            this.#onStateChange(e, "caretPosition");
        },

        /**  @this {AACBoard} */
        cursor_down(e) {
            this.#textArea.moveCaretVertically(1);
            this.#onStateChange(e, "caretPosition");
        },

        /**  @this {AACBoard} */
        cursor_up(e) {
            this.#textArea.moveCaretVertically(-1);
            this.#onStateChange(e, "caretPosition");
        },

        speak(e) {
            const utterances = [this.#textArea.value];
            loadUtterances(utterances);
            for (let utterance of utterances) {
                speak(utterance);
            }
        },

        speak_last_word(e) {
            const {valueUpToCaret, valueAfterCaret} = this.#textArea;
            if (valueUpToCaret && valueUpToCaret.length > 0) {
                let word = valueUpToCaret.trim().split(" ").pop()

                // Account for case where caret is in the middle of a word
                if (
                    valueAfterCaret 
                    && valueAfterCaret.length > 0 
                    && valueAfterCaret[0] !== " "
                    && valueUpToCaret[valueUpToCaret.length - 1] !== " "
                ) { word += valueAfterCaret.split(" ")[0]; }

                if (word.length > 0) {
                    loadUtterances([word]);
                    speak(word);
                }
            }
        }
    }

    get history() {
        return [...this.#history];
    }

    get currentBoardID() {
        return this.#history[this.#history.length - 1] || this.#manager.rootBoardID;
    }

    get state() {
        return {
            text: this.#textArea.value,
            history: [...this.#history],
            holdBoard: this.#holdBoard,
            caretPosition: this.#textArea.caretPosition || 0
        }
    }

    set state(state) {
        state = typeof state !== "object" || state === null ? {} : state;

        if (state.text !== undefined) {
            this.#textArea.value = state.text;
        }

        if (Array.isArray(state.history)) {
            this.#history = state.history;
            this.#setBoard(this.currentBoardID);
        } 
        if (state.holdBoard !== undefined) {
            this.#holdBoard = state.holdBoard;
        }
        if (state.caretPosition !== undefined) {
            this.#textArea.caretPosition = state.caretPosition;
        }
    }

    set manager(manager) {
        this.#manager = manager;
        this.#history = [manager.rootBoardID];
        this.#holdBoard = null;
        this.#textArea.value = "";
        this.#boardCache = {};
        this.#setBoard(manager.rootBoardID);
    }
    get manager() {
        return this.#manager;
    }

    /**
     * @param {string} boardID
     * @param {Event} e
     * @return {Promise} Resolves when the board transition is complete
     */
    async gotoBoard(boardID, e) {
        let transistionPromise = null;
        if (this.#manager) {
            const homeID = this.#manager.rootBoardID;
            
            if (!boardID || typeof boardID !== "string") {
                boardID = this.#holdBoard || homeID;
            }

            transistionPromise = this.#setBoard(boardID);
            if (boardID === homeID) {
                this.#history = [homeID];
                this.#holdBoard = null;
            } else  {
                let i = this.#history.indexOf(boardID);
                if (i === -1) {
                    this.#history.push(boardID);
                } else {
                    this.#history = this.#history.slice(0, i + 1);
                }
            }

            this.#onStateChange(e, "history", "holdBoard");
        } else {
            console.warn("No board manager set");
        }

        return transistionPromise;
    }
    
    static get usedStyleSheets() {
        return [
            import.meta.resolve("./icons.css"),
            import.meta.resolve("./aac-style.css"),
            ...GridIcon.usedStyleSheets,
            ...AccessTextarea.usedStyleSheets,
        ];
    }
}

export { AACBoardSetViewer, AACGrid, AACButton, AACClick, AACChange, AACInsert }
