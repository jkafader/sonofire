/**
 * Generative Algorithms
 * Provides probabilistic and algorithmic music generation utilities
 */

/**
 * Normalize weights to probabilities (sum to 1.0)
 * @param {Object|Array} weights - Weights to normalize
 * @returns {Object|Array} Normalized probabilities
 */
export function normalizeWeights(weights) {
    if (Array.isArray(weights)) {
        const sum = weights.reduce((a, b) => a + b, 0);
        if (sum === 0) return weights.map(() => 1 / weights.length);
        return weights.map(w => w / sum);
    } else {
        // Object with key-value pairs
        const sum = Object.values(weights).reduce((a, b) => a + b, 0);
        if (sum === 0) {
            const keys = Object.keys(weights);
            const uniformProb = 1 / keys.length;
            return Object.fromEntries(keys.map(k => [k, uniformProb]));
        }
        return Object.fromEntries(
            Object.entries(weights).map(([k, v]) => [k, v / sum])
        );
    }
}

/**
 * Weighted random selection from array of options
 * @param {Array} options - Array of options to choose from
 * @param {Array|Object} weights - Weights for each option (will be normalized)
 * @returns {*} Selected option
 */
export function weightedRandomSelect(options, weights) {
    if (options.length === 0) {
        throw new Error('Cannot select from empty options array');
    }

    // Convert weights to array if object
    let weightsArray = Array.isArray(weights) ? weights : Object.values(weights);

    // Normalize weights to probabilities
    const probs = normalizeWeights(weightsArray);

    // Weighted random selection
    const random = Math.random();
    let cumulative = 0;

    for (let i = 0; i < options.length; i++) {
        cumulative += probs[i];
        if (random < cumulative) {
            return options[i];
        }
    }

    // Fallback (should not happen unless rounding error)
    return options[options.length - 1];
}

/**
 * Apply style-specific modifiers to base weights
 * @param {Object} baseWeights - Base harmonic function weights {degree: weight}
 * @param {string} style - Style name (jazz, pop, blues, etc.)
 * @param {number} fromDegree - Current scale degree
 * @param {Object} styleModifiers - Style modifier rules
 * @returns {Object} Modified weights
 */
export function applyStyleModifiers(baseWeights, style, fromDegree, styleModifiers = {}) {
    // Clone base weights
    const modifiedWeights = { ...baseWeights };

    // Get modifiers for this style
    const mods = styleModifiers[style];
    if (!mods) {
        return modifiedWeights;
    }

    // Apply modifiers for this fromDegree
    mods.forEach(rule => {
        if (rule.fromDegree === fromDegree && modifiedWeights[rule.toDegree] !== undefined) {
            // Multiply weight by modifier (boosts or reduces)
            modifiedWeights[rule.toDegree] *= rule.weight;
        }
    });

    return modifiedWeights;
}

/**
 * Generate chromatic approach note
 * Returns a note one half-step below the target
 * @param {number} targetNote - Target MIDI note
 * @param {number} currentNote - Current MIDI note
 * @returns {number} Chromatic approach note (half-step below target)
 */
export function chromaticApproach(targetNote, currentNote) {
    // Approach from below by half-step
    return targetNote - 1;
}

/**
 * Generate a rhythm pattern based on density and swing
 * @param {number} density - Note density (0.0 = sparse, 1.0 = dense)
 * @param {number} swing - Swing amount (0.0 = straight, 1.0 = full swing)
 * @param {number} steps - Number of steps in pattern (e.g., 16 for 16th notes)
 * @returns {Array<number>} Array of step indices where notes should play
 */
export function generateRhythmPattern(density = 0.5, swing = 0.0, steps = 16) {
    const pattern = [];

    for (let i = 0; i < steps; i++) {
        // Higher density = higher probability of note
        if (Math.random() < density) {
            // Apply swing to every other note (on offbeats)
            let timing = i;
            if (swing > 0 && i % 2 === 1) {
                timing += swing * 0.3; // Delay offbeats slightly
            }
            pattern.push(Math.floor(timing));
        }
    }

    return [...new Set(pattern)].sort((a, b) => a - b);
}

/**
 * Calculate interval between two MIDI notes
 * @param {number} note1 - First MIDI note
 * @param {number} note2 - Second MIDI note
 * @returns {number} Interval in semitones (absolute value)
 */
export function interval(note1, note2) {
    return Math.abs(note2 - note1);
}

/**
 * Constrain interval jump to maximum size
 * If interval exceeds max, transpose to nearest octave
 * @param {number} fromNote - Starting MIDI note
 * @param {number} toNote - Target MIDI note
 * @param {number} maxInterval - Maximum allowed interval (semitones)
 * @returns {number} Adjusted target note
 */
export function constrainInterval(fromNote, toNote, maxInterval = 7) {
    let adjusted = toNote;
    let currentInterval = interval(fromNote, adjusted);

    // If interval too large, transpose by octaves until within range
    while (currentInterval > maxInterval) {
        if (adjusted > fromNote) {
            adjusted -= 12; // Drop octave
        } else {
            adjusted += 12; // Raise octave
        }
        currentInterval = interval(fromNote, adjusted);
    }

    return adjusted;
}
