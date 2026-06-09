import { hsl2rgb } from "./usefull-funcs.js";
import { HeatmapPlot } from "./Plots/heatmap.js";

export class DiscreteHeatmap {
    #size = [1,1];
    #data = [[0]];
    #changes = {};
    #mode = 0;
    constructor(size, mode) {
        this.#size = [size, size];
        this.#data = new Array(size).fill(0).map(() => new Array(size).fill(0));
        this.#mode = typeof mode == "number" ? mode : 0;
    }

    get size() {
        return [...this.#size];
    }

    get data() {
        return this.#data.map(row => [...row]);
    }

    get mode() {
        return this.#mode;
    }

    get bytes() {
        const flatData = this.#data.flat();
        const u32 = new Uint32Array([this.#mode, ...this.#size, ...flatData]);
        return new Uint8Array(u32.buffer)
    }

    get string() {
        const u8 = this.bytes;
        const base64String = btoa(String.fromCharCode(...u8));
        return base64String;
    }

    get maxValue() {
        let max = 0;
        for (let i = 0; i < this.#size[0]; i++) {
            for (let j = 0; j < this.#size[1]; j++) {
                if (this.#data[i][j] > max) max = this.#data[i][j];
            }
        }
        return max;
    }

    get sum() {
        let sum = 0;
        for (let i = 0; i < this.#size[0]; i++) {
            for (let j = 0; j < this.#size[1]; j++) {
                sum += this.#data[i][j];
            }
        }
        return sum;
    }

    get minNonZeroValue() {
        let min = Infinity;
        for (let i = 0; i < this.#size[0]; i++) {
            for (let j = 0; j < this.#size[1]; j++) {
                if (this.#data[i][j] > 0 && this.#data[i][j] < min) min = this.#data[i][j];
            }
        }
        return min === Infinity ? 0 : min;
    }
  
    addPoint(x, y, value = 1) {
        let xi = Math.round(x * (this.#size[0] - 1));
        let yi = Math.round(y * (this.#size[1] - 1));
        if (xi < 0) xi = 0;
        if (xi >= this.#size[0]) xi = this.#size[0] - 1;
        if (yi < 0) yi = 0;
        if (yi >= this.#size[1]) yi = this.#size[1] - 1;
        this.#data[yi][xi] += value;
    }

    getPoint(x, y) {
        let xi = Math.round(x * (this.#size[0] - 1));
        let yi = Math.round(y * (this.#size[1] - 1));
        if (xi < 0) xi = 0;
        if (xi >= this.#size[0]) xi = this.#size[0] - 1;
        if (yi < 0) yi = 0;
        if (yi >= this.#size[1]) yi = this.#size[1] - 1;
        return this.#data[yi][xi];
    }

    getIdx(i, j) {
        return this.#data[i][j];
    }

    toString() {
        return this.string;
    }

    toJSON(){
        return this.string;
    }

    clone() {
        const thisClass = this.constructor;
        const newHeatmap = new thisClass(this.#size[0], this.#mode);
        for (let i = 0; i < this.#size[0]; i++) {
            for (let j = 0; j < this.#size[1]; j++) {
                newHeatmap.#data[i][j] = this.#data[i][j];
            }
        }
        return newHeatmap;
    }

    add(heatmap) {
        if (heatmap.size[0] !== this.#size[0] || heatmap.size[1] !== this.#size[1]) {
            throw new Error("Heatmaps must be the same size to add");
        }
        const newHeatmap = this.clone();
        for (let i = 0; i < this.#size[0]; i++) {
            for (let j = 0; j < this.#size[1]; j++) {
                newHeatmap.#data[i][j] += heatmap.getIdx(i, j);
            }
        }
        return newHeatmap;
    }

    static fromBytes(bytes) {
        const u32 = new Uint32Array(bytes.buffer);
        const mode = u32[0];
        const size = [u32[1], u32[2]];
        const heatmap = new this(size[0], mode);
        for (let i = 0; i < size[0]; i++) {
            for (let j = 0; j < size[1]; j++) {
                heatmap.#data[i][j] = u32[3 + i * size[1] + j];
            }
        }
        return heatmap;
    }

    static fromString(string) {
        const binaryString = atob(string);
        const bytes = new Uint8Array([...binaryString].map(char => char.charCodeAt(0)));
        return this.fromBytes(bytes);
    }
    getSVG(aspectRatio, options = {
        spacing: 5,
        width: 300,
        borderRadius: 3,
        paddingX: 10,
        paddingY: 10,
        heatScaleWidth: 20,
        heatScaleGap: 10,
        scaleIncrements: 10,
        tickFontSize: 12,
        tickLineLength: 5,
        title: "Heatmap",
    }) {
        const W = options.width ?? 300;
        const H = W / aspectRatio;
        const spacing = options.spacing ?? 3;
        const borderRadius = options.borderRadius ?? 5;
        const paddingX = options.paddingX ?? 10;
        const paddingY = options.paddingY ?? paddingX;
        const scaleWidth = options.heatScaleWidth ?? 20;
        const colorScale = options.colorScale;
        const min = this.minNonZeroValue;
        const max = this.maxValue;
        let norm = this.data.map(row => row.map(value => value / max));
        let g = HeatmapPlot.make({
            data: norm,
            width: W,
            height: H,
            borderRadius,
            spacing,
            scaleWidth,
            portrait: aspectRatio < 1,
            yAxisLabel: "Relative Screen Y",
            xAxisLabel: "Relative Screen X",
            zAxisLabel: "Relative Frequency",
            title: options.title ?? "Heatmap",
            titleTextStyles: {fontSize: 20, fill: "#000"},
            tickXFormatFunction: value => (value * 100).toFixed(0) + "%",
            tickZFormatFunction: value => value.toFixed(2),
        });

        let str =  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${g.boundingBox.pad(paddingX, paddingY)}">
            ${g}
        </svg>`

        return str;
    }
    
    get imageURI() {
        const [w, h] = this.size;
        const max = this.maxValue;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(w, h);
        const data = this.data;
        for (let i = 0; i < w; i++) {
            for (let j = 0; j < h; j++) {
                const value = data[i][j];
                let [r,g,b,a] = [0,0,0,0];
                if (value > 0) {
                    [r,g,b] = hsl2rgb(200 * data[i][j] / max, 100, 50);
                    a = 255;
                }
                imageData.data[(j * w + i) * 4 + 0] = r; // R
                imageData.data[(j * w + i) * 4 + 1] = g; // G
                imageData.data[(j * w + i) * 4 + 2] = b; // B
                imageData.data[(j * w + i) * 4 + 3] = a; // A
            }
        }
        ctx.putImageData(imageData, 0, 0);

        return canvas.toDataURL();
    }

}
