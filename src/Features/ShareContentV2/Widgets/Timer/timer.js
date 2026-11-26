import { GridCard, GridLayout } from "../../../../Utilities/GridLayout/grid-icons.js";
import { delay, relURL } from "../../../../Utilities/usefull-funcs.js";

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
const timer_svg = (t) => `<svg viewBox="-75 -75 150 90" xmlns="http://www.w3.org/2000/svg" version="1.1"><defs><clipPath id="timer-clip-path"><polygon points="${segPathS(188 * t - 4, 184, 200)}" style="fill: none;"/></clipPath><g id = "timer"><path d="M-63.75,0c0-35.208,28.542-63.75,63.75-63.75S63.75-35.208,63.75,0" style="fill: none; stroke: #000; stroke-linecap: round; stroke-linejoin: round; stroke-width: 7.5px;"/><polygon points="-46.864 -40.606 -40.605 -46.866 -36.641 -36.643 -46.864 -40.606"/><polygon points="-4.425 -61.851 4.427 -61.851 .001 -51.82 -4.425 -61.851"/><polygon points="40.606 -46.864 46.866 -40.605 36.643 -36.641 40.606 -46.864"/></g></defs><use href="#timer" opacity="0.25"/><use style="clip-path: url(#timer-clip-path);" href="#timer"/><path transform="rotate(${-180 * t})" d="M1.72,7.744L25.67,2.972c3.748-.747,3.662-6.135-.108-6.762L1.472-7.793v-.003c-.478-.082-.97-.121-1.472-.113-4.367.07-7.851,3.667-7.781,8.035S-4.114,7.977.253,7.907c.546-.009,1.078-.073,1.591-.186"/></svg>`;

function svg2dataUrl(svg) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

class Timer extends GridCard {
    constructor({type = "plain", colorTheme="dark-a"} = {}) {
        super("access-button", type, colorTheme);
        this.icon = this.content
            .createChild("div", {class: "symbol", icon: true})
            .createChild("i-bw")
    }

    set value(t) {
        this.icon.styles = {
            "--i-bg": `url("${svg2dataUrl(timer_svg(t))}")`
        }
    }
}

class TimeInput extends GridCard {
    constructor({type = "plain", colorTheme="dark-a"} = {}) {
        super("div", type, colorTheme);
        this.classList.add("time-input");
        this.minutes = this.content.createChild("input", {
            type: "number",
            min: 0,
            max: 59
        })
        this.content.createChild("div", {content: ":"});
        this.seconds = this.content.createChild("input", {
            type: "number",
            min: 0,
            max: 59
        })

        this.events = {
            "change": (e) => {
                this.padValue();
            }
        }

        this.value = 60*5
    }

    padValue() {
        this.minutes.value = String(this.minutes.value).padStart(2, "0");
        this.seconds.value = String(this.seconds.value).padStart(2, "0");
    }

    addMinute(value = 1) {
        this.value += value * 60;
        this.dispatchEvent(new CustomEvent("change", {bubbles: true}));
    }

    get value() {
        let minutes = parseInt(this.minutes.value, 10) || 0;
        let seconds = parseInt(this.seconds.value, 10) || 0;
        return minutes * 60 + seconds;
    }

    set value(value) {
        value = Math.max(0, Math.min(value, 59 * 60 + 59));
        let minutes = Math.floor(value / 60);
        let seconds = Math.floor(value % 60);
        this.minutes.value = String(minutes).padStart(2, "0");
        this.seconds.value = String(seconds).padStart(2, "0");
    }

    set locked(value) {
        this.minutes.disabled = value;
        this.seconds.disabled = value;
    }
}

const DT = 75;
const AUDIO_START_THRESHOLD = 11;
const MAX_TIME = 59 * 60 + 59; // seconds, the most the input can display

/**
 * A count down timer. Its state is made of timestamps rather than a ticking
 * value so it can be synced between users: each user computes the remaining
 * time from the shared state.
 *
 * Events:
 *   "change"  the user changed the state (see .state). Not dispatched when
 *             .state is set or when a user's own timer runs out.
 */
class TimerWidget extends GridLayout {
    #startTime = 0;     // Date.now() when started, shifted forward by pauses
    #pausedAt = 0;      // Date.now() when paused
    #setTime = 5 * 60;  // seconds
    #on = false;

    #finish = true;
    #paused = false;
    #audioStarted = false;
    #audioMuted = false;

    constructor() {
        super(3, 4)
        this.audio = new Audio(relURL("./timeraudio.mp3", import.meta));
        this.audio.volume = 0.4;
        this.icons = GridLayout.byName(this.addGridIcons([
            [
                {
                    name: "stop",
                    symbol: "stop",
                    colorTheme: "dark-a",
                    events: {
                        "access-click": (e) => this.stop(true)
                    }
                },
                null, null,
                {
                    name: "sound",
                    symbol: "speaker-2",
                    colorTheme: "action",
                    events: {
                        "access-click": (e) => {
                            this.toggleMute();
                            this.#updateState();
                        }
                    }
                }
            ],
            [
                {
                    name: "play",
                    symbol: "play",
                    colorTheme: "dark-a",
                    events: {
                        "access-click": (e) => {
                            this.togglePausePlay();
                        }
                    }
                },
                null, null,
                {
                    name: "plusOne",
                    symbol: "plusone",
                    colorTheme: "dark-a",
                    events: {
                        "access-click": (e) => {
                            this.addMinute(1);
                        }
                    }
                }
            ],
        ], 0, 0));

        this.input = this.add(new TimeInput(), 1, [1,2])
        this.input.addEventListener("change", (e) => {
            if (!this.#finish) return;
            // clamp the typed value
            this.input.value = this.input.value;
            this.#setTime = this.input.value;
            this.#updateState();
        });
        this.timer = this.add(new Timer(), 0, [1,2])
        this.timer.events = {"access-click": e => this.togglePausePlay()}
        this.#updateState(false);
        this.startUpdatingLoop();
    }

    toggleMute(bool = !this.#audioMuted) {
        this.#audioMuted = !!bool;
        this.audio.muted = this.#audioMuted;
        this.icons.sound.symbol = this.#audioMuted 
            ? "speaker-off-2" 
            : "speaker-2";
    }

    #stopAudio(forceStopAudio = true) {
        this.#audioStarted = false;
        forceStopAudio && this.audio.pause();
    }
    #startAudio(time) {
        this.#audioStarted = true;
        this.audio.currentTime = time
        this.audio.play().catch(() => {});
    }

    togglePausePlay() {
        const now = Date.now();
        if (this.#finish) {
            this.#startTime = now;
            this.#pausedAt = 0;
            this.#setTime = this.input.value;
            this.#finish = false;
            this.#paused = false;
        } else if (this.#paused) {
            // shift the start by the time spent paused
            this.#startTime += now - this.#pausedAt;
            this.#pausedAt = 0;
            this.#paused = false;
        } else {
            this.#pausedAt = now;
            this.#paused = true;
            this.#stopAudio();
        }
        this.#updateState();
    }

    /**
     * Adds minutes to the timer. When stopped this changes the input value,
     * when running or paused it extends the current count down.
     * @param {number} value number of minutes to add
     */
    addMinute(value = 1) {
        if (this.#finish) {
            this.input.addMinute(value);
            return;
        }
        // keep the remaining time within what the input can display
        const maxSetTime = this.elapsed + MAX_TIME;
        this.#setTime = Math.min(this.#setTime + value * 60, maxSetTime);
        this.#checkAudioReset();
        this.#updateState();
    }

    /** Stop the end sound if more time was added since it started. */
    #checkAudioReset() {
        if (this.#audioStarted && this.remaining >= AUDIO_START_THRESHOLD) {
            this.#stopAudio();
        }
    }

    /**
     * @param {boolean} stopSound stop the end sound if it is playing
     * @param {boolean} dispatch dispatch a change event
     */
    stop(stopSound = false, dispatch = true) {
        this.#startTime = 0;
        this.#pausedAt = 0;
        this.#finish = true;
        this.#paused = false;
        this.#stopAudio(stopSound);
        this.#updateState(dispatch);
    }

    async startUpdatingLoop() {
        if (this.#on) return;
        this.#on = true;
        while (this.#on) {
            this.#render();
            await delay(DT)
        }
    }

    /** Seconds the timer has been running for (excluding pauses). */
    get elapsed() {
        if (this.#finish) return 0;
        const now = this.#paused ? this.#pausedAt : Date.now();
        return Math.max(0, (now - this.#startTime) / 1000);
    }

    /** Seconds left on the timer. */
    get remaining() {
        return this.#finish ? this.#setTime : Math.max(0, this.#setTime - this.elapsed);
    }

    get state() {
        return {
            finish: this.#finish,
            paused: this.#paused,
            startTime: this.#startTime,
            pausedAt: this.#pausedAt,
            setTime: this.#setTime,
            muted: this.#audioMuted
        }
    }

    set state(state) {
        const {
            finish = true,
            paused = false,
            startTime = 0,
            pausedAt = 0,
            setTime = 5 * 60,
            muted = false
        } = state || {}

        const wasRunning = !this.#finish && !this.#paused;
        const remainingBefore = this.remaining;

        this.#finish = !!finish;
        this.#paused = !this.#finish && !!paused;
        this.#startTime = startTime;
        this.#pausedAt = pausedAt;
        this.#setTime = setTime;
        this.toggleMute(muted);

        // the other user paused, or stopped the timer before it ran out
        // (if it ran out, let the end sound finish playing)
        if (wasRunning && (this.#paused || (this.#finish && remainingBefore > 0.5))) {
            this.#stopAudio();
        }
        // the other user added time after the end sound started
        if (!this.#finish) this.#checkAudioReset();

        this.#updateState(false);
    }

    #updateState(dispatch = true) {
        this.icons.stop.disabled = this.#finish;
        // this.icons.plusOne.disabled = !this.#finish;
        this.icons.play.symbol = this.#paused || this.#finish ? "play" : "pause";
        this.input.locked = !this.#finish;
        if (this.#finish) {
            this.timer.value = 0;
            this.input.value = this.#setTime;
        } else {
            this.#render();
        }
        if (dispatch) {
            this.dispatchEvent(new CustomEvent("change", {bubbles: true}));
        }
    }

    #render() {
        if (this.#finish) return;
        const {elapsed} = this;
        if (elapsed >= this.#setTime) {
            // every user's timer runs out on its own, so this isn't
            // dispatched (each user would write the same state)
            this.stop(false, false);
        } else {
            const remaining = this.#setTime - elapsed;
            if (!this.#paused && remaining < AUDIO_START_THRESHOLD && !this.#audioStarted) {
                this.#startAudio(AUDIO_START_THRESHOLD - remaining)
            }
            this.timer.value = elapsed / this.#setTime;
            this.input.value = remaining;
        }
    }
}

export { Timer, TimerWidget };