import { SvgPlus } from "../../SvgPlus/4.js";
import { AccessEvent } from "../../Utilities/Buttons/access-buttons.js";
import { GridIcon, GridLayout } from "../../Utilities/GridLayout/grid-icons.js";
import { Icon } from "../../Utilities/GridLayout/icons.js";
import { HideShowTransition } from "../../Utilities/hide-show.js";
import { RoundedTabs } from "../../Utilities/RoundedTabs/rounded-tabs.js";
import { filterAndSort, SearchWindow } from "../../Utilities/search.js";
import { Color, delay, relURL } from "../../Utilities/usefull-funcs.js";
import { AppDescriptor } from "./apps-library.js";
import { CategoryDisplay, RTabsGeneric, SearchableList } from "./rtabs-generic.js";

const DROWS = 4;
const DCOLS = 5;

class AppSelectionEvent extends AccessEvent {
    constructor(app, event) {
        super("value", event, {bubbles: true});
        this.value = app;
    }
}
class AppCategoryIcon extends GridIcon {
    constructor(cat, group) {
        super({
            // colorTheme: "noun", 
            type: "folder",
            ...(cat.icon ? {symbol: cat.icon} : {}),
            ...(cat.noText ? {} : {displayValue: cat.name}),
            labelOnBottom: true,
        }, group)
        this.category = cat;
        if (cat.color) {
            let main = new Color(cat.color);
            let tab = main.clone();
            tab.l *= 0.8;
            let mainHover = main.clone();
            mainHover.l *= 0.9;

            let tabHover = tab.clone();
            tabHover.l *= 0.9;

            let mainActive = main.clone();
            mainActive.l *= 0.8;

            let tabActive = tab.clone();
            tabActive.l *= 0.8;

            let outline = main.clone();
            outline.l *= 0.4;
            outline.s *= 1.2;

            let icon = main.clone();
            icon.s *= 1.2;
            icon.l *= 0.5;

            let iconHover = icon.clone();
            iconHover.l *= 0.9;

            this.styles = {
                "--main": main+"",
                "--tab": tab+"",
                // "--text": ,
                "--main-hover": mainHover+"",
                "--tab-hover": tabHover+"",
                "--main-active": mainActive,
                "--tab-active": tabActive,
                "--outline": outline,
                "--icon-color": icon ,
                "--icon-color-hover": iconHover,
            };
        }

        if (cat.description) {
            const info =this.content.createChild("div", {
                class: "info",
                events: {
                    click: (e) => {
                        e.stopImmediatePropagation();
                        e.stopPropagation();
                    }
                }
            })
            info.createChild(Icon, {}, "info");
            info.createChild("div", {class: "message", content: cat.description});
        }
            
        // info.createChild("div", {content: });
    }
    set selected(bool) {
        this.highlight = bool;
    }
}

class AppIcon extends GridIcon {
    /**
     * @param {AppDescriptor} app - The app descriptor object containing app details.
     */
    constructor(app, group) {
        super({
            displayValue: app.name,
            ...(app.icon ? {symbol: app.icon} : {}),
            colorTheme: "app-icon",
            labelOnBottom: true,
            events: {
                "access-click": (e) => {
                    this.dispatchEvent(new AppSelectionEvent(app, e))
                }
            }
        }, "aaa" + group);
    }
}

class AppsByCategory extends CategoryDisplay {
    getItemClass() {
        return AppIcon;
    }
    getCategoryClass() {
        return AppCategoryIcon;
    }
}





class AppListSearch extends SearchableList {
    getItemClass() {
        return AppIcon;
    }

    matchesSearch(search, item, id) {
        const name = item.info.name.toLowerCase();
        return search.every(term => name.includes(term));
    }
}



class AppsSearch extends HideShowTransition {
  constructor() {
    super("app-search", "up");
    this.appsByCategory = new AppsByCategory(DROWS, DCOLS);
    this.appListSearch = new AppListSearch(DROWS, DCOLS);
    this.tabs = this.createChild(
        RTabsGeneric, {}, 
        [
            {
                gridIcon: {
                    displayValue: "Featured",
                    colorTheme: "featured",
                    type: "plain",
                },
                content: this.appsByCategory,
                key: "featured",
            },
            {
                gridIcon: {
                    displayValue: "Search",
                    colorTheme: "search",
                    type: "plain",
                },
                content: this.appListSearch,
                key: "public",
            }
        ]
    )

    this.events = {
        "close": (e) => {
            this.dispatchEvent(new AppSelectionEvent(null, e))
        }
    }
  }

  
  reset(imm) {
    this.closeIcon = "close";
  }


  /**
   * Sets the library for the search component.
   * @param {AppLibrary} library - The library containing app information.
   */
  set library(library) {
    let refo = (cat) => {
        if (cat?.apps) {
            cat.categories = cat.apps.map(refo).filter(c => c !== null);
            return cat?.apps?.length === 0 ? null : cat;
        } else {
            return cat;
        }
    }
    let cats = refo({apps: library.categories})?.categories || [];
    this.appsByCategory.categories = cats;
    this.appListSearch.setList(library.apps);
  }


  static get usedStyleSheets() {
    return [
        relURL("../../Utilities/GridLayout/icons.css", import.meta),
        relURL("./style.css", import.meta),
        relURL("./ICSS_Icons/icons.css", import.meta),
        ...RTabsGeneric.usedStyleSheets,
    ]
  }
}

export { AppsSearch };