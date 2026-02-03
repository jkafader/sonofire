import { SonofireBase } from '../base/sonofire_base.js';
import { WhippableParametersMixin } from '../../lib/mixins/whippable_parameters.js';
import { PubSub } from '../../lib/pubsub.js';

// Delay after section restore before accepting contour updates (prevents regeneration loop)
const SECTION_RESTORE_CONTOUR_IGNORE_MS = 50;

/**
 * SonofireRhythmPlanner - Translates contour data into rhythmic patterns
 *
 * Features:
 * - Accepts contour input from layer bindings (square whip targets)
 * - User-configurable grid resolution (8th, 16th, 32nd notes)
 * - 6 density layers (Minimal → Maximum)
 * - Accent markers on high-amplitude hits
 * - Pattern-based density derivation (each layer adds more hits)
 * - Publishes patterns to PubSub for drummer consumption
 */
export class SonofireRhythmPlanner extends WhippableParametersMixin(SonofireBase) {
    constructor() {
        super();

        // Configuration
        this.gridResolution = 16;  // User-configurable: 8, 16, 32
        this.timeSignature = '4/4';
        this.bars = 1;  // How many bars to display
        this.interpretationMode = 'auto';  // 'auto', 'sparse', 'contour'

        // Contour input
        this.inputContour = null;

        // Generated pattern
        this.rhythmPattern = {
            layers: [
                { density: 0.0, pattern: [], label: 'Minimal', description: 'Kick 1&3, Snare 2&4' },
                { density: 0.2, pattern: [], label: 'Sparse', description: '+ Strong Peaks' },
                { density: 0.4, pattern: [], label: 'Light', description: '+ 8th Note Hi-Hat' },
                { density: 0.6, pattern: [], label: 'Medium', description: '+ All Peaks' },
                { density: 0.8, pattern: [], label: 'Dense', description: '+ 16th Note Hi-Hat' },
                { density: 1.0, pattern: [], label: 'Maximum', description: '+ Fills & Ghost Notes' }
            ],
            accents: []  // Boolean array for accents
        };

        // WebAudio preview
        this.audioContext = null;
        this.isPlaying = false;
        this.playbackInterval = null;
        this.currentStep = 0;
        this.previewDensityLayer = 3;  // Default to Medium
    }

    static get observedAttributes() {
        return [
            ...super.observedAttributes,
            'data-resolution',
            'data-time-signature',
            'data-bars'
        ];
    }

    parseAttributes() {
        super.parseAttributes();

        this.gridResolution = parseInt(this.getAttribute('data-resolution')) || 16;
        this.timeSignature = this.getAttribute('data-time-signature') || '4/4';
        this.bars = parseInt(this.getAttribute('data-bars')) || 1;
    }

    setupSubscriptions() {
        super.setupSubscriptions();

        // Track section restore to ignore contour updates briefly after load
        PubSub.subscribe('section:loading:start', () => {
            this.ignoringContours = true;
        }, this);

        // After section loading completes, publish restored rhythm data
        // (Don't track this subscription - it controls other subscriptions)
        PubSub.subscribe('section:loading:complete', () => {
            if (this.pattern && this.pattern.length > 0) {
                console.log('[RhythmPlanner] Publishing restored rhythm after section load');
                this.publishRhythm();
            }

            // Ignore contour updates for a brief period to let things settle
            setTimeout(() => {
                this.ignoringContours = false;
                console.log('[RhythmPlanner] Now accepting contour updates');
            }, SECTION_RESTORE_CONTOUR_IGNORE_MS);
        }, this);
    }

    connectedCallback() {
        super.connectedCallback();

        // Register contour parameter
        this.registerContourParameter('rhythm_input', {
            label: 'Rhythm Input',
            parameterType: 'contour',
            contourType: 'rhythm',
            setter: (contourData) => {
                this.setInputContour(contourData);
            }
        });

        this.render();
    }

    /**
     * Set input contour and regenerate pattern
     */
    setInputContour(contourData) {
        this.inputContour = contourData;

        console.log('Rhythm Planner: Received contour with', contourData.points?.length || 0, 'points');

        // Skip regeneration if we're ignoring contours (during section restore)
        if (this.ignoringContours) {
            return;
        }

        // Generate rhythm pattern from contour
        this.generatePatternFromContour();

        // Publish pattern
        this.publishPattern();

        // Re-render
        this.render();
    }

    /**
     * Generate rhythm pattern from contour data
     */
    generatePatternFromContour() {
        if (!this.inputContour || !this.inputContour.points || this.inputContour.points.length === 0) {
            // No contour - clear pattern
            this.rhythmPattern.layers.forEach(layer => layer.pattern = []);
            this.rhythmPattern.accents = [];
            this.resampledValues = null;
            this.eventPoints = null;
            return;
        }

        const contour = this.inputContour.points;
        const steps = this.gridResolution * this.bars;

        // Detect if this is sparse event data (like intersections) or dense contour data
        const isSparseEventData = this.isSparseEventData(contour, steps);

        if (isSparseEventData) {
            console.log('Rhythm Planner: Treating as sparse event data (e.g., intersections)');
            this.generatePatternFromEvents(contour, steps);
        } else {
            console.log('Rhythm Planner: Treating as dense contour data');
            this.generatePatternFromDenseContour(contour, steps);
        }
    }

    /**
     * Detect if input is sparse event data (like intersections) vs dense contour
     */
    isSparseEventData(contour, steps) {
        // Manual override
        if (this.interpretationMode === 'sparse') return true;
        if (this.interpretationMode === 'contour') return false;

        // Auto mode: if we have up to 1x the grid steps, treat as sparse events
        // Example: 16-step grid, < 16 points = sparse, >= 16 points = contour
        return contour.length <= steps;
    }

    /**
     * Generate pattern from sparse event data (intersections, peaks, etc.)
     * X position = when hit occurs, Y value = accent strength
     */
    generatePatternFromEvents(events, steps) {
        // Store event points for visualization
        this.eventPoints = events;
        this.resampledValues = null;

        // Get X range from events
        const xValues = events.map(e => e.x);
        const minX = Math.min(...xValues);
        const maxX = Math.max(...xValues);
        const xRange = maxX - minX || 1;

        // Map each event to a grid position
        const eventGridPositions = events.map(event => {
            const normalizedX = (event.x - minX) / xRange;
            const gridPosition = Math.round(normalizedX * (steps - 1));
            const magnitude = event.y || event.value || 0;
            return { gridPosition, magnitude, originalEvent: event };
        });

        // Calculate magnitude for accent marking
        const magnitudes = eventGridPositions.map(e => e.magnitude);
        const maxMagnitude = Math.max(...magnitudes);
        const minMagnitude = Math.min(...magnitudes);
        const magnitudeRange = maxMagnitude - minMagnitude || 1;

        // Beat subdivision helpers
        const beatsPerBar = 4;
        const stepsPerBeat = this.gridResolution / beatsPerBar;

        // Generate 6 density layers - all include events, but add progressively more beats
        this.rhythmPattern.layers.forEach((layer, layerIndex) => {
            const pattern = Array(steps).fill(false);

            // Always include all event positions in all layers
            eventGridPositions.forEach(({ gridPosition }) => {
                pattern[gridPosition] = true;
            });

            // Now add additional beats based on density layer
            switch(layerIndex) {
                case 0: // Minimal - only events
                    layer.description = 'Event hits only';
                    break;

                case 1: // Sparse - events + quarter notes (beats 1,2,3,4)
                    for (let beat = 0; beat < beatsPerBar * this.bars; beat++) {
                        const stepIndex = Math.floor(beat * stepsPerBeat);
                        if (stepIndex < steps) {
                            pattern[stepIndex] = true;
                        }
                    }
                    layer.description = '+ Quarter notes';
                    break;

                case 2: // Light - events + eighth notes
                    const eighthSteps = Math.max(1, Math.floor(this.gridResolution / 2));
                    for (let i = 0; i < steps; i += eighthSteps) {
                        pattern[i] = true;
                    }
                    layer.description = '+ Eighth notes';
                    break;

                case 3: // Medium - events + eighth notes + offbeat sixteenths
                    const eighthSteps2 = Math.max(1, Math.floor(this.gridResolution / 2));
                    for (let i = 0; i < steps; i += eighthSteps2) {
                        pattern[i] = true;
                    }
                    // Add offbeat sixteenths (in between eighth notes)
                    if (this.gridResolution >= 16) {
                        const sixteenthStep = Math.floor(this.gridResolution / 8);
                        for (let i = sixteenthStep; i < steps; i += eighthSteps2) {
                            pattern[i] = true;
                        }
                    }
                    layer.description = '+ Offbeat 16ths';
                    break;

                case 4: // Dense - events + all sixteenth notes
                    if (this.gridResolution >= 16) {
                        const sixteenthSteps = Math.floor(this.gridResolution / 8);
                        for (let i = 0; i < steps; i += sixteenthSteps) {
                            pattern[i] = true;
                        }
                    } else {
                        // Fill more densely for lower resolutions
                        for (let i = 0; i < steps; i += 2) {
                            pattern[i] = true;
                        }
                    }
                    layer.description = '+ All 16th notes';
                    break;

                case 5: // Maximum - nearly all beats
                    // Fill all beats
                    for (let i = 0; i < steps; i++) {
                        pattern[i] = true;
                    }
                    layer.description = '+ Full subdivision';
                    break;
            }

            layer.pattern = pattern;
        });

        // Generate accents based on magnitude at event positions
        // Use 3 accent levels: high (top 33%), medium (33-66%), low (66-100%)
        this.rhythmPattern.accents = Array(steps).fill(0); // 0 = no accent, 1 = low, 2 = med, 3 = high
        eventGridPositions.forEach(({ gridPosition, magnitude }) => {
            const normalizedMagnitude = (magnitude - minMagnitude) / magnitudeRange;
            if (normalizedMagnitude >= 0.66) {
                this.rhythmPattern.accents[gridPosition] = 3; // High accent
            } else if (normalizedMagnitude >= 0.33) {
                this.rhythmPattern.accents[gridPosition] = 2; // Medium accent
            } else {
                this.rhythmPattern.accents[gridPosition] = 1; // Low accent
            }
        });

        console.log(`Rhythm Planner: Mapped ${events.length} events to grid positions`);
    }

    /**
     * Generate pattern from dense contour data (original algorithm)
     */
    generatePatternFromDenseContour(contour, steps) {
        this.eventPoints = null;

        // Resample contour to match grid resolution
        this.resampledValues = this.resampleContour(contour, steps);

        // Detect peaks for kick/snare placement
        const peaks = this.detectPeaks(this.resampledValues);

        // Generate density layers (pattern-based derivation)
        this.generateDensityLayers(this.resampledValues, peaks);

        // Generate accent pattern
        this.generateAccents(this.resampledValues);

        console.log('Rhythm Planner: Generated pattern with', steps, 'steps,', peaks.length, 'peaks detected');
    }

    /**
     * Resample contour to match grid resolution (interpolate/downsample)
     */
    resampleContour(contour, targetLength) {
        if (contour.length === 0) return Array(targetLength).fill(0);

        const resampled = [];

        for (let i = 0; i < targetLength; i++) {
            const position = (i / targetLength) * contour.length;
            const index = Math.floor(position);
            const nextIndex = Math.min(index + 1, contour.length - 1);
            const fraction = position - index;

            // Linear interpolation
            const value1 = contour[index].y || contour[index].value || 0;
            const value2 = contour[nextIndex].y || contour[nextIndex].value || 0;
            const interpolated = value1 + (value2 - value1) * fraction;

            resampled.push(interpolated);
        }

        return resampled;
    }

    /**
     * Detect peaks in resampled data (local maxima above threshold)
     */
    detectPeaks(values) {
        const peaks = [];
        const threshold = this.calculateThreshold(values, 0.6);  // 60th percentile

        for (let i = 1; i < values.length - 1; i++) {
            if (values[i] > values[i-1] && values[i] > values[i+1] && values[i] > threshold) {
                peaks.push(i);
            }
        }

        return peaks;
    }

    /**
     * Calculate threshold at given percentile
     */
    calculateThreshold(values, percentile) {
        const sorted = [...values].sort((a, b) => a - b);
        const index = Math.floor(percentile * sorted.length);
        return sorted[index];
    }

    /**
     * Generate 6 density layers with progressive complexity
     */
    generateDensityLayers(values, peaks) {
        const steps = values.length;
        const beatsPerBar = 4;  // TODO: Parse from time signature
        const stepsPerBeat = this.gridResolution / beatsPerBar;

        // Layer 0 (Minimal): Only kick on downbeats (1 and 3) and snare on 2 and 4
        const layer0 = Array(steps).fill(false);
        for (let beat = 0; beat < beatsPerBar * this.bars; beat++) {
            const stepIndex = Math.floor(beat * stepsPerBeat);
            if (stepIndex < steps) {
                if (beat % 4 === 0 || beat % 4 === 2) {
                    layer0[stepIndex] = true;  // Kick on 1 and 3
                } else if (beat % 4 === 1 || beat % 4 === 3) {
                    layer0[stepIndex] = true;  // Snare on 2 and 4
                }
            }
        }
        this.rhythmPattern.layers[0].pattern = layer0;

        // Layer 1 (Sparse): Add kick on strong peaks
        const layer1 = [...layer0];
        const strongPeaks = peaks.filter(peakIndex => {
            // Only add if it's a really strong peak
            return values[peakIndex] > this.calculateThreshold(values, 0.75);
        });
        strongPeaks.forEach(peakIndex => {
            layer1[peakIndex] = true;
        });
        this.rhythmPattern.layers[1].pattern = layer1;

        // Layer 2 (Light): Add hi-hat on 8th notes
        const layer2 = [...layer1];
        const eighthSteps = Math.max(2, Math.floor(this.gridResolution / 2));
        for (let i = 0; i < steps; i += eighthSteps) {
            layer2[i] = true;  // Hi-hat on 8th notes
        }
        this.rhythmPattern.layers[2].pattern = layer2;

        // Layer 3 (Medium): Add all peaks as kicks
        const layer3 = [...layer2];
        peaks.forEach(peakIndex => {
            layer3[peakIndex] = true;
        });
        this.rhythmPattern.layers[3].pattern = layer3;

        // Layer 4 (Dense): Add hi-hat on 16th notes
        const layer4 = [...layer3];
        if (this.gridResolution >= 16) {
            const sixteenthSteps = Math.floor(this.gridResolution / 8);
            for (let i = 0; i < steps; i += sixteenthSteps) {
                layer4[i] = true;  // Hi-hat on 16th notes
            }
        }
        this.rhythmPattern.layers[4].pattern = layer4;

        // Layer 5 (Maximum): Fill in remaining steps above threshold
        const layer5 = [...layer4];
        const mediumThreshold = this.calculateThreshold(values, 0.4);
        for (let i = 0; i < steps; i++) {
            if (!layer5[i] && values[i] > mediumThreshold) {
                layer5[i] = true;  // Ghost note/fill
            }
        }
        // Add rapid fills before beat 1 of each bar
        const stepsPerBar = this.gridResolution;
        for (let bar = 0; bar < this.bars; bar++) {
            const barStart = bar * stepsPerBar;
            const fillStart = barStart + stepsPerBar - 4;  // Last 4 steps
            for (let i = fillStart; i < barStart + stepsPerBar && i < steps; i++) {
                if (i >= 0) {
                    layer5[i] = true;  // Fill
                }
            }
        }
        this.rhythmPattern.layers[5].pattern = layer5;
    }

    /**
     * Generate accent pattern (top 25% of values)
     */
    generateAccents(values) {
        const accentThreshold = this.calculateThreshold(values, 0.75);  // Top 25%
        this.rhythmPattern.accents = values.map(v => v > accentThreshold);
    }

    /**
     * Publish pattern to PubSub for drummer consumption
     */
    publishPattern() {
        PubSub.publish('rhythm:pattern', {
            pattern: this.rhythmPattern,
            resolution: this.gridResolution,
            timeSignature: this.timeSignature,
            bars: this.bars
        });

        console.log('Rhythm pattern published:', this.rhythmPattern);
    }

    /**
     * Render the component
     */
    render() {
        this.innerHTML = `
            <div class="sf-component sf-component-rhythm">
                <h3 class="sf-component-header sf-component-header-rhythm">🥁 Rhythm Planner</h3>

                ${this.renderControls()}
                ${this.renderGrid()}

                <!-- Contour target light -->
                <div style="margin-top: 10px;" class="sf-text-primary">
                    Rhythm Input ${this.getContourTargetHTML('rhythm_input')}
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
                <label class="sf-label">
                    Resolution:
                    <select id="resolution-select" class="sf-select">
                        <option value="8" ${this.gridResolution === 8 ? 'selected' : ''}>8th notes</option>
                        <option value="16" ${this.gridResolution === 16 ? 'selected' : ''}>16th notes</option>
                        <option value="32" ${this.gridResolution === 32 ? 'selected' : ''}>32nd notes</option>
                    </select>
                </label>

                <label class="sf-label">
                    Bars:
                    <input type="number" id="bars-input" value="${this.bars}" min="1" max="8" class="sf-input">
                </label>

                <label class="sf-label">
                    Mode:
                    <select id="interpretation-mode-select" class="sf-select">
                        <option value="auto" ${this.interpretationMode === 'auto' ? 'selected' : ''}>Auto</option>
                        <option value="sparse" ${this.interpretationMode === 'sparse' ? 'selected' : ''}>Sparse Events</option>
                        <option value="contour" ${this.interpretationMode === 'contour' ? 'selected' : ''}>Dense Contour</option>
                    </select>
                </label>

                <button id="regenerate-btn" class="sf-button sf-button-rhythm">
                    Regenerate
                </button>

                <label class="sf-label">
                    Preview Layer:
                    <select id="preview-layer-select" class="sf-select">
                        ${this.rhythmPattern.layers.map((layer, i) =>
                            `<option value="${i}" ${this.previewDensityLayer === i ? 'selected' : ''}>${layer.label}</option>`
                        ).join('')}
                    </select>
                </label>

                <button id="preview-btn" class="sf-button ${this.isPlaying ? 'sf-button-danger' : 'sf-button-success'}">
                    ${this.isPlaying ? '⏹ Stop' : '▶ Preview'}
                </button>
            </div>
        `;
    }

    /**
     * Render drum grid visualization
     */
    renderGrid() {
        if (!this.inputContour) {
            return `<div style="color: #888; padding: 20px; text-align: center;">
                No contour input. Drag a layer's square source to "Rhythm Input" above to generate pattern.
            </div>`;
        }

        const steps = this.gridResolution * this.bars;
        const cellWidth = Math.min(30, 800 / steps);  // Max 800px total width
        const gridHeight = this.rhythmPattern.layers.length * 40;

        // Different visualization for sparse events vs dense contour
        if (this.eventPoints) {
            return this.renderEventGrid(steps, cellWidth, gridHeight);
        } else if (this.resampledValues) {
            return this.renderContourGrid(steps, cellWidth, gridHeight);
        } else {
            return `<div style="color: #888; padding: 20px; text-align: center;">
                No pattern generated yet.
            </div>`;
        }
    }

    /**
     * Render grid for sparse event data (intersections, peaks)
     */
    renderEventGrid(steps, cellWidth, gridHeight) {
        const events = this.eventPoints;

        // Get X and Y ranges
        const xValues = events.map(e => e.x);
        const yValues = events.map(e => e.y || e.value || 0);
        const minX = Math.min(...xValues);
        const maxX = Math.max(...xValues);
        const xRange = maxX - minX || 1;
        const minY = Math.min(...yValues);
        const maxY = Math.max(...yValues);
        const yRange = maxY - minY || 1;

        // Timeline height above grid
        const timelineHeight = 60;
        const timelineY = -10;

        return `
            <div class="rhythm-grid" style="margin-top: 15px; overflow-x: auto;">
                <div style="margin-bottom: 5px; color: #888; font-size: 11px;">
                    <strong>Event Mapping:</strong>
                    <span style="color: ${this.inputContour.color}">● Input Events (${events.length})</span> |
                    <span style="color: #f39c12">█ Rhythm Hits</span> |
                    <span style="color: #ff4444; font-size: 14px;">⬆</span> High |
                    <span style="color: #ffaa44; font-size: 12px;">⬆</span> Med |
                    <span style="color: #fff; font-size: 10px;">⬆</span> Low Accent
                    <br>
                    <em>X position → Beat position | Y value → Accent strength | All events in all layers</em>
                </div>
                <svg width="${steps * cellWidth + 100}" height="${gridHeight + timelineHeight + 60}">
                    <!-- Timeline above grid -->
                    <g transform="translate(0, ${timelineHeight})">
                        <!-- Timeline line -->
                        <line
                            x1="80"
                            y1="${timelineY}"
                            x2="${steps * cellWidth + 80}"
                            y2="${timelineY}"
                            stroke="#555"
                            stroke-width="2"
                        />

                        <!-- Event nodes on timeline -->
                        ${events.map(event => {
                            const normalizedX = (event.x - minX) / xRange;
                            const gridX = normalizedX * (steps - 1);
                            const xPos = gridX * cellWidth + 80 + cellWidth/2;

                            const magnitude = event.y || event.value || 0;
                            const normalizedY = (magnitude - minY) / yRange;
                            const nodeSize = 3 + (normalizedY * 5); // Size based on magnitude

                            const gridPosition = Math.round(gridX);

                            return `
                                <!-- Drop line from event to grid -->
                                <line
                                    x1="${xPos}"
                                    y1="${timelineY}"
                                    x2="${gridPosition * cellWidth + 80 + cellWidth/2}"
                                    y2="10"
                                    stroke="${this.inputContour.color}"
                                    stroke-width="1"
                                    stroke-dasharray="2,2"
                                    opacity="0.4"
                                />
                                <!-- Event node -->
                                <circle
                                    cx="${xPos}"
                                    cy="${timelineY}"
                                    r="${nodeSize}"
                                    fill="${this.inputContour.color}"
                                    stroke="#fff"
                                    stroke-width="1"
                                />
                                <!-- Magnitude label -->
                                <text
                                    x="${xPos}"
                                    y="${timelineY - nodeSize - 5}"
                                    fill="${this.inputContour.color}"
                                    font-size="9"
                                    text-anchor="middle"
                                >
                                    ${magnitude.toFixed(1)}
                                </text>
                            `;
                        }).join('')}
                    </g>

                    <!-- Grid cells (offset by timeline) -->
                    <g transform="translate(0, ${timelineHeight})">
                    ${this.rhythmPattern.layers.map((layer, layerIndex) => `
                        <g class="layer-row" data-layer-index="${layerIndex}">
                            <!-- Layer label -->
                            <text x="5" y="${layerIndex * 40 + 20}" fill="#dcdcaa" font-size="11" font-weight="bold">
                                ${layer.label}
                            </text>
                            <text x="5" y="${layerIndex * 40 + 32}" fill="#888" font-size="9">
                                ${layer.description}
                            </text>

                            <!-- Grid cells -->
                            ${layer.pattern.map((active, step) => `
                                <rect
                                    x="${step * cellWidth + 80}"
                                    y="${layerIndex * 40 + 10}"
                                    width="${cellWidth - 2}"
                                    height="30"
                                    fill="${active ? '#f39c12' : '#2d2d2d'}"
                                    stroke="#555"
                                    stroke-width="1"
                                    data-step="${step}"
                                    data-layer="${layerIndex}"
                                    style="cursor: pointer;"
                                />

                                <!-- Accent markers (3 levels) -->
                                ${active && this.rhythmPattern.accents[step] === 3 ? `
                                    <text x="${step * cellWidth + 80 + cellWidth/2}"
                                          y="${layerIndex * 40 + 28}"
                                          fill="#ff4444"
                                          font-size="18"
                                          font-weight="bold"
                                          text-anchor="middle">
                                        ⬆
                                    </text>
                                ` : ''}
                                ${active && this.rhythmPattern.accents[step] === 2 ? `
                                    <text x="${step * cellWidth + 80 + cellWidth/2}"
                                          y="${layerIndex * 40 + 28}"
                                          fill="#ffaa44"
                                          font-size="14"
                                          text-anchor="middle">
                                        ⬆
                                    </text>
                                ` : ''}
                                ${active && this.rhythmPattern.accents[step] === 1 ? `
                                    <text x="${step * cellWidth + 80 + cellWidth/2}"
                                          y="${layerIndex * 40 + 28}"
                                          fill="#ffffff"
                                          font-size="12"
                                          opacity="0.5"
                                          text-anchor="middle">
                                        ⬆
                                    </text>
                                ` : ''}
                            `).join('')}
                        </g>
                    `).join('')}

                    <!-- Time markers -->
                    ${Array.from({length: steps}, (_, i) => `
                        <text x="${i * cellWidth + 80 + cellWidth/2}"
                              y="${this.rhythmPattern.layers.length * 40 + 45}"
                              fill="#888"
                              font-size="10"
                              text-anchor="middle">
                            ${i + 1}
                        </text>
                    `).join('')}
                    </g>
                </svg>
            </div>
        `;
    }

    /**
     * Render grid for dense contour data
     */
    renderContourGrid(steps, cellWidth, gridHeight) {
        const resampledValues = this.resampledValues;
        const minValue = Math.min(...resampledValues);
        const maxValue = Math.max(...resampledValues);
        const valueRange = maxValue - minValue || 1;

        // Scale contour to fit grid height
        const scaleY = (value) => {
            const normalized = (value - minValue) / valueRange;
            return gridHeight - (normalized * gridHeight) + 10;  // Invert and offset
        };

        return `
            <div class="rhythm-grid" style="margin-top: 15px; overflow-x: auto;">
                <div style="margin-bottom: 5px; color: #888; font-size: 11px;">
                    <strong>Visual Guide:</strong>
                    <span style="color: ${this.inputContour.color}">█ Input Contour</span> |
                    <span style="color: #f39c12">█ Rhythm Hits</span> |
                    <span style="color: #fff">⬆ Accents</span>
                </div>
                <svg width="${steps * cellWidth + 100}" height="${gridHeight + 60}">
                    <!-- Input contour overlay -->
                    <g opacity="0.3">
                        <path
                            d="${resampledValues.map((value, i) =>
                                `${i === 0 ? 'M' : 'L'} ${i * cellWidth + 80 + cellWidth/2} ${scaleY(value)}`
                            ).join(' ')}"
                            fill="none"
                            stroke="${this.inputContour.color}"
                            stroke-width="2"
                        />
                        ${resampledValues.map((value, i) => `
                            <circle
                                cx="${i * cellWidth + 80 + cellWidth/2}"
                                cy="${scaleY(value)}"
                                r="2"
                                fill="${this.inputContour.color}"
                            />
                        `).join('')}
                    </g>

                    <!-- Grid cells -->
                    ${this.rhythmPattern.layers.map((layer, layerIndex) => `
                        <g class="layer-row" data-layer-index="${layerIndex}">
                            <!-- Layer label -->
                            <text x="5" y="${layerIndex * 40 + 20}" fill="#dcdcaa" font-size="11" font-weight="bold">
                                ${layer.label}
                            </text>
                            <text x="5" y="${layerIndex * 40 + 32}" fill="#888" font-size="9">
                                ${layer.description}
                            </text>

                            <!-- Grid cells -->
                            ${layer.pattern.map((active, step) => `
                                <rect
                                    x="${step * cellWidth + 80}"
                                    y="${layerIndex * 40 + 10}"
                                    width="${cellWidth - 2}"
                                    height="30"
                                    fill="${active ? '#f39c12' : '#2d2d2d'}"
                                    stroke="#555"
                                    stroke-width="1"
                                    data-step="${step}"
                                    data-layer="${layerIndex}"
                                    style="cursor: pointer;"
                                />

                                <!-- Accent markers (3 levels) -->
                                ${active && this.rhythmPattern.accents[step] === 3 ? `
                                    <text x="${step * cellWidth + 80 + cellWidth/2}"
                                          y="${layerIndex * 40 + 28}"
                                          fill="#ff4444"
                                          font-size="18"
                                          font-weight="bold"
                                          text-anchor="middle">
                                        ⬆
                                    </text>
                                ` : ''}
                                ${active && this.rhythmPattern.accents[step] === 2 ? `
                                    <text x="${step * cellWidth + 80 + cellWidth/2}"
                                          y="${layerIndex * 40 + 28}"
                                          fill="#ffaa44"
                                          font-size="14"
                                          text-anchor="middle">
                                        ⬆
                                    </text>
                                ` : ''}
                                ${active && this.rhythmPattern.accents[step] === 1 ? `
                                    <text x="${step * cellWidth + 80 + cellWidth/2}"
                                          y="${layerIndex * 40 + 28}"
                                          fill="#ffffff"
                                          font-size="12"
                                          opacity="0.5"
                                          text-anchor="middle">
                                        ⬆
                                    </text>
                                ` : ''}
                            `).join('')}
                        </g>
                    `).join('')}

                    <!-- Time markers -->
                    ${Array.from({length: steps}, (_, i) => `
                        <text x="${i * cellWidth + 80 + cellWidth/2}"
                              y="${this.rhythmPattern.layers.length * 40 + 45}"
                              fill="#888"
                              font-size="10"
                              text-anchor="middle">
                            ${i + 1}
                        </text>
                    `).join('')}
                </svg>
            </div>
        `;
    }

    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        // Resolution selector
        const resolutionSelect = this.$('#resolution-select');
        if (resolutionSelect) {
            resolutionSelect.onchange = (e) => {
                this.gridResolution = parseInt(e.target.value);
                this.generatePatternFromContour();
                this.publishPattern();
                this.render();
            };
        }

        // Bars input
        const barsInput = this.$('#bars-input');
        if (barsInput) {
            barsInput.onchange = (e) => {
                this.bars = parseInt(e.target.value);
                this.generatePatternFromContour();
                this.publishPattern();
                this.render();
            };
        }

        // Interpretation mode selector
        const modeSelect = this.$('#interpretation-mode-select');
        if (modeSelect) {
            modeSelect.onchange = (e) => {
                this.interpretationMode = e.target.value;
                this.generatePatternFromContour();
                this.publishPattern();
                this.render();
            };
        }

        // Regenerate button
        const regenBtn = this.$('#regenerate-btn');
        if (regenBtn) {
            regenBtn.onclick = () => {
                this.generatePatternFromContour();
                this.publishPattern();
                this.render();
            };
        }

        // Preview layer selector
        const previewLayerSelect = this.$('#preview-layer-select');
        if (previewLayerSelect) {
            previewLayerSelect.onchange = (e) => {
                this.previewDensityLayer = parseInt(e.target.value);
            };
        }

        // Preview button
        const previewBtn = this.$('#preview-btn');
        if (previewBtn) {
            previewBtn.onclick = () => {
                if (this.isPlaying) {
                    this.stopPreview();
                } else {
                    this.startPreview();
                }
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

        // Calculate tempo (assume 120 BPM for now)
        const bpm = 120;
        const beatsPerBar = 4;  // From time signature
        const stepsPerBeat = this.gridResolution / beatsPerBar;
        const msPerStep = (60000 / bpm) / stepsPerBeat;

        // Get pattern for selected density layer
        const pattern = this.rhythmPattern.layers[this.previewDensityLayer].pattern;
        const accents = this.rhythmPattern.accents;

        // Schedule playback
        this.playbackInterval = setInterval(() => {
            if (pattern[this.currentStep]) {
                const accentLevel = accents[this.currentStep] || 1;
                const velocity = accentLevel === 3 ? 1.0 : (accentLevel === 2 ? 0.7 : 0.5);

                // Simple drum sound
                this.playDrumHit(velocity);
            }

            this.currentStep++;
            if (this.currentStep >= pattern.length) {
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
     * Play a drum hit using WebAudio
     */
    playDrumHit(velocity = 0.7) {
        if (!this.audioContext) return;

        const now = this.audioContext.currentTime;

        // Simple kick drum: short low-frequency tone
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.05);

        gain.gain.setValueAtTime(velocity * 0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

        osc.connect(gain);
        gain.connect(this.audioContext.destination);

        osc.start(now);
        osc.stop(now + 0.15);
    }

    /**
     * Cleanup on disconnect
     */
    disconnectedCallback() {
        super.disconnectedCallback();
        this.stopPreview();
    }
}

customElements.define('sonofire-rhythm-planner', SonofireRhythmPlanner);
