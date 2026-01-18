import { SonofireBase } from '../base/sonofire_base.js';
import { generateProgression, voiceChord, selectNextTonicByFunction, getChordQualityForDegreeInPool } from '../../lib/music_theory.js';
import { harmonicContext } from '../../lib/harmonic_context.js';

/**
 * Composer Component
 * Generates and advances through chord progressions
 * Publishes current chord to PubSub for instrumentalists
 */
export class SonofireComposer extends SonofireBase {
    constructor() {
        super();

        // Composer state
        this.progressionStyle = 'jazz';
        this.barsPerChord = 4;
        this.progression = [];
        this.progressionIndex = 0;
        this.currentChord = null;
        this.currentKey = 'C';
        this.currentScale = 'major';
        this.voicingType = 'close';

        // Pool/tonic notation (new system)
        this.poolKey = null;
        this.tonicNote = null;
        this.tonicName = null;

        // Probabilistic progression settings
        this.progressionLength = 4;
        this.useProbabilistic = true;  // Default to new system
        this.nextTonicCenter = null;   // For UI preview

        // Section system
        this.sections = [];                          // Array of section definitions
        this.currentSectionIndex = -1;               // Current section (-1 = no section)
        this.sectionMode = 'manual';                 // 'manual' | 'auto'
        this.arrangementOrder = [];                  // [0, 1, 0, 2, 1] - section sequence
        this.arrangementIndex = 0;                   // Position in arrangement
    }

    /**
     * Specify which attributes to observe
     */
    static get observedAttributes() {
        return [
            ...super.observedAttributes,
            'data-progression-style',
            'data-bars-per-chord',
            'data-voicing-type',
            'data-progression-length',
            'data-use-probabilistic'
        ];
    }

    /**
     * Parse attributes
     */
    parseAttributes() {
        super.parseAttributes();

        this.progressionStyle = this.getAttribute('data-progression-style') || 'jazz';
        this.barsPerChord = parseInt(this.getAttribute('data-bars-per-chord')) || 4;
        this.voicingType = this.getAttribute('data-voicing-type') || 'close';
        this.progressionLength = parseInt(this.getAttribute('data-progression-length')) || 4;
        this.useProbabilistic = this.getAttribute('data-use-probabilistic') !== 'false';
    }

    /**
     * Setup subscriptions
     */
    setupSubscriptions() {
        super.setupSubscriptions();

        // Subscribe to pool/tonic changes
        this.subscribe('context:pool', (data) => {
            this.handlePoolChange(data);
        });

        // Subscribe to clock ticks to advance chords
        this.subscribe('clock:tick', (data) => {
            this.handleClockTick(data);
        });

        // Subscribe to context:progression for section-based progression changes
        this.subscribe('context:progression', (data) => {
            if (data.progression) {
                this.progression = data.progression;
                this.progressionStyle = data.style || this.progressionStyle;
                this.barsPerChord = data.barsPerChord || this.barsPerChord;
                this.voicingType = data.voicingType || this.voicingType;
                this.progressionLength = data.progressionLength || this.progression.length;
                this.progressionIndex = data.progressionIndex ?? 0;  // Restore chord position
                this.publishCurrentChord();
                this.render();
            }
        }, this);
    }

    /**
     * Register parameters as whip targets
     */
    registerWhippableParameters() {
        // Register barsPerChord parameter
        this.registerWhippableParameter('barsPerChord', {
            label: 'Bars Per Chord',
            parameterType: 'select',
            options: [8, 7, 6, 5, 4, 3, 2, 1, 0.5, 0.25],
            elementSelector: '#bars-per-chord-select',
            setter: (value) => {
                // Map 0-1 to barsPerChord options
                const options = [8, 7, 6, 5, 4, 3, 2, 1, 0.5, 0.25];
                const index = Math.floor(value * options.length);
                const newValue = options[Math.min(index, options.length - 1)];

                // Only update if value actually changed
                if (newValue !== this.barsPerChord) {
                    this.barsPerChord = newValue;

                    // Update select value directly (no full re-render)
                    const select = this.$('#bars-per-chord-select');
                    if (select) {
                        select.value = newValue;
                    }
                }
            }
        });

        // Register progressionLength parameter
        this.registerWhippableParameter('progressionLength', {
            label: 'Progression Length',
            parameterType: 'number',
            min: 2,
            max: 16,
            elementSelector: '#progression-length-input',
            setter: (value) => {
                const newLength = Math.round(value);
                // Only update if length actually changed
                if (newLength !== this.progressionLength) {
                    this.setProgressionLength(newLength);
                }
            }
        });

        // Register progressionStyle parameter
        this.registerWhippableParameter('progressionStyle', {
            label: 'Progression Style',
            parameterType: 'select',
            options: ['jazz', 'jazz-251', 'blues', 'pop', 'pop-alternative', 'folk', 'modal', 'coltrane'],
            elementSelector: '#style-select',
            setter: (value) => {
                const options = ['jazz', 'jazz-251', 'blues', 'pop', 'pop-alternative', 'folk', 'modal', 'coltrane'];
                const index = Math.floor(value * options.length);
                const style = options[Math.min(index, options.length - 1)];

                // Only update if style actually changed
                if (style !== this.progressionStyle) {
                    this.setProgressionStyle(style);
                }
            }
        });

        // Register voicingType parameter
        this.registerWhippableParameter('voicingType', {
            label: 'Voicing Type',
            parameterType: 'select',
            options: ['close', 'open', 'drop2', 'shell'],
            elementSelector: '#voicing-select',
            setter: (value) => {
                const options = ['close', 'open', 'drop2', 'shell'];
                const index = Math.floor(value * options.length);
                const voicing = options[Math.min(index, options.length - 1)];

                // Only update if voicing type actually changed
                if (voicing !== this.voicingType) {
                    this.setVoicingType(voicing);
                }
            }
        });

        // Register sectionIndex parameter for data-driven section switching
        this.registerWhippableParameter('sectionIndex', {
            label: 'Section Index',
            parameterType: 'number',
            min: 0,
            max: Math.max(0, this.sections.length - 1),
            icon: '🎬',
            setter: (value) => {
                if (this.sections.length === 0) return;

                // Map 0-1 value to section index
                const index = Math.floor(value * this.sections.length);
                const clampedIndex = Math.max(0, Math.min(index, this.sections.length - 1));

                // Only load if index actually changed
                if (clampedIndex !== this.currentSectionIndex) {
                    this.loadSection(clampedIndex);
                }
            }
        });

        // Render target lights after component is fully rendered
        requestAnimationFrame(() => {
            this.renderTargetLights();
        });
    }

    /**
     * Initialize when connected
     */
    connectedCallback() {
        super.connectedCallback();

        // Restore sections from persistence
        this.restoreSections();

        // Discover current context from PubSub
        const poolContext = this.getLastValue('context:pool');
        if (poolContext) {
            this.poolKey = poolContext.poolKey;
            this.tonicNote = poolContext.tonicNote;
            this.tonicName = poolContext.tonicName;
        }

        // Register whippable parameters (after render)
        this.registerWhippableParameters();

        // Only generate initial progression if we don't have sections
        // (sections will load their own progression)
        if (this.sections.length === 0 || this.currentSectionIndex < 0) {
            this.generateNewProgression();
        }
    }

    /**
     * Handle key change from Conductor (legacy)
     */
    handleKeyChange(keyData) {
        this.currentKey = keyData.key;
        this.currentScale = keyData.scale;

        // Extract pool key if available
        if (keyData.poolKey) {
            this.poolKey = keyData.poolKey;
        }

        console.log(`Composer: Key changed to ${this.currentKey} ${this.currentScale}`);

        // Regenerate progression in new key
        this.generateNewProgression();

        // Update UI to reflect new key
        this.updateProgressionDisplay();
    }

    /**
     * Handle pool/tonic change from Conductor (new system)
     */
    handlePoolChange(poolData) {
        // Check if pool/tonic actually changed
        const poolChanged = poolData.poolKey !== this.poolKey;
        const tonicChanged = poolData.tonicNote !== this.tonicNote;

        this.poolKey = poolData.poolKey;
        this.tonicNote = poolData.tonicNote;
        this.tonicName = poolData.tonicName;

        // Only regenerate progression if pool or tonic actually changed
        if (poolChanged || tonicChanged) {
            console.log(`Composer: Pool/Tonic changed to ${this.poolKey}/${this.tonicName}`);

            // If we have an existing progression, only regenerate chords AFTER the current chord
            if (this.progression.length > 0 && this.progressionIndex >= 0) {
                this.regenerateRemainingProgression();
            } else {
                // No existing progression, generate a new one
                this.generateNewProgression();
            }

            // Update full UI to reflect new pool/tonic (including friendly key name)
            this.render();
        }
    }

    /**
     * Regenerate chords after the current chord in the new pool/tonic
     * Keeps chords up to and including the current chord unchanged
     */
    regenerateRemainingProgression() {
        // Keep chords from 0 to progressionIndex (inclusive)
        const keptChords = this.progression.slice(0, this.progressionIndex + 1);

        // Calculate how many chords we need to regenerate
        const remainingLength = this.progressionLength - keptChords.length;

        if (remainingLength <= 0) {
            // No chords to regenerate (we're at or past the end)
            return;
        }

        // Get the last chord we're keeping as the starting point
        const lastKeptChord = keptChords[keptChords.length - 1];

        // Generate remaining chords starting from the next degree/tonic
        const newChords = this.generatePartialProgression(
            this.poolKey,
            lastKeptChord.degree,
            lastKeptChord.root,
            this.progressionStyle,
            remainingLength
        );

        // Combine kept chords with newly generated ones
        this.progression = [...keptChords, ...newChords];

        console.log(`Composer: Regenerated ${newChords.length} chords after index ${this.progressionIndex}:`,
            this.progression.map(c => c.symbol).join(' → '));

        // Publish current chord (in case voicing changed)
        this.publishCurrentChord();

        // Update UI
        this.updateProgressionDisplay();
    }

    /**
     * Generate a partial progression continuing from a given degree/tonic
     * @param {string} poolKey - Pool key (e.g., "3♯")
     * @param {number} startDegree - Starting degree in the mode
     * @param {number} startTonicNote - Starting tonic MIDI note
     * @param {string} style - Progression style
     * @param {number} length - Number of chords to generate
     * @returns {Array} Array of chord objects
     */
    generatePartialProgression(poolKey, startDegree, startTonicNote, style, length) {
        const progression = [];

        // Determine mode context (same as in generateProgressionProbabilistic)
        const pool = harmonicContext.getNotePool(poolKey);
        const poolPitchClasses = [...new Set(pool.map(n => n % 12))];

        const poolToMajorTonic = {
            '0': 0, '1♯': 7, '2♯': 2, '3♯': 9, '4♯': 4, '5♯': 11, '6♯': 6,
            '1♭': 5, '2♭': 10, '3♭': 3, '4♭': 8, '5♭': 1
        };
        const majorTonicPC = poolToMajorTonic[poolKey] || 0;

        const orderedPitchClasses = [];
        for (let i = 0; i < 7; i++) {
            const pc = (majorTonicPC + [0, 2, 4, 5, 7, 9, 11][i]) % 12;
            if (poolPitchClasses.includes(pc)) {
                orderedPitchClasses.push(pc);
            }
        }

        const startTonicPC = startTonicNote % 12;
        const modeIndex = orderedPitchClasses.indexOf(startTonicPC);
        const modeNames = ['ionian', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian'];
        const modeName = modeNames[modeIndex] || 'ionian';
        const useFlats = this.shouldUseFlats(poolKey);

        // Start from the provided degree/tonic (continuing from last chord)
        let currentDegree = startDegree;
        let currentTonicNote = startTonicNote;

        for (let i = 0; i < length; i++) {
            // ALWAYS advance to next degree/tonic first (we're generating the NEXT chord after the last kept chord)
            const next = selectNextTonicByFunction(currentDegree, startTonicNote, poolKey, style);
            currentDegree = next.degree;
            currentTonicNote = next.tonicNote;

            // Get chord quality for this degree
            const quality = getChordQualityForDegreeInPool(currentDegree, modeName);

            // Create chord object
            const chord = {
                symbol: `${harmonicContext.midiToNoteName(currentTonicNote, useFlats)}${quality}`,
                root: currentTonicNote,
                quality: quality,
                degree: currentDegree,
                poolKey: poolKey,
                mode: modeName
            };

            progression.push(chord);
        }

        return progression;
    }

    /**
     * Handle clock tick
     */
    handleClockTick(clockData) {
        const { tick, ppqn } = clockData;

        // Calculate ticks per chord change
        const ticksPerBar = ppqn * 4; // Assuming 4/4 time
        const ticksPerChord = ticksPerBar * this.barsPerChord;

        // Advance chord on chord boundaries
        if (tick % ticksPerChord === 0 && tick > 0) {
            this.advanceChord();
        }

        // Note: Section auto-advancement now happens in advanceChord()
        // when the chord progression completes (wraps to first chord)
    }

    /**
     * Generate a new chord progression
     */
    generateNewProgression() {
        console.log(`Composer: generateNewProgression called`);
        console.log(`  useProbabilistic: ${this.useProbabilistic}`);
        console.log(`  poolKey: ${this.poolKey}`);
        console.log(`  tonicNote: ${this.tonicNote}`);
        console.log(`  currentKey: ${this.currentKey}`);
        console.log(`  currentScale: ${this.currentScale}`);
        console.log(`  progressionStyle: ${this.progressionStyle}`);

        // Use probabilistic system if pool/tonic is available
        if (this.useProbabilistic && this.poolKey && this.tonicNote) {
            console.log('  Using PROBABILISTIC system');
            this.progression = this.generateProgressionProbabilistic(
                this.poolKey,
                this.tonicNote,
                this.progressionStyle,
                this.progressionLength
            );
        } else {
            // Fall back to legacy template-based system
            console.log('  Using LEGACY system');
            this.progression = generateProgression(
                this.currentKey,
                this.currentScale,
                this.progressionStyle
            );
        }

        this.progressionIndex = 0;

        console.log('Composer: Generated progression:',
            this.progression.map(c => c.symbol).join(' → '));

        // Publish first chord immediately
        this.publishCurrentChord();
    }

    /**
     * Determine if we should use flats based on pool key
     * @param {string} poolKey - Pool key (e.g., "3♭", "2♯")
     * @returns {boolean} True if flats should be used
     */
    shouldUseFlats(poolKey) {
        // Flat pools (1♭, 2♭, 3♭, 4♭, 5♭) use flat notation
        // Sharp pools and 0 use sharp notation
        return poolKey && poolKey.includes('♭');
    }

    /**
     * Generate probabilistic chord progression based on harmonic function
     * @param {string} poolKey - Pool key (e.g., "3♯")
     * @param {number} startTonicNote - Starting tonic MIDI note
     * @param {string} style - Progression style (jazz, pop, blues, etc.)
     * @param {number} length - Number of chords
     * @returns {Array} Array of chord objects
     */
    generateProgressionProbabilistic(poolKey, startTonicNote, style, length) {
        const progression = [];

        // Determine which mode/degree the starting tonic is at in the pool
        const pool = harmonicContext.getNotePool(poolKey);
        const poolPitchClasses = [...new Set(pool.map(n => n % 12))];

        // Map pool to major tonic to find the mode
        const poolToMajorTonic = {
            '0': 0, '1♯': 7, '2♯': 2, '3♯': 9, '4♯': 4, '5♯': 11, '6♯': 6,
            '1♭': 5, '2♭': 10, '3♭': 3, '4♭': 8, '5♭': 1
        };
        const majorTonicPC = poolToMajorTonic[poolKey] || 0;

        // Order pitch classes starting from major tonic
        const orderedPitchClasses = [];
        for (let i = 0; i < 7; i++) {
            const pc = (majorTonicPC + [0, 2, 4, 5, 7, 9, 11][i]) % 12;
            if (poolPitchClasses.includes(pc)) {
                orderedPitchClasses.push(pc);
            }
        }

        // Find which mode we're in (0=Ionian, 5=Aeolian, etc.)
        const startTonicPC = startTonicNote % 12;
        const modeIndex = orderedPitchClasses.indexOf(startTonicPC);

        // Map mode index to mode name for harmonization
        const modeNames = ['ionian', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian'];
        const modeName = modeNames[modeIndex] || 'ionian';

        // Determine if we should use flats for note names
        const useFlats = this.shouldUseFlats(poolKey);

        console.log(`Composer: Mode for ${harmonicContext.midiToNoteName(startTonicNote, useFlats)} in pool ${poolKey}: ${modeName} (degree ${modeIndex + 1})`);

        // Start with degree 1 (relative to our chosen tonic)
        let currentDegree = 1;
        let currentTonicNote = startTonicNote;

        for (let i = 0; i < length; i++) {
            // Get chord quality for this degree using the appropriate mode
            const quality = getChordQualityForDegreeInPool(currentDegree, modeName);

            // Create chord object with proper accidental notation
            const chord = {
                symbol: `${harmonicContext.midiToNoteName(currentTonicNote, useFlats)}${quality}`,
                root: currentTonicNote,
                quality: quality,
                degree: currentDegree,
                poolKey: poolKey,
                mode: modeName
            };

            progression.push(chord);

            // Select next degree/tonic for next iteration (if not last chord)
            if (i < length - 1) {
                const next = selectNextTonicByFunction(currentDegree, startTonicNote, poolKey, style);
                currentDegree = next.degree;
                currentTonicNote = next.tonicNote;
            }
        }

        return progression;
    }

    /**
     * Advance to next chord in progression
     */
    advanceChord() {
        const previousIndex = this.progressionIndex;
        this.progressionIndex = (this.progressionIndex + 1) % this.progression.length;

        console.log(`Composer: Advanced to chord ${this.progressionIndex + 1}/${this.progression.length}`);

        // Detect progression completion (wrapped from last chord to first)
        if (previousIndex === this.progression.length - 1 && this.progressionIndex === 0) {
            console.log(`Composer: Progression completed (wrapped to first chord)`);

            // In auto mode, advance to next section when progression completes
            if (this.sectionMode === 'auto' && this.sections.length > 0 && this.currentSectionIndex >= 0) {
                console.log(`Composer: Auto-advancing to next section after progression completion`);
                this.advanceToNextSection();
                return; // advanceToNextSection will publish the new section's first chord
            }
        }

        this.publishCurrentChord();

        // Update UI to show current chord highlighted
        this.updateProgressionDisplay();
    }

    /**
     * Publish current chord to PubSub
     */
    publishCurrentChord() {
        if (this.progression.length === 0) {
            return;
        }

        this.currentChord = this.progression[this.progressionIndex];

        // Voice the chord
        const voicing = voiceChord(this.currentChord, this.voicingType);

        // Calculate next chord for UI preview
        const nextIndex = (this.progressionIndex + 1) % this.progression.length;
        this.nextTonicCenter = this.progression[nextIndex];

        // Publish chord data
        this.publish('music:chord', {
            chord: this.currentChord.symbol,
            root: this.currentChord.root,
            quality: this.currentChord.quality,
            voicing: voicing,
            duration: this.barsPerChord,
            progressionIndex: this.progressionIndex,
            progressionLength: this.progression.length,
            // Pool/tonic info (if available)
            poolKey: this.currentChord.poolKey || this.poolKey,
            tonicNote: this.currentChord.root,
            scaleDegree: this.currentChord.degree
        });

        console.log(`Composer: Publishing chord ${this.currentChord.symbol} (${voicing.join(', ')})`);

        // Also publish next chord for phrase planning
        this.publishNextChord();
    }

    /**
     * Calculate ticks until next chord change
     * @returns {number} Ticks remaining until next chord
     */
    calculateTicksUntilNextChord() {
        const ppqn = 24; // From MIDI clock
        const ticksPerBar = ppqn * 4; // 4/4 time
        const ticksPerChord = ticksPerBar * this.barsPerChord;
        const currentTick = this.getLastValue('clock:tick')?.tick || 0;
        const ticksIntoCurrentChord = currentTick % ticksPerChord;
        return ticksPerChord - ticksIntoCurrentChord;
    }

    /**
     * Publish next chord information for phrase planning
     */
    publishNextChord() {
        if (this.progression.length === 0) {
            return;
        }

        const nextIndex = (this.progressionIndex + 1) % this.progression.length;
        const nextChord = this.progression[nextIndex];
        const nextVoicing = voiceChord(nextChord, this.voicingType);

        this.publish('music:nextChord', {
            chord: nextChord.symbol,
            root: nextChord.root,
            quality: nextChord.quality,
            voicing: nextVoicing,
            poolKey: nextChord.poolKey || this.poolKey,
            tonicNote: nextChord.root,
            scaleDegree: nextChord.degree,
            ticksUntilChange: this.calculateTicksUntilNextChord()
        });

        console.log(`Composer: Next chord will be ${nextChord.symbol} in ${this.calculateTicksUntilNextChord()} ticks`);
    }

    /**
     * Update just the progression display (more efficient than full re-render)
     */
    updateProgressionDisplay() {
        // Update text display
        const displayEl = this.$('#progression-display');
        if (displayEl) {
            displayEl.innerHTML = this.renderProgressionDisplay();
        }

        // Update keyboard grid
        const keyboardEl = this.$('#keyboard-grid');
        if (keyboardEl) {
            keyboardEl.innerHTML = this.renderKeyboardGrid();
        }

        // Update section progress bar (if in auto mode)
        this.updateSectionProgressBar();
    }

    /**
     * Update section progress bar to show chord progression completion
     */
    updateSectionProgressBar() {
        if (this.sectionMode !== 'auto' || this.progression.length === 0) return;

        const progressBar = this.$('#section-progress-bar');
        const progressText = this.$('#section-progress-text');

        if (progressBar && this.progression.length > 0) {
            const percentage = ((this.progressionIndex + 1) / this.progression.length) * 100;
            progressBar.style.width = `${percentage}%`;
        }

        if (progressText) {
            progressText.textContent = `Chord ${this.progressionIndex + 1}/${this.progression.length}`;
        }
    }

    /**
     * Change progression length
     * Handles both extending (regenerate more chords) and truncating (remove chords)
     */
    setProgressionLength(newLength) {
        const oldLength = this.progressionLength;
        this.progressionLength = newLength;

        if (this.progression.length === 0) {
            // No existing progression, generate a new one
            this.generateNewProgression();
        } else {
            // Keep chords from 0 to progressionIndex (inclusive)
            const keptChords = this.progression.slice(0, this.progressionIndex + 1);

            if (newLength <= keptChords.length) {
                // New length is shorter than or equal to kept chords
                // Just truncate to new length
                this.progression = this.progression.slice(0, newLength);
            } else {
                // New length is longer - need to regenerate remaining chords
                const remainingLength = newLength - keptChords.length;
                const lastKeptChord = keptChords[keptChords.length - 1];

                // Generate remaining chords
                const newChords = this.generatePartialProgression(
                    this.poolKey,
                    lastKeptChord.degree,
                    lastKeptChord.root,
                    this.progressionStyle,
                    remainingLength
                );

                // Combine kept chords with newly generated ones
                this.progression = [...keptChords, ...newChords];
            }

            console.log(`Composer: Progression length changed ${oldLength} → ${newLength}:`,
                this.progression.map(c => c.symbol).join(' → '));

            this.publishCurrentChord();
            this.updateProgressionDisplay();
        }

        // Update UI to show new length
        const lengthInput = this.$('#progression-length-input');
        if (lengthInput) {
            lengthInput.value = newLength;
        }
    }

    /**
     * Change progression style
     */
    setProgressionStyle(style) {
        this.progressionStyle = style;

        // Only regenerate chords after the current chord (same pattern as pool changes)
        if (this.progression.length > 0 && this.progressionIndex >= 0) {
            this.regenerateRemainingProgression();
        } else {
            // No existing progression, generate a new one
            this.generateNewProgression();
        }

        // Update UI to show new style
        const styleSelect = this.$('#style-select');
        if (styleSelect) {
            styleSelect.value = style;
        }
    }

    /**
     * Change voicing type
     */
    setVoicingType(voicingType) {
        this.voicingType = voicingType;
        this.publishCurrentChord(); // Re-voice current chord

        // Update UI to show new voicing type
        const voicingSelect = this.$('#voicing-select');
        if (voicingSelect) {
            voicingSelect.value = voicingType;
        }
    }

    // ========================================
    // Manual Chord Progression Entry
    // ========================================

    /**
     * Parse manual chord progression text
     * Handles chord symbols like "C#m7", "Dbm7", "A7", "Fmaj7", etc.
     * @param {string} text - Chord progression text (space-separated)
     * @returns {Array} Array of chord objects
     */
    parseManualProgression(text) {
        const chordTokens = text.trim().split(/\s+/);
        const progression = [];

        const useFlats = this.shouldUseFlats(this.poolKey);

        chordTokens.forEach(token => {
            const parsed = this.parseChordSymbol(token, useFlats);
            if (parsed) {
                progression.push(parsed);
            } else {
                console.warn(`Composer: Could not parse chord "${token}"`);
            }
        });

        return progression;
    }

    /**
     * Parse individual chord symbol
     * @param {string} symbol - Chord symbol (e.g., "C#m7", "Bb7", "Fmaj7")
     * @param {boolean} useFlats - Whether to canonicalize to flats
     * @returns {object|null} Chord object or null if invalid
     */
    parseChordSymbol(symbol, useFlats = false) {
        // Chord symbol regex: captures root note and quality
        // Root: [A-G][#♯b♭]?
        // Quality: (m|min|maj|dim|aug|sus)?\d*
        const chordRegex = /^([A-G])([#♯b♭]?)(.*)?$/;
        const match = symbol.match(chordRegex);

        if (!match) return null;

        const rootLetter = match[1];
        let accidental = match[2];
        const quality = match[3] || '';

        // Normalize accidentals
        if (accidental === '♯') accidental = '#';
        if (accidental === '♭') accidental = 'b';

        // Convert to pitch class (0-11)
        const letterToPitchClass = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };
        let pitchClass = letterToPitchClass[rootLetter];

        if (accidental === '#') {
            pitchClass = (pitchClass + 1) % 12;
        } else if (accidental === 'b') {
            pitchClass = (pitchClass - 1 + 12) % 12;
        }

        // Canonicalize root name based on pool notation
        const canonicalRoot = this.pitchClassToNoteName(pitchClass, useFlats);

        // Parse quality
        const parsedQuality = this.parseChordQuality(quality);

        // Find MIDI note (use middle octave as reference)
        const rootNote = 60 + pitchClass - (60 % 12); // C4 = 60, adjust to correct pitch class

        // Determine degree in current pool (if available)
        const degree = this.findDegreeInPool(pitchClass);

        return {
            symbol: canonicalRoot + parsedQuality,
            root: rootNote,
            quality: parsedQuality,
            degree: degree,
            poolKey: this.poolKey,
            mode: 'manual' // Flag to indicate manually entered
        };
    }

    /**
     * Convert pitch class to note name
     * @param {number} pitchClass - Pitch class (0-11)
     * @param {boolean} useFlats - Use flats vs sharps
     * @returns {string} Note name
     */
    pitchClassToNoteName(pitchClass, useFlats = false) {
        const sharpNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
        const flatNames = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
        return useFlats ? flatNames[pitchClass] : sharpNames[pitchClass];
    }

    /**
     * Parse chord quality string
     * @param {string} quality - Quality string (e.g., "m7", "maj7", "dim", "7")
     * @returns {string} Normalized quality
     */
    parseChordQuality(quality) {
        if (!quality || quality === '') return ''; // Major triad

        // Normalize common variations
        const normalized = quality
            .replace(/minor|min/i, 'm')
            .replace(/major|maj/i, 'maj')
            .replace(/diminished|dim/i, 'dim')
            .replace(/augmented|aug/i, 'aug')
            .replace(/dominant|dom/i, '');

        return normalized;
    }

    /**
     * Find degree of pitch class in current pool
     * @param {number} pitchClass - Pitch class (0-11)
     * @returns {number} Degree (1-7) or 1 if not found
     */
    findDegreeInPool(pitchClass) {
        const pool = harmonicContext.getNotePool(this.poolKey || '0');
        const poolPitchClasses = [...new Set(pool.map(n => n % 12))];

        // Map pool to major tonic to find ordered degrees
        const poolToMajorTonic = {
            '0': 0, '1♯': 7, '2♯': 2, '3♯': 9, '4♯': 4, '5♯': 11, '6♯': 6,
            '1♭': 5, '2♭': 10, '3♭': 3, '4♭': 8, '5♭': 1
        };
        const majorTonicPC = poolToMajorTonic[this.poolKey] || 0;

        const orderedPitchClasses = [];
        for (let i = 0; i < 7; i++) {
            const pc = (majorTonicPC + [0, 2, 4, 5, 7, 9, 11][i]) % 12;
            if (poolPitchClasses.includes(pc)) {
                orderedPitchClasses.push(pc);
            }
        }

        const degreeIndex = orderedPitchClasses.indexOf(pitchClass);
        return degreeIndex >= 0 ? degreeIndex + 1 : 1;
    }

    /**
     * Set progression from manual text input
     * @param {string} text - Manual chord progression text
     */
    setManualProgression(text) {
        const progression = this.parseManualProgression(text);
        if (progression.length > 0) {
            this.progression = progression;
            this.progressionLength = progression.length;
            this.progressionIndex = 0;
            this.publishCurrentChord();
            this.updateProgressionDisplay();
            console.log(`Composer: Set manual progression:`, progression.map(c => c.symbol).join(' → '));
        }
    }

    // ========================================
    // Section Management
    // ========================================

    /**
     * Capture current state as a new section
     * Captures context topic values and playhead positions
     * @param {string} name - Section name
     * @returns {Promise<object>} Created section
     */
    async captureCurrentStateAsSection(name) {
        const section = {
            id: `section-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: name,

            // Capture context topics
            contextTopics: {
                'context:progression': {
                    progression: [...this.progression],
                    progressionIndex: this.progressionIndex,  // Current chord position
                    progressionLength: this.progressionLength,
                    style: this.progressionStyle,
                    barsPerChord: this.barsPerChord,
                    voicingType: this.voicingType
                },
                'context:mood': { mood: this.getLastValue('context:mood')?.mood || 'relaxed' },
                'context:density': { density: this.getLastValue('context:density')?.density || 0.5 },
                'context:pool': {
                    poolKey: this.poolKey || '0',
                    tonicNote: this.tonicNote || 60,
                    tonicName: this.tonicName || 'C',
                    notes: this.getLastValue('context:pool')?.notes || []
                },
                'context:timeSignature': {
                    timeSignature: this.getLastValue('context:timeSignature')?.timeSignature || '4/4',
                    sixteenthsPerBar: this.getLastValue('context:timeSignature')?.sixteenthsPerBar || 16
                },
                'context:tempo': {
                    bpm: this.getLastValue('clock:tempo')?.bpm || 120
                },
                'context:mute': {
                    mutes: this.captureCurrentMutes()
                },
                'context:bassist': this.captureInstrumentalistSettings('sonofire-bassist'),
                'context:drummer': this.captureInstrumentalistSettings('sonofire-drummer'),
                'context:soloist': this.captureInstrumentalistSettings('sonofire-soloist'),
                'context:keyboardist': this.captureInstrumentalistSettings('sonofire-keyboardist')
            },

            // Capture playhead states (not whippable - manual save/restore)
            playheadStates: this.capturePlayheadStates(),

            // Capture Y-zoom states from visualizers
            yZoomStates: this.captureYZoomStates(),

            // Capture whip bindings (await async operation)
            whipBindings: await this.captureWhipBindings()
        };

        this.sections.push(section);
        this.saveSections();
        this.render();

        console.log(`Composer: Captured section "${name}":`, section);

        return section;
    }

    /**
     * Overwrite an existing section with current state
     * @param {number} index - Section index to overwrite
     * @param {string} name - Section name
     * @returns {Promise<void>}
     */
    async overwriteSection(index, name) {
        const section = {
            id: this.sections[index].id,  // Keep existing ID
            name: name,

            // Capture current context topics
            contextTopics: {
                'context:progression': {
                    progression: [...this.progression],
                    progressionIndex: this.progressionIndex,
                    progressionLength: this.progressionLength,
                    style: this.progressionStyle,
                    barsPerChord: this.barsPerChord,
                    voicingType: this.voicingType
                },
                'context:mood': { mood: this.getLastValue('context:mood')?.mood || 'relaxed' },
                'context:density': { density: this.getLastValue('context:density')?.density || 0.5 },
                'context:pool': {
                    poolKey: this.poolKey || '0',
                    tonicNote: this.tonicNote || 60,
                    tonicName: this.tonicName || 'C',
                    notes: this.getLastValue('context:pool')?.notes || []
                },
                'context:timeSignature': {
                    timeSignature: this.getLastValue('context:timeSignature')?.timeSignature || '4/4',
                    sixteenthsPerBar: this.getLastValue('context:timeSignature')?.sixteenthsPerBar || 16
                },
                'context:tempo': {
                    bpm: this.getLastValue('clock:tempo')?.bpm || 120
                },
                'context:mute': {
                    mutes: this.captureCurrentMutes()
                },
                'context:bassist': this.captureInstrumentalistSettings('sonofire-bassist'),
                'context:drummer': this.captureInstrumentalistSettings('sonofire-drummer'),
                'context:soloist': this.captureInstrumentalistSettings('sonofire-soloist'),
                'context:keyboardist': this.captureInstrumentalistSettings('sonofire-keyboardist')
            },

            // Capture playhead states
            playheadStates: this.capturePlayheadStates(),

            // Capture Y-zoom states from visualizers
            yZoomStates: this.captureYZoomStates(),

            // Capture whip bindings (await async operation)
            whipBindings: await this.captureWhipBindings()
        };

        // Replace the section at this index
        this.sections[index] = section;
        this.saveSections();
        this.render();

        console.log(`Composer: Overwrote section "${name}" at index ${index}:`, section);
    }

    /**
     * Capture current mute states from all instrumentalists
     * @returns {object} Map of component IDs to mute states
     */
    captureCurrentMutes() {
        const mutes = {};

        // Query all instrumentalist elements in DOM
        const instrumentalists = document.querySelectorAll('sonofire-drummer, sonofire-bassist, sonofire-soloist, sonofire-keyboardist');

        instrumentalists.forEach(inst => {
            const id = inst.getComponentId ? inst.getComponentId() : (inst.id || inst.tagName.toLowerCase());
            mutes[id] = inst.muted || false;
        });

        return mutes;
    }

    /**
     * Capture instrumentalist-specific settings
     * @param {string} tagName - Tag name of instrumentalist (e.g., 'sonofire-bassist')
     * @returns {object} Settings object for this instrumentalist
     */
    captureInstrumentalistSettings(tagName) {
        const inst = document.querySelector(tagName);

        if (!inst) {
            return {}; // Instrumentalist not present
        }

        const settings = {};

        // Bassist settings
        if (tagName === 'sonofire-bassist') {
            settings.motionType = inst.motionType || 'root-5th';
            settings.rhythmPattern = inst.rhythmPattern || null;
            settings.transpose = inst.transpose || 0;
            settings.humanizationEnabled = inst.humanizationEnabled !== undefined ? inst.humanizationEnabled : true;
            settings.humanizationIntensity = inst.humanizationIntensity !== undefined ? inst.humanizationIntensity : 0.7;
        }

        // Drummer settings
        else if (tagName === 'sonofire-drummer') {
            settings.drumStyle = inst.drumStyle || 'rock';
            settings.humanizationEnabled = inst.humanizationEnabled !== undefined ? inst.humanizationEnabled : true;
            settings.humanizationIntensity = inst.humanizationIntensity !== undefined ? inst.humanizationIntensity : 0.7;
            settings.swingAmount = inst.swingAmount !== undefined ? inst.swingAmount : 0.0;
        }

        // Soloist settings
        else if (tagName === 'sonofire-soloist') {
            settings.playingStyle = inst.playingStyle || 'melodic';
            settings.noteRange = inst.noteRange || 'mid';
            settings.maxInterval = inst.maxInterval || 7;
            // Soloist may not have humanization implemented yet
            if (inst.humanizationEnabled !== undefined) {
                settings.humanizationEnabled = inst.humanizationEnabled;
                settings.humanizationIntensity = inst.humanizationIntensity || 0.7;
            }
        }

        // Keyboardist settings
        else if (tagName === 'sonofire-keyboardist') {
            settings.instrumentStyle = inst.instrumentStyle || 'piano';
            settings.playingApproach = inst.playingApproach || 'comping';
            settings.humanizationEnabled = inst.humanizationEnabled !== undefined ? inst.humanizationEnabled : true;
            settings.humanizationIntensity = inst.humanizationIntensity !== undefined ? inst.humanizationIntensity : 0.6;
        }

        return settings;
    }

    /**
     * Capture playhead states from all visualizers
     * @returns {Array} Array of playhead state objects
     */
    capturePlayheadStates() {
        const states = [];

        // Query all visualizers
        const visualizers = document.querySelectorAll('sonofire-xy-plot');

        visualizers.forEach(viz => {
            if (viz.playheads) {
                viz.playheads.forEach(playhead => {
                    states.push({
                        visualizerId: viz.getVisualizerId(),
                        playheadId: playhead.id,
                        position: playhead.position,
                        enabled: playhead.enabled,
                        speed: playhead.speed
                    });
                });
            }
        });

        return states;
    }

    /**
     * Capture Y-axis zoom states from all visualizers
     * @returns {Array} Array of Y-zoom state objects
     */
    captureYZoomStates() {
        const states = [];

        // Query all visualizers
        const visualizers = document.querySelectorAll('sonofire-xy-plot');

        visualizers.forEach(viz => {
            const visualizerId = viz.getVisualizerId ? viz.getVisualizerId() : viz.id;

            // Get Y-zoom state from visualizer
            if (viz.yZoomLevel !== undefined && viz.yZoomCenter !== undefined) {
                states.push({
                    visualizerId: visualizerId,
                    zoomLevel: viz.yZoomLevel,
                    zoomCenter: viz.yZoomCenter
                });
            }
        });

        return states;
    }

    /**
     * Capture all current whip bindings
     * @returns {Array} Array of binding JSON objects
     */
    async captureWhipBindings() {
        try {
            const { WhipManager } = await import('../../lib/whip_manager.js');

            // Get all current bindings
            const bindings = WhipManager.getAllBindings();

            // Convert each binding to JSON
            const bindingsData = bindings.map(binding => binding.toJSON());

            console.log(`Composer: Captured ${bindingsData.length} whip binding(s)`);

            return bindingsData;
        } catch (error) {
            console.error('Composer: Error capturing whip bindings:', error);
            return [];
        }
    }

    /**
     * Load a section by publishing its context topics
     * @param {number} sectionIndex - Section index to load
     */
    loadSection(sectionIndex) {
        if (sectionIndex < 0 || sectionIndex >= this.sections.length) return;

        const section = this.sections[sectionIndex];
        this.currentSectionIndex = sectionIndex;

        console.log(`Composer: Loading section "${section.name}"`, section);

        // Directly restore progression state (don't rely on subscription handler)
        const progressionData = section.contextTopics['context:progression'];
        if (progressionData) {
            this.progression = progressionData.progression;
            this.progressionStyle = progressionData.style;
            this.barsPerChord = progressionData.barsPerChord;
            this.voicingType = progressionData.voicingType;
            this.progressionLength = progressionData.progressionLength;
            // ALWAYS start at first chord when loading a section
            this.progressionIndex = 0;
        }

        // Directly restore pool/tonic state (don't rely on subscription handler)
        const poolData = section.contextTopics['context:pool'];
        if (poolData) {
            this.poolKey = poolData.poolKey;
            this.tonicNote = poolData.tonicNote;
            this.tonicName = poolData.tonicName;
        }

        // Publish all context topics for this section (for other components)
        for (const [topic, data] of Object.entries(section.contextTopics)) {
            this.publish(topic, data);
        }

        // Publish current chord (now that progression is loaded)
        this.publishCurrentChord();

        // Restore playhead positions (manual restore - not whippable)
        this.restorePlayheadStates(section.playheadStates);

        // Restore Y-zoom states from visualizers
        if (section.yZoomStates) {
            this.restoreYZoomStates(section.yZoomStates);
        }

        // Optionally restore whip bindings
        if (section.whipBindings && section.whipBindings.length > 0) {
            this.restoreWhipBindings(section.whipBindings);
        }

        // Publish section change event
        this.publish('context:section', {
            sectionId: section.id,
            sectionName: section.name,
            sectionIndex: sectionIndex
        });

        // Update UI to show loaded section and progression
        this.render();
    }

    /**
     * Restore playhead states
     * @param {Array} states - Array of playhead state objects
     */
    restorePlayheadStates(states) {
        states.forEach(state => {
            const viz = document.getElementById(state.visualizerId) ||
                       document.querySelector(`sonofire-xy-plot[data-visualizer-id="${state.visualizerId}"]`);

            if (viz && viz.getPlayhead) {
                const playhead = viz.getPlayhead(state.playheadId);
                if (playhead) {
                    playhead.setPosition(state.position);
                    playhead.setEnabled(state.enabled);
                    playhead.setSpeed(state.speed);
                }
            }
        });

        // CRITICAL: Delay sampling to ensure whip bindings are restored and data is ready
        // This gives time for:
        // 1. Whip bindings to be registered
        // 2. Visualizer data to be fully available
        // 3. Event detection system to be ready
        setTimeout(() => {
            states.forEach(state => {
                const viz = document.getElementById(state.visualizerId) ||
                           document.querySelector(`sonofire-xy-plot[data-visualizer-id="${state.visualizerId}"]`);

                if (viz && viz.getPlayhead) {
                    const playhead = viz.getPlayhead(state.playheadId);

                    if (playhead && playhead.enabled && viz.sampleDataAtPlayhead) {
                        // Force playhead to re-sample data at new position
                        // This triggers event detection and whip bindings
                        viz.sampleDataAtPlayhead(playhead);
                    }
                }
            });

            // Trigger visual update after all playheads sampled
            states.forEach(state => {
                const viz = document.getElementById(state.visualizerId) ||
                           document.querySelector(`sonofire-xy-plot[data-visualizer-id="${state.visualizerId}"]`);

                if (viz && viz.onPlayheadsAdvanced) {
                    viz.onPlayheadsAdvanced();
                }
            });
        }, 100); // 100ms delay to ensure everything is ready
    }

    /**
     * Restore Y-zoom states for visualizers
     * @param {Array} states - Array of Y-zoom state objects
     */
    restoreYZoomStates(states) {
        states.forEach(state => {
            const viz = document.getElementById(state.visualizerId) ||
                       document.querySelector(`sonofire-xy-plot[data-visualizer-id="${state.visualizerId}"]`);

            if (viz) {
                // Publish Y-zoom state to the visualizer's specific topic
                // The visualizer will subscribe to this and update accordingly
                const topic = `visualizer:${state.visualizerId}:yzoom`;
                this.publish(topic, {
                    zoomLevel: state.zoomLevel,
                    zoomCenter: state.zoomCenter,
                    timestamp: Date.now()
                });

                console.log(`Composer: Restored Y-zoom for ${state.visualizerId}: level=${state.zoomLevel.toFixed(2)}, center=${state.zoomCenter.toFixed(2)}`);
            }
        });
    }

    /**
     * Restore whip bindings (optional)
     * @param {Array} bindingsData - Array of binding JSON objects
     */
    async restoreWhipBindings(bindingsData) {
        const { WhipManager } = await import('../../lib/whip_manager.js');
        const { WhipBinding } = await import('../../lib/whip_binding.js');

        // Clear existing bindings
        WhipManager.clearAllBindings();

        // Restore saved bindings
        bindingsData.forEach(data => {
            const binding = WhipBinding.fromJSON(data);
            WhipManager.registerBinding(binding);
        });
    }

    /**
     * Navigate to next section
     */
    nextSection() {
        if (this.sections.length === 0) return;

        if (this.sectionMode === 'manual') {
            const nextIndex = (this.currentSectionIndex + 1) % this.sections.length;
            this.loadSection(nextIndex);
        }
    }

    /**
     * Navigate to previous section
     */
    previousSection() {
        if (this.sections.length === 0) return;

        if (this.sectionMode === 'manual') {
            const prevIndex = (this.currentSectionIndex - 1 + this.sections.length) % this.sections.length;
            this.loadSection(prevIndex);
        }
    }

    /**
     * Delete section
     * @param {number} sectionIndex - Section index to delete
     */
    deleteSection(sectionIndex) {
        this.sections.splice(sectionIndex, 1);

        if (this.currentSectionIndex >= this.sections.length) {
            this.currentSectionIndex = Math.max(-1, this.sections.length - 1);
        }

        this.saveSections();
        this.render();
    }

    /**
     * Edit section - rename
     * @param {number} sectionIndex - Section index to edit
     */
    editSection(sectionIndex) {
        const section = this.sections[sectionIndex];
        if (!section) return;

        const newName = prompt('Section name:', section.name);

        if (newName && newName !== section.name) {
            // Check if name already exists (excluding current section)
            const existingIndex = this.sections.findIndex((s, i) => s.name === newName && i !== sectionIndex);

            if (existingIndex >= 0) {
                alert(`A section named "${newName}" already exists. Please choose a different name.`);
                return;
            }

            // Update section name
            section.name = newName;
            this.saveSections();
            this.render();

            console.log(`Composer: Renamed section at index ${sectionIndex} to "${newName}"`);
        }
    }

    /**
     * Reorder section - move from one index to another
     * @param {number} fromIndex - Source index
     * @param {number} toIndex - Destination index
     */
    reorderSection(fromIndex, toIndex) {
        if (fromIndex === toIndex) return;

        // Remove section from old position
        const [movedSection] = this.sections.splice(fromIndex, 1);

        // Insert at new position
        this.sections.splice(toIndex, 0, movedSection);

        // Update currentSectionIndex to track the same section
        if (this.currentSectionIndex === fromIndex) {
            // The current section was moved
            this.currentSectionIndex = toIndex;
        } else if (fromIndex < this.currentSectionIndex && toIndex >= this.currentSectionIndex) {
            // Moved section from before current to after current
            this.currentSectionIndex--;
        } else if (fromIndex > this.currentSectionIndex && toIndex <= this.currentSectionIndex) {
            // Moved section from after current to before current
            this.currentSectionIndex++;
        }

        this.saveSections();
        this.render();

        console.log(`Composer: Reordered section "${movedSection.name}" from index ${fromIndex} to ${toIndex}`);
    }

    /**
     * Advance to next section in auto mode
     * Uses arrangementOrder if defined, otherwise linear progression
     */
    advanceToNextSection() {
        if (this.sections.length === 0) return;

        if (this.arrangementOrder.length > 0) {
            // Use arrangement order (e.g., [0, 1, 0, 2, 1] for verse-chorus-verse-bridge-chorus)
            this.arrangementIndex = (this.arrangementIndex + 1) % this.arrangementOrder.length;
            const nextSectionIndex = this.arrangementOrder[this.arrangementIndex];
            this.loadSection(nextSectionIndex);
        } else {
            // Linear progression through sections (wrap around at end)
            const nextIndex = (this.currentSectionIndex + 1) % this.sections.length;
            this.loadSection(nextIndex);
        }

        console.log(`Composer: Auto-advanced to section "${this.sections[this.currentSectionIndex]?.name}"`);
    }

    /**
     * Save sections to PubSub/localStorage
     */
    saveSections() {
        this.publish('composer:sections', {
            sections: this.sections,
            currentSectionIndex: this.currentSectionIndex,
            sectionMode: this.sectionMode,
            arrangementOrder: this.arrangementOrder
        });
    }

    /**
     * Restore sections from PubSub/localStorage
     */
    restoreSections() {
        const state = this.getLastValue('composer:sections');
        if (state) {
            this.sections = state.sections || [];
            this.currentSectionIndex = state.currentSectionIndex ?? -1;
            this.sectionMode = state.sectionMode || 'manual';
            this.arrangementOrder = state.arrangementOrder || [];

            console.log(`Composer: Restored ${this.sections.length} section(s)`);

            // Re-render to show sections in UI
            if (this.isConnected) {
                this.render();
            }

            // If there was a current section, load it to restore the musical state
            if (this.currentSectionIndex >= 0 && this.currentSectionIndex < this.sections.length) {
                console.log(`Composer: Auto-loading section ${this.currentSectionIndex} at startup`);
                // Use setTimeout to ensure this happens after component is fully initialized
                setTimeout(() => {
                    this.loadSection(this.currentSectionIndex);
                }, 0);
            }
        }
    }

    /**
     * Render piano keyboard grid showing pool of notes and tonic centers
     * @returns {string} SVG markup for keyboard
     */
    renderKeyboardGrid() {
        // Get current pool of notes
        const poolKey = this.poolKey || '0';
        const pool = harmonicContext.getNotePool(poolKey);
        const poolPitchClasses = [...new Set(pool.map(n => n % 12))];

        // Current and next chord voicings
        const currentChordVoicing = this.currentChord ? voiceChord(this.currentChord, this.voicingType) : [];
        const currentChordPitchClasses = [...new Set(currentChordVoicing.map(n => n % 12))];

        const nextChordVoicing = this.nextTonicCenter ? voiceChord(this.nextTonicCenter, this.voicingType) : [];
        const nextChordPitchClasses = [...new Set(nextChordVoicing.map(n => n % 12))];

        // Current and next tonic centers (roots)
        const currentTonic = this.currentChord?.root;
        const nextTonic = this.nextTonicCenter?.root;

        // Keyboard layout
        const pitchClasses = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,]// 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
        const noteNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
        const isSharp = [false, true, false, true, false, false, true, false, true, false, true, false];

        const keyWidth = 30;
        const keyHeight = 60;
        const svgWidth = keyWidth * 24;
        const svgHeight = 100;

        let svg = `<svg width="${svgWidth}" height="${svgHeight}" style="background: #1e1e1e;">`;
        let sharpSvg = '';

        let naturalCount = -1;
        let rootSvg = "";
        pitchClasses.forEach((pc, i) => {
            if(!isSharp[i%12]){ naturalCount += 1 }
            const x = naturalCount * keyWidth + (isSharp[i%12]?0.6*keyWidth:0);
            const y = isSharp[i%12] ? 5 : 20;  // Sharps offset upward
            const inPool = poolPitchClasses.includes(pc%12);
            const inCurrentChord = currentChordPitchClasses.includes(pc);
            const inNextChord = nextChordPitchClasses.includes(pc);

            // Colors based on state
            let fillColor;
            /*if (inCurrentChord) {
                fillColor = '#00cc88'; // Bright green for current chord notes
            } else*/ if (inPool) {
                fillColor = '#4ec9b0'; // Cyan for pool notes not in chord
            } else {
                fillColor = '#3c3c3c'; // Dark gray for unavailable notes
            }

            // Add subtle highlight for next chord notes
            /*if (inNextChord && !inCurrentChord) {
                fillColor = '#5588cc'; // Blue tint for next chord notes
            }*/

            const strokeColor = '#1e1e1e';

            let keySvg = "";
            // Draw key rectangle
            keySvg += `<rect x="${x}" y="${y}" width="${isSharp[i%12] ? (keyWidth * 0.75 - 2):keyWidth - 2}" height="${keyHeight + (!isSharp[i%12] ? 17 : 0)}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2" rx="3"/>`;

            // Draw note label
            //keySvg += `<text x="${x + keyWidth / 2}" y="${y + keyHeight - 10}" text-anchor="middle" fill="#d4d4d4" font-size="12">${noteNames[i]}</text>`;

            // Draw tonic indicators (roots)
            if (currentTonic && currentTonic % 12 === pc) {
                // Green circle with R for current root
                rootSvg += `<circle cx="${x + keyWidth/2}" cy="${y + 45 + (isSharp[i%12] ? 0 : 17)}" r="10" fill="#ffcc00" opacity="0.9" stroke="#000" stroke-width="1"/>`;
                rootSvg += `<text x="${x + keyWidth/2}" y="${y + 48.5 + (isSharp[i%12] ? 0 : 17)}" text-anchor="middle" fill="#000" font-size="10" font-weight="bold">R</text>`;
            }
            /*if (nextTonic && nextTonic % 12 === pc && nextTonic % 12 !== currentTonic % 12) {
                // Blue arrow for next root (only if different from current)
                keySvg += `<circle cx="${x + keyWidth/2}" cy="${y + 40}" r="8" fill="#0080ff" opacity="0.8"/>`;
                keySvg += `<text x="${x + keyWidth/2}" y="${y + 45}" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold">→</text>`;
            }*/
            if(isSharp[i%12]){
                sharpSvg += keySvg;
            } else {
                svg += keySvg;
            }
        });

        // render sharps 'on top' of naturals
        svg += sharpSvg;
        svg += rootSvg;
        svg += '</svg>';
        return svg;
    }

    /**
     * Get friendly key name from pool/tonic notation
     * E.g., "3♯/A" → "A Ionian (major)", "3♯/C♯" → "C♯ Phrygian"
     * @returns {string} Friendly key name with mode
     */
    getFriendlyKeyName() {
        if (!this.poolKey || !this.tonicName) {
            return 'C Ionian (major)';
        }

        // Get the pool notes
        const pool = harmonicContext.getNotePool(this.poolKey);
        if (!pool || pool.length === 0) {
            return `${this.tonicName} Ionian (major)`;
        }

        // Get unique pitch classes from the pool
        const poolPitchClasses = [...new Set(pool.map(n => n % 12))];

        // Map pool key to its major tonic (Ionian degree)
        const poolToMajorTonic = {
            '0': 0,      // C
            '1♯': 7,     // G
            '2♯': 2,     // D
            '3♯': 9,     // A
            '4♯': 4,     // E
            '5♯': 11,    // B
            '6♯': 6,     // F♯
            '1♭': 5,     // F
            '2♭': 10,    // B♭
            '3♭': 3,     // E♭
            '4♭': 8,     // A♭
            '5♭': 1      // D♭
        };

        const majorTonicPC = poolToMajorTonic[this.poolKey];
        if (majorTonicPC === undefined) {
            return `${this.tonicName} (unknown pool)`;
        }

        // Order pitch classes starting from the major tonic
        const orderedPitchClasses = [];
        for (let i = 0; i < 7; i++) {
            const pc = (majorTonicPC + [0, 2, 4, 5, 7, 9, 11][i]) % 12;
            if (poolPitchClasses.includes(pc)) {
                orderedPitchClasses.push(pc);
            }
        }

        // Convert tonic name to pitch class
        const tonicNote = harmonicContext.noteNameToMIDI(this.tonicName, 4);
        const tonicPitchClass = tonicNote % 12;

        // Find which degree this tonic is in the ordered pool
        const degree = orderedPitchClasses.indexOf(tonicPitchClass);

        if (degree === -1) {
            // Tonic not in pool - shouldn't happen, but handle gracefully
            return `${this.tonicName} (not in pool)`;
        }

        // Map degree (0-6) to mode name
        const modeNames = [
            'Ionian (major)',    // 1st degree
            'Dorian',            // 2nd degree
            'Phrygian',          // 3rd degree
            'Lydian',            // 4th degree
            'Mixolydian',        // 5th degree
            'Aeolian (minor)',   // 6th degree
            'Locrian'            // 7th degree
        ];

        const modeName = modeNames[degree] || 'Unknown';

        return `${this.tonicName} ${modeName}`;
    }

    /**
     * Render section controls UI
     * @returns {string} HTML for section controls
     */
    renderSectionControls() {
        const currentSection = this.currentSectionIndex >= 0 ? this.sections[this.currentSectionIndex] : null;
        const sectionName = currentSection?.name || 'No section';

        return `
            <div style="margin-bottom: 15px; padding: 10px; background: #1e1e1e; border-radius: 4px;">
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                    <strong style="color: #dcdcaa;">Song Sections</strong>

                    <!-- Mode selector -->
                    <select id="section-mode-select" style="padding: 4px; background: #3c3c3c; color: #d4d4d4; border: 1px solid #555;">
                        <option value="manual" ${this.sectionMode === 'manual' ? 'selected' : ''}>Manual</option>
                        <option value="auto" ${this.sectionMode === 'auto' ? 'selected' : ''}>Auto</option>
                    </select>

                    <!-- Navigation -->
                    <button id="prev-section-btn" style="padding: 4px 8px; background: #0e639c; color: white; border: none; cursor: pointer;">◀ Prev</button>
                    <span style="color: #4ec9b0; font-weight: bold;">${sectionName}</span>
                    <button id="next-section-btn" style="padding: 4px 8px; background: #0e639c; color: white; border: none; cursor: pointer;">Next ▶</button>

                    <!-- Capture current state -->
                    <button id="capture-section-btn" style="padding: 4px 8px; background: #608b4e; color: white; border: none; cursor: pointer;">📸 Capture</button>

                    <!-- Section index whippable target -->
                    <span style="margin-left: auto;">Section Index ${this.getTargetLightHTML('sectionIndex')}</span>
                </div>

                <!-- Progress bar (for auto mode) - shows chord progression completion -->
                ${this.sectionMode === 'auto' && currentSection && this.progression.length > 0 ? `
                    <div style="background: #3c3c3c; height: 4px; border-radius: 2px; overflow: hidden;">
                        <div id="section-progress-bar" style="background: #4ec9b0; height: 100%; width: ${((this.progressionIndex + 1) / this.progression.length) * 100}%;"></div>
                    </div>
                    <div id="section-progress-text" style="color: #888; font-size: 11px; text-align: center; margin-top: 2px;">
                        Chord ${this.progressionIndex + 1}/${this.progression.length}
                    </div>
                ` : ''}
            </div>
        `;
    }

    /**
     * Get friendly label for bars per chord value
     * @param {number} value - Bars per chord value
     * @returns {string} Friendly label
     */
    getBarsPerChordLabel(value) {
        const labels = {
            8: '8 bars',
            7: '7 bars',
            6: '6 bars',
            5: '5 bars',
            4: '4 bars',
            3: '3 bars',
            2: '2 bars',
            1: '1 bar',
            0.5: '2 beats',
            0.25: '1 beat'
        };
        return labels[value] || `${value} bars`;
    }

    /**
     * Render section list UI
     * @returns {string} HTML for section list
     */
    renderSectionList() {
        if (this.sections.length === 0) {
            return '<div style="color: #888; font-size: 11px; margin-bottom: 10px;">No sections defined. Click "Capture" to save current state.</div>';
        }

        return `
            <div style="margin-bottom: 15px; max-height: 200px; overflow-y: auto;">
                ${this.sections.map((section, index) => {
                    const progression = section.contextTopics['context:progression'];
                    const barsPerChordLabel = this.getBarsPerChordLabel(progression.barsPerChord);
                    return `
                    <div class="section-item" data-section-index="${index}" draggable="true" style="
                        padding: 8px;
                        margin: 4px 0;
                        background: ${index === this.currentSectionIndex ? '#264f78' : '#252526'};
                        border-left: 3px solid ${index === this.currentSectionIndex ? '#4ec9b0' : '#555'};
                        cursor: move;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                    ">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="color: #888; cursor: grab; user-select: none;" title="Drag to reorder">⠿</span>
                            <div>
                                <strong style="color: #dcdcaa;">${section.name}</strong>
                                <span style="color: #888; font-size: 11px; margin-left: 10px;">
                                    ${progression.progression.length} chords @ ${barsPerChordLabel}
                                </span>
                            </div>
                        </div>
                        <div style="display: flex; gap: 5px;">
                            <button class="edit-section-btn" data-section-index="${index}" style="padding: 2px 6px; background: #0e639c; color: white; border: none; cursor: pointer; font-size: 11px;">✏️</button>
                            <button class="delete-section-btn" data-section-index="${index}" style="padding: 2px 6px; background: #d16969; color: white; border: none; cursor: pointer; font-size: 11px;">🗑️</button>
                        </div>
                    </div>
                `}).join('')}
            </div>
        `;
    }

    /**
     * Render the composer UI
     */
    render() {
        const friendlyKeyName = this.getFriendlyKeyName();

        this.innerHTML = `
            <div style="background: #2d2d2d; padding: 15px; margin: 10px 0; border-left: 3px solid #569cd6;">
                <h3 style="margin: 0 0 10px 0; color: #569cd6;">🎹 Composer</h3>

                <!-- Section Controls -->
                ${this.renderSectionControls()}

                <!-- Section List -->
                ${this.renderSectionList()}

                <!-- Piano Keyboard Grid -->
                <div style="margin-bottom: 15px; padding: 10px; background: #1e1e1e; border-radius: 4px; overflow-x: auto;">
                    <div style="margin-bottom: 5px; font-size: 0.9em; color: #888;">
                        <span style="display: inline-block; width: 12px; height: 12px; background: #00cc88; border-radius: 2px; vertical-align: middle;"></span> Current Pool
                        <span style="margin-left: 10px; display: inline-block; width: 12px; height: 12px; background: #ffcc00; border-radius: 50%; vertical-align: middle;"></span> Current Chord Root
                        <span style="margin-left: 15px; color: #569cd6; font-weight: bold;">${friendlyKeyName}</span>
                        <span style="margin-left: 5px; color: #666; font-size: 0.85em;">(${this.poolKey || '0'}/${this.tonicName || 'C'})</span>
                    </div>
                    <div id="keyboard-grid">
                        ${this.renderKeyboardGrid()}
                    </div>
                </div>

                <!-- Progression Settings -->
                <div style="margin-bottom: 10px;">
                    <strong>Style ${this.getTargetLightHTML('progressionStyle')}:</strong>
                    <select id="style-select">
                        ${this.renderStyleOptions()}
                    </select>
                    <strong style="margin-left: 15px;">Length ${this.getTargetLightHTML('progressionLength')}:</strong>
                    <input type="number" id="progression-length-input" value="${this.progressionLength}" min="2" max="16" style="width: 50px;">
                    <button id="regenerate-btn" style="margin-left: 10px;">Regenerate</button>
                </div>

                <!-- Manual Progression Entry -->
                <div style="margin-bottom: 10px;">
                    <strong>Manual Entry:</strong>
                    <input type="text" id="manual-progression-input"
                           placeholder="e.g., C#m7 F#m7 G#m7 A7"
                           style="width: 300px; padding: 4px; font-family: monospace;">
                    <button id="set-manual-progression-btn" style="margin-left: 5px;">Set Progression</button>
                    <span style="color: #888; font-size: 0.85em; margin-left: 10px;">Space-separated chord symbols</span>
                </div>

                <div style="margin-bottom: 10px;">
                    <strong>Bars per Chord ${this.getTargetLightHTML('barsPerChord')}:</strong>
                    <select id="bars-per-chord-select" style="padding: 4px;">
                        ${this.renderBarsPerChordOptions()}
                    </select>
                    <strong style="margin-left: 15px;">Voicing ${this.getTargetLightHTML('voicingType')}:</strong>
                    <select id="voicing-select">
                        ${this.renderVoicingOptions()}
                    </select>
                </div>

                <!-- Text Progression Display -->
                <div style="margin-bottom: 10px;">
                    <strong>Progression:</strong>
                    <div id="progression-display" style="font-family: monospace; padding: 10px; background: #1e1e1e; border-radius: 4px; font-size: 14px;">
                        ${this.renderProgressionDisplay()}
                    </div>
                </div>

                <!-- Navigation -->
                <div>
                    <button id="prev-chord-btn">← Previous</button>
                    <button id="next-chord-btn">Next →</button>
                </div>
            </div>
        `;

        this.setupEventHandlers();

        // Re-render target lights after DOM update
        requestAnimationFrame(() => {
            this.renderTargetLights();
        });
    }

    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        // Section mode selector
        const modeSelect = this.$('#section-mode-select');
        if (modeSelect) {
            modeSelect.onchange = (e) => {
                this.sectionMode = e.target.value;
                this.saveSections();
                this.render();
            };
        }

        // Section navigation
        const prevSectionBtn = this.$('#prev-section-btn');
        if (prevSectionBtn) {
            prevSectionBtn.onclick = () => this.previousSection();
        }

        const nextSectionBtn = this.$('#next-section-btn');
        if (nextSectionBtn) {
            nextSectionBtn.onclick = () => this.nextSection();
        }

        // Capture section
        const captureBtn = this.$('#capture-section-btn');
        if (captureBtn) {
            captureBtn.onclick = async () => {
                const name = prompt('Section name:', `Section ${this.sections.length + 1}`);
                if (name) {
                    // Check if a section with this name already exists
                    const existingIndex = this.sections.findIndex(s => s.name === name);

                    if (existingIndex >= 0) {
                        // Section with this name exists - warn user
                        const overwrite = confirm(
                            `A section named "${name}" already exists.\n\n` +
                            `Click OK to overwrite the existing section, or Cancel to enter a different name.`
                        );

                        if (overwrite) {
                            // Overwrite existing section (await async operation)
                            await this.overwriteSection(existingIndex, name);
                        }
                        // If not confirmed, do nothing (user can try again with different name)
                    } else {
                        // New section - create it (await async operation)
                        await this.captureCurrentStateAsSection(name);
                    }
                }
            };
        }

        // Section item clicks (load section)
        this.querySelectorAll('.section-item').forEach(item => {
            item.onclick = (e) => {
                // Don't trigger if clicking edit or delete button
                if (e.target.classList.contains('delete-section-btn') ||
                    e.target.classList.contains('edit-section-btn')) {
                    return;
                }
                const index = parseInt(item.dataset.sectionIndex);
                this.loadSection(index);
            };
        });

        // Edit section buttons
        this.querySelectorAll('.edit-section-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.sectionIndex);
                this.editSection(index);
            };
        });

        // Delete section buttons
        this.querySelectorAll('.delete-section-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.sectionIndex);
                const section = this.sections[index];
                if (confirm(`Delete section "${section.name}"?`)) {
                    this.deleteSection(index);
                }
            };
        });

        // Drag/drop reordering for sections
        let draggedSectionIndex = null;

        this.querySelectorAll('.section-item').forEach(item => {
            // Dragstart - store which section is being dragged
            item.addEventListener('dragstart', (e) => {
                draggedSectionIndex = parseInt(item.dataset.sectionIndex);
                item.style.opacity = '0.4';
                e.dataTransfer.effectAllowed = 'move';
            });

            // Dragend - reset opacity
            item.addEventListener('dragend', (e) => {
                item.style.opacity = '1';
                draggedSectionIndex = null;
            });

            // Dragover - allow drop by preventing default
            item.addEventListener('dragover', (e) => {
                if (e.preventDefault) {
                    e.preventDefault();
                }
                e.dataTransfer.dropEffect = 'move';

                // Visual feedback: add border highlight
                item.style.borderTop = '2px solid #4ec9b0';
                return false;
            });

            // Dragleave - remove border highlight
            item.addEventListener('dragleave', (e) => {
                item.style.borderTop = '';
            });

            // Drop - reorder sections
            item.addEventListener('drop', (e) => {
                if (e.stopPropagation) {
                    e.stopPropagation();
                }

                item.style.borderTop = '';

                const dropIndex = parseInt(item.dataset.sectionIndex);

                if (draggedSectionIndex !== null && draggedSectionIndex !== dropIndex) {
                    // Perform the reorder
                    this.reorderSection(draggedSectionIndex, dropIndex);
                }

                return false;
            });
        });

        // Progression controls
        this.$('#style-select').onchange = (e) => {
            this.setProgressionStyle(e.target.value);
            // No render() - setProgressionStyle() already updates dropdown and progression display
        };

        this.$('#regenerate-btn').onclick = () => {
            this.generateNewProgression();
            this.render();
        };

        // Manual progression entry
        const manualProgressionInput = this.$('#manual-progression-input');
        const setManualBtn = this.$('#set-manual-progression-btn');
        if (manualProgressionInput && setManualBtn) {
            setManualBtn.onclick = () => {
                const text = manualProgressionInput.value.trim();
                if (text) {
                    this.setManualProgression(text);
                }
            };

            // Also allow Enter key
            manualProgressionInput.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    const text = manualProgressionInput.value.trim();
                    if (text) {
                        this.setManualProgression(text);
                    }
                }
            };
        }

        this.$('#progression-length-input').onchange = (e) => {
            const newLength = parseInt(e.target.value);
            this.setProgressionLength(newLength);
        };

        this.$('#bars-per-chord-select').onchange = (e) => {
            this.barsPerChord = parseFloat(e.target.value);
            console.log(`Composer: Bars per chord set to ${this.barsPerChord}`);
        };

        this.$('#voicing-select').onchange = (e) => {
            this.setVoicingType(e.target.value);
        };

        this.$('#prev-chord-btn').onclick = () => {
            this.progressionIndex = (this.progressionIndex - 1 + this.progression.length) % this.progression.length;
            this.publishCurrentChord();
            this.updateProgressionDisplay(); // Update UI efficiently
        };

        this.$('#next-chord-btn').onclick = () => {
            this.advanceChord();
            // advanceChord already calls updateProgressionDisplay
        };
    }

    // UI rendering helpers

    renderStyleOptions() {
        const styles = [
            ['jazz', 'Jazz (I-vi-ii-V)'],
            ['jazz-251', 'Jazz 2-5-1'],
            ['blues', 'Blues (12-bar)'],
            ['pop', 'Pop (I-V-vi-IV)'],
            ['pop-alternative', 'Pop Alt (vi-IV-I-V)'],
            ['folk', 'Folk'],
            ['modal', 'Modal'],
            ['coltrane', 'Coltrane Changes']
        ];
        return styles.map(([value, label]) =>
            `<option value="${value}" ${value === this.progressionStyle ? 'selected' : ''}>${label}</option>`
        ).join('');
    }

    renderBarsPerChordOptions() {
        const options = [
            [8, '8 bars'],
            [7, '7 bars'],
            [6, '6 bars'],
            [5, '5 bars'],
            [4, '4 bars'],
            [3, '3 bars'],
            [2, '2 bars'],
            [1, '1 bar'],
            [0.5, '2 beats'],
            [0.25, '1 beat']
        ];
        return options.map(([value, label]) =>
            `<option value="${value}" ${value === this.barsPerChord ? 'selected' : ''}>${label}</option>`
        ).join('');
    }

    renderVoicingOptions() {
        const voicings = [
            ['close', 'Close'],
            ['open', 'Open'],
            ['drop2', 'Drop 2'],
            ['shell', 'Shell']
        ];
        return voicings.map(([value, label]) =>
            `<option value="${value}" ${value === this.voicingType ? 'selected' : ''}>${label}</option>`
        ).join('');
    }

    renderProgressionDisplay() {
        if (this.progression.length === 0) {
            return '<em>No progression generated</em>';
        }

        return this.progression.map((chord, index) => {
            const isCurrent = index === this.progressionIndex;
            const style = isCurrent ? 'color: #4ec9b0; font-weight: bold;' : 'color: #d4d4d4;';
            return `<span style="${style}">${chord.symbol}</span>`;
        }).join(' → ');
    }
}

// Register custom element
customElements.define('sonofire-composer', SonofireComposer);
