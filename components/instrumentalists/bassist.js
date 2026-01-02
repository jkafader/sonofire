import { BaseInstrumentalist } from './base_instrumentalist.js';
import { weightedRandomSelect, chromaticApproach } from '../../lib/generative_algorithms.js';

/**
 * Bassist Component
 * Generates bass lines following chord changes
 * Supports root notes, walking bass, and pedal tones
 */
export class SonofireBassist extends BaseInstrumentalist {
    constructor() {
        super();

        // Bassist-specific settings
        this.channel = 1;                 // MIDI channel 1 for plucked string synthesis
        this.bassStyle = 'walking';       // 'roots', 'walking', 'pedal'
        this.walkingDensity = 0.75;       // How often to play (0.0-1.0)

        // Note range settings
        this.noteRange = 'low';           // 'very-low', 'low', 'mid-low', 'mid'
        this.minNote = 24;                // Minimum bass note (C1)
        this.maxNote = 48;                // Maximum bass note (C3)

        // Performance state
        this.lastBeat = -1;
        this.currentBassNote = null;
        this.nextChordRoot = null;        // For chromatic approaches
        this.beatInBar = 0;               // Track position in bar
    }

    /**
     * Set note range
     * @param {string} range - Range preset ('very-low', 'low', 'mid-low', 'mid')
     */
    setNoteRange(range) {
        this.noteRange = range;

        switch (range) {
            case 'very-low':
                this.minNote = 24;  // C1
                this.maxNote = 36;  // C2
                break;
            case 'low':
                this.minNote = 28;  // E1
                this.maxNote = 48;  // C3
                break;
            case 'mid-low':
                this.minNote = 36;  // C2
                this.maxNote = 60;  // C4
                break;
            case 'mid':
                this.minNote = 48;  // C3
                this.maxNote = 72;  // C5
                break;
            default:
                this.minNote = 28;  // E1
                this.maxNote = 48;  // C3
        }

        console.log(`Bassist: Range set to ${range} (${this.minNote}-${this.maxNote})`);
        this.render(); // Update UI to reflect new range
    }

    /**
     * Convert chord root to bass octave
     * @param {number} root - Root MIDI note
     * @returns {number} Bass note in proper octave
     */
    toBassOctave(root) {
        // Get pitch class (0-11)
        const pitchClass = root % 12;

        // Find the note within our range
        let bassNote = pitchClass;

        // Move up to minimum note
        while (bassNote < this.minNote) {
            bassNote += 12;
        }

        // If we're above max, go down
        while (bassNote > this.maxNote) {
            bassNote -= 12;
        }

        // Final safety check - if still out of range, clamp
        if (bassNote < this.minNote) {
            bassNote = this.minNote;
        }
        if (bassNote > this.maxNote) {
            bassNote = this.maxNote;
        }

        return bassNote;
    }

    /**
     * Specify which attributes to observe
     */
    static get observedAttributes() {
        return [
            ...super.observedAttributes,
            'data-bass-style',
            'data-note-range',
            'data-density'
        ];
    }

    /**
     * Parse attributes
     */
    parseAttributes() {
        super.parseAttributes();

        this.bassStyle = this.getAttribute('data-bass-style') || 'walking';
        this.walkingDensity = parseFloat(this.getAttribute('data-density')) || 0.75;

        // Set note range
        const range = this.getAttribute('data-note-range') || 'low';
        this.setNoteRange(range);
    }

    /**
     * Setup subscriptions
     */
    setupSubscriptions() {
        super.setupSubscriptions();

        // Subscribe to clock ticks for timing
        this.subscribe('clock:tick', (data) => {
            this.handleClockTick(data);
        });

        // Subscribe to chord changes to update bass line
        this.subscribe('music:chord', (data) => {
            this.handleChordChange(data);
            // When chord changes, we're at the start of a new section
            this.beatInBar = 0;
        });
    }

    /**
     * Initialize when connected
     */
    connectedCallback() {
        super.connectedCallback();

        // Register whippable parameters (after render)
        this.registerWhippableParameters();
    }

    /**
     * Register parameters as whip targets
     */
    registerWhippableParameters() {
        // Register Note Generation pulse
        // 'pulse' type triggers on EVERY value update from playhead
        this.registerWhippableParameter('noteGeneration', {
            label: 'Note Generation',
            parameterType: 'pulse',
            icon: '🎶',
            customPosition: 'strong', // Position after component name
            setter: () => {
                // Play currently-selected bass note
                this.playCurrentBassNote();
            }
        });

        // Register Bass Style parameter (select)
        this.registerWhippableParameter('bassStyle', {
            label: 'Bass Style',
            parameterType: 'select',
            elementSelector: '#style-select',
            setter: (value) => {
                // Map 0-1 to style options
                const styles = ['roots', 'walking', 'pedal'];
                const index = Math.floor(value * styles.length);
                const clampedIndex = Math.min(index, styles.length - 1);
                this.bassStyle = styles[clampedIndex];
                this.render();
            }
        });

        // Register Note Range parameter (select)
        this.registerWhippableParameter('noteRange', {
            label: 'Note Range',
            parameterType: 'select',
            elementSelector: '#range-select',
            setter: (value) => {
                // Map 0-1 to range options
                const ranges = ['very-low', 'low', 'mid-low', 'mid'];
                const index = Math.floor(value * ranges.length);
                const clampedIndex = Math.min(index, ranges.length - 1);
                this.setNoteRange(ranges[clampedIndex]);
            }
        });

        // Register Density parameter
        this.registerWhippableParameter('density', {
            label: 'Density',
            parameterType: 'number',
            min: 0,
            max: 1,
            elementSelector: '#density-slider',
            setter: (value) => {
                this.walkingDensity = value;
                this.render();
            }
        });

        // Render target lights after component is fully rendered
        requestAnimationFrame(() => {
            this.renderTargetLights();
        });
    }

    /**
     * Play current bass note (triggered by whip automation)
     */
    playCurrentBassNote() {
        if (!this.enabled || !this.currentChord) return;

        let note;

        // Use current bass style to determine which note to play
        switch (this.bassStyle) {
            case 'roots':
                note = this.toBassOctave(this.currentChord.root);
                break;
            case 'walking':
                note = this.playWalking(this.beatInBar);
                break;
            case 'pedal':
                note = this.currentBassNote || this.toBassOctave(this.currentChord.root);
                break;
            default:
                note = this.toBassOctave(this.currentChord.root);
        }

        if (note) {
            const velocity = 90;
            const duration = 400;
            this.sendNote(note, velocity, duration);
            this.currentBassNote = note;
            console.log(`Bassist: Played note ${note} (style: ${this.bassStyle})`);
        }
    }

    /**
     * Handle chord change - prepare for next chord
     */
    handleChordChange(chordData) {
        super.handleChordChange(chordData);

        // For chromatic approaches, we want to know the next chord root
        // (This would ideally come from Composer, but we can infer or wait)
        this.nextChordRoot = null; // Reset until we know next chord
    }

    /**
     * Handle clock tick - play bass notes on beats
     */
    handleClockTick(clockData) {
        if (!this.enabled) return;

        const { tick, ppqn } = clockData;

        // Play on quarter notes (beats)
        if (tick % ppqn === 0) {
            const beat = Math.floor(tick / ppqn);

            // Prevent duplicate processing
            if (beat === this.lastBeat) return;
            this.lastBeat = beat;

            // Calculate beat in bar (assuming 4/4 time)
            this.beatInBar = beat % 4; // 0, 1, 2, 3

            // Generate bass note based on style
            this.playBassNote(this.beatInBar);
        }
    }

    /**
     * Play bass note for current beat
     * @param {number} beatInBar - Beat position (0-3 for 4/4 time)
     */
    playBassNote(beatInBar) {
        if (!this.currentChord) return;

        let note;

        switch (this.bassStyle) {
            case 'roots':
                note = this.playRoots(beatInBar);
                break;
            case 'walking':
                note = this.playWalking(beatInBar);
                break;
            case 'pedal':
                note = this.playPedal(beatInBar);
                break;
            default:
                note = this.playRoots(beatInBar);
        }

        if (note) {
            // Calculate velocity (bass is usually consistent, slightly varied)
            const velocity = this.calculateBassVelocity(beatInBar);

            // Duration: Quarter notes, slightly shorter for articulation
            const duration = 400;

            this.sendNote(note, velocity, duration);
            this.currentBassNote = note;
        }
    }

    /**
     * Play root notes style - root on beat 1, fifth on beat 3
     * @param {number} beatInBar
     * @returns {number} MIDI note
     */
    playRoots(beatInBar) {
        const root = this.currentChord.root;
        const bassRoot = this.toBassOctave(root);

        if (beatInBar === 0 || beatInBar === 2) {
            // Beat 1 and 3: Play root
            return bassRoot;
        } else if (beatInBar === 1) {
            // Beat 2: Play fifth (ensure it's in range)
            const fifth = this.toBassOctave(root + 7);
            return fifth;
        } else {
            // Beat 4: Back to root
            return bassRoot;
        }
    }

    /**
     * Play walking bass style - algorithmic bass line
     * @param {number} beatInBar
     * @returns {number} MIDI note
     */
    playWalking(beatInBar) {
        const root = this.currentChord.root;
        const voicing = this.currentChord.voicing || [];
        const bassRoot = this.toBassOctave(root);

        // Density check - sometimes skip notes when sparse
        const playProbability = this.walkingDensity * (1.0 - this.spareness * 0.5);
        if (beatInBar !== 0 && Math.random() > playProbability) {
            return null; // Skip this beat
        }

        // Beat 1: Always play root
        if (beatInBar === 0) {
            return bassRoot;
        }

        // For other beats, use weighted selection
        const candidates = [];
        const weights = [];

        // Available notes from chord and scale
        const chordTones = voicing.map(n => n % 12);
        const scaleTones = this.currentScale.map(n => n % 12);

        // Build bass range (1.5 octaves around bass root, staying below maxNote)
        const bassRange = [];
        for (let note = 24; note <= this.maxNote; note++) {
            bassRange.push(note);
        }

        // Weight different note choices
        bassRange.forEach(note => {
            const pitchClass = note % 12;
            const rootPC = root % 12;

            let weight = 0.01; // Base weight for chromatic notes

            // Root: 40% weight
            if (pitchClass === rootPC) {
                weight = 0.40;
            }
            // Fifth: 30% weight
            else if (pitchClass === (rootPC + 7) % 12) {
                weight = 0.30;
            }
            // Chord tones: 20% weight
            else if (chordTones.includes(pitchClass)) {
                weight = 0.20;
            }
            // Scale tones: 5% weight
            else if (scaleTones.includes(pitchClass)) {
                weight = 0.05;
            }
            // Chromatic approach to root (half-step below): 10% weight
            else if (this.currentBassNote && pitchClass === (rootPC - 1 + 12) % 12) {
                weight = 0.10;
            }

            // Favor stepwise motion from last note
            if (this.currentBassNote) {
                const interval = Math.abs(note - this.currentBassNote);
                if (interval <= 2) {
                    weight *= 1.5; // Boost stepwise motion
                } else if (interval >= 7) {
                    weight *= 0.5; // Reduce large leaps
                }
            }

            candidates.push(note);
            weights.push(weight);
        });

        // Select weighted random note
        return weightedRandomSelect(candidates, weights);
    }

    /**
     * Play pedal tone style - stay on one note
     * @param {number} beatInBar
     * @returns {number} MIDI note
     */
    playPedal(beatInBar) {
        const root = this.currentChord.root;
        const bassRoot = this.toBassOctave(root);

        // Pedal tone: Always play the same note (usually root)
        // Only play on beats 1 and 3 when sparse
        if (this.spareness > 0.5 && (beatInBar === 1 || beatInBar === 3)) {
            return null; // Skip beats 2 and 4 when sparse
        }

        return bassRoot;
    }

    /**
     * Calculate bass velocity based on beat position
     * @param {number} beatInBar
     * @returns {number} MIDI velocity
     */
    calculateBassVelocity(beatInBar) {
        let baseVelocity;

        // Mood affects overall volume
        switch (this.mood) {
            case 'tense':
                baseVelocity = 95;
                break;
            case 'relaxed':
                baseVelocity = 75;
                break;
            case 'sparse':
                baseVelocity = 65;
                break;
            case 'dense':
                baseVelocity = 85;
                break;
            default:
                baseVelocity = 80;
        }

        // Accent downbeats slightly
        if (beatInBar === 0) {
            baseVelocity += 10;
        }

        // Add slight variation
        const variation = Math.floor(Math.random() * 8) - 4;
        return Math.max(40, Math.min(127, baseVelocity + variation));
    }

    /**
     * Render UI
     */
    render() {
        this.innerHTML = `
            <div style="background: #2d2d2d; padding: 10px; margin: 5px 0; border-left: 3px solid #608b4e;">
                <strong style="color: #608b4e;">🎸 Bassist</strong>
                <span style="margin-left: 10px; color: #888;">
                    Channel:
                    <select id="channel-select" style="margin: 0 5px;">
                        ${this.renderChannelOptions()}
                    </select>
                    | Style:
                    <select id="style-select" style="margin: 0 5px;">
                        ${this.renderStyleOptions()}
                    </select>
                    | Range:
                    <select id="range-select" style="margin: 0 5px;">
                        ${this.renderRangeOptions()}
                    </select>
                    | Density:
                    <input type="range" id="density-slider" min="0" max="100" value="${this.density * 100}" style="width: 100px; vertical-align: middle;">
                    <span style="margin-left: 5px;">${Math.round(this.density * 100)}%</span>
                    | <button id="mute-btn" style="padding: 2px 8px; margin: 0 5px;">${this.muted ? '🔇 Unmute' : '🔊 Mute'}</button>
                    | <button id="debug-btn" style="padding: 2px 8px; margin: 0 5px;">${this.debug ? '🐛 Debug OFF' : '🐛 Debug'}</button>
                    | ${this.enabled ? '✓ Enabled' : '✗ Disabled'}
                </span>
            </div>
        `;

        // Setup event handlers
        this.$('#channel-select').onchange = (e) => {
            this.setChannel(parseInt(e.target.value));
        };

        this.$('#style-select').onchange = (e) => {
            this.bassStyle = e.target.value;
            console.log(`Bassist: Style changed to ${this.bassStyle}`);
            this.render();
        };

        this.$('#range-select').onchange = (e) => {
            this.setNoteRange(e.target.value);
        };

        this.$('#density-slider').oninput = (e) => {
            this.density = parseInt(e.target.value) / 100;
            this.render(); // Re-render to update display
        };

        this.$('#mute-btn').onclick = () => {
            this.toggleMute();
        };

        this.$('#debug-btn').onclick = () => {
            this.toggleDebug();
        };

        // Re-render target lights after DOM update
        requestAnimationFrame(() => {
            this.renderTargetLights();
        });
    }

    /**
     * Render style selector options
     * @returns {string} HTML options for style selector
     */
    renderStyleOptions() {
        const styles = [
            ['roots', 'Roots'],
            ['walking', 'Walking'],
            ['pedal', 'Pedal']
        ];

        return styles.map(([value, label]) => {
            const selected = value === this.bassStyle ? 'selected' : '';
            return `<option value="${value}" ${selected}>${label}</option>`;
        }).join('');
    }

    /**
     * Render range selector options
     * @returns {string} HTML options for range selector
     */
    renderRangeOptions() {
        const ranges = [
            ['very-low', 'Very Low (C1-C2)'],
            ['low', 'Low (E1-C3)'],
            ['mid-low', 'Mid-Low (C2-C4)'],
            ['mid', 'Mid (C3-C5)']
        ];

        return ranges.map(([value, label]) => {
            const selected = value === this.noteRange ? 'selected' : '';
            return `<option value="${value}" ${selected}>${label}</option>`;
        }).join('');
    }
}

// Register custom element
customElements.define('sonofire-bassist', SonofireBassist);
