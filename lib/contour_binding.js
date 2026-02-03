import { PubSub } from './pubsub.js';
import { layerManager } from './layer_manager.js';

/**
 * ContourBinding - Binds layer outputs (contours) to planner component parameters
 *
 * A contour binding connects a Layer's entire output array to a parameter on a
 * planner component (e.g., rhythm planner, melody planner). When the layer computes,
 * the binding automatically updates the target parameter with the full contour data.
 */
export class ContourBinding {
    constructor(config) {
        this.id = config.id || `contour-binding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Source: Layer or other contour source
        this.sourceType = config.sourceType || 'layer';  // 'layer' | 'melody-planner' | 'generic'
        this.sourceLayerId = config.sourceLayerId;  // For layer sources
        this.sourceVisualizerId = config.sourceVisualizerId;  // For layer sources
        this.sourceId = config.sourceId;  // Generic source ID
        this.sourceTopic = config.sourceTopic;  // Generic PubSub topic

        // Target: Planner parameter
        this.targetComponentId = config.targetComponentId;
        this.targetParameterId = config.targetParameterId;

        // Binding properties
        this.color = config.color || '#FF1744';
        this.enabled = config.enabled !== false;

        this.subscription = null;
    }

    /**
     * Activate the binding - subscribe to source events
     */
    activate() {
        if (this.subscription) return;

        if (this.sourceType === 'layer') {
            // Layer source - subscribe to layer computation events
            const topic = `layer:${this.sourceLayerId}:computed`;

            this.subscription = PubSub.subscribe(topic, (data) => {
                if (!this.enabled) return;

                // Get layer
                const layer = layerManager.getLayer(this.sourceLayerId);
                if (!layer || layer.computeStatus !== 'complete') return;

                // Create contour from entire layer output
                const contour = {
                    type: 'contour',
                    points: layer.outputData,  // Entire layer output IS the contour
                    sourceLayerId: this.sourceLayerId,
                    color: this.color
                };

                // Apply to target
                this.applyContourToTarget(contour);
            }, this);

            // Also send initial value if layer is already computed
            const layer = layerManager.getLayer(this.sourceLayerId);
            if (layer && layer.computeStatus === 'complete') {
                const contour = {
                    type: 'contour',
                    points: layer.outputData,
                    sourceLayerId: this.sourceLayerId,
                    color: this.color
                };
                this.applyContourToTarget(contour);
            }
        } else {
            // Generic source - subscribe to specified PubSub topic
            const topic = this.sourceTopic;

            this.subscription = PubSub.subscribe(topic, (data) => {
                if (!this.enabled) return;

                // Data should already be in contour format
                if (data && data.points) {
                    const contour = {
                        type: 'contour',
                        points: data.points,
                        sourceId: this.sourceId,
                        color: this.color
                    };

                    // Apply to target
                    this.applyContourToTarget(contour);
                }
            }, this);

            // Try to get initial value from PubSub
            const lastValue = PubSub.last(topic);
            if (lastValue && lastValue.points) {
                const contour = {
                    type: 'contour',
                    points: lastValue.points,
                    sourceId: this.sourceId,
                    color: this.color
                };
                this.applyContourToTarget(contour);
            }
        }
    }

    /**
     * Deactivate the binding - unsubscribe from events
     */
    deactivate() {
        if (this.subscription) {
            PubSub.unsubscribe(this.subscription);
            this.subscription = null;
        }
    }

    /**
     * Apply contour data to the target component parameter
     */
    applyContourToTarget(contour) {
        // Find target component
        const targetElement = document.getElementById(this.targetComponentId);
        if (!targetElement || !targetElement.setContourValue) {
            console.warn(`Contour binding target not found: ${this.targetComponentId}`);
            return;
        }

        // Apply contour to target parameter
        targetElement.setContourValue(this.targetParameterId, contour);
    }

    /**
     * Serialize to JSON
     */
    toJSON() {
        return {
            id: this.id,
            sourceType: this.sourceType,
            sourceLayerId: this.sourceLayerId,
            sourceVisualizerId: this.sourceVisualizerId,
            sourceId: this.sourceId,
            sourceTopic: this.sourceTopic,
            targetComponentId: this.targetComponentId,
            targetParameterId: this.targetParameterId,
            color: this.color,
            enabled: this.enabled
        };
    }

    /**
     * Restore from JSON
     */
    static fromJSON(data) {
        return new ContourBinding(data);
    }

    /**
     * Get display name for UI
     */
    getDisplayName() {
        let sourceName;

        if (this.sourceType === 'layer') {
            const layer = layerManager.getLayer(this.sourceLayerId);
            sourceName = layer ? layer.name : 'Unknown Layer';
        } else {
            // Generic source - use source ID
            sourceName = this.sourceId || 'Unknown Source';
        }

        return `${sourceName} → ${this.targetParameterId}`;
    }
}
