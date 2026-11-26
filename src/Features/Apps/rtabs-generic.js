import { SvgPlus } from "../../SvgPlus/4.js";
import { AccessEvent } from "../../Utilities/Buttons/access-buttons.js";
import { GridCard, GridIcon, GridLayout } from "../../Utilities/GridLayout/grid-icons.js";
import { RoundedTabs } from "../../Utilities/RoundedTabs/rounded-tabs.js";
import { AccessTextarea } from "../../Utilities/Textarea/textarea.js";
import { delay, relURL } from "../../Utilities/usefull-funcs.js";

function toRows(array, cols) {
    const rows = [];
    for (let i = 0; i < array.length; i += cols) {
        rows.push(array.slice(i, i + cols));
    }
    return rows;
}

class CategoryDisplay extends GridLayout {
    #categories = [];
    #selectedPath = [0];
    #rowPerLevel = {};
    #maxLevels = 0;

    constructor(rows, cols) {
        super(rows, cols);
    }


    set categories(categories) {
        const [rows, cols] = this.size;
        let levels = { }
        let recurse = (cats, level) => {
            if (!levels[level]) levels[level] = 0;
            levels[level] = Math.max(levels[level], cats.length);
            for (let cat of cats) {
                if (typeof cat === "object" && cat.categories) {
                    recurse(cat.categories, level + 1);
                }
            }
        }
        recurse(categories, 0);

        let requiredRows = 0;
        let rowsPerLevel = {};
        for (let level in levels) {
            rowsPerLevel[level] = Math.ceil(levels[level] / cols);
            requiredRows += rowsPerLevel[level];
        }
        if (requiredRows > rows) {
            this.size = [requiredRows, cols];
            console.warn("Adjusted grid size to fit required rows:", this.size);
        }

        let maxLevel = Math.max(...Object.keys(levels).map(Number));
        let rowPerLevel = {};
        for (let level = 0; level <= maxLevel; level++) {
            rowPerLevel[level] = (rowPerLevel[level - 1] ?? 0) + (rowsPerLevel[level-1] ?? 0);
        }

        this.#rowPerLevel = rowPerLevel;
        this.#categories = categories;
        this.#maxLevels = maxLevel;

        this.select(this.#selectedPath)
    }


    #makeItemIcon(item, index, level) {
        const itemClass = this.getItemClass();
        return new itemClass(item);
    }

    #makeCategoryIcon(category, index, level) {
        const catClass = this.getCategoryClass();
        const el = new catClass(category);
        el.addEventListener("access-click", (e) => {
            let newPath = this.#selectedPath.slice(0, level);
            this.select([...newPath, index])
        });
        return el;
    }


    select(path) {
        console.log("Selecting path:", path);
        this.innerHTML = "";
        const cols = this.size[1]
        let rowStart = 0;
        let build = (cats, level, selected) => {
            let row = 0;
            cats.map((cat, i) => {
                const icon = typeof cat === "object" && cat.categories 
                    ? this.#makeCategoryIcon(cat, i, level) 
                    : this.#makeItemIcon(cat, i, level)
                icon.selected = selected === i;
                row = Math.floor(i / cols)
                this.add(icon, row + rowStart, i % cols)
            });
            rowStart += row + 1;
        }


        let cats = this.#categories;
        path.forEach((selected, i) => {
            if (!cats) return;
            build(cats, i, selected)
            cats = cats[selected]?.categories ?? null
        });

        if (cats) build(cats, path.length, null)
        this.#selectedPath = [...path];
    }


    getCategoryClass() {
        return GridIcon;
    }

    getItemClass() {
        return GridIcon;
    }
}

class SearchableList extends GridLayout {
    #page = 0;
    #lastSet = [];
    #lastSize = 0;
    constructor(rows, cols) {
        super(rows, cols);

        this.navigation = new GridLayout(1, cols);
        this.textCard = new GridCard('access-button', "plain", "textarea")
        this.textCard.group = "search";

        this.textInput = this.textCard.content.createChild(AccessTextarea, {
            events: {
                "input": (e) => {
                    this.setList(this.#lastSet);
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
            accessGroup: "search",
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
            accessGroup: "search",
            events: {
                "access-click": (e) => {
                    this.nextPage();
                }
            }
        }, 0,4)


        this.searchMain = this.add(new GridLayout(rows - 1, cols), [1, rows - 1], [0, cols - 1]);
    }

    nextPage() {
        this.#page++;
        this.setList(this.#lastSet);
    }

    previousPage() {
        this.#page--;
        this.setList(this.#lastSet);
    }

    getItemClass() {
        return GridIcon;
    }

    matchesSearch(search, item, id) {

    }
    

    /**
     * @param {Object<string, any>} boards
     */
    setList(items) {
        this.#lastSet = items;
        const itemClass = this.getItemClass();
        
        const ids = Object.keys(items);
        const length = ids.length;

        const [rows, cols] = this.size
        let values = Object.values(items);

        if (length < rows * cols) {
            this.innerHTML = "";
            this.addItemInstances(itemClass, toRows(values, cols), 0, 0);
        } else {
            const search = this.textInput.value.toLowerCase().trim().split(/\s+/);
            if (search && search.length > 0) {
                values = ids
                    .filter(id => this.matchesSearch(search, items[id], id))
                    .map(id => items[id]);
            }

            let pages = toRows(toRows(values, cols), rows - 1); 
            if (this.#page >= pages.length) {
                this.#page = 0;
            }
            
            this.pageIndicator.setAttribute("page-num", this.#page + 1);
            this.pageIndicator.setAttribute("total-pages", pages.length);
            this.pageIndicator.style.setProperty("--p", (this.#page + 1) / pages.length);
            this.nextButton.disabled = this.#page >= pages.length - 1;
            this.previousButton.disabled = this.#page <= 0;

            if (this.#lastSize < rows * cols) {
                this.innerHTML = "";
                this.add(this.navigation, 0, [0,cols-1]);
                this.add(this.searchMain, [1, rows-1], [0,cols-1]);
            }

            this.searchMain.innerHTML = "";
            if (pages[this.#page].length > 0) {
                this.searchMain.addItemInstances(itemClass, pages[this.#page], 0, 0);
            }
        }
        this.#lastSize = length;
    }
}

class TabButton extends GridIcon {
    constructor(args, br = 20, sp = 4) {
        super(args, "tabs");
        this.br = br;
        this.sp = sp;
        this.addEventListener("access-click", (e) => {
            e.waitFor(delay(100))
            if (e.clickMode !== "click") {
                this.dispatchEvent(new CustomEvent("click", { bubbles: true }));
            }
        })
    }

    getBorderStyle() {
        let old = super.getBorderStyle();
        old[0] = this.br - old[1] * 0.5 - this.sp;
        return old;
    }
}

class RTabsGeneric extends RoundedTabs {
    constructor(items, br = 20, sp = 4) {
        super([
             {
                title: new TabButton({
                    colorTheme: "action",
                    symbol: "close",
                    type: "plain",
                    events: {
                        "access-click": (e) => {
                            this.dispatchEvent(new AccessEvent("close", e, { bubbles: true }))
                        }
                    }
                }, br, sp),
                noSelect: true,
                content: new SvgPlus("div")
            },
            ...items.map(item => ({
                title: new TabButton(item.gridIcon, br, sp),
                content: item.content,
                key: item.key,
            }))
        ]);
        this.classList.add("gen");
        this.br = br;
        this.sp = sp;

        this.select(1)
    }


    getBorderRadius() {
        return this.br;
    }

    static get usedStyleSheets() {
        return [
            ...RoundedTabs.usedStyleSheets,
            relURL("./rtabs.css", import.meta),
            ...AccessTextarea.usedStyleSheets
        ]
    }
}

export { RTabsGeneric , SearchableList, CategoryDisplay};