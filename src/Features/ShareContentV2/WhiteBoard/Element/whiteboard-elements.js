import TextShapes from "./text-shapes.js";
import BasicShape from "./basic-shape.js";
import PenPath from "./PathElements/pen-path.js";
import StraightLine from "./PathElements/straight-line.js";
import ElbowPath from "./PathElements/elbow-path.js";

const elementModules = [
    TextShapes,
    BasicShape,
    PenPath,
    StraightLine,
    ElbowPath,
]

/** Element classes keyed by their static name, e.g. "pen-path" */
const Elements = {};
for (let mod of elementModules) {
    for (let element of Array.isArray(mod) ? mod : [mod]) {
        Elements[element.name] = element;
    }
}

export {Elements}
