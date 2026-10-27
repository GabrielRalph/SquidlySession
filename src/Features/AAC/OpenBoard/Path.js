
const PATH_SEPERATOR = "\\"

class Path {
    #parts = [];
    #path = "";

    /**
     * @param {string} path the string representation of the path
     */
    constructor(path, throwError = false) {
        path = path instanceof Path ? path.path : path;

        let pathString = path;
        let parts = [];
        if (path instanceof Path) {
            parts = path.parts;
            pathString = path.path;
        } if (Array.isArray(path)) {
            parts = path.map(p => String(p)).filter(p => p.length > 0);
            pathString = parts.join(PATH_SEPERATOR);
        } else if (typeof path !== "string" || path.length === 0) {
            if (throwError) {
                throw new Error("Path must be a non-empty string");
            } else {
                pathString = "";
            }
        } else {
            parts = path.split(PATH_SEPERATOR).filter(p => p.length > 0);
            path = parts.join(PATH_SEPERATOR);
        }

        this.#parts = parts
        this.#path = pathString ?? "";
    }

    /**
     * @returns {string} the string representation of the path
     */
    get path() {
        return this.#path;
    }

    /**
     * @returns {string[]} the parts of the path as an array of strings
     */
    get parts() {
        return [...this.#parts];
    }

    /**
     * @returns {number} the number of parts in the path
     */
    get length() {
        return this.#parts.length;
    }

    /**
     * @returns {string} the name of the last part of the path
     */
    get name() {
        return this.#parts[this.#parts.length - 1] || "";
    }

    /**
     * @returns {?Path} 
     */
    get parent() {
        let parent = null;
        if (this.#parts.length > 0) {
            const parentPathArray = this.#parts.slice(0, this.#parts.length - 1);
            parent = new Path(parentPathArray);
        }
        return parent;
    }

    get isRoot() {
        return this.#parts.length === 0;
    }

    /**
     * @param {string|Path} other the other path to join with this path
     * @returns {Path} a new Path object representing the joined path
     */
    join(other) {
        if (!(other instanceof Path)) {
            other = new Path(other);
        }
        return new Path([...this.#parts, ...other.parts]);
    }

    /**
     * @param {string|Path} otherPath the other path to check if it is contained within this path
     * @returns {boolean} true if the other path is contained within this path, false otherwise
     */
    contains(otherPath) {
        if (!(otherPath instanceof Path)) {
            otherPath = new Path(otherPath);
        }
        return this.#parts.every((p, i) => otherPath.parts[i] === p);
    }

    isParentOf(otherPath) {
        if (!(otherPath instanceof Path)) {
            otherPath = new Path(otherPath);
        }
        return this.#parts.length < otherPath.parts.length && this.contains(otherPath);
    }

    relative(otherPath) {
        otherPath = Path.parse(otherPath);
        if (!otherPath.isParentOf(this)) {
            throw new Error(`Path ${otherPath.path} is not a descendant of ${this.path}`);
        }
        return this.slice(otherPath.length)
    }

    same(otherPath) {
        if (!(otherPath instanceof Path)) {
            otherPath = new Path(otherPath);
        }
        return this.#path === otherPath.path;
    }

    /**
     * @param {...number} args the arguments to slice the path parts
     * @returns {Path} a new Path object representing the sliced path
     * 
     * Example:
     * let path = new Path("folderA\\subfolderA\\file1.txt");
     * let slicedPath = path.slice(0, 2); // returns a new Path object with path "folderA\\subfolderA"
     */
    slice(...args) {
        let slicedParts = this.#parts.slice(...args);
        return new Path(slicedParts.join(PATH_SEPERATOR));
    }

    /**
     * @returns {string} the string representation of the path
     */
    toString() {
        return this.path;
    }

    /**
     * Returns the JSON representation of the path, which is the same as its string representation.
     * @returns {string} the JSON representation of the path
     */
    toJSON() {
        return this.toString();
    }

    /**
     * @returns {Path} a new Path object that is a clone of this path
     */
    clone() {
        return new Path(this.path);
    }


    static parse(path, throwError = false) {
        if (path instanceof Path) {
            return path;
        } else {
            return new Path(path, throwError);
        }
    }
}

export { Path, PATH_SEPERATOR };