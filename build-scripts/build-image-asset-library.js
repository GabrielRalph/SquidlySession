import fs from 'fs';
import path from 'path';

function isDir(path) {
    return fs.lstatSync(path).isDirectory();
}
function isImg(path) {
    return ['.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(path.slice(-4).toLowerCase());
}

export function buildImageAssetLibrary(rootPath) {

    let imageList = []
    let build = (dir) => {
        const folder = {}
        let files = fs.readdirSync(dir);
        for (let file of files) {
            let fullPath = path.join(dir, file);
            if (isDir(fullPath)) {
                folder[file] = build(fullPath, file);
            } else if (isImg(fullPath)) {
                const fileName = file.split('.').slice(0, -1).join('.'); // remove extension
                const pathRelToRoot = path.relative(rootPath, fullPath);
                imageList.push(pathRelToRoot.split(".").slice(0, -1).join('.')); // add to image list without extension
                folder[fileName] = `relURL('./${pathRelToRoot.replace(/\\/g, '/')}', import.meta)`;
            }
        }
        return folder;
    }
    
    let folder = build(rootPath);
    
    let toString = (obj, indent = '') => {
        let str = '{\n';
        for (let key in obj) {
            str += `${indent}  '${key}': ${typeof obj[key] === 'string' ? obj[key] : toString(obj[key], indent + '  ')},\n`;
        }
        str += `${indent}}`;
        return str;
    }

    let jsModule = `import {relURL} from "../usefull-funcs.js"\n\nexport default ${toString(folder)};`;
    
    fs.writeFileSync(path.join(rootPath, 'image-library.js'), jsModule);

    console.log(`Image asset list:\n\t${imageList.join("\n\t")}`);
}
