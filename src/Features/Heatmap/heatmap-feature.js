import { Features } from "../features-interface.js";
import { DiscreteHeatmap } from "../../Utilities/discreteHeatmap.js";



const MODES = {
    mouse: 0,
    eyeGaze: 1,
    eyes: 1,
    "eye-gaze": 1,
    0: 0,
    1: 1
}

const MODE2NAME = {
    0: "Mouse",
    1: "Eye Gaze"
}

class DHeatmap extends DiscreteHeatmap {
    constructor(size, mode) {
        mode = mode in MODES ? MODES[mode] : MODES.mouse;
        super(size, mode);
    }
    isSameMode(mode) {
        return this.mode === (mode in MODES ? MODES[mode] : MODES.mouse);
    }
}

export default class HeatmapFeature extends Features {
    #heatmaps = {};
    constructor(...args) {
        super(...args);
        try {
            const pastHeatmaps = JSON.parse(window.localStorage.getItem("squidlySessionHeatmaps")) || {};
            for (let name in pastHeatmaps) {
                let heatmapData = pastHeatmaps[name];
                heatmapData.heatmap = DHeatmap.fromString(heatmapData.heatmap);
            }
            this.#heatmaps = pastHeatmaps;
        } catch (e) {}

        // Auto-save heatmaps every 30 seconds
        setInterval(() => this._saveHeatmaps(), 30000);

    }

    async initialise() {
        const userName = this.sdata.isHost ? "host" : "participant";
        for (let mode of ["mouse", "eyes"]) {
            this.session.cursors.addEventListener(userName+'-'+mode, (e) => {
                for (let name in this.#heatmaps) {
                    const {heatmap, viewPort} = this.#heatmaps[name];
                    if (heatmap.isSameMode(mode)) { 
                        const p = e.relativeTo(viewPort);
                        if (p) heatmap.addPoint(p.x, p.y);
                    }
                }
            });
        }
    }

    get heatmapList() {
        return Object.keys(this.#heatmaps)
    }

  
    _saveHeatmaps() {
        const data = JSON.stringify(this.#heatmaps);
        window.localStorage.setItem("squidlySessionHeatmaps", data);
    }

    /**
     * Create a new heatmap with the given name, mode, and size. 
     * Mode can be "mouse" or "eye-gaze". 
     * @param {String} name - The name of the heatmap
     * @param {String} mode - The mode of the heatmap ("mouse" or "eye-gaze")
     * @param {Number} size - The size of the heatmap (number of cells in each dimension)
     * @param {String} viewPort - The viewport to which the heatmap is relative ("fullAspectArea", "fixedAspectArea", etc.)
     */
    createHeatmap(name, mode = "mouse", size = 10, viewPort = "fullAspectArea") {
        let heatmap = new DHeatmap(size, mode);
        this.#heatmaps[name] = { heatmap, viewPort };
        this._saveHeatmaps();
    }

    /**
     * Get the heatmap data for the heatmap with the given name. 
     * Returns a 2D array of values, or null if the heatmap does not exist.
     * @param {String} name - The name of the heatmap
     * @return {Number[][]} A 2D array of heatmap values
     */
    getHeatmapData(name) {
        if (name in this.#heatmaps) {
            return this.#heatmaps[name].heatmap.data;
        } else {
            console.warn(`Heatmap with name ${name} does not exist.`);
            return null;
        }
    }

    /**
     * Remove the heatmap with the given name and return its data.
     * Returns a 2D array of values, or null if the heatmap does not exist.
     * @param {String} name - The name of the heatmap
     * @return {DHeatmap} 
     */
    popHeatmap(name) {
        let heatmap = null;
        if (name in this.#heatmaps) {
            heatmap = this.#heatmaps[name].heatmap
            delete this.#heatmaps[name];
        } else {
            console.warn(`Heatmap with name ${name} does not exist.`);
        }
        return heatmap;
    }

    #saveURI(name, uri) {
        const link = document.createElement('a');
        link.href = uri;
        link.download = name
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    saveHeatmapSVG(name) {
        console.warn("Saving heatmap as SVG.");
        const svgData = this.#heatmaps[name].heatmap.getSVG(window.innerWidth / window.innerHeight);
        const blob = new Blob([svgData], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        this.#saveURI(name + ".svg", url);
    }

    saveHeatmapImage(name) {
        console.warn("Saving heatmap as image.");
        const uri = this.#heatmaps[name].heatmap.imageURI;
        this.#saveURI(name + ".png", uri);
    }


    static get name() {
        return "heatmaps"
    }

    static get firebaseName(){
        return "heatmaps";
    }
}