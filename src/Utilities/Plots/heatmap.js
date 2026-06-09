import { Vector } from "../../SvgPlus/vector.js";
import { hsl2rgb } from "../usefull-funcs.js";
import { Line, LineStyles, Renderable, Axis, Text, Grid, Group, Rect, TextStyles, Tick } from "./plot.js";

const sinCurve = (t) => Math.sin(Math.PI * t / 2);

const COLORSCALES ={
    red2green: (value) => hsl2rgb(120 * value, 100, 20 + 30 * sinCurve(Math.min(value*5, 1)) - 5 * sinCurve(Math.max(value*5-4, 0))),
    red2greenNormal: (value) => hsl2rgb(120 * value, 100, 50),
}
const {PI} = Math;

class ColorScaleImage extends Renderable {
    scaleFunction = COLORSCALES.red2green;
    static scaleFunction_parser(value) { 
        if (typeof value === "string") {
            if (value in COLORSCALES) {
                return COLORSCALES[value];
            } else {
                throw new Error(`ColorScale: Invalid scale function name: ${value}`);
            }
        } else if (value instanceof Function) {
            let test = value(0);
            if (Array.isArray(test) && test.length === 3 && test.every(v => typeof v === "number" && v >= 0 && v <= 255)) {
                return value;
            } else {
                throw new Error(`ColorScale: Invalid scale function output: ${test}`);
            }
        } else {
            throw new Error(`ColorScale: Invalid scale function value: ${value}`);
        }
    }

    portrait = false;

    position = new Vector(0, 0);
    static position_parser(value) { return new Vector(value); }

    width = 256;
    
    height = 20;

    imageAttribute = "href"

    outlineStyles = LineStyles.make();

    validate() {
        const {width, height, portrait} = this;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        let range=  portrait ? height : width
        for (let i = 0; i < range; i++) {
            const [r, g, b] = this.scaleFunction(i / (range - 1));
            ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            ctx.fillRect(
                ...(portrait ? [0, i, width, 1] : [i, 0, 1, height])
            );
        }
        this.dataURL = canvas.toDataURL();
        this.rect = Rect.make({
            position: this.position,
            width: this.width,
            height: this.height,
            styles: this.outlineStyles
        });
    }

    render() {
        const {width, height, position: {x, y}, dataURL, rect} = this;
        let img = `<image ${this.imageAttribute}="${dataURL}" width="${width}" height="${height}" x="${x}" y="${y}" />`;
        return this.outlineStyles.strokeWidth > 0 ? `<g>${img}${rect}</g>` : img;
    }
}

class ColorScaleLegend extends Renderable {

    colorScale = ColorScaleImage.make();
    static colorScale_parser(value) { return ColorScaleImage.make(value); }

    minValue = 0;
    maxValue = 1;
    tickIncrements = 10;

    tickLength = 10;

    flipTickSide = false;

    tickLineStyles = LineStyles.make();
    static tickLineStyles_parser(value) { return LineStyles.make(value); }

    tickTextStyles = TextStyles.make();
    static tickTextStyles_parser(value) { return TextStyles.make(value); }


    tickFormatFunction = (value) => value.toFixed(2);
    static tickFormatFunction_parser(value) {
        if (typeof value === "string") {
            return (v) => value.replace("${value}", v.toFixed(1));
        } else if (value instanceof Function) {
            return value;
        } else {
            throw new Error(`ColorScaleLegend: Invalid tick format function: ${value}`);
        }
    }


    get pos() {
        return this._realPos || this.position;
    }

    validate() {
        const {width, height, portrait, pos} = this.colorScale;
        let bbox = this.colorScale.boundingBox;
        const {flipTickSide, minValue, maxValue, tickIncrements, tickLength, tickLineStyles, tickTextStyles} = this;
        let ticks = []
        for (let i = 0; i <= tickIncrements; i++) {
            const value = minValue + (maxValue - minValue) * i / tickIncrements;
            
            const tickX = portrait ? 
                 pos.x + (flipTickSide ? width : 0) : 
                 pos.x + (width) * i / tickIncrements;
            const tickY = portrait ?
                pos.y + (height) * i / tickIncrements : 
                pos.y + (flipTickSide ? height : 0);

            const tick = Tick.make({
                position: new Vector(tickX, tickY),
                tickDirection: portrait ? (flipTickSide ? 0 : PI) : (flipTickSide ?  3*PI/2 : PI/2),
                tickLength: tickLength,
                tickSpace: portrait ? this.tickTextStyles.fontSize * 0.25 : 0,
                lineStyles: tickLineStyles,
                content: this.tickFormatFunction(value),
                textStyles: tickTextStyles
            });
            
            bbox = bbox.union(tick.boundingBox);
            ticks.push(tick)
    
        }

        this._realPos = bbox.pos;
        this.width = bbox.size.x;
        this.height = bbox.size.y;
        this.ticks = ticks;
    }

    render() {
        return `<g>${this.colorScale}${this.ticks.join("")}</g>`;
    }
}

class HeatmapGrid extends Renderable {
    width = 100;
    height = 100;

    position = new Vector(0, 0);
    static position_parser(value) { return new Vector(value); }

    spacing = 0;
    borderRadius = 0;

    borderStyles = LineStyles.make();
    static borderStyles_parser(value) { return LineStyles.make(value); }

    data = [[]];
    static data_parser(value) {
        if (Array.isArray(value) && value.every(row => Array.isArray(row))) {
            return value;
        } else {
            throw new Error(`Heatmap: Invalid data value: ${value}`);
        }
    }

    colorScale = COLORSCALES.red2green;
    static colorScale_parser(value) { 
        if (typeof value === "string") {
            if (value in COLORSCALES) {
                return COLORSCALES[value];
            } else {
                throw new Error(`Heatmap: Invalid color scale function name: ${value}`);
            }
        } else if (value instanceof Function) {
            let test = value(0);
            if (Array.isArray(test) && test.length === 3 && test.every(v => typeof v === "number" && v >= 0 && v <= 255)) {
                return value;
            } else {
                throw new Error(`Heatmap: Invalid color scale function output: ${test}`);
            }
        } else {
            throw new Error(`Heatmap: Invalid color scale function value: ${value}`);
        }
    }   
    
    validate() {
        const {spacing, width, height, position: {x, y}, data, colorScale} = this;
        const rows = data.length;
        const cols = data[0].length;
        const ch = (height - spacing * (rows + 1)) / rows;
        const cw = (width - spacing * (cols + 1)) / cols;
        let rects = []
        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
                const value = data[i][j];
                if (typeof value === "number") {
                    const [r, g, b] = colorScale(value);
                    rects.push(Rect.make({
                        position: new Vector(
                            x + spacing + j * (cw + spacing),
                            y + spacing + i * (ch + spacing)
                        ),
                        width: cw,
                        height: ch,
                        styles: {
                            fill: `rgb(${r}, ${g}, ${b})`,
                            stroke: "none"
                        }
                    }))
                }
            }
        }
     
        rects.push(Rect.make({
            position: new Vector(x, y),
            width: width,
            height: height,
            styles: this.borderStyles
        }))

        this.rects = rects;
        
    }

    render() {
        return `<g>${this.rects.join("")}</g>`;
    }

}

class HeatmapPlot extends Renderable {
    data = [[]];
    static data_parser(value) {
        if (Array.isArray(value) && value.every(row => Array.isArray(row))) {
            return value;
        } else {
            throw new Error(`HeatmapPlot: Invalid data value: ${value}`);
        }
    }

    colorScale = COLORSCALES.red2green;
    static colorScale_parser(value) { 
        if (typeof value === "string") {
            if (value in COLORSCALES) {
                return COLORSCALES[value];
            } else {
                throw new Error(`HeatmapPlot: Invalid color scale function name: ${value}`);
            }
        } else if (value instanceof Function) {
            let test = value(0);
            if (Array.isArray(test) && test.length === 3 && test.every(v => typeof v === "number" && v >= 0 && v <= 255)) {
                return value;
            } else {
                throw new Error(`HeatmapPlot: Invalid color scale function output: ${test}`);
            }
        } else {
            throw new Error(`HeatmapPlot: Invalid color scale function value: ${value}`);
        }
    }

    title = "Heatmap Title";

    spacing = 0;

    borderRadius = 0;

    scaleWidth = 20;

    width = 400;
    height = 400;

    position = new Vector(0, 0)
    static position_parser(value) { return new Vector(value); }

    tickLineStyles = LineStyles.make();
    static tickLineStyles_parser(value) { return LineStyles.make(value); }

    gridLineStyles = LineStyles.make();
    static gridLineStyles_parser(value) { return LineStyles.make(value); }

    tickTextStyles = TextStyles.make();
    static tickTextStyles_parser(value) { return TextStyles.make(value); }

    labelTextStyles = TextStyles.make();
    static labelTextStyles_parser(value) { return TextStyles.make(value); }

    titleTextStyles = TextStyles.make();
    static titleTextStyles_parser(value) { return TextStyles.make(value); }

    tickXFormatFunction = (value) => value.toFixed(2);
    static tickXFormatFunction_parser(value) {
        if (typeof value === "string") {
            return (v) => value.replace("${value}", v.toFixed(1));
        } else if (value instanceof Function) {
            return value;
        } else {
            throw new Error(`HeatmapPlot: Invalid tick format function: ${value}`);
        }
    }

    tickYFormatFunction = null;
    static tickYFormatFunction_parser(value) {
        if (value === null) return null;
        if (typeof value === "string") {
            return (v) => value.replace("${value}", v.toFixed(1));
        } else if (value instanceof Function) {
            return value;
        } else {
            throw new Error(`HeatmapPlot: Invalid tick format function: ${value}`);
        }
    }   

    tickZFormatFunction = null;
    static tickZFormatFunction_parser(value) {
        if (value === null) return null;
        if (typeof value === "string") {
            return (v) => value.replace("${value}", v.toFixed(1));
        } else if (value instanceof Function) {
            return value;
        } else {
            throw new Error(`HeatmapPlot: Invalid tick format function: ${value}`);
        }
    }

    tickLength = 10;
    
    yAxisLabel = "Y Axis";
    xAxisLabel = "X Axis";
    zAxisLabel = "Z Axis";

    zMinValue = 0;
    zMaxValue = 1;
    zTickIncrements = 10;

    portrait = true;

    get size() {
        return this._renderable.size;
    }

    get pos() {
        return this._renderable.pos;
    }


    validate() {
        const {textStyles, axisLabelFontSize} = this;
        const rows = this.data.length;
        const cols = this.data[0].length;

        const heatmap = HeatmapGrid.make({
            position: this.position,
            width: this.width,
            height: this.height,
            data: this.data,
            colorScale: this.colorScale,
            spacing: this.spacing,
            borderRadius: this.borderRadius,
            borderStyles: this.gridLineStyles
        });

        const axisX = Axis.make({
            position: this.position,
            axisLength: this.width,
            tickLength: this.tickLength,
            portrait: false,
            tickIncrements: this.data[0].length/2,
            tickLineStyles: this.tickLineStyles,
            tickTextStyles: this.tickTextStyles,
            tickFormatFunction: this.tickXFormatFunction
        })
        const axisY = Axis.make({
            position: this.position,
            axisLength: this.height,
            tickLength: this.tickLength,
            portrait: true,
            tickIncrements: this.data.length/2 ,
            tickLineStyles: this.tickLineStyles,
            tickTextStyles: this.tickTextStyles,
            tickFormatFunction: this.tickYFormatFunction || this.tickXFormatFunction
        })

        const yAxisLabel = Text.make({
            content: this.yAxisLabel,
            position: [
                axisY.pos.x - this.tickLength,
                axisY.pos.y + axisY.size.y / 2
            ],
            anchor: "center-bottom",
            rotation: -90,
            styles: this.labelTextStyles
        });

        const xAxisLabel = Text.make({
            content: this.xAxisLabel,
            position: [
                axisX.pos.x + axisX.size.x / 2,
                axisX.pos.y - this.tickLength
            ],
            anchor: "center-bottom",
            styles: this.labelTextStyles
        });

        const grid = Grid.make({
            xPositions: new Array(cols+1).fill(0).map((_, i) => this.width * i / (cols)),
            yPositions: new Array(rows+1).fill(0).map((_, i) => this.height * i / (rows)),
            position: this.position,
            width: this.width,
            height: this.height,
            styles: this.gridLineStyles,
        });

        const colorScaleLegend = ColorScaleLegend.make({
            colorScale: {
                width: this.portrait ? this.width : this.scaleWidth,
                height: this.portrait ? this.scaleWidth : this.height,
                scaleFunction: (t) => this.colorScale(1-t),
                position: this.portrait ? [
                    heatmap.pos.x,
                    axisY.pos.y + axisY.size.y + this.tickLength
                ] : [
                    axisX.pos.x + axisX.size.x + this.tickLength,
                    heatmap.pos.y 
                ],
                portrait: !this.portrait,
            },
            flipTickSide: true,
            minValue: this.portrait ? this.zMinValue : this.zMaxValue,
            maxValue: this.portrait ? this.zMaxValue : this.zMinValue,
            tickIncrements: this.zTickIncrements,
            tickTextStyles: this.tickTextStyles,
            tickLineStyles: this.tickLineStyles,
            tickFormatFunction: this.tickZFormatFunction || this.tickXFormatFunction
        })

        const zAxisLabel = Text.make({
            content: this.zAxisLabel,
            position: this.portrait ? [
                colorScaleLegend.pos.x + colorScaleLegend.size.x / 2,
                colorScaleLegend.pos.y + colorScaleLegend.size.y + this.tickLength
            ] : [
                colorScaleLegend.pos.x + colorScaleLegend.size.x + this.tickLength,
                colorScaleLegend.pos.y +  colorScaleLegend.size.y / 2
            ],
            anchor: this.portrait ? "center-top" : "center-bottom",
            rotation: this.portrait ? 0 : 90,
            styles: this.labelTextStyles
        });

        const title = Text.make({
            content: this.title,
            position: [
                xAxisLabel.pos.x + xAxisLabel.size.x / 2,
                xAxisLabel.pos.y - this.tickLength - xAxisLabel.size.y /3
            ],
            anchor: "center-bottom",
            styles: this.titleTextStyles
         })

        this._renderable = Group.make({
            children: [
                heatmap, axisX, axisY, xAxisLabel, yAxisLabel, grid, colorScaleLegend, title,
                 zAxisLabel
            ]
        });



    }

    render() {
        return this._renderable.render();   
    }

}



// let data = new Array(10).fill(0).map(() => new Array(20).fill(0).map(() => Math.random()));

// let portrait = false;

// let titleFontSize = 20;
// let axisLabelFontSize = 14;
// let textStyles = {
//     fontFamily: "Supreme LL TT",
//     fontSize: 10,
// }

// let hmap = Heatmap.make({
//     position: new Vector(0, 0),
//     width: 400,
//     height: 200,
//     spacing: 0,
//     data,
// });

// let scale = ColorScaleLegend.make({
//     colorScale: {
//         position: portrait ? 
//             [hmap.width + 10, 0] : [0, hmap.height + 10],
//         width: portrait ? 20 : hmap.width,
//         height: portrait ? hmap.height : 20,
//         portrait: portrait,
//     },
//     flipTickSide: true,
//     tickIncrements: 5,
//     tickTextStyles: textStyles,
// })

// let ticks = TickAxis.make({
//     position: [0,0],
//     axisLength: 200,
//     tickLength: 10,
//     portrait: true,
//     tickIncrements: 5,
//     tickTextStyles: textStyles
// })

// let ticks2 = TickAxis.make({
//     position: [0,0],
//     axisLength: 400,
//     tickLength: 10,
//     tickSpace: 0,
//     portrait: false,
//     tickTextStyles: textStyles
// })

// let label1 = Text.make({
//     content: "Vertical Axis",
//     position: [
//         ticks.pos.x - 5,
//         ticks.pos.y + ticks.size.y / 2
//     ],
//     anchor: "center-bottom",
//     rotation: -90,
//     styles: {...textStyles, fontSize: axisLabelFontSize}
// });

// let label2 = Text.make({
//     content: "Horizontal Axis",
//     position: [
//         ticks2.pos.x + ticks2.size.x / 2,
//         ticks2.pos.y - 5
//     ],
//     anchor: "center-bottom",
//     styles: {...textStyles, fontSize: axisLabelFontSize}
// });

// let title = Text.make({
//     content: "Heatmap Title",
//     position: [
//         ticks2.pos.x + ticks2.size.x / 2,
//         label2.pos.y - 5
//     ],
//     anchor: "center-bottom",
//     styles: {...textStyles, fontSize: titleFontSize}
// })


// let g = Group.make({children: [
//     scale, hmap, ticks, ticks2, label1, label2, title
// ]})


export {
    HeatmapPlot,
    ColorScaleLegend,
    ColorScaleImage,
    HeatmapGrid,
    COLORSCALES
}