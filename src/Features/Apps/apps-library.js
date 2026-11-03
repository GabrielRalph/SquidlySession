import { relURL } from "../../Utilities/usefull-funcs.js";
// import library from "./data.js";

/**
 * @typedef {Object} AppInfo
 * @property {string} name - The name of the app.
 * @property {string} title - The display title of the app.
 * @property {string} subtitle - A brief subtitle for the app.
 * @property {string} version - The current version of the app.
 * @property {string} description - A brief description of the app.
 * @property {string} icon - A URL to an icon representing the app.
 * @property {string} author - The URL where the app can be accessed.
 */

/**
 * @typedef {Object} AppLibraryCategory
 * @property {string} name - The name of the category.
 * @property {string} image - A URL to an image representing the category.
 * @property {string} color - The color associated with the category.
 * @property {AppDescriptor[]} apps - The list of apps in this category.
 */

const ACCESS_BUTTONS_URL = relURL("../../Utilities/Buttons/access-buttons.js", import.meta);
const GRID_ICON_STYLES = relURL("../../Utilities/Buttons/grid-icon.css", import.meta);
const API_URL = relURL("./app-base-api.js", import.meta);
const APP_LIBRARY_URL = "https://firebasestorage.googleapis.com/v0/b/eyesee-d0a42.appspot.com/o/apps-database%2Fapps.json?alt=media"


class AppDescriptor {
    /** @type {AppInfo} */
    info = null;

    /** @type {string} */
    html = null;

    /** @type {string} */
    id = null;

    constructor(info = null, html = null, id = null) {
        this.info = info;
        this.html = html;
        this.id = id;
    }

    injectAPI(sInfo) {
        let newHTML = "";
        if (this.info && this.html) {
            const sessionInfo = {
                ...sInfo,
                appName: this.info.name,
            };
    
            // Escape < to prevent </script> from terminating the injection prematurely.
            const injection = [
                `<script type="module" src="${ACCESS_BUTTONS_URL}"></script>`,
                `<script src="${API_URL}"></script>`,
                `<base href="${this.url}/">`,
                `<script>window.session_info = ${
                    JSON.stringify(sessionInfo).replace(/</g, "\\u003c")
                };</script>`,
                `<link rel="stylesheet" href="${GRID_ICON_STYLES}">`
            ].join("\n\t");
            
            newHTML = this.html.replace(/<head\b[^>]*>/, `$&\n\t${injection}`);
        }
        return newHTML;
    }

    get valid() {
        return this.info !== null && this.html !== null && this.id !== null;
    }

    get name() {
        return this.info?.name ?? null;
    }

    get url() {
        return this.info?.url ?? null;
    }

    get icon() {
        return this.info?.icon ?? null;
    }


    /**
     * Fetches the app descriptor from the given URL.
     * @param {string} url - The base URL of the app.
     * @returns {Promise<AppDescriptor>} The app descriptor containing info and HTML content.
     */
    static async load(info, id) {
        // Load index and info
        try {
            const res = await fetch(info.url + "/index.html", { cache: "no-store" });
            if (!res.ok) throw new Error("Failed to fetch info.json");
            const html = await res.text();
            return new AppDescriptor(info, html, id);
        } catch (error) {
            console.error("Error fetching app descriptor:", error);
            return new AppDescriptor();
        }
    }
}


class AppLibrary {
    /** @type {AppLibraryCategory[]} */
    #categories = []

    /** @type {Record<string, AppDescriptor>} */
    #apps = {};

    /**
     * @param {AppLibraryCategory[]} categories - The list of app categories.
     */
    constructor(apps, categories) {
        this.#categories = categories;
        this.#apps = apps;
    }

    /**
     * Retrieves the unique ID for an app.
     * @param {AppDescriptor} app - The app descriptor.
     * @returns {string} The unique ID of the app.
     */
    getAppID(app) {
        return app.id;
    }

    /**
     * Retrieves an app by its ID.
     * @param {string} id - The ID of the app.
     * @returns {AppDescriptor|null} The app descriptor if found, otherwise null.
     */
    getApp(id) {
        return this.#apps[id] || null;
    }

    /**
     * Retrieves all apps in the library.
     * @param {string[]} [ids] - Optional array of app IDs to filter by. If not provided, all apps are returned.
     * @returns {AppDescriptor[]} An array of all app descriptors.
     */
    getApps(ids) {
        return ids.map(id => this.getApp(id));
    }

   

    /**
     * Checks if an app exists in the library by its ID.
     * @param {string} id - The ID of the app.
     * @returns {boolean} True if the app exists, otherwise false.
     */
    hasApp(id) {
        return id in this.#apps;
    }

    get categories() {
        return this.#categories;
    }

    get apps() {
        return {...this.#apps};
    }

    #parseCategories() {
        let parse = (cat) => {
            cat.apps = cat.apps.map(id => 
                typeof id === "string" ? this.getApp(id) : parse(id)
            ).filter(app => app !== null);
            return cat.apps.length === 0 ? null : cat;
        }
        this.#categories = parse({apps: this.#categories})?.apps || [];
    }

    static async load(url = APP_LIBRARY_URL) {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch app library");
        const {apps, categories} = await res.json();


        await Promise.all(
            Object.entries(apps).map(async ([id, info]) => {
                const app = await AppDescriptor.load(info, id);
                if (app.valid) {
                    apps[id] = app;
                } else {
                    delete apps[id]
                }
            })
        );

        
        const library = new AppLibrary(apps, categories);
        library.#parseCategories();
        return library;
    }
}


export { AppDescriptor, AppLibrary };
