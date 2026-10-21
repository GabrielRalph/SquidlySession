import { SvgPlus, Vector } from "../../../SvgPlus/4.js";

/**
 * Given the points of a polygon and a maximum corner radius, 
 * returns an svg d path string representing the rounded polygon.
 * @param {Array<{x: number, y: number}>} points - The vertices of the polygon.
 * @param {number} maxRadius - The maximum radius for the rounded corners.
 * @returns {string} An SVG path data string representing the rounded polygon.
 */
function roundedPolygon(points, maxRadius) {
    const n = points.length;
    if (n < 3) return '';

    const corners = [];
    for (let i = 0; i < n; i++) {
        const prev = points[(i - 1 + n) % n];
        const curr = points[i];
        const next = points[(i + 1) % n];

        const dx1 = prev.x - curr.x, dy1 = prev.y - curr.y;
        const len1 = Math.hypot(dx1, dy1);
        const dx2 = next.x - curr.x, dy2 = next.y - curr.y;
        const len2 = Math.hypot(dx2, dy2);

        const r = Math.min(maxRadius, len1 / 2, len2 / 2);
        // cross product sign determines which way the arc curves
        const sweep = (dx1 * dy2 - dy1 * dx2) < 0 ? 1 : 0;

        corners.push({
            before: { x: curr.x + (dx1 / len1) * r, y: curr.y + (dy1 / len1) * r },
            after:  { x: curr.x + (dx2 / len2) * r, y: curr.y + (dy2 / len2) * r },
            sweep, r,
        });
    }

    const d = [`M ${corners[0].before.x} ${corners[0].before.y}`];
    for (let i = 0; i < n; i++) {
        const { after, sweep, r } = corners[i];
        const nb = corners[(i + 1) % n].before;
        d.push(`A ${r} ${r} 0 0 ${sweep} ${after.x} ${after.y}`);
        d.push(`L ${nb.x} ${nb.y}`);
    }
    d.push('Z');
    return d.join(' ');
}

class Tab extends SvgPlus {
    constructor(tab) {
        super("div");
        this.class = "tab";
        if (tab.title instanceof Element) {
            this.appendChild(tab.title);
        } else {
            this.innerHTML = tab.title;
        }
    }
}

class RoundedTabs extends SvgPlus {
    #selected = 0;
    constructor(items) {
        super("rounded-tabs")

        this.svg =this.createChild("svg", {class: "tab-display"});
        const tabs = this.createChild("div", {class: "tabs-container"});
        const content = this.createChild("div", {class: "main-content"});

        let contentElements = {};
        this.key2index = {}
        this.items = items;
        this.tabs = Object.entries(items).map(([key, item], i) => {
            contentElements[i] = item.content;
            this.key2index[key] = i;
            return tabs.createChild(Tab, {events: {
                click: () => {
                    if (item.noSelect) return;
                    this.select(i)
                }
            }}, item)
        })
        this.contentElements = contentElements;
        this.contentEl = content;
        this.tabsEl = content;

        const resizeObserver = new ResizeObserver(this.onresize.bind(this));
        resizeObserver.observe(this);

        this.select(0);
    }

    select(index) {
        if (index in this.key2index) {
            index = this.key2index[index];
        }
        index = Math.max(0, Math.min(index, this.tabs.length - 1));

        const item = this.items[index];
        if (item?.key) {
            this.setAttribute("key", item.key);
        } else {
            this.removeAttribute("key");
        }
        this.#selected = index;
        this.contentEl.innerHTML = "";
        const nextElement = this.contentElements[this.#selected];
        nextElement.onConnected?.();
        this.contentEl.appendChild(nextElement);
        this.render();
    }


    getBorderRadius(fullSize, tabSize) {
        return Math.min(tabSize.x, tabSize.y) / 2;
    }

    render() {
        let selected = this.#selected;

        let [P, S] = this.bbox;
        let [TP, TS] = this.tabs[selected].bbox;
        let radius = this.getBorderRadius(S, TS);

        let TL = TP.sub(P);
        let BL = TL.add(0, TS.y);
        let TR = TL.add(TS.x, 0);
        let BR = BL.add(TS.x, 0);

        let O = new Vector(0);
        let V = (...args) => new Vector(...args);

        let points = [
            O.add(0, S.y),  // bottom left corner of box
            V(0, BL.y),     // top left corner of box
            BL,             // bottom left corner of tab
            TL,             // top left corner of tab
            TR,             // top right corner of tab
            BR,             // bottom right corner of tab
            V(S.x, BR.y),   // top right corner of box
            S               // bottom right corner
        ];
        let remove = new Array(points.length).fill(false)
        for (let i = 1; i < points.length; i++) {
            if (points[i].sub(points[i-1]).isZero) {
                remove[i] = true;
                remove[i-1] = true;
            }
        }
        points = points.filter((_, i) => !remove[i]);
       
        this.svg.props = {
            "viewBox": `0 0 ${S.x} ${S.y}`
        }

        this.svg.innerHTML = `
            <path d="${roundedPolygon(points, radius)}" />
        `;

    }


    onresize() {
        this.render();
    }


    static get usedStyleSheets() {
        return [
            import.meta.resolve("./rounded-tabs.css")
        ]
    }
}

export { RoundedTabs };