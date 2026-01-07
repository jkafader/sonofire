import { SonofireBase } from './sonofire_base.js';
import { PlayheadsMixin, PLAYHEAD_SIDEBAR_WIDTH } from '../../lib/mixins/playheads.js';
import { SCALES, SCALE_TONES } from '../../lib/midi_data.js';

/**
 * Core visualizer class (before mixin application)
 * Provides common functionality for data loading and visualization
 */
class SonofireVisualizerBaseCore extends SonofireBase {
    constructor() {
        super();

        // Visualization state
        this.data = [];
        this.svg = null;
        this.dataBoundaries = []; // Maps data regions/values to MIDI notes

        // Playback state
        this.isPlaying = false;

        // Dimensions
        this.width = 700;
        this.height = 300;
        this.margin = { top: 10, right: 30, bottom: 30, left: 60 };
    }

    /**
     * Specify which attributes to observe
     */
    static get observedAttributes() {
        return [
            ...super.observedAttributes,
            'data-url',
            'data-x-column',
            'data-y-column',
            'data-scale',
            'data-scale-root',
            'data-scale-tones',
            'data-octaves'
        ];
    }

    /**
     * Parse visualizer-specific attributes
     */
    parseAttributes() {
        super.parseAttributes();

        // Data source
        this.dataUrl = this.getAttribute('data-url') || './beer_production.csv';
        this.xColumn = this.getAttribute('data-x-column') || 'date';
        this.yColumn = this.getAttribute('data-y-column') || 'production';

        // Musical parameters
        this.scale = this.getAttribute('data-scale') || '0'; // C major
        this.scaleRoot = this.getAttribute('data-scale-root') || '60'; // Middle C
        this.scaleTones = this.getAttribute('data-scale-tones') || '7'; // All scale tones
        this.octaves = this.getAttribute('data-octaves') || '3';

        // Dimensions from attributes or config (if not set, will be detected from container)
        const widthAttr = this.getAttribute('width');
        const heightAttr = this.getAttribute('height');

        if (widthAttr) {
            this.width = parseInt(widthAttr);
        } else if (this.config.width) {
            this.width = this.config.width;
        }

        if (heightAttr) {
            this.height = parseInt(heightAttr);
        } else if (this.config.height) {
            this.height = this.config.height;
        }
    }

    /**
     * Setup PubSub subscriptions
     */
    setupSubscriptions() {
        super.setupSubscriptions();

        // Setup playhead-related subscriptions (from mixin)
        this.setupPlayheadSubscriptions();
    }

    /**
     * Called when component is connected
     */
    connectedCallback() {
        super.connectedCallback();

        // Discover current harmonic context
        const poolContext = this.getLastValue('context:pool');
        if (poolContext) {
            this.onPoolChange(poolContext);
        }

        // Restore playheads from PubSub (from mixin)
        this.restorePlayheads();

        // Render playhead controls UI (from mixin)
        this.renderPlayheadControls();
    }

    // ========================================
    // Playhead Hooks (Required by Mixin)
    // ========================================

    /**
     * Advance a specific playhead's position in visualizer space
     * Subclasses MUST override to implement playhead movement
     * @param {Playhead} playhead
     */
    advancePlayheadPosition(playhead) {
        // Subclasses must implement (e.g., increment X position in XY plot)
        throw new Error('advancePlayheadPosition() must be implemented by subclass');
    }

    /**
     * Sample data at a playhead's current position
     * Subclasses MUST override to implement data sampling
     * @param {Playhead} playhead
     */
    sampleDataAtPlayhead(playhead) {
        // Subclasses must implement
        // Should call playhead.sampleValue(rawValue, normalizedValue)
        throw new Error('sampleDataAtPlayhead() must be implemented by subclass');
    }

    /**
     * Hook called after playheads advance
     * Subclasses can override to update visuals
     */
    onPlayheadsAdvanced() {
        // Optional override - default is no-op
        // Subclasses can override to update their visual rendering
    }

    /**
     * Handle pool/tonic change from Conductor
     * Override from mixin to add visualizer-specific behavior
     */
    onPoolChange(poolData) {
        console.log('Visualizer: Pool changed to', poolData.poolKey, '/', poolData.tonicName);
        // Subclasses can override to update scale visualization or note mapping
    }

    // ========================================
    // Transport Controls (Override Mixin)
    // ========================================

    /**
     * Start playback - override to add rendering
     */
    play() {
        super.play(); // Call mixin's play()
        this.isPlaying = true;
        this.render();
        console.log(`${this.constructor.name}: Playing`);
    }

    /**
     * Stop playback - override to add rendering
     */
    stop() {
        super.stop(); // Call mixin's stop()
        this.isPlaying = false;
        this.render();
        console.log(`${this.constructor.name}: Stopped`);
    }

    /**
     * Rewind all playheads - override to add rendering
     */
    rewind() {
        super.rewind(); // Call mixin's rewind()
        this.render();
        console.log(`${this.constructor.name}: Rewound to 0`);
    }

    // ========================================
    // Visualization Methods
    // ========================================

    /**
     * Calculate scale partitions (map data ranges to MIDI notes)
     * @param {string} scaleName - Scale identifier from SCALES
     * @param {string} scaleTones - Scale tones filter ('1', '3', '4', '5', '7')
     * @param {number} root - Root note MIDI number
     * @param {number} octaves - Number of octaves
     * @returns {Array<number>} Array of MIDI note numbers
     */
    calculateScalePartitions(scaleName, scaleTones, root, octaves) {
        let partitions = [];
        let scale = SCALES[scaleName];

        if (!scale) {
            console.error('Invalid scale:', scaleName);
            return [60, 62, 64, 65, 67, 69, 71]; // Default to C major
        }

        root = scale.indexOf(parseInt(root));
        let i = 0;

        for (let t = root; t < (root + (parseInt(octaves) * 7)) && t < scale.length; t++) {
            let note = scale[t];
            let toPush = SCALE_TONES[scaleTones](i, note);
            partitions.push(toPush);
            i++;
            i = i % 7;
        }

        partitions = partitions.filter(note => note !== null);
        partitions.reverse(); // Reverse for visual mapping (high notes at top)

        return partitions;
    }

    /**
     * Load data from URL
     * Subclasses can override for different data formats
     * @returns {Promise<Array>}
     */
    async loadData() {
        // Subclasses implement - default returns empty array
        return [];
    }

    /**
     * Calculate data boundaries (map data space to note space)
     * Subclasses should override based on their visualization type
     */
    calculateDataBoundaries() {
        // Subclasses implement
    }

    /**
     * Highlight currently active data points
     * Subclasses should override
     */
    highlightActiveData() {
        // Subclasses implement
    }

    /**
     * Get currently active data points under playhead
     * Subclasses should override
     * @returns {Array}
     */
    getActiveDataPoints() {
        // Subclasses implement
        return [];
    }

    /**
     * Emit data events to PubSub for instrumentalists to consume
     */
    emitDataEvents() {
        const activePoints = this.getActiveDataPoints();

        activePoints.forEach(point => {
            this.publish('data:point', {
                x: point.x,
                y: point.y,
                z: point.z || null,
                value: point.value,
                note: point.note,
                timestamp: Date.now(),
                source: this.tagName.toLowerCase()
            });
        });
    }

    // ========================================
    // Resize Functionality
    // ========================================

    /**
     * Get the visualization container element
     * Subclasses can override to specify different container selectors
     * @returns {HTMLElement|null}
     */
    getVisualizationContainer() {
        return this.$('#my_dataviz');
    }

    /**
     * Update parent container size to match current visualization dimensions
     * Called on initial render and during resize operations
     */
    updateParentContainerSize() {
        const parentElement = this.parentElement;
        if (parentElement && parentElement.style) {
            // Set explicit width on parent to match visualization + sidebar + padding
            const newParentWidth = this.width + PLAYHEAD_SIDEBAR_WIDTH + 70;
            const newParentHeight = this.height + 40;
            parentElement.style.width = `${newParentWidth}px`;
            parentElement.style.minHeight = `${newParentHeight}px`;
            parentElement.style.flex = 'none'; // Override flex sizing
        }
    }

    /**
     * Add resize handle to lower-right corner of visualization
     * Enables drag-to-resize functionality for all visualizer types
     */
    addResizeHandle() {
        const container = this.getVisualizationContainer();
        if (!container) return;

        // Remove existing resize handle if present
        const existingHandle = container.querySelector('.resize-handle');
        if (existingHandle) {
            existingHandle.remove();
        }

        // Create resize handle
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize-handle';
        resizeHandle.style.cssText = `
            position: absolute;
            bottom: 0;
            right: 0;
            width: 20px;
            height: 20px;
            background: linear-gradient(135deg, transparent 50%, #4ec9b0 50%);
            cursor: nwse-resize;
            z-index: 100;
        `;

        container.style.position = 'relative';
        container.appendChild(resizeHandle);

        // Add resize functionality
        let isResizing = false;
        let startX, startY, startWidth, startHeight;

        const startResize = (e) => {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startWidth = this.width;
            startHeight = this.height;
            e.preventDefault();

            document.addEventListener('mousemove', handleResize);
            document.addEventListener('mouseup', stopResize);
        };

        const handleResize = (e) => {
            if (!isResizing) return;

            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;

            // Update internal dimensions (minimum 300x200)
            this.width = Math.max(300, startWidth + deltaX);
            this.height = Math.max(200, startHeight + deltaY);

            // Update parent container size to match
            this.updateParentContainerSize();

            // Re-render the graph with new dimensions
            this.renderGraph();
        };

        const stopResize = () => {
            isResizing = false;
            document.removeEventListener('mousemove', handleResize);
            document.removeEventListener('mouseup', stopResize);
        };

        resizeHandle.addEventListener('mousedown', startResize);
    }
}

/**
 * SonofireVisualizerBase - Base class for all visualizer components
 * Combines SonofireBase with PlayheadsMixin to provide:
 * - Data loading and visualization
 * - Playhead management and advancement
 * - Transport controls
 * - Musical scale mapping
 */
export const SonofireVisualizerBase = PlayheadsMixin(SonofireVisualizerBaseCore);
