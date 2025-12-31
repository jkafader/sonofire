import { PubSub } from './pubsub.js';

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

    // Seed default harmonic context (C major, relaxed mood)
    PubSub.publish('context:key', {
        key: 'C',
        scale: 'major',
        notes: [60, 62, 64, 65, 67, 69, 71] // C major scale (one octave)
    });

    PubSub.publish('context:mood', {
        mood: 'relaxed'
    });

    PubSub.publish('context:spareness', {
        spareness: 0.5 // Medium density
    });

    // Seed default tempo
    PubSub.publish('clock:tempo', {
        bpm: 120
    });

    // Mark as initialized
    localStorage.setItem(DEFAULTS_INITIALIZED_KEY, 'true');

    console.log('Sonofire: Default state initialized in PubSub');
}

/**
 * Reset defaults (useful for testing or reset functionality)
 */
export function resetDefaults() {
    localStorage.removeItem(DEFAULTS_INITIALIZED_KEY);

    // Clear all last values for Sonofire topics
    PubSub.clearLast('context:key');
    PubSub.clearLast('context:mood');
    PubSub.clearLast('context:spareness');
    PubSub.clearLast('clock:tempo');

    console.log('Sonofire: Defaults reset');
}
