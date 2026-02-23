import terser from '@rollup/plugin-terser';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { get } from 'http';

const outputDir = 'build';

function colorText(text, hue) {
    return `\x1b[38;5;${hue}m${text}\x1b[0m`;
}




function getURLSFromCSS(css) {
    let urls = [];
    let matches = css.matchAll(/url\(/g);
    for (let match of matches) {
        let idx = match.index + 4; // position after 'url('
        let char = css[idx];
        idx = char === '"' || char === "'" ? idx + 1 : idx; // skip opening quote if present
        let closeChar = char === '"' || char === "'" ? char : ')';
        for (let i = idx; i < css.length; i++) {
            if (css[i] === closeChar) {
                urls.push({url: css.substring(idx, i), index: match.index});
                break;
            }
        }
    }
    return urls;
}

function relURLAssetPlugin({ srcDir = 'src', outDir = 'build/assets' } = {}) {
    const fileMap = {};
    const cssAssetMap = {};
    const cssToProcess = [];
    return {
        name: 'relurl-asset-plugin',

        transform(code, id) {
            // console.log("Transforming:", id);
            let newCode = code;

            // Only transform JS modules in srcDir
            if (id.startsWith(path.resolve(srcDir))) {
                newCode = code.replace(
                    /relURL\(\s*['"](.+?)['"]\s*,\s*import\.meta\s*\)/g,
                    (value, origPath) => {
                        // For each matched relURL call
                        const absPath = path.resolve(path.dirname(id), origPath.replace(/^(\.\/|\/)/, ''));
                        
                        // Check if file exists
                        if (fs.existsSync(absPath)) {
                         
                            // If we've already processed this file, reuse the new path
                            if (absPath in fileMap) {
                                console.log(`${colorText("Reusing asset", 202)}: ${fileMap[absPath]}`);
                                value = fileMap[absPath];

                            // Otherwise if the file is a JS module, we will emit it.
                            } else if (absPath.endsWith('.js')) {
                                let id = this.emitFile({
                                    type: 'chunk',
                                    id: absPath,
                                    name: path.basename(origPath, '.js')
                                });
                                value = `import.meta.ROLLUP_FILE_URL_${id}`;
                                fileMap[absPath] = value;
                                console.log(`${colorText("Emitted JS asset", 118)}: ${origPath} -> ${value}`);
                            
                                // Otherwise the file exists, is not a JS module, 
                            // and we haven't processed it yet, so we copy it
                            // to the output directory with a hashed name.
                            } else if (absPath.endsWith(".css")) {
                                let cssFile = fs.readFileSync(absPath, 'utf8');

                                // Get urls that link to other assets in the CSS file.
                                let urls = getURLSFromCSS(cssFile);
                                urls = urls.filter(({url}) => 
                                    !(url.startsWith('data:') || url.startsWith("#") || url.startsWith('http://') || url.startsWith('https://')) &&
                                    fs.existsSync(path.resolve(path.dirname(absPath), url))
                                );

                                let urlMap = {};
                                if (urls.length > 0) {
                                    console.log(`${colorText("Processing CSS asset", 111)}: ${urls.map(u => u.url).join(', ')}`);
                                    for (let {url} of urls) {
                                        let assetPath = path.resolve(path.dirname(absPath), url);
                                        
                                        let id;
                                        if (!(assetPath in cssAssetMap)) {
                                            id = this.emitFile({    
                                                type: 'asset',
                                                name: path.basename(assetPath),
                                                source: fs.readFileSync(assetPath),
                                            });
                                        } else {
                                            id = cssAssetMap[assetPath];
                                        }
                                        urlMap[url] = id;
                                    }
                                    
                                }

                                let id = this.emitFile({
                                    type: 'asset',
                                    name: path.basename(origPath),
                                    source: cssFile,
                                    ext: '.css'
                                });
                                value = `import.meta.ROLLUP_FILE_URL_${id}`;
                                fileMap[absPath] = value;

                                if (urls.length > 0) {
                                    cssToProcess.push({
                                        cssFile,
                                        urlMap,
                                        absPath,
                                        origPath,
                                        id
                                    });
                                }

                            } else {
                                let id = this.emitFile({
                                    type: 'asset',
                                    name: path.basename(origPath),
                                    source: fs.readFileSync(absPath),
                                    ext: path.extname(origPath)
                                });
                                value = `import.meta.ROLLUP_FILE_URL_${id}`;
                                fileMap[absPath] = value;
                                // let file = fs.readFileSync(absPath);
                                // const oldName = path.basename(origPath);
                                
                                // const randId = crypto.randomBytes(6).toString('hex'); // 12-char hex
                                // const newFileName = `${randId}-${oldName}`;
                                // newRelPath = `'./assets/${newFileName}'`;
                                // value = `relURL(${newRelPath}, import.meta)`;
                                // fileMap[absPath] = value;

                                // // Copy file to output dir
                                // if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
                                // fs.writeFileSync(path.join(outDir, newFileName), file);
                                console.log(`${colorText("Coppied asset", 212)}: ${origPath} -> ${value}`);
                            }

                            
                        } else {
                            console.warn(`relURL asset not found: ${absPath}`);
                        }

                        return value;
                    }
                );
            }

            return {
                code: newCode,
                map: null
            };
        },
        generateBundle(_, bundle) {
            for (const {cssFile, urlMap, id} of cssToProcess) {
                const cssFileName = this.getFileName(id);
                let cssContent = cssFile;
                for (let url in urlMap) {
                    const assetId = urlMap[url];
                    const assetFileName = this.getFileName(assetId);
                    const relPath = path.relative(path.dirname(cssFileName), assetFileName);
                    cssContent = cssContent.replace(url, relPath);
                    console.log(`${colorText("Updated CSS asset URL", 213)}: ${url} -> ${assetFileName} in ${cssFileName}`);
                }

                if (bundle[cssFileName]) {
                    bundle[cssFileName].source = cssContent;
                }
            }
        }
    };
}

// Delete all files in dist (synchronously)
if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
}

export default {
    input: 'src/squidly-session.js',
    output: {
        dir: outputDir,
        format: 'es',
        plugins: [
			terser({
				mangle: {
					toplevel: true
				},
				compress: {
					passes: 3,
					pure_getters: true,
					unsafe: true
				},
				format: {
					comments: false
				}
			})
		]
    },
    plugins: [
        relURLAssetPlugin(),
    ]
};
