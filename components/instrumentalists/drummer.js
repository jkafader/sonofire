import { BaseInstrumentalist } from './base_instrumentalist.js';
import { perlinNoise } from '../../lib/unit_noise.js';
import { PubSub } from '../../lib/pubsub.js';

/**
 * Drummer Component
 * Generates locked, repetitive drum grooves
 * The groove is the foundation - it repeats consistently
 */
export class SonofireDrummer extends BaseInstrumentalist {
    constructor() {
        super();

        // Drummer-specific settings
        this.channel = 9;                 // Standard MIDI drum channel
        this.drumStyle = 'rock';          // 'rock', 'jazz', 'funk', 'breakbeat'

        // MIDI drum note numbers (General MIDI standard)
        this.drumNotes = {
            kick: 36,      // Bass Drum 1
            snare: 38,     // Acoustic Snare
            hihat: 42,     // Closed Hi-Hat
            hihatOpen: 46, // Open Hi-Hat
            ride: 51,      // Ride Cymbal 1
            crash: 49,     // Crash Cymbal 1
            tom1: 48,      // Hi Tom
            tom2: 45,      // Low Tom
        };

        // Pattern state
        this.lastTick = -1;
        this.lastStep = -1;  // Track last step played
        this.barCount = 0;
        this.currentPattern = null;
        this.currentFillPattern = null;  // Cached fill pattern for current fill

        // Humanization state
        this.humanizationEnabled = true;
        this.humanizationIntensity = 0.7;  // 0-1, controlled by global slider
        this.swingAmount = 0.0;            // 0-1, 0 = straight, 0.67 = triplet feel

        // Perlin noise state for each voice
        this.noiseTime = 0;  // Advances each step
        this.voiceOffsets = {
            kick: 0,
            snare: 100,
            hihat: 200,
            hihatOpen: 300,
            ride: 400,
            crash: 500,
            tom1: 600,
            tom2: 700
        };

        // Humanization characteristics per voice
        this.voiceHumanization = {
            kick: { velocityRange: 10, timingRange: 5, noiseFreq: 0.1 },
            snare: { velocityRange: 15, timingRange: 8, noiseFreq: 0.15 },
            hihat: { velocityRange: 25, timingRange: 10, noiseFreq: 0.3 },
            hihatOpen: { velocityRange: 20, timingRange: 8, noiseFreq: 0.25 },
            ride: { velocityRange: 12, timingRange: 6, noiseFreq: 0.12 },
            crash: { velocityRange: 8, timingRange: 3, noiseFreq: 0.08 },
            tom1: { velocityRange: 12, timingRange: 7, noiseFreq: 0.15 },
            tom2: { velocityRange: 12, timingRange: 7, noiseFreq: 0.15 }
        };

        // Define style layers for density gradients
        this.styleLayers = this.defineStyleLayers();
        this.fills = this.defineFills();
    }

    /**
     * Define drum style layers with density gradients
     * Each style has a base pattern (minimum density) and layers that add complexity
     * Layers are applied probabilistically based on how far density exceeds their threshold
     */
    defineStyleLayers() {
        return {
            rock: {
                base: {
                    // Sparse rock: kick on 1&3, snare on 2&4, quarter note hihats
                    kick:   [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
                    snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
                    hihat:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0]
                },
                layers: [
                    {
                        threshold: 0.25,  // Eighth note hihats
                        kick:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        snare:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        hihat:  [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0]
                    },
                    {
                        threshold: 0.5,  // Add kick variations
                        kick:   [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0],
                        snare:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        hihat:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]
                    },
                    {
                        threshold: 0.7,  // 16th note hihats
                        kick:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        snare:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        hihat:  [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1]
                    },
                    {
                        threshold: 0.85,  // Add ghost notes on snare
                        kick:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        snare:  [0,0,1,0, 0,0,0,1, 0,0,1,0, 0,0,0,0],
                        hihat:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]
                    }
                ]
            },

            disco: {
                base: {
                    // Sparse disco: four-on-floor kick, backbeat snare, quarter hihats
                    kick:   [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
                    snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
                    hihat:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0]
                },
                layers: [
                    {
                        threshold: 0.3,  // Eighth note hihats
                        kick:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        snare:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        hihat:  [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0]
                    },
                    {
                        threshold: 0.5,  // Open hihats on and of 2 & 4
                        kick:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        snare:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        hihat:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        hihatOpen: [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0]
                    },
                    {
                        threshold: 0.7,  // 16th note hihats
                        kick:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        snare:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        hihat:  [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1]
                    },
                    {
                        threshold: 0.85,  // Add more snare hits
                        kick:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        snare:  [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0],
                        hihat:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]
                    }
                ]
            },

            funk: {
                base: {
                    // Sparse funk: basic syncopated kick, backbeat snare
                    kick:   [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,1,0],
                    snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
                    hihat:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0]
                },
                layers: [
                    {
                        threshold: 0.3,  // Eighth note hihats
                        kick:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        snare:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        hihat:  [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0]
                    },
                    {
                        threshold: 0.4,  // Add more syncopated kicks
                        kick:   [0,0,0,1, 0,0,0,0, 0,0,1,0, 0,0,0,0],
                        snare:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        hihat:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]
                    },
                    {
                        threshold: 0.6,  // 16th note hihats
                        kick:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        snare:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        hihat:  [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1]
                    },
                    {
                        threshold: 0.8,  // Add ghost notes
                        kick:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        snare:  [0,0,1,0, 0,0,0,1, 0,0,1,0, 0,0,0,1],
                        hihat:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]
                    }
                ]
            },

            jazz: {
                base: {
                    // Sparse jazz: light kick, backbeat, ride pattern
                    kick:   [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                    snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
                    ride:   [1,0,0,1, 0,0,1,0, 0,1,0,0, 1,0,0,1]
                },
                layers: [
                    {
                        threshold: 0.4,  // Add more kick
                        kick:   [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
                        snare:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        ride:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]
                    },
                    {
                        threshold: 0.6,  // More complex ride pattern
                        kick:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        snare:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        ride:   [0,1,0,0, 1,0,0,1, 0,0,1,0, 0,1,0,0]
                    },
                    {
                        threshold: 0.75,  // Add ghost notes and kicks
                        kick:   [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0],
                        snare:  [0,0,1,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
                        ride:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]
                    }
                ]
            },

            breakbeat: {
                base: {
                    // Sparse breakbeat
                    kick:   [1,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
                    snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
                    hihat:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0]
                },
                layers: [
                    {
                        threshold: 0.3,  // Eighth note hihats
                        kick:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        snare:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        hihat:  [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0]
                    },
                    {
                        threshold: 0.5,  // Add more kicks
                        kick:   [0,0,0,1, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        snare:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        hihat:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]
                    },
                    {
                        threshold: 0.65,  // More complex snare pattern
                        kick:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        snare:  [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1],
                        hihat:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]
                    },
                    {
                        threshold: 0.8,  // 16th note hihats
                        kick:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        snare:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                        hihat:  [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1]
                    }
                ]
            }
        };
    }

    /**
     * Define fill patterns (last beat or two of a bar)
     * Categorized by intensity: light, medium, heavy
     */
    defineFills() {
        return {
            // ========== LIGHT FILLS ==========
            simple_snare: {
                intensity: 'light',
                snare: [0,0,0,0, 0,0,0,0, 0,0,0,0, 1,1,1,1],  // 16th notes on beat 4
            },

            double_snare: {
                intensity: 'light',
                snare: [0,0,0,0, 0,0,0,0, 0,0,0,0, 1,0,1,0],  // 8th notes on beat 4
            },

            simple_tom: {
                intensity: 'light',
                tom1:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 1,0,1,0],
                tom2:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,1,0,1],
            },

            kick_snare_simple: {
                intensity: 'light',
                kick:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 1,0,0,0],
                snare: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,1,1,1],
            },

            hihat_accent: {
                intensity: 'light',
                hihat: [0,0,0,0, 0,0,0,0, 0,0,0,0, 1,1,1,1],
            },

            // ========== MEDIUM FILLS ==========
            tom_roll: {
                intensity: 'medium',
                tom1:  [0,0,0,0, 0,0,0,0, 0,0,1,0, 1,0,0,0],
                tom2:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,1,1,1],
            },

            snare_buildup: {
                intensity: 'medium',
                snare: [0,0,0,0, 0,0,0,0, 0,0,1,1, 1,1,1,1],
            },

            tom_cascade: {
                intensity: 'medium',
                tom1:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 1,1,0,0],
                tom2:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,1],
            },

            kick_tom_combo: {
                intensity: 'medium',
                kick:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 1,0,1,0],
                tom1:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,1,0,0],
                tom2:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1],
            },

            snare_tom_roll: {
                intensity: 'medium',
                snare: [0,0,0,0, 0,0,0,0, 0,0,0,0, 1,1,0,0],
                tom1:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0],
                tom2:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1],
            },

            // ========== HEAVY FILLS ==========
            full_kit: {
                intensity: 'heavy',
                kick:  [0,0,0,0, 0,0,0,0, 1,0,0,0, 1,0,0,0],
                snare: [0,0,0,0, 0,0,0,0, 0,1,0,1, 0,1,1,1],
                tom1:  [0,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
            },

            crazy_toms: {
                intensity: 'heavy',
                tom1:  [0,0,0,0, 0,0,0,0, 1,0,1,0, 1,0,0,0],
                tom2:  [0,0,0,0, 0,0,0,0, 0,1,0,1, 0,1,1,1],
            },

            sixteenth_barrage: {
                intensity: 'heavy',
                snare: [0,0,0,0, 0,0,0,0, 0,0,0,0, 1,1,1,1],
                tom1:  [0,0,0,0, 0,0,0,0, 1,1,1,1, 0,0,0,0],
                tom2:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
            },

            full_barrage: {
                intensity: 'heavy',
                kick:  [0,0,0,0, 0,0,0,0, 1,0,1,0, 1,0,1,0],
                snare: [0,0,0,0, 0,0,0,0, 0,1,0,1, 0,1,0,1],
                tom1:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
            },

            ascending_toms: {
                intensity: 'heavy',
                tom2:  [0,0,0,0, 0,0,0,0, 0,0,1,1, 0,0,0,0],
                tom1:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 1,1,0,0],
                snare: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,1],
            }
        };
    }

    /**
     * Calculate swing timing offset for a step position
     * @param {number} step - Step in bar (0-15)
     * @returns {number} Timing offset in milliseconds
     */
    calculateSwingOffset(step) {
        if (this.swingAmount === 0) return 0;

        // Swing affects "off-beat" 16th notes (positions 1, 3, 5, 7, 9, 11, 13, 15)
        if (step % 2 === 0) return 0;  // On-beat, no offset

        // Calculate delay based on swing amount
        // At 0% swing: no delay
        // At 66% swing: delay to create triplet feel (2:1 ratio)
        // At 100% swing: maximum delay (not musical, but available)

        // Get tempo from last clock tick
        const tempo = PubSub.last('clock:tempo')?.bpm || 120;
        const sixteenthMs = (60000 / tempo) / 4;  // Duration of 16th note
        const maxDelay = sixteenthMs * 0.5;  // Max delay is half a 16th

        return this.swingAmount * maxDelay;
    }

    /**
     * Calculate micro-timing offset using Perlin noise
     * @param {string} voiceName - Drum voice name
     * @param {number} step - Step in bar (0-15)
     * @returns {number} Timing offset in milliseconds
     */
    calculateMicroTimingOffset(voiceName, step) {
        if (!this.humanizationEnabled) return 0;

        const char = this.voiceHumanization[voiceName];
        if (!char) return 0;

        // Sample Perlin noise for this voice at current time
        const noiseValue = perlinNoise.sample(
            this.noiseTime + this.voiceOffsets[voiceName],
            char.noiseFreq,
            1.0  // Amplitude 1.0, will scale below
        );

        // Scale by voice-specific timing range and humanization intensity
        const baseRange = char.timingRange;
        const moodMultiplier = this.getMoodTimingMultiplier();
        const finalRange = baseRange * this.humanizationIntensity * moodMultiplier;

        // Tighter timing on downbeats
        const downbeatFactor = (step % 4 === 0) ? 0.5 : 1.0;

        return noiseValue * finalRange * downbeatFactor;
    }

    /**
     * Get timing multiplier based on mood
     * @returns {number} Multiplier for timing range
     */
    getMoodTimingMultiplier() {
        switch (this.mood) {
            case 'tense': return 0.5;    // Tight
            case 'relaxed': return 1.5;  // Loose
            case 'sparse': return 0.3;   // Very tight
            case 'dense': return 1.2;    // Moderate
            default: return 1.0;
        }
    }

    /**
     * Calculate velocity humanization using Perlin noise
     * @param {string} voiceName - Drum voice name
     * @param {number} baseVelocity - Base velocity before humanization
     * @param {number} step - Step in bar (0-15)
     * @returns {number} Velocity variation to add
     */
    calculateVelocityHumanization(voiceName, baseVelocity, step) {
        if (!this.humanizationEnabled) return 0;

        const char = this.voiceHumanization[voiceName];
        if (!char) return 0;

        // Sample Perlin noise for velocity
        const noiseValue = perlinNoise.sample(
            this.noiseTime + this.voiceOffsets[voiceName] + 1000,  // +1000 to decorrelate from timing
            char.noiseFreq * 1.5,  // Slightly higher frequency for velocity
            1.0
        );

        // Scale by voice-specific velocity range and humanization intensity
        const baseRange = char.velocityRange;
        const moodMultiplier = this.getMoodVelocityMultiplier();
        const finalRange = baseRange * this.humanizationIntensity * moodMultiplier;

        // Ghost notes (low velocity) get MORE variation
        const ghostNoteFactor = (baseVelocity < 60) ? 1.5 : 1.0;

        // Downbeats get LESS variation (more intentional)
        const downbeatFactor = (step % 4 === 0) ? 0.7 : 1.0;

        return noiseValue * finalRange * ghostNoteFactor * downbeatFactor;
    }

    /**
     * Get velocity multiplier based on mood
     * @returns {number} Multiplier for velocity range
     */
    getMoodVelocityMultiplier() {
        switch (this.mood) {
            case 'tense': return 1.3;    // More dynamic
            case 'relaxed': return 0.8;  // Subtle
            case 'sparse': return 0.5;   // Consistent
            case 'dense': return 1.2;    // Dynamic
            default: return 1.0;
        }
    }

    /**
     * Specify which attributes to observe
     */
    static get observedAttributes() {
        return [
            ...super.observedAttributes,
            'data-drum-style'
        ];
    }

    /**
     * Parse attributes
     */
    parseAttributes() {
        super.parseAttributes();
        this.drumStyle = this.getAttribute('data-drum-style') || 'rock';
    }

    /**
     * Initialize when connected
     */
    connectedCallback() {
        super.connectedCallback();

        // Select initial groove so UI doesn't show "Unknown"
        this.selectGroove();
    }

    /**
     * Setup subscriptions
     */
    setupSubscriptions() {
        super.setupSubscriptions();

        //console.log('Drummer: Setting up subscriptions');

        // Subscribe to clock ticks
        this.subscribe('clock:tick', (data) => {
            //console.log('Drummer: clock:tick callback fired!', data);
            this.handleClockTick(data);
        });

        //console.log('Drummer: Subscribed to clock:tick');

        // TEST: Direct PubSub subscription to compare
        //console.log('Drummer: Also subscribing directly via PubSub');
        /*PubSub.subscribe('clock:tick', (data) => {
            console.log('Drummer: DIRECT PubSub callback fired!', data.tick);
        });*/

        // Subscribe to mood changes (drummer is primary responder)
        this.subscribe('context:mood', (data) => {
            this.mood = data.mood;
            console.log(`Drummer: Mood changed to ${this.mood}, selecting groove`);
            this.selectGroove();
            this.render(); // Update UI
        });

        // Subscribe to density changes (drummer is primary responder)
        this.subscribe('context:density', (data) => {
            this.density = data.density;
            console.log(`Drummer: Density changed to ${this.density.toFixed(2)}`);
            this.selectGroove();
            this.render(); // Update UI
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
        // Initialize accent velocity tracking
        this.accentVelocity = 100; // Default accent velocity

        // Register Velocity/Accent parameter
        this.registerWhippableParameter('accent', {
            label: 'Accent/Velocity',
            parameterType: 'number',
            min: 60,
            max: 127,
            icon: '🔊',
            customPosition: 'strong', // Position after component name
            setter: (value) => {
                this.accentVelocity = Math.round(value);
            }
        });

        // Register Style parameter (select)
        this.registerWhippableParameter('style', {
            label: 'Style',
            parameterType: 'select',
            elementSelector: '#style-select',
            setter: (value) => {
                // Map 0-1 to style options
                const styles = Object.keys(this.styleLayers);
                const index = Math.floor(value * styles.length);
                const clampedIndex = Math.min(index, styles.length - 1);
                this.setDrumStyle(styles[clampedIndex]);
            }
        });

        // Register Humanization Intensity parameter
        this.registerWhippableParameter('humanization', {
            label: 'Humanization',
            parameterType: 'number',
            min: 0,
            max: 1,
            icon: '🎭',
            setter: (value) => {
                this.humanizationIntensity = value;
            }
        });

        // Register Swing parameter
        this.registerWhippableParameter('swing', {
            label: 'Swing',
            parameterType: 'number',
            min: 0,
            max: 1,
            icon: '〰️',
            setter: (value) => {
                this.swingAmount = value;
            }
        });

        // Render target lights after component is fully rendered
        requestAnimationFrame(() => {
            this.renderTargetLights();
        });
    }

    /**
     * Generate pattern based on style and density gradient
     * Density is applied as a continuous parameter within each style
     */
    generatePatternFromDensity() {
        const style = this.styleLayers[this.drumStyle] || this.styleLayers.rock;
        const pattern = {};

        // Start with base pattern (cloned)
        for (const [drum, hits] of Object.entries(style.base)) {
            pattern[drum] = [...hits];
        }

        // Apply each layer probabilistically based on density
        for (const layer of style.layers) {
            if (this.density >= layer.threshold) {
                // Calculate how far above threshold we are (0-1 scale)
                const nextThreshold = style.layers.find(l => l.threshold > layer.threshold)?.threshold || 1.0;
                const range = nextThreshold - layer.threshold;
                const progress = Math.min(1.0, (this.density - layer.threshold) / range);

                // Apply hits from this layer with probability based on progress
                for (const [drum, hits] of Object.entries(layer)) {
                    if (drum === 'threshold') continue;

                    // Initialize drum array if it doesn't exist
                    if (!pattern[drum]) {
                        pattern[drum] = new Array(16).fill(0);
                    }

                    // Apply layer hits with probability
                    for (let i = 0; i < hits.length; i++) {
                        if (hits[i] === 1 && Math.random() < progress) {
                            pattern[drum][i] = 1;
                        }
                    }
                }
            }
        }

        return pattern;
    }

    /**
     * Select groove based on density and style
     * Generates pattern dynamically using density gradient
     */
    selectGroove() {
        // Generate pattern based on current density and style
        this.currentPattern = this.generatePatternFromDensity();

        console.log(`Drummer: Generated ${this.drumStyle} pattern at density ${this.density.toFixed(2)}`);
    }

    /**
     * Manually set drum style
     * @param {string} styleName - Name of style (e.g., 'rock', 'funk', 'disco', 'jazz', 'breakbeat')
     */
    setDrumStyle(styleName) {
        if (this.styleLayers[styleName]) {
            this.drumStyle = styleName;
            this.selectGroove(); // Regenerate pattern with new style
            console.log(`Drummer: Style manually set to ${styleName}`);
            this.render(); // Update UI
        } else {
            console.warn(`Drummer: Unknown style "${styleName}"`);
        }
    }

    /**
     * Get current drum style
     * @returns {string} Current drum style name
     */
    getCurrentStyleName() {
        return this.drumStyle || 'rock';
    }

    /**
     * Handle clock tick - play the locked groove
     */
    handleClockTick(clockData) {
        //console.log('Drummer handleClockTick called, enabled:', this.enabled, 'data:', clockData);

        if (!this.enabled) {
            console.log('Drummer: Disabled, returning');
            return;
        }

        const { tick, ppqn } = clockData;

        // Prevent duplicate processing
        //console.log('Drummer: Checking duplicate tick:', tick, 'lastTick:', this.lastTick);
        if (tick === this.lastTick) {
            console.log('Drummer: Duplicate tick, returning');
            return;
        }
        this.lastTick = tick;

        // Select groove on first tick
        if (!this.currentPattern) {
            console.log('Drummer: No pattern, selecting groove');
            this.selectGroove();
        }

        // Calculate position in bar
        const ticksPerBar = ppqn * 4; // 4/4 time
        const tickInBar = tick % ticksPerBar;
        const sixteenthNote = ppqn / 4;
        const stepInBar = Math.floor(tickInBar / sixteenthNote); // 0-15

        //console.log('Drummer: Calculated step:', stepInBar, 'lastStep:', this.lastStep);

        // Only play on the FIRST tick of each step (not every tick)
        if (stepInBar === this.lastStep) {
            //console.log('Drummer: Same step as last, returning');
            return; // Still in the same step, don't play again
        }
        this.lastStep = stepInBar;

        // Advance noise time for humanization
        this.noiseTime += 1;

        //console.log(`Drummer: Playing step ${stepInBar} (tick ${tick})`);

        // Track bar changes
        if (tickInBar === 0 && tick > 0) {
            this.barCount++;
        }

        // Check for fill (every 8 bars, last beat)
        const barInPhrase = this.barCount % 8;
        const shouldFill = (barInPhrase === 7 && stepInBar >= 12);

        if (shouldFill) {
            this.playFill(stepInBar);
        } else {
            this.playGroove(stepInBar);
        }
    }

    /**
     * Play the current groove pattern (locked, repeating)
     * @param {number} step - Step in bar (0-15)
     */
    playGroove(step) {
        if (!this.currentPattern) {
            console.log('Drummer: No current pattern!');
            return;
        }

        const baseVelocity = this.calculateBaseVelocity();

        //console.log(`Drummer playGroove: step ${step}, pattern:`, this.currentPattern);

        // Play each voice according to the locked pattern
        for (const [voiceName, pattern] of Object.entries(this.currentPattern)) {
            if (pattern[step] === 1) {
                //console.log(`Drummer: Hit ${voiceName} at step ${step}`);
                this.playDrumHit(voiceName, step, baseVelocity);
            }
        }
    }

    /**
     * Select fill pattern based on density and mood
     * @returns {object} Fill pattern object
     */
    selectFill() {
        const fills = this.defineFills();
        const fillKeys = Object.keys(fills);

        // Filter by intensity based on density
        let intensityFilter;
        if (this.density < 0.35) {
            intensityFilter = 'light';
        } else if (this.density < 0.7) {
            intensityFilter = 'medium';
        } else {
            intensityFilter = 'heavy';
        }

        // Get candidates matching intensity
        const candidates = fillKeys.filter(key =>
            fills[key].intensity === intensityFilter
        );

        // Randomly select from candidates
        if (candidates.length === 0) {
            // Fallback to simple_snare if no candidates
            return fills.simple_snare;
        }

        const selectedKey = candidates[Math.floor(Math.random() * candidates.length)];
        return fills[selectedKey];
    }

    /**
     * Play a fill pattern with humanization (rushing, crescendo)
     * @param {number} step - Step in bar (12-15 typically)
     */
    playFill(step) {
        // Cache selected fill pattern at start of fill (step 12)
        if (step === 12 && !this.currentFillPattern) {
            this.currentFillPattern = this.selectFill();
        }

        const fillPattern = this.currentFillPattern || this.selectFill();
        const baseVelocity = this.calculateBaseVelocity();

        // Fill progress (0.0 at step 12, 1.0 at step 15)
        const fillProgress = Math.max(0, (step - 12) / 3);

        // Rushing: notes get earlier as fill progresses (accelerating into downbeat)
        const rushOffset = -fillProgress * 15;  // Up to -15ms earlier

        // Crescendo: velocity increases toward crash
        const crescendoBoost = fillProgress * 20;  // Up to +20 velocity

        for (const [voiceName, pattern] of Object.entries(fillPattern)) {
            if (voiceName === 'intensity') continue;  // Skip metadata

            if (pattern[step] === 1) {
                const fillVelocity = baseVelocity + 10 + crescendoBoost;

                // Apply timing offset via setTimeout for rushing effect
                if (rushOffset !== 0) {
                    setTimeout(() => {
                        this.playDrumHit(voiceName, step, fillVelocity);
                    }, Math.max(0, rushOffset));
                } else {
                    this.playDrumHit(voiceName, step, fillVelocity);
                }
            }
        }

        // Crash on downbeat after fill
        if (step === 15) {
            // Reset cached fill pattern for next fill
            this.currentFillPattern = null;

            // Schedule crash with timing compensation for rush
            setTimeout(() => {
                this.playDrumHit('crash', 0, baseVelocity + 35);
            }, Math.max(0, 50 + rushOffset));  // Compensate for rush
        }
    }

    /**
     * Play a drum hit with velocity humanization
     * @param {string} voiceName - Drum voice name
     * @param {number} step - Current step (for accents)
     * @param {number} baseVelocity - Base velocity
     */
    playDrumHit(voiceName, step, baseVelocity) {
        const note = this.drumNotes[voiceName];
        if (!note) return;

        let velocity = baseVelocity;

        // Voice-specific adjustments
        if (voiceName === 'kick') {
            velocity += 12;
        } else if (voiceName === 'crash') {
            velocity += 20;
        } else if (voiceName === 'ride') {
            velocity -= 5;
        }

        // Accent downbeats (beats 1, 2, 3, 4 = steps 0, 4, 8, 12)
        if (step % 4 === 0) {
            // Use whip-controlled accent velocity or default
            const accentBoost = this.accentVelocity ? (this.accentVelocity - 100) : 10;
            velocity += accentBoost;
        }

        // NEW: Perlin-based velocity humanization
        const velocityHumanization = this.calculateVelocityHumanization(voiceName, velocity, step);
        velocity += velocityHumanization;

        // Clamp to MIDI range
        velocity = Math.max(30, Math.min(127, velocity));

        // Calculate timing offset
        const swingOffset = this.calculateSwingOffset(step);
        const microTimingOffset = this.calculateMicroTimingOffset(voiceName, step);
        const totalTimingOffset = swingOffset + microTimingOffset;

        // Duration
        let duration = 100;
        if (voiceName === 'crash' || voiceName === 'ride') {
            duration = 500;
        } else if (voiceName === 'hihat') {
            duration = 60;
        } else if (voiceName === 'hihatOpen') {
            duration = 200;
        }

        // Send note with timing offset
        if (totalTimingOffset !== 0) {
            setTimeout(() => {
                this.sendNote(note, velocity, duration);
            }, Math.max(0, totalTimingOffset));  // Negative offsets become 0
        } else {
            this.sendNote(note, velocity, duration);
        }
    }

    /**
     * Calculate base velocity from mood
     * @returns {number} Base MIDI velocity
     */
    calculateBaseVelocity() {
        switch (this.mood) {
            case 'tense':
                return 95;
            case 'relaxed':
                return 60;
            case 'sparse':
                return 50;
            case 'dense':
                return 80;
            default:
                return 70;
        }
    }

    /**
     * Render style selector options
     * @returns {string} HTML options for style selector
     */
    renderStyleOptions() {
        const currentStyleName = this.getCurrentStyleName();
        const styleNames = Object.keys(this.styleLayers);

        return styleNames.map(name => {
            const displayName = name.charAt(0).toUpperCase() + name.slice(1); // Capitalize first letter
            const selected = name === currentStyleName ? 'selected' : '';
            return `<option value="${name}" ${selected}>${displayName}</option>`;
        }).join('');
    }

    /**
     * Render UI
     */
    render() {
        this.innerHTML = `
            <div style="background: #2d2d2d; padding: 10px; margin: 5px 0; border-left: 3px solid #d7ba7d;">
                <strong style="color: #d7ba7d;">🥁 Drummer</strong>
                <span style="margin-left: 10px; color: #888;">
                    Channel:
                    <select id="channel-select" style="margin: 0 5px;">
                        ${this.renderChannelOptions()}
                    </select>
                    | Style:
                    <select id="style-select" style="margin: 0 5px;">
                        ${this.renderStyleOptions()}
                    </select>
                    | Mood: ${this.mood}
                    | Density: ${(this.density * 100).toFixed(0)}%
                </span>
                <br>
                <span style="margin-left: 10px; color: #888;">
                    Humanization:
                    <input type="range" id="humanization-slider" min="0" max="100"
                           value="${Math.round(this.humanizationIntensity * 100)}"
                           style="width: 100px; vertical-align: middle;">
                    <span id="humanization-value">${Math.round(this.humanizationIntensity * 100)}%</span>
                    | <button id="humanization-toggle" style="padding: 2px 8px; margin: 0 5px;">${this.humanizationEnabled ? '🎭 Human' : '🤖 Robot'}</button>
                    | Swing:
                    <input type="range" id="swing-slider" min="0" max="100"
                           value="${Math.round(this.swingAmount * 100)}"
                           style="width: 100px; vertical-align: middle;">
                    <span id="swing-value">${Math.round(this.swingAmount * 100)}%</span>
                    | <button id="mute-btn" style="padding: 2px 8px; margin: 0 5px;">${this.muted ? '🔇 Unmute' : '🔊 Mute'}</button>
                    | <button id="debug-btn" style="padding: 2px 8px; margin: 0 5px;">${this.debug ? '🐛 Debug OFF' : '🐛 Debug'}</button>
                    | ${this.enabled ? '✓ Enabled' : '✗ Disabled'}
                </span>
            </div>
        `;

        // Setup event handlers
        const channelSelect = this.$('#channel-select');
        if (channelSelect) {
            channelSelect.onchange = (e) => {
                this.setChannel(parseInt(e.target.value));
            };
        }

        const styleSelect = this.$('#style-select');
        if (styleSelect) {
            styleSelect.onchange = (e) => {
                this.setDrumStyle(e.target.value);
            };
        }

        const muteBtn = this.$('#mute-btn');
        if (muteBtn) {
            muteBtn.onclick = () => {
                this.toggleMute();
            };
        }

        const debugBtn = this.$('#debug-btn');
        if (debugBtn) {
            debugBtn.onclick = () => {
                this.toggleDebug();
            };
        }

        const humanizationSlider = this.$('#humanization-slider');
        if (humanizationSlider) {
            humanizationSlider.oninput = (e) => {
                this.humanizationIntensity = parseInt(e.target.value) / 100;
                const valueDisplay = this.$('#humanization-value');
                if (valueDisplay) {
                    valueDisplay.textContent = `${parseInt(e.target.value)}%`;
                }
            };
        }

        const humanizationToggle = this.$('#humanization-toggle');
        if (humanizationToggle) {
            humanizationToggle.onclick = () => {
                this.humanizationEnabled = !this.humanizationEnabled;
                this.render();
            };
        }

        const swingSlider = this.$('#swing-slider');
        if (swingSlider) {
            swingSlider.oninput = (e) => {
                this.swingAmount = parseInt(e.target.value) / 100;
                const valueDisplay = this.$('#swing-value');
                if (valueDisplay) {
                    valueDisplay.textContent = `${parseInt(e.target.value)}%`;
                }
            };
        }

        // Re-render target lights after DOM update
        requestAnimationFrame(() => {
            this.renderTargetLights();
        });
    }
}

// Register custom element
customElements.define('sonofire-drummer', SonofireDrummer);
