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

        // Subscribe to key changes from Conductor
        this.subscribe('context:key', (data) => {
            this.handleKeyChange(data);
        });

        // Subscribe to pool/tonic changes (new system)
        this.subscribe('context:pool', (data) => {
            this.handlePoolChange(data);
        });

        // Subscribe to clock ticks to advance chords
        this.subscribe('clock:tick', (data) => {
            this.handleClockTick(data);
        });
    }

    /**
     * Register parameters as whip targets
     */
    registerWhippableParameters() {
        // Register barsPerChord parameter
        this.registerWhippableParameter('barsPerChord', {
            label: 'Bars Per Chord',
            parameterType: 'number',
            min: 1,
            max: 16,
            elementSelector: '#bars-per-chord-input',
            setter: (value) => {
                this.barsPerChord = Math.round(value);
                this.render();
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
                this.progressionLength = Math.round(value);
                this.generateProgressionProbabilistic();
                this.render();
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

        // Discover current context from PubSub (prefer pool/tonic)
        const poolContext = this.getLastValue('context:pool');
        if (poolContext) {
            this.poolKey = poolContext.poolKey;
            this.tonicNote = poolContext.tonicNote;
            this.tonicName = poolContext.tonicName;
        } else {
            // Fall back to legacy key context
            const keyContext = this.getLastValue('context:key');
            if (keyContext) {
                this.currentKey = keyContext.key;
                this.currentScale = keyContext.scale;
                // Extract pool info if available
                if (keyContext.poolKey) {
                    this.poolKey = keyContext.poolKey;
                }
            }
        }

        // Register whippable parameters (after render)
        this.registerWhippableParameters();

        // Generate initial progression
        this.generateNewProgression();
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
        this.poolKey = poolData.poolKey;
        this.tonicNote = poolData.tonicNote;
        this.tonicName = poolData.tonicName;

        console.log(`Composer: Pool/Tonic changed to ${this.poolKey}/${this.tonicName}`);

        // Regenerate progression in new pool/tonic
        this.generateNewProgression();

        // Update UI to reflect new pool/tonic
        this.updateProgressionDisplay();
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
     * Generate probabilistic chord progression based on harmonic function
     * @param {string} poolKey - Pool key (e.g., "3♯")
     * @param {number} startTonicNote - Starting tonic MIDI note
     * @param {string} style - Progression style (jazz, pop, blues, etc.)
     * @param {number} length - Number of chords
     * @returns {Array} Array of chord objects
     */
    generateProgressionProbabilistic(poolKey, startTonicNote, style, length) {
        const progression = [];

        // Start with degree 1 (tonic)
        // Pass startTonicNote as both the note to find AND the reference tonic (should always return 1)
        let currentDegree = harmonicContext.getScaleDegreeInPool(startTonicNote, poolKey, startTonicNote) || 1;
        let currentTonicNote = startTonicNote;

        for (let i = 0; i < length; i++) {
            // Get chord quality for this degree
            const quality = getChordQualityForDegreeInPool(currentDegree, 'major');

            // Create chord object
            const chord = {
                symbol: `${harmonicContext.midiToNoteName(currentTonicNote)}${quality}`,
                root: currentTonicNote,
                quality: quality,
                degree: currentDegree,
                poolKey: poolKey
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
        this.progressionIndex = (this.progressionIndex + 1) % this.progression.length;

        console.log(`Composer: Advanced to chord ${this.progressionIndex + 1}/${this.progression.length}`);

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
    }

    /**
     * Change progression style
     */
    setProgressionStyle(style) {
        this.progressionStyle = style;
        this.generateNewProgression();
    }

    /**
     * Change voicing type
     */
    setVoicingType(voicingType) {
        this.voicingType = voicingType;
        this.publishCurrentChord(); // Re-voice current chord
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
        const pitchClasses = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
        const noteNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
        const isSharp = [false, true, false, true, false, false, true, false, true, false, true, false];

        const keyWidth = 50;
        const keyHeight = 60;
        const svgWidth = keyWidth * 12;
        const svgHeight = 100;

        let svg = `<svg width="${svgWidth}" height="${svgHeight}" style="background: #1e1e1e;">`;

        pitchClasses.forEach((pc, i) => {
            const x = i * keyWidth;
            const y = isSharp[i] ? 10 : 30;  // Sharps offset upward
            const inPool = poolPitchClasses.includes(pc);
            const inCurrentChord = currentChordPitchClasses.includes(pc);
            const inNextChord = nextChordPitchClasses.includes(pc);

            // Colors based on state
            let fillColor;
            if (inCurrentChord) {
                fillColor = '#00cc88'; // Bright green for current chord notes
            } else if (inPool) {
                fillColor = '#4ec9b0'; // Cyan for pool notes not in chord
            } else {
                fillColor = '#3c3c3c'; // Dark gray for unavailable notes
            }

            // Add subtle highlight for next chord notes
            if (inNextChord && !inCurrentChord) {
                fillColor = '#5588cc'; // Blue tint for next chord notes
            }

            const strokeColor = '#1e1e1e';

            // Draw key rectangle
            svg += `<rect x="${x}" y="${y}" width="${keyWidth - 2}" height="${keyHeight}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2" rx="3"/>`;

            // Draw note label
            svg += `<text x="${x + keyWidth/2}" y="${y + keyHeight - 10}" text-anchor="middle" fill="#d4d4d4" font-size="12">${noteNames[i]}</text>`;

            // Draw tonic indicators (roots)
            if (currentTonic && currentTonic % 12 === pc) {
                // Green circle with R for current root
                svg += `<circle cx="${x + keyWidth/2}" cy="${y + 15}" r="10" fill="#ffcc00" opacity="0.9" stroke="#000" stroke-width="1"/>`;
                svg += `<text x="${x + keyWidth/2}" y="${y + 20}" text-anchor="middle" fill="#000" font-size="10" font-weight="bold">R</text>`;
            }
            if (nextTonic && nextTonic % 12 === pc && nextTonic % 12 !== currentTonic % 12) {
                // Blue arrow for next root (only if different from current)
                svg += `<circle cx="${x + keyWidth/2}" cy="${y + 40}" r="8" fill="#0080ff" opacity="0.8"/>`;
                svg += `<text x="${x + keyWidth/2}" y="${y + 45}" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold">→</text>`;
            }
        });

        svg += '</svg>';
        return svg;
    }

    /**
     * Render the composer UI
     */
    render() {
        this.innerHTML = `
            <div style="background: #2d2d2d; padding: 15px; margin: 10px 0; border-left: 3px solid #569cd6;">
                <h3 style="margin: 0 0 10px 0; color: #569cd6;">🎹 Composer</h3>

                <!-- Piano Keyboard Grid -->
                <div style="margin-bottom: 15px; padding: 10px; background: #1e1e1e; border-radius: 4px; overflow-x: auto;">
                    <div style="margin-bottom: 5px; font-size: 0.9em; color: #888;">
                        <span style="display: inline-block; width: 12px; height: 12px; background: #00cc88; border-radius: 2px; vertical-align: middle;"></span> Current Chord
                        <span style="margin-left: 10px; display: inline-block; width: 12px; height: 12px; background: #5588cc; border-radius: 2px; vertical-align: middle;"></span> Next Chord
                        <span style="margin-left: 10px; display: inline-block; width: 12px; height: 12px; background: #ffcc00; border-radius: 50%; vertical-align: middle;"></span> Root
                        <span style="margin-left: 15px;">Pool: ${this.poolKey || '0'}</span>
                    </div>
                    <div id="keyboard-grid">
                        ${this.renderKeyboardGrid()}
                    </div>
                </div>

                <!-- Progression Settings -->
                <div style="margin-bottom: 10px;">
                    <strong>Style:</strong>
                    <select id="style-select">
                        ${this.renderStyleOptions()}
                    </select>
                    <strong style="margin-left: 15px;">Length:</strong>
                    <input type="number" id="progression-length-input" value="${this.progressionLength}" min="2" max="16" style="width: 50px;">
                    <button id="regenerate-btn" style="margin-left: 10px;">Regenerate</button>
                </div>

                <div style="margin-bottom: 10px;">
                    <strong>Bars per Chord:</strong>
                    <input type="number" id="bars-per-chord-input" value="${this.barsPerChord}" min="1" max="16" style="width: 60px;">
                    <strong style="margin-left: 15px;">Voicing:</strong>
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
        this.$('#style-select').onchange = (e) => {
            this.setProgressionStyle(e.target.value);
            this.render(); // Re-render to show new progression
        };

        this.$('#regenerate-btn').onclick = () => {
            this.generateNewProgression();
            this.render();
        };

        this.$('#progression-length-input').onchange = (e) => {
            this.progressionLength = parseInt(e.target.value);
            console.log(`Composer: Progression length set to ${this.progressionLength}`);
        };

        this.$('#bars-per-chord-input').onchange = (e) => {
            this.barsPerChord = parseInt(e.target.value);
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
