import { SonofireBase } from '../base/sonofire_base.js';
import { WhippableParametersMixin } from '../../lib/mixins/whippable_parameters.js';
import { PubSub } from '../../lib/pubsub.js';

// Delay after section restore before accepting contour updates (prevents regeneration loop)
const SECTION_RESTORE_CONTOUR_IGNORE_MS = 50;
import { harmonicContext } from '../../lib/harmonic_context.js';
import { contourDragHandler } from '../../lib/contour_drag_handler.js';

/**
 * SonofireMelodyPlanner - Translates contour data into melodic phrases
 *
 * Features:
 * - Accepts contour input from layer bindings (square whip targets)
 * - Pool/Tonic selector (advanced notation: pool key + tonic note)
 * - Piano roll visualization (Y-axis = pitch, X-axis = time)
 * - Scale quantization (diatonic, chromatic, pentatonic, whole-tone, blues, etc.)
 * - Contour Y values → pitch height
 * - Contour X values → time position
 * - Publishes melody phrases to PubSub for soloist consumption
 * - Analyzes melody for chord tones → informs Composer
 */
export class SonofireMelodyPlanner extends WhippableParametersMixin(SonofireBase) {
    constructor() {
        super();

        // Pool/Tonic configuration
        this.poolKey = 0;  // 0-11 (number of sharps/flats in pool)
        this.tonicNote = 60;  // MIDI note number (middle C = 60)
        this.scaleType = 'diatonic';  // 'diatonic', 'chromatic', 'pentatonic', 'whole-tone', 'blues'

        // Time configuration
        this.phraseLength = 16;  // Number of steps in the phrase
        this.resolution = 16;  // Grid resolution (16th notes)

        // Contour inputs
        this.inputContour = null;  // Melody contour (square target)
        this.tonicCenterContour = null;  // Tonic center contour (square target)

        // Generated melody
        this.melody = {
            notes: [],  // Array of {step, pitch, velocity}
            scale: [],   // Quantized scale notes (MIDI numbers)
        };

        // WebAudio preview
        this.audioContext = null;
        this.isPlaying = false;
        this.playbackInterval = null;
        this.currentStep = 0;
    }

    static get observedAttributes() {
        return [
            ...super.observedAttributes,
            'data-pool-key',
            'data-tonic-note',
            'data-scale-type',
            'data-phrase-length'
        ];
    }

    parseAttributes() {
        super.parseAttributes();

        this.poolKey = parseInt(this.getAttribute('data-pool-key')) || 0;
        this.tonicNote = parseInt(this.getAttribute('data-tonic-note')) || 60;
        this.scaleType = this.getAttribute('data-scale-type') || 'diatonic';
        this.phraseLength = parseInt(this.getAttribute('data-phrase-length')) || 16;
    }

    setupSubscriptions() {
        super.setupSubscriptions();

        // Track section restore to ignore contour updates briefly after load
        PubSub.subscribe('section:loading:start', () => {
            this.ignoringContours = true;
        }, this);

        // After section loading completes, publish restored melody data
        // (Don't track this subscription - it controls other subscriptions)
        PubSub.subscribe('section:loading:complete', () => {
            if (this.melody && this.melody.notes && this.melody.notes.length > 0) {
                console.log('[MelodyPlanner] Publishing restored melody after section load');
                this.publishMelody();
            }

            // Ignore contour updates for a brief period to let things settle
            setTimeout(() => {
                this.ignoringContours = false;
                console.log('[MelodyPlanner] Now accepting contour updates');
            }, SECTION_RESTORE_CONTOUR_IGNORE_MS);
        }, this);

        // Subscribe to pool context changes
        this.subscribe('context:pool', (data) => {
            console.log('Melody Planner: Pool/tonic/scaleType changed, updating scale and regenerating melody');

            // Update pool/tonic/scaleType from context
            this.poolKey = data.poolKey;
            this.tonicNote = data.tonicNote;
            this.scaleType = data.scaleType || 'diatonic';

            // Update scale
            this.updateScale();

            // Regenerate melody if we have input data
            if (this.inputContour && this.tonicCenterContour) {
                this.generateMelodyFromContour();
                this.publishMelody();
            }

            // Re-render to show updated scale
            this.render();
        });
    }

    connectedCallback() {
        super.connectedCallback();

        // Register contour parameter for melody shape
        this.registerContourParameter('melody_input', {
            label: 'Melody Input',
            parameterType: 'contour',
            contourType: 'melody',
            setter: (contourData) => {
                this.setInputContour(contourData);
            }
        });

        // Register contour parameter for tonic center
        this.registerContourParameter('tonic_center', {
            label: 'Tonic Center',
            parameterType: 'contour',
            contourType: 'melody',
            setter: (contourData) => {
                this.setTonicCenterContour(contourData);
            }
        });

        // Discover current pool context
        const poolContext = this.getLastValue('context:pool');
        if (poolContext) {
            this.poolKey = poolContext.poolKey;
            this.tonicNote = poolContext.tonicNote;
            this.scaleType = poolContext.scaleType || 'diatonic';
        }

        // Generate initial scale
        this.updateScale();

        this.render();
    }

    /**
     * Set input contour and generate melody
     */
    setInputContour(contourData) {
        this.inputContour = contourData;

        console.log('Melody Planner: Received melody contour with', contourData.points?.length || 0, 'points');

        // Skip regeneration if we're ignoring contours (during section restore)
        if (this.ignoringContours) {
            return;
        }

        // Generate melody from contour (if we also have tonic center)
        if (this.tonicCenterContour) {
            this.generateMelodyFromContour();
            this.publishMelody();
        }

        // Re-render
        this.render();
    }

    /**
     * Set tonic center contour and generate melody
     */
    setTonicCenterContour(contourData) {
        this.tonicCenterContour = contourData;

        console.log('Melody Planner: Received tonic center contour with', contourData.points?.length || 0, 'points');

        // Skip regeneration if we're ignoring contours (during section restore)
        if (this.ignoringContours) {
            return;
        }

        // Generate melody from contour (if we also have melody input)
        if (this.inputContour) {
            this.generateMelodyFromContour();
            this.publishMelody();
        }

        // Re-render
        this.render();
    }

    /**
     * Update the scale based on pool/tonic settings
     * Only generate ONE OCTAVE of scale notes
     */
    updateScale() {
        // Get pool notes from harmonic context using poolKey
        const pool = harmonicContext.getNotePool(this.poolKey);

        // Extract unique pitch classes from pool
        const poolPitchClasses = [...new Set(pool.map(n => n % 12))];

        // Calculate intervals from tonic based on pool
        const tonicPC = this.tonicNote % 12;
        const poolIntervals = poolPitchClasses
            .map(pc => (pc - tonicPC + 12) % 12)
            .sort((a, b) => a - b);

        // Derive melody scale intervals based on scaleType
        let melodyIntervals;
        switch (this.scaleType) {
            case 'diatonic':
                // Use all 7 pool notes (standard diatonic)
                melodyIntervals = poolIntervals;
                break;
            case 'pentatonic':
                // Use 5 notes: root, 2nd, 3rd, 5th, 6th (intervals 0, 2, 4, 7, 9 in major)
                melodyIntervals = poolIntervals.filter((_, i) => [0, 1, 2, 4, 5].includes(i));
                break;
            case 'blues':
                // Pentatonic + tritone (flat 5th)
                const pentatonic = poolIntervals.filter((_, i) => [0, 1, 2, 4, 5].includes(i));
                const tritone = 6; // Flat 5th / augmented 4th
                melodyIntervals = [...pentatonic, tritone].sort((a, b) => a - b);
                break;
            case 'octatonic':
                // Alternating whole-half steps (8 notes)
                melodyIntervals = [0, 2, 3, 5, 6, 8, 9, 11]; // W-H-W-H-W-H-W-H
                break;
            case 'chromatic':
                // All 12 notes
                melodyIntervals = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
                break;
            default:
                melodyIntervals = poolIntervals;
        }

        // Generate scale for one octave starting from tonic
        this.melody.scale = melodyIntervals.map(interval => this.tonicNote + interval);

        // Calculate mode name
        const modeName = this.getModeName(poolIntervals);

        console.log(`Melody Planner: Updated scale - pool ${this.poolKey}, tonic ${harmonicContext.midiToNoteName(this.tonicNote)}, scaleType ${this.scaleType}, mode: ${modeName}, ${this.melody.scale.length} notes`);
    }

    /**
     * Get mode name from pool intervals
     * @param {Array<number>} intervals - Scale intervals relative to tonic
     * @returns {string} Mode name
     */
    getModeName(intervals) {
        // Match intervals to mode patterns
        const intervalString = JSON.stringify(intervals);

        const modes = {
            '[0,2,4,5,7,9,11]': 'Ionian (major)',
            '[0,2,3,5,7,9,10]': 'Dorian',
            '[0,1,3,5,7,8,10]': 'Phrygian',
            '[0,2,4,6,7,9,11]': 'Lydian',
            '[0,2,4,5,7,9,10]': 'Mixolydian',
            '[0,2,3,5,7,8,10]': 'Aeolian (minor)',
            '[0,1,3,5,6,8,10]': 'Locrian'
        };

        return modes[intervalString] || 'Custom';
    }

    /**
     * Generate melody from contour data
     *
     * Algorithm:
     * 1. Get melody values and tonic center values (both arrays)
     * 2. Calculate min/max range of melody values
     * 3. For each point, calculate difference: melody_value - tonic_center_value
     * 4. Map that difference to scale degrees using the melody range as scaling factor
     *
     * Example:
     * - Melody: [0, 8, 12, 17, 10, 9]
     * - Tonic center: [9, 9, 9, 9, 9, 9]
     * - Min/max: 0-17 (range = 17)
     * - Point 0: diff = 0 - 9 = -9 → map to scale degree
     * - Point 3: diff = 17 - 9 = +8 → map to scale degree
     */
    generateMelodyFromContour() {
        if (!this.inputContour || !this.inputContour.points || this.inputContour.points.length === 0) {
            this.melody.notes = [];
            return;
        }

        if (!this.tonicCenterContour || !this.tonicCenterContour.points || this.tonicCenterContour.points.length === 0) {
            this.melody.notes = [];
            console.warn('Melody Planner: Need both melody and tonic center contours');
            return;
        }

        const melodyPoints = this.inputContour.points;
        const tonicCenterPoints = this.tonicCenterContour.points;

        // scaleSize is the number of notes per octave:
        // - Diatonic: 7, Pentatonic: 5, Blues: 6, Octatonic: 8, Chromatic: 12
        const scaleSize = this.melody.scale.length;
        if (scaleSize === 0) {
            this.melody.notes = [];
            return;
        }

        // Get melody values
        const melodyValues = melodyPoints.map(p => p.y || p.value || 0);
        const melodyXValues = melodyPoints.map(p => p.x);

        // Calculate min/max of melody
        const minMelody = Math.min(...melodyValues);
        const maxMelody = Math.max(...melodyValues);
        const melodyRange = maxMelody - minMelody || 1;

        // Get tonic center values (resample if needed to match melody length)
        const tonicCenterValues = this.resampleTonicCenter(tonicCenterPoints, melodyPoints.length);

        // Calculate X range for time mapping
        const minX = Math.min(...melodyXValues);
        const maxX = Math.max(...melodyXValues);
        const xRange = maxX - minX || 1;

        // Calculate the range of differences (melody - tonic center)
        // Positive differences = melody above tonic
        // Negative differences = melody below tonic
        const differences = melodyPoints.map((point, i) =>
            melodyValues[i] - tonicCenterValues[i]
        );
        const minDifference = Math.min(...differences);
        const maxDifference = Math.max(...differences);
        const differenceRange = maxDifference - minDifference || 1;

        // Map contour points to melody notes
        const allNotes = melodyPoints.map((point, index) => {
            // Get melody value and corresponding tonic center value
            const melodyValue = melodyValues[index];
            const tonicCenterValue = tonicCenterValues[index];

            // Calculate difference (melody - tonic center)
            // Positive = above tonic, Negative = below tonic
            const difference = melodyValue - tonicCenterValue;

            // Map the full difference range to exactly one octave (scaleSize degrees)
            // with tonic center as degree 0
            // This works for ANY scale size:
            //   - Pentatonic (5): maps to 5 degrees
            //   - Blues (6): maps to 6 degrees
            //   - Diatonic (7): maps to 7 degrees
            //   - Octatonic (8): maps to 8 degrees
            //   - Chromatic (12): maps to 12 degrees
            // Directionality preserved:
            //   - All negative differences → octave extends below tonic (e.g., -7 to 0 for diatonic)
            //   - All positive differences → octave extends above tonic (e.g., 0 to 7 for diatonic)
            //   - Mixed differences → octave spans proportionally above/below tonic
            const scaleDegreeFloat = (difference / differenceRange) * scaleSize;

            // QUANTIZE to nearest scale degree (discrete grid)
            const scaleDegree = Math.round(scaleDegreeFloat);

            // Convert scale degree to pitch
            const pitch = this.scaleDegreeToPitch(scaleDegree);

            // Map X to time position (step)
            const normalizedX = (point.x - minX) / xRange;
            const step = Math.round(normalizedX * (this.phraseLength - 1));

            // Velocity based on distance from tonic (notes near tonic = stronger gravity)
            const distanceFromTonic = Math.abs(scaleDegree);
            const baseVelocity = 80;
            const gravityBoost = Math.max(0, 20 * (1 - distanceFromTonic / scaleSize));
            const velocity = Math.floor(baseVelocity + gravityBoost);

            return {
                step,
                pitch,
                velocity,
                originalY: melodyValue,
                tonicCenter: tonicCenterValue,
                scaleDegree: scaleDegree,  // Quantized integer degree
                scaleDegreeFloat: scaleDegreeFloat,  // For contour overlay
                distanceFromStepCenter: Math.abs(normalizedX * (this.phraseLength - 1) - step)  // For deduplication
            };
        });

        // DEDUPLICATE: Keep only one note per time step
        // If multiple notes map to same step, keep the one closest to the step center
        const notesByStep = new Map();
        allNotes.forEach(note => {
            const existing = notesByStep.get(note.step);
            if (!existing || note.distanceFromStepCenter < existing.distanceFromStepCenter) {
                notesByStep.set(note.step, note);
            }
        });

        // Convert back to array and sort by step
        this.melody.notes = Array.from(notesByStep.values());
        this.melody.notes.sort((a, b) => a.step - b.step);

        console.log(`Melody Planner: Generated ${this.melody.notes.length} notes | Melody range: ${minMelody.toFixed(1)}-${maxMelody.toFixed(1)} | Avg tonic center: ${(tonicCenterValues.reduce((a,b) => a+b, 0) / tonicCenterValues.length).toFixed(1)}`);
    }

    /**
     * Resample tonic center contour to match melody point count
     */
    resampleTonicCenter(tonicCenterPoints, targetLength) {
        if (tonicCenterPoints.length === 0) return [];
        if (tonicCenterPoints.length === targetLength) {
            return tonicCenterPoints.map(p => p.y || p.value || 0);
        }

        const values = tonicCenterPoints.map(p => p.y || p.value || 0);
        const resampled = [];

        for (let i = 0; i < targetLength; i++) {
            const position = (i / (targetLength - 1)) * (values.length - 1);
            const index = Math.floor(position);
            const nextIndex = Math.min(index + 1, values.length - 1);
            const fraction = position - index;

            // Linear interpolation
            const value1 = values[index];
            const value2 = values[nextIndex];
            const interpolated = value1 + (value2 - value1) * fraction;

            resampled.push(interpolated);
        }

        return resampled;
    }

    /**
     * Convert scale degree to MIDI pitch
     * Scale degree 0 = tonic, 1 = second scale degree, etc.
     * Negative values go down from tonic, positive go up
     */
    scaleDegreeToPitch(scaleDegree) {
        const scaleSize = this.melody.scale.length;
        if (scaleSize === 0) return this.tonicNote;

        // Determine octave offset and position within scale
        const octaveOffset = Math.floor(scaleDegree / scaleSize);
        const degreeInOctave = Math.floor(scaleDegree) % scaleSize;
        const positiveIndex = degreeInOctave < 0 ? scaleSize + degreeInOctave : degreeInOctave;

        // Get the pitch from the scale
        const pitchInBaseOctave = this.melody.scale[positiveIndex];
        const pitch = pitchInBaseOctave + (octaveOffset * 12);

        return pitch;
    }

    /**
     * Publish melody to PubSub for soloist consumption
     */
    publishMelody() {
        // Publish for instrumentalists (existing)
        PubSub.publish('melody:phrase', {
            notes: this.melody.notes,
            scale: this.melody.scale,
            poolKey: this.poolKey,
            tonicNote: this.tonicNote,
            scaleType: this.scaleType,
            phraseLength: this.phraseLength
        });

        // Publish as contour output for binding to Composer
        // Convert melody notes to contour format (x, y points)
        const contourPoints = this.melody.notes.map(note => ({
            x: note.step,  // Time position
            y: note.pitch  // MIDI note number
        }));

        const componentId = this.getComponentId();
        PubSub.publish(`contour:melody-planner-${componentId}:output`, {
            type: 'contour',
            points: contourPoints,
            sourceId: `melody-planner-${componentId}`,
            color: '#9b59b6'  // Melody planner color
        });

        console.log('Melody phrase published:', this.melody);
        console.log('Melody contour output published:', contourPoints.length, 'points');
    }

    /**
     * Render the component
     */
    render() {
        this.innerHTML = `
            <div class="sf-component sf-component-melody">
                <h3 class="sf-component-header sf-component-header-melody">Melody Planner</h3>

                ${this.renderControls()}
                ${this.renderPianoRoll()}

                <!-- Input/Output -->
                <div style="margin-top: 10px; display: flex; gap: 30px; align-items: center;" class="sf-text-primary">
                    <div style="display: flex; gap: 20px;">
                        <div>
                            <strong>Inputs:</strong>
                            Melody Shape ${this.getContourTargetHTML('melody_input')}
                            | Tonic Center ${this.getContourTargetHTML('tonic_center')}
                        </div>
                    </div>
                    <div style="border-left: 1px solid #555; padding-left: 20px;">
                        <strong>Output:</strong>
                        Melody
                        <span class="melody-output-source"
                              data-source-id="melody-planner-${this.getComponentId()}"
                              style="
                                  display: inline-block;
                                  width: 12px;
                                  height: 12px;
                                  background: #9b59b6;
                                  border: 1px solid #fff;
                                  margin-left: 5px;
                                  cursor: move;
                                  vertical-align: middle;
                              "
                              title="Drag to Composer's Melody Input to create binding">
                        </span>
                        <span style="margin-left: 5px; color: #888; font-size: 0.9em;">
                            (${this.melody.notes.length} notes)
                        </span>
                    </div>
                </div>
            </div>
        `;

        this.setupEventHandlers();

        // Sync contour target light colors after render
        requestAnimationFrame(() => {
            this.syncContourTargetLightColors();
        });
    }

    /**
     * Render control panel
     */
    renderControls() {
        return `
            <div class="sf-controls">
                <!--span class="sf-info-text">
                    Pool/Tonic/Scale Type controlled by Conductor
                </span-->
                <table>
                    <tr>
                        <th>Phrase Length</th>
                        <th></th>
                    </tr>
                    <tr>
                        <td>
                            <label class="sf-label">
                                <input type="number" id="phrase-length-input" value="${this.phraseLength}" min="4" max="64" class="sf-input">
                            </label>
                            <button id="regenerate-melody-btn" class="sf-button sf-button-melody">
                                Regenerate
                            </button>
                        </td>
                        <td style='text-align:right;'>
                            <button id="preview-melody-btn" class="sf-button ${this.isPlaying ? 'sf-button-danger' : 'sf-button-success'}">
                                ${this.isPlaying ? '⏹ Stop' : '▶ Preview'}
                            </button>
                        </td>
                    </tr>
                </table>


            </div>
        `;
    }

    /**
     * Render piano roll visualization
     * Shows scale degrees (intervals from tonic), not chromatic pitches
     */
    renderPianoRoll() {
        if (!this.inputContour) {
            return `<div style="color: #888; padding: 20px; text-align: center;">
                No melody input. Drag a layer's square source to "Melody Shape" above.
            </div>`;
        }

        if (!this.tonicCenterContour) {
            return `<div style="color: #888; padding: 20px; text-align: center;">
                No tonic center input. Drag a layer's square source to "Tonic Center" above.
            </div>`;
        }

        if (this.melody.notes.length === 0) {
            return `<div style="color: #888; padding: 20px; text-align: center;">
                No melody generated yet.
            </div>`;
        }

        const stepWidth = 30;
        const degreeHeight = 20;  // Height per scale degree (increased for better visibility)
        const scaleSize = this.melody.scale.length;

        // Calculate the actual range of scale degrees from the data
        // This ensures the piano roll scales dynamically to fit the melody
        // whether it extends above or below the tonic center
        const scaleDegrees = this.melody.notes.map(n => n.scaleDegree);
        const minDegreeInData = Math.min(...scaleDegrees);
        const maxDegreeInData = Math.max(...scaleDegrees);

        // Add padding of 1 degree on each side for visual clarity
        const minDegree = minDegreeInData - 1;
        const maxDegree = maxDegreeInData + 1;

        // Calculate how many degree positions to show
        const degreesToShow = maxDegree - minDegree + 1;
        const rollWidth = this.phraseLength * stepWidth + 120;
        const rollHeight = degreesToShow * degreeHeight + 60;

        // Create note map for quick lookup
        const noteMap = new Map();
        this.melody.notes.forEach(note => {
            if (!noteMap.has(note.step)) {
                noteMap.set(note.step, []);
            }
            noteMap.get(note.step).push(note);
        });

        return `
            <div class="piano-roll" style="margin-top: 15px; overflow-x: auto;">
                <div style="margin-bottom: 5px; color: #888; font-size: 11px;">
                    <strong>Melodic Phrase (Scale Degrees):</strong>
                    <span style="color: ${this.inputContour.color}">● Melody Contour (${this.inputContour.points.length})</span> |
                    <span style="color: ${this.tonicCenterContour.color}">● Tonic Center (${this.tonicCenterContour.points.length})</span> |
                    <span style="color: #9b59b6">█ Quantized Notes (${this.melody.notes.length})</span> |
                    <span style="color: #4ec9b0">═ Tonic (0)</span>
                    <br>
                    <em>Scale degree = (melody value - tonic center value) × scaling factor</em>
                </div>
                <svg width="${rollWidth}" height="${rollHeight}">
                    <!-- Scale degree labels (left side) -->
                    ${this.renderScaleDegreeLabels(degreeHeight, minDegree, maxDegree, scaleSize)}

                    <!-- Grid -->
                    ${this.renderScaleDegreeGrid(stepWidth, degreeHeight, minDegree, maxDegree)}

                    <!-- Tonic line -->
                    ${this.renderTonicLine(stepWidth, degreeHeight, minDegree, maxDegree, scaleSize)}

                    <!-- Input contour overlays (melody and tonic center) -->
                    ${this.renderContourOverlayScaleDegrees(stepWidth, degreeHeight, minDegree, maxDegree, scaleSize)}
                    ${this.renderTonicCenterOverlay(stepWidth, degreeHeight, minDegree, maxDegree, scaleSize)}

                    <!-- Melody notes -->
                    ${this.renderMelodyNotesScaleDegrees(stepWidth, degreeHeight, noteMap, minDegree, maxDegree, scaleSize)}

                    <!-- Time markers -->
                    ${this.renderTimeMarkersScaleDegrees(stepWidth, degreeHeight, minDegree, maxDegree)}
                </svg>
            </div>
        `;
    }

    /**
     * Render scale degree labels on the left
     * Shows the actual range of degrees present in the data
     */
    renderScaleDegreeLabels(degreeHeight, minDegree, maxDegree, scaleSize) {
        // Use flats for pools with flats, otherwise sharps
        const useFlats = typeof this.poolKey === 'string' && this.poolKey.includes('♭');
        const noteNames = useFlats
            ? ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']
            : ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
        const labels = [];

        // Show degrees from max down to min (top to bottom on screen)
        for (let degree = maxDegree; degree >= minDegree; degree--) {
            const yIndex = maxDegree - degree;
            const y = yIndex * degreeHeight;

            const isTonic = degree === 0;
            const degreeInScale = ((degree % scaleSize) + scaleSize) % scaleSize;
            const pitch = this.melody.scale[degreeInScale];
            const noteName = noteNames[pitch % 12];

            labels.push(`
                <rect
                    x="0"
                    y="${y}"
                    width="90"
                    height="${degreeHeight}"
                    fill="${isTonic ? '#4ec9b0' : '#3c3c3c'}"
                    stroke="#555"
                    stroke-width="1"
                    opacity="${isTonic ? 0.3 : 1}"
                />
                <text
                    x="5"
                    y="${y + degreeHeight - 5}"
                    fill="${isTonic ? '#4ec9b0' : '#d4d4d4'}"
                    font-size="10"
                    font-weight="${isTonic ? 'bold' : 'normal'}"
                >
                    ${degree >= 0 ? '+' : ''}${degree} (${noteName})
                </text>
            `);
        }

        return labels.join('');
    }

    /**
     * Render grid background for scale degrees
     */
    renderScaleDegreeGrid(stepWidth, degreeHeight, minDegree, maxDegree) {
        const grid = [];
        const gridStartX = 90;
        const degreesToShow = maxDegree - minDegree + 1;

        // Horizontal lines (one per scale degree)
        for (let i = 0; i <= degreesToShow; i++) {
            const y = i * degreeHeight;
            grid.push(`
                <line
                    x1="${gridStartX}"
                    y1="${y}"
                    x2="${this.phraseLength * stepWidth + gridStartX}"
                    y2="${y}"
                    stroke="#555"
                    stroke-width="0.5"
                />
            `);
        }

        // Vertical lines (one per time step)
        for (let step = 0; step <= this.phraseLength; step++) {
            const x = step * stepWidth + gridStartX;
            grid.push(`
                <line
                    x1="${x}"
                    y1="0"
                    x2="${x}"
                    y2="${degreesToShow * degreeHeight}"
                    stroke="#555"
                    stroke-width="${step % 4 === 0 ? 1 : 0.5}"
                />
            `);
        }

        return grid.join('');
    }

    /**
     * Render prominent line at tonic (degree 0)
     */
    renderTonicLine(stepWidth, degreeHeight, minDegree, maxDegree, scaleSize) {
        const gridStartX = 90;

        // Calculate tonic Y position (degree 0)
        const tonicYIndex = maxDegree - 0;  // degree 0 = tonic
        const tonicY = tonicYIndex * degreeHeight;

        return `
            <line
                x1="${gridStartX}"
                y1="${tonicY}"
                x2="${this.phraseLength * stepWidth + gridStartX}"
                y2="${tonicY}"
                stroke="#4ec9b0"
                stroke-width="2"
                opacity="0.5"
            />
        `;
    }

    /**
     * Render input contour overlay mapped to scale degrees
     * Uses same algorithm as generateMelodyFromContour
     */
    renderContourOverlayScaleDegrees(stepWidth, degreeHeight, minDegree, maxDegree, scaleSize) {
        const melodyPoints = this.inputContour.points;
        if (!melodyPoints || melodyPoints.length === 0) return '';
        if (!this.tonicCenterContour || !this.tonicCenterContour.points) return '';

        const gridStartX = 90;

        // Get melody values
        const melodyValues = melodyPoints.map(p => p.y || p.value || 0);
        const melodyXValues = melodyPoints.map(p => p.x);

        // Get tonic center values (resampled to match melody length)
        const tonicCenterValues = this.resampleTonicCenter(this.tonicCenterContour.points, melodyPoints.length);

        // Calculate X range
        const minX = Math.min(...melodyXValues);
        const maxX = Math.max(...melodyXValues);
        const xRange = maxX - minX || 1;

        // Calculate the range of differences (same as in generateMelodyFromContour)
        const differences = melodyPoints.map((point, i) =>
            melodyValues[i] - tonicCenterValues[i]
        );
        const minDifference = Math.min(...differences);
        const maxDifference = Math.max(...differences);
        const differenceRange = maxDifference - minDifference || 1;

        const pathData = melodyPoints.map((point, i) => {
            const normalizedX = (point.x - minX) / xRange;
            const x = normalizedX * (this.phraseLength - 1) * stepWidth + gridStartX + stepWidth/2;

            // Calculate difference (melody relative to tonic center)
            const melodyValue = melodyValues[i];
            const tonicCenterValue = tonicCenterValues[i];
            const difference = melodyValue - tonicCenterValue;

            // Map difference to scale degrees (SAME as in generateMelodyFromContour)
            // This preserves directionality: positive = above tonic, negative = below
            const scaleDegreeFloat = (difference / differenceRange) * scaleSize;

            // Convert to Y position (maxDegree at top, minDegree at bottom)
            const yIndex = maxDegree - scaleDegreeFloat;
            const y = yIndex * degreeHeight + degreeHeight/2;

            return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
        }).join(' ');

        return `
            <g opacity="0.3">
                <path
                    d="${pathData}"
                    fill="none"
                    stroke="${this.inputContour.color}"
                    stroke-width="2"
                />
                ${melodyPoints.map((point, i) => {
                    const normalizedX = (point.x - minX) / xRange;
                    const x = normalizedX * (this.phraseLength - 1) * stepWidth + gridStartX + stepWidth/2;

                    const melodyValue = melodyValues[i];
                    const tonicCenterValue = tonicCenterValues[i];
                    const difference = melodyValue - tonicCenterValue;

                    // Map to scale degrees (continuous)
                    const scaleDegreeFloat = (difference / differenceRange) * scaleSize;
                    const yIndex = maxDegree - scaleDegreeFloat;
                    const y = yIndex * degreeHeight + degreeHeight/2;

                    return `
                        <circle
                            cx="${x}"
                            cy="${y}"
                            r="3"
                            fill="${this.inputContour.color}"
                        />
                    `;
                }).join('')}
            </g>
        `;
    }

    /**
     * Render tonic center contour overlay
     * Shows where the tonic center sits (should be at degree 0 since we calculate differences)
     */
    renderTonicCenterOverlay(stepWidth, degreeHeight, minDegree, maxDegree, scaleSize) {
        if (!this.tonicCenterContour || !this.tonicCenterContour.points || this.tonicCenterContour.points.length === 0) {
            return '';
        }

        const gridStartX = 90;
        const points = this.tonicCenterContour.points;

        // Resample to match melody length for consistent X positions
        const melodyLength = this.inputContour.points.length;
        const tonicCenterValues = this.resampleTonicCenter(points, melodyLength);

        const xValues = this.inputContour.points.map(p => p.x);
        const minX = Math.min(...xValues);
        const maxX = Math.max(...xValues);
        const xRange = maxX - minX || 1;

        // Calculate tonic Y position (degree 0)
        const tonicYIndex = maxDegree - 0;  // degree 0 = tonic
        const tonicY = tonicYIndex * degreeHeight + degreeHeight/2;

        const pathPoints = this.inputContour.points.map((point, i) => {
            const normalizedX = (point.x - minX) / xRange;
            const x = normalizedX * (this.phraseLength - 1) * stepWidth + gridStartX + stepWidth/2;
            return `${i === 0 ? 'M' : 'L'} ${x} ${tonicY}`;
        }).join(' ');

        return `
            <g opacity="0.3">
                <path
                    d="${pathPoints}"
                    fill="none"
                    stroke="${this.tonicCenterContour.color}"
                    stroke-width="2"
                    stroke-dasharray="4,4"
                />
                ${this.inputContour.points.map((point, i) => {
                    const normalizedX = (point.x - minX) / xRange;
                    const x = normalizedX * (this.phraseLength - 1) * stepWidth + gridStartX + stepWidth/2;

                    return `
                        <circle
                            cx="${x}"
                            cy="${tonicY}"
                            r="2"
                            fill="${this.tonicCenterContour.color}"
                        />
                    `;
                }).join('')}
            </g>
        `;
    }

    /**
     * Render melody notes on scale degree grid
     * Notes are QUANTIZED to discrete scale degrees and align perfectly to grid rows
     */
    renderMelodyNotesScaleDegrees(stepWidth, degreeHeight, noteMap, minDegree, maxDegree, scaleSize) {
        const gridStartX = 90;
        const notes = [];

        for (let step = 0; step < this.phraseLength; step++) {
            const stepNotes = noteMap.get(step) || [];

            stepNotes.forEach(note => {
                const x = step * stepWidth + gridStartX;

                // Note.scaleDegree is already quantized (integer)
                // Convert to Y position (maxDegree at top, minDegree at bottom)
                const yIndex = maxDegree - note.scaleDegree;
                const y = yIndex * degreeHeight;

                // Velocity determines opacity/brightness
                const opacity = note.velocity / 127;

                notes.push(`
                    <rect
                        x="${x + 2}"
                        y="${y + 1}"
                        width="${stepWidth - 4}"
                        height="${degreeHeight - 2}"
                        fill="#9b59b6"
                        opacity="${0.5 + opacity * 0.5}"
                        stroke="#d4d4d4"
                        stroke-width="1"
                        rx="2"
                    />
                `);
            });
        }

        return notes.join('');
    }

    /**
     * Render time markers for scale degree grid
     */
    renderTimeMarkersScaleDegrees(stepWidth, degreeHeight, minDegree, maxDegree) {
        const gridStartX = 90;
        const markers = [];
        const degreesToShow = maxDegree - minDegree + 1;
        const y = degreesToShow * degreeHeight + 15;

        for (let step = 0; step < this.phraseLength; step++) {
            markers.push(`
                <text
                    x="${step * stepWidth + gridStartX + stepWidth/2}"
                    y="${y}"
                    fill="#888"
                    font-size="10"
                    text-anchor="middle"
                >
                    ${step + 1}
                </text>
            `);
        }

        return markers.join('');
    }

    /**
     * Render grid background (OLD - chromatic pitch version, kept for reference)
     */
    renderGrid(stepWidth, pitchHeight) {
        const grid = [];

        // Horizontal lines
        for (let pitch = this.maxPitch; pitch >= this.minPitch; pitch--) {
            const y = (this.maxPitch - pitch) * pitchHeight;
            grid.push(`
                <line
                    x1="70"
                    y1="${y}"
                    x2="${this.phraseLength * stepWidth + 70}"
                    y2="${y}"
                    stroke="#555"
                    stroke-width="0.5"
                />
            `);
        }

        // Vertical lines
        for (let step = 0; step <= this.phraseLength; step++) {
            const x = step * stepWidth + 70;
            grid.push(`
                <line
                    x1="${x}"
                    y1="0"
                    x2="${x}"
                    y2="${(this.maxPitch - this.minPitch + 1) * pitchHeight}"
                    stroke="#555"
                    stroke-width="${step % 4 === 0 ? 1 : 0.5}"
                />
            `);
        }

        return grid.join('');
    }

    /**
     * Render input contour overlay
     */
    renderContourOverlay(stepWidth, pitchHeight) {
        const points = this.inputContour.points;
        if (!points || points.length === 0) return '';

        const xValues = points.map(e => e.x);
        const yValues = points.map(e => e.y || e.value || 0);
        const minX = Math.min(...xValues);
        const maxX = Math.max(...xValues);
        const xRange = maxX - minX || 1;
        const minY = Math.min(...yValues);
        const maxY = Math.max(...yValues);
        const yRange = maxY - minY || 1;

        const pathData = points.map((point, i) => {
            const normalizedX = (point.x - minX) / xRange;
            const x = normalizedX * (this.phraseLength - 1) * stepWidth + 70 + stepWidth/2;

            const normalizedY = (point.y - minY) / yRange;
            const pitch = this.minPitch + (normalizedY * (this.maxPitch - this.minPitch));
            const y = (this.maxPitch - pitch) * pitchHeight + pitchHeight/2;

            return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
        }).join(' ');

        return `
            <g opacity="0.3">
                <path
                    d="${pathData}"
                    fill="none"
                    stroke="${this.inputContour.color}"
                    stroke-width="2"
                />
                ${points.map(point => {
                    const normalizedX = (point.x - minX) / xRange;
                    const x = normalizedX * (this.phraseLength - 1) * stepWidth + 70 + stepWidth/2;

                    const normalizedY = (point.y - minY) / yRange;
                    const pitch = this.minPitch + (normalizedY * (this.maxPitch - this.minPitch));
                    const y = (this.maxPitch - pitch) * pitchHeight + pitchHeight/2;

                    return `
                        <circle
                            cx="${x}"
                            cy="${y}"
                            r="3"
                            fill="${this.inputContour.color}"
                        />
                    `;
                }).join('')}
            </g>
        `;
    }

    /**
     * Render melody notes
     */
    renderMelodyNotes(stepWidth, pitchHeight, noteMap) {
        const notes = [];

        for (let step = 0; step < this.phraseLength; step++) {
            const stepNotes = noteMap.get(step) || [];

            stepNotes.forEach(note => {
                const x = step * stepWidth + 70;
                const y = (this.maxPitch - note.pitch) * pitchHeight;

                // Velocity determines opacity/brightness
                const opacity = note.velocity / 127;

                notes.push(`
                    <rect
                        x="${x + 2}"
                        y="${y + 1}"
                        width="${stepWidth - 4}"
                        height="${pitchHeight - 2}"
                        fill="#9b59b6"
                        opacity="${0.5 + opacity * 0.5}"
                        stroke="#d4d4d4"
                        stroke-width="1"
                        rx="2"
                    />
                `);
            });
        }

        return notes.join('');
    }

    /**
     * Render time markers
     */
    renderTimeMarkers(stepWidth, pitchHeight) {
        const markers = [];
        const y = (this.maxPitch - this.minPitch + 1) * pitchHeight + 15;

        for (let step = 0; step < this.phraseLength; step++) {
            markers.push(`
                <text
                    x="${step * stepWidth + 70 + stepWidth/2}"
                    y="${y}"
                    fill="#888"
                    font-size="10"
                    text-anchor="middle"
                >
                    ${step + 1}
                </text>
            `);
        }

        return markers.join('');
    }

    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        // Pool/Tonic/ScaleType are now controlled by Conductor, not local selectors

        // Phrase length input
        const phraseLengthInput = this.$('#phrase-length-input');
        if (phraseLengthInput) {
            phraseLengthInput.onchange = (e) => {
                this.phraseLength = parseInt(e.target.value);
                this.generateMelodyFromContour();
                this.publishMelody();
                this.render();
            };
        }

        // Regenerate button
        const regenBtn = this.$('#regenerate-melody-btn');
        if (regenBtn) {
            regenBtn.onclick = () => {
                this.generateMelodyFromContour();
                this.publishMelody();
                this.render();
            };
        }

        // Preview button
        const previewBtn = this.$('#preview-melody-btn');
        if (previewBtn) {
            previewBtn.onclick = () => {
                if (this.isPlaying) {
                    this.stopPreview();
                } else {
                    this.startPreview();
                }
            };
        }

        // Melody output source (drag to create binding)
        const melodyOutputSource = this.root.querySelector('.melody-output-source');
        if (melodyOutputSource) {
            melodyOutputSource.onmousedown = (e) => {
                e.stopPropagation();

                const componentId = this.getComponentId();

                // Start contour binding drag with melody output
                contourDragHandler.startDrag(e, {
                    sourceType: 'melody-planner',
                    sourceId: `melody-planner-${componentId}`,
                    sourceTopic: `contour:melody-planner-${componentId}:output`,
                    color: '#9b59b6',
                    getData: () => {
                        // Return current melody as contour points
                        return {
                            type: 'contour',
                            points: this.melody.notes.map(note => ({
                                x: note.step,
                                y: note.pitch
                            })),
                            color: '#9b59b6'
                        };
                    }
                });
            };
        }
    }

    /**
     * Start WebAudio preview
     */
    startPreview() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        // Resume if suspended (browser autoplay policy)
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        this.isPlaying = true;
        this.currentStep = 0;

        // Calculate tempo (assume 120 BPM)
        const bpm = 120;
        const beatsPerBar = 4;
        const stepsPerBeat = this.phraseLength / beatsPerBar;
        const msPerStep = (60000 / bpm) / stepsPerBeat;

        // Create note map for quick lookup
        const notesByStep = new Map();
        this.melody.notes.forEach(note => {
            notesByStep.set(note.step, note);
        });

        // Schedule playback
        this.playbackInterval = setInterval(() => {
            const note = notesByStep.get(this.currentStep);
            if (note) {
                this.playMelodyNote(note.pitch, note.velocity);
            }

            this.currentStep++;
            if (this.currentStep >= this.phraseLength) {
                this.currentStep = 0;  // Loop
            }
        }, msPerStep);

        this.render();
    }

    /**
     * Stop WebAudio preview
     */
    stopPreview() {
        this.isPlaying = false;

        if (this.playbackInterval) {
            clearInterval(this.playbackInterval);
            this.playbackInterval = null;
        }

        this.currentStep = 0;
        this.render();
    }

    /**
     * Play a melody note using WebAudio
     */
    playMelodyNote(midiNote, velocity = 80) {
        if (!this.audioContext) return;

        const now = this.audioContext.currentTime;
        const frequency = 440 * Math.pow(2, (midiNote - 69) / 12);  // Convert MIDI to frequency

        // Simple sine wave oscillator
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(frequency, now);

        const normalizedVelocity = velocity / 127;
        gain.gain.setValueAtTime(normalizedVelocity * 0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

        osc.connect(gain);
        gain.connect(this.audioContext.destination);

        osc.start(now);
        osc.stop(now + 0.3);
    }

    /**
     * Cleanup on disconnect
     */
    disconnectedCallback() {
        super.disconnectedCallback();
        this.stopPreview();
    }
}

customElements.define('sonofire-melody-planner', SonofireMelodyPlanner);
