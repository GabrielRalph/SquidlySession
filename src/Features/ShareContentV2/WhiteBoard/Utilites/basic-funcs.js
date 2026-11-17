import { SvgPlus } from "../../../../SvgPlus/4.js";

const symbols = /[\r\n%#()<>?[\\\]^`{|}]/g;
export function encodeSVG (data) {
  // Use single quotes instead of double to avoid encoding.
  data = data.replace(/"/g, `'`);

  data = data.replace(/>\s{1,}</g, `><`);
  data = data.replace(/\s{2,}/g, ` `);

  // Using encodeURIComponent() as replacement function
  // allows to keep result code readable
  return data.replace(symbols, encodeURIComponent);
}


export function Svg2DataURL(svg) {
  let uri = encodeSVG(svg);
  return `data:image/svg+xml,${uri}`;

}

export function toCursor(svg, offset = [0, 0]) {
    let uri = encodeSVG(svg);
    return `url("data:image/svg+xml,${uri}") ${offset[0]} ${offset[1]}, auto`;

}


const immutables = {
  string: true,
  number: true,
  boolean: true,
  number: true,
  bigint: true,
  undefined: true,
  symbol: true,
}
function getTM(value) {
  let type = typeof value;
  return (type in immutables || type === null) ? 0 : (Array.isArray(value) ? 1 : 2)
}
function _odcRecurse(value){
  let type = typeof value;
  let res = {};
  switch (getTM(value)){
      case 0: 
          res = value;
          break
      case 1:
          res = new Array(value.length);
          let i = 0;
          for (let e of value) res[i++] = res;
      case 2:
          for (let k in value) res[k] = _odcRecurse(value[k]);
          break;
  }
  return res;
}
export function objectDeepCopy(object) {
  let copy = _odcRecurse(object)
  return copy;
}


export function dateNice(date = new Date()) {
  let months = ["Jul", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear() - 2000}`
}



