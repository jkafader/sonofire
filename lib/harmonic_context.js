import { PubSub } from './pubsub.js';
import { SCALES } from './midi_data.js';

/**
 * Harmonic Context Service - Manages key, scale, and chord information
 * Singleton pattern: use `harmonicContext` export
 */
class HarmonicContextService {
    constructor() {
        this.currentKey = 'C';
        this.currentScale = 'major';
        this.currentChord = null;
        this.scaleNotes = [];

        // Pool/tonic center properties
        this.currentPoolKey = null;  // e.g., "3♯", "0", "2♭"
        this.currentTonicNote = null;  // MIDI note number (e.g., 69 for A)
        this.currentTonicName = null;  // Note name (e.g., "A")
    }

    /**
     * Set the current key and scale
     * @param {string} key - Key name (C, D, E, F, G, A, B)
     * @param {string} scale - Scale type (major, minor, dorian, etc.)
     */
    setKey(key, scale = 'major') {
        this.currentKey = key;
        this.currentScale = scale;
        this.scaleNotes = this.calculateScaleNotes(key, scale);

        // Publish to PubSub
        PubSub.publish('context:key', {
            key: this.currentKey,
            scale: this.currentScale,
            notes: this.scaleNotes
        });

        console.log(`Harmonic context set to ${key} ${scale}`);
    }

    /**
     * Calculate scale notes for given key and scale type
     * @param {string} key - Key name
     * @param {string} scale - Scale type
     * @returns {Array<number>} Array of MIDI note numbers for the scale
     */
    calculateScaleNotes(key, scale) {
        // Map key names to MIDI note numbers (C4 = 60)
        const rootMap = {
            'C': 60, 'C#': 61, 'Db': 61,
            'D': 62, 'D#': 63, 'Eb': 63,
            'E': 64,
            'F': 65, 'F#': 66, 'Gb': 66,
            'G': 67, 'G#': 68, 'Ab': 68,
            'A': 69, 'A#': 70, 'Bb': 70,
            'B': 71
        };

        // Scale patterns (intervals from root)
        const scalePatterns = {
            'major': [0, 2, 4, 5, 7, 9, 11],
            'minor': [0, 2, 3, 5, 7, 8, 10],
            'harmonic-minor': [0, 2, 3, 5, 7, 8, 11],
            'melodic-minor': [0, 2, 3, 5, 7, 9, 11],
            'dorian': [0, 2, 3, 5, 7, 9, 10],
            'phrygian': [0, 1, 3, 5, 7, 8, 10],
            'lydian': [0, 2, 4, 6, 7, 9, 11],
            'mixolydian': [0, 2, 4, 5, 7, 9, 10],
            'locrian': [0, 1, 3, 5, 6, 8, 10],
            'pentatonic-major': [0, 2, 4, 7, 9],
            'pentatonic-minor': [0, 3, 5, 7, 10],
            'blues': [0, 3, 5, 6, 7, 10]
        };

        const root = rootMap[key];
        if (root === undefined) {
            console.error('Invalid key:', key);
            return [60, 62, 64, 65, 67, 69, 71]; // Default to C major
        }

        const pattern = scalePatterns[scale] || scalePatterns['major'];

        // Generate scale notes for multiple octaves (3 octaves)
        const notes = [];
        for (let octave = -1; octave <= 1; octave++) {
            pattern.forEach(interval => {
                const note = root + interval + (octave * 12);
                if (note >= 0 && note <= 127) { // Valid MIDI range
                    notes.push(note);
                }
            });
        }

        return notes.sort((a, b) => a - b);
    }

    /**
     * Voice a chord (convert chord symbol to MIDI notes)
     * @param {Object} chord - Chord object {symbol, root, quality}
     * @param {string} voicingType - Voicing style ('close', 'open', 'drop2')
     * @returns {Array<number>} Array of MIDI note numbers
     */
    voiceChord(chord, voicingType = 'close') {
        const { root, quality } = chord;

        // Chord quality to intervals
        const chordQualities = {
            // Triads
            'maj': [0, 4, 7],
            'min': [0, 3, 7],
            'dim': [0, 3, 6],
            'aug': [0, 4, 8],
            // Seventh chords
            'maj7': [0, 4, 7, 11],
            'min7': [0, 3, 7, 10],
            '7': [0, 4, 7, 10],         // Dominant 7
            'min7b5': [0, 3, 6, 10],    // Half-diminished
            'dim7': [0, 3, 6, 9],
            // Extended chords
            'maj9': [0, 4, 7, 11, 14],
            'min9': [0, 3, 7, 10, 14],
            '9': [0, 4, 7, 10, 14],
            'sus2': [0, 2, 7],
            'sus4': [0, 5, 7]
        };

        const intervals = chordQualities[quality] || chordQualities['maj'];

        // Generate voicing
        let voicing = intervals.map(interval => root + interval);

        // Apply voicing type (future enhancement - for now just close voicing)
        // voicingType could affect octave distribution

        return voicing;
    }

    /**
     * Check if a note is in the current scale
     * @param {number} note - MIDI note number
     * @returns {boolean}
     */
    isInScale(note) {
        const pitchClass = note % 12;
        const scalePitchClasses = this.scaleNotes.map(n => n % 12);
        return scalePitchClasses.includes(pitchClass);
    }

    /**
     * Get the nearest scale note to a given note
     * @param {number} note - MIDI note number
     * @returns {number} Closest MIDI note in current scale
     */
    getNearestScaleNote(note) {
        if (this.scaleNotes.length === 0) {
            return note; // No scale set, return original
        }

        let closest = this.scaleNotes[0];
        let minDistance = Math.abs(note - closest);

        this.scaleNotes.forEach(scaleNote => {
            const distance = Math.abs(note - scaleNote);
            if (distance < minDistance) {
                minDistance = distance;
                closest = scaleNote;
            }
        });

        return closest;
    }

    /**
     * Get scale degree of a note (1-7, or 0 if not in scale)
     * @param {number} note - MIDI note number
     * @returns {number} Scale degree (1-based)
     */
    getScaleDegree(note) {
        const pitchClass = note % 12;
        const scalePitchClasses = this.scaleNotes.map(n => n % 12);

        // Remove duplicates and find index
        const uniqueScalePitchClasses = [...new Set(scalePitchClasses)];
        const index = uniqueScalePitchClasses.indexOf(pitchClass);

        return index !== -1 ? index + 1 : 0;
    }

    /**
     * Set pool and tonic center (new pool/tonic notation)
     * @param {string} poolKey - Pool key (e.g., "3♯", "0", "2♭")
     * @param {number} tonicNote - MIDI note number for tonic (e.g., 69 for A)
     * @param {string} tonicName - Note name (e.g., "A", "C♯")
     */
    setPoolAndTonic(poolKey, tonicNote, tonicName) {
        this.currentPoolKey = poolKey;
        this.currentTonicNote = tonicNote;
        this.currentTonicName = tonicName;

        // Get notes from pool
        const poolNotes = this.getNotePool(poolKey);

        // Update legacy scaleNotes for backward compatibility
        this.scaleNotes = poolNotes;

        // Publish to PubSub with new pool/tonic format
        PubSub.publish('context:pool', {
            poolKey: poolKey,
            tonicNote: tonicNote,
            tonicName: tonicName,
            notes: poolNotes
        });

        // Also publish legacy context:key for backward compatibility
        PubSub.publish('context:key', {
            key: tonicName,
            scale: 'pool', // Indicate this is from pool notation
            notes: poolNotes,
            poolKey: poolKey
        });

        console.log(`Harmonic context set to pool ${poolKey} / tonic ${tonicName}`);
    }

    /**
     * Get note pool from SCALES data
     * @param {string} poolKey - Pool key (e.g., "3♯", "0", "2♭")
     * @returns {Array<number>} Array of MIDI notes in the pool
     */
    getNotePool(poolKey) {
        const pool = SCALES[poolKey];

        if (!pool) {
            console.error('Invalid pool key:', poolKey);
            return SCALES['0'] || [60, 62, 64, 65, 67, 69, 71]; // Default to C major
        }

        return [...pool]; // Return copy
    }

    /**
     * Get scale degree of a note within a pool, relative to a reference tonic
     * @param {number} note - MIDI note number to find degree of
     * @param {string} poolKey - Pool key (e.g., "3♯")
     * @param {number} referenceTonic - Reference tonic MIDI note (optional, uses current tonic if not provided)
     * @returns {number} Scale degree (1-7), or 0 if not in pool
     */
    getScaleDegreeInPool(note, poolKey, referenceTonic = null) {
        const pool = SCALES[poolKey] || SCALES['0'];
        const notePitchClass = note % 12;

        // Use provided reference tonic, or fall back to stored current tonic
        const refTonic = referenceTonic !== null ? referenceTonic : this.currentTonicNote;
        if (refTonic === null) {
            // No reference tonic available, can't determine relative degree
            console.warn('getScaleDegreeInPool: No reference tonic available');
            return 0;
        }
        const refTonicPitchClass = refTonic % 12;

        // Get unique pitch classes from pool
        const poolPitchClasses = [...new Set(pool.map(n => n % 12))];

        // Check if note is in pool
        if (!poolPitchClasses.includes(notePitchClass)) {
            return 0; // Not in pool
        }

        // Check if reference tonic is in pool
        if (!poolPitchClasses.includes(refTonicPitchClass)) {
            console.warn('getScaleDegreeInPool: Reference tonic not in pool');
            return 0;
        }

        // Calculate intervals from reference tonic for all notes in pool
        // Sort pool by interval from reference tonic (circular)
        const intervalsFromTonic = poolPitchClasses.map(pc => ({
            pitchClass: pc,
            interval: (pc - refTonicPitchClass + 12) % 12
        }));

        // Sort by interval (0, 2, 3, 4, 5, 7, 9, 10, 11, etc.)
        intervalsFromTonic.sort((a, b) => a.interval - b.interval);

        // Find the degree (position in sorted-by-interval list)
        // The reference tonic will have interval 0, so it will be degree 1
        const index = intervalsFromTonic.findIndex(item => item.pitchClass === notePitchClass);

        return index !== -1 ? index + 1 : 0;
    }

    /**
     * Convert note name to MIDI note number
     * @param {string} noteName - Note name (e.g., "A", "C♯", "Bb")
     * @param {number} octave - Octave (default 4)
     * @returns {number} MIDI note number
     */
    noteNameToMIDI(noteName, octave = 4) {
        const noteMap = {
            'C': 0, 'C♯': 1, 'Db': 1, 'D♭': 1,
            'D': 2, 'D♯': 3, 'Eb': 3, 'E♭': 3,
            'E': 4,
            'F': 5, 'F♯': 6, 'Gb': 6, 'G♭': 6,
            'G': 7, 'G♯': 8, 'Ab': 8, 'A♭': 8,
            'A': 9, 'A♯': 10, 'Bb': 10, 'B♭': 10,
            'B': 11
        };

        const pitchClass = noteMap[noteName];
        if (pitchClass === undefined) {
            console.error('Invalid note name:', noteName);
            return 60; // Default to C4
        }

        return pitchClass + (octave * 12);
    }

    /**
     * Convert MIDI note to note name
     * @param {number} midiNote - MIDI note number
     * @param {boolean} useFlats - Use flats instead of sharps
     * @returns {string} Note name (e.g., "A", "C♯")
     */
    midiToNoteName(midiNote, useFlats = false) {
        const pitchClass = midiNote % 12;

        const sharpNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
        const flatNames = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

        return useFlats ? flatNames[pitchClass] : sharpNames[pitchClass];
    }

    /**
     * Get current state
     * @returns {Object} {key, scale, notes, poolKey, tonicNote, tonicName}
     */
    getCurrentState() {
        return {
            key: this.currentKey,
            scale: this.currentScale,
            notes: this.scaleNotes,
            chord: this.currentChord,
            poolKey: this.currentPoolKey,
            tonicNote: this.currentTonicNote,
            tonicName: this.currentTonicName
        };
    }
}

// Export singleton instance
export const harmonicContext = new HarmonicContextService();
