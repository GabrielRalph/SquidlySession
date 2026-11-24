import { SvgPlus } from "../../SvgPlus/4.js";
import { GridCard, GridIcon, GridLayout } from "../../Utilities/GridLayout/grid-icons.js";
import { WhiteBoardTools } from "./whiteboard-tools.js";
import { relURL } from "../../Utilities/usefull-funcs.js";
import { AccessEvent } from "../../Utilities/Buttons/access-buttons.js";
import { OccupiableWindow } from "../features-interface.js";
import { WhiteBoard } from "./WhiteBoard/whiteboard.js";
import { ContentDisplay } from "./content-display.js";
import { TimerWidget } from "./Widgets/timer.js";
import HINT_TEXT from "./hint-text.js";

const SPACE = 4;
const BORDER_RADIUS = 14;
const BORDER = 4;

class GL extends GridLayout {
    getBorderStyle() {
        return [BORDER_RADIUS, BORDER]
    }
}

/**
 * The widgets (e.g. the timer) shown beside the share tools. Only one widget
 * is displayed at a time. Each widget has a `state` getter / setter and
 * dispatches a "change" event when the user changes its state.
 *
 * Events:
 *   "change"  the user changed the displayed widget or a widget's state,
 *             read .state to get the new state. Not dispatched when .state
 *             is set (e.g. from the database), so syncing doesn't echo.
 */
class ShareWidgets extends GL {
    #currentWidget = null;
    constructor() {
        super(7, 8);
        this.class = "dynamic-options"
        this.widgets = {
            timer: new TimerWidget(),
        }

        for (const widgetName in this.widgets) {
            const widget = this.widgets[widgetName];
            // Relay change events from individual widgets to the ShareWidgets
            // component itself. Only the widget's own change events count:
            // change events from its inner elements (e.g. native <input>
            // change events) bubble up through it as well.
            widget.addEventListener("change", (e) => {
                e.stopPropagation();
                if (e.target === widget) this.#dispatchChange();
            });
        }
    }

    #dispatchChange() {
        this.dispatchEvent(new CustomEvent("change"));
    }

    /** Icons that open each widget, highlighted while their widget is shown.
     * @type {Object<string, GridIcon>} */
    #icons = {};

    /** Registers the icon that opens a widget so it is highlighted while the
     *  widget is shown.
     * @param {string} widgetName
     * @param {GridIcon} icon */
    setIcon(widgetName, icon) {
        this.#icons[widgetName] = icon;
        this.#highlightIcons();
    }

    #highlightIcons() {
        for (const [name, icon] of Object.entries(this.#icons)) {
            icon.highlight = name === this.#currentWidget;
        }
    }

    /** Shows the widget, or hides it if it is already shown (user action,
     *  dispatches "change").
     * @param {string} widgetName */
    toggleWidget(widgetName) {
        this.widget = widgetName === this.#currentWidget ? null : widgetName;
        this.#dispatchChange();
    }

    /** The name of the displayed widget, null for none.
     * @param {?string} widgetName */
    set widget(widgetName) {
        if (!(widgetName in this.widgets)) widgetName = null;
        if (widgetName === this.#currentWidget) return;

        if (this.#currentWidget !== null) {
            this.widgets[this.#currentWidget].remove();
        }
        this.#currentWidget = widgetName;
        this.#highlightIcons();
        if (widgetName !== null) {
            const t = this.widgets[widgetName];
            const [r, c] = t.size;
            const [, fc] = this.size;
            this.add(t, [0, r-1], [fc-c, fc-1])
        }
    }

    get widget() {
        return this.#currentWidget;
    }

    get state() {
        return {
            widget: this.#currentWidget,
            widgetStates: Object.fromEntries(Object.entries(this.widgets).map(([name, widget]) => [name, widget.state]))
        };
    }

    set state(state) {
        const {widget = null, widgetStates = null} = state || {};
        this.widget = widget;
        if (typeof widgetStates === "object" && widgetStates !== null) {
            for (const [name, widgetState] of Object.entries(widgetStates)) {
                if (name in this.widgets) {
                    this.widgets[name].state = widgetState;
                }
            }
        }
    }
}

class Hints extends GL {
    constructor() {
        super("div");
        this.class = "dynamic-options hints";
    }

    addHint(text, ...positionArgs) {
        const hint = new GridIcon({
            colorTheme: "dark",
            displayValue: text,
        })
        hint.styles = {
            opacity: 0,
            transition: "opacity 0.3s ease"
        }
        this.add(hint, ...positionArgs);
        setTimeout(() => {
            hint.styles.opacity = 1;
        }, 50);
    }
}

class ShareContentTools extends SvgPlus {
    /**
     * @param {WhiteBoard} whiteboard the whiteboard the tools control
     * @param {ContentDisplay} display the content display
     * @param {(name: string, e: Event) => void} dispatch dispatches a view event
     */
    constructor(whiteboard, display, dispatch) {
        super("div");
        this.class = "sc-tools";

        const wbt = new WhiteBoardTools(GL);
        this.shareWidgets = new ShareWidgets();
        wbt.connect(whiteboard);
        this.whiteboardTools = wbt;
        this.whiteboard = whiteboard;

        const staticTools = this.createChild(GL, {class: "static"}, 1, 2)

        this._annotating = false;
        const [_, modeIcon] = staticTools.addGridIcons([
            {
                symbol: "close",
                colorTheme: "action",
                events: {
                    "access-click": (e) => dispatch("close", e)
                }
            },
            {
                symbol: "pen",
                colorTheme: "action",
                type: "folder",
                events: {
                    "access-click": () => this.annotating = !this.annotating
                },
                props: {hint: HINT_TEXT.Annotate},
                styles: {
                    "--hint-cols": 2,
                }
            },
        ])
        this.modeIcon = modeIcon;

        const shareTools = this.createChild(GL, {class: "dynamic"}, 1, 8)
        const [screenIcon, fileIcon, timer, prevIcon, nextIcon] = shareTools.addGridIcons([
            {
                symbol: "screen",
                colorTheme: "action",
                events: {
                    "access-click": (e) => dispatch("screen", e)
                },
                props: {hint: HINT_TEXT.ShareScreen}
            },
            {
                symbol: "file",
                colorTheme: "action",
                events: {
                    "access-click": (e) => dispatch("file", e)
                },
                props: {hint: HINT_TEXT.ShareFile}
            },
            {
                symbol: "timer",
                colorTheme: "action",
                events: {
                    "access-click": (e) => this.shareWidgets.toggleWidget("timer")
                },
                props: {hint: HINT_TEXT.Timer}
            },
            {
                symbol: "leftArrow",
                colorTheme: "action",
                hidden: true,
                events: {
                    "access-click": () => display.page--
                },
            },
            {
                symbol: "rightArrow",
                colorTheme: "action",
                hidden: true,
                events: {
                    "access-click": () => display.page++
                }
            },
        ])
        this.shareTools = shareTools;
        this.shareWidgets.setIcon("timer", timer);
        this.pageIcons = [prevIcon, nextIcon];
        this.screenIcon = screenIcon;
        this.fileIcon = fileIcon;

        this.hints = this.createChild(Hints);

        this.display = display;
        display.addEventListener("pagestate", () => this.updatePageIcons());

        this.contentType = null;
        this.annotating = false;


    }

    /** Shows the page arrows only for a loaded pdf with more than one page,
     *  disabling the back arrow on the first page and the next arrow on the
     *  last page. */
    updatePageIcons() {
        const {display} = this;
        const total = display.displayType === "pdf" && display.pdfDoc ? display.totalPages : 0;
        const [prev, next] = this.pageIcons;
        // toggle the attribute directly: GridIcon's "hidden" setter is shadowed
        // by HTMLElement.hidden when SvgPlus extends the element
        for (const icon of this.pageIcons) icon.toggleAttribute("i-hidden", total <= 1);
        prev.disabled = display.page <= 1;
        next.disabled = display.page >= total;
    }

    /** The type of the shared content. The screen / file icons show a stop
     *  symbol while a screen / file is being shared.
     * @param {?string} type "pdf", "image", "stream" or null */
    set contentType(type) {
        this.updatePageIcons();

        const setIcon = (icon, on, onSymbol, offSymbol) => {
            icon.symbol = on ? onSymbol : offSymbol;
            icon.styles = {"--i-color-1": on ? "white" : null};
        }
        setIcon(this.screenIcon, type === "stream", "screen-pause", "screen");
        setIcon(this.fileIcon, type === "pdf" || type === "image", "file-close", "file");
    }

    /** True when the whiteboard tools are shown, false when the share tools
     *  are shown and the board uses the pan tool (dragging pans the content
     *  and its annotations). Zooming works in both modes. */
    set annotating(value) {
        value = !!value;
        const wbt = this.whiteboardTools;
        if (value) {
            this.shareTools.remove()
            this.appendChild(wbt.tools)
            this.appendChild(wbt.options)
            this.shareWidgets.remove()
            this.modeIcon.symbol = "share-doc"
            this.modeIcon.props = {hint: HINT_TEXT.BackToSharing}
            wbt.selectTool("pen")
        } else {
            // close menus and stop drawing
            wbt.openMenu(null)
            wbt.selectTool(null)
            wbt.options.remove()
            wbt.tools.remove()
            this.appendChild(this.shareTools)
            this.appendChild(this.shareWidgets)
            this.modeIcon.symbol = "pen";
            this.modeIcon.props = {hint: HINT_TEXT.Annotate};
        }
        this._annotating = value;
    }
    get annotating() {
        return this._annotating;
    }
}

/**
 * The share content window: shows the shared file / screen with a
 * whiteboard on top for annotating. The whiteboard is linked to the shared
 * content (see WhiteBoard.linkToElement), so the content behaves like the
 * board's background: panning and zooming the board moves both together.
 *
 * Events (dispatched on .root):
 *   "close", "screen", "clear", "file"  AccessEvents from the tool buttons
 *   "page"             the user changed the pdf page (see .page)
 *   "viewchange"       the user panned/zoomed, event.view (see .view)
 *   "areasize"         the content area was resized, event.size {x, y} (px)
 */
export class ShareContentView extends OccupiableWindow {
    /** @param {import("./share-content.js").default} [feature] */
    constructor(feature = null) {
        super("share-content-view");
        this.shareContent = feature;

        const contentArea = this.root.createChild("div", {class: "content-grid"})
                 .createChild("div", {class: "content-cell"})
                 .createChild("div", {class: "content-area"});

        /** @type {ContentDisplay} */
        this.display = contentArea.createChild(ContentDisplay);
        this.display.addEventListener("page", () => this.root.dispatchEvent(new Event("page")));

        /** @type {WhiteBoard} */
        this.whiteboard = contentArea.createChild(WhiteBoard);

        // the content acts as the board's background
        const link = () => this.whiteboard.linkToElement(this.display.activeElement);
        this.display.addEventListener("displaychange", link);
        link();
        this.whiteboard.addEventListener("viewchange", (e) => {
            const event = new Event("viewchange");
            event.view = e.detail.view;
            this.root.dispatchEvent(event);
        });

        // masks the parts of the content area the participant can not see
        contentArea.createChild("border-frame");

        // the loader sits above the whiteboard
        contentArea.appendChild(this.display.loader);

        // report the size of the content area (ignoring hidden / zero sizes)
        this.contentArea = contentArea;
        this.areaSize = null;
        new ResizeObserver((entries) => {
            const {width, height} = entries[0].contentRect;
            if (width > 1 && height > 1) {
                this.areaSize = {x: width, y: height};
                const event = new Event("areasize");
                event.size = this.areaSize;
                this.root.dispatchEvent(event);
            }
        }).observe(contentArea);

        const dispatch = (name, e) => this.root.dispatchEvent(new AccessEvent(name, e));
        this.tools = this.root.createChild(ShareContentTools, {}, this.whiteboard, this.display, dispatch);

        /** @type {ShareWidgets} */
        this.widgets = this.tools.shareWidgets;

        this.root.styles = {
            "--border-radius": BORDER_RADIUS + "px",
            "--grid-layout-gap": SPACE + "px",
            "--space": SPACE + "px",
        }
    }

    /* ~~~~~~~~~~~~~~~~~~ CONTENT ~~~~~~~~~~~~~~~~~~~~ */

    /** The upload / load progress overlay */
    get loader() { return this.display.loader; }

    /** The content frame */
    get content() { return this.display.content; }

    /** The pan / zoom of the content and annotations, {scale, x, y} with
     *  x, y relative to the size of the board so it can be shared between
     *  screens of different sizes.
     * @param {{scale: number, x: number, y: number}} view */
    set view(view) { this.whiteboard.view = view; }
    get view() { return this.whiteboard.view; }

    /** The aspect ratio (width / height) of the area every user can see,
     *  normally that of the participant's content area. The content is
     *  fitted into an area of this aspect ratio and anything outside of it
     *  is dimmed by the border frame.
     * @param {?number} aspect null fills the content area */
    set viewAspect(aspect) {
        if (!(aspect > 0) || !Number.isFinite(aspect)) aspect = null;
        this._viewAspect = aspect;
        this.contentArea.styles = {"--view-aspect": aspect};
    }
    get viewAspect() {
        return this._viewAspect ?? null;
    }

    /** @param {number} value 1 based pdf page */
    set page(value) { this.display.page = value; }
    get page() { return this.display.page; }

    /** @param {?MediaStream} stream @param {string} user */
    setStream(stream, user) {
        this.display.setStream(stream, user);
    }

    /** @param {?import("./content-display.js").ContentInfo} contentInfo */
    async updateContentInfo(contentInfo) {
        this.root.setAttribute("display-type", contentInfo?.type || "none");
        this.contentType = contentInfo?.type ?? null;
        this.tools.contentType = this.contentType;
        await this.display.updateContentInfo(contentInfo);
    }

    /* ~~~~~~~~~~~~~~~~~~ WINDOW ~~~~~~~~~~~~~~~~~~~~ */

    async open(){
        this.shareContent?.session.cursors.updateReferenceArea("fixedAspectArea");
        await this.show();
    }

    async close(){
        this.shareContent?.session.cursors.updateReferenceArea("entireScreen");
        this.shareContent?.endScreenShare();
        this.tools.annotating = false;
        await this.hide();
    }

    static get usedStyleSheets() {
        return [
            ...GridIcon.usedStyleSheets,
            relURL("./style.css", import.meta),
            relURL("../../Utilities/Icons/ICSS_Icons/icons.css", import.meta),
            relURL("./ICSS_Icons/icons.css", import.meta)
        ]
    }

    static get fixToolBarWhenOpen() {return true}
}
