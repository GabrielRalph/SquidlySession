import { isEqual } from "../shared.js";

async function loadFile(url, type = "text", onprogress = () => {}) {
    if (!(onprogress instanceof Function)) {
        onprogress = () => {};
    }
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", url);
        xhr.responseType = type;
        onprogress(0);
        xhr.onprogress = (e) => {
            if (e.lengthComputable) {
                const percent = e.loaded / e.total;
                onprogress(percent);
            }
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                let result = xhr.response;
                onprogress(1);
                resolve(result);
            } else {
                reject(new Error(`Failed to load file from ${url}: ${xhr.status} ${xhr.statusText}`));
            }
        };
        xhr.onerror = () => reject(new Error(`Network error while loading file from ${url}`));
        xhr.send();
    });
}

function array2D(rows, columns, fillValue = null) {
    let func = fillValue instanceof Function ? fillValue : () => fillValue;
    const order = Array.from({length: rows}, (_, r) => Array.from({length: columns}, (_, c) => fillValue(r, c)));
    return order;
}

function findFirstDifference(obj1, obj2, path = "") {
    if (typeof obj1 !== typeof obj2) {
        return [path, obj1, obj2];
    }

    if (obj1 && obj2 && typeof obj1 === 'object') {
        const keys1 = Object.keys(obj1);
        const keys2 = Object.keys(obj2);
        if (keys1.length !== keys2.length) {
            return [path, obj1, obj2];
        }

        for (let key of keys1) {
            let res = findFirstDifference(obj1[key], obj2[key], path ? `${path}.${key}` : key);
            if (res) return res;
        }
        return null;
    }

    return obj1 === obj2 ? null : [path, obj1, obj2];
}



 

class DataClass {
    /**
     * Creates an instance of the class and populates its properties based on the provided arguments object.
    * @template {DataClass} T
    * @this {new() => T}
    * @param {Partial<T>} argsObject
    * @returns {T}
    */
    static make(argsObject) {
        const instance = new this();
        for (const key in instance) {
            if (!(instance[key] instanceof Function)) {
                if (key in argsObject) {
                    let parser = key + "_parser";
                    if (parser in this && this[parser] instanceof Function) {
                        instance[key] = this[parser](argsObject[key]);
                    } else {
                        instance[key] = argsObject[key];
                    }
                } else if (instance[key] === undefined) {
                    throw new Error(`${this.constructor.name}: Missing required property: ${key}`);
                }
            }
        }

        if ("validate" in instance && instance.validate instanceof Function) {
            instance.validate();
        }
        return instance;
    }


    /**
     * Creates an instance of the class and populates its properties based on the provided arguments object.
    * @template {DataClass} T
    * @this {new() => T}
    * @param {string} url - The URL to load the data from, which should return a JSON object.
    * @param {function(number):void} onprogress - An optional callback function that receives progress updates as a number between 0 and 1.
    * @returns {Promise<T>}
    */
    static async load(url, onprogress) {
        const data = await loadFile(url, "json", onprogress);
        return this.make(data);
    }

    toJSON() {
        let json = {}
        let blank = new this.constructor();
        for (let key in this) {
            let value = this[key];
            if (!(value instanceof Function)) {
                let defaultValue = DataClass.toJSON(blank[key]);
                value = DataClass.toJSON(value);
                if (defaultValue === undefined || !isEqual(value, defaultValue)) {
                    json[key] = value;
                }
            }
        }
        return json;
    }

    static toJSON(object) {
        if (object instanceof DataClass) {
            return object.toJSON();
        } else if (Array.isArray(object)) {
            return object.map(item => this.toJSON(item));
        } else if (object && typeof object === 'object') {
            if (object.toJSON instanceof Function) {
                return object.toJSON();
            } else {
                let json = {};
                for (let key in object) {
                    json[key] = this.toJSON(object[key]);
                }
                return json;
            }
        } else {
            return object;
        }
    }

    same(other) {
        return isEqual(this, other);
    }

    diff(other) {
        return findFirstDifference(this, other);
    }
}


export { DataClass, loadFile, array2D, findFirstDifference };