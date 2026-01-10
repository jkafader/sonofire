import { PubSub } from './pubsub.js';

/**
 * WhipBinding - Connects a playhead to a parameter target
 *
 * A whip binding subscribes to playhead value updates and applies
 * the mapped values to a target parameter in a component.
 *
 * Mapping Functions:
 * - linear: Direct mapping from 0-1 to parameter range
 * - exponential: Exponential curve (useful for volume, brightness)
 * - inverse: Inverted mapping (1 becomes min, 0 becomes max)
 * - logarithmic: Logarithmic curve (useful for frequency, pitch)
 */
export class WhipBinding {
    constructor(config = {}) {
        this.id = config.id || `whip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Source: playhead that provides values
        this.sourcePlayheadId = config.sourcePlayheadId;
        this.sourceVisualizerId = config.sourceVisualizerId;

        // Target: parameter that receives values
        this.targetComponentId = config.targetComponentId;
        this.targetParameterId = config.targetParameterId;

        // Mapping configuration
        this.mappingFunction = config.mappingFunction || 'linear';
        this.mappingCurve = config.mappingCurve || 2; // For exponential mapping

        // Visual configuration
        this.color = config.color;
        this.enabled = config.enabled !== false;

        // Runtime state
        this.subscription = null; // PubSub subscription topic
        this.subscriptionCallback = null; // Callback function for unsubscribing
        this.lastValue = null;
    }

    /**
     * Activate the binding (subscribe to playhead updates)
     */
    activate() {
        if (this.subscription) {
            return;
        }

        const topic = `playhead:${this.sourceVisualizerId}:${this.sourcePlayheadId}:value`;

        // Store the callback so we can unsubscribe later
        this.subscriptionCallback = (data) => {
            if (!this.enabled) return;

            // data contains: { value: normalizedValue (0-1), rawValue, position, color, ... }
            const mappedValue = this.mapValue(data.value);
            this.applyToTarget(mappedValue, data.value);
            this.lastValue = data.value;
        };

        PubSub.subscribe(topic, this.subscriptionCallback, this);

        // Store the topic for unsubscribing
        this.subscription = topic;
    }

    /**
     * Deactivate the binding (unsubscribe)
     */
    deactivate() {
        if (!this.subscription || !this.subscriptionCallback) return;

        // Unsubscribe from PubSub
        PubSub.unsubscribe(this.subscription, this.subscriptionCallback, this);

        this.subscription = null;
        this.subscriptionCallback = null;
    }

    /**
     * Map a normalized value (0-1) using the selected mapping function
     * @param {number} normalizedValue - Input value from 0 to 1
     * @returns {number} - Mapped value from 0 to 1
     */
    mapValue(normalizedValue) {
        // Clamp input to 0-1
        const x = Math.max(0, Math.min(1, normalizedValue));

        switch (this.mappingFunction) {
            case 'linear':
                return x;

            case 'exponential':
                // y = x^curve (default curve = 2 for quadratic)
                return Math.pow(x, this.mappingCurve);

            case 'inverse':
                // y = 1 - x
                return 1 - x;

            case 'logarithmic':
                // y = log(x * 99 + 1) / log(100)
                // Maps 0→0, 1→1 with logarithmic curve
                return Math.log(x * 99 + 1) / Math.log(100);

            default:
                console.warn(`WhipBinding ${this.id}: Unknown mapping function "${this.mappingFunction}", using linear`);
                return x;
        }
    }

    /**
     * Apply mapped value to the target parameter
     * @param {number} mappedValue - Mapped value (0-1)
     * @param {number} originalValue - Original normalized value (0-1)
     */
    applyToTarget(mappedValue, originalValue) {
        // Find the target component
        const targetElement = document.getElementById(this.targetComponentId) ||
                              document.querySelector(this.targetComponentId);

        if (!targetElement) {
            console.warn(`WhipBinding ${this.id}: Target component "${this.targetComponentId}" not found`);
            return;
        }

        // Check if component has setWhippableValue method
        if (typeof targetElement.setWhippableValue === 'function') {
            targetElement.setWhippableValue(this.targetParameterId, mappedValue);
        } else {
            console.warn(`WhipBinding ${this.id}: Target component does not support whippable parameters`);
        }
    }

    /**
     * Enable or disable the binding
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        this.enabled = enabled;
    }

    /**
     * Change the mapping function
     * @param {string} mappingFunction - 'linear', 'exponential', 'inverse', 'logarithmic'
     * @param {number} curve - Curve parameter for exponential mapping
     */
    setMappingFunction(mappingFunction, curve = 2) {
        this.mappingFunction = mappingFunction;
        this.mappingCurve = curve;
    }

    /**
     * Get binding display name
     * @returns {string}
     */
    getDisplayName() {
        return `${this.sourceVisualizerId}/${this.sourcePlayheadId} → ${this.targetComponentId}/${this.targetParameterId}`;
    }

    /**
     * Serialize to JSON for persistence
     * @returns {Object}
     */
    toJSON() {
        return {
            id: this.id,
            sourcePlayheadId: this.sourcePlayheadId,
            sourceVisualizerId: this.sourceVisualizerId,
            targetComponentId: this.targetComponentId,
            targetParameterId: this.targetParameterId,
            mappingFunction: this.mappingFunction,
            mappingCurve: this.mappingCurve,
            color: this.color,
            enabled: this.enabled,
        };
    }

    /**
     * Deserialize from JSON
     * @param {Object} json - Serialized binding data
     * @returns {WhipBinding}
     */
    static fromJSON(json) {
        return new WhipBinding({
            id: json.id,
            sourcePlayheadId: json.sourcePlayheadId,
            sourceVisualizerId: json.sourceVisualizerId,
            targetComponentId: json.targetComponentId,
            targetParameterId: json.targetParameterId,
            mappingFunction: json.mappingFunction,
            mappingCurve: json.mappingCurve,
            color: json.color,
            enabled: json.enabled,
        });
    }

    /**
     * Available mapping functions
     */
    static MAPPING_FUNCTIONS = [
        { value: 'linear', label: 'Linear', description: 'Direct 1:1 mapping' },
        { value: 'exponential', label: 'Exponential', description: 'Exponential curve (slower start)' },
        { value: 'inverse', label: 'Inverse', description: 'Inverted mapping (flipped)' },
        { value: 'logarithmic', label: 'Logarithmic', description: 'Logarithmic curve (faster start)' },
    ];
}
