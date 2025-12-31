import { SonofireBase } from './sonofire_base.js';
import { SCALES, SCALE_TONES } from '../../lib/midi_data.js';
import { Playhead } from '../../lib/playhead.js';

/**
 * Base class for all Sonofire visualizer components
 * Provides common functionality for data loading, visualization, and playback
 */
export class SonofireVisualizerBase extends SonofireBase {
    constructor() {
        super();

        // Visualization state
        this.data = [];
        this.playheads = [];  // Array of Playhead objects
        this.playheadPosition = 0;  // Legacy single playhead position (deprecated)
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

        // Dimensions from config
        if (this.config.width) this.width = this.config.width;
        if (this.config.height) this.height = this.config.height;
    }

    /**
     * Setup PubSub subscriptions
     */
    setupSubscriptions() {
        super.setupSubscriptions();

        // Subscribe to clock ticks for playhead advancement
        this.subscribe('clock:tick', (data) => {
            if (this.isPlaying) {
                this.onClockTick(data);
            }
        });

        // Subscribe to key changes to update scale
        this.subscribe('context:key', (data) => {
            this.onKeyChange(data);
        });

        // Subscribe to transport controls from Conductor
        this.subscribe('transport:play', (data) => {
            this.isPlaying = true;
            console.log(`${this.constructor.name}: Playing`);
            this.render();
        });

        this.subscribe('transport:stop', (data) => {
            this.isPlaying = false;
            console.log(`${this.constructor.name}: Stopped`);
            this.render();
        });

        this.subscribe('transport:rewind', (data) => {
            this.rewind();
            console.log(`${this.constructor.name}: Rewound to 0`);
            this.render();
        });
    }

    /**
     * Called when component is connected
     */
    connectedCallback() {
        super.connectedCallback();

        // Discover current harmonic context
        const keyContext = this.getLastValue('context:key');
        if (keyContext) {
            this.onKeyChange(keyContext);
        }

        // Restore playheads from PubSub
        this.restorePlayheads();
    }

    /**
     * Get unique visualizer ID for playhead management
     * @returns {string}
     */
    getVisualizerId() {
        return this.id || this.tagName.toLowerCase();
    }

    /**
     * Add a new playhead
     * @param {Object} config - Playhead configuration
     * @returns {Playhead}
     */
    addPlayhead(config = {}) {
        const visualizerId = this.getVisualizerId();
        const playhead = new Playhead(visualizerId, config);

        this.playheads.push(playhead);
        this.savePlayheads();
        this.render();

        console.log(`${this.constructor.name}: Added playhead ${playhead.id}`);
        return playhead;
    }

    /**
     * Remove a playhead by ID
     * @param {string} playheadId
     */
    removePlayhead(playheadId) {
        this.playheads = this.playheads.filter(ph => ph.id !== playheadId);
        this.savePlayheads();
        this.render();

        console.log(`${this.constructor.name}: Removed playhead ${playheadId}`);

        // Publish event so WhipManager can clean up bindings
        this.publish('playhead:removed', { visualizerId: this.getVisualizerId(), playheadId });
    }

    /**
     * Get a playhead by ID
     * @param {string} playheadId
     * @returns {Playhead|null}
     */
    getPlayhead(playheadId) {
        return this.playheads.find(ph => ph.id === playheadId) || null;
    }

    /**
     * Advance all enabled playheads
     */
    advanceAllPlayheads() {
        let anyAdvanced = false;
        this.playheads.forEach(playhead => {
            if (playhead.advance()) {
                // Playhead advanced, update position and sample data
                this.advancePlayheadPosition(playhead);
                this.sampleDataAtPlayhead(playhead);
                anyAdvanced = true;
            }
        });

        // Call hook if any playheads advanced
        if (anyAdvanced) {
            this.onPlayheadsAdvanced();
        }
    }

    /**
     * Hook called after playheads advance
     * Subclasses can override to update visuals
     */
    onPlayheadsAdvanced() {
        // Subclasses implement
    }

    /**
     * Advance a specific playhead's position in visualizer space
     * Subclasses should override to implement playhead movement
     * @param {Playhead} playhead
     */
    advancePlayheadPosition(playhead) {
        // Subclasses implement (e.g., increment X position in XY plot)
    }

    /**
     * Sample data at a playhead's current position
     * Subclasses should override to implement data sampling
     * @param {Playhead} playhead
     */
    sampleDataAtPlayhead(playhead) {
        // Subclasses implement
        // Should call playhead.sampleValue(rawValue, normalizedValue)
    }

    /**
     * Save playheads to PubSub for persistence
     */
    savePlayheads() {
        const topic = `playheads:${this.getVisualizerId()}`;
        const state = {
            visualizerId: this.getVisualizerId(),
            playheads: this.playheads.map(ph => ph.toJSON())
        };
        this.publish(topic, state);
    }

    /**
     * Restore playheads from PubSub
     */
    restorePlayheads() {
        const topic = `playheads:${this.getVisualizerId()}`;
        const state = this.getLastValue(topic);

        if (state && state.playheads) {
            this.playheads = state.playheads.map(data =>
                Playhead.fromJSON(data, this.getVisualizerId())
            );
            console.log(`${this.constructor.name}: Restored ${this.playheads.length} playheads from state`);
        }
    }

    /**
     * Handle clock tick - advance playhead and emit events
     */
    onClockTick(clockData) {
        // Advance all playheads (based on individual clock ticks)
        this.advanceAllPlayheads();
    }

    /**
     * Handle key change from Conductor
     */
    onKeyChange(keyData) {
        console.log('Visualizer: Key changed to', keyData.key, keyData.scale);
        // Could update scale visualization or note mapping
        // For now, we'll let components use their configured scale
    }

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
     * Advance playhead position
     * Subclasses should override based on their playhead type
     * @returns {boolean} True if playhead advanced, false if not (e.g., waiting for clock divisions)
     */
    advancePlayhead() {
        // Subclasses implement
        return false;
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
     * Rewind playhead to beginning
     * Subclasses can override to reset specific state
     */
    rewind() {
        this.playheadPosition = 0;
        // Subclasses override to reset their specific playhead state
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

    /**
     * Start playback
     */
    play() {
        this.isPlaying = true;
        this.publish('visualizer:play', { source: this.tagName.toLowerCase() });
        console.log('Visualizer playback started');
    }

    /**
     * Stop playback
     */
    stop() {
        this.isPlaying = false;
        this.publish('visualizer:stop', { source: this.tagName.toLowerCase() });
        console.log('Visualizer playback stopped');
    }

    /**
     * Rewind all playheads to beginning
     */
    rewind() {
        this.playheadPosition = 0;

        // Reset all playheads
        this.playheads.forEach(playhead => {
            playhead.setPosition(0);
            playhead.tickCounter = 0;
        });

        this.savePlayheads();
        this.publish('visualizer:rewind', { source: this.tagName.toLowerCase() });
        console.log('Visualizer rewound');
    }
}
