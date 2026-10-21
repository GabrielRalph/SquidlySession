import { Color } from "../shared.js";
import { DataClass, array2D } from "./dataclass.js";
/**
 * @typedef {[number, number]} Range
 * 
 * 
 * @typedef {Object} LocationInfo
 * @property {Range} rowRange the starting and ending row
 * @property {Range} colRange the starting and ending column
 * @property {string} buttonID the button id for which the location is held.
 */

class OpenBoardObject extends DataClass {
    /** @type {string} */
    id; 
}

/**
 * This class represents a board to be loaded, 
 * which is used as part of the "load_board" 
 * property on the OB button object.
 */
class OBLoadBoard extends DataClass {
    /** @type {?string} */
    id = null;

    /** @type {?string} */
    name = null;        
    
    /** @type {?string} */
    data_url = null;    
    
    /** @type {?string} */
    url = null;         
    
    /** @type {?string} */
    path = null;        
}


class OBSymbol extends DataClass {
    /** @type {string} */
    set;                
    
    /** @type {string} */
    name;  
    
    get path() {
        return `${this.set}/${this.name}`;
    }
}


class OBImage extends OpenBoardObject {
    /** 
     * The width of the image in pixels. 
     * @type {number} 
     * */   
    width;                          
    
    /** 
     * The height of the image in pixels.
     * @type {number} 
     * */
    height;                         
    
    /** 
     * A URL to load the image from. 
     * This can be a relative or absolute URL.
     * @type {?string} 
     * */
    url = null;                     
    
    /** 
     * An optional symbol reference for the image, 
     * which can be used to link a symbol in a symbol set.
     * @type {?OBSymbol} 
     * */
    symbol = null;        
    static symbol_parser(value) { return value ? OBSymbol.make(value) : null; }          
    
    /** 
     * The content MIME type of the image, 
     * such as "image/png" or "image/jpeg".
     * @type {string} 
     * */
    content_type = "image/png";     
    
    /** 
     * An optional license for the image.
     * @type {?object}
     *  */   
    license = null;    
    
    
    /**
     * The name of the image, which can be used for display or reference.
     * @type {?string}
     */
    name = null;
    

    get resolvedURL() {
        if (this.path) {
            return this.path;
        } else if (this.url) {
            return this.url
        } else if (this.symbol) {
            const safe = this.symbol.path.split("/").map(encodeURIComponent).join("/");
            return "../IconSets/" + safe;
        }
    }
}


/**
 * This class represents an action associated with a button.
 */
class OBAction {
    constructor(value) {
        if (typeof value === "string") {
            let mode = value[0];
            if (mode in OBAction.MODES) {
                this.mode = OBAction.MODES[mode];
                if (this.mode === "action") {
                    this.mode = value.slice(1);
                    this.value = null;
                } else if (value.length > 1) {
                        this.value = value.slice(1);
                } else {
                    this.value = null;
                }
            } else {
                this.mode = "unknown";
                this.value = value;
            }
        } else if (value instanceof OBAction) {
            this.mode = value.mode;
            this.value = value.value ?? null;
        } else if (typeof value === "object" && value !== null) {
            this.mode = value.mode;
            this.value = value.value ?? null;
        } 
    }

    toString() {
        let prefix = "";
        if (this.mode in OBAction.MODES_REVERSE) {
            prefix = OBAction.MODES_REVERSE[this.mode];
        }  else {
            prefix = ":" + this.mode;
        }
        return prefix + (this.value ?? "");
    }

    toJSON() {
        return this.toString();
    }

    static get MODES() {
        return {
            ":": "action",
            "+": "append_text",
            "&": "insert_text"
        }
    }

    static get MODES_REVERSE() {
        return {
            "action": ":",
            "append_text": "+",
            "insert_text": "&",
            "unknown": ""
        }
    }
}

class OBButton extends OpenBoardObject {

    /**
     * The font size of the button's text, which can be one of the following values:
     * "huge", "large", "medium", "small", or "tiny".
     * @type {string}
     */
    font_size = "medium";

    
    /** 
     * The text label to display on the button.
     * @type {?string} */
    label = null;    
    static label_parser(value) { return value ? String(value).trim() : null; }           
    
    /** 
     * The ID of an image to display on the button.
     * @type {?string} */
    image_id = null;            
    
    /** 
     * The ID of a board to load when the button is pressed.
     * @type {?OBLoadBoard} */
    load_board = null;
    static load_board_parser(value) { return value ? OBLoadBoard.make(value) : null; }         
    
    /** 
     * The actions to perform when the button is pressed.
     * @type {?OBAction[]} */
    actions = null;   
    static actions_parser(value) { 
        let actions = (value ? (Array.isArray(value) ? value : [value]) : []).map(v => new OBAction(v)); 
        if (actions.length === 0) {
            actions = null;
        }
        return actions;
    }  
    

    /**
     * The action to perform when the button is pressed,
     * which can be a string or an OBAction object.
     * @type {?OBAction}
     */
    action = null;
    static action_parser(value) { return value ? new OBAction(value) : null; }  

    
    /**
     * A boolean indicating whether the button's 
     * text should be displayed in bold.
     * @type {boolean}
     */
    bold = false;

    /**
     * A boolean indicating whether the label should 
     * be displayed at the bottom of the image.
     * @type {boolean}
     */
    label_at_bottom = false;


    /**
     * A boolean indicating whether the button's 
     * text should be displayed in italics.
     * @type {boolean}
     */
    italic = false;

    /** 
     * Background color of the button, 
     * in any rgb, rgba, hsl, hsla, or hex format.
     * @type {?string} */
    background_color = null;
    
    /** 
     * Border color of the button, 
     * in format see background_color.
     * @type {?string} */
    border_color = null;    
    
    /** 
     * Text color of the button, 
     * in format see background_color.
     * @type {?string} */
    text_color = null;  

     /** 
     * Feature color of the button, 
     * in format see background_color.
     * @type {?string} */
    feature_color = null;  
    
    /** 
     * The vocalization associated with the button,
     * which can be a string to speak.
     * @type {?string} */
    vocalization = null;        
    
    /** 
     * The top position of the button in relative
     * coordinates (0 to 1, where 0 is the top 
     * of the board and 1 is the bottom).
     * @type {?number} */
    top = null;                 
    
    /**
     * The left position of the button in relative
     * coordinates (0 to 1, where 0 is the left 
     * of the board and 1 is the right).
     *  @type {?number} */
    left = null;                
    
    /** 
     * The width of the button in relative coordinates 
     * (0 to 1, where 1 is the full width of the board).
     * @type {?number} */  
    width = null;               
    
    /**
     * The height of the button in relative coordinates 
     * (0 to 1, where 1 is the full height of the board).
     *  @type {?number} */
    height = null;


    /**
     * Returns whether the button is considered "empty",
     * @returns {boolean} true if the button has no label, image, or background color; false otherwise.
     */
    get hidden() {
        let noLabel = typeof this.label !== "string" || this.label.length == 0
        let noImage = typeof this.image_id !== "string" || this.image_id.length == 0
        let noBackground = typeof this.background_color !== "string" || this.background_color.length == 0
        return noBackground && noImage && noLabel;
    }

    get allActions() {
        let actions = [];
        if (this.action) {
            actions.push(this.action);
        }
        if (Array.isArray(this.actions)) {
            actions.push(...this.actions);
        }
        return actions;
    }

    get standardActions() {
        const navActions = OBButton.navigationActions;
        return this.allActions.filter(a => !(a.mode in navActions));
    }

    get navigationAction() {
        let action = {mode: null, value: null};
        if (this.load_board) {
            action.mode = "load_board"
            action.value = this.load_board
        } else {
            const navActions = OBButton.navigationActions;
            for (let a of this.allActions) {
               if (a.mode in navActions) {
                    action.mode = navActions[a.mode];
                    action.value = a.value;
               }
            }
        }
        return new OBAction(action);
    }


    /**
     * The text to insert when the button is pressed,
     * which can be a string or an array of strings to insert with spaces.
     * @type {?string}
     */
    get textInserted() {
        let textActions = this.allActions.filter(a => a.mode === "insert_text").map(a => a.value);
        if (textActions.length > 0) {
            return textActions.join(" ");
        } else {
            return null;
        }
    }
    
    /**
     * The utterance associated with the button, 
     * which is determined by the following precedence:
     * 1. vocalization property
     * 2. text inserted by the button's actions
     * 3. label of the button
     * @type {?string}
     */
    get utterance() {
        return this.vocalization || this.textInserted || this.label
    }

    /**
     * Returns an object containing the color theme for the button,
     * including the main color, hover color, active color, 
     * tab color, tab hover color, tab active color,
     * outline color, and text color.
     * If a color is not specified, it will be derived from the background color.
     * @returns {Object} An object containing the color theme for the button.
     */
    get colorTheme() {
        const bg = new Color(this.background_color);
        const outline = new Color(this.border_color);
        const text = new Color(this.text_color);
        const tab = new Color(this.feature_color);

        let styles = { };

        if (outline.valid) styles["outline"] = outline.toHex();
        if (text.valid) styles["text"] = text.toHex();

        if (bg.valid) {
            // bg.l = bg.l * 0.8
            styles["main"] = bg.toHex();

            const mc = bg.clone();
            mc.s *= 1.2
            mc.l *= 0.9
            styles["main-hover"] = mc.toHex();

            mc.s *= 1.2
            mc.l *= 0.9
            styles["main-active"] = mc.toHex();


            let tabCol;
            // Tab color
            if (!tab.valid) {
                const tc = bg.clone();

                tc.s *= 0.9
                tc.l *= 0.7
                styles["tab-color"] = tc.toHex();
                tabCol = tc.clone();

                tc.l *= 5/6
                styles["tab-hover"] = tc.toHex()

                tc.l *= 5/6
                styles["tab-active"] = tc.toHex();
            
            } else {
                styles["tab-color"] = tab.toHex();
                tabCol = tab.clone();

                const tc = tab.clone();
                tc.l *= 5/6
                styles["tab-hover"] = tc.toHex();

                tc.l *= 5/6
                styles["tab-active"] = tc.toHex();
            }

            if (!text.valid) {
                styles["text"] = bg.brightness > 128 ? "black" : "white";
            }

            if (!outline.valid) {
                if (tabCol.s < 0.05) {
                    tabCol.l *= 0.3;
                } 
                tabCol.s *= 1.2;
                tabCol.l *= 0.6;
                styles["outline"] = tabCol.toHex();
            }
        }

        styles['icon-color'] = 'currentColor'
        styles['icon-color-hover'] = 'currentColor'


        return styles;
    }

    static newID() {
        return Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
    }

    static makeEmptyButton() {
        return this.make({
            id: OBButton.newID(),
            actions: ["&", ":return"],
            label: "",
            image_id: null,
            load_board: null,
        });
    }

    static get styleProperties() {
        return [
            "font_size",
            "bold",
            "italic",
            "background_color",
            "border_color",
            "text_color",
        ]
    }

    static get navigationActions() {
        return {
            "home": "home",
            "core": "home",
            "back": "back", 
            "return": "return", 
        }
    }

    static get fontSizes() {
        return ["tiny", "small", "medium", "large", "huge", "giant"];
    }

}

class OBGrid extends DataClass {
    /** 
     * The number of rows in the grid.
     * @type {number} */
    rows;      
    static rows_parser(value) { return Number(value); }
    
    /** 
     * The number of columns in the grid.
     * @type {number} */
    columns;   
    static columns_parser(value) { return Number(value); }
    
    /** 
     * The order of button IDs in the grid, 
     * represented as a 2D array where each 
     * element is a button ID.
     * @type {string[][]} */
    order;     
    

    validate() {
        let {rows, columns, order} = this;
        function normaliseArray(arr, length) {
            let newArr = new Array(length).fill(null);
            if (Array.isArray(arr)) {
                for (let i = 0; i < Math.min(arr.length, length); i++) {
                    newArr[i] = arr[i];
                }
            } else if (arr && typeof arr === "object") {
                for (let key in arr) {
                    newArr[key] = arr[key];
                }
            }

            return newArr;
        }
        const newOrder = normaliseArray(order, rows).map((row) => normaliseArray(row, columns))
        this.order = newOrder;
    }

}

/**
 * @template {OBButton} ButtonClass
 */
class OBBoard extends OpenBoardObject {
    /** 
     * The grid layout of the board.
     * @type {OBGrid} */
    grid;   
    static grid_parser(value) { return OBGrid.make(value); }                    
    
    /** 
     * The openboard format version.
     * @type {string} */
    format = "open-board-0.1";  
    
    /** 
     * The name of the board, which can be displayed in the UI.
     * @type {?string} */
    name = null;                
    
    /** 
     * A description of the board, which can 
     * be displayed in the UI.
     * @type {?string} */
    description_html = null;  
    
   
    /** 
     * A URL to load the board from, which can be used 
     * for reference or debugging.
     * @type {?string} */
    url = null;                
    
    /** 
     * The locale of the board, which can be used for 
     * language-specific processing or display.
     * @type {string} */
    locale = "en";              
    
    /**
     * The list of buttons on the board, 
     * where each button is an instance of OBButton.
     *  @type {ButtonClass[]} */
    buttons = [];      
    static buttons_parser(value) { 
        let buttons = []
        if (value) {
            if (!Array.isArray(value)) {
                throw new Error("Buttons must be an array not " + typeof value);
            } else {
                buttons = value.map(b => OBButton.make(b)).filter(b => b.hidden === false);
            }
        }
        return buttons
    }         
    
    /** 
     * The list of images used on the board, 
     * where each image is an instance of OBImage.
     * @type {OBImage[]} */
    images = [];
    static images_parser(value) {  return value ? value.map(i => OBImage.make(i)) : []; }

    /**
     * Gets a button by its ID from the board's buttons list.
     * @param {string} id - The ID of the button to retrieve.
     * @returns {?ButtonClass} The button with the specified ID, or undefined if not found.
     */
    getButtonByID(id) {
        return this.buttons.find(b => b.id == id);
    }

    /**
     * Gets an image by its ID from the board's images list.
     * @param {string} id - The ID of the image to retrieve.
     * @returns {?OBImage} The image with the specified ID, or undefined if not found.
     */
    getImageByID(id) {
        return this.images.find(i => i.id == id);
    }


    /**
     * @returns {OBLoadBoard[]} An array of OBLoadBoard objects representing the linked boards.
     */
    get linkedBoards(){
        return this.buttons.map(b => b.load_board).filter(load_board => load_board != null);
    }


    /**
     * Gets the locations of buttons in the grid,
     * if a button's ID appears contiguously in the grid, 
     * it is considered to occupy a rectangular area.
     * This method will return unique positions and 
     * their corresponding button IDs.
     *
     * @param {stirng[]} buttonIDs - An optional array of button IDs to filter the locations.
     * @returns {LocationInfo[]}
     */
    getButtonLocations(ids) {
        const {rows, columns, order} = this.grid;
        const visited = new Set();
        const locations = {};
        const loc2posID = {}

        const loc = (r, c) => `${r},${c}`;
        let posIDCounter = 0;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < columns; c++) {
                let posID = posIDCounter++;
                const buttonID = order[r][c];
                const l = loc(r, c);
                const lUp = loc(r-1, c);
                const lLeft = loc(r, c-1);

                if (lLeft in loc2posID && loc2posID[lLeft][1] === buttonID) {
                    posID = loc2posID[lLeft][0];
                } else if (lUp in loc2posID && loc2posID[lUp][1] === buttonID) {
                    posID = loc2posID[lUp][0];
                }

                if (!(posID in locations)) locations[posID] = new Set();
                locations[posID].add(order[r][c]);
                loc2posID[l] = [posID, buttonID]
            }
        }
        
        const posID2loc = {};
        for (let loc in loc2posID) {
            const [posID, buttonID] = loc2posID[loc];
            if (!(posID in posID2loc)) {
                posID2loc[posID] = new Set();
            }
            posID2loc[posID].add(loc);
        }

        for (let posID in posID2loc) {
            const locs = Array.from(posID2loc[posID]).map(l => l.split(",").map(Number));
            const minRow = Math.min(...locs.map(([r, c]) => r));
            const maxRow = Math.max(...locs.map(([r, c]) => r));
            const minCol = Math.min(...locs.map(([r, c]) => c));
            const maxCol = Math.max(...locs.map(([r, c]) => c));
            posID2loc[posID] = {rowRange: [minRow, maxRow], colRange: [minCol, maxCol], buttonID: Array.from(locations[posID])[0]};
        }

        
        let locationArray = Object.values(posID2loc)
        if (Array.isArray(ids) && ids.length > 0) {
            let idsSet = new Set(ids);
            locationArray = locationArray.filter(loc => idsSet.has(loc.buttonID));
        }
        return locationArray;
    }


    validate() {
        // Remove any button IDs from the grid that do not correspond 
        // to existing buttons or are considered hidden. 
        const buttonIDs = new Set(this.buttons.map(b => b.id));

        const order = this.grid.order;
        for (let row of order) {
            for (let i = 0; i < row.length; i++) {
                if (row[i] !== null && !buttonIDs.has(row[i])) {
                    row[i] = null;
                }
            }
        }

        const imageIDs = new Set(this.images.map(i => i.id));
        for (let button of this.buttons) {  
            if (button.image_id !== null && !imageIDs.has(button.image_id)) {
                button.image_id = null;
            }
        }
    }


     /**
     * @param {number} rows
     * @param {number} columns
     * @param {string} id - Optional ID for the new board. If not provided, a new ID will be generated.
     * @returns {OBBoardEditable}
     */
    static makeEmptyBoard(rows, columns, id = OBButton.newID()) {
        const buttons = new Array(rows * columns).fill(0).map(() => OBButton.makeEmptyButton());
        const order = array2D(rows, columns, (r,c) => buttons[r * columns + c].id);
        return this.make({
            id: id,
            name: "empty board",
            grid: {rows, columns, order: buttons.map(b => b.id)},
            buttons: buttons,
        });
    }


    static async load(url, onprogress = () => {}) {
        let data = await loadFile(url, "json", onprogress);
        if (data.board) {
            data = data.board;
        }
        return this.make(data);
    }
}

export { OBBoard, OBAction, OBButton, OBImage, OBSymbol, OBLoadBoard };