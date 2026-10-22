import { Path } from "../OpenBoard/Path.js";
import { BoardMetadata, getBoardMetadata, watchMyFavouriteBoards, watchPublicBoards } from "../OpenBoard/boards.js";
import { addAuthChangeListener } from "../../../Firebase/firebase.js";
import { SvgPlus } from "../../../SvgPlus/4.js";
import { ShadowElement } from "../../../SvgPlus/shadow-element.js";
import { GridCard, GridIcon, GridLayout } from "../GridLayout/grid-icons.js";
import { RoundedTabs } from "../RoundedTabs/rounded-tabs.js";
import { AccessTextarea } from "../Textarea/textarea.js";
import { AccessEvent } from "../../../Utilities/Buttons/access-buttons.js";
import { relURL } from "../../../Utilities/usefull-funcs.js";

function toRows(array, cols) {
    const rows = [];
    for (let i = 0; i < array.length; i += cols) {
        rows.push(array.slice(i, i + cols));
    }
    return rows;
}


const DROWS = 4;
const DCOLS = 5;
const FROWS = 2;
const GAP = 4;
const SP = 3;
const BR = 20;

const FEATURED_BOARDS = [
    {
        title: "Keyboards",
        img: relURL("../Assets/logo.svg", import.meta),
        boards: [
            // "PkNtxxwUyntPbXalmdJB",
            // "gfxpGyVxp54ZUAmwr2Lg",
            // "U5uKJRS5H0mnp0hPzP6E",
            // "LcXf0yWUT5n3syU2n4WO",
            // "5MtHTgn0ukUt7u4Fs3yU",

            // "8oKZZp4cw9uDmiRfiijM",
            // "4SsWDV7IqU0tiNg3Vtp0",
            // "S98Y4J5gnR3hQSy80tEF",
            // "JkXZ2Cm3OzXTw8u2yKSl",
            // "kDClJEcGEkPaOZq831HD",

            // "JLYix9KezJaosLusUhkl",
            // "GPomuZcnGmpn7hNuX2S6",
            "bO8yY3GEkU8o3g0rkcTv",
            "InZgWP9sywxFUwOJO0TQ"
        ]
    },
    {
        title: "PRC Saltillo",
        // img: import.meta.resolve("./prc.svg"),
        boards: [
            "tVO399IgcEuTW6FLTDZP",
            "rTezEUKTUzcOGAdleZkh",
            "zmnKiAkXdSTdjCtB6WmV",
            "HWRGaqWL8AjrRfAFW4ik"
        ]
    },
    {   
        title: "Quick Core",
        // img: import.meta.resolve("./quick-core.svg"),
        boards: [
            "U03vkiTufZO9gYzuTiZX",
            "7Sss73pXR7Vj9ZImTrev",
            "A3PbgIuX4w4hahQWn7o0",
            "JdfvRskx5EcpPpUudK5o",
            "O8jfO4mJK9IosDXzrDCf",
        ]
    },
    {
        title: "Vocal Flair",
        img: "https://www.openaac.org/images/2024/vocal-flair-24.png",
        boards: [
            "gZ5sGqKdTmBMLnPeaIMJ",
            "tmQ85C2zDckDIbcxV5XE",
            "H3SqbnGwX1bjHI2Xv0iB",
            "5sBqMpBRVEQp5aFYTuo4",
            "mlvuf8KAWlEVxusyFIt1",
        ]
    },
    {
        title: "Everyday Life",

        boards: [
            "8oKZZp4cw9uDmiRfiijM",
            "4SsWDV7IqU0tiNg3Vtp0",
            "S98Y4J5gnR3hQSy80tEF",
            "JkXZ2Cm3OzXTw8u2yKSl",
            "kDClJEcGEkPaOZq831HD"
        ]
    },
    {
        title: "People, Play & Interests",
        boards: [
            "PkNtxxwUyntPbXalmdJB",
            "gfxpGyVxp54ZUAmwr2Lg",
            "U5uKJRS5H0mnp0hPzP6E",
            "LcXf0yWUT5n3syU2n4WO",
            "5MtHTgn0ukUt7u4Fs3yU"
        ]
    },
    {   
        title: "Proloquo",
        boards: [
            "s9xO1YfGtLdwM1YOgG1S",
            "InZgWP9sywxFUwOJO0TQ"
        ]
    },
     
]

const FEATURED_BOARD_SET = new Set(FEATURED_BOARDS.flatMap(b => b.boards));

class BoardSelectionEvent extends AccessEvent {
    constructor(boardID, e) {
        super("board-selection", e, {bubbles: true});
        this.boardID = boardID;
    }
}
class BoardGridIcon extends GridIcon {
    constructor(id) {
        super({
            displayValue: "...",          
            colorTheme: "white",
            events: {
                "access-click": (e) => {
                    this.dispatchEvent(new BoardSelectionEvent(id, e));
                }
            }
        })
        this.classList.add("board-grid-icon");
        this.load(id);
        this.toggleAttribute("label-at-bottom", true)

        
    }

    async load(id) {
        const metadata = await getBoardMetadata(id);
        this.displayValue = metadata.path.name;
        this.symbol = metadata.thumbnail || relURL("./grid.svg", import.meta);
        const creator = await metadata.getOwnerName()
        this.subtitle = "By " + creator.name;
    }
}

class FixedGridLayout extends GridLayout {
    fixedBR = 15;
    computeIconBorderRadiusAndWidth() {
        let old = super.computeIconBorderRadiusAndWidth();
        old[0] = this.fixedBR;
        return old;
    }
}




class Featured extends FixedGridLayout {
    constructor() {
        super(DROWS,DCOLS)
        this.class = "featured"
        this.toggleAttribute("scale-font", true)

        const rows = toRows(FEATURED_BOARDS, DCOLS);
        
        /** @type {GridIcon[][]} */
        this.buttons = this.addGridIcons(rows.slice(0, FROWS).map((row, r) => 
            row.map((i, c) => ({
                displayValue: i.title, 
                colorTheme: "white", 
                type: "folder",
                labelOnBottom: true,
                // symbol: i.img,
                events: {
                    "access-click": (e) => {
                        this.selectCategory(r, c);
                    }
                }
            })),
        ));

        this.boardList = this.add(new FixedGridLayout(DROWS - FROWS, DCOLS), [FROWS, DROWS-1], [0, DCOLS-1]);
        
    }

    selectCategory(ri, ci) {
        this.buttons.forEach((row, r) => {
            row.forEach((button, c) => {
                button.toggleAttribute("hover", r === ri && c === ci);
            });
        });

        let index = ri * DCOLS + ci;
        if (index !== this.lastIndex) {
            this.lastIndex = index;
            const boards = FEATURED_BOARDS[index].boards;
            const bRows = toRows(boards, DCOLS).slice(0, DROWS - FROWS);
            this.boardList.innerHTML = "";
            this.boardList.addItemInstances(BoardGridIcon, bRows, 0, 0)
        }
        
    }
}

class SearchableList extends FixedGridLayout {
    #page = 0;
    #lastSet = [];
    #lastSize = 0;
    constructor() {
        super(DROWS, DCOLS);
        this.toggleAttribute("scale-font", true)

        this.navigation = new GridLayout(1, DCOLS);
        this.textCard = new GridCard('access-button', "plain", "textarea")
        this.textInput = this.textCard.content.createChild(AccessTextarea, {
            events: {
                "input": (e) => {
                    this.setList(this.#lastSet);
                    // console.log("Search input changed");
                }
            }
        });
        this.pageIndicator = this.textCard.content.createChild("div", {class: "page-progress"});
        this.pageIndicator.createChild("div");
        this.pageIndicator.createChild("div");
        this.navigation.add(this.textCard, [0,0], [1,3])


        this.previousButton = this.navigation.addGridIcon({
            // displayValue: "Search",
            colorTheme: "action",
            symbol: "leftArrow",
            events: {
                "access-click": (e) => {
                    this.previousPage();
                }
            }
        }, 0,0)

        this.nextButton = this.navigation.addGridIcon({
            // displayValue: "Search",
            symbol: "rightArrow",
            colorTheme: "action",
            events: {
                "access-click": (e) => {
                    this.nextPage();
                }
            }
        }, 0,4)


        this.searchMain = this.add(new GridLayout(DROWS - 1, DCOLS), [1, DROWS - 1], [0, DCOLS - 1]);
    }

    nextPage() {
        this.#page++;
        this.setList(this.#lastSet);

    }

    previousPage() {
        this.#page--;
        this.setList(this.#lastSet);
    }
    

    /**
     * @param {Object<string, BoardMetadata>} boards
     */
    setList(boards) {
        this.#lastSet = boards;
        let ids = Object.keys(boards);
        // ids =[...ids, ...ids, ...ids, ...ids];
        let length = ids.length;

        if (ids.length < DCOLS * DROWS) {

            this.innerHTML = "";
            this.addItemInstances(BoardGridIcon, toRows(ids, DCOLS), 0, 0);

        } else {
            
            const search = this.textInput.value.toLowerCase().trim().split(/\s+/);
            if (search && search.length > 0) {
                ids = ids.filter(id => {
                    let boardPath = new Path(boards[id].path).parts;
                    let words = boardPath.flatMap(part => part.toLowerCase().trim().split(/\s+/));
                    return search.some(term => words.some(word => word.startsWith(term)));
                });
            }

            let pages = toRows(toRows(ids, DCOLS), DROWS - 1); 
            if (this.#page >= pages.length) {
                this.#page = 0;
            }
            
            this.pageIndicator.setAttribute("page-num", this.#page + 1);
            this.pageIndicator.setAttribute("total-pages", pages.length);
            this.pageIndicator.style.setProperty("--p", (this.#page + 1) / pages.length);
            this.nextButton.disabled = this.#page >= pages.length - 1;
            this.previousButton.disabled = this.#page <= 0;

            if (this.#lastSize < DCOLS * DROWS) {
                // console.log("Resetting innerHTML and adding navigation and searchMain");
                this.innerHTML = "";
                this.add(this.navigation, 0, [0,DCOLS-1]);
                this.add(this.searchMain, [1, DROWS - 1 ], [0,DCOLS-1]);
            }
            this.searchMain.innerHTML = "";
            if (pages[this.#page].length > 0) {
                this.searchMain.addItemInstances(BoardGridIcon, pages[this.#page], 0, 0);
            }
        }
        this.#lastSize = length;
    }

    async load() {
        this.list = await this.getList();
        this.innerHTML = "";
        // for 
    }
}

class AACExplore extends ShadowElement {

    constructor(el) {
        super(el, "aac-explore-root");

        
        this.root.styles = {"--space": `${SP}px`}

       
        class GI extends GridIcon {
            getCardBorderRadiusAndWidth() {
                let old = super.getCardBorderRadiusAndWidth();
                old[0] = BR - old[1] * 0.5 - SP;
                return old;
            }
        }

        const publicList = new SearchableList("div");
        const favourite = new SearchableList("div");
        const all = new SearchableList("div");


        watchPublicBoards((boards) => {
            let notFeatured = {}
            for (let id in boards) {
                if (!FEATURED_BOARD_SET.has(id)) {
                    notFeatured[id] = boards[id];
                }
            }
            publicList.setList(notFeatured);
        })

        let unsubscribe = null;
        addAuthChangeListener((u) => {
            if (unsubscribe) {
                unsubscribe();
            }
            unsubscribe = watchMyFavouriteBoards(u.uid, (boards) => {
                favourite.setList(boards);
            });
        })



        this.tabs = this.createChild(RoundedTabs, {}, [
            {
                title: new GI({
                    displayValue: "Close", 
                    colorTheme: "action",
                    events: {
                        click: () => {
                            this.close();
                            // console.log("Closing AAC Explore");
                        },
                        "access-click": () => {
                            // console.log("Access-click closing AAC Explore");
                            this.close();
                        }
                    }
                }) ,
                noSelect: true,
                content: new SvgPlus("div"),
            },
            {
                title: new GI({displayValue: "Featured", colorTheme: "featured"}) ,
                content: new Featured(),
                key: "featured",
            },
            {
                title: new GI({displayValue: "Public", colorTheme: "public"}) ,
                content: publicList,
                key: "public",
            },
            {
                title: new GI({displayValue: "Favourite", colorTheme: "favourite"}) ,
                content: favourite,
                key: "favourite",
            },
            {
                // content: all,
                title: "",

                // title: new GI({displayValue: "Search", colorTheme: "noun"}) ,
                // key: "search",
                noSelect: true

            }
        ]);
        this.tabs.select(1)
        this.tabs.getBorderRadius = (fs, ts) => {
            return BR;
        }
    }


    close() {
        this.root.style.transform = "translateY(100%)";
    }
    open() {
        this.root.style.transform = "translateY(0)";
    }


    static get usedStyleSheets() {
        return [
            ...AccessTextarea.usedStyleSheets,
            ...RoundedTabs.usedStyleSheets,
            ...GridIcon.usedStyleSheets,
            relURL("../icons.css", import.meta),
            relURL("./index.css", import.meta),
        ]
    }
}

export { AACExplore };
