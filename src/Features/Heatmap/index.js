import { Vector } from "../../SvgPlus/vector.js";
import { HeatmapPlot } from "./Plots/heatmap.js";
import {  Group, Rect, Tick, Text, Axis, Line, Grid } from "./Plots/plot.js";


// let offset = 10;

// let x = new Array(100).fill(0).map((_, i) => i);
// let y = x.map(x => Math.sin(Math.PI * 2 * x/99) * 20);
// x.map((x, i) => x + offset);

// let line = Line.make({
//     points: x.map((x, i) => new Vector(x, y[i])),
//     styles: {strokeWidth: 0.5}
// })


// let ticks3 = Axis.make({
//     position: [0,0],
//     axisLength: 99,
//     tickLength: 3,
    
//     portrait: false,
//     minValue: 0.3,
//     maxValue: 2.3,
//     ticks: [0.5, 1, 1.25, 1.5, 2, 2.3, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6],
//     tickLineStyles: {strokeWidth: 0.5, stroke: "#0007"},
//     tickTextStyles: {
//         fontSize: 5, 
//         fill: "#0007"
//     },
//     tickFormatFunction: value => 
//         value == 0 ? "0" : (value == 1 ? "π" : value + "π")
// })


// let ticks4 = Axis.make({
//     position: line.pos,
//     axisLength: line.height,
//     tickLength: 3,
//     minValue: 1,
//     maxValue: -1,
//     tickIncrements: 4,
//     portrait: true,
//     tickLineStyles: {strokeWidth: 0.5, stroke: "#0007"},
//     tickTextStyles: {
//         fontSize: 5, 
//         fill: "#0007"
//     },
// })

// let grid = Grid.make({
//     xPositions: ticks3.tickPositions,
//     yPositions: ticks4.tickPositions,
//     position: line.pos,
//     width: line.width,
//     height: line.height,
//     lineStyles: {strokeWidth: 0.5, stroke: "#0003"}
// })

// let g2 = Group.make({children: [
//     line,
//     ticks3,
//     ticks4,
//     grid
// ]})

const c1 = [255, 255, 189];
const c11 = [249, 122, 93];
const c2 = [176, 53, 123];
const c3 = [0, 0, 50];

function lurpColors(colors, t) {
    const n = colors.length;
    const scaledT = t * (n - 1);
    const index1 = Math.floor(scaledT);
    const index2 = Math.ceil(scaledT);
    const localT = scaledT - index1;

    const c1 = colors[index1];
    const c2 = colors[index2];

    return c1.map((c, i) => Math.round(c * (1 - localT) + c2[i] * localT));
}

// for (let i = 0; i < 10000; i++) {
let i = 0;
const data =[[0,0,0,0,0,0,0,0,0,0],[22,13,4,0,0,0,0,3,14,16],[3,2,1,4,16,35,63,49,33,0],[0,0,6,0,22,19,9,14,38,0],[20,20,20,19,4,17,3,1,37,5],[22,9,0,14,22,8,1,0,30,2],[23,42,14,30,27,10,12,1,41,0],[60,242,112,12,3,5,7,9,29,1],[140,427,238,41,16,0,4,13,39,3],[43,97,99,17,36,0,0,0,0,0]]
const sum = data.flat().reduce((a,b) => a+b, 0);
const dataPercent = data.map(row => row.map(value => value / sum));
const max = Math.max(...dataPercent.flat());
const min = Math.min(...dataPercent.flat().filter(v => v > 0));
const dataRel = dataPercent.map(row => row.map(value =>  value / max ));
    let g = HeatmapPlot.make({
        data: dataRel,
        width: 500,
        height: 400,
        portrait: false,
        yAxisLabel: "Relative Screen Y",
        xAxisLabel: "Relative Screen X",
        zAxisLabel: "Relative Frequency",
        title: "Mouse Heatmap",
        // colorScale: t => lurpColors([c1, c11, c2, c3], 1-t),
        titleTextStyles: {fontSize: 20, fill: "#000"},
        tickXFormatFunction: value => (value * 100).toFixed(0) + "%",
        tickZFormatFunction: value => value.toFixed(2),
    });

    document.body.innerHTML = `
    <svg viewBox="${g.boundingBox.pad(20)}" width="100vw">
        ${g}
    </svg>`
    await new Promise(resolve => setTimeout(resolve, 20));
// }