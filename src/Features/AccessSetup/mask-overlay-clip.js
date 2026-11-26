import { SvgPlus } from "../../SvgPlus/4.js";
import { Vector } from "../../SvgPlus/vector.js";
import { SvgResize } from "../../Utilities/svg-resize.js";
import { delay } from "../../Utilities/usefull-funcs.js";

/**
 *  This is an example module, here I extend the SvgResize class to create
 *  an overlay that masks out certain areas of the screen.
 *  You can use this as a starting point.
 */


/**
 * @typedef {Object} MaskArea
 * @property {Vector} pos - The position of the top-left corner of the area.
 * @property {Vector} size - The size (width and height) of the area.
 * @property {number} border - The border radius for rounded corners.
 */

/**
 * @typedef {(width: number, height: number) => MaskArea} MaskAreaFunction
 * A function that takes the current width and height and returns a MaskArea object.
 */

/**
 * An SVG overlay that masks out certain areas of the screen.
 * Areas to be masked out can be defined as functions or static objects.
 * @extends SvgResize
 * @see SvgResize
 */
export class MaskOverlay extends SvgPlus {
    constructor() {
        super("mask-overlay");
        // Define areas to cut out of the mask
        this._areas = [];

        this._resizeObserver = new ResizeObserver((e) => this.resize(e));
        this._resizeObserver.observe(this);
    }

    stop() {
        this._rendering = false;
    }

    async start() {
        if (this._rendering) return;
        this._rendering = true;
        while (this._rendering) {
            this.renderMask();
            await delay();
        }
    }


    resize(e) {
        const {width, height} = e[0].contentRect;
        this.W = width;
        this.H = height;
        if (!this._rendering) this.renderMask();
    }


    /**
     * Adds an area to cut out of the mask.
     * The area can be a static object or a function that returns an object.
     * @param {MaskArea|MaskAreaFunction} area - The area to cut out. If a function, it should return an object with pos, size, and border.
     */
    addArea(area) {
        if (area instanceof Function || typeof area === "object") {
            this._areas.push(area);
        }
        this.renderMask();
    }


    /**
     * Removes an area from the mask.
     * @param {MaskArea|MaskAreaFunction} area - The area to remove.
     */
    removeArea(area) {
        let index = this._areas.indexOf(area);
        if (index !== -1) {
            this._areas.splice(index, 1);
        }
        this.renderMask();
    }


    /**
     * Clears all areas from the mask.
     */
    clearAreas() {
        this._areas = [];
        this.renderMask();
    }


    /**
     * Gets the areas to cut out of the mask.
     * If any area is a function, it is called with the current width and height.
     * @returns {Array} The processed areas to cut out.
     */
    get areas() {
        const {W, H} = this;
        return this._areas.map(area => area instanceof Function ? area(W, H) : area);
    }

    /**
     * Sets the areas to cut out of the mask. Each area can be a static object or a function that returns an object.
     * @param {Array<MaskArea|MaskAreaFunction>} areas - The areas to cut out.
     *  
     */
    set areas(areas) {
        if (Array.isArray(areas)) {
            this._areas = areas.filter(area => area instanceof Function || typeof area === "object");
            this.renderMask();
        }
    }

    /**
     * Renders the mask by creating a path that covers the entire screen
     * and cuts out the defined areas.
     * @see https://developer.mozilla.org/en-US/docs/Web/SVG/Tutorial/Paths
     * @see https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/fill-rule
     */
    renderMask() {
        const {W, H, areas} = this;

        // Draw the full screen rectangle in the opposite direction to create a "hole"
        let d = "M0,0 v" + H + " h" + W + " v-" + H + " Z ";
        
        // Create paths for each area
        let paths = areas.map(
            ({pos, size, border}) => MaskOverlay.roundedRectPath(pos.x, pos.y, size.x, size.y, border)
        );
        
        // Combine paths
        const clipPath = d + paths.join(" ");

        this.styles = {
            "clip-path": `path('${clipPath}')`
        }
    }


    /**
     * Creates a rounded rectangle path string for SVG.
     * Path starts at the top-left corner and goes clockwise.
     * @param {number} x - The x-coordinate of the rectangle's top-left corner.
     * @param {number} y - The y-coordinate of the rectangle's top-left corner.
     * @param {number} w - The width of the rectangle.
     * @param {number} h - The height of the rectangle.
     * @param {number} r - The radius of the corners.
     * @returns {string} The SVG path data string for the rounded rectangle.
     * @see https://developer.mozilla.org/en-US/docs/Web/SVG/Tutorial/Paths
     */
    static roundedRectPath(x, y, w, h, r) {
        r = Math.max(0, Math.min(r, w / 2, h / 2));

        return [
        `M ${x + r} ${y}`,
        `H ${x + w - r}`,
        `A ${r} ${r} 0 0 1 ${x + w} ${y + r}`,
        `V ${y + h - r}`,
        `A ${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
        `H ${x + r}`,
        `A ${r} ${r} 0 0 1 ${x} ${y + h - r}`,
        `V ${y + r}`,
        `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
        `Z`
        ].join(" ");
    }
}
