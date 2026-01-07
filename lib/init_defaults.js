import { PubSub } from './pubsub.js';
import { SCALES } from './midi_data.js';

const DEFAULTS_INITIALIZED_KEY = 'sonofire.defaults.initialized';

/**
 * Initialize PubSub with default state values.
 * Called once on first component load to ensure all components
 * can discover sensible defaults via PubSub.last()
 */
export function initDefaults() {
    // Check if defaults have already been initialized
    const initialized = localStorage.getItem(DEFAULTS_INITIALIZED_KEY);

    if (initialized === 'true') {
        // Defaults already seeded
        return;
    }

    // Seed default harmonic context (Pool 0, tonic C = C Ionian/major)
    PubSub.publish('context:pool', {
        poolKey: '0',
        tonicNote: 60, // C4
        tonicName: 'C',
        notes: SCALES['0'] || [] // Full pool from SCALES data
    });

    PubSub.publish('context:mood', {
        mood: 'relaxed'
    });

    PubSub.publish('context:density', {
        density: 0.5 // Medium density
    });

    // Seed default tempo
    PubSub.publish('clock:tempo', {
        bpm: 120
    });

    // Mark as initialized
    localStorage.setItem(DEFAULTS_INITIALIZED_KEY, 'true');

    console.log('Sonofire: Default state initialized in PubSub (pool 0/C)');
}

/**
 * Reset defaults (useful for testing or reset functionality)
 */
export function resetDefaults() {
    localStorage.removeItem(DEFAULTS_INITIALIZED_KEY);

    // Clear all last values for Sonofire topics
    PubSub.clearLast('context:pool');
    PubSub.clearLast('context:mood');
    PubSub.clearLast('context:density');
    PubSub.clearLast('clock:tempo');

    console.log('Sonofire: Defaults reset');
}
