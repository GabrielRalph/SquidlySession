import {AACGrid, AACBoard} from "https://aac.squidly.com.au/src/AACWebComponent/aac.js"
import {OBBoard} from "https://aac.squidly.com.au/src/OpenBoard/openboard.js"
for (const url of AACBoard.usedStyleSheets) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    document.head.appendChild(link);

}

const board = new AACGrid();
document.body.appendChild(board);
// board.board =


// board.board = OBBoard.make({…})
