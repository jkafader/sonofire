/**
 * Music Theory Utilities
 * Provides chord progression generation and voicing functions
 */

import { SCALES } from './midi_data.js';
import { weightedRandomSelect, normalizeWeights, applyStyleModifiers } from './generative_algorithms.js';

/**
 * Generate a chord progression based on key, scale, and style
 * @param {string} key - Key name (C, D, E, F, G, A, B)
 * @param {string} scale - Scale type (major, minor, etc.)
 * @param {string} style - Progression style (jazz, blues, pop, etc.)
 * @returns {Array} Array of chord objects
 */
export function generateProgression(key, scale, style = 'jazz') {
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

    const keyRoot = rootMap[key] || 60;

    // Define progression templates (relative to root)
    const progressionTemplates = {
        // Jazz progressions
        'jazz': [
            { symbol: 'Imaj7', interval: 0, quality: 'maj7' },      // I
            { symbol: 'VIm7', interval: 9, quality: 'min7' },       // vi
            { symbol: 'IIm7', interval: 2, quality: 'min7' },       // ii
            { symbol: 'V7', interval: 7, quality: '7' }             // V
        ],
        'jazz-251': [
            { symbol: 'IIm7', interval: 2, quality: 'min7' },
            { symbol: 'V7', interval: 7, quality: '7' },
            { symbol: 'Imaj7', interval: 0, quality: 'maj7' }
        ],

        // Blues progressions
        'blues': [
            { symbol: 'I7', interval: 0, quality: '7' },
            { symbol: 'I7', interval: 0, quality: '7' },
            { symbol: 'I7', interval: 0, quality: '7' },
            { symbol: 'I7', interval: 0, quality: '7' },
            { symbol: 'IV7', interval: 5, quality: '7' },
            { symbol: 'IV7', interval: 5, quality: '7' },
            { symbol: 'I7', interval: 0, quality: '7' },
            { symbol: 'I7', interval: 0, quality: '7' },
            { symbol: 'V7', interval: 7, quality: '7' },
            { symbol: 'IV7', interval: 5, quality: '7' },
            { symbol: 'I7', interval: 0, quality: '7' },
            { symbol: 'V7', interval: 7, quality: '7' }
        ],

        // Pop progressions
        'pop': [
            { symbol: 'I', interval: 0, quality: 'maj' },           // I
            { symbol: 'V', interval: 7, quality: 'maj' },           // V
            { symbol: 'VIm', interval: 9, quality: 'min' },         // vi
            { symbol: 'IV', interval: 5, quality: 'maj' }           // IV
        ],
        'pop-alternative': [
            { symbol: 'VIm', interval: 9, quality: 'min' },
            { symbol: 'IV', interval: 5, quality: 'maj' },
            { symbol: 'I', interval: 0, quality: 'maj' },
            { symbol: 'V', interval: 7, quality: 'maj' }
        ],

        // Folk/Singer-songwriter
        'folk': [
            { symbol: 'I', interval: 0, quality: 'maj' },
            { symbol: 'IVmaj7', interval: 5, quality: 'maj7' },
            { symbol: 'I', interval: 0, quality: 'maj' },
            { symbol: 'V', interval: 7, quality: 'maj' }
        ],

        // Modal jazz
        'modal': [
            { symbol: 'Im7', interval: 0, quality: 'min7' },
            { symbol: 'Im7', interval: 0, quality: 'min7' },
            { symbol: 'Im7', interval: 0, quality: 'min7' },
            { symbol: 'Im7', interval: 0, quality: 'min7' }
        ],

        // Coltrane changes (simplified)
        'coltrane': [
            { symbol: 'Imaj7', interval: 0, quality: 'maj7' },
            { symbol: 'bIIImaj7', interval: 4, quality: 'maj7' },
            { symbol: 'Vmaj7', interval: 7, quality: 'maj7' },
            { symbol: 'Imaj7', interval: 0, quality: 'maj7' }
        ]
    };

    // Get template or default to jazz
    const template = progressionTemplates[style] || progressionTemplates['jazz'];

    // Convert template to actual chord objects with MIDI note roots
    const progression = template.map(chord => ({
        symbol: chord.symbol,
        root: keyRoot + chord.interval,
        quality: chord.quality,
        interval: chord.interval
    }));

    return progression;
}

/**
 * Voice a chord (convert chord quality to specific MIDI notes)
 * @param {Object} chord - Chord object {symbol, root, quality}
 * @param {string} voicingType - Voicing style ('close', 'open', 'drop2', 'shell')
 * @returns {Array<number>} Array of MIDI note numbers
 */
export function voiceChord(chord, voicingType = 'close') {
    const { root, quality } = chord;

    // Chord quality to intervals
    const chordQualities = {
        // Triads
        'maj': [0, 4, 7],
        'min': [0, 3, 7],
        'dim': [0, 3, 6],
        'aug': [0, 4, 8],
        'sus2': [0, 2, 7],
        'sus4': [0, 5, 7],

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
        '11': [0, 4, 7, 10, 14, 17],
        '13': [0, 4, 7, 10, 14, 17, 21],

        // Alterations
        '7b9': [0, 4, 7, 10, 13],
        '7#9': [0, 4, 7, 10, 15],
        '7#11': [0, 4, 7, 10, 18]
    };

    // Get intervals for this chord quality
    const intervals = chordQualities[quality] || chordQualities['maj'];

    // Generate basic voicing
    let voicing = intervals.map(interval => root + interval);

    // Apply voicing type
    if (voicingType === 'open') {
        // Open voicing: spread notes across wider range
        voicing = voicing.map((note, index) => {
            if (index > 0) return note + 12; // Raise upper notes by octave
            return note;
        });
    } else if (voicingType === 'drop2') {
        // Drop 2 voicing: drop second-highest note by octave
        if (voicing.length >= 3) {
            const secondFromTop = voicing[voicing.length - 2];
            voicing[voicing.length - 2] = secondFromTop - 12;
            voicing.sort((a, b) => a - b);
        }
    } else if (voicingType === 'shell') {
        // Shell voicing: root, 3rd, 7th (omit 5th)
        if (intervals.length >= 4) {
            voicing = [root, root + intervals[1], root + intervals[3]];
        }
    }

    return voicing;
}

/**
 * Get the next chord in a progression with smooth voice leading
 * @param {Array} voicing - Current chord voicing
 * @param {Object} nextChord - Next chord object
 * @returns {Array<number>} Voiced next chord with minimal movement
 */
export function voiceLead(voicing, nextChord) {
    const targetVoicing = voiceChord(nextChord);

    // For now, return basic voicing
    // Future: implement proper voice leading algorithm
    // (move each note to nearest tone in next chord)
    return targetVoicing;
}

/**
 * Determine chord quality from scale degree
 * @param {number} degree - Scale degree (1-7)
 * @param {string} scale - Scale type (major, minor, etc.)
 * @returns {string} Chord quality
 */
export function getChordQualityForDegree(degree, scale) {
    const majorScaleQualities = {
        1: 'maj7',  // Imaj7
        2: 'min7',  // IIm7
        3: 'min7',  // IIIm7
        4: 'maj7',  // IVmaj7
        5: '7',     // V7
        6: 'min7',  // VIm7
        7: 'min7b5' // VIIm7b5
    };

    const minorScaleQualities = {
        1: 'min7',  // Im7
        2: 'min7b5',// IIm7b5
        3: 'maj7',  // bIIImaj7
        4: 'min7',  // IVm7
        5: 'min7',  // Vm7 (or 7 in harmonic minor)
        6: 'maj7',  // bVImaj7
        7: '7'      // bVII7
    };

    if (scale === 'major') {
        return majorScaleQualities[degree] || 'maj';
    } else if (scale === 'minor') {
        return minorScaleQualities[degree] || 'min';
    }

    return 'maj';
}

/**
 * Transpose a chord to a new key
 * @param {Object} chord - Chord object
 * @param {number} semitones - Number of semitones to transpose
 * @returns {Object} Transposed chord
 */
export function transposeChord(chord, semitones) {
    return {
        ...chord,
        root: chord.root + semitones
    };
}

/**
 * Harmonic Function Weights
 * Maps scale degrees to probability weights for next chord
 * Based on classical harmonic function (tonic, subdominant, dominant)
 */
export const HARMONIC_FUNCTION_WEIGHTS = {
    1: { // I (Tonic) - wants to go to IV or V
        1: 0.10, // I→I (static)
        2: 0.05, // I→ii
        3: 0.05, // I→iii
        4: 0.25, // I→IV (plagal motion, common)
        5: 0.45, // I→V (dominant approach, very common)
        6: 0.05, // I→vi (deceptive)
        7: 0.05  // I→vii°
    },
    2: { // ii (Supertonic) - wants to go to V or back to I
        1: 0.20, // ii→I
        2: 0.05, // ii→ii (static)
        3: 0.05, // ii→iii
        4: 0.15, // ii→IV
        5: 0.50, // ii→V (very common in ii-V-I)
        6: 0.03, // ii→vi
        7: 0.02  // ii→vii°
    },
    3: { // iii (Mediant) - ambiguous function
        1: 0.25, // iii→I
        2: 0.10, // iii→ii
        3: 0.05, // iii→iii (static)
        4: 0.20, // iii→IV
        5: 0.15, // iii→V
        6: 0.20, // iii→vi (relative minor)
        7: 0.05  // iii→vii°
    },
    4: { // IV (Subdominant) - wants to go to I or V
        1: 0.35, // IV→I (plagal cadence, common)
        2: 0.10, // IV→ii
        3: 0.05, // IV→iii
        4: 0.05, // IV→IV (static)
        5: 0.30, // IV→V (continue to dominant)
        6: 0.10, // IV→vi
        7: 0.05  // IV→vii°
    },
    5: { // V (Dominant) - STRONGLY wants to resolve to I
        1: 0.85, // V→I (authentic cadence, extremely strong)
        2: 0.02, // V→ii
        3: 0.02, // V→iii
        4: 0.03, // V→IV
        5: 0.03, // V→V (static)
        6: 0.03, // V→vi (deceptive cadence)
        7: 0.02  // V→vii°
    },
    6: { // vi (Submediant/Relative minor) - flexible
        1: 0.25, // vi→I
        2: 0.15, // vi→ii
        3: 0.05, // vi→iii
        4: 0.30, // vi→IV (common in pop: vi-IV-I-V)
        5: 0.15, // vi→V
        6: 0.05, // vi→vi (static)
        7: 0.05  // vi→vii°
    },
    7: { // vii° (Leading tone) - wants to resolve to I
        1: 0.70, // vii°→I (strong resolution)
        2: 0.05, // vii°→ii
        3: 0.10, // vii°→iii
        4: 0.05, // vii°→IV
        5: 0.05, // vii°→V
        6: 0.03, // vii°→vi
        7: 0.02  // vii°→vii° (static)
    }
};

/**
 * Style-specific weight modifiers
 * Boosts or reduces certain transitions based on style
 */
export const PROGRESSION_STYLE_MODIFIERS = {
    pop: [
        // Pop loves vi-IV-I-V ("Axis of Awesome" progression)
        { fromDegree: 6, toDegree: 4, weight: 1.5 },
        { fromDegree: 4, toDegree: 1, weight: 1.5 },
        { fromDegree: 1, toDegree: 5, weight: 1.5 },
        { fromDegree: 5, toDegree: 6, weight: 1.5 }
    ],
    jazz: [
        // Jazz loves ii-V-I
        { fromDegree: 2, toDegree: 5, weight: 1.8 },
        { fromDegree: 5, toDegree: 1, weight: 1.5 },
        // Tritone substitution (bII for V)
        { fromDegree: 2, toDegree: 2, weight: 0.5 }, // Reduce ii→ii
        { fromDegree: 3, toDegree: 6, weight: 1.3 }  // iii-vi common
    ],
    blues: [
        // Blues loves I-IV-I-V
        { fromDegree: 1, toDegree: 4, weight: 2.0 },
        { fromDegree: 4, toDegree: 1, weight: 2.0 },
        { fromDegree: 1, toDegree: 5, weight: 1.5 },
        { fromDegree: 5, toDegree: 1, weight: 1.8 },
        // Reduce other transitions
        { fromDegree: 1, toDegree: 2, weight: 0.1 },
        { fromDegree: 1, toDegree: 3, weight: 0.1 },
        { fromDegree: 1, toDegree: 6, weight: 0.1 }
    ],
    folk: [
        // Folk loves I-IV-V-I
        { fromDegree: 1, toDegree: 4, weight: 1.5 },
        { fromDegree: 4, toDegree: 5, weight: 1.5 },
        { fromDegree: 5, toDegree: 1, weight: 1.5 }
    ],
    modal: [
        // Modal stays on one chord more often
        { fromDegree: 1, toDegree: 1, weight: 3.0 },
        { fromDegree: 1, toDegree: 4, weight: 0.5 },
        { fromDegree: 1, toDegree: 5, weight: 0.5 }
    ]
};

/**
 * Select next tonic center based on harmonic function probabilities
 * @param {number} currentDegree - Current scale degree (1-7)
 * @param {number} referenceTonic - Reference tonic MIDI note (defines degree 1)
 * @param {string} poolKey - Pool key (e.g., "3♯", "0", "2♭")
 * @param {string} style - Style name (jazz, pop, blues, etc.)
 * @returns {Object} {degree: number, tonicNote: number, pitchClass: number}
 */
export function selectNextTonicByFunction(currentDegree, referenceTonic, poolKey, style = 'default') {
    // 1. Get pool pitch classes
    const pool = SCALES[poolKey] || SCALES['0'];
    const poolPitchClasses = [...new Set(pool.map(n => n % 12))];
    const referenceTonicPitchClass = referenceTonic % 12;

    if (poolPitchClasses.length === 0) {
        console.error('Invalid pool key:', poolKey);
        return { degree: 1, tonicNote: 60, pitchClass: 0 };
    }

    // Check if reference tonic is in pool
    if (!poolPitchClasses.includes(referenceTonicPitchClass)) {
        console.error('Reference tonic not in pool:', referenceTonic, poolKey);
        return { degree: 1, tonicNote: referenceTonic, pitchClass: referenceTonicPitchClass };
    }

    // 2. Sort pool by interval from reference tonic
    const intervalsFromTonic = poolPitchClasses.map(pc => ({
        pitchClass: pc,
        interval: (pc - referenceTonicPitchClass + 12) % 12
    }));
    intervalsFromTonic.sort((a, b) => a.interval - b.interval);

    // 3. Available degrees (1-7 or however many notes in pool)
    const availableDegrees = Array.from({ length: intervalsFromTonic.length }, (_, i) => i + 1);

    // 4. Get base weights for current degree
    const baseWeights = HARMONIC_FUNCTION_WEIGHTS[currentDegree] || HARMONIC_FUNCTION_WEIGHTS[1];

    // 5. Apply style modifiers
    const weights = applyStyleModifiers(baseWeights, style, currentDegree, PROGRESSION_STYLE_MODIFIERS);

    // 6. Extract weights for available degrees only
    const weightsArray = availableDegrees.map(deg => weights[deg] || 0.01);

    // 7. Weighted random selection
    const selectedDegree = weightedRandomSelect(availableDegrees, weightsArray);

    // 8. Convert degree to MIDI note (relative to reference tonic)
    const selectedItem = intervalsFromTonic[selectedDegree - 1];
    const pitchClass = selectedItem.pitchClass;
    const tonicNote = pitchClass + 60; // C4 octave

    return {
        degree: selectedDegree,
        tonicNote: tonicNote,
        pitchClass: pitchClass
    };
}

/**
 * Get chord quality for a scale degree within a pool
 * Uses complete modal harmonization for all 7 modes
 * @param {number} degree - Scale degree (1-7)
 * @param {string} mode - Mode name ('ionian', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian')
 * @returns {string} Chord quality ('maj7', 'min7', '7', etc.)
 */
export function getChordQualityForDegreeInPool(degree, mode = 'ionian') {
    // Ionian (Major) mode harmonization
    // Intervals: W W H W W W H
    // I  II  III  IV  V  VI  VII
    const ionianQualities = {
        1: 'maj7',    // Imaj7 (1, 3, 5, 7)
        2: 'min7',    // IIm7 (1, ♭3, 5, ♭7)
        3: 'min7',    // IIIm7 (1, ♭3, 5, ♭7)
        4: 'maj7',    // IVmaj7 (1, 3, 5, 7)
        5: '7',       // V7 (1, 3, 5, ♭7)
        6: 'min7',    // VIm7 (1, ♭3, 5, ♭7)
        7: 'min7b5'   // VIIm7♭5 (1, ♭3, ♭5, ♭7)
    };

    // Dorian mode harmonization
    // Intervals: W H W W W H W
    // I  II  ♭III  IV  V  VI  ♭VII
    const dorianQualities = {
        1: 'min7',    // Im7 (1, ♭3, 5, ♭7)
        2: 'min7',    // IIm7 (1, ♭3, 5, ♭7)
        3: 'maj7',    // ♭IIImaj7 (1, 3, 5, 7)
        4: '7',       // IV7 (1, 3, 5, ♭7)
        5: 'min7',    // Vm7 (1, ♭3, 5, ♭7)
        6: 'min7b5',  // VIm7♭5 (1, ♭3, ♭5, ♭7)
        7: 'maj7'     // ♭VIImaj7 (1, 3, 5, 7)
    };

    // Phrygian mode harmonization
    // Intervals: H W W W H W W
    // I  ♭II  ♭III  IV  V  ♭VI  ♭VII
    const phrygianQualities = {
        1: 'min7',    // Im7 (1, ♭3, 5, ♭7)
        2: 'maj7',    // ♭IImaj7 (1, 3, 5, 7)
        3: '7',       // ♭III7 (1, 3, 5, ♭7)
        4: 'min7',    // IVm7 (1, ♭3, 5, ♭7)
        5: 'min7b5',  // Vm7♭5 (1, ♭3, ♭5, ♭7)
        6: 'maj7',    // ♭VImaj7 (1, 3, 5, 7)
        7: 'min7'     // ♭VIIm7 (1, ♭3, 5, ♭7)
    };

    // Lydian mode harmonization
    // Intervals: W W W H W W H
    // I  II  III  ♯IV  V  VI  VII
    const lydianQualities = {
        1: 'maj7',    // Imaj7 (1, 3, 5, 7)
        2: '7',       // II7 (1, 3, 5, ♭7)
        3: 'min7',    // IIIm7 (1, ♭3, 5, ♭7)
        4: 'min7b5',  // ♯IVm7♭5 (1, ♭3, ♭5, ♭7)
        5: 'maj7',    // Vmaj7 (1, 3, 5, 7)
        6: 'min7',    // VIm7 (1, ♭3, 5, ♭7)
        7: 'min7'     // VIIm7 (1, ♭3, 5, ♭7)
    };

    // Mixolydian mode harmonization
    // Intervals: W W H W W H W
    // I  II  III  IV  V  VI  ♭VII
    const mixolydianQualities = {
        1: '7',       // I7 (1, 3, 5, ♭7)
        2: 'min7',    // IIm7 (1, ♭3, 5, ♭7)
        3: 'min7b5',  // IIIm7♭5 (1, ♭3, ♭5, ♭7)
        4: 'maj7',    // IVmaj7 (1, 3, 5, 7)
        5: 'min7',    // Vm7 (1, ♭3, 5, ♭7)
        6: 'min7',    // VIm7 (1, ♭3, 5, ♭7)
        7: 'maj7'     // ♭VIImaj7 (1, 3, 5, 7)
    };

    // Aeolian (Natural Minor) mode harmonization
    // Intervals: W H W W H W W
    // I  II  ♭III  IV  V  ♭VI  ♭VII
    const aeolianQualities = {
        1: 'min7',    // Im7 (1, ♭3, 5, ♭7)
        2: 'min7b5',  // IIm7♭5 (1, ♭3, ♭5, ♭7)
        3: 'maj7',    // ♭IIImaj7 (1, 3, 5, 7)
        4: 'min7',    // IVm7 (1, ♭3, 5, ♭7)
        5: 'min7',    // Vm7 (1, ♭3, 5, ♭7)
        6: 'maj7',    // ♭VImaj7 (1, 3, 5, 7)
        7: '7'        // ♭VII7 (1, 3, 5, ♭7)
    };

    // Locrian mode harmonization
    // Intervals: H W W H W W W
    // I  ♭II  ♭III  IV  ♭V  ♭VI  ♭VII
    const locrianQualities = {
        1: 'min7b5',  // Im7♭5 (1, ♭3, ♭5, ♭7)
        2: 'maj7',    // ♭IImaj7 (1, 3, 5, 7)
        3: 'min7',    // ♭IIIm7 (1, ♭3, 5, ♭7)
        4: 'min7',    // IVm7 (1, ♭3, 5, ♭7)
        5: 'maj7',    // ♭Vmaj7 (1, 3, 5, 7)
        6: '7',       // ♭VI7 (1, 3, 5, ♭7)
        7: 'min7'     // ♭VIIm7 (1, ♭3, 5, ♭7)
    };

    // Map mode name to quality table
    const qualityMap = {
        'ionian': ionianQualities,
        'major': ionianQualities,      // Alias
        'dorian': dorianQualities,
        'phrygian': phrygianQualities,
        'lydian': lydianQualities,
        'mixolydian': mixolydianQualities,
        'aeolian': aeolianQualities,
        'minor': aeolianQualities,     // Alias
        'locrian': locrianQualities
    };

    const normalizedMode = mode.toLowerCase();
    const qualities = qualityMap[normalizedMode] || ionianQualities;

    return qualities[degree] || 'maj7';
}

/**
 * Melodic Interval Weights
 * Base probabilities for melodic intervals (in semitones)
 * Favors stepwise motion and small leaps
 */
export const MELODIC_INTERVAL_WEIGHTS = {
    // Interval in semitones: base weight
    0: 0.05,   // Unison (repeat)
    1: 0.20,   // Half step (chromatic or diatonic)
    2: 0.20,   // Whole step (very common)
    3: 0.15,   // Minor third
    4: 0.15,   // Major third
    5: 0.10,   // Perfect fourth
    7: 0.10,   // Perfect fifth
    8: 0.03,   // Minor sixth
    9: 0.01,   // Major sixth
    12: 0.01   // Octave
};

/**
 * Select next melodic note based on probabilistic model
 * @param {number} currentNote - Current MIDI note
 * @param {Array<number>} scaleNotes - Available scale notes (pool)
 * @param {Array<number>} chordTones - Current chord tones (higher weight)
 * @param {number} dataValue - Normalized data value (0-1) to bias upward/downward
 * @param {string} mood - Mood affecting interval weights ('tense', 'relaxed', etc.)
 * @returns {number} Selected MIDI note
 */
export function selectNextMelodicNote(currentNote, scaleNotes, chordTones = [], dataValue = 0.5, mood = 'relaxed') {
    if (scaleNotes.length === 0) {
        return currentNote; // Safety fallback
    }

    // Build candidate notes from scale
    const candidates = [];
    const weights = [];

    scaleNotes.forEach(targetNote => {
        const interval = Math.abs(targetNote - currentNote);

        // Get base weight for this interval size
        let weight = MELODIC_INTERVAL_WEIGHTS[interval] || 0.01;

        // Boost weight if target is a chord tone
        if (chordTones.some(ct => ct % 12 === targetNote % 12)) {
            weight *= 2.0; // 2x boost for chord tones
        }

        // Adjust weight based on mood
        if (mood === 'tense') {
            // Tense mood favors larger leaps
            if (interval >= 5) weight *= 1.5;
        } else if (mood === 'relaxed') {
            // Relaxed mood favors stepwise motion
            if (interval <= 2) weight *= 1.5;
        }

        // Bias upward or downward based on data value
        // dataValue > 0.5 → favor higher notes
        // dataValue < 0.5 → favor lower notes
        const direction = targetNote - currentNote;
        if (dataValue > 0.5 && direction > 0) {
            // Favor upward motion when data is high
            weight *= 1.0 + (dataValue - 0.5) * 2; // Up to 2x boost
        } else if (dataValue < 0.5 && direction < 0) {
            // Favor downward motion when data is low
            weight *= 1.0 + (0.5 - dataValue) * 2; // Up to 2x boost
        }

        candidates.push(targetNote);
        weights.push(weight);
    });

    // Select weighted random note
    return weightedRandomSelect(candidates, weights);
}
