
import { SvgPlus } from "../../../../SvgPlus/4.js"

export function onSelect(wb){
    wb.isPanLocked = false;
    wb.isZoomLocked = false;
    wb.readOnly = true;
    wb.cursor = "grab";
}

export function clearSelectionOnSelect(){
    return false;
}

export function getIcon(){
    let icon = new SvgPlus("svg")
    icon.innerHTML = ` <path class="cls-1" d="M13.62,25.57c5.54,0,4.97-4.45,6.77-8.35s5.91-9.96,3.26-10.77c-2.37-.73-3.91,6.07-4.8,5.9s2.31-10.15-.72-10.6c-2.76-.41-2.09,9.11-2.87,9.09-.86-.03.36-10.85-2.51-10.85s-.55,10-1.35,10.22S9.19,1.27,6.42,2.56c-2.4,1.12,3.61,12.91,1.21,12.15-1.73-.55-5.62-4.58-7.28-2.92-1.15,1.15.62,2.89,3.42,5.16.97.89,1.89,1.78,2.42,2.58,1.73,2.6,2.3,6.05,7.42,6.05Z"/>`
   
    icon.props = {
        viewBox: "0 0 24.52 25.57"
    }

    return icon;
}

export function getName(){
    return "pan"
}