import { PubSub } from './pubsub.js';

/**
 * Playhead - Independent marker that advances through visualizer data
 *
 * Each playhead has:
 * - Configurable speed multiplier (relative to base tempo)
 * - Color-coded visual indicator
 * - Ability to sample data values and publish via PubSub
 * - State persistence support
 */
export class Playhead {
    constructor(visualizerId, config = {}) {
        this.id = config.id || `ph-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.visualizerId = visualizerId;
        this.color = config.color || this.generateColor();
        this.speed = config.speed !== undefined ? config.speed : 1;  // Speed multiplier
        this.position = config.position || 0;  // Current position (pixels or normalized)
        this.enabled = config.enabled !== false;
        this.tickCounter = 0;  // For clock division counting
        this.lastSampledValue = null;
        this.bindingIds = [];  // IDs of whip bindings sourced from this playhead
    }

    /**
     * Speed multipliers: /48, /24, /16, /12, /8, /4, /3, /2, 1, *2, *3, *4, *8, *12, *16
     * Encoded as numbers: 1/48 = 0.02083, 1/16 = 0.0625, *2 = 2, etc.
     * Base speed (1) = one cycle per measure
     */
    static SPEED_MULTIPLIERS = [
        { value: 1/48, label: '÷48', display: '÷48' },
        { value: 1/24, label: '÷24', display: '÷24' },
        { value: 1/16, label: '÷16', display: '÷16' },
        { value: 1/12, label: '÷12', display: '÷12' },
        { value: 1/8, label: '÷8', display: '÷8' },
        { value: 1/4, label: '÷4', display: '÷4' },
        { value: 1/3, label: '÷3', display: '÷3' },
        { value: 1/2, label: '÷2', display: '÷2' },
        { value: 1, label: '1', display: '×1' },
        { value: 2, label: '×2', display: '×2' },
        { value: 3, label: '×3', display: '×3' },
        { value: 4, label: '×4', display: '×4' },
        { value: 8, label: '×8', display: '×8' },
        { value: 12, label: '×12', display: '×12' },
        { value: 16, label: '×16', display: '×16' }
    ];

    /**
     * Color palette for playheads (16 visually distinct colors)
     * First color matches existing XY plot playhead
     */
    static COLOR_PALETTE = [
        '#4ec9b0', // Cyan (existing playhead color)
        '#ff6b6b', // Red
        '#51cf66', // Green
        '#ffa94d', // Orange
        '#748ffc', // Blue
        '#da77f2', // Purple
        '#ffd43b', // Yellow
        '#ff8787', // Light Red
        '#69db7c', // Light Green
        '#74c0fc', // Light Blue
        '#e599f7', // Light Purple
        '#ffe066', // Light Yellow
        '#f06595', // Pink
        '#cc5de8', // Magenta
        '#20c997', // Teal
        '#fd7e14'  // Dark Orange
    ];

    /**
     * Advance playhead based on speed multiplier
     * @returns {number} - Number of times to advance (0, 1, 2, 4, etc.)
     */
    advance() {
        if (!this.enabled) return 0;

        // For speeds >= 1, advance multiple times per tick
        if (this.speed >= 1) {
            // speed = 1 → advance 1 time per tick
            // speed = 2 → advance 2 times per tick
            // speed = 4 → advance 4 times per tick
            return Math.round(this.speed);
        }

        // For speeds < 1, advance less frequently using tick counter
        // speed = 1/2 → advance every 2 ticks
        // speed = 1/4 → advance every 4 ticks
        // speed = 1/16 → advance every 16 ticks
        const ticksNeeded = Math.round(1 / this.speed);

        this.tickCounter++;

        if (this.tickCounter >= ticksNeeded) {
            this.tickCounter = 0;
            return 1; // Advance once
        }

        return 0; // Don't advance this tick
    }

    /**
     * Sample a data value and publish via PubSub
     * @param {number} yValue - Raw Y-axis value from visualizer
     * @param {number} normalizedValue - Normalized value (0-1)
     */
    sampleValue(yValue, normalizedValue) {
        this.lastSampledValue = yValue;

        // Publish sampled value to PubSub
        const topic = `playhead:${this.visualizerId}:${this.id}:value`;
        const payload = {
            visualizerId: this.visualizerId,
            playheadId: this.id,
            value: normalizedValue,  // Normalized 0-1 for parameter mapping
            rawValue: yValue,        // Original value
            position: this.position,
            timestamp: Date.now(),
            color: this.color
        };

        PubSub.publish(topic, payload);
    }

    /**
     * Generate a random color from the palette
     * @returns {string} - Hex color code
     */
    generateColor() {
        const availableColors = Playhead.COLOR_PALETTE.filter(
            color => !this.isColorInUse(color)
        );

        if (availableColors.length === 0) {
            // All colors in use, pick random from full palette
            return Playhead.COLOR_PALETTE[
                Math.floor(Math.random() * Playhead.COLOR_PALETTE.length)
            ];
        }

        return availableColors[0]; // Take first available color
    }

    /**
     * Check if a color is already in use (to avoid duplicates)
     * @param {string} color - Hex color code
     * @returns {boolean}
     */
    isColorInUse(color) {
        // TODO: Check against other playheads in the same visualizer
        // For now, just return false
        return false;
    }

    /**
     * Set playhead position
     * @param {number} position - New position value
     */
    setPosition(position) {
        this.position = position;
    }

    /**
     * Set playhead speed
     * @param {number} speed - Speed multiplier
     */
    setSpeed(speed) {
        this.speed = speed;
        this.tickCounter = 0; // Reset counter when speed changes
    }

    /**
     * Enable/disable playhead
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) {
            this.tickCounter = 0;
        }
    }

    /**
     * Add a binding ID to this playhead's list
     * @param {string} bindingId
     */
    addBinding(bindingId) {
        if (!this.bindingIds.includes(bindingId)) {
            this.bindingIds.push(bindingId);
        }
    }

    /**
     * Remove a binding ID from this playhead's list
     * @param {string} bindingId
     */
    removeBinding(bindingId) {
        this.bindingIds = this.bindingIds.filter(id => id !== bindingId);
    }

    /**
     * Get speed display label
     * @returns {string}
     */
    getSpeedLabel() {
        const multiplier = Playhead.SPEED_MULTIPLIERS.find(m => m.value === this.speed);
        return multiplier ? multiplier.display : `×${this.speed}`;
    }

    /**
     * Serialize to JSON for persistence
     * @returns {Object}
     */
    toJSON() {
        return {
            id: this.id,
            visualizerId: this.visualizerId,
            color: this.color,
            speed: this.speed,
            position: this.position,
            enabled: this.enabled,
            bindingIds: this.bindingIds
        };
    }

    /**
     * Deserialize from JSON
     * @param {Object} json - Serialized playhead data
     * @param {string} visualizerId - Parent visualizer ID
     * @returns {Playhead}
     */
    static fromJSON(json, visualizerId) {
        return new Playhead(visualizerId || json.visualizerId, {
            id: json.id,
            color: json.color,
            speed: json.speed,
            position: json.position,
            enabled: json.enabled
        });
    }
}
