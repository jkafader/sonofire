import { PubSub } from './pubsub.js';
import { Layer } from './layer.js';

class LayerManager {
    constructor() {
        this.layers = new Map();  // layerId -> Layer
        this.layersByVisualizer = new Map();  // visualizerId -> [layerIds]
    }

    /**
     * Add a new layer to a visualizer
     */
    addLayer(visualizerId, config) {
        const layer = new Layer({ ...config, visualizerId });

        this.layers.set(layer.id, layer);

        if (!this.layersByVisualizer.has(visualizerId)) {
            this.layersByVisualizer.set(visualizerId, []);
        }
        this.layersByVisualizer.get(visualizerId).push(layer.id);

        // Auto-compute if it's a transform layer
        if (layer.type === 'transform') {
            this.computeLayer(layer.id);
        } else if (layer.type === 'data') {
            // Data layers get their output from visualizer immediately
            layer.computeStatus = 'complete';
        }

        // Publish layer added event
        PubSub.publish(`visualizer:${visualizerId}:layer:added`, {
            layerId: layer.id,
            layer: layer.toJSON()
        });

        this.saveLayers(visualizerId);

        return layer;
    }

    /**
     * Remove a layer
     */
    removeLayer(layerId) {
        const layer = this.layers.get(layerId);
        if (!layer) return;

        const visualizerId = layer.visualizerId;

        // Remove from maps
        this.layers.delete(layerId);
        const vizLayers = this.layersByVisualizer.get(visualizerId);
        if (vizLayers) {
            const index = vizLayers.indexOf(layerId);
            if (index >= 0) {
                vizLayers.splice(index, 1);
            }
        }

        // Remove any dependent layers (layers that use this as input)
        this.removeDependentLayers(layerId);

        // Publish removal event
        PubSub.publish(`visualizer:${visualizerId}:layer:removed`, {
            layerId: layerId
        });

        this.saveLayers(visualizerId);
    }

    /**
     * Remove layers that depend on this layer
     */
    removeDependentLayers(layerId) {
        const dependents = Array.from(this.layers.values())
            .filter(l => l.inputLayerIds.includes(layerId));

        dependents.forEach(dep => this.removeLayer(dep.id));
    }

    /**
     * Compute a layer (runs in Web Worker)
     */
    async computeLayer(layerId) {
        const layer = this.layers.get(layerId);
        if (!layer) return;

        // Check if dependencies are computed
        const dependencies = layer.inputLayerIds.map(id => this.layers.get(id));
        const allComputed = dependencies.every(dep => dep && dep.computeStatus === 'complete');

        if (!allComputed) {
            console.warn(`Layer ${layer.name}: dependencies not computed yet`);
            // Compute dependencies first
            for (const dep of dependencies) {
                if (dep && dep.computeStatus !== 'complete') {
                    await this.computeLayer(dep.id);
                }
            }
        }

        await layer.compute(this);

        // Recompute dependent layers
        await this.recomputeDependentLayers(layerId);
    }

    /**
     * Recompute all layers that depend on this one
     */
    async recomputeDependentLayers(layerId) {
        const dependents = Array.from(this.layers.values())
            .filter(l => l.inputLayerIds.includes(layerId));

        for (const dep of dependents) {
            await this.computeLayer(dep.id);
        }
    }

    /**
     * Compute all layers for a visualizer (topological sort for dependencies)
     */
    async computeAllLayers(visualizerId) {
        const layerIds = this.layersByVisualizer.get(visualizerId) || [];
        const layers = layerIds.map(id => this.layers.get(id)).filter(l => l);

        // Topological sort
        const sorted = this.topologicalSort(layers);

        for (const layer of sorted) {
            if (layer.type === 'transform') {
                await layer.compute(this);
            }
        }
    }

    /**
     * Topological sort for layer dependencies
     */
    topologicalSort(layers) {
        const sorted = [];
        const visited = new Set();
        const visiting = new Set();

        const visit = (layer) => {
            if (visited.has(layer.id)) return;
            if (visiting.has(layer.id)) {
                throw new Error(`Circular dependency detected: ${layer.name}`);
            }

            visiting.add(layer.id);

            // Visit dependencies first
            layer.inputLayerIds.forEach(depId => {
                const dep = this.layers.get(depId);
                if (dep) visit(dep);
            });

            visiting.delete(layer.id);
            visited.add(layer.id);
            sorted.push(layer);
        };

        layers.forEach(layer => visit(layer));

        return sorted;
    }

    /**
     * Get all layers for a visualizer
     */
    getLayersForVisualizer(visualizerId) {
        const layerIds = this.layersByVisualizer.get(visualizerId) || [];
        return layerIds.map(id => this.layers.get(id)).filter(l => l);
    }

    /**
     * Get layer by ID
     */
    getLayer(layerId) {
        return this.layers.get(layerId);
    }

    /**
     * Update layer data (for data layers when visualizer data changes)
     */
    updateLayerData(layerId, newData) {
        const layer = this.layers.get(layerId);
        if (!layer || layer.type !== 'data') return;

        layer.outputData = newData;
        layer.computeStatus = 'complete';

        // Recompute dependent layers
        this.recomputeDependentLayers(layerId);

        // Publish update
        PubSub.publish(`layer:${layerId}:computed`, {
            layerId: layerId,
            outputData: layer.outputData
        });
    }

    /**
     * Save layers to PubSub/localStorage
     */
    saveLayers(visualizerId) {
        const layers = this.getLayersForVisualizer(visualizerId);
        const state = layers.map(l => l.toJSON());

        PubSub.publish(`visualizer:${visualizerId}:layers`, state);
    }

    /**
     * Restore layers from PubSub/localStorage
     */
    async restoreLayers(visualizerId) {
        const state = PubSub.last(`visualizer:${visualizerId}:layers`);
        if (!state || state.length === 0) return;

        console.log(`LayerManager: Restoring ${state.length} layer(s) for visualizer ${visualizerId}`);

        // Create layers (don't compute yet - will be updated when base data loads)
        for (const layerData of state) {
            const layer = new Layer(layerData);
            this.layers.set(layer.id, layer);

            if (!this.layersByVisualizer.has(visualizerId)) {
                this.layersByVisualizer.set(visualizerId, []);
            }
            this.layersByVisualizer.get(visualizerId).push(layer.id);
        }

        // Don't compute yet - let base layer data be updated naturally when CSV loads
        // Derived layers will auto-recompute via updateLayerData -> recomputeDependentLayers
    }
}

// Singleton instance
export const layerManager = new LayerManager();
