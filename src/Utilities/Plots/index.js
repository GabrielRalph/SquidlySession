import { SvgPlus } from "../../SvgPlus/4.js";
import { Vector } from "../../SvgPlus/vector.js";
import { Axis, BBox, ClipPath, DataClass, Defs, Grid, Group, Line, LineStyles, Rect, Renderable, Text, Tick } from "./plot.js";

/**
 * Determines a "nice" tick interval for an axis given a guess.
 * Returns a power of 10 multiplied by 1, 2, 2.5 or 5 that is >= the provided tickGuess.
 */
function bestTickInterval(tickGuess) {
    let guessSign = Math.sign(tickGuess);
    tickGuess = Math.abs(tickGuess);
    const base = Math.pow(10, Math.floor(Math.log10(tickGuess)));
    const multiples = [1, 2, 2.5, 5];
    for (let m of multiples) {
        const interval = base * m;
        if (interval >= tickGuess) {
            return interval * guessSign;
        }
    }
    return base * 10 * guessSign;
}

/** Ordered list of "nice" time intervals in milliseconds used for tick snapping. */
const TIME_INTERVALS_MS = [
    1, 2, 5, 10, 50, 100, 250, 500,                          // ms
    1e3, 2e3, 5e3, 10e3, 15e3, 30e3,                         // seconds
    60e3, 2*60e3, 5*60e3, 10*60e3, 15*60e3, 30*60e3,         // minutes
    3600e3, 2*3600e3, 4*3600e3, 6*3600e3, 12*3600e3,          // hours
    86400e3, 2*86400e3, 7*86400e3,                            // days / weeks
    30*86400e3, 91*86400e3, 182*86400e3,                      // months (approx)
    365*86400e3, 2*365*86400e3, 5*365*86400e3, 10*365*86400e3,// years
];

/**
 * Like bestTickInterval but snaps to human-meaningful time durations.
 * @param {number} tickGuessMs - target interval size in milliseconds
 * @returns {number} interval in milliseconds
 */
function bestTimeInterval(tickGuessMs) {
    tickGuessMs = Math.abs(tickGuessMs);
    for (const interval of TIME_INTERVALS_MS) {
        if (interval >= tickGuessMs) return interval;
    }
    return TIME_INTERVALS_MS[TIME_INTERVALS_MS.length - 1];
}

/**
 * Formats a Unix-ms timestamp as a compact human-readable string,
 * choosing precision based on the current tick interval.
 * @param {number} ms - timestamp in milliseconds
 * @param {number} intervalMs - the active tick interval in milliseconds
 * @returns {string}
 */
function formatTimestamp(ms, intervalMs) {
    const d = new Date(ms);
    const pad = n => String(Math.floor(n)).padStart(2, "0");
    if (intervalMs < 1e3) {
        return `${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
    } else if (intervalMs < 60e3) {
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    } else if (intervalMs < 86400e3) {
        return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } else if (intervalMs < 365 * 86400e3) {
        const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        return `${M[d.getMonth()]} ${d.getDate()}`;
    } else {
        return String(d.getFullYear());
    }
}

class SeriesStyles extends LineStyles {

}

class Series extends Renderable {
    points = [];
    static points_parser(value) { return (value || []).map(p => new Vector(p)); }

    styles = SeriesStyles.make({});
    static styles_parser(value) { return SeriesStyles.make(value || {}); }

    name = "";
    yAxisIndex = 0;

    render() {
        return this.renderTransformed(this.points, null);
    }

    renderTransformed(points, clipPath) {
        const l1 = Line.make({ points, styles: { ...this.styles, clipPath } });

        let p0 = points[0];
        let pn = points[points.length - 1];
        p0.y = 0;
        pn.y = 0;
        points = [p0, ...points, pn];
        const l2 = Line.make({ points, styles: { stroke: "none", fill: this.styles.stroke, clipPath } });
        return `<g>${l1}</g>`;
    }
}


class VerticalLegend extends Renderable {
    series = [];
    static series_parser(value) {
        let series = [];
        if (Array.isArray(value)) {
            series = value.filter(s => s instanceof Series);
        }
        return series;
    }
    position = new Vector(0);
    static position_parser(value) { return value ? new Vector(value) : new Vector(0); }

    lineLength = 20;

    gap = 5;
    paddingX = 10;
    paddyingY = 6;

    anchor = "left-top";
    static anchor_parser(value) {return value in Text.anchorToPositionDelta ? value : "left-top";}

    validate() {
        let lastY = 0;

        let children = []
        for (let s of this.series) {
            let seriesSample = Series.make({styles: s.styles, points: [[0, lastY], [this.lineLength, lastY]]});
            let text = Text.make({content: s.name, position: [this.lineLength + this.gap, lastY], anchor: "left"});
            lastY += text.size.y + this.gap
            children.push(seriesSample);
            children.push(text);
        }

        let main = Group.make({children});
        let bbox = main.boundingBox.pad(this.paddingX, this.paddyingY);
        let rect = Rect.make({position: bbox.pos, width: bbox.size.x, height: bbox.size.y, borderRadius: 3, styles: {fill: "rgba(255,255,255,0.88)", stroke: "#ccc", strokeWidth: 0.5}});
        
        let delta = this.position.sub(bbox.pos);
        delta = delta.add(Text.anchorToPositionDelta[this.anchor].mul(bbox.size))

        this.delta = delta;
        this.main = main;
        this.rect = rect;
        this.width = bbox.size.x;
        this.height = bbox.size.y;  
        this.actualPosition = bbox.pos.add(delta);
    }

    get pos() {
        return this.actualPosition;
    }

    render() {
        return `<g class = "v-legend" transform="translate(${this.delta})">${this.rect}${this.main}</g>`
    }
}



/**
 * Encapsulates the per-Y-axis state and tick/transform logic for InteractivePlot.
 * Each instance tracks its own data bounds, initial transform, and rendering position.
 */
class PlotYAxis {
    /** @type {string} */ label;
    /** @type {"left"|"right"} */ side;

    // Initial (zoom=1, pan=0) transform derived from this axis's data
    iPosY = 0;
    iScaleY = -1; // negative because SVG y is flipped

    /**
     * @param {string} label - Axis label text
     * @param {"left"|"right"} side - Which side of the plot the axis appears on
     */
    constructor(label = "Y", side = "left") {
        this.label = label;
        this.side = side;
        this.tickFormatFunction = v => v.toFixed(2);
    }

    /**
     * Updates iPosY / iScaleY from all points assigned to this axis.
     * @param {Vector[]} points - All points (from all series) assigned to this axis
     * @param {number} pHeight - Plot height in SVG pixels
     * @param {number} tickGuessY - Target number of y-axis divisions
     */
    updateTransform(points, pHeight, tickGuessY) {
        if (points.length === 0) return;
        const db = BBox.fromPoints(points, true); // flipY=true for SVG
        const intervalY = bestTickInterval(db.size.y / tickGuessY);

        // dataBounds (flipY=true): pos.y = maxY (SVG top), size.y < 0 (goes toward minY)
        const dataEnd = db.pos.y + db.size.y;

        const tickStart = Math.floor(db.pos.y / intervalY) * intervalY;
        const tickEnd   = Math.ceil(dataEnd   / intervalY) * intervalY;

        this.iPosY   = tickStart;
        this.iScaleY = pHeight / (tickEnd - tickStart);
    }

    /**
     * Converts a data-space Y value to a plot-pixel Y value.
     * @param {number} dataY
     * @param {number} viewScaleY - combined iScaleY * viewScale
     * @param {number} viewOffsetY
     */
    toPixelY(dataY, viewScaleY, viewOffsetY) {
        return (dataY - this.iPosY) * viewScaleY - viewOffsetY;
    }

    /**
     * Returns the longest tick label string at the most-zoomed-out view.
     * @param {number} pHeight
     * @param {number} tickGuessY
     * @param {number} minScale
     * @returns {string}
     */
    longestTickLabel(pHeight, tickGuessY, minScale) {
        const effectiveScaleY = this.iScaleY * minScale;
        const visH = pHeight / Math.abs(effectiveScaleY);
        const intervalY = bestTickInterval(visH / tickGuessY);
        const format = v => v.toFixed(2);
        const longestOf = (...vals) => vals.map(format).reduce((a, b) => b.length > a.length ? b : a);
        const extremeBottom = Math.floor((this.iPosY - visH) / intervalY) * intervalY;
        const extremeTop    = Math.ceil((this.iPosY + Math.abs(this.iScaleY * pHeight / minScale) + visH) / intervalY) * intervalY;
        return longestOf(extremeBottom, extremeTop);
    }

    /**
     * Computes the visible y-tick values for the current view.
     * @param {number} viewDataOriginY - data-space Y at the top of the plot
     * @param {number} viewDataEndY - data-space Y at the bottom of the plot
     * @param {number} tickGuessY
     * @param {number} maxTicks
     * @returns {number[]}
     */
    computeTicks(viewDataOriginY, viewDataEndY, tickGuessY, maxTicks) {
        // viewDataOriginY > viewDataEndY (larger data Y maps to SVG top)
        // Use a negative interval so the loop steps downward through the visible range.
        const visibleDataH = viewDataOriginY - viewDataEndY; // positive
        const intervalY = -bestTickInterval(visibleDataH / tickGuessY); // negative
        const tickStart = Math.floor(viewDataOriginY / intervalY) * intervalY;
        const ticks = [];
        for (let t = tickStart; t >= viewDataEndY - Math.abs(intervalY); t += intervalY) {
            ticks.push(t);
            if (ticks.length > maxTicks) break;
        }
        return ticks;
    }

    /**
     * Builds and returns the SVG Axis element for this Y axis.
     * @param {number} pHeight
     * @param {number} pWidth
     * @param {number} tickLength
     * @param {number} viewDataOriginY
     * @param {number} viewDataEndY
     * @param {number[]} ticks
     */
    buildAxis(pHeight, pWidth, tickLength, viewDataOriginY, viewDataEndY, ticks) {
        const xPos = this.side === "right" ? pWidth : 0;
        return Axis.make({
            position: [xPos, 0],
            axisLength: pHeight,
            tickLength,
            portrait: true,
            minValue: viewDataOriginY,
            maxValue: viewDataEndY,
            ticks,
            flipTickSide: this.side === "right",
            tickLineStyles: { stroke: "gray", strokeWidth: 1 },
            tickFormatFunction: this.tickFormatFunction,
        });
    }
}


export class InteractivePlot extends SvgPlus {
    static MAX_SCALE = 20;
    static MIN_SCALE = 0.25;
    static MAX_TICKS_PER_AXIS = 50;
    static SNAP_THRESHOLD = 0.1; // fraction of a tick interval within which snapping fires


    // Series: [{ points: Vector[], styles: {}, yAxisIndex: number }]
    #series = [];

    // Y axes (index 0 = primary left axis)
    #yAxes = [new PlotYAxis("Y", "left")];

    // Plot area size in SVG pixels
    #pSize = new Vector(400, 400);

    // Target number of grid divisions per axis
    #ticks = new Vector(10, 10);

    // Tick mark length in SVG pixels
    #tickLength = 5;

    // X axis label
    #xLabel = "X";

    // When true, X values are treated as Unix-ms timestamps
    #xIsTime = false;

    // View state (shared X transform + per-axis Y through PlotYAxis)
    #viewOffset = new Vector(0, 0);
    #viewScale = 1;
    #viewScaleX = 1; // additional X-only stretch (Cmd/Ctrl + wheel)

    // Initial X transform derived from all data (zoom=1, pan=0)
    #iPosX = 0;
    #iScaleX = 1;

    // SVG structural elements
    #regionClipPath = null;
    #staticGroup = null;
    #dynamicGroup = null;
    #legendGroup = null;

    // Full SVG viewBox, includes tick labels and axis titles
    #bbox = null;

    // RAF dirty flag and drag tracking
    #change = false;
    #pointerDown = false;

    /**
     * @param {string | HTMLElement} container - A CSS selector or DOM element to append the SVG into.
     */
    constructor(container) {
        super("svg");
        if (typeof container === "string") {
            container = document.querySelector(container);
        }
        if (container) container.appendChild(this);
        this.#build();
        this.#attachListeners();
        this.#startLoop();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /** Replace all series with a single dataset on the primary Y axis and reset the view. */
    set data(points) {
        this.#series = [Series.make({ points, styles: {}, yAxisIndex: 0, name: "" })];
        this.#resetView();
    }

    /**
     * Add a data series.
     * @param {Vector[]} points
     * @param {Object} styles - merged into the line's LineStyles
     * @param {number} yAxisIndex - which Y axis to use (0 = primary left). Auto-creates axes as needed.
     * @param {string} name - label shown in the legend (defaults to "Series N")
     */
    addSeries(points, styles = {}, yAxisIndex = 0, name = "") {
        // Auto-create Y axis entries up to the requested index
        while (this.#yAxes.length <= yAxisIndex) {
            const side = this.#yAxes.length % 2 === 0 ? "left" : "right";
            this.#yAxes.push(new PlotYAxis("Y", side));
        }
        this.#series.push(Series.make({ points, styles, yAxisIndex, name }));
        this.#resetView();
    }

    /** Clear all series and reset the view. */
    clearSeries() {
        this.#series = [];
        this.#yAxes = [new PlotYAxis("Y", "left")];
        this.#viewOffset = new Vector(0, 0);
        this.#viewScale = 1;
        this.#viewScaleX = 1;
        this.#change = true;
    }

    resetView() {
        this.#viewOffset = new Vector(0, 0);
        this.#viewScale = 1;
        this.#viewScaleX = 1;
        this.#change = true;
    }

    /** Update the plot area size (Vector or [width, height]). */
    set size(v) {
        this.#pSize = new Vector(v);
        this.#resetView(); // recomputes transforms for new size, then rebuilds structure
    }
    get size() { return this.#pSize; }

    set xLabel(label) {
        this.#xLabel = String(label);
        if (this.#series.length > 0) this.#build();
        this.#change = true;
    }
    get xLabel() { return this.#xLabel; }

    /**
     * When set to true, X values are interpreted as Unix millisecond timestamps.
     * Tick intervals snap to human-meaningful durations (seconds, minutes, hours, …)
     * and labels are formatted as times/dates.
     * @param {boolean} v
     */
    set xTime(v) {
        this.#xIsTime = Boolean(v);
        if (this.#series.length > 0) this.#build();
        this.#change = true;
    }
    get xTime() { return this.#xIsTime; }

    /**
     * Sets the label for a Y axis.
     * @param {string} label
     * @param {number} axisIndex - which Y axis (default 0)
     */
    setYLabel(label, axisIndex = 0) {
        if (axisIndex < this.#yAxes.length) {
            this.#yAxes[axisIndex].label = String(label);
            if (this.#series.length > 0) this.#build();
            this.#change = true;
        }
    }

    /**
     * Sets the side ("left" or "right") for a Y axis.
     * @param {"left"|"right"} side
     * @param {number} axisIndex
     */
    setYAxisSide(side, axisIndex = 0) {
        if (axisIndex < this.#yAxes.length) {
            this.#yAxes[axisIndex].side = side;
            if (this.#series.length > 0) this.#build();
            this.#change = true;
        }
    }

    /**
     * Sets the tick format function for a Y axis.
     * @param {function(number): string} fn - receives the tick value, returns a label string
     * @param {number} axisIndex - which Y axis (default 0)
     */
    setYFormat(fn, axisIndex = 0) {
        if (axisIndex < this.#yAxes.length && fn instanceof Function) {
            this.#yAxes[axisIndex].tickFormatFunction = fn;
            this.#change = true;
        }
    }

    // Keep a yLabel setter for backward compatibility (sets axis 0)
    set yLabel(label) { this.setYLabel(label, 0); }
    get yLabel() { return this.#yAxes[0]?.label ?? "Y"; }

    // ── Private ───────────────────────────────────────────────────────────────

    /** Returns the best X tick interval for a given visible data width. */
    #bestXInterval(visibleDataW) {
        const guess = visibleDataW / this.#ticks.x;
        return this.#xIsTime ? bestTimeInterval(guess) : bestTickInterval(guess);
    }

    /** Formats an X axis tick value given the current interval. */
    #formatX(v, interval) {
        return this.#xIsTime ? formatTimestamp(v, interval) : v.toFixed(2);
    }

    /**
     * Returns the longest formatted tick label string for each axis at max zoom-out.
     * Falls back to a conservative estimate when no data is loaded.
     * @returns {{ x: string, yAxes: string[] }}
     */
    #longestTickLabels() {
        if (this.#series.length === 0) {
            return { x: this.#xIsTime ? "00:00:00" : "-100.00", yAxes: this.#yAxes.map(() => "-100.00") };
        }

        const minScaleX = InteractivePlot.MIN_SCALE;
        const effectiveScaleX = this.#iScaleX * minScaleX;
        const visW = this.#pSize.x / effectiveScaleX;
        const intervalX = this.#bestXInterval(visW);

        const yLabels = this.#yAxes.map((yAxis) =>
            yAxis.longestTickLabel(this.#pSize.y, this.#ticks.y, InteractivePlot.MIN_SCALE)
        );

        let xSample;
        if (this.#xIsTime) {
            if (intervalX < 1e3)              xSample = "00.000";
            else if (intervalX < 60e3)        xSample = "00:00:00";
            else if (intervalX < 86400e3)     xSample = "00:00";
            else if (intervalX < 365*86400e3) xSample = "Sep 30";
            else                              xSample = "2024";
        } else {
            const allPoints = this.#series.flatMap(s => s.points);
            const db = BBox.fromPoints(allPoints, false);
            const extremeLeftX  = Math.floor((db.pos.x - visW) / intervalX) * intervalX;
            const extremeRightX = Math.ceil((db.pos.x + db.size.x + visW) / intervalX) * intervalX;
            xSample = [extremeLeftX, extremeRightX].map(v => v.toFixed(2)).reduce((a, b) => b.length > a.length ? b : a);
        }

        return { x: xSample, yAxes: yLabels };
    }

    /**
     * Rebuilds the fixed SVG structure: clip-path defs, axis labels, plot border.
     * Called on construction and whenever size, labels, or data bounds change.
     */
    #build() {
        const { x: pWidth, y: pHeight } = this.#pSize;
        const tickLength = this.#tickLength;

        this.#regionClipPath = ClipPath.make({
            children: [Rect.make({ position: [0, 0], width: pWidth, height: pHeight })]
        });
        const defs = Defs.make({ children: [this.#regionClipPath] }).render();

        const longestLabels = this.#longestTickLabels();

        // Sample tick for x margin (ticks point downward = 3π/2)
        const maxPXTick = Tick.make({
            position: [0, 0],
            content: longestLabels.x,
            tickLength,
            tickDirection: 3 * Math.PI / 2,
        });

        // Sample ticks for each Y axis to compute margins
        const yTickSamples = longestLabels.yAxes.map((label, i) => {
            const side = this.#yAxes[i].side;
            return Tick.make({
                position: [0, 0],
                content: label,
                tickLength,
                tickDirection: side === "right" ? 0 : Math.PI, // right=east, left=west
            });
        });

        // Left margin: driven by the leftmost (left-side) Y axis tick
        const leftTick = yTickSamples.find((_, i) => this.#yAxes[i].side === "left");
        const bPos = leftTick ? leftTick.pos : new Vector(0, 0);

        // Right margin: driven by the rightmost (right-side) Y axis tick
        const rightTicks = yTickSamples.filter((_, i) => this.#yAxes[i].side === "right");
        const rightExtra = rightTicks.reduce((acc, t) => Math.max(acc, t.size.x), 0);

        const bSize = new Vector(
            pWidth + (maxPXTick.pos.x + maxPXTick.size.x) + rightExtra,
            pHeight + maxPXTick.pos.y + maxPXTick.size.y
        ).sub(bPos);
        let bbox = new BBox(bPos, bSize);

        // X axis label (centered below the plot)
        const xAxisLabel = Text.make({
            content: this.#xLabel,
            position: [pWidth / 2, bbox.bottom + tickLength * 2],
            styles: { fontSize: 12, class: "axis-label" },
            anchor: "center-top",
        });

        // Y axis labels — one per axis
        const yAxisLabelElements = this.#yAxes.map((yAxis, i) => {
            const leftTick2 = yTickSamples[i];
            const xPos = yAxis.side === "right"
                ? pWidth + leftTick2.size.x + tickLength * 2
                : bbox.left - tickLength * 2;
            return Text.make({
                content: yAxis.label,
                position: [xPos, pHeight / 2],
                styles: { fontSize: 12, class: "axis-label" },
                anchor: "center-bottom",
                rotation: yAxis.side === "right" ? 90 : -90,
            });
        });

        const plotBox = Rect.make({ 
            position: [0, 0], 
            width: pWidth, 
            height: pHeight,
            styles: { class: "background-rect", stroke: "gray", strokeWidth: 1, fill: "white"},
        });

        this.#bbox = yAxisLabelElements.reduce(
            (b, el) => b.union(el.boundingBox),
            bbox.union(xAxisLabel.boundingBox)
        );
        this.setAttribute("viewBox", this.#bbox);

        if (this.#staticGroup) this.#staticGroup.remove();
        this.#staticGroup = this.createChild("g", {
            content: defs + xAxisLabel + yAxisLabelElements.join("") + plotBox
        });

        if (this.#dynamicGroup) this.#dynamicGroup.remove();
        this.#dynamicGroup = this.createChild("g");

        // Legend: float over the plot in the top-right corner when there are multiple series
        if (this.#legendGroup) this.#legendGroup.remove();
        const namedSeries = this.#series.filter(s => s.name);
        if (namedSeries.length > 1) {
            const legend = VerticalLegend.make({
                series: this.#series,
                position: [pWidth - 8, 8],
                anchor: "right-top",
            });
            this.#legendGroup = this.createChild("g", { content: legend.render() });
        } else {
            this.#legendGroup = null;
        }
    }

    /** Recalculate the initial transform from all series data and reset pan/zoom. */
    #resetView() {
        this.#updateInitialView();
        this.#build();
        this.#viewOffset = new Vector(0, 0);
        this.#viewScale = 1;
        this.#viewScaleX = 1;
        this.#change = true;
    }

    /**
     * Derives #iPosX / #iScaleX from all series' X data, and updates each
     * PlotYAxis transform from only the series assigned to that axis.
     */
    #updateInitialView() {
        if (this.#series.length === 0) return;
        const { x: pWidth, y: pHeight } = this.#pSize;

        // ── X (shared across all series) ──────────────────────────────────────
        const allPoints = this.#series.flatMap(s => s.points);
        const dbX = BBox.fromPoints(allPoints, false);
        const intervalX = this.#bestXInterval(dbX.size.x);
        const tickStartX = Math.floor(dbX.pos.x / intervalX) * intervalX;
        const tickEndX   = Math.ceil((dbX.pos.x + dbX.size.x) / intervalX) * intervalX;
        this.#iPosX  = tickStartX;
        this.#iScaleX = pWidth / (tickEndX - tickStartX);

        // ── Y (per-axis) ──────────────────────────────────────────────────────
        this.#yAxes.forEach((yAxis, i) => {
            const seriesPoints = this.#series
                .filter(s => s.yAxisIndex === i)
                .flatMap(s => s.points);
            if (seriesPoints.length > 0) {
                yAxis.updateTransform(seriesPoints, pHeight, this.#ticks.y);
            }
        });
    }

    /**
     * Clamps a proposed viewOffset so that at least one point from all series
     * remains visible inside the plot area.
     * @param {Vector} offset - the proposed new viewOffset
     * @returns {Vector} the clamped offset
     */
    #clampOffset(offset) {
        if (this.#series.length === 0) return offset;

        const effectiveScaleX = this.#iScaleX * this.#viewScale * this.#viewScaleX;
        const { x: pWidth, y: pHeight } = this.#pSize;

        // ── Clamp X (shared) ─────────────────────────────────────────────────
        const allPoints = this.#series.flatMap(s => s.points);
        const db = BBox.fromPoints(allPoints, false);
        const dataMinX = db.pos.x;
        const dataMaxX = db.pos.x + db.size.x;

        const pxMinX = (dataMinX - this.#iPosX) * effectiveScaleX - offset.x;
        const pxMaxX = (dataMaxX - this.#iPosX) * effectiveScaleX - offset.x;

        let ox = offset.x;
        if (pxMinX >= pWidth) {
            ox = (dataMinX - this.#iPosX) * effectiveScaleX - (pWidth - 1);
        } else if (pxMaxX <= 0) {
            ox = (dataMaxX - this.#iPosX) * effectiveScaleX - 1;
        }

        // ── Clamp Y: use union of all Y axes' data bounds ─────────────────────
        // Use the primary (index 0) axis for Y clamping (most data lives there)
        const primaryAxis = this.#yAxes[0];
        const primaryPoints = this.#series
            .filter(s => s.yAxisIndex === 0)
            .flatMap(s => s.points);

        let oy = offset.y;
        if (primaryPoints.length > 0) {
            const dbY = BBox.fromPoints(primaryPoints, false);
            const dataMinY = dbY.pos.y;
            const dataMaxY = dbY.pos.y + dbY.size.y;
            const effectiveScaleY = primaryAxis.iScaleY * this.#viewScale;

            const pxMinY = (dataMaxY - primaryAxis.iPosY) * effectiveScaleY - offset.y;
            const pxMaxY = (dataMinY - primaryAxis.iPosY) * effectiveScaleY - offset.y;

            if (pxMinY >= pHeight) {
                oy = (dataMaxY - primaryAxis.iPosY) * effectiveScaleY - (pHeight - 1);
            } else if (pxMaxY <= 0) {
                oy = (dataMinY - primaryAxis.iPosY) * effectiveScaleY - 1;
            }
        }

        return new Vector(ox, oy);
    }

    /** Renders the dynamic layer (data lines, axes, grid) into the SVG. */
    #render() {
        if (this.#series.length === 0 || !this.#dynamicGroup) return;

        const { x: pWidth, y: pHeight } = this.#pSize;
        const effectiveScaleX = this.#iScaleX * this.#viewScale * this.#viewScaleX;

        // Visible X data window
        const viewDataOriginX = this.#iPosX + this.#viewOffset.x / effectiveScaleX;
        const viewDataEndX    = viewDataOriginX + pWidth / effectiveScaleX;

        const visibleDataW = pWidth / effectiveScaleX;
        const intervalX = this.#bestXInterval(visibleDataW);
        const tickStartX = Math.ceil(viewDataOriginX / intervalX) * intervalX;
        const MAX = InteractivePlot.MAX_TICKS_PER_AXIS;

        const xTicks = [];
        for (let t = tickStartX; t <= viewDataEndX + Math.abs(intervalX); t += intervalX) {
            xTicks.push(t);
            if (xTicks.length > MAX) break;
        }

        // Per-axis Y: compute visible window + ticks, using primary axis Y offset
        const primaryAxis = this.#yAxes[0];
        const effectiveScaleY0 = primaryAxis.iScaleY * this.#viewScale;
        const viewDataOriginY0 = primaryAxis.iPosY + this.#viewOffset.y / effectiveScaleY0;
        const viewDataEndY0    = viewDataOriginY0 + pHeight / effectiveScaleY0;

        // Build per-axis view windows (secondary axes share the same viewScale + viewOffset.y
        // but have independent iPosY / iScaleY)
        const axisViewData = this.#yAxes.map(yAxis => {
            const effScaleY = yAxis.iScaleY * this.#viewScale;
            // Keep the same fractional offset as primary
            const originY = yAxis.iPosY + this.#viewOffset.y / effScaleY;
            const endY    = originY + pHeight / effScaleY;
            return { originY, endY, effScaleY };
        });

        // Data lines (each series uses its assigned Y axis)
        const lines = this.#series.map((series) => {
            const { points, yAxisIndex } = series;
            const yAxis = this.#yAxes[yAxisIndex] ?? primaryAxis;
            const effScaleY = yAxis.iScaleY * this.#viewScale;
            const transformed = points.map(p => new Vector(
                (p.x - this.#iPosX) * effectiveScaleX - this.#viewOffset.x,
                (p.y - yAxis.iPosY) * effScaleY - this.#viewOffset.y,
            ));
            return series.renderTransformed(transformed, this.#regionClipPath);
        });

        // X axis (bottom)
        const xaxis = Axis.make({
            position: [0, pHeight],
            axisLength: pWidth,
            tickLength: this.#tickLength,
            portrait: false,
            minValue: viewDataOriginX,
            maxValue: viewDataEndX,
            ticks: xTicks,
            flipTickSide: true,
            tickLineStyles: { stroke: "gray", strokeWidth: 1 },
            tickFormatFunction: v => this.#formatX(v, intervalX),
        });

        // Y axes (one per PlotYAxis)
        const yaxes = this.#yAxes.map((yAxis, i) => {
            const { originY, endY } = axisViewData[i];
            const effScaleY = yAxis.iScaleY * this.#viewScale;
            const visH = pHeight / Math.abs(effScaleY);
            const ticks = yAxis.computeTicks(originY, endY, this.#ticks.y, MAX);
            return yAxis.buildAxis(pHeight, pWidth, this.#tickLength, originY, endY, ticks);
        });

        // // Grid from primary Y axis ticks + X ticks
        // const { originY: gridOriginY, endY: gridEndY, effScaleY: gridScaleY } = axisViewData[0];
        // const primaryTicks = primaryAxis.computeTicks(gridOriginY, gridEndY, this.#ticks.y, MAX);
        // const primaryYAxis = primaryAxis.buildAxis(pHeight, pWidth, this.#tickLength, gridOriginY, gridEndY, primaryTicks);

        const grids = [Grid.make({
            xPositions: xaxis.tickPositions,
            yPositions: yaxes[0].tickPositions,
            position: [0, 0],
            width: pWidth,
            height: pHeight,
            lineStyles: { strokeWidth: 0.5, stroke: "#0003" }
        })];

        for (let i = 1; i < yaxes.length; i++) {
            grids.push(Grid.make({
                xPositions: [],
                yPositions: yaxes[i].tickPositions,
                position: [0, 0],
                width: pWidth,
                height: pHeight,
                lineStyles: { strokeWidth: 0.5, stroke: "#0003" }
            }));
        }


        // Zero lines
        const zeroLineStyles = { class: "zero-line", strokeWidth: 1, stroke: "#0006", clipPath: this.#regionClipPath };
        const zeroChildren = [];

        const xZero = (0 - this.#iPosX) * effectiveScaleX - this.#viewOffset.x;
        if (xZero >= 0 && xZero <= pWidth) {
            zeroChildren.push(Line.make({
                points: [[xZero, 0], [xZero, pHeight]],
                styles: zeroLineStyles,
            }));
        }

        const yZero = (0 - primaryAxis.iPosY) * effectiveScaleY0 - this.#viewOffset.y;
        if (yZero >= 0 && yZero <= pHeight) {
            zeroChildren.push(Line.make({
                points: [[0, yZero], [pWidth, yZero]],
                styles: zeroLineStyles,
            }));
        }

        this.#dynamicGroup.innerHTML = [...lines, ...grids, ...zeroChildren, xaxis, ...yaxes].join("");
    }

    #startLoop() {
        const tick = () => {
            if (this.#change) {
                this.#render();
                this.#change = false;
            }
            window.requestAnimationFrame(tick);
        };
        window.requestAnimationFrame(tick);
    }

    /**
     * Snaps the pan offset so the left/bottom edge of the visible window
     * lands on the nearest tick boundary, but only if within SNAP_THRESHOLD.
     */
    #snapPan() {
        const effectiveScaleX = this.#iScaleX * this.#viewScale * this.#viewScaleX;
        const primaryAxis = this.#yAxes[0];
        const effectiveScaleY = primaryAxis.iScaleY * this.#viewScale;

        const visW = this.#pSize.x / effectiveScaleX;
        const visH = this.#pSize.y / Math.abs(effectiveScaleY);
        const intervalX = this.#bestXInterval(visW);
        const intervalY = bestTickInterval(visH / this.#ticks.y); // negative

        const viewDataOriginX = this.#iPosX + this.#viewOffset.x / effectiveScaleX;
        const viewDataOriginY = primaryAxis.iPosY + this.#viewOffset.y / effectiveScaleY;

        const threshold = InteractivePlot.SNAP_THRESHOLD;

        // X: snap the LEFT edge
        const absIX = Math.abs(intervalX);
        const remX = ((viewDataOriginX % absIX) + absIX) % absIX;
        const deltaX = remX <= absIX * 0.5 ? remX : remX - absIX;
        const snappedX = Math.abs(deltaX) <= absIX * threshold
            ? viewDataOriginX - deltaX
            : viewDataOriginX;

        // Y: snap the BOTTOM edge
        const viewDataEndY = viewDataOriginY + this.#pSize.y / effectiveScaleY;
        const absIY = Math.abs(intervalY);
        const remY = ((viewDataEndY % absIY) + absIY) % absIY;
        const deltaY = remY <= absIY * 0.5 ? remY : remY - absIY;
        const snappedY = Math.abs(deltaY) <= absIY * threshold
            ? viewDataOriginY - deltaY
            : viewDataOriginY;

        this.#viewOffset = this.#clampOffset(new Vector(
            (snappedX - this.#iPosX) * effectiveScaleX,
            (snappedY - primaryAxis.iPosY) * effectiveScaleY,
        ));
        this.#change = true;
    }

    /**
     * Snaps the zoom scale so the visible data range is an integer multiple of
     * the current tick interval on the x-axis. Preserves the data coordinate
     * at the plot centre.
     */
    #snapScale() {
        // Snap the uniform viewScale based on effective X scale (includes X-stretch)
        const effectiveScaleX = this.#iScaleX * this.#viewScale * this.#viewScaleX;
        const visW = this.#pSize.x / effectiveScaleX;
        const intervalX = this.#bestXInterval(visW);
        const currentTickCount = visW / intervalX;
        const snappedTickCount = Math.max(1, Math.round(currentTickCount));

        const fractional = Math.abs(currentTickCount - snappedTickCount);
        if (fractional > InteractivePlot.SNAP_THRESHOLD) return;

        const newVisW = snappedTickCount * intervalX;
        const newEffectiveScaleX = this.#pSize.x / newVisW;
        // Snap by adjusting viewScale (uniform), keep viewScaleX (X-stretch) intact
        const newViewScale = Math.max(
            InteractivePlot.MIN_SCALE,
            Math.min(InteractivePlot.MAX_SCALE, newEffectiveScaleX / (this.#iScaleX * this.#viewScaleX))
        );

        // Preserve the data coordinate at the plot centre
        const oldEffectiveScaleX = this.#iScaleX * this.#viewScale * this.#viewScaleX;
        const centrePlotPx = this.#pSize.mul(0.5);
        const centreDataX = this.#iPosX + (this.#viewOffset.x + centrePlotPx.x) / oldEffectiveScaleX;
        const primaryAxis = this.#yAxes[0];
        const oldEffectiveScaleY = primaryAxis.iScaleY * this.#viewScale;
        const centreDataY = primaryAxis.iPosY + (this.#viewOffset.y + centrePlotPx.y) / oldEffectiveScaleY;

        this.#viewScale = newViewScale;

        const newEffX = this.#iScaleX * newViewScale * this.#viewScaleX;
        const newEffY = primaryAxis.iScaleY * newViewScale;
        this.#viewOffset = this.#clampOffset(new Vector(
            (centreDataX - this.#iPosX) * newEffX - centrePlotPx.x,
            (centreDataY - primaryAxis.iPosY) * newEffY - centrePlotPx.y,
        ));
        this.#change = true;
    }

    #attachListeners() {
        // Track whether the drag started on this plot
        this.addEventListener("mousedown", () => { this.#pointerDown = true; });
        window.addEventListener("mouseup", () => {
            if (this.#pointerDown) this.#snapPan();
            this.#pointerDown = false;
        });

        // Double-click resets pan and zoom to the initial view
        this.addEventListener("dblclick", this.resetView.bind(this));

        // Pan: drag shifts the view offset
        window.addEventListener("mousemove", e => {
            if (!this.#pointerDown || !this.#bbox) return;
            const svgScale = this.#bbox.size.div(this.clientWidth, this.clientHeight);
            const proposed = this.#viewOffset.sub(
                new Vector(e.movementX, e.movementY).mul(svgScale)
            );
            this.#viewOffset = this.#clampOffset(proposed);
            this.#change = true;
        });

        // Zoom: wheel zooms toward the pointer position in data space,
        // then snaps scale + pan once the wheel gesture ends.
        // Holding Cmd (Mac) or Ctrl zooms only the X axis (stretches horizontally).
        let wheelSnapTimer = null;
        let lastWheelWasXOnly = false;
        this.addEventListener("wheel", e => {
            e.preventDefault();
            if (!this.#bbox) return;

            const zoomFactor = Math.pow(1.1, -e.deltaY / 100);

            // Convert pointer position to SVG viewBox space (needed for both modes)
            const rect = this.getBoundingClientRect();
            const svgScale = this.#bbox.size.div(this.clientWidth, this.clientHeight);
            const mouseInPlot = new Vector(
                this.#bbox.pos.x + (e.clientX - rect.left) * svgScale.x,
                this.#bbox.pos.y + (e.clientY - rect.top) * svgScale.y
            );

            if (e.metaKey || e.ctrlKey) {
                // ── X-only zoom (stretch) ────────────────────────────────────
                lastWheelWasXOnly = true;
                const combinedX = this.#viewScale * this.#viewScaleX;
                const newCombinedX = Math.max(
                    InteractivePlot.MIN_SCALE,
                    Math.min(InteractivePlot.MAX_SCALE, combinedX * zoomFactor)
                );
                const ratioX = newCombinedX / combinedX;
                // Keep the data point under the pointer's X fixed; Y is unaffected
                const proposed = new Vector(
                    mouseInPlot.x * (ratioX - 1) + this.#viewOffset.x * ratioX,
                    this.#viewOffset.y
                );
                this.#viewScaleX = newCombinedX / this.#viewScale;
                this.#viewOffset = this.#clampOffset(proposed);
            } else {
                // ── Uniform zoom (X + Y) ─────────────────────────────────────
                lastWheelWasXOnly = false;
                const newScale = Math.max(
                    InteractivePlot.MIN_SCALE,
                    Math.min(InteractivePlot.MAX_SCALE, this.#viewScale * zoomFactor)
                );
                const ratio = newScale / this.#viewScale;
                // Keep the data point under the pointer fixed on both axes
                const proposed = mouseInPlot.mul(ratio - 1).add(this.#viewOffset.mul(ratio));
                this.#viewScale = newScale;
                this.#viewOffset = this.#clampOffset(proposed);
            }

            this.#change = true;

            // Snap scale (uniform-zoom only) then pan once the wheel gesture has settled
            clearTimeout(wheelSnapTimer);
            wheelSnapTimer = setTimeout(() => {
                if (!lastWheelWasXOnly) this.#snapScale();
                this.#snapPan();
            }, 150);
        }, { passive: false });
    }
}

// ── Example usage ─────────────────────────────────────────────────────────────

const plot = new InteractivePlot("#contanier");
plot.size = [550, 400];
plot.xTime = true;
plot.xLabel = "Time";


let y = [[1772453462184,2],[1772454272451,11],[1773395208266,6],[1773805033488,129],[1777530926694,1],[1777617714382,1],[1778745168222,184],[1779086653916,210],[1779327851916,689],[1779689185712,0],[1779763703732,129.76003333333333],[1779781803270,291.7981833333333],[1779843689796,218.29248333333334],[1779946426511,181.67605],[1780365667534,119.72985],[1780442049299,291.8000666666667],[1780459681757,8.356633333333333],[1780466008703,183.41766666666666],[1780557197971,6.259516666666666],[1780557923331,1.7101],[1780560207671,4.628566666666667],[1780978166234,4.776133333333333]];
// let now = Date.now();
// const timeOfDay = 1000 * 60 * 60 * 24; // ms in a day
// let y1 = new Array(20).fill(0).map((_, i) => new Vector(
//     timeOfDay * 31 * i / 19 ,
//     0.1*Math.random() + i / 22 
// ));
// let y2 = new Array(20).fill(0).map((_, i) => new Vector(
//     timeOfDay * 31 * i / 19 ,
//     1 - (0.1*Math.random() + i / 22) 
// ));

// Series on primary (left) Y axis
plot.addSeries(
    y,
    { stroke: "#009cff", strokeWidth: 2 },
    0,
    "Participant Interactions"
);

// // Series on secondary (right) Y axis — different scale
// plot.addSeries(
//     y2,
//     { stroke: "#ff7d00", strokeWidth: 2 },
//     0,
//     "Host Interactions"
// );

/**
 * @param {number} minutes - The duration in minutes to format.
 */
export function formatMinutes(minutes) {
  let res = ""
  if (typeof minutes === "boolean") {
    res = minutes ? "On" : "Off";
  } else if (minutes < 1) {
    res =  `${Math.round(minutes * 60)}s`;
  } else if (minutes < 60) {
    const minute1dp = minutes.toFixed(1);
    if (minute1dp.endsWith(".0")) {
      res = `${Math.round(minutes)}m`;
    } else {
      res = `${minute1dp}m`;
    }
  } else {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.round(minutes % 60);
    if (remainingMinutes === 0) {
      res = `${hours}h`;
    } else {
      res = `${hours}h ${remainingMinutes}m`;
    }
  }
  return res;
}

plot.setYLabel("Interaction Percentage", 0);
plot.setYFormat(formatMinutes)

plot.setYAxisSide("left", 0);
plot.setYLabel("Secondary Y (right)", 1);
plot.setYAxisSide("right", 1);

document.getElementById("contanier").appendChild(plot);