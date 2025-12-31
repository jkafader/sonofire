import { BaseInstrumentalist } from './base_instrumentalist.js';
import { constrainInterval } from '../../lib/generative_algorithms.js';

/**
 * Soloist Component
 * Generates melodic lines based on data points from visualizers
 * Maps data values to pitch, with deviation-based dissonance
 */
export class SonofireSoloist extends BaseInstrumentalist {
    constructor() {
        super();

        // Soloist-specific settings
        this.playingStyle = 'melodic';    // 'melodic', 'rhythmic', 'ambient'
        this.maxInterval = 7;             // Maximum melodic interval (semitones)
        this.listenToData = true;         // Whether to respond to data:point events

        // Note range settings
        this.noteRange = 'mid';           // 'low', 'mid', 'high', 'very-high', 'wide'
        this.minNote = 55;                // Minimum note (G3)
        this.maxNote = 73;                // Maximum note (C#5) - 1.5 octaves

        // Deviation tracking for dissonance
        this.currentDeviation = 0;        // 0.0 (consonant) to 1.0 (very dissonant)
    }

    /**
     * Set note range
     * @param {string} range - Range preset ('low', 'mid', 'high', 'very-high', 'wide')
     */
    setNoteRange(range) {
        this.noteRange = range;

        switch (range) {
            case 'low':
                this.minNote = 36;  // C2
                this.maxNote = 54;  // F#3 (1.5 octaves)
                break;
            case 'mid':
                this.minNote = 55;  // G3
                this.maxNote = 73;  // C#5 (1.5 octaves)
                break;
            case 'high':
                this.minNote = 72;  // C5
                this.maxNote = 90;  // F#6 (1.5 octaves)
                break;
            case 'very-high':
                this.minNote = 91;  // G6
                this.maxNote = 109; // C#8 (1.5 octaves)
                break;
            case 'wide':
                this.minNote = 48;  // C3
                this.maxNote = 84;  // C6 (3 octaves)
                break;
            default:
                this.minNote = 55;  // G3
                this.maxNote = 73;  // C#5 (1.5 octaves)
        }

        console.log(`Soloist: Range set to ${range} (${this.minNote}-${this.maxNote})`);
        this.render(); // Update UI to reflect new range
    }

    /**
     * Specify which attributes to observe
     */
    static get observedAttributes() {
        return [
            ...super.observedAttributes,
            'data-style',
            'data-max-interval',
            'data-note-range',
            'data-listen-to-data'
        ];
    }

    /**
     * Parse attributes
     */
    parseAttributes() {
        super.parseAttributes();

        this.playingStyle = this.getAttribute('data-style') || 'melodic';
        this.maxInterval = parseInt(this.getAttribute('data-max-interval')) || 7;
        this.listenToData = this.getAttribute('data-listen-to-data') !== 'false';

        // Set note range
        const range = this.getAttribute('data-note-range') || 'mid';
        this.setNoteRange(range);
    }

    /**
     * Setup subscriptions
     */
    setupSubscriptions() {
        super.setupSubscriptions();

        if (this.listenToData) {
            // Subscribe to data points from visualizers
            this.subscribe('data:point', (data) => {
                this.handleDataPoint(data);
            });

            // Subscribe to forecast data for deviation-based dissonance
            this.subscribe('data:forecast', (data) => {
                this.handleForecastData(data);
            });
        }
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
        // Initialize velocity tracking
        this.nextNoteVelocity = 80; // Default velocity

        // Register Note Generation pulse (replaces X/Y plot interaction)
        // 'pulse' type triggers on EVERY value update from playhead
        this.registerWhippableParameter('noteGeneration', {
            label: 'Note Generation',
            parameterType: 'pulse',
            icon: '🎶',
            customPosition: 'strong', // Position after component name
            setter: () => {
                // Generate and play next note
                this.generateAndPlayNote();
            }
        });

        // Register Velocity parameter
        this.registerWhippableParameter('velocity', {
            label: 'Velocity',
            parameterType: 'number',
            min: 40,
            max: 127,
            icon: '🔊',
            customPosition: '.parameter-target-light[data-target-id*="noteGeneration"]', // After note generation light
            setter: (value) => {
                this.nextNoteVelocity = Math.round(value);
            }
        });

        // Register Max Interval parameter
        this.registerWhippableParameter('maxInterval', {
            label: 'Max Interval',
            parameterType: 'number',
            min: 0,
            max: 12,
            elementSelector: '#max-interval-slider',
            setter: (value) => {
                this.maxInterval = Math.round(value);
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
                const ranges = ['low', 'mid', 'high', 'very-high', 'wide'];
                const index = Math.floor(value * ranges.length);
                const clampedIndex = Math.min(index, ranges.length - 1);
                this.setNoteRange(ranges[clampedIndex]);
            }
        });

        // Render target lights after component is fully rendered
        requestAnimationFrame(() => {
            this.renderTargetLights();
        });
    }

    /**
     * Generate and play next note (triggered by whip automation)
     */
    generateAndPlayNote() {
        if (!this.enabled) return;

        // Generate melodic note based on current musical context
        let note;

        if (this.lastNote === null) {
            // First note - start on root or chord tone
            if (this.currentChord?.root) {
                // Get pitch class and place in middle of soloist's range
                const pitchClass = this.currentChord.root % 12;
                const middleOctave = Math.floor((this.minNote + this.maxNote) / 24) * 12;
                note = middleOctave + pitchClass;
                // Ensure it's in range
                while (note < this.minNote) note += 12;
                while (note > this.maxNote) note -= 12;
            } else if (this.currentScale?.length > 0) {
                note = this.currentScale[0];
                // Adjust to soloist's range
                while (note < this.minNote) note += 12;
                while (note > this.maxNote) note -= 12;
            } else {
                note = 60; // Default to middle C
            }
        } else {
            // Generate next note with melodic logic
            // Bias toward chord tones if available
            if (this.currentChord?.voicing && Math.random() < 0.6) {
                // 60% chance to use chord tone
                const chordTones = this.currentChord.voicing;
                note = chordTones[Math.floor(Math.random() * chordTones.length)];
                // Adjust to current octave range
                while (note < this.lastNote - 12) note += 12;
                while (note > this.lastNote + 12) note -= 12;
            } else {
                // Use scale-based melodic motion
                const direction = Math.random() < 0.5 ? 1 : -1;
                const stepSize = Math.floor(Math.random() * 3) + 1; // 1-3 scale steps
                note = this.lastNote + (direction * stepSize * 2); // Approximately scale steps
                note = this.getNearestScaleNote(note);
            }

            // Apply maxInterval constraint
            note = constrainInterval(this.lastNote, note, this.maxInterval);
        }

        // Quantize to scale
        note = this.getNearestScaleNote(note);

        // Clamp to selected range
        note = Math.max(this.minNote, Math.min(this.maxNote, note));

        // Use whip-controlled velocity or default
        const velocity = this.nextNoteVelocity || 80;

        // Duration based on spareness
        const baseDuration = 300;
        const duration = baseDuration * (1 + this.spareness);

        // Send note
        this.sendNote(note, velocity, duration);
        this.lastNote = note;

        console.log(`Soloist: Generated note ${note} (vel: ${velocity})`);
    }

    /**
     * Handle data point from visualizer
     */
    handleDataPoint(data) {
        if (!this.enabled) return;

        // Use the note provided by the visualizer, or generate from value
        let note = data.note;

        if (!note && data.value !== undefined) {
            // Map value directly to pitch (primary data-to-pitch mapping)
            note = this.mapValueToNote(data.value);
        }

        if (note) {
            // Apply melodic smoothing (avoid large jumps)
            if (this.lastNote !== null) {
                note = constrainInterval(this.lastNote, note, this.maxInterval);
            }

            // Quantize to scale
            note = this.getNearestScaleNote(note);

            // Subtle chord tone adjustment: If we're within 1-2 semitones of a chord tone,
            // probabilistically adjust to it (30% chance)
            if (this.currentChord?.voicing && Math.random() < 0.3) {
                const chordTones = this.currentChord.voicing;
                for (const chordTone of chordTones) {
                    const distance = Math.abs((note % 12) - (chordTone % 12));
                    if (distance <= 2 && distance > 0) {
                        // Within 2 semitones of a chord tone - occasionally adjust to it
                        const adjustedNote = note + (chordTone % 12) - (note % 12);
                        if (this.isInScale(adjustedNote)) {
                            note = adjustedNote;
                            break;
                        }
                    }
                }
            }

            // Apply dissonance based on current deviation
            note = this.applyDissonance(note, this.currentDeviation);

            // Clamp to selected range (after all transformations)
            note = Math.max(this.minNote, Math.min(this.maxNote, note));

            // Determine velocity based on mood and data intensity
            const velocity = this.calculateVelocity(data);

            // Determine duration based on spareness
            const duration = this.calculateDuration();

            // Send the note
            this.sendNote(note, velocity, duration);
        }
    }

    /**
     * Handle forecast data (for deviation-based dissonance)
     */
    handleForecastData(data) {
        // Calculate normalized deviation (0.0 to 1.0)
        if (data.deviation !== undefined) {
            // Assume deviation is in range [0, maxDeviation]
            // Normalize to [0, 1]
            this.currentDeviation = Math.min(data.deviation, 1.0);
        }
    }

    /**
     * Map a data value to a MIDI note
     * @param {number} value - Data value
     * @returns {number} MIDI note number
     */
    mapValueToNote(value) {
        // Use the selected note range
        // Normalize value (assuming 0-1 range, adjust as needed)
        const normalizedValue = Math.max(0, Math.min(1, value));
        const note = Math.floor(this.minNote + normalizedValue * (this.maxNote - this.minNote));

        return note;
    }

    /**
     * Apply dissonance based on deviation
     * @param {number} note - Original note
     * @param {number} deviation - Deviation amount (0.0 to 1.0)
     * @returns {number} Possibly altered note
     */
    applyDissonance(note, deviation) {
        if (deviation < 0.2) {
            // Low deviation: consonant (keep note as-is)
            return note;
        } else if (deviation < 0.5) {
            // Medium deviation: mildly dissonant (occasionally add 7th or 9th)
            if (Math.random() < 0.3) {
                // Add a half-step or whole-step
                return note + (Math.random() < 0.5 ? 1 : 2);
            }
            return note;
        } else if (deviation < 0.8) {
            // High deviation: dissonant (b9, #9, etc.)
            if (Math.random() < 0.5) {
                // Add chromatic alteration
                return note + (Math.random() < 0.5 ? -1 : 1);
            }
            return note;
        } else {
            // Very high deviation: very dissonant (chromatic)
            // More aggressive alterations
            if (Math.random() < 0.7) {
                return note + Math.floor(Math.random() * 3) - 1; // -1, 0, or +1
            }
            return note;
        }
    }

    /**
     * Calculate velocity based on mood and data
     * @param {Object} data - Data point
     * @returns {number} MIDI velocity (0-127)
     */
    calculateVelocity(data) {
        let baseVelocity;

        // Base velocity from mood
        switch (this.mood) {
            case 'tense':
                baseVelocity = 100;
                break;
            case 'relaxed':
                baseVelocity = 70;
                break;
            case 'sparse':
                baseVelocity = 60;
                break;
            case 'dense':
                baseVelocity = 90;
                break;
            default:
                baseVelocity = 80;
        }

        // Add some variation
        const variation = Math.floor(Math.random() * 20) - 10;
        const velocity = Math.max(40, Math.min(127, baseVelocity + variation));

        return velocity;
    }

    /**
     * Calculate duration based on spareness
     * @returns {number} Duration in milliseconds
     */
    calculateDuration() {
        // More sparse = longer notes
        const baseDuration = 200;
        const sparenessMultiplier = 1 + (this.spareness * 2); // 1.0 to 3.0
        const duration = baseDuration * sparenessMultiplier;

        return Math.floor(duration);
    }

    /**
     * Render UI
     */
    render() {
        this.innerHTML = `
            <div style="background: #2d2d2d; padding: 10px; margin: 5px 0; border-left: 3px solid #ce9178;">
                <strong style="color: #ce9178;">🎺 Soloist</strong>
                <span style="margin-left: 10px; color: #888;">
                    Channel:
                    <select id="channel-select" style="margin: 0 5px;">
                        ${this.renderChannelOptions()}
                    </select>
                    | Style: ${this.playingStyle}
                    | Range:
                    <select id="range-select" style="margin: 0 5px;">
                        ${this.renderRangeOptions()}
                    </select>
                    | Max Interval:
                    <input type="range" id="max-interval-slider" min="0" max="12" value="${this.maxInterval}" style="width: 100px; vertical-align: middle;">
                    <span style="margin-left: 5px;">${this.maxInterval}</span>
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

        this.$('#range-select').onchange = (e) => {
            this.setNoteRange(e.target.value);
        };

        this.$('#max-interval-slider').oninput = (e) => {
            this.maxInterval = parseInt(e.target.value);
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
     * Render range selector options
     * @returns {string} HTML options for range selector
     */
    renderRangeOptions() {
        const ranges = [
            ['low', 'Low (C2-F#3)'],
            ['mid', 'Mid (G3-C#5)'],
            ['high', 'High (C5-F#6)'],
            ['very-high', 'Very High (G6-C#8)'],
            ['wide', 'Wide (C3-C6, 3 oct)']
        ];

        return ranges.map(([value, label]) => {
            const selected = value === this.noteRange ? 'selected' : '';
            return `<option value="${value}" ${selected}>${label}</option>`;
        }).join('');
    }
}

// Register custom element
customElements.define('sonofire-soloist', SonofireSoloist);
