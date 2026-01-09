import { BaseInstrumentalist } from './base_instrumentalist.js';
import { perlinNoise } from '../../lib/unit_noise.js';
import { PubSub } from '../../lib/pubsub.js';

/**
 * Keyboardist Component
 * Generates keyboard parts (organ, piano, vibraphone, harpsichord)
 * with different approaches (arpeggio, block chords, comping)
 */
export class SonofireKeyboardist extends BaseInstrumentalist {
    constructor() {
        super();

        // Keyboardist-specific settings
        this.channel = 4;                     // MIDI channel 4
        this.instrumentStyle = 'piano';       // 'organ', 'piano', 'vibraphone', 'harpsichord'
        this.playingApproach = 'comping';     // 'arpeggio', 'block', 'comping'
        this.timeSignature = '4/4';           // '2/4', '3/4', '4/4', '5/4', '6/8'
        this.sixteenthsPerBar = 16;           // Calculated from time signature

        // Note range settings
        this.minNote = 48;                    // C3
        this.maxNote = 84;                    // C6 (3 octave range)

        // Performance state
        this.lastPosition = -1;               // Last 16th note position played
        this.currentVoicing = null;           // Current chord voicing
        this.arpeggioIndex = 0;               // Current position in arpeggio

        // Rhythm engine state
        this.currentRhythmPattern = null;     // Current rhythm pattern {pattern, velocity}

        // Humanization state
        this.humanizationEnabled = true;
        this.humanizationIntensity = 0.6;     // 0-1, controlled by slider
        this.noiseTime = 0;                   // Advances each step

        // Keyboard-specific humanization characteristics
        this.keyboardHumanization = {
            velocityRange: 10,                // ±10 max velocity variation
            timingRange: 4,                   // ±4ms max timing offset
            noiseFreq: 0.14                   // Moderate noise frequency
        };

        // Define instrument styles, approaches, and rhythm layers
        this.instrumentStyles = this.defineInstrumentStyles();
        this.playingApproaches = this.definePlayingApproaches();
        this.rhythmLayers = this.defineRhythmLayers(this.timeSignature);

        // Initialize rhythm pattern
        this.regenerateRhythmPattern();
    }

    /**
     * Define instrument style characteristics
     * Each style has voicing spread, note count, and duration characteristics
     */
    defineInstrumentStyles() {
        return {
            organ: {
                label: 'Organ',
                icon: '🎹',
                voicingSpread: 'sparse',        // Wide intervals
                voicingNotes: 3,                // Fewer notes (root, 5th, 7th typically)
                duration: 1000,                 // Long sustain
                velocityBase: 85,               // Moderate velocity
                description: 'Sparse harmonic voicings, long sustain'
            },
            piano: {
                label: 'Piano',
                icon: '🎹',
                voicingSpread: 'close',         // Close intervals
                voicingNotes: 4,                // More notes (fuller voicings)
                duration: 300,                  // Shorter decay
                velocityBase: 75,               // Dynamic range
                description: 'Close harmonic voicings, percussive with shorter decay'
            },
            vibraphone: {
                label: 'Vibraphone',
                icon: '🎼',
                voicingSpread: 'wide',          // Very wide intervals
                voicingNotes: 3,                // Fewer notes (open sound)
                duration: 600,                  // Longer decay
                velocityBase: 70,               // Softer
                description: 'Wide harmonic voicings, percussive with longer decay'
            },
            harpsichord: {
                label: 'Harpsichord',
                icon: '🎵',
                voicingSpread: 'close',         // Close intervals
                voicingNotes: 3,                // Simple voicings
                duration: 150,                  // Very short decay
                velocityBase: 80,               // Consistent (harpsichord has no dynamics)
                description: 'Close, simple harmonic voicings, percussive with very short decay'
            }
        };
    }

    /**
     * Define playing approach characteristics
     */
    definePlayingApproaches() {
        return {
            arpeggio: {
                label: 'Arpeggio',
                icon: '🎶',
                playMode: 'sequential',         // Play notes one at a time
                arpeggioDirection: 'up',        // up, down, updown
                description: 'Play chord tones sequentially'
            },
            block: {
                label: 'Block Chords',
                icon: '▌',
                playMode: 'simultaneous',       // Play all notes together
                description: 'Play all notes simultaneously'
            },
            comping: {
                label: 'Comping',
                icon: '🎵',
                playMode: 'rhythmic',           // Rhythmic chord stabs
                description: 'Rhythmic chord stabs with varied patterns'
            }
        };
    }

    /**
     * Define rhythm layers for different playing approaches
     * Adapted to current time signature
     * @param {string} timeSignature - Time signature ('2/4', '3/4', '4/4', '5/4', '6/8')
     */
    defineRhythmLayers(timeSignature = '4/4') {
        const patterns4_4 = this.getBase4_4RhythmPatterns();
        return this.adaptPatternsToTimeSignature(patterns4_4, timeSignature);
    }

    /**
     * Get base 4/4 rhythm patterns (all approaches)
     * Pattern: 16 positions (4 beats × 4 sixteenths)
     * @returns {object} Rhythm patterns for 4/4 time
     */
    getBase4_4RhythmPatterns() {
        return {
            // Arpeggio rhythm - continuous flowing patterns
            arpeggio: {
                base: {
                    pattern: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],  // Quarter notes
                    velocity: [90,0,0,0, 85,0,0,0, 90,0,0,0, 85,0,0,0]
                },
                layers: [
                    {
                        threshold: 0.3,
                        pattern: [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],  // Add 8th notes
                        velocity: [0,0,80,0, 0,0,75,0, 0,0,80,0, 0,0,75,0]
                    },
                    {
                        threshold: 0.6,
                        pattern: [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1],  // 16th notes
                        velocity: [0,70,0,70, 0,65,0,70, 0,70,0,70, 0,65,0,70]
                    }
                ]
            },

            // Block chord rhythm - punctuated chords
            block: {
                base: {
                    pattern: [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],  // Beats 1 & 3
                    velocity: [95,0,0,0, 0,0,0,0, 90,0,0,0, 0,0,0,0]
                },
                layers: [
                    {
                        threshold: 0.4,
                        pattern: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],  // Add beats 2 & 4
                        velocity: [0,0,0,0, 85,0,0,0, 0,0,0,0, 85,0,0,0]
                    },
                    {
                        threshold: 0.7,
                        pattern: [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],  // Add "and" of each beat
                        velocity: [0,0,75,0, 0,0,70,0, 0,0,75,0, 0,0,70,0]
                    }
                ]
            },

            // Comping rhythm - syncopated rhythmic patterns
            comping: {
                base: {
                    pattern: [1,0,0,0, 0,0,0,0, 0,0,0,0, 1,0,0,0],  // Syncopated (1 and 4)
                    velocity: [90,0,0,0, 0,0,0,0, 0,0,0,0, 85,0,0,0]
                },
                layers: [
                    {
                        threshold: 0.35,
                        pattern: [0,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,0,0],  // "and of 2" and beat 3
                        velocity: [0,0,0,0, 0,0,80,0, 85,0,0,0, 0,0,0,0]
                    },
                    {
                        threshold: 0.65,
                        pattern: [0,0,0,1, 0,0,0,0, 0,0,1,0, 0,0,0,0],  // More syncopation
                        velocity: [0,0,0,75, 0,0,0,0, 0,0,75,0, 0,0,0,0]
                    }
                ]
            }
        };
    }

    /**
     * Adapt 4/4 patterns to different time signatures
     */
    adaptPatternsToTimeSignature(patterns4_4, timeSignature) {
        if (timeSignature === '4/4') return patterns4_4;

        const adapted = {};
        for (const [approachName, approachData] of Object.entries(patterns4_4)) {
            adapted[approachName] = {
                base: this.adaptRhythmObject(approachData.base, timeSignature),
                layers: approachData.layers.map(layer => ({
                    threshold: layer.threshold,
                    ...this.adaptRhythmObject(layer, timeSignature)
                }))
            };
        }
        return adapted;
    }

    adaptRhythmObject(rhythmObj, timeSignature) {
        const adapted = {};
        for (const [key, array] of Object.entries(rhythmObj)) {
            if (key === 'threshold') continue;
            if (!Array.isArray(array)) continue;
            adapted[key] = this.adaptSingleArray(array, timeSignature);
        }
        return adapted;
    }

    adaptSingleArray(array, timeSignature) {
        switch (timeSignature) {
            case '2/4': return array.slice(0, 8);
            case '3/4': return array.slice(0, 12);
            case '5/4': return [...array, ...array.slice(0, 4)];
            case '6/8': return array.slice(0, 12);
            default: return array;
        }
    }

    /**
     * Generate rhythm pattern from approach and density
     * @param {string} approach - Playing approach key
     * @param {number} density - Density value (0-1)
     * @returns {{pattern: number[], velocity: number[]}}
     */
    generateRhythmPattern(approach, density) {
        const layers = this.rhythmLayers[approach];
        if (!layers) {
            console.warn(`Keyboardist: Unknown approach "${approach}", using comping`);
            return this.generateRhythmPattern('comping', density);
        }

        // Start with base pattern (cloned)
        const pattern = [...layers.base.pattern];
        const velocity = [...layers.base.velocity];

        // Apply density layers probabilistically
        for (const layer of layers.layers) {
            if (density >= layer.threshold) {
                const nextThreshold = layers.layers.find(l => l.threshold > layer.threshold)?.threshold || 1.0;
                const range = nextThreshold - layer.threshold;
                const progress = Math.min(1.0, (density - layer.threshold) / range);

                for (let i = 0; i < 16; i++) {
                    if (layer.pattern[i] === 1 && Math.random() < progress) {
                        pattern[i] = 1;
                        if (velocity[i] === 0 || layer.velocity[i] > velocity[i]) {
                            velocity[i] = layer.velocity[i];
                        }
                    }
                }
            }
        }

        return { pattern, velocity };
    }

    /**
     * Regenerate rhythm pattern based on current approach and density
     */
    regenerateRhythmPattern() {
        // Regenerate rhythm layers for current time signature
        this.rhythmLayers = this.defineRhythmLayers(this.timeSignature);

        this.currentRhythmPattern = this.generateRhythmPattern(this.playingApproach, this.density);
    }

    /**
     * Generate chord voicing based on current chord and instrument style
     * @returns {number[]} Array of MIDI notes
     */
    generateVoicing() {
        if (!this.currentChord) return [];

        const style = this.instrumentStyles[this.instrumentStyle];
        const root = this.currentChord.root;
        const voicing = this.currentChord.voicing || [];

        // Use composer's voicing as basis, adapt to instrument style
        let notes = [];

        if (voicing.length === 0) {
            // Fallback: build basic triad
            notes = [root, root + 4, root + 7];
        } else {
            // Use composer's voicing
            notes = [...voicing];
        }

        // Adjust note count based on instrument style
        if (style.voicingNotes < notes.length) {
            // Reduce notes (keep root, 3rd/4th, 7th typically)
            const reduced = [notes[0]];  // Root
            if (notes.length >= 2) reduced.push(notes[1]);  // 3rd
            if (notes.length >= 4) reduced.push(notes[3]);  // 7th
            notes = reduced;
        }

        // Adjust spread based on instrument style
        notes = this.adjustVoicingSpread(notes, style.voicingSpread);

        // Ensure notes are in range
        notes = notes.map(n => this.constrainToRange(n));

        return notes;
    }

    /**
     * Adjust voicing spread (interval distances)
     * @param {number[]} notes - Original notes
     * @param {string} spread - 'close', 'sparse', 'wide'
     * @returns {number[]} Adjusted notes
     */
    adjustVoicingSpread(notes, spread) {
        if (notes.length === 0) return notes;

        const root = notes[0];
        const adjusted = [root];

        switch (spread) {
            case 'close':
                // Keep notes within an octave, close intervals
                for (let i = 1; i < notes.length; i++) {
                    let note = notes[i];
                    // Force into octave above root
                    while (note < root) note += 12;
                    while (note > root + 12) note -= 12;
                    adjusted.push(note);
                }
                break;

            case 'sparse':
                // Wider intervals, drop some middle notes
                for (let i = 1; i < notes.length; i++) {
                    let note = notes[i];
                    // Move to higher octave for spacious sound
                    while (note < root + 7) note += 12;
                    adjusted.push(note);
                }
                break;

            case 'wide':
                // Very wide intervals, spread across range
                for (let i = 1; i < notes.length; i++) {
                    let note = notes[i];
                    // Spread notes across wider range
                    note += (i * 12);  // Each note an octave higher
                    adjusted.push(note);
                }
                break;

            default:
                return notes;
        }

        return adjusted;
    }

    /**
     * Constrain note to playable range
     * @param {number} note - MIDI note
     * @returns {number} Note within range
     */
    constrainToRange(note) {
        while (note < this.minNote) note += 12;
        while (note > this.maxNote) note -= 12;
        return Math.max(this.minNote, Math.min(this.maxNote, note));
    }

    /**
     * Calculate micro-timing offset using Perlin noise
     * @param {number} position - Position in bar (0-15)
     * @returns {number} Timing offset in milliseconds
     */
    calculateMicroTimingOffset(position) {
        if (!this.humanizationEnabled) return 0;

        const char = this.keyboardHumanization;

        const noiseValue = perlinNoise.sample(
            this.noiseTime,
            char.noiseFreq,
            1.0
        );

        const baseRange = char.timingRange;
        const moodMultiplier = this.getMoodTimingMultiplier();
        const finalRange = baseRange * this.humanizationIntensity * moodMultiplier;

        // Tighter timing on downbeats
        const downbeatFactor = (position % 4 === 0) ? 0.5 : 1.0;

        return noiseValue * finalRange * downbeatFactor;
    }

    /**
     * Get timing multiplier based on mood
     * @returns {number}
     */
    getMoodTimingMultiplier() {
        switch (this.mood) {
            case 'tense': return 0.6;
            case 'relaxed': return 1.4;
            case 'sparse': return 0.4;
            case 'dense': return 1.2;
            default: return 1.0;
        }
    }

    /**
     * Calculate velocity humanization using Perlin noise
     * @param {number} baseVelocity - Base velocity
     * @param {number} position - Position in bar (0-15)
     * @returns {number} Velocity variation to add
     */
    calculateVelocityHumanization(baseVelocity, position) {
        if (!this.humanizationEnabled) return 0;

        const char = this.keyboardHumanization;

        const noiseValue = perlinNoise.sample(
            this.noiseTime + 1000,
            char.noiseFreq * 1.3,
            1.0
        );

        const baseRange = char.velocityRange;
        const moodMultiplier = this.getMoodVelocityMultiplier();
        const finalRange = baseRange * this.humanizationIntensity * moodMultiplier;

        const downbeatFactor = (position % 4 === 0) ? 0.7 : 1.0;

        return noiseValue * finalRange * downbeatFactor;
    }

    /**
     * Get velocity multiplier based on mood
     * @returns {number}
     */
    getMoodVelocityMultiplier() {
        switch (this.mood) {
            case 'tense': return 1.3;
            case 'relaxed': return 0.8;
            case 'sparse': return 0.5;
            case 'dense': return 1.1;
            default: return 1.0;
        }
    }

    /**
     * Specify which attributes to observe
     */
    static get observedAttributes() {
        return [
            ...super.observedAttributes,
            'data-instrument-style',
            'data-playing-approach',
            'data-density'
        ];
    }

    /**
     * Parse attributes
     */
    parseAttributes() {
        super.parseAttributes();

        this.instrumentStyle = this.getAttribute('data-instrument-style') || 'piano';
        this.playingApproach = this.getAttribute('data-playing-approach') || 'comping';

        const densityAttr = this.getAttribute('data-density');
        if (densityAttr !== null) {
            this.density = parseFloat(densityAttr);
        }
    }

    /**
     * Setup subscriptions
     */
    setupSubscriptions() {
        super.setupSubscriptions();

        // Subscribe to clock ticks
        this.subscribe('clock:tick', (data) => {
            this.handleClockTick(data);
        });

        // Subscribe to chord changes
        this.subscribe('music:chord', (data) => {
            this.handleChordChange(data);
            // Generate new voicing when chord changes
            this.currentVoicing = this.generateVoicing();
            this.arpeggioIndex = 0;  // Reset arpeggio
        });

        // Subscribe to density changes
        this.subscribe('context:density', (data) => {
            this.density = data.density;
            this.regenerateRhythmPattern();
            this.renderThrottled(); // Use throttled render to prevent jitter
        });

        // Subscribe to time signature changes
        this.subscribe('context:timeSignature', (data) => {
            this.timeSignature = data.timeSignature;
            this.sixteenthsPerBar = data.sixteenthsPerBar;
            this.regenerateRhythmPattern(); // Regenerate pattern for new time signature
            this.renderThrottled();
        });
    }

    /**
     * Initialize when connected
     */
    connectedCallback() {
        super.connectedCallback();

        // Register whippable parameters
        this.registerWhippableParameters();

        // Generate initial voicing
        if (this.currentChord) {
            this.currentVoicing = this.generateVoicing();
        }
    }

    /**
     * Register whippable parameters
     */
    registerWhippableParameters() {
        // Humanization intensity
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

        // Density
        this.registerWhippableParameter('density', {
            label: 'Density',
            parameterType: 'number',
            min: 0,
            max: 1,
            elementSelector: '#density-slider',
            setter: (value) => {
                this.density = value;
                this.regenerateRhythmPattern();
            }
        });
    }

    /**
     * Handle clock tick
     * @param {object} clockData - Clock data with tick and ppqn
     */
    handleClockTick(clockData) {
        if (!this.enabled) return;

        const { tick, ppqn } = clockData;

        // Calculate 16th note position in bar (varies by time signature)
        const [beatsPerBar, noteValue] = this.timeSignature.split('/').map(n => parseInt(n));
        let quartersPerBar;
        if (noteValue === 8 && beatsPerBar === 6) {
            quartersPerBar = 3; // 6/8 time: 3 quarter notes duration
        } else {
            quartersPerBar = beatsPerBar;
        }

        const ticksPerBar = ppqn * quartersPerBar;
        const tickInBar = tick % ticksPerBar;
        const sixteenthNote = ppqn / 4;
        const position = Math.floor(tickInBar / sixteenthNote); // 0 to (sixteenthsPerBar-1)

        // Prevent duplicate processing
        if (position === this.lastPosition) return;
        this.lastPosition = position;

        // Advance noise time
        this.noiseTime += 1;

        // Ensure we have a voicing
        if (!this.currentVoicing || this.currentVoicing.length === 0) {
            this.currentVoicing = this.generateVoicing();
            if (this.currentVoicing.length === 0) return;
        }

        // Ensure we have a rhythm pattern
        if (!this.currentRhythmPattern) {
            this.regenerateRhythmPattern();
        }

        const { pattern, velocity } = this.currentRhythmPattern;

        // Should we play on this position?
        if (pattern[position] === 1) {
            this.playAtPosition(position, velocity[position]);
        }
    }

    /**
     * Play notes at current position based on approach
     * @param {number} position - Position in bar (0-15)
     * @param {number} baseVelocity - Base velocity from pattern
     */
    playAtPosition(position, baseVelocity) {
        const approach = this.playingApproaches[this.playingApproach];
        const style = this.instrumentStyles[this.instrumentStyle];

        // Apply velocity humanization
        let velocity = baseVelocity + style.velocityBase - 80;  // Adjust to instrument
        const velocityHumanization = this.calculateVelocityHumanization(velocity, position);
        velocity += Math.round(velocityHumanization);
        velocity = Math.max(30, Math.min(127, velocity));

        // Calculate timing offset
        const microTimingOffset = this.calculateMicroTimingOffset(position);

        const duration = style.duration;

        switch (approach.playMode) {
            case 'sequential':
                // Arpeggio: play one note at a time
                this.playArpeggio(position, velocity, duration, microTimingOffset);
                break;

            case 'simultaneous':
                // Block chord: play all notes together
                this.playBlockChord(position, velocity, duration, microTimingOffset);
                break;

            case 'rhythmic':
                // Comping: rhythmic chord stabs
                this.playComping(position, velocity, duration, microTimingOffset);
                break;
        }
    }

    /**
     * Play arpeggio (one note at a time)
     * @param {number} position - Position in bar
     * @param {number} velocity - Velocity
     * @param {number} duration - Duration
     * @param {number} timingOffset - Timing offset
     */
    playArpeggio(position, velocity, duration, timingOffset) {
        if (this.currentVoicing.length === 0) return;

        // Cycle through voicing notes
        const note = this.currentVoicing[this.arpeggioIndex];
        this.arpeggioIndex = (this.arpeggioIndex + 1) % this.currentVoicing.length;

        if (timingOffset !== 0) {
            setTimeout(() => {
                this.sendNote(note, velocity, duration);
            }, Math.max(0, timingOffset));
        } else {
            this.sendNote(note, velocity, duration);
        }
    }

    /**
     * Play block chord (all notes simultaneously)
     * @param {number} position - Position in bar
     * @param {number} velocity - Velocity
     * @param {number} duration - Duration
     * @param {number} timingOffset - Timing offset
     */
    playBlockChord(position, velocity, duration, timingOffset) {
        if (this.currentVoicing.length === 0) return;

        if (timingOffset !== 0) {
            setTimeout(() => {
                this.currentVoicing.forEach(note => {
                    this.sendNote(note, velocity, duration);
                });
            }, Math.max(0, timingOffset));
        } else {
            this.currentVoicing.forEach(note => {
                this.sendNote(note, velocity, duration);
            });
        }
    }

    /**
     * Play comping (rhythmic chord stabs with slight note spreading)
     * @param {number} position - Position in bar
     * @param {number} velocity - Velocity
     * @param {number} duration - Duration
     * @param {number} timingOffset - Timing offset
     */
    playComping(position, velocity, duration, timingOffset) {
        if (this.currentVoicing.length === 0) return;

        // Comping: play chord with slight spread (not perfectly simultaneous)
        const spreadMs = 15;  // Slight strum effect

        this.currentVoicing.forEach((note, index) => {
            const noteOffset = timingOffset + (index * spreadMs);

            if (noteOffset !== 0) {
                setTimeout(() => {
                    this.sendNote(note, velocity, duration);
                }, Math.max(0, noteOffset));
            } else {
                this.sendNote(note, velocity, duration);
            }
        });
    }

    /**
     * Render UI
     */
    render() {
        this.innerHTML = `
            <div style="background: #2d2d2d; padding: 10px; margin: 5px 0; border-left: 3px solid #9cdcfe;">
                <strong style="color: #9cdcfe;">🎹 Keyboardist</strong>
                <span style="margin-left: 10px; color: #888;">
                    Channel:
                    <select id="channel-select" style="margin: 0 5px;">
                        ${this.renderChannelOptions()}
                    </select>
                    | Instrument:
                    <select id="instrument-select" style="margin: 0 5px;">
                        ${this.renderInstrumentOptions()}
                    </select>
                    | Approach:
                    <select id="approach-select" style="margin: 0 5px;">
                        ${this.renderApproachOptions()}
                    </select>
                    | Density ${this.getTargetLightHTML('density')}:
                    <input type="range" id="density-slider" min="0" max="100" value="${this.density * 100}" style="width: 100px; vertical-align: middle;">
                    <span style="margin-left: 5px;">${Math.round(this.density * 100)}%</span>
                </span>
                <br>
                <span style="margin-left: 10px; color: #888;">
                    Humanization ${this.getTargetLightHTML('humanization')}:
                    <input type="range" id="humanization-slider" min="0" max="100"
                           value="${Math.round(this.humanizationIntensity * 100)}"
                           style="width: 100px; vertical-align: middle;">
                    <span id="humanization-value">${Math.round(this.humanizationIntensity * 100)}%</span>
                    | <button id="humanization-toggle" style="padding: 2px 8px; margin: 0 5px;">${this.humanizationEnabled ? '🎭 Human' : '🤖 Robot'}</button>
                    | <button id="mute-btn" style="padding: 2px 8px; margin: 0 5px;">${this.muted ? '🔇 Unmute' : '🔊 Mute'}</button>
                    | <button id="debug-btn" style="padding: 2px 8px; margin: 0 5px;">${this.debug ? '🐛 Debug OFF' : '🐛 Debug'}</button>
                    | ${this.enabled ? '✓ Enabled' : '✗ Disabled'}
                </span>
            </div>
        `;

        // Setup event handlers
        const channelSelect = this.$('#channel-select');
        channelSelect.onfocus = () => this.startUIInteraction();
        channelSelect.onblur = () => this.endUIInteraction();
        channelSelect.onchange = (e) => {
            this.setChannel(parseInt(e.target.value));
            this.endUIInteraction();
        };

        const instrumentSelect = this.$('#instrument-select');
        instrumentSelect.onfocus = () => this.startUIInteraction();
        instrumentSelect.onblur = () => this.endUIInteraction();
        instrumentSelect.onchange = (e) => {
            this.instrumentStyle = e.target.value;
            this.currentVoicing = this.generateVoicing();  // Regenerate voicing
            this.renderThrottled();
            this.endUIInteraction();
        };

        const approachSelect = this.$('#approach-select');
        approachSelect.onfocus = () => this.startUIInteraction();
        approachSelect.onblur = () => this.endUIInteraction();
        approachSelect.onchange = (e) => {
            this.playingApproach = e.target.value;
            this.regenerateRhythmPattern();
            this.arpeggioIndex = 0;  // Reset arpeggio
            this.renderThrottled();
            this.endUIInteraction();
        };

        const densitySlider = this.$('#density-slider');
        densitySlider.onmousedown = () => this.startUIInteraction();
        densitySlider.onmouseup = () => this.endUIInteraction();
        densitySlider.oninput = (e) => {
            this.density = parseInt(e.target.value) / 100;
            this.regenerateRhythmPattern();
            this.renderThrottled();
        };

        const humanizationSlider = this.$('#humanization-slider');
        if (humanizationSlider) {
            humanizationSlider.onmousedown = () => this.startUIInteraction();
            humanizationSlider.onmouseup = () => this.endUIInteraction();
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
                this.renderThrottled();
            };
        }

        this.$('#mute-btn').onclick = () => {
            this.toggleMute();
        };

        this.$('#debug-btn').onclick = () => {
            this.toggleDebug();
        };

        // Sync target light colors with existing bindings
        this.syncTargetLightColors();
    }

    /**
     * Render instrument selector options
     * @returns {string}
     */
    renderInstrumentOptions() {
        return Object.keys(this.instrumentStyles).map(key => {
            const style = this.instrumentStyles[key];
            const selected = key === this.instrumentStyle ? 'selected' : '';
            return `<option value="${key}" ${selected}>${style.icon} ${style.label}</option>`;
        }).join('');
    }

    /**
     * Render approach selector options
     * @returns {string}
     */
    renderApproachOptions() {
        return Object.keys(this.playingApproaches).map(key => {
            const approach = this.playingApproaches[key];
            const selected = key === this.playingApproach ? 'selected' : '';
            return `<option value="${key}" ${selected}>${approach.icon} ${approach.label}</option>`;
        }).join('');
    }
}

// Register custom element
customElements.define('sonofire-keyboardist', SonofireKeyboardist);
