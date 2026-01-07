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
        this.density = 0.5; // 0.0 (sparse) → 1.0 (full/dense)

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
            // In auto mode, listen to data events to adjust mood/density
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

        // Register density parameter
        this.registerWhippableParameter('density', {
            label: 'Density',
            parameterType: 'number',
            min: 0.0,
            max: 1.0,
            elementSelector: '#density-slider',
            setter: (value) => {
                this.setDensity(value);
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
            // Convert legacy key/scale notation to pool/tonic
            const { poolKey, tonicName } = harmonicContext.keyScaleToPoolTonic(
                this.initialKey,
                this.initialScale
            );
            console.log(`Conductor: Converting legacy "${this.initialKey} ${this.initialScale}" → pool/tonic "${poolKey}/${tonicName}"`);
            this.setPoolAndTonic(poolKey, tonicName);
        }

        // Publish initial mood and density
        this.setMood(this.mood);
        this.setDensity(this.density);

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

        // Adjust density based on region intensity
        if (type === 'hot' && intensity > 0.7) {
            this.setDensity(0.8); // Dense playing
        } else if (type === 'cold' || intensity < 0.3) {
            this.setDensity(0.2); // Sparse playing
        }
    }

    /**
     * Get friendly key name from pool/tonic notation
     * E.g., "3♯/A" → "A Ionian (major)", "3♯/C♯" → "C♯ Phrygian"
     * @returns {string} Friendly key name with mode
     */
    getFriendlyKeyName() {
        if (!this.poolKey || !this.tonicName) {
            return 'C Ionian (major)';
        }

        // Get the pool notes
        const pool = harmonicContext.getNotePool(this.poolKey);
        if (!pool || pool.length === 0) {
            return `${this.tonicName} Ionian (major)`;
        }

        // Get unique pitch classes from the pool
        const poolPitchClasses = [...new Set(pool.map(n => n % 12))];

        // Map pool key to its major tonic (Ionian degree)
        const poolToMajorTonic = {
            '0': 0,      // C
            '1♯': 7,     // G
            '2♯': 2,     // D
            '3♯': 9,     // A
            '4♯': 4,     // E
            '5♯': 11,    // B
            '6♯': 6,     // F♯
            '1♭': 5,     // F
            '2♭': 10,    // B♭
            '3♭': 3,     // E♭
            '4♭': 8,     // A♭
            '5♭': 1      // D♭
        };

        const majorTonicPC = poolToMajorTonic[this.poolKey];
        if (majorTonicPC === undefined) {
            return `${this.tonicName} (unknown pool)`;
        }

        // Order pitch classes starting from the major tonic
        const orderedPitchClasses = [];
        for (let i = 0; i < 7; i++) {
            const pc = (majorTonicPC + [0, 2, 4, 5, 7, 9, 11][i]) % 12;
            if (poolPitchClasses.includes(pc)) {
                orderedPitchClasses.push(pc);
            }
        }

        // Convert tonic name to pitch class
        const tonicNote = harmonicContext.noteNameToMIDI(this.tonicName, 4);
        const tonicPitchClass = tonicNote % 12;

        // Find which degree this tonic is in the ordered pool
        const degree = orderedPitchClasses.indexOf(tonicPitchClass);

        if (degree === -1) {
            // Tonic not in pool - shouldn't happen, but handle gracefully
            return `${this.tonicName} (not in pool)`;
        }

        // Map degree (0-6) to mode name
        const modeNames = [
            'Ionian (major)',    // 1st degree
            'Dorian',            // 2nd degree
            'Phrygian',          // 3rd degree
            'Lydian',            // 4th degree
            'Mixolydian',        // 5th degree
            'Aeolian (minor)',   // 6th degree
            'Locrian'            // 7th degree
        ];

        const modeName = modeNames[degree] || 'Unknown';

        return `${this.tonicName} ${modeName}`;
    }

    /**
     * Set pool and tonic center (new notation)
     * @param {string} poolKey - Pool key (e.g., "3♯", "0", "2♭")
     * @param {string} tonicName - Tonic note name (e.g., "A", "C♯")
     */
    setPoolAndTonic(poolKey, tonicName) {
        console.log(`Conductor: setPoolAndTonic() called with poolKey="${poolKey}", tonicName="${tonicName}"`);

        this.poolKey = poolKey;
        this.tonicName = tonicName;

        // Convert tonic name to MIDI note
        const tonicNote = harmonicContext.noteNameToMIDI(tonicName, 4);

        console.log(`Conductor: Converted tonicName "${tonicName}" to MIDI note ${tonicNote}`);
        console.log(`Conductor: Calling harmonicContext.setPoolAndTonic()`);

        // Update harmonic context service
        harmonicContext.setPoolAndTonic(poolKey, tonicNote, tonicName);

        console.log(`Conductor: Pool/Tonic set to ${poolKey}/${tonicName} (MIDI ${tonicNote})`);
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
     * Set the density level
     */
    setDensity(density) {
        // Clamp to 0.0-1.0
        this.density = Math.max(0, Math.min(1, density));

        this.publish('context:density', { density: this.density });

        console.log(`Conductor: Density set to ${this.density.toFixed(2)}`);
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
        const friendlyKeyName = this.getFriendlyKeyName();

        this.innerHTML = `
            <div style="background: #2d2d2d; padding: 15px; margin: 10px 0; border-left: 3px solid #4ec9b0;">
                <h3 style="margin: 0 0 10px 0; color: #4ec9b0;">🎼 Conductor</h3>

                <!-- Pool/Tonic Notation (Primary System) -->
                <div style="margin-bottom: 10px; padding: 10px; background: #1e1e1e; border-radius: 4px;">
                    <strong style="color: #569cd6;">Key:</strong>
                    <select id="pool-select" style="margin-left: 10px;">
                        ${this.renderPoolOptions()}
                    </select>
                    <span style="margin: 0 5px;">/</span>
                    <select id="tonic-select">
                        ${this.renderTonicOptions()}
                    </select>
                    <span style="margin-left: 10px; color: #4ec9b0; font-weight: bold;">
                        ${friendlyKeyName}
                    </span>
                    <span style="margin-left: 5px; color: #666; font-size: 0.85em;">
                        (${displayPoolKey}/${displayTonicName})
                    </span>
                </div>

                <!-- Legacy Key/Scale (hidden by default, for backward compatibility) -->
                <details style="margin-bottom: 10px; display: none;">
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
                    <strong>Density:</strong>
                    <input type="range" id="density-slider" min="0" max="100" value="${this.density * 100}" style="width: 200px;">
                    <span id="density-value">${this.density.toFixed(2)}</span>
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

        // Legacy key/scale selectors - convert to pool/tonic
        const keySelect = this.$('#key-select');
        if (keySelect) {
            keySelect.onchange = (e) => {
                const { poolKey, tonicName } = harmonicContext.keyScaleToPoolTonic(
                    e.target.value,
                    this.initialScale
                );
                console.log(`Conductor: Legacy key selector changed to ${e.target.value} ${this.initialScale} → ${poolKey}/${tonicName}`);
                this.setPoolAndTonic(poolKey, tonicName);
                this.render();
            };
        }

        const scaleSelect = this.$('#scale-select');
        if (scaleSelect) {
            scaleSelect.onchange = (e) => {
                const { poolKey, tonicName } = harmonicContext.keyScaleToPoolTonic(
                    this.initialKey,
                    e.target.value
                );
                console.log(`Conductor: Legacy scale selector changed to ${this.initialKey} ${e.target.value} → ${poolKey}/${tonicName}`);
                this.setPoolAndTonic(poolKey, tonicName);
                this.render();
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

        this.$('#density-slider').oninput = (e) => {
            const density = parseInt(e.target.value) / 100;
            this.setDensity(density);
            this.$('#density-value').textContent = density.toFixed(2);
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
