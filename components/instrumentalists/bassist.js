import { BaseInstrumentalist } from './base_instrumentalist.js';
import { weightedRandomSelect, chromaticApproach } from '../../lib/generative_algorithms.js';
import { perlinNoise } from '../../lib/unit_noise.js';
import { PubSub } from '../../lib/pubsub.js';

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
        this.motionType = 'root-5th';     // Current motion type (root-only, root-5th, shell, etc.)
        this.rhythmPattern = null;        // Manual rhythm pattern selection (null = use motion type's pattern)

        // Note range settings - FIXED to first 3 bass strings (E1, A1, D2) up to 12th fret
        this.minNote = 28;                // E1 (first string open)
        this.maxNote = 50;                // D3 (third string, 12th fret)

        // Performance state
        this.lastPosition = -1;           // Last 16th note position played
        this.lastNote = null;             // Last note played
        this.accentVelocity = 100;        // Accent/velocity control (40-127)

        // Rhythm engine state
        this.currentRhythmPattern = null; // Current rhythm pattern {pattern, velocity}

        // Playhead integration state
        this.lastPlayheadTrigger = 0;     // Timestamp of last playhead trigger
        this.plannedPassingStrategy = 'chord'; // Passing tone strategy from lookahead

        // Humanization state
        this.humanizationEnabled = true;
        this.humanizationIntensity = 0.7;  // 0-1, controlled by slider
        this.noiseTime = 0;  // Advances each step

        // Bass-specific humanization characteristics
        this.bassHumanization = {
            velocityRange: 12,      // ±12 max velocity variation
            timingRange: 6,         // ±6ms max timing offset
            noiseFreq: 0.15         // Moderate noise frequency
        };

        // Define motion types and rhythm layers
        this.motionTypes = this.defineMotionTypes();
        this.rhythmLayers = this.defineRhythmLayers();

        // Initialize rhythm pattern
        this.regenerateRhythmPattern();
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
     * Define motion types with their characteristics
     * Each motion type has a palette, adherence level, and selection strategy
     */
    defineMotionTypes() {
        return {
            'root-only': {
                label: 'Root Only',
                palette: 'root',           // Only chord root
                adherence: 'strict',        // Chord tones only
                strategy: 'fixed',          // Always root
                icon: '1️⃣'
            },
            'root-5th': {
                label: 'Root & 5th',
                palette: 'root-fifth',      // Root + fifth
                adherence: 'strict',        // Chord tones only
                strategy: 'alternating',    // Alternate root/fifth
                icon: '🎸'
            },
            'shell': {
                label: 'Shell Tones',
                palette: 'shell',           // Root, 5th, 7th
                adherence: 'strict',        // Chord tones only
                strategy: 'weighted-chord', // Favor root/5th on important beats
                icon: '🐚'
            },
            'arpeggiated': {
                label: 'Arpeggiated',
                palette: 'chord',           // All chord voicing tones
                adherence: 'strict',        // Chord tones only
                strategy: 'arpeggio',       // Cycle through voicing
                icon: '📐'
            },
            'melodic': {
                label: 'Melodic',
                palette: 'scale',           // All scale tones
                adherence: 'scale',         // Scale tones only
                strategy: 'stepwise',       // Prefer small intervals
                icon: '🎵'
            },
            'leaping': {
                label: 'Leaping',
                palette: 'scale',           // All scale tones
                adherence: 'scale',         // Scale tones only
                strategy: 'intervallic',    // Allow large intervals
                icon: '🦘'
            },
            'chromatic': {
                label: 'Chromatic',
                palette: 'chromatic',       // All 12 notes
                adherence: 'none',          // Anything goes
                strategy: 'approach',       // Half-step approaches to chord tones
                icon: '🌈'
            }
        };
    }

    /**
     * Define rhythm layers for each motion type
     * Each has a base pattern + density layers
     * Pattern: 16 positions (4 beats × 4 sixteenths)
     * Velocity: 0-127 per position
     */
    defineRhythmLayers() {
        return {
            'root-only': {
                base: {
                    // Only downbeat (16th position 0)
                    pattern: [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
                    velocity: [100,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]
                },
                layers: [
                    {
                        threshold: 0.4,
                        pattern: [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],  // Add beat 3
                        velocity: [0,0,0,0, 0,0,0,0, 90,0,0,0, 0,0,0,0]
                    },
                    {
                        threshold: 0.7,
                        pattern: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],  // Add beats 2 & 4
                        velocity: [0,0,0,0, 80,0,0,0, 0,0,0,0, 80,0,0,0]
                    }
                ]
            },

            'root-5th': {
                base: {
                    // Beats 1 and 3
                    pattern: [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
                    velocity: [100,0,0,0, 0,0,0,0, 95,0,0,0, 0,0,0,0]
                },
                layers: [
                    {
                        threshold: 0.35,
                        // Add syncopated 8th note (position 6 = "and of 2")
                        pattern: [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,0,0],
                        velocity: [0,0,0,0, 0,0,75,0, 0,0,0,0, 0,0,0,0]
                    },
                    {
                        threshold: 0.65,
                        // Add beat 4 and 16th ghost
                        pattern: [0,0,0,0, 0,0,0,0, 0,0,0,0, 1,0,1,0],
                        velocity: [0,0,0,0, 0,0,0,0, 0,0,0,0, 55,0,10,0]
                    }
                ]
            },

            'shell': {
                base: {
                    // Beats 1 and 3 (half notes feel)
                    pattern: [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
                    velocity: [100,0,0,0, 0,0,0,0, 95,0,0,0, 0,0,0,0]
                },
                layers: [
                    {
                        threshold: 0.4,
                        // Add beats 2 and 4 (quarter notes)
                        pattern: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
                        velocity: [0,0,0,0, 85,0,0,0, 0,0,0,0, 85,0,0,0]
                    },
                    {
                        threshold: 0.6,
                        // Add some 8th notes on "ands"
                        pattern: [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,0,0],
                        velocity: [0,0,70,0, 0,0,70,0, 0,0,70,0, 0,0,0,0]
                    },
                    {
                        threshold: 0.8,
                        // Add 16th ghost notes
                        pattern: [0,1,0,0, 0,1,0,0, 0,1,0,0, 0,1,0,0],
                        velocity: [0,55,0,0, 0,55,0,0, 0,55,0,0, 0,55,0,0]
                    }
                ]
            },

            'arpeggiated': {
                base: {
                    // Quarter notes
                    pattern: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
                    velocity: [100,0,0,0, 90,0,0,0, 95,0,0,0, 90,0,0,0]
                },
                layers: [
                    {
                        threshold: 0.35,
                        // Add 8th notes
                        pattern: [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
                        velocity: [0,0,75,0, 0,0,35,0, 0,0,75,0, 0,0,35,0]
                    },
                    {
                        threshold: 0.7,
                        // Add 16th notes (continuous arpeggio)
                        pattern: [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1],
                        velocity: [0,25,0,25, 0,65,0,25, 0,65,0,25, 0,65,0,25]
                    }
                ]
            },

            'melodic': {
                base: {
                    // Beats 1 and 3 (sparse melodic)
                    pattern: [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
                    velocity: [100,0,0,0, 0,0,0,0, 95,0,0,0, 0,0,0,0]
                },
                layers: [
                    {
                        threshold: 0.3,
                        // Add beats 2 and 4
                        pattern: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
                        velocity: [0,0,0,0, 85,0,0,0, 0,0,0,0, 85,0,0,0]
                    },
                    {
                        threshold: 0.5,
                        // Add 8th notes for passing tones
                        pattern: [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
                        velocity: [0,0,70,0, 0,0,70,0, 0,0,70,0, 0,0,70,0]
                    },
                    {
                        threshold: 0.75,
                        // Add 16th ghost notes
                        pattern: [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1],
                        velocity: [0,55,0,55, 0,55,0,55, 0,55,0,55, 0,55,0,55]
                    }
                ]
            },

            'leaping': {
                base: {
                    // Sparse (beats 1 and 3)
                    pattern: [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
                    velocity: [100,0,0,0, 0,0,0,0, 95,0,0,0, 0,0,0,0]
                },
                layers: [
                    {
                        threshold: 0.35,
                        // Add syncopation (leaps on offbeats)
                        pattern: [0,0,0,1, 0,0,0,0, 0,0,0,1, 0,0,0,0],
                        velocity: [0,0,0,80, 0,0,0,0, 0,0,0,80, 0,0,0,0]
                    },
                    {
                        threshold: 0.6,
                        // Add more syncopation
                        pattern: [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0],
                        velocity: [0,0,0,0, 0,0,75,0, 0,0,0,0, 0,0,75,0]
                    },
                    {
                        threshold: 0.8,
                        // Add 16th ghost notes
                        pattern: [0,1,0,0, 0,1,0,0, 0,1,0,0, 0,1,0,0],
                        velocity: [0,60,0,0, 0,60,0,0, 0,60,0,0, 0,60,0,0]
                    }
                ]
            },

            'chromatic': {
                base: {
                    // Downbeat only (approach tone setup)
                    pattern: [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
                    velocity: [100,0,0,0, 0,0,0,0, 95,0,0,0, 0,0,0,0]
                },
                layers: [
                    {
                        threshold: 0.3,
                        // Add approach tones before downbeats
                        pattern: [0,0,0,1, 0,0,0,0, 0,0,0,1, 0,0,0,0],
                        velocity: [0,0,0,70, 0,0,0,0, 0,0,0,70, 0,0,0,0]
                    },
                    {
                        threshold: 0.55,
                        // Add more chromatic movement
                        pattern: [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0],
                        velocity: [0,0,0,0, 0,0,75,0, 0,0,0,0, 0,0,75,0]
                    },
                    {
                        threshold: 0.8,
                        // Full chromatic texture
                        pattern: [0,1,0,0, 0,1,0,1, 0,1,0,0, 0,1,0,1],
                        velocity: [0,60,0,0, 0,60,0,60, 0,60,0,0, 0,60,0,60]
                    }
                ]
            }
        };
    }

    /**
     * Generate rhythm pattern from motion type and density
     * Applies density layers probabilistically (like drummer)
     * @param {string} motionType - Motion type key
     * @param {number} density - Density value (0-1)
     * @returns {{pattern: number[], velocity: number[]}}
     */
    generateRhythmPattern(motionType, density) {
        const layers = this.rhythmLayers[motionType];
        if (!layers) {
            console.warn(`Bassist: Unknown motion type "${motionType}", using root-5th`);
            return this.generateRhythmPattern('root-5th', density);
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
                        // If both layers have note, use higher density velocity (velocity override)
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
     * Regenerate rhythm pattern based on current motion type and density
     * Called when density or motion type changes
     */
    regenerateRhythmPattern() {
        // Use manual rhythm pattern if selected, otherwise use motion type's pattern
        const patternKey = this.rhythmPattern || this.motionType;
        this.currentRhythmPattern = this.generateRhythmPattern(patternKey, this.density);
        console.log(`Bassist: Generated ${patternKey} pattern at density ${this.density.toFixed(2)}`);
    }

    /**
     * Get beat importance for 16th note position
     * @param {number} position - Position in bar (0-15)
     * @returns {string} 'strong', 'medium', or 'weak'
     */
    getBeatImportance(position) {
        // Strong beats: 1 (pos 0), 3 (pos 8)
        if (position === 0 || position === 8) {
            return 'strong';
        }

        // Medium beats: 2 (pos 4), 4 (pos 12)
        if (position === 4 || position === 12) {
            return 'medium';
        }

        // Weak beats: everything else
        return 'weak';
    }

    /**
     * Get note palette for current motion type
     * Returns array of MIDI notes available for selection
     * @param {string} motionType - Motion type key
     * @returns {number[]} Array of available MIDI notes
     */
    getNotePalette(motionType) {
        const type = this.motionTypes[motionType];
        if (!type) return [];

        const root = this.currentChord?.root || 60;
        const voicing = this.currentChord?.voicing || [];
        const scale = this.currentScale || [];

        const palette = [];

        switch (type.palette) {
            case 'root':
                // Only root
                palette.push(this.toBassOctave(root));
                break;

            case 'root-fifth':
                // Root + fifth
                palette.push(this.toBassOctave(root));
                palette.push(this.toBassOctave(root + 7));
                break;

            case 'shell':
                // Root, 5th, 7th
                palette.push(this.toBassOctave(root));
                palette.push(this.toBassOctave(root + 7));
                // Find 7th from voicing (typically last note)
                if (voicing.length >= 4) {
                    palette.push(this.toBassOctave(voicing[voicing.length - 1]));
                } else {
                    // Default to major 7th if no voicing
                    palette.push(this.toBassOctave(root + 11));
                }
                break;

            case 'chord':
                // All chord voicing tones
                if (voicing.length > 0) {
                    voicing.forEach(note => {
                        palette.push(this.toBassOctave(note));
                    });
                } else {
                    // Fallback to triad
                    palette.push(this.toBassOctave(root));
                    palette.push(this.toBassOctave(root + 4));
                    palette.push(this.toBassOctave(root + 7));
                }
                break;

            case 'scale':
                // All scale tones in bass range
                scale.forEach(note => {
                    const bassNote = this.toBassOctave(note);
                    if (!palette.includes(bassNote)) {
                        palette.push(bassNote);
                    }
                });
                break;

            case 'chromatic':
                // All 12 notes in bass range
                for (let pc = 0; pc < 12; pc++) {
                    const bassNote = this.toBassOctave(pc);
                    if (!palette.includes(bassNote)) {
                        palette.push(bassNote);
                    }
                }
                break;
        }

        return palette.sort((a, b) => a - b); // Sort ascending
    }

    /**
     * Select note based on motion type strategy
     * @param {string} motionType - Motion type key
     * @param {number} position - 16th note position (0-15)
     * @param {number} lastNote - Previously played note
     * @param {string} beatImportance - 'strong', 'medium', or 'weak'
     * @returns {number} Selected MIDI note
     */
    selectNote(motionType, position, lastNote, beatImportance) {
        const type = this.motionTypes[motionType];
        if (!type) {
            return this.toBassOctave(this.currentChord?.root || 60);
        }

        const palette = this.getNotePalette(motionType);
        if (palette.length === 0) {
            return this.toBassOctave(this.currentChord?.root || 60);
        }

        const root = this.currentChord?.root || 60;

        switch (type.strategy) {
            case 'fixed':
                // Always play root
                return palette[0]; // Root is first in palette

            case 'alternating':
                // Alternate root/fifth, favor root on strong beats
                if (beatImportance === 'strong') {
                    return this.toBassOctave(root);
                }
                // Alternate
                if (lastNote === palette[0]) {
                    return palette[1] || palette[0]; // Fifth or root if no fifth
                }
                return palette[0]; // Root

            case 'weighted-chord':
                // Land on roots/5ths for important beats, use 7th for passing
                return this.selectWeightedChordNote(palette, beatImportance, lastNote);

            case 'arpeggio':
                // Cycle through chord tones
                return this.selectArpeggioNote(palette, lastNote);

            case 'stepwise':
                // Melodic: prefer small intervals, land on chord tones on strong beats
                return this.selectMelodicNote(palette, lastNote, beatImportance, 'stepwise');

            case 'intervallic':
                // Leaping: allow larger intervals
                return this.selectMelodicNote(palette, lastNote, beatImportance, 'leaping');

            case 'approach':
                // Chromatic: use half-step approaches to chord tones on strong beats
                return this.selectChromaticNote(palette, lastNote, beatImportance);

            default:
                return palette[0];
        }
    }

    /**
     * Select weighted chord note (for shell motion type)
     * @param {number[]} palette - Available notes
     * @param {string} beatImportance - Beat importance
     * @param {number} lastNote - Last played note
     * @returns {number} Selected note
     */
    selectWeightedChordNote(palette, beatImportance, lastNote) {
        if (palette.length === 0) return this.toBassOctave(this.currentChord?.root || 60);

        const root = this.toBassOctave(this.currentChord?.root || 60);
        const weights = [];
        const candidates = [];

        palette.forEach(note => {
            const pitchClass = note % 12;
            const rootPC = root % 12;
            let weight = 0.1; // Base weight

            // Root: higher weight on strong beats
            if (pitchClass === rootPC) {
                weight = beatImportance === 'strong' ? 0.6 : 0.3;
            }
            // Fifth: medium weight on strong beats
            else if (pitchClass === (rootPC + 7) % 12) {
                weight = beatImportance === 'strong' ? 0.3 : 0.2;
            }
            // 7th or other chord tones: higher on weak beats (passing tones)
            else {
                weight = beatImportance === 'weak' ? 0.4 : 0.1;
            }

            // Stepwise bonus
            if (lastNote && Math.abs(note - lastNote) <= 2) {
                weight *= 1.5;
            }

            candidates.push(note);
            weights.push(weight);
        });

        return weightedRandomSelect(candidates, weights);
    }

    /**
     * Select arpeggio note (cycle through chord tones)
     * @param {number[]} palette - Available notes
     * @param {number} lastNote - Last played note
     * @returns {number} Selected note
     */
    selectArpeggioNote(palette, lastNote) {
        if (palette.length === 0) return this.toBassOctave(this.currentChord?.root || 60);
        if (palette.length === 1) return palette[0];

        if (!lastNote) return palette[0];

        // Find current note in palette
        const currentIndex = palette.findIndex(n => n === lastNote);
        if (currentIndex === -1) {
            return palette[0]; // Start from beginning
        }

        // Move to next note in arpeggio
        const nextIndex = (currentIndex + 1) % palette.length;
        return palette[nextIndex];
    }

    /**
     * Select melodic note (stepwise or leaping)
     * @param {number[]} palette - Available notes
     * @param {number} lastNote - Last played note
     * @param {string} beatImportance - Beat importance
     * @param {string} motionStyle - 'stepwise' or 'leaping'
     * @returns {number} Selected note
     */
    selectMelodicNote(palette, lastNote, beatImportance, motionStyle) {
        if (palette.length === 0) return this.toBassOctave(this.currentChord?.root || 60);

        const root = this.toBassOctave(this.currentChord?.root || 60);
        const chordTones = [root, this.toBassOctave(root + 7)]; // Root and fifth

        // On strong beats, prefer landing on chord tones
        if (beatImportance === 'strong') {
            const chordOptions = palette.filter(n => chordTones.some(ct => n % 12 === ct % 12));
            if (chordOptions.length > 0) {
                // Find nearest chord tone
                if (lastNote) {
                    chordOptions.sort((a, b) => Math.abs(a - lastNote) - Math.abs(b - lastNote));
                }
                return chordOptions[0];
            }
        }

        if (!lastNote) return palette[0];

        // Build weighted selection
        const weights = [];
        palette.forEach(note => {
            const interval = Math.abs(note - lastNote);
            let weight = 0.1;

            if (motionStyle === 'stepwise') {
                // Stepwise: favor small intervals
                if (interval <= 2) {
                    weight = 0.8; // Stepwise
                } else if (interval <= 4) {
                    weight = 0.2; // Small skip
                } else {
                    weight = 0.05; // Large leap (rare)
                }
            } else {
                // Leaping: allow larger intervals
                if (interval <= 2) {
                    weight = 0.3; // Stepwise
                } else if (interval <= 7) {
                    weight = 0.5; // Medium leap
                } else {
                    weight = 0.4; // Large leap
                }
            }

            weights.push(weight);
        });

        return weightedRandomSelect(palette, weights);
    }

    /**
     * Select chromatic note (approach tones to chord tones)
     * @param {number[]} palette - Available notes
     * @param {number} lastNote - Last played note
     * @param {string} beatImportance - Beat importance
     * @returns {number} Selected note
     */
    selectChromaticNote(palette, lastNote, beatImportance) {
        if (palette.length === 0) return this.toBassOctave(this.currentChord?.root || 60);

        const root = this.toBassOctave(this.currentChord?.root || 60);

        // On strong beats, target root via chromatic approach
        if (beatImportance === 'strong') {
            if (lastNote) {
                // Use chromatic approach to root
                return chromaticApproach(lastNote, root);
            }
            return root;
        }

        // On weak beats, use chromatic motion
        if (!lastNote) return palette[0];

        // Prefer half-step motion
        const halfStepUp = lastNote + 1;
        const halfStepDown = lastNote - 1;

        if (palette.includes(halfStepUp) && palette.includes(halfStepDown)) {
            // Choose randomly between up and down
            return Math.random() < 0.5 ? halfStepUp : halfStepDown;
        } else if (palette.includes(halfStepUp)) {
            return halfStepUp;
        } else if (palette.includes(halfStepDown)) {
            return halfStepDown;
        }

        // Fallback to nearest note
        palette.sort((a, b) => Math.abs(a - lastNote) - Math.abs(b - lastNote));
        return palette[0];
    }

    /**
     * Calculate micro-timing offset using Perlin noise
     * @param {number} position - Position in bar (0-15)
     * @returns {number} Timing offset in milliseconds
     */
    calculateMicroTimingOffset(position) {
        if (!this.humanizationEnabled) return 0;

        const char = this.bassHumanization;

        // Sample Perlin noise at current time
        const noiseValue = perlinNoise.sample(
            this.noiseTime,
            char.noiseFreq,
            1.0  // Amplitude 1.0, will scale below
        );

        // Scale by timing range and humanization intensity
        const baseRange = char.timingRange;
        const moodMultiplier = this.getMoodTimingMultiplier();
        const finalRange = baseRange * this.humanizationIntensity * moodMultiplier;

        // Tighter timing on downbeats (positions 0, 4, 8, 12)
        const downbeatFactor = (position % 4 === 0) ? 0.4 : 1.0;

        return noiseValue * finalRange * downbeatFactor;
    }

    /**
     * Get timing multiplier based on mood
     * @returns {number} Multiplier for timing range
     */
    getMoodTimingMultiplier() {
        switch (this.mood) {
            case 'tense': return 0.4;    // Very tight
            case 'relaxed': return 1.6;  // Loose
            case 'sparse': return 0.3;   // Extremely tight
            case 'dense': return 1.3;    // Moderate loose
            default: return 1.0;
        }
    }

    /**
     * Calculate velocity humanization using Perlin noise
     * @param {number} baseVelocity - Base velocity before humanization
     * @param {number} position - Position in bar (0-15)
     * @returns {number} Velocity variation to add
     */
    calculateVelocityHumanization(baseVelocity, position) {
        if (!this.humanizationEnabled) return 0;

        const char = this.bassHumanization;

        // Sample Perlin noise for velocity (offset by 1000 to decorrelate from timing)
        const noiseValue = perlinNoise.sample(
            this.noiseTime + 1000,
            char.noiseFreq * 1.3,  // Slightly higher frequency for velocity
            1.0
        );

        // Scale by velocity range and humanization intensity
        const baseRange = char.velocityRange;
        const moodMultiplier = this.getMoodVelocityMultiplier();
        const finalRange = baseRange * this.humanizationIntensity * moodMultiplier;

        // Ghost notes (low velocity) get MORE variation
        const ghostNoteFactor = (baseVelocity < 60) ? 1.4 : 1.0;

        // Downbeats get LESS variation (more intentional)
        const downbeatFactor = (position % 4 === 0) ? 0.6 : 1.0;

        return noiseValue * finalRange * ghostNoteFactor * downbeatFactor;
    }

    /**
     * Get velocity multiplier based on mood
     * @returns {number} Multiplier for velocity range
     */
    getMoodVelocityMultiplier() {
        switch (this.mood) {
            case 'tense': return 1.4;    // More dynamic
            case 'relaxed': return 0.7;  // Subtle
            case 'sparse': return 0.4;   // Very consistent
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
            'data-motion-type',
            'data-density'
        ];
    }

    /**
     * Parse attributes
     */
    parseAttributes() {
        super.parseAttributes();

        this.motionType = this.getAttribute('data-motion-type') || 'root-5th';

        // Parse density if provided
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

        // Subscribe to density changes (regenerate rhythm pattern)
        this.subscribe('context:density', (data) => {
            this.density = data.density;
            console.log(`Bassist: Density changed to ${this.density.toFixed(2)}`);
            this.regenerateRhythmPattern();
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
    /**
     * Register whippable parameters
     */
    registerWhippableParameters() {
        // 1. Note Generation (pulse) - triggers rhythm
        this.registerWhippableParameter('noteGeneration', {
            label: 'Note Generation',
            parameterType: 'pulse',
            icon: '🎶',
            customPosition: 'strong',
            setter: () => {
                this.playPlayheadTriggeredNote();
            }
        });

        // 2. Velocity / Accent (number) - modulates note velocity
        this.registerWhippableParameter('velocity', {
            label: 'Velocity',
            parameterType: 'number',
            min: 40,
            max: 127,
            icon: '🔊',
            setter: (value) => {
                this.accentVelocity = Math.round(value);
            }
        });

        // 3. Density (number) - rhythmic density layers
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

        // 4. Humanization Intensity (number) - timing and velocity variation
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

        // Render target lights after component is fully rendered
        requestAnimationFrame(() => {
            this.renderTargetLights();
        });
    }

    /**
     * Play playhead-triggered note (debounced to 32nd notes)
     */
    playPlayheadTriggeredNote() {
        if (!this.enabled || !this.currentChord) return;

        // Debounce to 32nd note resolution
        const now = performance.now();
        const tempo = PubSub.last('clock:tempo')?.bpm || 120;
        const thirtySecondMs = (60000 / tempo) / 8; // 32nd note duration

        if (now - this.lastPlayheadTrigger < thirtySecondMs) {
            return; // Too soon, skip
        }
        this.lastPlayheadTrigger = now;

        // Play note at LOWER velocity than pattern notes
        const note = this.selectNote(
            this.motionType,
            this.lastPosition || 0,
            this.lastNote,
            'weak' // Playhead triggers are always weak beats
        );

        const velocity = Math.max(40, this.accentVelocity - 20); // Lower than pattern
        const duration = 200;

        this.sendNote(note, velocity, duration);
        this.lastNote = note;
    }

    /**
     * Handle playhead lookahead data (for planning passing tones)
     * @param {object} lookaheadData - Lookahead data from playhead
     */
    onPlayheadLookahead(lookaheadData) {
        // Use lookahead data to plan passing tones
        // Higher deviation → more chromatic passing tones
        // Lower deviation → stick to chord tones

        const deviation = lookaheadData.deviation || 0;

        if (deviation > 0.7) {
            // High deviation → plan chromatic approaches
            this.plannedPassingStrategy = 'chromatic';
        } else if (deviation > 0.4) {
            // Medium → use scale passing tones
            this.plannedPassingStrategy = 'scale';
        } else {
            // Low → stick to chord tones
            this.plannedPassingStrategy = 'chord';
        }
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
    /**
     * Handle clock tick - NEW VERSION with 16th note resolution
     * @param {object} clockData - Clock data with tick and ppqn
     */
    handleClockTick(clockData) {
        if (!this.enabled) return;

        const { tick, ppqn } = clockData;

        // Calculate 16th note position in bar
        const ticksPerBar = ppqn * 4; // 4/4 time
        const tickInBar = tick % ticksPerBar;
        const sixteenthNote = ppqn / 4;
        const position = Math.floor(tickInBar / sixteenthNote); // 0-15

        // Prevent duplicate processing
        if (position === this.lastPosition) return;
        this.lastPosition = position;

        // Advance noise time for humanization
        this.noiseTime += 1;

        // Ensure we have a current rhythm pattern
        if (!this.currentRhythmPattern) {
            this.regenerateRhythmPattern();
        }

        // Get current rhythm pattern
        const { pattern, velocity } = this.currentRhythmPattern;

        // Should we play on this position?
        if (pattern[position] === 1) {
            const beatImportance = this.getBeatImportance(position);

            // Select note based on motion type and beat importance
            const note = this.selectNote(
                this.motionType,
                position,
                this.lastNote,
                beatImportance
            );

            // Get velocity from pattern, modulated by accent control
            let baseVelocity = velocity[position];
            let finalVelocity = Math.round(baseVelocity * (this.accentVelocity / 100));

            // Apply velocity humanization
            const velocityHumanization = this.calculateVelocityHumanization(finalVelocity, position);
            finalVelocity += Math.round(velocityHumanization);
            finalVelocity = Math.max(30, Math.min(127, finalVelocity));

            // Calculate timing offset
            const microTimingOffset = this.calculateMicroTimingOffset(position);

            // Play note with timing offset
            const duration = 400;

            if (microTimingOffset !== 0) {
                setTimeout(() => {
                    this.sendNote(note, finalVelocity, duration);
                }, Math.max(0, microTimingOffset));
            } else {
                this.sendNote(note, finalVelocity, duration);
            }

            this.lastNote = note;
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

        // Density affects play probability as a gradient
        // At low density: skip many notes, at high density: play most notes
        const playProbability = this.walkingDensity * (0.3 + this.density * 0.7);
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
        // Density affects how adventurous the note choices are
        const chromaticWeight = 0.01 + (this.density * 0.05); // More chromatic at high density
        const scaleWeight = 0.05 + (this.density * 0.10);    // More scale tones at high density

        bassRange.forEach(note => {
            const pitchClass = note % 12;
            const rootPC = root % 12;

            let weight = chromaticWeight; // Base weight for chromatic notes

            // Root: 40% weight (less at high density to add variety)
            if (pitchClass === rootPC) {
                weight = 0.40 - (this.density * 0.10);
            }
            // Fifth: 30% weight
            else if (pitchClass === (rootPC + 7) % 12) {
                weight = 0.30;
            }
            // Chord tones: 20% weight
            else if (chordTones.includes(pitchClass)) {
                weight = 0.20;
            }
            // Scale tones: variable weight based on density
            else if (scaleTones.includes(pitchClass)) {
                weight = scaleWeight;
            }
            // Chromatic approach to root (half-step below): more weight at high density
            else if (this.currentBassNote && pitchClass === (rootPC - 1 + 12) % 12) {
                weight = 0.10 + (this.density * 0.10);
            }

            // Favor stepwise motion from last note
            if (this.currentBassNote) {
                const interval = Math.abs(note - this.currentBassNote);
                if (interval <= 2) {
                    weight *= 1.5; // Boost stepwise motion
                } else if (interval >= 7) {
                    // At high density, allow more leaps
                    weight *= (0.5 + this.density * 0.3);
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
        // Density affects which beats get played
        // At low density: only beats 0 and 2 (1 and 3)
        // At high density: all beats
        const playProbability = 0.5 + (this.density * 0.5);

        // Beat 0 and 2 are more likely to play
        if (beatInBar === 0 || beatInBar === 2) {
            return bassRoot;
        }

        // Other beats only play based on density
        if (Math.random() < playProbability) {
            return bassRoot;
        }

        return null;
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
                    | Motion Type:
                    <select id="motion-type-select" style="margin: 0 5px;">
                        ${this.renderMotionTypeOptions()}
                    </select>
                    | Rhythm:
                    <select id="rhythm-pattern-select" style="margin: 0 5px;">
                        ${this.renderRhythmPatternOptions()}
                    </select>
                    | Density:
                    <input type="range" id="density-slider" min="0" max="100" value="${this.density * 100}" style="width: 100px; vertical-align: middle;">
                    <span style="margin-left: 5px;">${Math.round(this.density * 100)}%</span>
                </span>
                <br>
                <span style="margin-left: 10px; color: #888;">
                    Humanization:
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
        this.$('#channel-select').onchange = (e) => {
            this.setChannel(parseInt(e.target.value));
        };

        this.$('#motion-type-select').onchange = (e) => {
            this.motionType = e.target.value;
            console.log(`Bassist: Motion type changed to ${this.motionType}`);
            this.regenerateRhythmPattern();
            this.render();
        };

        this.$('#rhythm-pattern-select').onchange = (e) => {
            const value = e.target.value;
            this.rhythmPattern = (value === 'auto') ? null : value;
            console.log(`Bassist: Rhythm pattern changed to ${this.rhythmPattern || 'auto (motion type)'}`);
            this.regenerateRhythmPattern();
        };

        this.$('#density-slider').oninput = (e) => {
            this.density = parseInt(e.target.value) / 100;
            this.regenerateRhythmPattern(); // Regenerate pattern with new density
            this.render(); // Re-render to update display
        };

        this.$('#mute-btn').onclick = () => {
            this.toggleMute();
        };

        this.$('#debug-btn').onclick = () => {
            this.toggleDebug();
        };

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

        // Re-render target lights after DOM update
        requestAnimationFrame(() => {
            this.renderTargetLights();
        });
    }

    /**
     * Render motion type selector options
     * @returns {string} HTML options for motion type selector
     */
    renderMotionTypeOptions() {
        return Object.keys(this.motionTypes).map(key => {
            const type = this.motionTypes[key];
            const selected = key === this.motionType ? 'selected' : '';
            return `<option value="${key}" ${selected}>${type.icon} ${type.label}</option>`;
        }).join('');
    }

    /**
     * Render rhythm pattern selector options
     * @returns {string} HTML options for rhythm pattern selector
     */
    renderRhythmPatternOptions() {
        const options = ['<option value="auto" ' + (this.rhythmPattern === null ? 'selected' : '') + '>Auto (from Motion Type)</option>'];

        // Add all available rhythm patterns from rhythmLayers
        Object.keys(this.rhythmLayers).forEach(key => {
            const type = this.motionTypes[key];
            const selected = key === this.rhythmPattern ? 'selected' : '';
            options.push(`<option value="${key}" ${selected}>${type.icon} ${type.label} Rhythm</option>`);
        });

        return options.join('');
    }

    /**
     * Render range selector options (DEPRECATED - range is now fixed)
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
