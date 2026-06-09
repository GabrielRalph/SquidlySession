import { SvgPlus } from "../../SvgPlus/4.js";
import { Vector } from "../../SvgPlus/vector.js";
import { Axis, BBox, ClipPath, Defs, Grid, Group, Line, Rect, Text, Tick } from "./plot.js";

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


export class InteractivePlot extends SvgPlus {
    static MAX_SCALE = 10;
    static MIN_SCALE = 0.25;
    static MAX_TICKS_PER_AXIS = 50;
    static SNAP_THRESHOLD = 0.1; // fraction of a tick interval within which snapping fires


    // Series: [{ points: Vector[], styles: {} }]
    #series = [];

    // Plot area size in SVG pixels
    #pSize = new Vector(400, 400);

    // Target number of grid divisions per axis
    #ticks = new Vector(10, 10);

    // Tick mark length in SVG pixels
    #tickLength = 3;

    // Axis label strings
    #xLabel = "X";
    #yLabel = "Y";

    // View state
    #viewOffset = new Vector(0, 0);
    #viewScale = 1;

    // Initial transform derived from data bounds (zoom=1, pan=0)
    // iScale.y is negative because the y-axis is flipped
    #iPos = new Vector(0, 0);
    #iScale = new Vector(1, -1);

    // SVG structural elements
    #regionClipPath = null;
    #staticGroup = null;
    #dynamicGroup = null;

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

    /** Replace all series with a single dataset and reset the view. */
    set data(points) {
        this.#series = [{ points: points.map(p => new Vector(p)), styles: {} }];
        this.#resetView();
    }

    /** Add a data series. `styles` is merged into the line's LineStyles. */
    addSeries(points, styles = {}, yaxis = 0) {
        this.#series.push({ points: points.map(p => new Vector(p)), styles });
        this.#resetView();
    }

    /** Clear all series and reset the view. */
    clearSeries() {
        this.#series = [];
        this.#viewOffset = new Vector(0, 0);
        this.#viewScale = 1;
        this.#change = true;
    }

    resetView() {
        this.#viewOffset = new Vector(0, 0);
        this.#viewScale = 1;
        this.#change = true;
    }

    /** Update the plot area size (Vector or [width, height]). */
    set size(v) {
        this.#pSize = new Vector(v);
        this.#resetView(); // recomputes iScale for new size, then rebuilds structure
    }
    get size() { return this.#pSize; }

    set xLabel(label) {
        this.#xLabel = String(label);
        // Only rebuild if data is present; otherwise #build() will run when addSeries() is called
        if (this.#series.length > 0) this.#build();
        this.#change = true;
    }
    get xLabel() { return this.#xLabel; }

    set yLabel(label) {
        this.#yLabel = String(label);
        if (this.#series.length > 0) this.#build();
        this.#change = true;
    }
    get yLabel() { return this.#yLabel; }

    // ── Private ───────────────────────────────────────────────────────────────

    /**
     * Returns the longest formatted tick label string for each axis at the
     * current zoom=1 / offset=0 view, derived from the actual tick values.
     * Falls back to a conservative estimate when no data is loaded.
     */
    #longestTickLabels() {
        if (this.#series.length === 0) return { x: "-100.00", y: "-100.00" };

        const format = v => v.toFixed(2);
        // Pick the label with the most characters (most digits + potential minus sign)
        const longestOf = (...vals) => vals.map(format).reduce((a, b) => b.length > a.length ? b : a);

        // Worst-case visible range is at MIN_SCALE (most zoomed out), where the
        // interval is largest and the user can pan furthest from the data.
        const effectiveScale = this.#iScale.mul(InteractivePlot.MIN_SCALE);

        // Visible data width/height in data units at min scale (use abs to avoid sign confusion)
        const visW = this.#pSize.x / effectiveScale.x;                   // positive (iScale.x > 0)
        const visH = this.#pSize.y / Math.abs(effectiveScale.y);         // positive (iScale.y < 0)

        // Tick intervals at min scale (compute from positive visible sizes)
        const intervalX = bestTickInterval(visW / this.#ticks.x);
        const intervalY = bestTickInterval(visH / this.#ticks.y);

        // Data bounds in raw (unflipped) data space
        const allPoints = this.#series.flatMap(s => s.points);
        const db = BBox.fromPoints(allPoints, false);
        const dataMinX = db.pos.x;
        const dataMaxX = db.pos.x + db.size.x;
        const dataMinY = db.pos.y;
        const dataMaxY = db.pos.y + db.size.y;

        // The clamp allows panning until one data point is just inside the plot edge,
        // so the most extreme visible tick is roughly one visible-window beyond the data bounds.
        const extremeLeftX   = Math.floor((dataMinX - visW) / intervalX) * intervalX;
        const extremeRightX  = Math.ceil((dataMaxX + visW) / intervalX) * intervalX;
        const extremeBottomY = Math.floor((dataMinY - visH) / intervalY) * intervalY;
        const extremeTopY    = Math.ceil((dataMaxY + visH) / intervalY) * intervalY;

        return {
            x: longestOf(extremeLeftX, extremeRightX),
            y: longestOf(extremeBottomY, extremeTopY),
        };
    }

    /**
     * Rebuilds the fixed SVG structure: clip-path defs, axis labels, plot border.
     * Called on construction and whenever size, labels, or data bounds change.
     */
    #build() {
        const { x: pWidth, y: pHeight } = this.#pSize;
        const tickLength = this.#tickLength;

        // Clip path constrains the data lines to the plot area
        this.#regionClipPath = ClipPath.make({
            children: [Rect.make({ position: [0, 0], width: pWidth, height: pHeight })]
        });
        const defs = Defs.make({ children: [this.#regionClipPath] }).render();

        // Use actual tick label strings to size the margins correctly
        const longestLabels = this.#longestTickLabels();
        console.log(longestLabels)
        const maxPXTick = Tick.make({
            position: [0, 0],
            content: longestLabels.x,
            tickLength,
            tickDirection: 3 * Math.PI / 2,
        });
        const minPYTick = Tick.make({
            position: [0, 0],
            content: longestLabels.y,
            tickLength,
            tickDirection: Math.PI,
        });

        const bPos = minPYTick.pos;
        const bSize = this.#pSize.add(maxPXTick.pos.add(maxPXTick.size)).sub(bPos);
        let bbox = new BBox(bPos, bSize);

        const xAxisLabel = Text.make({
            content: this.#xLabel,
            position: [pWidth / 2, bbox.bottom + tickLength * 2],
            styles: { fontSize: 12 },
            anchor: "center-top",
        });

        const yAxisLabel = Text.make({
            content: this.#yLabel,
            position: [bbox.left - tickLength * 2, pHeight / 2],
            styles: { fontSize: 12 },
            anchor: "center-bottom",
            rotation: -90,
        });

        const plotBox = Rect.make({ position: [0, 0], width: pWidth, height: pHeight });

        this.#bbox = bbox.union(xAxisLabel.boundingBox).union(yAxisLabel.boundingBox);
        this.setAttribute("viewBox", this.#bbox);

        // Replace static group (axis labels, border, defs)
        if (this.#staticGroup) this.#staticGroup.remove();
        this.#staticGroup = this.createChild("g", {
            content: defs + xAxisLabel + yAxisLabel + plotBox
        });

        // Replace dynamic group (data lines, axes, grid) — must come after static
        if (this.#dynamicGroup) this.#dynamicGroup.remove();
        this.#dynamicGroup = this.createChild("g");
    }

    /** Recalculate the initial transform from all series data and reset pan/zoom. */
    #resetView() {
        this.#updateInitialView();
        this.#build(); // rebuild margins now that iPos/iScale reflect the current data
        this.#viewOffset = new Vector(0, 0);
        this.#viewScale = 1;
        this.#change = true;
    }

    /**
     * Derives `#iPos` and `#iScale` from the bounding box of all series,
     * so that zoom=1 / offset=0 fits all data in the plot area.
     */
    #updateInitialView() {
        if (this.#series.length === 0) return;
        const allPoints = this.#series.flatMap(s => s.points);
        const dataBounds = BBox.fromPoints(allPoints, true); // flipY for SVG coords

        // Use #ticks as a hint for a nice interval, but then snap the start and end
        // independently to the nearest enclosing tick — giving the tightest view that
        // still begins and ends on a grid line.
        const baseTickIntervals = new Vector(
            bestTickInterval(dataBounds.size.x / this.#ticks.x),
            bestTickInterval(dataBounds.size.y / this.#ticks.y)
        );

        // dataBounds (flipY=true): pos = (minX, maxY), size = (maxX-minX, minY-maxY)
        // intervalX > 0, intervalY < 0 — the math below handles both signs correctly.
        const dataEnd = dataBounds.pos.add(dataBounds.size);

        // Start: first tick that sits at or outside the near data edge
        //   x → floor(minX / iX)*iX  ≤ minX
        //   y → floor(maxY / iY)*iY  ≥ maxY  (iY < 0, so floor gives a larger value)
        const baseTickStart = new Vector(
            Math.floor(dataBounds.pos.x / baseTickIntervals.x),
            Math.floor(dataBounds.pos.y / baseTickIntervals.y)
        ).mul(baseTickIntervals);

        // End: first tick that sits at or outside the far data edge
        //   x → ceil(maxX / iX)*iX  ≥ maxX
        //   y → ceil(minY / iY)*iY  ≤ minY  (iY < 0, so ceil gives a smaller value)
        const baseTickEnd = new Vector(
            Math.ceil(dataEnd.x / baseTickIntervals.x),
            Math.ceil(dataEnd.y / baseTickIntervals.y)
        ).mul(baseTickIntervals);

        this.#iPos = baseTickStart;
        this.#iScale = this.#pSize.div(baseTickEnd.sub(baseTickStart));
    }

    /**
     * Clamps a proposed viewOffset so that at least one point from all series
     * remains visible inside the plot area.
     * @param {Vector} offset - the proposed new viewOffset
     * @returns {Vector} the clamped offset
     */
    #clampOffset(offset) {
        if (this.#series.length === 0) return offset;

        const effectiveScale = this.#iScale.mul(this.#viewScale);
        const allPoints = this.#series.flatMap(s => s.points);
        // Use non-flipped bounds so pos/size are both positive
        const db = BBox.fromPoints(allPoints, false);
        const dataMinX = db.pos.x;
        const dataMaxX = db.pos.x + db.size.x;
        const dataMinY = db.pos.y;
        const dataMaxY = db.pos.y + db.size.y;

        const { x: pWidth, y: pHeight } = this.#pSize;

        // Plot-pixel x coords of data bounds  (effectiveScale.x > 0)
        // pixelX = (dataX - iPos.x) * effectiveScale.x - offset.x
        const pxMinX = (dataMinX - this.#iPos.x) * effectiveScale.x - offset.x;
        const pxMaxX = (dataMaxX - this.#iPos.x) * effectiveScale.x - offset.x;

        // Plot-pixel y coords of data bounds  (effectiveScale.y < 0)
        // Larger dataY → smaller pixelY (top of plot)
        const pxMinY = (dataMaxY - this.#iPos.y) * effectiveScale.y - offset.y;
        const pxMaxY = (dataMinY - this.#iPos.y) * effectiveScale.y - offset.y;

        let ox = offset.x;
        let oy = offset.y;

        // X: clamp so data bbox always overlaps [0, pWidth]
        if (pxMinX >= pWidth) {
            // Data has slid off the right — pull left so the left data edge is just inside
            ox = (dataMinX - this.#iPos.x) * effectiveScale.x - (pWidth - 1);
        } else if (pxMaxX <= 0) {
            // Data has slid off the left — pull right so the right data edge is just inside
            ox = (dataMaxX - this.#iPos.x) * effectiveScale.x - 1;
        }

        // Y: clamp so data bbox always overlaps [0, pHeight]
        if (pxMinY >= pHeight) {
            // Data has slid below the plot — pull up so the top data edge is just inside
            oy = (dataMaxY - this.#iPos.y) * effectiveScale.y - (pHeight - 1);
        } else if (pxMaxY <= 0) {
            // Data has slid above the plot — pull down so the bottom data edge is just inside
            oy = (dataMinY - this.#iPos.y) * effectiveScale.y - 1;
        }

        return new Vector(ox, oy);
    }

    /** Renders the dynamic layer (data lines, axes, grid) into the SVG. */
    #render() {
        if (this.#series.length === 0 || !this.#dynamicGroup) return;

        const { x: pWidth, y: pHeight } = this.#pSize;
        const effectiveScale = this.#iScale.mul(this.#viewScale);

        // Visible data window in data-space coordinates
        const viewDataOrigin = this.#iPos.add(this.#viewOffset.div(effectiveScale));
        const viewDataEnd = viewDataOrigin.add(this.#pSize.div(effectiveScale));

        // Recalculate tick intervals for the current zoom level
        const visibleDataSize = this.#pSize.div(effectiveScale);
        const curTickIntervals = new Vector(
            bestTickInterval(visibleDataSize.x / this.#ticks.x),
            bestTickInterval(visibleDataSize.y / this.#ticks.y)
        );

        const actualTickStart = new Vector(
            Math.ceil(viewDataOrigin.x / curTickIntervals.x),
            Math.floor(viewDataOrigin.y / curTickIntervals.y)
        ).mul(curTickIntervals);

        const MAX = InteractivePlot.MAX_TICKS_PER_AXIS;

        const xTicks = [];
        for (let t = actualTickStart.x; t <= viewDataEnd.x + Math.abs(curTickIntervals.x); t += curTickIntervals.x) {
            xTicks.push(t);
            if (xTicks.length > MAX) break;
        }

        const yTicks = [];
        for (let t = actualTickStart.y; t >= viewDataEnd.y - Math.abs(curTickIntervals.y); t += curTickIntervals.y) {
            yTicks.push(t);
            if (yTicks.length > MAX) break;
        }

        const lines = this.#series.map(({ points, styles }) => {
            const transformed = points.map(p =>
                p.sub(this.#iPos).mul(effectiveScale).sub(this.#viewOffset)
            );
            return Line.make({
                points: transformed,
                styles: { strokeWidth: 0.5, clipPath: this.#regionClipPath, ...styles }
            });
        });

        const xaxis = Axis.make({
            position: [0, pHeight],
            axisLength: pWidth,
            tickLength: this.#tickLength,
            portrait: false,
            minValue: viewDataOrigin.x,
            maxValue: viewDataEnd.x,
            ticks: xTicks,
            flipTickSide: true,
        });

        const yaxis = Axis.make({
            position: [0, 0],
            axisLength: pHeight,
            tickLength: this.#tickLength,
            portrait: true,
            minValue: viewDataOrigin.y,
            maxValue: viewDataEnd.y,
            ticks: yTicks,
        });

        const grid = Grid.make({
            xPositions: xaxis.tickPositions,
            yPositions: yaxis.tickPositions,
            position: [0, 0],
            width: pWidth,
            height: pHeight,
            lineStyles: { strokeWidth: 0.5, stroke: "#0003" }
        });

        // Zero lines: only drawn when x=0 / y=0 is within the visible data window
        const zeroLineStyles = { strokeWidth: 1, stroke: "#0006", clipPath: this.#regionClipPath };
        const zeroChildren = [];

        const xZero = (0 - this.#iPos.x) * effectiveScale.x - this.#viewOffset.x;
        if (xZero >= 0 && xZero <= pWidth) {
            zeroChildren.push(Line.make({
                points: [[xZero, 0], [xZero, pHeight]],
                styles: zeroLineStyles,
            }));
        }

        const yZero = (0 - this.#iPos.y) * effectiveScale.y - this.#viewOffset.y;
        if (yZero >= 0 && yZero <= pHeight) {
            zeroChildren.push(Line.make({
                points: [[0, yZero], [pWidth, yZero]],
                styles: zeroLineStyles,
            }));
        }

        this.#dynamicGroup.innerHTML = Group.make({ children: [...lines, grid, ...zeroChildren, xaxis, yaxis] });
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
     * Snaps the pan offset so the left/top data-space edge of the visible window
     * lands on the nearest tick boundary on each axis, but only if the distance
     * to that boundary is within SNAP_THRESHOLD * interval.
     */
    #snapPan() {
        const effectiveScale = this.#iScale.mul(this.#viewScale);
        const visibleDataSize = this.#pSize.div(effectiveScale);
        const intervalX = bestTickInterval(visibleDataSize.x / this.#ticks.x);
        const intervalY = bestTickInterval(visibleDataSize.y / this.#ticks.y); // negative

        // Current data coordinate at the plot origin
        const viewDataOrigin = this.#iPos.add(this.#viewOffset.div(effectiveScale));

        const threshold = InteractivePlot.SNAP_THRESHOLD;

        // X: snap the LEFT edge of the visible range to the nearest tick boundary
        const absIX = Math.abs(intervalX);
        const remX = ((viewDataOrigin.x % absIX) + absIX) % absIX;
        const deltaX = remX <= absIX * 0.5 ? remX : remX - absIX;
        const snappedX = Math.abs(deltaX) <= absIX * threshold
            ? viewDataOrigin.x - deltaX
            : viewDataOrigin.x;

        // Y: snap the BOTTOM edge of the visible range to the nearest tick boundary.
        // viewDataOrigin.y is the TOP (largest y), so the bottom is viewDataOrigin.y + pSize.y/effectiveScale.y
        // (effectiveScale.y < 0, so this is smaller). The whole view shifts by the same delta.
        const viewDataEndY = viewDataOrigin.y + this.#pSize.y / effectiveScale.y;
        const absIY = Math.abs(intervalY);
        const remY = ((viewDataEndY % absIY) + absIY) % absIY;
        const deltaY = remY <= absIY * 0.5 ? remY : remY - absIY;
        const snappedY = Math.abs(deltaY) <= absIY * threshold
            ? viewDataOrigin.y - deltaY
            : viewDataOrigin.y;

        this.#viewOffset = this.#clampOffset(new Vector(
            (snappedX - this.#iPos.x) * effectiveScale.x,
            (snappedY - this.#iPos.y) * effectiveScale.y,
        ));
        this.#change = true;
    }

    /**
     * Snaps the zoom scale so the visible data range is an integer multiple of
     * the current tick interval on the x-axis (the y-axis follows because scale
     * is a single scalar). The anchor point (data coordinate at plot centre) is
     * preserved so the view doesn't jump.
     */
    #snapScale() {
        const effectiveScale = this.#iScale.mul(this.#viewScale);
        const visibleDataSize = this.#pSize.div(effectiveScale);
        const intervalX = bestTickInterval(visibleDataSize.x / this.#ticks.x);

        // How many tick intervals are currently visible?
        const currentTickCount = visibleDataSize.x / intervalX;
        const snappedTickCount = Math.max(1, Math.round(currentTickCount));

        // Only snap if the fractional part is within the threshold
        const fractional = Math.abs(currentTickCount - snappedTickCount);
        if (fractional > InteractivePlot.SNAP_THRESHOLD) return;

        // New visible data width = snappedTickCount * intervalX
        const newVisW = snappedTickCount * intervalX;
        const newEffectiveScaleX = this.#pSize.x / newVisW;
        const newViewScale = Math.max(
            InteractivePlot.MIN_SCALE,
            Math.min(InteractivePlot.MAX_SCALE, newEffectiveScaleX / this.#iScale.x)
        );

        // Preserve the data coordinate at the plot centre
        const oldEffectiveScale = this.#iScale.mul(this.#viewScale);
        const centrePlotPx = this.#pSize.mul(0.5);
        const centreData = this.#iPos.add(
            this.#viewOffset.add(centrePlotPx).div(oldEffectiveScale)
        );

        this.#viewScale = newViewScale;

        // Re-derive offset so the same data point stays at the centre
        const newEffectiveScale = this.#iScale.mul(this.#viewScale);
        this.#viewOffset = this.#clampOffset(
            centreData.sub(this.#iPos).mul(newEffectiveScale).sub(centrePlotPx)
        );
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
        let wheelSnapTimer = null;
        this.addEventListener("wheel", e => {
            e.preventDefault();
            if (!this.#bbox) return;

            const zoomFactor = Math.pow(1.1, -e.deltaY / 100);
            const newScale = Math.max(
                InteractivePlot.MIN_SCALE,
                Math.min(InteractivePlot.MAX_SCALE, this.#viewScale * zoomFactor)
            );
            const ratio = newScale / this.#viewScale;

            // Convert pointer position to SVG viewBox space
            const rect = this.getBoundingClientRect();
            const svgScale = this.#bbox.size.div(this.clientWidth, this.clientHeight);
            const mouseInPlot = new Vector(
                this.#bbox.pos.x + (e.clientX - rect.left) * svgScale.x,
                this.#bbox.pos.y + (e.clientY - rect.top) * svgScale.y
            );

            // Keep the data point under the pointer fixed:
            // newViewOffset = mouseInPlot * (ratio - 1) + viewOffset * ratio
            const proposed = mouseInPlot.mul(ratio - 1).add(this.#viewOffset.mul(ratio));
            this.#viewScale = newScale;
            this.#viewOffset = this.#clampOffset(proposed);
            this.#change = true;

            // Snap scale then pan once the wheel gesture has settled
            clearTimeout(wheelSnapTimer);
            wheelSnapTimer = setTimeout(() => {
                this.#snapScale();
                this.#snapPan();
            }, 150);
        }, { passive: false });
    }
}

// ── Example usage ─────────────────────────────────────────────────────────────

const plot = new InteractivePlot("#contanier");
plot.size = [550, 400];
plot.xLabel = "X Axis Label";
plot.yLabel = "Y Axis Label";
plot.addSeries(
    new Array(100).fill(0).map((_, i) => new Vector(
        Math.PI * i / 99,
        Math.random() + Math.cos(i / 15) * 9 + Math.sin(i / 5) * 5
    )),
    {
        stroke: "steelblue",
        strokeWidth: 1,
    }
);
plot.addSeries(
    new Array(100).fill(0).map((_, i) => new Vector(
        Math.PI * i / 99,
        Math.random() + Math.sin(i / 15) * 9 + Math.cos(i / 5) * 5
    )),
    {
        stroke: "tomato",
        strokeWidth: 1,
    }
);

document.getElementById("contanier").appendChild(plot);