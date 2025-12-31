import { SonofireBase } from '../base/sonofire_base.js';
import { audioRouter } from '../../lib/audio_router.js';

/**
 * Base Instrumentalist Component
 * Base class for all instrumentalist components (Soloist, Drummer, Bassist, etc.)
 * Handles mode discovery, subscriptions, and audio output
 */
export class BaseInstrumentalist extends SonofireBase {
    constructor() {
        super();

        // Instrumentalist properties
        this.channel = 0;           // MIDI channel (0-15)
        this.enabled = true;        // Whether this instrument is active
        this.muted = false;         // Whether this instrument is muted
        this.debug = false;         // Whether to log note output
        this.currentChord = null;   // Current chord from Composer
        this.currentScale = [];     // Current scale notes
        this.currentKey = 'C';      // Current key name
        this.mood = 'relaxed';      // Current mood from Conductor
        this.spareness = 0.5;       // Current spareness (0.0-1.0)

        // Pool/tonic notation
        this.poolKey = null;
        this.tonicNote = null;

        // Performance state
        this.lastNote = null;       // For melodic continuity
    }

    /**
     * Specify which attributes to observe
     */
    static get observedAttributes() {
        return [
            ...super.observedAttributes,
            'data-channel',
            'data-enabled'
        ];
    }

    /**
     * Parse attributes
     */
    parseAttributes() {
        super.parseAttributes();

        this.channel = parseInt(this.getAttribute('data-channel')) || 0;
        this.enabled = this.getAttribute('data-enabled') !== 'false';
    }

    /**
     * Setup subscriptions
     */
    setupSubscriptions() {
        super.setupSubscriptions();

        // Subscribe to musical context changes
        this.subscribe('music:chord', (data) => {
            this.handleChordChange(data);
        });

        this.subscribe('context:mood', (data) => {
            this.mood = data.mood;
        });

        this.subscribe('context:spareness', (data) => {
            this.spareness = data.spareness;
        });

        this.subscribe('context:key', (data) => {
            this.currentKey = data.key;
            this.currentScale = data.notes || [];
        });

        this.subscribe('context:pool', (data) => {
            this.poolKey = data.poolKey;
            this.tonicNote = data.tonicNote;
            this.currentScale = data.notes || [];
        });
    }

    /**
     * Initialize when connected
     */
    connectedCallback() {
        super.connectedCallback();

        // Discover operational modes from PubSub
        this.discoverOperationalModes();
    }

    /**
     * Discover operational modes from PubSub last signals
     */
    discoverOperationalModes() {
        console.log(`${this.constructor.name}: Discovering operational modes...`);

        // Discover pool/tonic (preferred)
        const poolContext = this.getLastValue('context:pool');
        if (poolContext) {
            this.poolKey = poolContext.poolKey;
            this.tonicNote = poolContext.tonicNote;
            this.currentScale = poolContext.notes || [];
            console.log(`${this.constructor.name}: Found pool ${this.poolKey}`);
        } else {
            // Fall back to legacy key context
            const keyContext = this.getLastValue('context:key');
            if (keyContext) {
                this.currentKey = keyContext.key;
                this.currentScale = keyContext.notes || [];
                console.log(`${this.constructor.name}: Found key ${this.currentKey}`);
            }
        }

        // Discover current chord
        const chordContext = this.getLastValue('music:chord');
        if (chordContext) {
            this.currentChord = chordContext;
            console.log(`${this.constructor.name}: Found chord ${chordContext.chord}`);
        }

        // Discover mood
        const moodContext = this.getLastValue('context:mood');
        if (moodContext) {
            this.mood = moodContext.mood;
            console.log(`${this.constructor.name}: Found mood ${this.mood}`);
        }

        // Discover spareness
        const sparenessContext = this.getLastValue('context:spareness');
        if (sparenessContext) {
            this.spareness = sparenessContext.spareness;
            console.log(`${this.constructor.name}: Found spareness ${this.spareness.toFixed(2)}`);
        }
    }

    /**
     * Handle chord change
     */
    handleChordChange(chordData) {
        this.currentChord = chordData;
        console.log(`${this.constructor.name}: Chord changed to ${chordData.chord}`);
    }

    /**
     * Send a note via audio router
     * @param {number} note - MIDI note number
     * @param {number} velocity - Velocity (0-127)
     * @param {number} duration - Duration in milliseconds
     */
    sendNote(note, velocity = 80, duration = 500) {
        if (!this.enabled || this.muted) return;

        // Debug logging
        if (this.debug) {
            const noteName = this.midiNoteToName(note);
            console.log(`${this.constructor.name}: Ch${this.channel + 1} -> ${noteName} (${note}) vel:${velocity} dur:${duration}ms`);
        }

        audioRouter.sendNote(this.channel, note, velocity, duration);
        this.lastNote = note; // Track for melodic continuity
    }

    /**
     * Convert MIDI note number to note name
     * @param {number} midiNote - MIDI note number
     * @returns {string} Note name (e.g., "C4", "A#3")
     */
    midiNoteToName(midiNote) {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const octave = Math.floor(midiNote / 12) - 1;
        const noteName = noteNames[midiNote % 12];
        return `${noteName}${octave}`;
    }

    /**
     * Toggle mute state
     */
    toggleMute() {
        this.muted = !this.muted;
        console.log(`${this.constructor.name}: ${this.muted ? 'Muted' : 'Unmuted'}`);
        this.render(); // Update UI to show new state
    }

    /**
     * Toggle debug state
     */
    toggleDebug() {
        this.debug = !this.debug;
        console.log(`${this.constructor.name}: Debug ${this.debug ? 'ON' : 'OFF'}`);
        this.render(); // Update UI to show new state
    }

    /**
     * Generate and play notes (abstract - override in subclasses)
     * @param {Object} data - Event data (varies by instrumentalist type)
     */
    generate(data) {
        throw new Error('generate() must be implemented by subclass');
    }

    /**
     * Check if a note is in the current scale
     * @param {number} note - MIDI note number
     * @returns {boolean}
     */
    isInScale(note) {
        const pitchClass = note % 12;
        const scalePitchClasses = this.currentScale.map(n => n % 12);
        return scalePitchClasses.includes(pitchClass);
    }

    /**
     * Get nearest scale note
     * @param {number} note - MIDI note number
     * @returns {number} Nearest note in scale
     */
    getNearestScaleNote(note) {
        if (this.currentScale.length === 0) return note;

        let closest = this.currentScale[0];
        let minDistance = Math.abs(note - closest);

        this.currentScale.forEach(scaleNote => {
            const distance = Math.abs(note - scaleNote);
            if (distance < minDistance) {
                minDistance = distance;
                closest = scaleNote;
            }
        });

        return closest;
    }

    /**
     * Render channel selector options (1-16)
     * @returns {string} HTML options for channel selector
     */
    renderChannelOptions() {
        let options = '';
        for (let ch = 0; ch < 16; ch++) {
            const displayChannel = ch + 1; // Display as 1-16
            const selected = ch === this.channel ? 'selected' : '';
            options += `<option value="${ch}" ${selected}>${displayChannel}</option>`;
        }
        return options;
    }

    /**
     * Set MIDI channel
     * @param {number} channel - MIDI channel (0-15)
     */
    setChannel(channel) {
        this.channel = Math.max(0, Math.min(15, channel));
        console.log(`${this.constructor.name}: Channel set to ${this.channel + 1}`);
    }

    /**
     * Render UI (minimal for instrumentalists)
     */
    render() {
        this.innerHTML = `
            <div style="background: #2d2d2d; padding: 10px; margin: 5px 0; border-left: 3px solid #ce9178;">
                <strong style="color: #ce9178;">${this.constructor.name}</strong>
                <span style="margin-left: 10px; color: #888;">
                    Channel: ${this.channel + 1}
                    ${this.enabled ? '✓' : '✗'}
                </span>
            </div>
        `;
    }
}
