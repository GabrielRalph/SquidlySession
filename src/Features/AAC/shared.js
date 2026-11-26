
function isEqual(obj1, obj2) {
    if (typeof obj1 !== typeof obj2) return false;
    if (obj1 && obj2 && typeof obj1 === 'object') {
        const keys1 = Object.keys(obj1);
        const keys2 = Object.keys(obj2);
        if (keys1.length !== keys2.length) return false;
        for (let key of keys1) {
            if (!isEqual(obj1[key], obj2[key])) return false;
        }
        return true;
    }
    return obj1 === obj2;
}

/**
 * Creates a deep copy of the given object.
 * @template {Object} T
 * @param {T} obj
 * @returns {Partial<T>} a deep copy of the object
 */
function copy(obj) {
    if (obj && typeof obj === 'object') {
        if (obj.clone instanceof Function || obj.copy instanceof Function) {
            return obj.clone ? obj.clone() : obj.copy();
        }
        const c = Array.isArray(obj) ? [] : {};
        for (let key in obj) {
            c[key] = copy(obj[key]);
        }
        return c;
    }
    return obj;
}





export { isEqual, copy };