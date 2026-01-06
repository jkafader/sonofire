import { BaseInstrumentalist } from './base_instrumentalist.js';
import { constrainInterval } from '../../lib/generative_algorithms.js';
import { harmonicContext } from '../../lib/harmonic_context.js';
import { WhipManager } from '../../lib/whip_manager.js';

/**
 * Soloist Component
 * Generates melodic lines based on data points from visualizers
 * Maps data values to pitch, with deviation-based dissonance
 */
export class SonofireSoloist extends BaseInstrumentalist {
    constructor() {
        super();

        // Soloist-specific settings
        this.channel = 0;                 // MIDI channel 0 for FM flute synthesis
        this.playingStyle = 'melodic';    // 'melodic', 'rhythmic', 'ambient'
        this.maxInterval = 7;             // Maximum melodic interval (semitones)
        this.listenToData = true;         // Whether to respond to data:point events

        // Note range settings
        this.noteRange = 'mid';           // 'low', 'mid', 'high', 'very-high', 'wide'
        this.minNote = 55;                // Minimum note (G3)
        this.maxNote = 73;                // Maximum note (C#5) - 1.5 octaves

        // Deviation tracking for dissonance
        this.currentDeviation = null;     // null = no forecast data, 0.0-1.0 = deviation amount
        this.hasForecastData = false;     // Whether we have forecast/prediction data

        // Phrase-based melody generation state
        this.currentPhrase = null;        // Array of note objects {note, velocity, duration, harmonicRole}
        this.phraseIndex = 0;              // Current position in phrase
        this.lastPhraseMelody = null;      // Previous phrase for variation tracking
        this.nextChord = null;             // Next chord information
        this.lookaheadInfo = null;         // Lookahead data from visualizer

        // Phrase generation weights (can be modified via whip parameters)
        this.trendWeight = 0.30;           // Weight for data trend influence
        this.harmonicWeight = 0.40;        // Weight for harmonic structure
        this.tensionWeight = 0.20;         // Weight for tension/resolution
        this.continuityWeight = 0.10;      // Weight for melodic continuity

        // Playhead binding tracking
        this.boundPlayheadId = null;       // ID of playhead bound to noteGeneration parameter
        this.lookaheadSubscription = null; // Track lookahead subscription for cleanup
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

        // Subscribe to next chord for phrase planning
        this.subscribe('music:nextChord', (data) => {
            this.nextChord = data;
            console.log('Soloist: Received next chord:', data.chord);
        });

        // Detect bound playhead and subscribe to its lookahead
        this.detectAndSubscribeToBoundPlayhead();

        // Listen for new bindings being created
        this.subscribe('whip:binding:register', (data) => {
            if (data.targetComponentId === this.id && data.targetParameterId === 'noteGeneration') {
                console.log('Soloist: New binding detected to noteGeneration parameter');
                this.detectAndSubscribeToBoundPlayhead();
            }
        });

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
     * Detect which playhead is bound to noteGeneration and subscribe to its lookahead
     */
    detectAndSubscribeToBoundPlayhead() {
        // Query WhipManager for bindings to our noteGeneration parameter
        const bindings = WhipManager.getBindingsForTarget(this.id, 'noteGeneration');

        if (bindings.length === 0) {
            console.log('Soloist: No playhead bound to noteGeneration, subscribing to general data:lookahead');
            this.boundPlayheadId = null;

            // Subscribe to general lookahead (first playhead)
            this.subscribe('data:lookahead', (data) => {
                this.lookaheadInfo = data;
                console.log('Soloist: Received lookahead data (general):', {
                    playheadId: data.playheadId,
                    eventCount: data.estimatedEventCount,
                    trend: data.trend.direction
                });
            });
            return;
        }

        // Use the first binding (in case multiple playheads are bound)
        const binding = bindings[0];
        const playheadId = binding.sourcePlayheadId;

        if (this.boundPlayheadId === playheadId) {
            return; // Already subscribed to this playhead
        }

        this.boundPlayheadId = playheadId;
        console.log(`Soloist: Bound to playhead ${playheadId}, subscribing to data:lookahead:${playheadId}`);

        // Subscribe to specific playhead's lookahead topic
        const topic = `data:lookahead:${playheadId}`;
        this.subscribe(topic, (data) => {
            this.lookaheadInfo = data;
            console.log(`Soloist: Received lookahead data from playhead ${playheadId}:`, {
                eventCount: data.estimatedEventCount,
                trend: data.trend.direction
            });
        });
    }

    /**
     * Initialize when connected
     */
    connectedCallback() {
        super.connectedCallback();

        // Register whippable parameters (after render)
        this.registerWhippableParameters();

        // Detect bound playhead after a delay (to catch restored bindings)
        setTimeout(() => {
            this.detectAndSubscribeToBoundPlayhead();
        }, 200);
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
     * Log note with context (for debugging)
     * @param {number} note - MIDI note number
     * @param {string} source - Source of note generation
     */
    logNoteContext(note, source) {
        const noteName = harmonicContext.midiToNoteName(note);
        const octave = Math.floor(note / 12) - 1; // MIDI octave (C4 = 60)
        const inScale = this.isInScale(note);
        const scaleStatus = inScale ? '✓ IN POOL' : '✗ OUT OF POOL';

        // Get pool notes for reference - show unique pitch classes only
        const uniquePoolNotes = [...new Set(this.currentScale.map(n => harmonicContext.midiToNoteName(n)))].join(' ');

        console.log(`Soloist [${source}]: ${noteName}${octave} (MIDI ${note}) ${scaleStatus}`);
        if (!inScale) {
            console.warn(`  ⚠️  Current pool (${this.poolKey || 'unknown'}): ${uniquePoolNotes}`);
            console.warn(`  ⚠️  Scale length: ${this.currentScale.length}, Scale notes:`, this.currentScale);

            // Debug: what should this note quantize to?
            if (this.currentScale.length > 0) {
                const quantized = this.getNearestScaleNote(note);
                const quantizedName = harmonicContext.midiToNoteName(quantized);
                const quantizedOctave = Math.floor(quantized / 12) - 1;
                console.warn(`  ⚠️  Should have quantized to: ${quantizedName}${quantizedOctave} (MIDI ${quantized})`);
            } else {
                console.error(`  ❌ SCALE IS EMPTY! Cannot quantize notes!`);
            }
        }
    }

    /**
     * Override: Handle chord change by triggering phrase generation
     */
    handleChordChange(data) {
        super.handleChordChange(data); // Update this.currentChord

        // Wait a moment for nextChord and lookahead to arrive
        setTimeout(() => {
            this.currentPhrase = this.generatePhrase();
            this.phraseIndex = 0;
            console.log(`Soloist: Generated phrase with ${this.currentPhrase?.length || 0} notes`);
        }, 150); // Wait 150ms for all context to arrive
    }

    /**
     * Generate a melodic phrase based on current context
     * @returns {Array|null} Array of note objects or null if insufficient info
     */
    generatePhrase() {
        if (!this.currentChord || !this.nextChord || !this.lookaheadInfo) {
            console.warn('Soloist: Insufficient info for phrase generation', {
                hasCurrentChord: !!this.currentChord,
                hasNextChord: !!this.nextChord,
                hasLookahead: !!this.lookaheadInfo
            });
            return null;
        }

        const phraseLength = Math.max(4, this.lookaheadInfo.estimatedEventCount);
        const currentChordTones = this.currentChord.voicing || [];
        const nextChordTones = this.nextChord.voicing || [];
        const poolNotes = this.currentScale || [];
        const trend = this.lookaheadInfo.trend;

        console.log(`Soloist: Generating phrase of length ${phraseLength}, trend: ${trend.direction}`);

        // Generate phrase structure
        const phrase = [];

        for (let i = 0; i < phraseLength; i++) {
            const position = i / phraseLength; // 0.0 to 1.0
            const note = this.selectNoteForPosition({
                position,
                currentChordTones,
                nextChordTones,
                poolNotes,
                trend,
                lastNote: i > 0 ? phrase[i-1].note : this.lastNote
            });

            phrase.push({
                note: note,
                velocity: this.calculateVelocity(),
                duration: this.calculateDuration(),
                harmonicRole: this.identifyHarmonicRole(note, position)
            });
        }

        return phrase;
    }

    /**
     * Select note for a given position in the phrase
     * @param {Object} params - Parameters for note selection
     * @returns {number} MIDI note number
     */
    selectNoteForPosition({ position, currentChordTones, nextChordTones, poolNotes, trend, lastNote }) {
        // 1. Calculate target pitch based on data trend
        const trendContribution = this.calculateTrendContribution(position, trend, lastNote);

        // 2. Calculate harmonic target
        const harmonicContribution = this.calculateHarmonicContribution(
            position,
            currentChordTones,
            nextChordTones
        );

        // 3. Calculate tension/resolution arc
        const tensionContribution = this.calculateTensionContribution(position);

        // 4. Combine weighted targets
        const targetMIDI = (
            trendContribution * this.trendWeight +
            harmonicContribution * this.harmonicWeight +
            tensionContribution * this.tensionWeight +
            (lastNote || 60) * this.continuityWeight
        );

        // 5. Constrain to pool notes
        let selectedNote = this.getNearestChordalNote(Math.round(targetMIDI));

        // 6. Apply interval constraint
        /*if (lastNote) {
            selectedNote = constrainInterval(lastNote, selectedNote, this.maxInterval);
            selectedNote = this.getNearestScaleNote(selectedNote); // Re-quantize
        }*/

        // 7. Range clamp
        //selectedNote = Math.max(this.minNote, Math.min(this.maxNote, selectedNote));

        return selectedNote;
    }

    /**
     * Get nearest scale note
     * @param {number} note - MIDI note number
     * @returns {number} Nearest note in scale
     */
    getNearestChordalNote(note) {
        const currentChordTones = this.currentChord.voicing || [];
        const nextChordTones = this.nextChord.voicing || [];
        const chordalNotes = currentChordTones.concat(nextChordTones);

        // Get pitch classes from scale (0-11)
        const chordalPitchClasses = [...new Set(chordalNotes.map(n => n % 12))];

        // Check if note is already in scale
        const notePitchClass = note % 12;
        if (chordalPitchClasses.includes(notePitchClass)) {
            return note; // Already in scale
        }

        // Find nearest pitch class
        let closestPC = chordalPitchClasses[0];
        let minDistance = Math.min(
            Math.abs(notePitchClass - closestPC),
            12 - Math.abs(notePitchClass - closestPC) // Wraparound distance
        );

        chordalPitchClasses.forEach(pc => {
            const distance = Math.min(
                Math.abs(notePitchClass - pc),
                12 - Math.abs(notePitchClass - pc) // Wraparound distance
            );
            if (distance < minDistance) {
                minDistance = distance;
                closestPC = pc;
            }
        });

        // Adjust to nearest scale note in same octave
        const octave = Math.floor(note / 12);
        let nearestNote = octave * 12 + closestPC;

        // Check if next or previous octave is closer
        const distanceCurrent = Math.abs(note - nearestNote);
        const distanceUp = Math.abs(note - (nearestNote + 12));
        const distanceDown = Math.abs(note - (nearestNote - 12));

        if (distanceUp < distanceCurrent) {
            nearestNote += 12;
        } else if (distanceDown < distanceCurrent) {
            nearestNote -= 12;
        }

        return nearestNote;
    }

    /**
     * Calculate trend contribution to target pitch
     */
    calculateTrendContribution(position, trend, lastNote) {
        const baseNote = lastNote || 60;
        const range = this.maxNote - this.minNote;

        if (trend.direction === 'rising') {
            // Move up proportionally to slope and position in phrase
            return baseNote + (trend.slope * range * position * 0.5);
        } else if (trend.direction === 'falling') {
            return baseNote + (trend.slope * range * position * 0.5); // slope is negative
        } else {
            return baseNote; // Flat trend, stay around same pitch
        }
    }

    /**
     * Calculate harmonic contribution to target pitch
     */
    calculateHarmonicContribution(position, currentChordTones, nextChordTones) {
        if (currentChordTones.length === 0) {
            return 60; // Default to middle C if no chord tones
        }

        // Early in phrase: favor current chord tones
        // Late in phrase: favor next chord tones (voice leading)
        if (position < 0.7) {
            // Use current chord tones
            const index = Math.floor(Math.random() * currentChordTones.length);
            return currentChordTones[index];
        } else {
            if (nextChordTones.length === 0) {
                return currentChordTones[0]; // Fallback to current chord
            }

            // Approach next chord - find common tones or stepwise motion
            const commonTones = currentChordTones.filter(note =>
                nextChordTones.includes(note)
            );

            if (commonTones.length > 0 && Math.random() < 0.6) {
                // Use common tone (smooth voice leading)
                return commonTones[Math.floor(Math.random() * commonTones.length)];
            } else {
                // Approach next chord root or 3rd
                const target = Math.random() < 0.7 ? nextChordTones[0] : nextChordTones[1] || nextChordTones[0];
                return target;
            }
        }
    }

    /**
     * Calculate tension contribution to target pitch
     */
    calculateTensionContribution(position) {
        // Create arc: low tension → high tension → resolution
        // Tension peaks around position 0.7-0.8, resolves at 1.0
        const tensionPeak = position > 0.6 && position < 0.85;

        if (tensionPeak && this.currentChord?.voicing) {
            // Add tension via upper extensions or non-chord tones
            const tensionNote = this.currentChord.voicing[0] + 14; // 9th above root
            return tensionNote;
        } else if (position > 0.85 && this.nextChord?.root) {
            // Resolution: target next chord root or common tone
            return this.nextChord.root;
        } else if (this.currentChord?.root) {
            // Stable: current chord root or 5th
            return this.currentChord.root;
        } else {
            return 60; // Default
        }
    }

    /**
     * Identify harmonic role of a note at a position
     */
    identifyHarmonicRole(note, position) {
        if (!this.currentChord?.voicing) {
            return 'scale-tone';
        }

        const chordTones = this.currentChord.voicing;
        const pitchClass = note % 12;

        if (chordTones.some(ct => ct % 12 === pitchClass)) {
            return 'chord-tone';
        } else if (position > 0.7) {
            return 'approach-tone';
        } else {
            return 'passing-tone';
        }
    }

    /**
     * Generate and play next note (triggered by whip automation)
     * Now uses pre-generated phrase if available
     */
    generateAndPlayNote() {
        if (!this.enabled) return;

        // If we have a pre-generated phrase, use it
        if (this.currentPhrase && this.phraseIndex < this.currentPhrase.length) {
            const phraseNote = this.currentPhrase[this.phraseIndex];

            this.sendNote(
                phraseNote.note,
                phraseNote.velocity,
                phraseNote.duration
            );

            this.lastNote = phraseNote.note;
            this.phraseIndex++;

            console.log(`Soloist: Playing phrase note ${this.phraseIndex}/${this.currentPhrase.length}`, {
                note: phraseNote.note,
                role: phraseNote.harmonicRole
            });
        } else {
            // Fallback to simple note generation if no phrase available
            console.warn('Soloist: No phrase available, using fallback');
            let note = this.lastNote || 60;

            if (this.currentChord?.voicing && this.currentChord.voicing.length > 0) {
                const chordTones = this.currentChord.voicing;
                note = chordTones[Math.floor(Math.random() * chordTones.length)];
            }

            note = this.getNearestScaleNote(note);
            note = Math.max(this.minNote, Math.min(this.maxNote, note));

            const velocity = this.nextNoteVelocity || 80;
            const duration = 300 * (1 + this.spareness);

            this.sendNote(note, velocity, duration);
            this.lastNote = note;
        }
    }

    /**
     * Handle data point from visualizer
     * Uses pre-generated phrase if available, falls back to reactive mode
     */
    handleDataPoint(data) {
        if (!this.enabled) return;

        // If we have a pre-generated phrase, use it
        if (this.currentPhrase && this.phraseIndex < this.currentPhrase.length) {
            const phraseNote = this.currentPhrase[this.phraseIndex];

            // Send the phrase note
            this.sendNote(
                phraseNote.note,
                phraseNote.velocity,
                phraseNote.duration
            );

            this.lastNote = phraseNote.note;
            this.phraseIndex++;

            console.log(`Soloist: Playing phrase note ${this.phraseIndex}/${this.currentPhrase.length}`, {
                note: phraseNote.note,
                role: phraseNote.harmonicRole
            });

            return; // Done with phrase-based note
        }

        // FALLBACK: Reactive mode if no phrase available
        console.log('Soloist: Using reactive mode (no phrase)');

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

            // Apply dissonance ONLY if we have forecast data with deviation
            if (this.hasForecastData && this.currentDeviation !== null) {
                note = this.applyDissonance(note, this.currentDeviation);

                // After applying dissonance, quantize back to scale if deviation is low
                if (this.currentDeviation < 0.2) {
                    note = this.getNearestScaleNote(note);
                }
            }

            // Clamp to selected range (after all transformations)
            note = Math.max(this.minNote, Math.min(this.maxNote, note));

            // Determine velocity based on mood and data intensity
            const velocity = this.calculateVelocity(data);

            // Determine duration based on spareness
            const duration = this.calculateDuration();

            // Send the note
            this.sendNote(note, velocity, duration);

            // Log with context
            const source = this.hasForecastData ? `Data (dev: ${this.currentDeviation?.toFixed(2) || 'N/A'})` : 'Data';
            this.logNoteContext(note, source);
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
            this.hasForecastData = true;
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
