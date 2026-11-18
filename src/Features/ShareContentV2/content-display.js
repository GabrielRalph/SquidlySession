import { delay, makeLogger } from "../../Utilities/usefull-funcs.js";
import { SvgPlus } from "../../SvgPlus/4.js"
import * as PDF from "./pdfjs/pdf.mjs"
import * as PDFWorker from './pdfjs/pdf.worker.mjs';
import { Icon } from "../../Utilities/Icons/icons.js";
import { HideShowTransition } from "../../Utilities/hide-show.js";

/**
 * @typedef {Object} ContentInfo
 * @property {("pdf"|"image"|"stream"|"none")} type
 * @property {string} url
 * @property {number|string} page the page number for a pdf, or the id of the
 *                                user sharing for a stream
 */

PDF.GlobalWorkerOptions.workerSrc = PDFWorker;

const log = makeLogger("Share Content", "color: orange;");

async function renderPDF(canvas, pdfDoc, pageNum, maxDimension) {
    let page = await pdfDoc.getPage(pageNum);

    const VP = page.getViewport({ scale: 1 });
    const scale = maxDimension / Math.max(VP.height, VP.width);
    const viewport = page.getViewport({ scale })
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({
        canvasContext: canvas.getContext("2d", { willReadFrequently: true }),
        viewport: viewport
    }).promise;
}

/**
 * Displays a pdf page, an image or a video stream. Only one is shown at a
 * time, see activeElement. The frame does not pan or zoom itself, the
 * whiteboard does that by transforming the active element (see
 * WhiteBoard.linkToElement) so annotations stay on the content.
 */
class ContentFrame extends SvgPlus {
    constructor() {
        super("content-frame");

        /** shown when nothing is shared, fills the frame */
        this.blank = this.createChild("div", {class: "blank"});

        this.image = this.createChild("img", {
            class: "image",
            // load with CORS so the image can be drawn into screenshots
            // without tainting the canvas (storage allows it, like the pdfs)
            crossorigin: "anonymous",
            draggable: false,
            events: {
                'dragstart': e => e.preventDefault()
            }
        });

        this.canvas = this.createChild("canvas", { width: 1000, height: 1000 });

        /** @type {HTMLCanvasElement} */
        this.streamCanvas = this.createChild("canvas");
        this.streamCtx = this.streamCanvas.getContext("2d", { willReadFrequently: true });

        this.video = this.createChild("video", { playsinline: true, muted: true, autoplay: true });

        this.displayType = null;
    }

    async stopUpdatingVideo(){}

    /** Copies video frames to the stream canvas while displaying a stream */
    async updateVideo() {
        if (this.updatingVideo) return;

        let stop = false;
        let updatingLoop = async () => {
            this.updatingVideo = true
            while (!stop) {
                const {video, streamCanvas} = this;
                if (this.displayType == "stream" && video.videoWidth > 0) {
                    // only resize when needed, resizing clears the canvas
                    if (streamCanvas.width !== video.videoWidth) streamCanvas.width = video.videoWidth;
                    if (streamCanvas.height !== video.videoHeight) streamCanvas.height = video.videoHeight;
                    this.streamCtx.drawImage(video, 0, 0, streamCanvas.width, streamCanvas.height);
                }
                await delay();
            }
        }

        let prom = updatingLoop();
        this.stopUpdatingVideo = async () => {
            this.updatingVideo = false;
            stop = true;
            await prom;
        }
        await prom;
    }

    /** @param {MediaStream} stream  */
    set stream(stream) {
        this.video.srcObject = stream;
    }

    /** @param {string} url  */
    set imageSrc(url) {
        this.image.src = url;
    }

    /** @param {?("pdf" | "image" | "stream")} type  */
    set displayType(type) {
        this._displayType = type;
        if (type == "stream") {
            this.updateVideo();
        } else {
            this.stopUpdatingVideo();
        }
        const active = this.activeElement;
        for (let el of [this.blank, this.image, this.canvas, this.streamCanvas]) {
            el.style.display = el === active ? "" : "none";
        }
    }
    get displayType() {
        return this._displayType;
    }

    /** The element currently showing the content (the blank sheet when
     *  nothing is shared). It is sized to the content's aspect ratio. */
    get activeElement() {
        switch (this.displayType) {
            case "pdf": return this.canvas;
            case "image": return this.image;
            case "stream": return this.streamCanvas;
            default: return this.blank;
        }
    }
}

/** Blurred overlay with a file icon that fills up with upload/load progress */
class Loader extends HideShowTransition {
    constructor(){
        super("file-loader");
        this.icon = this.createChild(Icon, {}, "file");
        this.text = this.icon.createChild("text", {
            "text-anchor": "middle",
        })
        this.path = this.icon.querySelector("path");
        this.path.style.setProperty("--length", this.path.getTotalLength())
    }

    /** @param {number} p progress between 0 and 1 */
    set progress(p){
        if (typeof p !== "number") p = 0;
        this.toggleAttribute("progress", p > 0);
        this.style.setProperty("--progress", p);

        let [pos, size] = this.icon.svgBBox;
        let center = pos.add(size.div(2));
        let fs = size.x / 4;
        this.text.props = {
            x: center.x,
            y: center.y + 0.6 * fs,
            "font-size": fs,
            content: Math.round(p * 100) + "%"
        }
    }
}

/**
 * Displays the shared content (pdf, image or screen share stream) described
 * by a ContentInfo, with a loader for uploads.
 *
 * Events (non bubbling, on this element):
 *   "page"           the user changed the pdf page (see .page)
 *   "displaychange"  the type of content shown changed, see activeElement
 */
class ContentDisplay extends SvgPlus {
    /** @type {{promise: Promise, abort: function}} */
    loadingPDFPromise = null;

    /** @type {Object<string, MediaStream>} streams keyed by the user sharing */
    streams = {};

    /** @type {?string} this user, whose own stream is played muted */
    localUser = null;

    constructor() {
        super("content-display");
        this._pageNumber = 1;
        this._displayType = null;
        this._url = null;

        this.content = this.createChild(ContentFrame);
        this.loader = this.createChild(Loader);
    }

    /** @param {number} value 1 based page number, clamped to the pdf */
    set page(value) {
        if (value < 1) value = 1;
        let { totalPages, pdfDoc } = this;
        if (value > totalPages && pdfDoc) value = totalPages;

        if (value != this._pageNumber) {
            this._pageNumber = value;
            this.#updatePageAttributes();
            this.dispatchEvent(new Event("page"))
            this.renderPage();
        }
    }
    get page() {
        return this._pageNumber;
    }

    get totalPages() {
        return this.pdfDoc && "numPages" in this.pdfDoc ? this.pdfDoc.numPages : 0;
    }

    get url() {
        return this._url;
    }

    /** @param {?string} type */
    set displayType(type) {
        const changed = type !== this._displayType;
        this._displayType = type;
        this.content.displayType = type;
        this.toggleAttribute("empty", type == null);
        if (type == null) this.removeAttribute("display-type");
        else this.setAttribute("display-type", type);
        if (changed) this.dispatchEvent(new Event("displaychange"));
    }
    get displayType() {
        return this._displayType;
    }

    /** The element showing the content, sized to the content's aspect ratio */
    get activeElement() {
        return this.content.activeElement;
    }

    /** Sets the stream shared by a user, shown if that user is sharing
     * @param {?MediaStream} stream
     * @param {string} user */
    setStream(stream, user) {
        this.streams[user] = stream;
        if (this.displayType == "stream" && this.streamUser == user) {
            this.#showStream(stream, user);
        }
    }

    /** Shows a stream, playing its sound unless it is our own screen share
     * (which would echo) @param {?MediaStream} stream @param {string} user */
    #showStream(stream, user) {
        const {video} = this.content;
        this.content.stream = stream;
        video.muted = this.localUser == null || user === this.localUser;
        if (stream && !video.muted) {
            // autoplay with sound can be blocked, fall back to muted
            video.play().catch(() => {
                video.muted = true;
                video.play().catch(() => {});
            });
        }
    }

    /** @param {?ContentInfo} contentInfo */
    async updateContentInfo(contentInfo) {
        log("content update", contentInfo);
        if (contentInfo == null) {
            // cancel a pdf still loading so it doesn't show once loaded
            if (this.loadingPDFPromise != null) {
                this.loadingPDFPromise.abort();
                this.loader.hide();
            }
            this.displayType = null;
            this._url = null;
            this.pdfDoc = null;
            this.#updatePageAttributes();
            return;
        }

        let { url, page, type } = contentInfo;
        if (url != this.url) {
            // Change of content
            this.displayType = type;
            switch (type) {
                case "pdf":
                    this._pageNumber = page;
                    await this.loadPDF(url);
                    break;

                case "stream":
                    this._url = url;
                    this.pdfDoc = null;
                    this.streamUser = page;
                    this.#showStream(this.streams[page], page);
                    this.loader.progress = 1;
                    this.loader.hide(500);
                    break;

                case "image":
                    this._url = url;
                    this.pdfDoc = null;
                    this.content.imageSrc = url;
                    this.loader.progress = 1;
                    this.loader.hide(500);
                    break;
            }
            this.#updatePageAttributes();
        } else if (type == "pdf" && page != this.page) {
            // Change of page
            this.page = page;
        }
    }

    async loadPDF(url) {
        let aborted = false;
        let abort = () => { aborted = true; }
        let pfunc = async () => {
            this.loader.show(400);
            let t0 = performance.now();
            this.loader.progress = 0.8
            this._url = url;
            let doc = await PDF.getDocument(url).promise;
            if (!aborted) {
                this.loader.progress = 0.9
                log(`load pdf took ${performance.now() - t0}ms`)
                this.pdfDoc = doc;
                if (this.page < 1 || this.page > this.totalPages) this._pageNumber = 1;
                this.#updatePageAttributes();
                await this.renderPage();
                this.loader.progress = 1;
                this.displayType = "pdf";
                await this.loader.hide();
            }
        }

        if (this.loadingPDFPromise != null) {
            this.loadingPDFPromise.abort();
        }

        this.loadingPDFPromise = { promise: pfunc(), abort }
        await this.loadingPDFPromise.promise;
        this.loadingPDFPromise = null;
    }

    async renderPage() {
        let { content, pdfDoc, page } = this;
        if (pdfDoc) {
            if (this._render_prom instanceof Promise) {
                await this._render_prom
            }
            let maxDimension = Math.max(window.innerWidth, window.innerHeight) * 3;
            this._render_prom = renderPDF(content.canvas, pdfDoc, page, maxDimension);
            await this._render_prom;
            this._render_prom = null;
        }
    }

    #updatePageAttributes() {
        const isPDF = this.displayType == "pdf" && this.pdfDoc;
        this.setAttribute("pages", isPDF ? this.totalPages : 0);
        this.toggleAttribute("no-back", !isPDF || this.page <= 1);
        this.toggleAttribute("no-next", !isPDF || this.page >= this.totalPages);
    }
}

export { ContentDisplay, ContentFrame, Loader }
