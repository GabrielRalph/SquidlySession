import { SvgPlus } from "../../SvgPlus/4.js";
import { AccessTextArea } from "../../Utilities/access-textarea.js";
import { AccessEvent } from "../../Utilities/Buttons/access-buttons.js";
import { GridIcon, GridLayout } from "../../Utilities/Buttons/grid-icon.js";
import { Rotater, Slider } from "../../Utilities/rotater.js";
import { relURL } from "../../Utilities/usefull-funcs.js";
import { OccupiableWindow } from "../features-interface.js";

class ProfileSelectionEvent extends AccessEvent {
    constructor(oldEvent, id) {
        super("profile-select", oldEvent, {
            bubbles: true,
        });
        this.profileID = id;
    }
}

class ProfileIcon extends GridIcon {
    /**
     * @param {{name: string, profileID: string, image: string}} profile
     */
    constructor(profile) {
        super({
            type: profile.name == "default" ? "noun" : "normal",
            symbol: profile.image ? profile.image : "user",
            displayValue: profile.name == "default" ? "Default Profile" : profile.name,
            events: {
                "access-click": async e => {
                    this.dispatchEvent(new ProfileSelectionEvent(e, profile.profileID));
                }
            }
        });
        this.profileID = profile.profileID;
        this._text = this.displayValue.toLowerCase();
    }

    matches(text) {
        if (typeof text !== "string" || text.trim() === "") {
            return true;
        }
        text = text.trim().toLowerCase();
        return this._text.indexOf(text) !== -1;
    }
}

class ProfilesPage extends GridLayout {
    /**
     * @param {ProfileIcon[]} profiles
     */
    constructor(profiles) {
        super(2, 3);
        this.addItems(profiles.slice(0, 3), 0, 0);
        if (profiles.length > 3) {
            this.addItems(profiles.slice(3, 6), 1, 0);
        }
    }   
}

class ProfilesList extends GridLayout {
    constructor() {
        super(2, 5);
        this.class = "profiles-list";
        this.navigation = {
            last: this.addGridIcon({
                type: "verb",
                symbol: "leftArrow",
                events: {
                    "access-click": e => e.waitFor(this.gotoPage(this.currentPage - 1))
                }
            }, [0,1], 0),
            next: this.addGridIcon({
                type: "starter",
                symbol: "rightArrow",
                events: {
                    "access-click": e => e.waitFor(this.gotoPage(this.currentPage + 1))
                }
            }, [0,1], 4)
        }

        this.slider = this.add(new Slider("horizontal"), [0,1], [1,3]);
    }


    /**
     * @param {number} pageNum - The index of the page to navigate to.
     * @param {boolean} immediately - If true, the slider will jump to the page without animation. 
     *                                If false, it will slide to the page.
     */
    async gotoPage(pageNum, immediately = false) {
        if (pageNum < 0 || pageNum >= this._pages.length) {
            return;
        }
        let page = this._pages[pageNum];
        let pageInstance = new ProfilesPage(page);
        let lastPage = this._currentPage;
        this._currentPage = pageNum;

        this.navigation.last.disabled = this._pages.length <= 1 || pageNum <= 0;
        this.navigation.next.disabled = this._pages.length <= 1 || pageNum >= this._pages.length - 1;
     
        await this.slider.setContent(pageInstance, immediately ? null : lastPage-pageNum);
    }


    set filter(text) {
        this._filter = text;
        let filteredPages = [];
        let filteredProfiles = this._profiles.filter(profile => profile.matches(text));
        if (filteredProfiles.length === 0) {
            filteredProfiles = this._profiles;
        }
        for (let i = 0; i < filteredProfiles.length; i += 6) {
            filteredPages.push(filteredProfiles.slice(i, i + 6));
        }
        this._pages = filteredPages;
        if (this.currentPage >= filteredPages.length) {
            this.gotoPage(filteredPages.length - 1, true);
        } else {
            this.gotoPage(this.currentPage, true);
        }
    }
    get filter() {
        return this._filter;
    }

    /**
     * @param {Array<{name: string, profileID: string, image: string}>} profiles
     */
    set profiles(profiles) {
        this._profiles = profiles.map(profile => new ProfileIcon(profile));
        this.filter = this.filter || "";
    }

    get currentPage() {
        return this._currentPage || 0;
    }
}

export class ProfileSelector extends GridLayout {
    constructor(message) {
        super(4, 5);
        this.list = this.add(new ProfilesList(), [1,2], [0,4]);
        let text = this.add(new AccessTextArea(), 3, [1, 3]);
        this.textArea = text;
        text.addEventListener("input", (e) => {
            this.list.filter = text.value;
            this.addButton.disabled = text.value.trim() === "";
        })

        let creatProfile = async (e) => {
            let id = await this.makeUserProfile(text.value);
            this.dispatchEvent(new ProfileSelectionEvent(e, id));
        }

        this.addGridIcon({
            type: "action", displayValue: "Close", symbol: "close",
            events: {
                "access-click": async e => {
                    this.dispatchEvent(new AccessEvent("close", e, {bubbles: true}));
                }
            }
        }, 0, 0);


        this.addGridIcon({
            type: "action", displayValue: "Keyboard", symbol: "upArrow",
            events: {
                "access-click": async e => {
                    let input = await this.getInputFromKeyboard(text.value, e)
                    text.value = input;
                    this.addButton.disabled = input.trim() === "";
                    this.list.filter = input;
                }
            }
        }, 3, 0);

        this.addButton = this.addGridIcon({
            type: "action", displayValue: "Create New Profile", symbol: "add",
            events: {
                "access-click": async e => {
                    e.waitFor(creatProfile(e));
                }
            }
        }, 3, 4);
        this.addButton.disabled = true;

        let info = this.addItemInstance(SvgPlus, "div", 0, [1,4]);
        info.class = "info";
        info.innerHTML = message || `
            <h2>Profile Selector</h2>
            <p>Select a profile to use for this session. Profiles contain your display name and image, which will be visible to other participants in the session. You can manage your profiles in the settings menu.</p>
        `;
    }


    async getInputFromKeyboard() {}
    async makeUserProfile() {}


    clear() {
        this.textArea.value = "";
        this.addButton.disabled = true;
        this.list.filter = "";
    }

    static get usedStyleSheets() {
        return [
            Rotater.styleSheet,
            GridIcon.styleSheet,
            relURL("./profile-selector.css", import.meta),
            AccessTextArea.styleSheet,
        ]
    }
}
