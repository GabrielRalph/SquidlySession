import { GridCard, GridLayout } from "../../Utilities/GridLayout/grid-icons.js";

const D2R = Math.PI / 180;
function segPath(theta1, theta2, r, segsPerDeg = 0.05) {
    if (theta2 <= theta1) return [[0,0]];
    let segs = Math.ceil((theta2 - theta1) * segsPerDeg);
    let angles = new Array(segs +1).fill(0).map(
        (_, i) => theta1 + (i/segs) * (theta2 - theta1) 
    );
    let points = angles.map(a => [r * Math.cos(a*D2R), -r * Math.sin(a*D2R)]);
    return [[0,0], ...points, [0,0]]
}
function segPathS(theta1, theta2, r, segsPerDeg = 0.05) {
    return segPath(theta1, theta2, r, segsPerDeg).map(p => p.join(' ')).join(' ');
}

const timer_svg = (t) => `
<svg viewBox="-75 -75 150 100" xmlns="http://www.w3.org/2000/svg" version="1.1">
  <defs>
    <clipPath id="timer-clip-path">
      <polygon points="${segPathS(180 * t, 180, 200)}" style="fill: none;"/>
    </clipPath>
    <g id = "timer">
        <path d="M-62.263,13.751c-.974-4.429-1.487-9.03-1.487-13.751,0-35.208,28.542-63.75,63.75-63.75S63.75-35.208,63.75,0c0,4.721-.513,9.322-1.487,13.751" style="fill: none; stroke: #000; stroke-linecap: round; stroke-linejoin: round; stroke-width: 7.5px;"/>
        <polygon points="-61.851 4.425 -61.851 -4.427 -51.82 -.001 -61.851 4.425"/>
        <polygon points="-46.864 -40.606 -40.605 -46.866 -36.641 -36.643 -46.864 -40.606"/>
        <polygon points="-4.425 -61.851 4.427 -61.851 .001 -51.82 -4.425 -61.851"/>
        <polygon points="40.606 -46.864 46.866 -40.605 36.643 -36.641 40.606 -46.864"/>
        <polygon points="61.851 -4.425 61.851 4.427 51.82 .001 61.851 -4.425"/>
      
    </g>
  </defs>
  <use href="#timer" opacity="0.25"/>
  <use style="clip-path: url(#timer-clip-path);" href="#timer"/>
  <path transform="rotate(${-180 * t})" d="M1.72,7.744L25.67,2.972c3.748-.747,3.662-6.135-.108-6.762L1.472-7.793v-.003c-.478-.082-.97-.121-1.472-.113-4.367.07-7.851,3.667-7.781,8.035S-4.114,7.977.253,7.907c.546-.009,1.078-.073,1.591-.186"/>
</svg>
`;

function svg2dataUrl(svg) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

class Timer extends GridCard {
    constructor({type = "plain", colorTheme="dark-a"} = {}) {
        super("div", type, colorTheme);
        this.content
            .createChild("div", {class: "symbol", icon: true})
            .createChild("i-bw", {
                styles: {
                    "--i-bg": `url("${svg2dataUrl(timer_svg(0))}")`
                }
            })
    }
}
class TimeInput extends GridCard {
    constructor({type = "plain", colorTheme="dark-a"} = {}) {
        super("div", type, colorTheme);
        this.content.createChild("input", {type: "number"})
    }
}

class TimerWidget extends GridLayout {
    constructor() {
        super(3, 5)
        this.addGridIcons([
            [
                {
                    symbol: "close",
                    colorTheme: "action",
                }, 
                null, null, null,
                {
                    symbol: "speaker-2",
                    colorTheme: "action",
                }
            ],
            [
                {
                    symbol: "stop",
                    colorTheme: "dark-a"
                },
                null, null, null,
                null
            ],
            [
                {
                    symbol: "pause",
                    colorTheme: "dark-a"
                },
                null, null, null,
                {
                    colorTheme: "dark-a",
                    symbol: "plusone"
                }
            ],
            
        ], 0, 0)

        this.add(new TimeInput(), 2, [1,3])
        
        this.add(new Timer(), [0,1], [1,3])
    }
}

export { Timer, TimerWidget };