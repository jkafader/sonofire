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
        this.timeSignature = '4/4'; // '2/4' | '3/4' | '4/4' | '5/4' | '6/8'

        // Pool/tonic notation (new system)
        this.poolKey = null;     // e.g., "3♯", "0", "2♭"
        this.tonicName = null;   // e.g., "A", "C♯"
        this.scaleType = 'diatonic';  // 'diatonic' | 'pentatonic' | 'blues' | 'octatonic' | 'chromatic'
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
            'data-scale-type',
            'data-tempo',
            'data-mode',
            'data-time-signature'
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
        this.scaleType = this.getAttribute('data-scale-type') || 'diatonic';

        // Legacy key/scale notation (backward compatibility)
        this.initialKey = this.getAttribute('data-initial-key') || 'C';
        this.initialScale = this.getAttribute('data-initial-scale') || 'major';

        this.tempo = parseInt(this.getAttribute('data-tempo')) || 120;
        this.mode = this.getAttribute('data-mode') || 'manual';
        this.timeSignature = this.getAttribute('data-time-signature') || '4/4';
    }

    /**
     * Setup subscriptions
     */
    setupSubscriptions() {
        super.setupSubscriptions();

        // Subscribe to tempo changes from sections
        this.subscribe('context:tempo', (data) => {
            if (data.bpm && data.bpm !== this.tempo) {
                this.setTempo(data.bpm);
            }
        }, this);

        // Subscribe to pool/tonic changes from sections
        this.subscribe('context:pool', (data) => {
            if (data.poolKey && data.tonicName) {
                // Check if values actually changed to avoid infinite loops
                if (data.poolKey !== this.poolKey || data.tonicName !== this.tonicName) {
                    this.poolKey = data.poolKey;
                    this.tonicName = data.tonicName;
                    this.tonicNote = data.tonicNote;

                    // Update UI dropdowns
                    this.updatePoolTonicDropdowns();
                }
            }
        }, this);

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

        // Register mood parameter (sorted from quietest to loudest)
        this.registerWhippableParameter('mood', {
            label: 'Mood',
            parameterType: 'select',
            options: ['sparse', 'relaxed', 'dense', 'tense'],
            elementSelector: '#mood-select',
            setter: (value) => {
                const moods = ['sparse', 'relaxed', 'dense', 'tense']; // quietest → loudest
                const index = Math.floor(value * moods.length);
                const mood = moods[Math.min(index, moods.length - 1)];

                // Only update if mood actually changed
                if (mood !== this.mood) {
                    this.setMood(mood);
                    // No render() - setMood() already updates the dropdown
                }
            }
        });

        // Register timeSignature parameter
        this.registerWhippableParameter('timeSignature', {
            label: 'Time Signature',
            parameterType: 'select',
            options: ['2/4', '3/4', '4/4', '5/4', '6/8'],
            elementSelector: '#time-signature-select',
            icon: '🎵',
            setter: (value) => {
                const options = ['2/4', '3/4', '4/4', '5/4', '6/8'];
                const index = Math.floor(value * options.length);
                const timeSignature = options[Math.min(index, options.length - 1)];

                // Only update if time signature actually changed
                if (timeSignature !== this.timeSignature) {
                    this.setTimeSignature(timeSignature);
                    // No render() - setTimeSignature() already updates the dropdown
                }
            }
        });

        // Register notePool parameter
        this.registerWhippableParameter('notePool', {
            label: 'Note Pool',
            parameterType: 'select',
            elementSelector: '#pool-select',
            icon: '🎹',
            setter: (value) => {
                // Get pool keys from harmonicContext
                const poolKeys = ['6♯', '5♯', '4♯', '3♯', '2♯', '1♯', '0', '1♭', '2♭', '3♭', '4♭', '5♭', ];
                const index = Math.floor(value * poolKeys.length);
                const poolKey = poolKeys[Math.min(index, poolKeys.length - 1)];

                // Only update if the pool actually changed
                if (poolKey !== this.poolKey && this.tonicName) {
                    // Get the new pool notes
                    const pool = harmonicContext.getNotePool(poolKey);
                    const poolPitchClasses = [...new Set(pool.map(n => n % 12))];

                    // Get the base letter name (without sharps/flats)
                    const baseLetter = this.tonicName.charAt(0);

                    // Find a note in the pool that starts with the same letter
                    const noteNames = ['C', 'C♯', 'D♭', 'D', 'D♯', 'E♭', 'E', 'F', 'F♯', 'G♭', 'G', 'G♯', 'A♭', 'A', 'A♯', 'B♭', 'B'];
                    const pitchClassMap = {
                        'C': 0, 'C♯': 1, 'D♭': 1, 'D': 2, 'D♯': 3, 'E♭': 3, 'E': 4,
                        'F': 5, 'F♯': 6, 'G♭': 6, 'G': 7, 'G♯': 8, 'A♭': 8, 'A': 9, 'A♯': 10, 'B♭': 10, 'B': 11
                    };

                    // Find notes in pool that start with the same letter
                    const matchingNotes = noteNames.filter(name => {
                        return name.charAt(0) === baseLetter && poolPitchClasses.includes(pitchClassMap[name]);
                    });

                    // Use matching note if found, otherwise keep current tonic (even if not in pool)
                    const newTonic = matchingNotes.length > 0 ? matchingNotes[0] : this.tonicName;

                    this.setPoolAndTonic(poolKey, newTonic);
                    // No render() - setPoolAndTonic() already updates dropdowns
                }
            }
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

        // Publish initial mood, density, and time signature
        this.setMood(this.mood);
        this.setDensity(this.density);
        this.setTimeSignature(this.timeSignature);

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
     * Get description for scale type
     * @returns {string} Description of the scale type
     */
    getScaleTypeDescription(scaleType) {
        const descriptions = {
            'diatonic': 'Standard 7-tone scale (Do-Re-Mi-Fa-Sol-La-Ti)',
            'pentatonic': '5-tone scale (Do-Re-Mi-Sol-La)',
            'blues': 'Pentatonic + tritone (adds ♯4/♭5)',
            'octatonic': 'Alternating whole-half steps (W-H-W-H-W-H-W-H)',
            'chromatic': 'All 12 semitones'
        };
        return descriptions[scaleType] || '';
    }

    /**
     * Set pool and tonic center (new notation)
     * @param {string} poolKey - Pool key (e.g., "3♯", "0", "2♭")
     * @param {string} tonicName - Tonic note name (e.g., "A", "C♯")
     * @param {string} scaleType - Scale type (optional, defaults to current)
     */
    setPoolAndTonic(poolKey, tonicName, scaleType = null) {
        console.log(`Conductor: setPoolAndTonic() called with poolKey="${poolKey}", tonicName="${tonicName}", scaleType="${scaleType || this.scaleType}"`);

        this.poolKey = poolKey;
        this.tonicName = tonicName;
        if (scaleType) {
            this.scaleType = scaleType;
        }

        // Convert tonic name to MIDI note
        const tonicNote = harmonicContext.noteNameToMIDI(tonicName, 4);

        console.log(`Conductor: Converted tonicName "${tonicName}" to MIDI note ${tonicNote}`);
        console.log(`Conductor: Calling harmonicContext.setPoolAndTonic()`);

        // Update harmonic context service
        harmonicContext.setPoolAndTonic(poolKey, tonicNote, tonicName, this.scaleType);

        console.log(`Conductor: Pool/Tonic/ScaleType set to ${poolKey}/${tonicName}/${this.scaleType} (MIDI ${tonicNote})`);

        // Update dropdowns directly (no full re-render)
        this.updatePoolTonicDropdowns();
    }

    /**
     * Update pool and tonic dropdowns without full re-render
     */
    updatePoolTonicDropdowns() {
        // Update pool dropdown
        const poolSelect = this.$('#pool-select');
        if (poolSelect) {
            poolSelect.value = this.poolKey || '0';
        }

        // Update tonic dropdown options (pool change affects available tonics)
        const tonicSelect = this.$('#tonic-select');
        if (tonicSelect) {
            const poolKey = this.poolKey || '0';
            const pool = harmonicContext.getNotePool(poolKey);
            const poolPitchClasses = [...new Set(pool.map(n => n % 12))].sort((a, b) => a - b);

            // Determine note naming convention
            const useFlats = poolKey.includes('♭');
            const sharpNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
            const flatNames = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
            const noteNames = useFlats ? flatNames : sharpNames;

            // Rebuild tonic options
            const options = poolPitchClasses.map(pc => {
                const noteName = noteNames[pc];
                const selected = noteName === this.tonicName ? 'selected' : '';
                return `<option value="${noteName}" ${selected}>${noteName}</option>`;
            }).join('');

            tonicSelect.innerHTML = options;
        }
    }

    /**
     * Set the mood
     */
    setMood(mood) {
        this.mood = mood;

        this.publish('context:mood', { mood });

        console.log(`Conductor: Mood set to ${mood}`);

        // Update UI to show new mood
        const moodSelect = this.$('#mood-select');
        if (moodSelect) {
            moodSelect.value = mood;
        }
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
     * Set the time signature
     */
    setTimeSignature(timeSignature) {
        this.timeSignature = timeSignature;

        // Parse time signature to get beats and note value
        const [beatsPerBar, noteValue] = timeSignature.split('/').map(n => parseInt(n));

        // Calculate sixteenths per bar (varies by time signature)
        let sixteenthsPerBar;
        if (noteValue === 8 && beatsPerBar === 6) {
            // 6/8 time: 2 dotted quarter beats, 12 sixteenth notes per bar
            sixteenthsPerBar = 12;
        } else {
            // Standard time signatures: beatsPerBar * 4 sixteenths
            sixteenthsPerBar = beatsPerBar * 4;
        }

        this.publish('context:timeSignature', {
            timeSignature,
            beatsPerBar,
            noteValue,
            sixteenthsPerBar
        });

        console.log(`Conductor: Time signature set to ${timeSignature} (${sixteenthsPerBar} sixteenths per bar)`);

        // Update UI to show new time signature
        const timeSignatureSelect = this.$('#time-signature-select');
        if (timeSignatureSelect) {
            timeSignatureSelect.value = timeSignature;
        }
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

        // Update UI to show new tempo (just update the input value)
        const tempoInput = this.$('#tempo-input');
        if (tempoInput) {
            tempoInput.value = bpm;
        }
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
            <div class="sf-component sf-component-conductor">
                <h3 class="sf-component-header sf-component-header-conductor">Conductor</h3>

                <div class="sf-controls">
                    <table>
                        <tr>
                            <th>
                                Transport
                            </th>
                            <th>
                                Time
                            </th>
                            <th>
                                Pool
                            </th>
                            <th>
                                Tonic
                            </th>
                            <th>
                                Scale
                            </th>
                        </tr>
                        <tr>
                            <td>
                                <button id="play-btn" class="sf-button sf-button-success" style="margin: 0 5px;">▶</button>
                                <button id="stop-btn" class="sf-button sf-button-danger" style="margin: 0 5px;">⏹</button>
                                <button id="rewind-btn" class="sf-button sf-button-secondary" style="margin: 0 5px;">⏮</button>
                            </td>
                            <td>
                                <label class="sf-label">
                                    <input type="number" id="tempo-input" value="${this.tempo}" style="width:30px" min="40" max="240" class="sf-input">
                                    <span>BPM</span><strong>${this.getTargetLightHTML('tempo')}</strong>
                                </label>&nbsp;
                                <label class="sf-label">
                                    <select id="time-signature-select" class="sf-select">
                                        ${this.renderTimeSignatureOptions()}
                                    </select>
                                    <strong>${this.getTargetLightHTML('timeSignature')}</strong>
                                </label>
                            </td>
                            <td>
                                <!--${this.getTargetLightHTML('notePool')}-->
                                <select id="pool-select" class="sf-select" style="width:50px;">
                                    ${this.renderPoolOptions()}
                                </select>
                            </td>
                            <td>
                                <select id="tonic-select" class="sf-select" style="width:50px;">
                                    ${this.renderTonicOptions()}
                                </select>
                            </td>
                            <td>
                                <select id="scale-type-select" class="sf-select">
                                    <option value="diatonic" ${this.scaleType === 'diatonic' ? 'selected' : ''}>Diatonic</option>
                                    <option value="pentatonic" ${this.scaleType === 'pentatonic' ? 'selected' : ''}>Pentatonic</option>
                                    <option value="blues" ${this.scaleType === 'blues' ? 'selected' : ''}>Blues</option>
                                    <option value="octatonic" ${this.scaleType === 'octatonic' ? 'selected' : ''}>Octatonic</option>
                                    <option value="chromatic" ${this.scaleType === 'chromatic' ? 'selected' : ''}>Chromatic</option>
                                </select>
                            </td>
                        </tr>
                    </table>

                </div>

                <!-- Pool/Tonic Notation (Primary System) -->
                <!--div class="sf-controls">
                    <div style="margin-bottom: 8px;">
                        <!--span style="margin-left: 10px; font-weight: bold;" class="sf-text-conductor">
                            ${friendlyKeyName}
                        </span>
                        <span style="margin-left: 5px;" class="sf-text-secondary">
                            (${displayPoolKey}/${displayTonicName})
                        </span>
                    </div>
                    <div>
                        <strong class="sf-text-conductor">Scale Type:</strong>
                        <!--span style="margin-left: 10px;" class="sf-info-text">
                            ${this.getScaleTypeDescription(this.scaleType)}
                        </span>
                    </div>
                </div-->

                <!-- Legacy Key/Scale (hidden by default, for backward compatibility) -->
                <!--details style="margin-bottom: 10px; display: none;">
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
                </details-->

                <div class="sf-controls">
                    <table>
                        <tr>
                            <th>
                                Master Mood
                            </th>
                            <th>
                                Master Density
                            </th>
                        </tr>
                        <tr>
                            <td>
                                <strong>${this.getTargetLightHTML('mood')}</strong>
                                <select id="mood-select" class="sf-select">
                                    ${this.renderMoodOptions()}
                                </select>
                            </td>
                            <td>
                                <strong>${this.getTargetLightHTML('density')}</strong>
                                <input type="range" id="density-slider" min="0" max="100" value="${this.density * 100}" style="width: 200px;">
                                <span id="density-value" style="font-size:10px;">${this.density.toFixed(2)}</span>
                            </td>
                        </tr>
                    </td>
                </div>
            </div>
        `;

        this.setupEventHandlers();

        // Sync target light colors with existing bindings
        this.syncTargetLightColors();
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
            // No render() - setPoolAndTonic() already updates dropdowns
        };

        this.$('#tonic-select').onchange = (e) => {
            const tonicName = e.target.value;
            const poolKey = this.poolKey || '0';
            this.setPoolAndTonic(poolKey, tonicName);
            // No render() - setPoolAndTonic() already updates dropdowns
        };

        this.$('#scale-type-select').onchange = (e) => {
            const scaleType = e.target.value;
            const poolKey = this.poolKey || '0';
            const tonicName = this.tonicName || 'C';
            this.setPoolAndTonic(poolKey, tonicName, scaleType);
            // Re-render to update description
            this.render();
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
                // No render() - setPoolAndTonic() already updates dropdowns
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
                // No render() - setPoolAndTonic() already updates dropdowns
            };
        }

        this.$('#tempo-input').onchange = (e) => {
            this.setTempo(parseInt(e.target.value));
        };

        this.$('#time-signature-select').onchange = (e) => {
            this.setTimeSignature(e.target.value);
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
        const moods = ['sparse', 'relaxed', 'dense', 'tense']; // quietest → loudest
        return moods.map(m =>
            `<option value="${m}" ${m === this.mood ? 'selected' : ''}>${m}</option>`
        ).join('');
    }

    renderTimeSignatureOptions() {
        const timeSignatures = ['2/4', '3/4', '4/4', '5/4', '6/8'];
        return timeSignatures.map(ts =>
            `<option value="${ts}" ${ts === this.timeSignature ? 'selected' : ''}>${ts}</option>`
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
