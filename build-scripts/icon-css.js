import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const REMOVE_ATTRS = [
  "version",
  "class",
  "data-name",
  "version",
  "xml:space",
  "enable-background",
];

function stripCommentsAndDeclarations(svg) {
  return svg
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!doctype[\s\S]*?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

function stripNonEssentialAttrs(svg) {
  let out = svg;

  for (const attr of REMOVE_ATTRS) {
    const attrPattern = new RegExp(`\\s${attr}=("[^"]*"|'[^']*')`, "gi");
    out = out.replace(attrPattern, "");
  }

  // Root width/height are usually unnecessary for viewBox-driven data-uri icons.
  out = out.replace(/<svg\b([^>]*?)\swidth=("[^"]*"|'[^']*')/i, "<svg$1");
  out = out.replace(/<svg\b([^>]*?)\sheight=("[^"]*"|'[^']*')/i, "<svg$1");

  // Remove extra whitespace between tags and trim.
  out = out.replace(/>\s+</g, "><").trim();

  return out;
}

function toDataUri(svg) {
  const compact = svg.replace(/\s+/g, " ").trim();

  // Minimal escaping for CSS url('...') data URIs:
  // keep SVG markup readable, only escape characters that commonly break CSS/url parsing.
  const escaped = compact
    .replace(/%/g, "%25")
    .replace(/#/g, "%23")
    .replace(/'/g, "%27")
    .replace(/\r?\n/g, " ");

  return `data:image/svg+xml,${escaped}`;
}

// Returns the outer markup of the element starting at `start`, matching nested <g> tags.
function extractGroup(svg, start) {
  const tagPattern = /<(\/?)g\b[^>]*?(\/?)>/gi;
  tagPattern.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tagPattern.exec(svg))) {
    const [, closing, selfClosing] = match;
    if (closing) depth--;
    else if (!selfClosing) depth++;
    if (depth === 0) return svg.slice(start, tagPattern.lastIndex);
  }
  throw new Error("Unbalanced <g> tags in SVG");
}

// Splits an SVG containing <g id="CLayer_N"> groups into one SVG per layer.
// Each layer SVG reuses the root <svg> tag (and so the viewBox) and any <defs>.
function extractColorLayers(svg) {
  const layerPattern = /<g\b[^>]*\bid=["']CLayer[_\s]*(\d+)["'][^>]*>/gi;
  const layers = [];
  let match;
  while ((match = layerPattern.exec(svg))) {
    const group = extractGroup(svg, match.index);
    layers.push({ index: Number(match[1]), group });
    layerPattern.lastIndex = match.index + group.length;
  }
  if (layers.length === 0) return [];

  const rootTag = svg.match(/<svg\b[^>]*>/i)[0];
  const defs = (svg.match(/<defs\b[\s\S]*?<\/defs>/gi) || []).join("");

  return layers
    .sort((a, b) => a.index - b.index)
    .map(({ group }) => `${rootTag}${defs}${group}</svg>`);
}

function varNameFromFile(fileName) {
  const base = fileName.replace(/\.svg$/i, "");
  return base.replace(/^i_/g, "");
}

async function createIconCSS(dir, outName = "icons.css") {
  const outFile = path.join(dir, outName);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const svgFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".svg"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (svgFiles.length === 0) {
    throw new Error(`No SVG files found in ${dir}`);
  }

  const declarations = [];
  const defs = [];
  let maxLayers = 0;
  for (const fileName of svgFiles) {
    const absPath = path.join(dir, fileName);
    const raw = await fs.readFile(absPath, "utf8");
    const cleaned = stripNonEssentialAttrs(stripCommentsAndDeclarations(raw));

    // Write cleaned SVG back to disk so source files stay optimized.
    await fs.writeFile(absPath, `${cleaned}\n`, "utf8");

    const varName = varNameFromFile(fileName);

    const layers = extractColorLayers(cleaned);
    maxLayers = Math.max(maxLayers, layers.length);
    if (layers.length === 0) {
      const dataUri = toDataUri(cleaned);
      declarations.push(`    --i-${varName}: url('${dataUri}');`);
      defs.push(`[i="${varName}"] { --i-bg: var(--i-${varName}); }`);
      continue;
    }

    let toSX = (i) => i == 0 ? "" : "_" + i; 
    layers.forEach((svg, index) => {
      declarations.push(`    --i-${varName}${toSX(index)}: url('${toDataUri(svg)}');`);
    });

    defs.push([
      `[i="${varName}"] {`,
      `    --layers: ${layers.length};`,
          ...layers.map((_, index) => 
            `    --i-bg${toSX(index)}: var(--i-${varName}${toSX(index)});`
          ),
      "}",
    ].join("\n"));
  }

  if (maxLayers > 1) {
    // Layered icons draw every layer (including layer 0) as a child <i>, so the
    // parent must not mask, otherwise it would clip the other layers.
    defs.push(`i-bw:has(> i) { mask-image: none; background-color: transparent; }`);
    defs.push(`i-bw > i:nth-child(1) { mask-image: var(--i-bg); }`);
    defs.push(new Array(maxLayers - 1).fill(0).map(
      (_, i) => `i-bw > i:nth-child(${i + 2}) { background-color: var(--i-color-${i + 1}, black); mask-image: var(--i-bg_${i + 1}); }`).join("\n")
    );
  }

  const css = [
    "/* Auto-generated by build-icons-css.mjs. Do not edit manually. */",
    ":root, :host {",
    ...declarations,
    "}",
    "",
    ...defs,
`i-bw {
    background-color: currentColor;
    mask-image: var(--i-bg);
    display: inline-block;
    width: 1.2em;
    height: 1.2em;
    mask-position: center;
    mask-size: contain;
    mask-repeat: no-repeat;
    position: relative;
}
i-bw::after, i-bw::before, i-bw > i {
    display: inline-block;
    mask-position: center;
    mask-size: contain;
    mask-repeat: no-repeat;
    background-color: currentColor;
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
}

i-c {
    background-image: var(--i-bg);
    display: inline-block;
    width: 1.2em;
    height: 1.2em;
    background-position: center;
    background-size: contain;
    background-repeat: no-repeat;
}`
  ].join("\n");

  await fs.writeFile(outFile, css, "utf8");

  console.log(`Updated ${path.relative(__dirname, outFile)} with ${svgFiles.length} SVG icons.`);
}


async function buildIconCSSLibraries() {
    console.log("Building icon CSS libraries...");

    // search recursively for directories that begin with ICSS_
    const rootDir = path.join(__dirname, "..");
    const entries = await fs.readdir(rootDir, { withFileTypes: true, recursive: true });
    const icssDirs = entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("ICSS_"))
        .map((entry) => path.join(entry.parentPath, entry.name));

    await Promise.all(icssDirs.map(async (dir) => {
        try {
            await createIconCSS(dir);
        } catch (err) {
            console.error(`Failed to create icon CSS for directory ${dir}, ${err}`);
        }
    }));
}

export {buildIconCSSLibraries}
