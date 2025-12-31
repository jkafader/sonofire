import { SonofireBase } from '../base/sonofire_base.js';
import { midiClock } from '../../lib/midi_clock.js';
import { harmonicContext } from '../../lib/harmonic_context.js';

/**
 * Conductor Component
 * Manages global harmonic context, tempo, and musical mood
 * Sends MIDI Clock master signals and publishes context changes
 */
export class SonofireConductor extends SonofireBase {
    constructor() {
        super();

        // Conductor state
        this.mode = 'manual'; // 'auto' or 'manual'
        this.initialKey = 'C';
        this.initialScale = 'major';
        this.tempo = 120;
        this.mood = 'relaxed'; // 'tense' | 'relaxed' | 'sparse' | 'dense'
        this.spareness = 0.5; // 0.0 (full/dense) → 1.0 (very sparse)

        // Pool/tonic notation (new system)
        this.poolKey = null;     // e.g., "3♯", "0", "2♭"
        this.tonicName = null;   // e.g., "A", "C♯"
    }

    /**
     * Specify which attributes to observe
     */
    static get observedAttributes() {
        return [
            ...super.observedAttributes,
            'data-initial-key',
            'data-initial-scale',
            'data-pool',
            'data-tonic',
            'data-tempo',
            'data-mode'
        ];
    }

    /**
     * Parse attributes
     */
    parseAttributes() {
        super.parseAttributes();

        // New pool/tonic notation (preferred)
        this.poolKey = this.getAttribute('data-pool');
        this.tonicName = this.getAttribute('data-tonic');

        // Legacy key/scale notation (backward compatibility)
        this.initialKey = this.getAttribute('data-initial-key') || 'C';
        this.initialScale = this.getAttribute('data-initial-scale') || 'major';

        this.tempo = parseInt(this.getAttribute('data-tempo')) || 120;
        this.mode = this.getAttribute('data-mode') || 'manual';
    }

    /**
     * Setup subscriptions
     */
    setupSubscriptions() {
        super.setupSubscriptions();

        if (this.mode === 'auto') {
            // In auto mode, listen to data events to adjust mood/spareness
            this.subscribe('data:forecast', (msg) => {
                this.handleForecastDeviation(msg);
            });

            this.subscribe('data:region', (msg) => {
                this.handleRegionData(msg);
            });
        }
    }

    /**
     * Register parameters as whip targets
     */
    registerWhippableParameters() {
        // Register tempo parameter
        this.registerWhippableParameter('tempo', {
            label: 'Tempo (BPM)',
            parameterType: 'number',
            min: 40,
            max: 240,
            elementSelector: '#tempo-input',
            setter: (value) => {
                const bpm = Math.round(value);
                this.setTempo(bpm);
            }
        });

        // Register spareness parameter
        this.registerWhippableParameter('spareness', {
            label: 'Spareness',
            parameterType: 'number',
            min: 0.0,
            max: 1.0,
            elementSelector: '#spareness-slider',
            setter: (value) => {
                this.setSpareness(value);
            }
        });

        // Render target lights after component is fully rendered
        requestAnimationFrame(() => {
            this.renderTargetLights();
        });
    }

    /**
     * Initialize conductor when connected
     */
    connectedCallback() {
        super.connectedCallback();

        // Set initial harmonic context
        // Prefer pool/tonic notation if provided
        if (this.poolKey && this.tonicName) {
            this.setPoolAndTonic(this.poolKey, this.tonicName);
        } else {
            // Fall back to legacy key/scale notation
            this.setKey(this.initialKey, this.initialScale);
        }

        // Publish initial mood and spareness
        this.setMood(this.mood);
        this.setSpareness(this.spareness);

        // Register whippable parameters (after render)
        this.registerWhippableParameters();

        // Start MIDI Clock if auto-start is enabled
        if (this.config.autoStart) {
            this.startClock();
        }
    }

    /**
     * Handle forecast deviation in auto mode
     */
    handleForecastDeviation(forecastData) {
        const { deviation } = forecastData;

        // Adjust mood based on deviation
        if (deviation > 0.5) {
            this.setMood('tense');
        } else if (deviation < 0.2) {
            this.setMood('relaxed');
        }
    }

    /**
     * Handle region data (from heatmaps) in auto mode
     */
    handleRegionData(regionData) {
        const { type, intensity } = regionData;

        // Adjust spareness based on region intensity
        if (type === 'hot' && intensity > 0.7) {
            this.setSpareness(0.2); // Dense playing
        } else if (type === 'cold' || intensity < 0.3) {
            this.setSpareness(0.8); // Sparse playing
        }
    }

    /**
     * Set the current key and scale (legacy notation)
     */
    setKey(key, scale) {
        this.initialKey = key;
        this.initialScale = scale;

        // Update harmonic context service
        harmonicContext.setKey(key, scale);

        // Publish to PubSub (harmonicContext already does this, but we can add logging)
        console.log(`Conductor: Key set to ${key} ${scale}`);
    }

    /**
     * Set pool and tonic center (new notation)
     * @param {string} poolKey - Pool key (e.g., "3♯", "0", "2♭")
     * @param {string} tonicName - Tonic note name (e.g., "A", "C♯")
     */
    setPoolAndTonic(poolKey, tonicName) {
        this.poolKey = poolKey;
        this.tonicName = tonicName;

        // Convert tonic name to MIDI note
        const tonicNote = harmonicContext.noteNameToMIDI(tonicName, 4);

        // Update harmonic context service
        harmonicContext.setPoolAndTonic(poolKey, tonicNote, tonicName);

        console.log(`Conductor: Pool/Tonic set to ${poolKey}/${tonicName}`);
    }

    /**
     * Set the mood
     */
    setMood(mood) {
        this.mood = mood;

        this.publish('context:mood', { mood });

        console.log(`Conductor: Mood set to ${mood}`);
    }

    /**
     * Set the spareness level
     */
    setSpareness(spareness) {
        // Clamp to 0.0-1.0
        this.spareness = Math.max(0, Math.min(1, spareness));

        this.publish('context:spareness', { spareness: this.spareness });

        console.log(`Conductor: Spareness set to ${this.spareness.toFixed(2)}`);
    }

    /**
     * Start the MIDI Clock
     */
    startClock() {
        midiClock.start(this.tempo);
        console.log(`Conductor: MIDI Clock started at ${this.tempo} BPM`);
    }

    /**
     * Stop the MIDI Clock
     */
    stopClock() {
        midiClock.stop();
        console.log('Conductor: MIDI Clock stopped');
    }

    /**
     * Set tempo
     */
    setTempo(bpm) {
        this.tempo = bpm;
        midiClock.setBPM(bpm);
        console.log(`Conductor: Tempo set to ${bpm} BPM`);
    }

    /**
     * Play - start MIDI clock and all visualizer playheads
     */
    play() {
        // Start MIDI clock if not already running
        this.startClock();

        // Start visualizer playheads
        this.publish('transport:play', { timestamp: Date.now() });
        console.log('Conductor: Transport play (MIDI clock + visualizers)');
    }

    /**
     * Stop - stop MIDI clock and pause all visualizer playheads
     */
    stop() {
        // Stop MIDI clock
        this.stopClock();

        // Stop visualizer playheads
        this.publish('transport:stop', { timestamp: Date.now() });
        console.log('Conductor: Transport stop (MIDI clock + visualizers)');
    }

    /**
     * Rewind - reset all visualizer playheads to 0 (stops clock)
     */
    rewind() {
        // Stop clock when rewinding
        this.stopClock();

        // Rewind visualizer playheads
        this.publish('transport:rewind', { timestamp: Date.now() });
        console.log('Conductor: Transport rewind (stopped + reset to 0)');
    }

    /**
     * Render the conductor UI
     */
    render() {
        // Determine current display values
        const displayPoolKey = this.poolKey || '0';
        const displayTonicName = this.tonicName || this.initialKey || 'C';

        this.innerHTML = `
            <div style="background: #2d2d2d; padding: 15px; margin: 10px 0; border-left: 3px solid #4ec9b0;">
                <h3 style="margin: 0 0 10px 0; color: #4ec9b0;">🎼 Conductor</h3>

                <!-- Pool/Tonic Notation (New System) -->
                <div style="margin-bottom: 10px; padding: 10px; background: #1e1e1e; border-radius: 4px;">
                    <strong style="color: #569cd6;">Pool/Tonic:</strong>
                    <select id="pool-select" style="margin-left: 10px;">
                        ${this.renderPoolOptions()}
                    </select>
                    <span style="margin: 0 5px;">/</span>
                    <select id="tonic-select">
                        ${this.renderTonicOptions()}
                    </select>
                    <span style="margin-left: 10px; color: #888; font-size: 0.9em;">
                        (Pool: ${displayPoolKey}, Tonic: ${displayTonicName})
                    </span>
                </div>

                <!-- Legacy Key/Scale (for reference) -->
                <details style="margin-bottom: 10px;">
                    <summary style="cursor: pointer; color: #888; font-size: 0.9em;">Legacy Key/Scale Notation</summary>
                    <div style="margin-top: 5px; padding: 5px;">
                        <strong>Key:</strong>
                        <select id="key-select">
                            ${this.renderKeyOptions()}
                        </select>
                        <select id="scale-select">
                            ${this.renderScaleOptions()}
                        </select>
                    </div>
                </details>

                <div style="margin-bottom: 10px;">
                    <strong>Tempo:</strong>
                    <input type="number" id="tempo-input" value="${this.tempo}" min="40" max="240" style="width: 60px;">
                    <span>BPM</span>
                </div>
                <div style="margin-bottom: 10px;">
                    <strong>Transport:</strong>
                    <button id="play-btn" style="background: #0e639c; color: white; border: none; padding: 8px 16px; margin: 0 5px; cursor: pointer; font-size: 14px;">▶ Play</button>
                    <button id="stop-btn" style="background: #0e639c; color: white; border: none; padding: 8px 16px; margin: 0 5px; cursor: pointer; font-size: 14px;">⏹ Stop</button>
                    <button id="rewind-btn" style="background: #0e639c; color: white; border: none; padding: 8px 16px; margin: 0 5px; cursor: pointer; font-size: 14px;">⏮ Rewind</button>
                    <span style="margin-left: 10px; color: #888;">
                        (Controls MIDI clock and visualizer playheads)
                    </span>
                </div>
                <div style="margin-bottom: 10px;">
                    <strong>Mood:</strong>
                    <select id="mood-select">
                        ${this.renderMoodOptions()}
                    </select>
                </div>
                <div style="margin-bottom: 10px;">
                    <strong>Spareness:</strong>
                    <input type="range" id="spareness-slider" min="0" max="100" value="${this.spareness * 100}" style="width: 200px;">
                    <span id="spareness-value">${this.spareness.toFixed(2)}</span>
                </div>
                <div style="margin-bottom: 10px;">
                    <strong>Mode:</strong>
                    <label><input type="radio" name="mode" value="manual" ${this.mode === 'manual' ? 'checked' : ''}> Manual</label>
                    <label><input type="radio" name="mode" value="auto" ${this.mode === 'auto' ? 'checked' : ''}> Auto</label>
                </div>
            </div>
        `;

        this.setupEventHandlers();

        // Re-render target lights after DOM update
        requestAnimationFrame(() => {
            this.renderTargetLights();
        });
    }

    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        // Pool/Tonic selectors (new system)
        this.$('#pool-select').onchange = (e) => {
            const poolKey = e.target.value;

            // Get pool notes and check if current tonic is valid
            const pool = harmonicContext.getNotePool(poolKey);
            const poolPitchClasses = [...new Set(pool.map(n => n % 12))];

            // Determine note naming convention
            const useFlats = poolKey.includes('♭');
            const sharpNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
            const flatNames = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
            const noteNames = useFlats ? flatNames : sharpNames;

            // Check if current tonic is in new pool
            const currentTonicNote = harmonicContext.noteNameToMIDI(this.tonicName || 'C', 4);
            const currentTonicPitchClass = currentTonicNote % 12;

            let tonicName;
            if (poolPitchClasses.includes(currentTonicPitchClass)) {
                // Current tonic is valid, update its name to match convention
                tonicName = noteNames[currentTonicPitchClass];
            } else {
                // Current tonic not in pool, default to first note
                tonicName = noteNames[poolPitchClasses[0]];
            }

            this.setPoolAndTonic(poolKey, tonicName);
            this.render(); // Update UI to show new pool/tonic
        };

        this.$('#tonic-select').onchange = (e) => {
            const tonicName = e.target.value;
            const poolKey = this.poolKey || '0';
            this.setPoolAndTonic(poolKey, tonicName);
            this.render(); // Update UI to show new pool/tonic
        };

        // Legacy key/scale selectors
        const keySelect = this.$('#key-select');
        if (keySelect) {
            keySelect.onchange = (e) => {
                this.setKey(e.target.value, this.initialScale);
            };
        }

        const scaleSelect = this.$('#scale-select');
        if (scaleSelect) {
            scaleSelect.onchange = (e) => {
                this.setKey(this.initialKey, e.target.value);
            };
        }

        this.$('#tempo-input').onchange = (e) => {
            this.setTempo(parseInt(e.target.value));
        };

        this.$('#play-btn').onclick = () => {
            this.play();
        };

        this.$('#stop-btn').onclick = () => {
            this.stop();
        };

        this.$('#rewind-btn').onclick = () => {
            this.rewind();
        };

        this.$('#mood-select').onchange = (e) => {
            this.setMood(e.target.value);
        };

        this.$('#spareness-slider').oninput = (e) => {
            const spareness = parseInt(e.target.value) / 100;
            this.setSpareness(spareness);
            this.$('#spareness-value').textContent = spareness.toFixed(2);
        };

        this.$$('input[name="mode"]').forEach(radio => {
            radio.onchange = (e) => {
                this.mode = e.target.value;
                console.log(`Conductor: Mode set to ${this.mode}`);
            };
        });
    }

    // UI rendering helpers

    renderKeyOptions() {
        const keys = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
        return keys.map(k =>
            `<option value="${k}" ${k === this.initialKey ? 'selected' : ''}>${k}</option>`
        ).join('');
    }

    renderScaleOptions() {
        const scales = [
            ['major', 'Major'],
            ['minor', 'Minor'],
            ['dorian', 'Dorian'],
            ['phrygian', 'Phrygian'],
            ['lydian', 'Lydian'],
            ['mixolydian', 'Mixolydian'],
            ['locrian', 'Locrian']
        ];
        return scales.map(([value, label]) =>
            `<option value="${value}" ${value === this.initialScale ? 'selected' : ''}>${label}</option>`
        ).join('');
    }

    renderMoodOptions() {
        const moods = ['relaxed', 'tense', 'sparse', 'dense'];
        return moods.map(m =>
            `<option value="${m}" ${m === this.mood ? 'selected' : ''}>${m}</option>`
        ).join('');
    }

    renderPoolOptions() {
        const pools = ['6♯', '5♯', '4♯', '3♯', '2♯', '1♯', '0', '1♭', '2♭', '3♭', '4♭', '5♭'];
        const currentPool = this.poolKey || '0';
        return pools.map(p =>
            `<option value="${p}" ${p === currentPool ? 'selected' : ''}>${p}</option>`
        ).join('');
    }

    renderTonicOptions() {
        const poolKey = this.poolKey || '0';
        const pool = harmonicContext.getNotePool(poolKey);

        // Determine if we should use sharps or flats based on pool key
        const useFlats = poolKey.includes('♭');

        // Get unique pitch classes from pool
        const poolPitchClasses = [...new Set(pool.map(n => n % 12))].sort((a, b) => a - b);

        // Note names (sharps and flats)
        const sharpNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
        const flatNames = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
        const noteNames = useFlats ? flatNames : sharpNames;

        // Build options for only the notes in the pool
        const tonics = poolPitchClasses.map(pc => {
            const noteName = noteNames[pc];
            return [noteName, noteName]; // [display, value]
        });

        const currentTonic = this.tonicName || this.initialKey || 'C';
        return tonics.map(([label, value]) =>
            `<option value="${value}" ${value === currentTonic ? 'selected' : ''}>${label}</option>`
        ).join('');
    }
}

// Register custom element
customElements.define('sonofire-conductor', SonofireConductor);
