/**
 * norm-svgpaths.js
 *
 * Given two SVG path strings, produce two new path strings that have exactly
 * the same command structure (same number of sub-paths, same number of
 * points, every segment a cubic "C"), so they can be linearly interpolated
 * point-by-point (e.g. CSS `d` transitions, SMIL <animate>, or a JS lerp).
 *
 * Steps:
 *   1. Parse each path and convert every command (M L H V C S Q T A Z, abs or
 *      rel) into absolute cubic bezier segments.
 *   2. Pair up sub-paths; pad the path with fewer sub-paths with degenerate
 *      (zero-size) sub-paths placed at the centroid of their counterpart.
 *   3. For each pair, subdivide segments (without changing the shape) until
 *      both sub-paths have the same segment count. Splits are distributed
 *      by segment length so points stay evenly spread.
 *   4. For closed sub-paths, rotate the start point and optionally reverse
 *      direction to minimise point travel during the morph (avoids twisting).
 *
 * Usage (CLI):
 *   node build-scripts/norm-svgpaths.js "<d1>" "<d2>" [--precision 3] [--no-align] [--json]
 *
 *   Each argument may also be a file path. If the file is an SVG, the `d`
 *   attributes of all its <path> elements are concatenated.
 *
 * Usage (module):
 *   import { normalizePaths } from "./norm-svgpaths.js";
 *   const [a, b] = normalizePaths(d1, d2, { precision: 3, align: true });
 */

import fs from "fs";
import { fileURLToPath } from "url";

// ───────────────────────────── Parsing ──────────────────────────────

const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** Tokenise a path `d` string into [{cmd, args}] (handles compact arc flags). */
function parsePathData(d) {
    const n = d.length;
    let i = 0;
    const numRe = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
    const skip = () => { while (i < n && /[\s,]/.test(d[i])) i++; };
    const readNum = () => {
        skip();
        numRe.lastIndex = i;
        const m = numRe.exec(d);
        if (!m) throw new Error(`Expected number at index ${i} in path: "${d.slice(i, i + 20)}"`);
        i = numRe.lastIndex;
        return parseFloat(m[0]);
    };
    const readFlag = () => {
        skip();
        const c = d[i];
        if (c !== "0" && c !== "1") throw new Error(`Expected arc flag at index ${i}`);
        i++;
        return c === "1" ? 1 : 0;
    };

    const out = [];
    let cmd = null;
    while (true) {
        skip();
        if (i >= n) break;
        if (/[a-zA-Z]/.test(d[i])) {
            cmd = d[i++];
            if (!(cmd.toUpperCase() in ARITY)) throw new Error(`Unknown path command "${cmd}"`);
        } else if (!cmd) {
            throw new Error(`Path must start with a command, got "${d[i]}"`);
        }
        const up = cmd.toUpperCase();
        if (up === "Z") {
            out.push({ cmd, args: [] });
            cmd = null;
            continue;
        }
        const args = [];
        for (let k = 0; k < ARITY[up]; k++) {
            args.push(up === "A" && (k === 3 || k === 4) ? readFlag() : readNum());
        }
        out.push({ cmd, args });
        // Implicit repeats after a moveto are linetos.
        if (cmd === "M") cmd = "L";
        else if (cmd === "m") cmd = "l";
    }
    return out;
}

// ───────────────────────────── Geometry ─────────────────────────────

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

function lineToCubic(p0, p1) {
    return [lerp(p0, p1, 1 / 3), lerp(p0, p1, 2 / 3), p1];
}

function quadToCubic(p0, q, p1) {
    return [lerp(p0, q, 2 / 3), lerp(p1, q, 2 / 3), p1];
}

/** Convert an SVG elliptical arc to a list of cubic segments [[c1, c2, p], ...]. */
function arcToCubics(p0, rx, ry, phiDeg, fa, fs, p1) {
    const [x1, y1] = p0, [x2, y2] = p1;
    if (x1 === x2 && y1 === y2) return [];
    rx = Math.abs(rx); ry = Math.abs(ry);
    if (rx === 0 || ry === 0) return [lineToCubic(p0, p1)];

    const phi = (phiDeg * Math.PI) / 180;
    const cos = Math.cos(phi), sin = Math.sin(phi);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const x1p = cos * dx + sin * dy;
    const y1p = -sin * dx + cos * dy;

    const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }

    const rx2 = rx * rx, ry2 = ry * ry;
    const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
    const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
    const coef = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
    const cxp = (coef * rx * y1p) / ry;
    const cyp = (-coef * ry * x1p) / rx;
    const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
    const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;

    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry;
    const vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
    const theta1 = ang(1, 0, ux, uy);
    let dTheta = ang(ux, uy, vx, vy);
    if (!fs && dTheta > 0) dTheta -= 2 * Math.PI;
    else if (fs && dTheta < 0) dTheta += 2 * Math.PI;

    const nSeg = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2) - 1e-9));
    const delta = dTheta / nSeg;
    const k = (4 / 3) * Math.tan(delta / 4);
    const map = (u, v) => [cx + cos * rx * u - sin * ry * v, cy + sin * rx * u + cos * ry * v];

    const segs = [];
    for (let s = 0; s < nSeg; s++) {
        const t1 = theta1 + s * delta, t2 = t1 + delta;
        const c1t = Math.cos(t1), s1t = Math.sin(t1), c2t = Math.cos(t2), s2t = Math.sin(t2);
        segs.push([
            map(c1t - k * s1t, s1t + k * c1t),
            map(c2t + k * s2t, s2t - k * c2t),
            s === nSeg - 1 ? [x2, y2] : map(c2t, s2t),
        ]);
    }
    return segs;
}

/**
 * Convert parsed commands to sub-paths. Each sub-path is
 * { pts: [[x,y], ...], closed } where pts has length 3n+1 and segment i is
 * pts[3i .. 3i+3] (start, ctrl1, ctrl2, end).
 */
function toCubicSubpaths(cmds) {
    const subs = [];
    let cur = null;
    let x = 0, y = 0, sx = 0, sy = 0;
    let lastCubicCtrl = null, lastQuadCtrl = null;

    const ensure = () => {
        if (!cur) { cur = { pts: [[x, y]], closed: false }; subs.push(cur); }
    };
    const push = (c1, c2, p) => { cur.pts.push(c1, c2, p); x = p[0]; y = p[1]; };

    for (const { cmd, args: a } of cmds) {
        const up = cmd.toUpperCase();
        const rel = cmd !== up;
        const P = (px, py) => (rel ? [x + px, y + py] : [px, py]);
        let nextCubic = null, nextQuad = null;

        switch (up) {
            case "M": {
                [x, y] = P(a[0], a[1]);
                sx = x; sy = y;
                cur = { pts: [[x, y]], closed: false };
                subs.push(cur);
                break;
            }
            case "L": ensure(); push(...lineToCubic([x, y], P(a[0], a[1]))); break;
            case "H": ensure(); push(...lineToCubic([x, y], [rel ? x + a[0] : a[0], y])); break;
            case "V": ensure(); push(...lineToCubic([x, y], [x, rel ? y + a[0] : a[0]])); break;
            case "C": {
                ensure();
                const c1 = P(a[0], a[1]), c2 = P(a[2], a[3]), p = P(a[4], a[5]);
                push(c1, c2, p); nextCubic = c2;
                break;
            }
            case "S": {
                ensure();
                const c1 = lastCubicCtrl ? [2 * x - lastCubicCtrl[0], 2 * y - lastCubicCtrl[1]] : [x, y];
                const c2 = P(a[0], a[1]), p = P(a[2], a[3]);
                push(c1, c2, p); nextCubic = c2;
                break;
            }
            case "Q": {
                ensure();
                const q = P(a[0], a[1]), p = P(a[2], a[3]);
                push(...quadToCubic([x, y], q, p)); nextQuad = q;
                break;
            }
            case "T": {
                ensure();
                const q = lastQuadCtrl ? [2 * x - lastQuadCtrl[0], 2 * y - lastQuadCtrl[1]] : [x, y];
                const p = P(a[0], a[1]);
                push(...quadToCubic([x, y], q, p)); nextQuad = q;
                break;
            }
            case "A": {
                ensure();
                for (const seg of arcToCubics([x, y], a[0], a[1], a[2], a[3], a[4], P(a[5], a[6]))) push(...seg);
                break;
            }
            case "Z": {
                if (cur) {
                    if (x !== sx || y !== sy) push(...lineToCubic([x, y], [sx, sy]));
                    cur.closed = true;
                }
                x = sx; y = sy;
                cur = null; // a drawing command after Z starts a new sub-path at (sx, sy)
                break;
            }
        }
        lastCubicCtrl = nextCubic;
        lastQuadCtrl = nextQuad;
    }

    // Give empty sub-paths (lone "M x y") a single degenerate segment.
    for (const s of subs) if (s.pts.length === 1) s.pts.push(s.pts[0], s.pts[0], s.pts[0]);
    return subs;
}

/** Split cubic [p0,c1,c2,p1] at t → two cubics (as 7 points, shared midpoint). */
function splitCubic(p0, c1, c2, p1, t) {
    const a = lerp(p0, c1, t), b = lerp(c1, c2, t), c = lerp(c2, p1, t);
    const d = lerp(a, b, t), e = lerp(b, c, t);
    const m = lerp(d, e, t);
    return [p0, a, d, m, e, c, p1];
}

function cubicLength(p0, c1, c2, p1, samples = 16) {
    let len = 0, prev = p0;
    for (let i = 1; i <= samples; i++) {
        const t = i / samples, mt = 1 - t;
        const pt = [
            mt ** 3 * p0[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t ** 3 * p1[0],
            mt ** 3 * p0[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t ** 3 * p1[1],
        ];
        len += Math.sqrt(dist2(prev, pt));
        prev = pt;
    }
    return len;
}

const segCount = (sub) => (sub.pts.length - 1) / 3;

/** Subdivide a sub-path (shape-preserving) until it has `target` segments. */
function subdivideTo(sub, target) {
    const n = segCount(sub);
    if (target <= n) return sub;
    const lens = [];
    for (let i = 0; i < n; i++) lens.push(cubicLength(...sub.pts.slice(3 * i, 3 * i + 4)));

    // Greedily give extra pieces to whichever segment currently has the longest pieces.
    const pieces = new Array(n).fill(1);
    for (let extra = target - n; extra > 0; extra--) {
        let best = 0;
        for (let i = 1; i < n; i++) if (lens[i] / pieces[i] > lens[best] / pieces[best]) best = i;
        pieces[best]++;
    }

    const pts = [sub.pts[0]];
    for (let i = 0; i < n; i++) {
        let [p0, c1, c2, p1] = sub.pts.slice(3 * i, 3 * i + 4);
        // Split into equal-t pieces: cut at 1/k, then 1/(k-1) of the remainder, ...
        for (let k = pieces[i]; k > 1; k--) {
            const s = splitCubic(p0, c1, c2, p1, 1 / k);
            pts.push(s[1], s[2], s[3]);
            [p0, c1, c2, p1] = s.slice(3);
        }
        pts.push(c1, c2, p1);
    }
    return { ...sub, pts };
}

function centroid(pts) {
    let x = 0, y = 0;
    for (const p of pts) { x += p[0]; y += p[1]; }
    return [x / pts.length, y / pts.length];
}

/** Shoelace-ish area of the anchor polygon, used to order sub-paths by size. */
function approxArea(sub) {
    const p = sub.pts;
    let a = 0;
    for (let i = 0; i < p.length - 1; i++) a += p[i][0] * p[i + 1][1] - p[i + 1][0] * p[i][1];
    return Math.abs(a / 2);
}

/** Sum of squared distances between corresponding points (centroid-relative). */
function matchCost(a, b, ca, cb) {
    let c = 0;
    for (let i = 0; i < a.length; i++) {
        c += (a[i][0] - ca[0] - (b[i][0] - cb[0])) ** 2 + (a[i][1] - ca[1] - (b[i][1] - cb[1])) ** 2;
    }
    return c;
}

/**
 * Re-order `b`'s points (rotate start point for closed paths, and/or reverse
 * direction) to best match `a`. Both must already have equal segment counts.
 */
function alignSubpath(a, b, closed) {
    const ca = centroid(a.pts), cb = centroid(b.pts);
    const candidates = [b.pts, b.pts.slice().reverse()];
    let best = b.pts, bestCost = Infinity;

    for (const cand of candidates) {
        if (closed) {
            const ring = cand.slice(0, -1); // drop duplicated closing point
            const n = ring.length / 3;
            for (let r = 0; r < n; r++) {
                const rot = ring.slice(3 * r).concat(ring.slice(0, 3 * r));
                rot.push(rot[0]);
                const cost = matchCost(a.pts, rot, ca, cb);
                if (cost < bestCost) { bestCost = cost; best = rot; }
            }
        } else {
            const cost = matchCost(a.pts, cand, ca, cb);
            if (cost < bestCost) { bestCost = cost; best = cand; }
        }
    }
    return { ...b, pts: best };
}

// ───────────────────────────── Output ───────────────────────────────

function fmt(v, precision) {
    const s = (+v.toFixed(precision)).toString();
    return s === "-0" ? "0" : s;
}

function subpathsToD(subs, closed, precision) {
    return subs.map((s, idx) => {
        const p = s.pts;
        const f = (pt) => `${fmt(pt[0], precision)} ${fmt(pt[1], precision)}`;
        let d = `M${f(p[0])}`;
        for (let i = 1; i < p.length; i += 3) d += ` C${f(p[i])} ${f(p[i + 1])} ${f(p[i + 2])}`;
        if (closed[idx]) d += " Z";
        return d;
    }).join(" ");
}

// ───────────────────────────── Main API ─────────────────────────────

/**
 * Normalise two SVG path strings so they can be lerped point-by-point.
 * @param {string} d1
 * @param {string} d2
 * @param {{precision?: number, align?: boolean, sortBySize?: boolean}} [opts]
 *   precision  - decimal places in output (default 3)
 *   align      - rotate/reverse sub-paths of d2 to minimise travel (default true)
 *   sortBySize - pair sub-paths by size (largest with largest) instead of
 *                document order (default false)
 * @returns {[string, string]}
 */
export function normalizePaths(d1, d2, opts = {}) {
    const { precision = 3, align = true, sortBySize = false } = opts;
    let A = toCubicSubpaths(parsePathData(d1));
    let B = toCubicSubpaths(parsePathData(d2));
    if (A.length === 0 || B.length === 0) throw new Error("Both paths must contain at least one sub-path");

    if (sortBySize) {
        const bySize = (x, y) => approxArea(y) - approxArea(x);
        A = A.slice().sort(bySize);
        B = B.slice().sort(bySize);
    }

    // Pad the shorter list with degenerate sub-paths at the counterpart's centroid,
    // so extra shapes grow from / shrink to a point.
    const count = Math.max(A.length, B.length);
    const pad = (list, other) => {
        for (let i = list.length; i < count; i++) {
            const c = centroid(other[i].pts);
            list.push({ pts: other[i].pts.map(() => c), closed: other[i].closed });
        }
    };
    pad(A, B);
    pad(B, A);

    const outA = [], outB = [], closed = [];
    for (let i = 0; i < count; i++) {
        const n = Math.max(segCount(A[i]), segCount(B[i]));
        let a = subdivideTo(A[i], n);
        let b = subdivideTo(B[i], n);
        // Only keep "Z" if both are closed; otherwise the closing line (if any)
        // is already an explicit segment, so the shape is unchanged.
        const isClosed = a.closed && b.closed;
        if (align) b = alignSubpath(a, b, isClosed);
        outA.push(a); outB.push(b); closed.push(isClosed);
    }

    return [subpathsToD(outA, closed, precision), subpathsToD(outB, closed, precision)];
}

// ───────────────────────────── CLI ──────────────────────────────────

function readInput(arg) {
    if (fs.existsSync(arg) && fs.statSync(arg).isFile()) {
        const text = fs.readFileSync(arg, "utf8");
        if (text.includes("<")) {
            const ds = [...text.matchAll(/<path\b[^>]*?\sd\s*=\s*(["'])([\s\S]*?)\1/g)].map((m) => m[2]);
            if (ds.length === 0) throw new Error(`No <path d="..."> found in ${arg}`);
            return ds.join(" ");
        }
        return text.trim();
    }
    return arg;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
    const args = process.argv.slice(2);
    const positional = [];
    const opts = {};
    let json = false;
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--precision" || a === "-p") opts.precision = parseInt(args[++i], 10);
        else if (a === "--no-align") opts.align = false;
        else if (a === "--sort-by-size") opts.sortBySize = true;
        else if (a === "--json") json = true;
        else positional.push(a);
    }
    if (positional.length !== 2) {
        console.error(
            'Usage: node norm-svgpaths.js "<path d 1 | file>" "<path d 2 | file>" ' +
            "[--precision N] [--no-align] [--sort-by-size] [--json]"
        );
        process.exit(1);
    }
    const [a, b] = normalizePaths(readInput(positional[0]), readInput(positional[1]), opts);
    if (json) console.log(JSON.stringify({ from: a, to: b }, null, 2));
    else console.log(`${a}\n\n${b}`);
}
