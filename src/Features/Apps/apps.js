import { filterAndSort, SearchWindow } from "../../Utilities/search.js";
import { relURL } from "../../Utilities/usefull-funcs.js";
import { Features, OccupiableWindow } from "../features-interface.js";
import { Vector } from "../../SvgPlus/4.js";
import { GridIcon, GridLayout } from "../../Utilities/Buttons/grid-icon.js";
import { AccessButton } from "../../Utilities/Buttons/access-buttons.js";
import * as F from "../../Firebase/firebase.js";

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
 * @typedef {Object} AppDescriptor
 * @property {AppInfo} info - The metadata information about the app.
 * @property {string} html - The HTML content of the app's index page.
 */

/**
 * Fetches the app descriptor from the given URL, which includes both the app's metadata and its HTML content.
 * @param {string} url - The base URL where the app is hosted (e.g., "https://example.com/myapp").
 * @returns {Promise<AppDescriptor>} An object containing the app's metadata and HTML content.
 */
async function getAppDescriptor(url) {
    // Load index and info
    try {
        const [resInfo, resIndex] = await Promise.all([
            fetch(url + "/info.json", { cache: "no-store" }),
            fetch(url + "/index.html", { cache: "no-store" }),
        ]);
        
        const [info, html] = await Promise.all([
            resInfo.ok ? resInfo.json() : null,
            resIndex.ok ? resIndex.text() : null,
        ]);

        if (info) {
            const iconURL = new URL(info.icon, url)
            info.icon = iconURL.href;
        }
    
        return {info, html};
    } catch (error) {
        console.error("Error fetching app descriptor:", error);
        return {info: null, html: null};
    }
}

class AppsSearch extends SearchWindow {
  constructor(apps) {
    super();
    this.apps = apps;
    this.styles = {
      background: "white",
    };
  }

  reset(imm) {
    this.closeIcon = "close";
    this.resetSearchItems(imm);
  }

  async getSearchResults(searchPhrase) {
    let apps = this.apps;
    /** @type {Answer[]} */
    let items = Object.entries(apps).map(([appID, info]) => {
      return {
        appID: appID,
        app: info,
        icon: {
          symbol: info.icon,
          type: "normal",
        },
      };
    });
    items = filterAndSort(
      items,
      searchPhrase,
      ({ app: { title, subtitle } }) => [title, subtitle],
    );
    return items;
  }
}

class AppsFrame extends OccupiableWindow {
  constructor(feature, sdata) {
    super("app-frame");
    this.feature = feature;
    this.sdata = sdata;

    this.iframe = this.createChild("iframe", {
      style: {
        border: "none",
        width: "100%",
        height: "100%",
        background: "#e0d7d7bd",
        "pointer-events": "all",
      },
    });

    this.setGridSize(4, 5);

    this.search = this.createChild(AppsSearch, {
      style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
    });
  }

  async enterSearchMode() {
    this.search.reset(true);
    await this.search.show();
  }

  setGridSize(rows, cols) {
    rows = Math.max(1, Math.min(20, rows || 1));
    cols = Math.max(1, Math.min(20, cols || 1));

    this.nRows = rows;
    this.nCols = cols;

    let grid = new GridLayout(rows, cols);
    grid.styles = {
      position: "absolute",
      top: "var(--gap)",
      left: "var(--gap)",
      right: "var(--gap)",
      bottom: "var(--gap)",
    };
    let closeIcon = grid.add(
      new GridIcon(
        {
          symbol: "close",
          displayValue: "Exit",
          type: "action",
          events: {
            "access-click": async (e) => {
              e.waitFor(this.enterSearchMode());
            },
          },
        },
        "apps",
      ),
      0,
      0,
    );

    closeIcon.styles = {
      "--shadow-color": "transparent",
      "pointer-events": "all",
    };
    if (this.grid) {
      this.grid.replaceWith(grid);
    } else {
      this.appendChild(grid);
    }
    this.grid = grid;
  }

  // Set iframe src or srcdoc
  async setSrc(src, srcdoc = false) {
    return new Promise((res) => {
      this.iframe.onload = () => {
        res();
      };
      this.iframe.srcdoc = srcdoc ? src : null;
      if (!srcdoc) this.iframe.props = { src };
    });
  }

  // Send Message to iframe
  sendMessage(data) {
    this.iframe.contentWindow.postMessage(data, "*");
  }

  /**
   * Gets an element from the iframe document by ID.
   * @param {string} id - The element ID
   * @returns {HTMLElement|null}
   */
  getIframeElement(id) {
    try {
      const iframeDoc = this.iframe.contentDocument;
      return iframeDoc?.getElementById(id) || null;
    } catch (e) {
      return null;
    }
  }

  getIFrameElementByPath(path) {
    let element = null;
    try {
      let doc = this.iframe.contentDocument;
      const paths = path.join(">")
        .split("::shadow>")
        .map(p => p.replace(/(^>)|(>$)/g, ""))

      let lastPath = paths.pop();
      for (const p of paths) {
        doc = doc.querySelector(p)?.shadowRoot;
      }
      element = doc?.querySelector(lastPath) || null;
    } catch (e) { }
    return element;
  }


  /**
   * Gets the iframe's bounding rect in parent coordinates.
   * @returns {DOMRect}
   */
  getIframeRect() {
    return this.iframe.getBoundingClientRect();
  }

  /**
   * Converts a point from parent coordinates to iframe coordinates.
   * @param {Object} p - Point with x, y properties
   * @returns {Object} Point in iframe coordinates
   */
  toIframeCoords(p) {
    const rect = this.getIframeRect();
    const scaleX = this.iframe.offsetWidth / rect.width;
    const scaleY = this.iframe.offsetHeight / rect.height;

    return {
      x: (p.x - rect.left) * scaleX,
      y: (p.y - rect.top) * scaleY,
    };
  }

  /**
   * Converts a point from iframe coordinates to parent coordinates.
   * @param {Object} p - Point with x, y properties
   * @returns {Vector} Point in parent coordinates
   */
  toParentCoords(p) {
    const rect = this.getIframeRect();
    const scaleX = rect.width / this.iframe.offsetWidth;
    const scaleY = rect.height / this.iframe.offsetHeight;
    return new Vector(p.x * scaleX + rect.left, p.y * scaleY + rect.top);
  }

  /**
   * Checks if a point (in parent coords) is within the iframe bounds.
   * @param {Object} p - Point with x, y properties
   * @returns {boolean}
   */
  isPointInIframe(p) {
    const rect = this.getIframeRect();
    return (
      p.x >= rect.left &&
      p.x <= rect.right &&
      p.y >= rect.top &&
      p.y <= rect.bottom
    );
  }
 
  static get usedStyleSheets() {
    return [...SearchWindow.usedStyleSheets, GridIcon.styleSheet];
  }

  static get fixToolBarWhenOpen() {
    return true;
  }
}

const APPS_API = {
  event(e) {
    const data = e.data;

    if (!data?.type || !data?.emode) return;

    let event = null;
    switch (data.emode) {
      case "mouse":
        const globalP = this.appFrame.toParentCoords({ x: data.x, y: data.y });
        event = new MouseEvent(data.type, {
          clientX: globalP.x,
          clientY: globalP.y,
          button: data.button,
          buttons: data.buttons,
          bubbles: true,
        });
        break;
      case "key":
        event = new KeyboardEvent(data.type, {
          key: data.key,
          code: data.code,
          bubbles: true,
          ctrl: data.ctrlKey,
          shift: data.shiftKey,
          alt: data.altKey,
          meta: data.metaKey,
          repeat: data.repeat,
        });
        break;
    }
    window.dispatchEvent(event);
  },

  log(e) {
    console.log(...e.data.params);
  },

  firebaseSet(e) {
    const { path, value } = e.data;

    // Extract app name from path (first segment, e.g., "Starfin Adventure/score" → "Starfin Adventure")
    const appName = path.split("/")[0];
    if (!appName) {
      console.warn("Firebase set failed: Invalid path (no app name)");
      return;
    }

    // [Security] Verify app name
    const currentApp = this.appDescriptors[this.currentAppID];
    if (currentApp && currentApp.name !== appName) {
      console.warn(
        `[Security] Blocked attempt to write to app "${appName}" from app "${currentApp.name}"`,
      );
      return;
    }

    // [Rate Limit] Check write frequency
    if (!this._checkRateLimit("write")) return;

    this._performFirebaseSet(path, value, appName);
  },

  firebaseOnValue(e) {
    let path = "appdata/" + e.data.path;

    // [Resource Limit] Check max listeners
    if (this._activeFirebaseListeners.size >= this.MAX_LISTENERS) {
      console.warn(
        `[Resource Limit] Max listeners reached (${this.MAX_LISTENERS}). Request ignored.`,
      );
      return;
    }

    // [Rate Limit] Check creation frequency
    if (!this._checkRateLimit("listener")) return;

    // Remove existing listener for this path if any (avoid dupes)
    if (this._activeFirebaseListeners.has(path)) {
      this._activeFirebaseListeners.get(path)(); // Unsubscribe
    }

    const unsubscribe = this.sdata.onValue(path, (value) => {
      this.appFrame.sendMessage({
        mode: "firebaseOnValueCallback",
        path: e.data.path,
        value: value,
      });
    });

    this._activeFirebaseListeners.set(path, unsubscribe);
  },

  /**
   * @this {Apps}
   */
  setIcon(e) {
    const { x, y, options, key } = e.data;
    const { nRows, nCols } = this.appFrame;
    if (
      typeof x === "number" &&
      x < nCols &&
      typeof y === "number" &&
      y < nRows &&
      (x > 0 || y > 0)
    ) {
      let icon = new GridIcon(options);
      icon.styles = {
        "--shadow-color": "transparent",
        "pointer-events": "all",
        ...(options.styles || {}),
      };
      this.appFrame.grid.add(icon, x, y);
      icon.events = {
        "access-click": (e) => {
          this.sdata.logChange("app.interaction", {value: e.clickMode || "click"});
          this.appFrame.sendMessage({
            mode: "onIconClickCallback",
            key: key,
            value: { clickMode: e.clickMode },
          });
        },
      };

      // Track this icon so it can be cleared when switching apps or removed specifically
      this._appIcons.set(key, icon);
    }
  },

  setGridSize(e) {
    this.appFrame.setGridSize(e.data.size[0], e.data.size[1]);
  },

  removeIcon(e) {
    let key = e.data.key;
    if (this._appIcons.has(key)) {
      let icon = this._appIcons.get(key);
      icon.remove();
      this._appIcons.delete(key);
    }
  },

  addCursorListener(e) {
    // Prevent duplicate listener setup
    if (this._cursorListenersInitialized) return;
    this._cursorListenersInitialized = true;

    const users = [this.sdata.me, this.sdata.them];
    const inputs = ["mouse", "eyes"];

    users.forEach((user) => {
      inputs.forEach((inputType) => {
        this.session.cursors.addEventListener(`${user}-${inputType}`, (e) => {
          if (this.appFrame?.iframe) {
            const cursorX = e.screenPos._x * window.innerWidth;
            const cursorY = e.screenPos._y * window.innerHeight;

            // Convert window coords to iframe coords (handles offset + scaling)
            const iframeCoords = this.appFrame.toIframeCoords({
              x: cursorX,
              y: cursorY,
            });

            this.appFrame.sendMessage({
              mode: "cursorUpdate",
              user: `${user}-${inputType}`,
              x: iframeCoords.x,
              y: iframeCoords.y,
              source: user === this.sdata.me ? "local" : "remote",
            });
          }
        });
      });
    });
  },

  setSettings(e) {
    const { path, value } = e.data;
    if (typeof path === "string" && path.startsWith(this.sdata.me + "/")) {
      this.session.settings.setValue(path, value);
    } else {
      console.warn(
        `[Security] Blocked attempt to set setting outside of user scope: ${path}`,
      );
    }
  },

  debugLog(e) {
    // Forward debug logs to console
    if (e.data.level === "error") {
      console.error(
        "[Backend->Iframe]",
        e.data.message,
        ...(e.data.args || []),
      );
    } else if (e.data.level === "warn") {
      console.warn("[Backend->Iframe]", e.data.message, ...(e.data.args || []));
    } else {
      console.log("[Backend->Iframe]", e.data.message, ...(e.data.args || []));
    }
  },

  getSettings(e) {
    const { path, key } = e.data;
    
    // Enforce scope
    let responseValue = null;
    if (typeof path !== "string" || !path.startsWith(this.sdata.me + "/")) {
      console.warn(`[Security] Blocked attempt to get setting outside of user scope: ${path}`);
      responseValue = {
          mode: "getSettingsResponse",
          key: key,
          path: path,
          value: null,
          error: "Access Denied",
      }
    } else {
      responseValue = {
        mode: "getSettingsResponse",
        key: key,
        path: path,
        value: this.session.settings.get(path),
      }
    }

    // Send the value back to the iframe
    e.source.postMessage(
      responseValue,
      "*",
    );
  },

  addSettingsListener(e) {
    const path = e.data.path;

    // Enforce scope
    if (typeof path !== "string" || !path.startsWith(this.sdata.me + "/")) {
      console.warn(
        `[Security] Blocked attempt to listen to setting outside of user scope: ${path}`,
      );

    } else {
      // Remove existing listener if found (cleanup for reloads)
      if (this._iframeSettingsListeners.has(path)) {
        const oldHandler = this._iframeSettingsListeners.get(path);
        this.session.settings.removeEventListener("change", oldHandler);
      }
  
      const handler = (event) => {
        if (event.path === path) {
          e.source.postMessage(
            {
              mode: "settingsUpdate",
              path: path,
              value: event.value,
            },
            "*",
          );
        }
      };
  
      this._iframeSettingsListeners.set(path, handler);
      this.session.settings.addEventListener("change", handler);
    }
  },

  speak(e) {
    const utterance = e.data.utterance;
    this.session.text2speech.speak(utterance);
  },

  loadUtterances(e) {
    const utterances = e.data.utterances;
    this.session.text2speech.loadUtterances(utterances);
  },

   /**
   * Handles registration of an iframe access button.
   * Creates a proxy AccessButton that delegates directly to the iframe element (same-origin).
   */
  registerAccessButton(e) {
    const { id, group, order, path } = e.data;
    const {appFrame} = this;

    // Remove existing proxy if it exists (cleanup for reloads)
    if (this._iframeAccessButtons.has(id)) {
      const entry = this._iframeAccessButtons.get(id);
      entry.proxy.remove();
      this._iframeAccessButtons.delete(id);
    }

    // Override the iframe element's coordinate methods so that both the
    // proxy AND direct hits from getButtonAtPoint / dwell detection
    // return parent-viewport coordinates instead of iframe-local ones.
    const element = appFrame.getIFrameElementByPath(path);
    if (element) {
      const origGetCenter = element.getCenter.bind(element);
      const origIsPointInElement = element.isPointInElement.bind(element);

      element.getCenter = () => {
        const center = origGetCenter();
        return appFrame.toParentCoords(center);
      };

      element.isPointInElement = (p) => {
        if (!appFrame.isPointInIframe(p)) return false;
        const pIframe = appFrame.toIframeCoords(p);
        return origIsPointInElement(pIframe);
      };

      element.addEventListener("access-click", e => {
        this.sdata.logChange("app.interaction", { value:  e.clickMode || "click" });
      })
    }

    // Create proxy AccessButton element
    const proxy = new AccessButton(group);
    proxy.order = order;
    proxy.styles = {
      position: "absolute",
      pointerEvents: "none",
      opacity: "0",
      width: "0",
      height: "0",
    };

    // Proxy methods delegate to the (now-overridden) iframe element methods.
    // No additional coordinate conversion is needed here since the iframe
    // element already returns parent-viewport coordinates after the override.
    proxy.getSize = () => {
      const el = appFrame.getIFrameElementByPath(path);
      if (el && typeof el.getSize === "function") {
        return el.getSize();
      }
      return null;
    }

    proxy.getCenter = () => {
      const el = appFrame.getIFrameElementByPath(path);
      if (el && typeof el.getCenter === "function") {
        return el.getCenter();
      }
      return new Vector(0, 0);
    };

    proxy.getIsVisible = () => {
      // Always hide if search is open
      if (appFrame.search.shown) return false; 
      const el = appFrame.getIFrameElementByPath(path);
      if (el && typeof el.getIsVisible === "function") {
        return el.getIsVisible();
      }
    };

    proxy.setHighlight = (isHighlighted) => {
      proxy.toggleAttribute("hover", isHighlighted);
      const el = appFrame.getIFrameElementByPath(path);
      if (el && typeof el.setHighlight === "function") {
        el.setHighlight(isHighlighted);
      }
    };

    proxy.isPointInElement = (p) => {
      // Always return false if search is open
      if (appFrame.search.shown) return false;
      const el = appFrame.getIFrameElementByPath(path);
      if (!el) return false;
      if (typeof el.isPointInElement === "function") {
        return el.isPointInElement(p);
      }
      return false;
    };

    // Handle access-click by delegating to iframe element
    proxy.addEventListener("access-click", async (event) => {
      const el = appFrame.getIFrameElementByPath(path);
      if (el && typeof el.accessClick === "function") {
        await event.waitFor(el.accessClick(event.clickMode || "click"));
      }
    });

    // Store the proxy (no state cache needed - we access element directly)
    this._iframeAccessButtons.set(id, { proxy });

    // Add proxy to DOM (hidden, but registered with access control)
    appFrame.appendChild(proxy);
  },

  /**
   * Handles unregistration of an iframe access button.
   * Removes the proxy element from the DOM.
   */
  unregisterAccessButton(e) {
    const { id } = e.data;

    const entry = this._iframeAccessButtons.get(id);
    if (entry) {
      entry.proxy.remove();
      this._iframeAccessButtons.delete(id);
    }
  },

}

export default class Apps extends Features {
  constructor(session, sdata) {
    super(session, sdata);
    this.appFrame = new AppsFrame(this, sdata);
    this.appFrame.open = this.open.bind(this);
    this.appFrame.close = this.close.bind(this);
    this.currentAppID = null;
    this.appDescriptors = {};
    this._cursorListenersInitialized = false;

    /** @type {Map<string, {proxy: AccessButton, state: Object}>} */
    this._iframeAccessButtons = new Map();
    /** @type {Map<string, Function>} */
    this._iframeSettingsListeners = new Map();
    /** @type {Map<string, GridIcon>} */
    this._appIcons = new Map();

    // RESOURCE LIMITS
    this.MAX_LISTENERS = 100; // Max active listeners per app
    this.WRITE_RATE_LIMIT = 20; // Max writes per second
    this.LISTENER_RATE_LIMIT = 20; // Max listeners per second per app
    this.MAX_BYTES = 1024 * 5; // Max bytes per Firebase write (5KB)
    this.MAX_KEYS = 100; // Max unique keys per app

    this._activeFirebaseListeners = new Map(); // Track active firebase listeners to clear on close
    this._writeCount = 0;
    this._listenerCount = 0;
    this._lastRateReset = Date.now();
  }

  async open() {
    if (this.currentAppID === null) {
      this.appFrame.search.shown = true;
      this.appFrame.search.reset(true);
    } else {
      this.appFrame.search.shown = false;
      this._onAppSessionStart(this.currentAppID);
    }
    await this.appFrame.show();
  }

  async close() {
    if (this.currentAppID) {
      this._onAppSessionFinish(this.currentAppID);
    }
    await this.appFrame.hide();
  }

  async _setApp(appID) {
    let lastApp = this.currentAppID;
    this.currentAppID = appID in this.appDescriptors ? appID : null;

    if (lastApp) {
      this._onAppSessionFinish(lastApp);
    } 
    if (this.currentAppID) {
      this._onAppSessionStart(this.currentAppID);
    }

    // Ensure clean state before loading
    this._appCleanup();
    this.appFrame.setGridSize(4, 5);
    await this.appFrame.setSrc("about:blank");
    if (appID in this.appDescriptors) {
      const app = this.appDescriptors[appID];
      await this.appFrame.setSrc(app.html, true);
      this._sendSessionInfoUpdate();
    }
  }

  _onAppSessionStart() {
    this.session.heatmaps.createHeatmap("app-mouse", "mouse", 10);
    this.session.heatmaps.createHeatmap("app-eyes", "eyes", 10);
  }

  _onAppSessionFinish(appID) {
    const heatmapMouse = this.session.heatmaps.popHeatmap("app-mouse");
    if (heatmapMouse && heatmapMouse.sum > 0) {
      this.sdata.logChange("app.heatmap", {
        value: heatmapMouse.toString(),
        note: this.appDescriptors[appID].name,
      });
    }

    const heatmapEyes = this.session.heatmaps.popHeatmap("app-eyes");
    if (heatmapEyes && heatmapEyes.sum > 0) {
      this.sdata.logChange("app.heatmap", {
        value: heatmapEyes.toString(),
        note: this.appDescriptors[appID].name,
      });
    }
  }

  // =========================================================================
  // API Helpers
  // =========================================================================

  _appCleanup() {
    // Clear all settings listeners registered by the iframe
    for (const [path, handler] of this._iframeSettingsListeners) {
      this.session.settings.removeEventListener("change", handler);
    }
    this._iframeSettingsListeners.clear();

 
    // Clear all iframe access button proxies
    for (const [id, entry] of this._iframeAccessButtons) {
      entry.proxy.remove();
    }
    this._iframeAccessButtons.clear();
 
    // Unsubscribe from all tracked Firebase listeners
    for (const [path, unsubscribe] of this._activeFirebaseListeners) {
      if (typeof unsubscribe === "function") unsubscribe();
    }
    this._activeFirebaseListeners.clear();

    // Reset counters
    this._writeCount = 0;
    this._listenerCount = 0;


    // Clear all app-added icons
    for (const icon of this._appIcons.values()) {
      icon.remove();
    }
    this._appIcons.clear();
  }

  _performFirebaseSet(path, value, appName) {
    const registryPath = `appmeta/${appName}/registry`;

    // Check registry to enforce key limit
    this.sdata.get(registryPath).then((registry) => {
      const usedKeys = new Set(registry || []);

      // If this is a new key (not in registry)
      if (!usedKeys.has(path)) {
        // Check limit
        if (usedKeys.size >= this.MAX_KEYS) {
          console.warn(
            `Firebase set failed: Too many keys in app "${appName}" (${usedKeys.size}/${this.MAX_KEYS})`,
          );
          return;
        }

        // Add to registry and save
        usedKeys.add(path);
        this.sdata.set(registryPath, Array.from(usedKeys));
      }

      // Block mutable types (Objects and Arrays) to prevent database bloat
      // Only primitives (string, number, boolean, null) are allowed
      if (value !== null && typeof value === "object") {
        console.warn(
          `Firebase set failed: Mutable types (Objects and Arrays) are not allowed at path "${path}". Use individual primitive keys instead.`,
        );
        return;
      }

      let serialized = JSON.stringify(value);
      const encoder = new TextEncoder();
      // Check if the serialized value exceeds the maximum size
      if (encoder.encode(serialized).length > this.MAX_BYTES) {
        console.warn("Firebase set failed: value is too large");
        return;
      }

      this.sdata.set("appdata/" + path, value);
    });
  }

  _sendSessionInfoUpdate() {
    if (!this.appFrame?.iframe) return;
    let participantActive = this.sdata.isUserActive("participant");
    this.appFrame.sendMessage({
      mode: "sessionInfoUpdate",
      participantActive,
    });
  }

  _checkRateLimit(type) {
    const now = Date.now();
    if (now - this._lastRateReset > 1000) {
      this._writeCount = 0;
      this._listenerCount = 0;
      this._lastRateReset = now;
    }

    if (type === "write") {
      this._writeCount++;
      if (this._writeCount > this.WRITE_RATE_LIMIT) {
        console.warn(
          `[Rate Limit] Write limit exceeded (${this.WRITE_RATE_LIMIT}/sec). Request dropped.`,
        );
        return false;
      }
    } else if (type === "listener") {
      this._listenerCount++;
      if (this._listenerCount > this.LISTENER_RATE_LIMIT) {
        console.warn(
          `[Rate Limit] Listener creation limit exceeded (${this.LISTENER_RATE_LIMIT}/sec). Request dropped.`,
        );
        return false;
      }
    }
    return true;
  }

  // =========================================================================
  // Initialization and App Loading
  // =========================================================================

  /**
   * Loads app descriptors from the predefined AppsList.
   * @returns {Promise<boolean>} True if at least one app was loaded successfully, false otherwise.
   */
  async loadAppDescriptors() {
    let apiURL = relURL("./app-base-api.js", import.meta);
    let accessButtonsURL = relURL(
      "../../Utilities/Buttons/access-buttons.js",
      import.meta,
    );
    let gridIconStyles = relURL(
      "../../Utilities/Buttons/grid-icon.css",
      import.meta,
    );

    const snapshot = await F.get(F.ref("apps"))
    const appsList = Object.entries(snapshot.val());
    const appDescriptorList = await Promise.all(
      appsList.map(async ([appID, {url}]) => {
        const { info, html } = await getAppDescriptor(url);
        let result = null;

        // If both info and html are successfully loaded, prepare the descriptor
        if (info && html) {
          info.url = url;

          const sessionInfo = {
            user: this.sdata.me,
            participantActive: this.sdata.isUserActive("participant"),
            appName: info.name,
          };

            // Escape < to prevent </script> from terminating the injection prematurely.
          const injection = [
            `<script type="module" src="${accessButtonsURL}"></script>`,
            `<script src="${apiURL}"></script>`,
            `<base href="${url}/">`,
            `<script>window.session_info = ${
              JSON.stringify(sessionInfo).replace(/</g, "\\u003c")
            };</script>`,
            `<link rel="stylesheet" href="${gridIconStyles}">`
          ].join("\n\t");
          
          info.html = html.replace(/<head\b[^>]*>/, `$& \n\t${injection}`);

          result = [appID, info]
        } else {
          console.warn("Failed to load app descriptor from " + url);
        }
        return result;
      })
    );
    this.appDescriptors = Object.fromEntries(appDescriptorList.filter(v => v !== null));
    

    this.appFrame.search.apps = this.appDescriptors;
    return Object.keys(this.appDescriptors).length > 0;
  }

  async initialise() {
    // Bind API functions to this instance
    this._API = Object.fromEntries(
        Object.entries(APPS_API).map(([key, func]) => [key, func.bind(this)]),
    );

    // Load app descriptors before setting up UI and listeners
    if (await this.loadAppDescriptors()) {

      // Set up toolbar button
      this.session.toolBar.addMenuItem("share", {
        name: "apps",
        index: 180,
        onSelect: (e) => e.waitFor(this.session.openWindow("apps")),
      });

      // Listen for app selection from search window
      this.appFrame.search.addEventListener("value", (e) => {
        // If value is null then the user has closed apps.
        if (e.value == null) {
          e.waitFor(this.session.openWindow("default"));
          
        // Otherwise, an app was selected
        } else {
          this.sdata.set("selected_app", {
            id: e.value.appID,
            timestamp: Date.now(),
          });

          // We are going to LOG the selected app to the logs which will be saved.
          this.sdata.logChange("app.selected", { value: e.value.app.name });

          // Wait for visual transition
          e.waitFor(Promise.all([
            this._setApp(e.value.appID),
            this.appFrame.search.hide(),
          ]));
        }
      });

      // Listen for app changes from other users.
      this.sdata.onValue("selected_app", async (selectedApp) => {
        if (selectedApp && selectedApp.id in this.appDescriptors) {
          this.appFrame.search.hide();
          this._setApp(selectedApp.id);
        } else {
          // App was closed by other party
          this._setApp(null);
          this.appFrame.search.reset(true);
          this.appFrame.search.show();
        }
      });
  
      // Iframe API Message Listener
      window.addEventListener("message", (e) => {
        let modeFunc = e.data?.mode;
        if (modeFunc in this._API && this._API[modeFunc] instanceof Function) {
          this._API[modeFunc](e);
        }
      });
  
      // Listen for changes in session info
      this.sdata.onUser("joined", () => this._sendSessionInfoUpdate());
      this.sdata.onUser("left", () => this._sendSessionInfoUpdate());
    }

  }

  static get name() {
    return "apps";
  }

  static get layers() {
    return {
      appFrame: {
        type: "area",
        area: "fullAspectArea",
        index: 60,
      },
    };
  }

  static get firebaseName() {
    return "apps";
  }
}
