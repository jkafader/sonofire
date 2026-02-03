import { describe, test, expect, beforeEach } from 'vitest';

// Mock PubSub for testing
const mockPubSub = {
    published: {},
    publish(topic, data) {
        this.published[topic] = data;
    },
    last(topic) {
        return this.published[topic];
    }
};

// Simplified LayerManager for testing core logic
class TestLayerManager {
    constructor() {
        this.layers = new Map();
        this.layersByVisualizer = new Map();
    }

    addLayer(visualizerId, config) {
        const layer = {
            id: `layer-${Date.now()}-${Math.random()}`,
            ...config,
            visualizerId
        };

        this.layers.set(layer.id, layer);

        if (!this.layersByVisualizer.has(visualizerId)) {
            this.layersByVisualizer.set(visualizerId, []);
        }
        this.layersByVisualizer.get(visualizerId).push(layer.id);

        return layer;
    }

    removeLayer(layerId) {
        const layer = this.layers.get(layerId);
        if (!layer) return;

        const visualizerId = layer.visualizerId;
        this.layers.delete(layerId);

        const vizLayers = this.layersByVisualizer.get(visualizerId);
        const index = vizLayers.indexOf(layerId);
        if (index >= 0) {
            vizLayers.splice(index, 1);
        }

        // Remove dependents
        const dependents = Array.from(this.layers.values())
            .filter(l => l.inputLayerIds && l.inputLayerIds.includes(layerId));
        dependents.forEach(dep => this.removeLayer(dep.id));
    }

    getLayer(layerId) {
        return this.layers.get(layerId);
    }

    getLayersForVisualizer(visualizerId) {
        const layerIds = this.layersByVisualizer.get(visualizerId) || [];
        return layerIds.map(id => this.layers.get(id)).filter(l => l);
    }

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

            if (layer.inputLayerIds) {
                layer.inputLayerIds.forEach(depId => {
                    const dep = this.layers.get(depId);
                    if (dep) visit(dep);
                });
            }

            visiting.delete(layer.id);
            visited.add(layer.id);
            sorted.push(layer);
        };

        layers.forEach(layer => visit(layer));
        return sorted;
    }
}

describe('LayerManager', () => {
    let manager;

    beforeEach(() => {
        manager = new TestLayerManager();
    });

    describe('Layer Management', () => {
        test('should add a layer', () => {
            const layer = manager.addLayer('viz-1', {
                name: 'Test Layer',
                type: 'data'
            });

            expect(layer.id).toBeDefined();
            expect(layer.name).toBe('Test Layer');
            expect(layer.visualizerId).toBe('viz-1');
        });

        test('should track layers by visualizer', () => {
            manager.addLayer('viz-1', { name: 'L1', type: 'data' });
            manager.addLayer('viz-1', { name: 'L2', type: 'data' });
            manager.addLayer('viz-2', { name: 'L3', type: 'data' });

            const viz1Layers = manager.getLayersForVisualizer('viz-1');
            const viz2Layers = manager.getLayersForVisualizer('viz-2');

            expect(viz1Layers.length).toBe(2);
            expect(viz2Layers.length).toBe(1);
        });

        test('should remove a layer', () => {
            const layer = manager.addLayer('viz-1', { name: 'Test', type: 'data' });
            expect(manager.getLayer(layer.id)).toBeDefined();

            manager.removeLayer(layer.id);
            expect(manager.getLayer(layer.id)).toBeUndefined();
        });

        test('should remove dependent layers when parent is removed', () => {
            const base = manager.addLayer('viz-1', { name: 'Base', type: 'data' });
            const derived = manager.addLayer('viz-1', {
                name: 'Derived',
                type: 'transform',
                transformType: 'moving_average',
                inputLayerIds: [base.id]
            });

            expect(manager.getLayer(derived.id)).toBeDefined();

            manager.removeLayer(base.id);

            expect(manager.getLayer(base.id)).toBeUndefined();
            expect(manager.getLayer(derived.id)).toBeUndefined(); // Should be removed
        });
    });

    describe('Topological Sort', () => {
        test('should sort layers with no dependencies', () => {
            const l1 = manager.addLayer('viz-1', { name: 'L1', type: 'data' });
            const l2 = manager.addLayer('viz-1', { name: 'L2', type: 'data' });
            const l3 = manager.addLayer('viz-1', { name: 'L3', type: 'data' });

            const layers = [l1, l2, l3];
            const sorted = manager.topologicalSort(layers);

            expect(sorted.length).toBe(3);
        });

        test('should sort layers with linear dependencies', () => {
            const base = manager.addLayer('viz-1', { name: 'Base', type: 'data' });
            const avg = manager.addLayer('viz-1', {
                name: 'Average',
                type: 'transform',
                transformType: 'moving_average',
                inputLayerIds: [base.id]
            });
            const diff = manager.addLayer('viz-1', {
                name: 'Difference',
                type: 'transform',
                transformType: 'difference',
                inputLayerIds: [base.id, avg.id]
            });

            const sorted = manager.topologicalSort([diff, avg, base]);

            // base should come before avg, avg should come before diff
            const baseIndex = sorted.findIndex(l => l.id === base.id);
            const avgIndex = sorted.findIndex(l => l.id === avg.id);
            const diffIndex = sorted.findIndex(l => l.id === diff.id);

            expect(baseIndex).toBeLessThan(avgIndex);
            expect(avgIndex).toBeLessThan(diffIndex);
        });

        test('should detect circular dependencies', () => {
            const l1 = manager.addLayer('viz-1', {
                name: 'L1',
                type: 'transform',
                transformType: 'moving_average',
                inputLayerIds: [] // Will be modified
            });
            const l2 = manager.addLayer('viz-1', {
                name: 'L2',
                type: 'transform',
                transformType: 'moving_average',
                inputLayerIds: [l1.id]
            });

            // Create circular dependency
            l1.inputLayerIds = [l2.id];

            expect(() => {
                manager.topologicalSort([l1, l2]);
            }).toThrow('Circular dependency');
        });

        test('should handle diamond dependencies', () => {
            //     base
            //     /  \
            //   avg  max
            //     \  /
            //     diff
            const base = manager.addLayer('viz-1', { name: 'Base', type: 'data' });
            const avg = manager.addLayer('viz-1', {
                name: 'Avg',
                type: 'transform',
                transformType: 'static_average',
                inputLayerIds: [base.id]
            });
            const max = manager.addLayer('viz-1', {
                name: 'Max',
                type: 'transform',
                transformType: 'min_max',
                inputLayerIds: [base.id]
            });
            const diff = manager.addLayer('viz-1', {
                name: 'Diff',
                type: 'transform',
                transformType: 'difference',
                inputLayerIds: [avg.id, max.id]
            });

            const sorted = manager.topologicalSort([diff, max, avg, base]);

            const baseIndex = sorted.findIndex(l => l.id === base.id);
            const avgIndex = sorted.findIndex(l => l.id === avg.id);
            const maxIndex = sorted.findIndex(l => l.id === max.id);
            const diffIndex = sorted.findIndex(l => l.id === diff.id);

            // base must come before avg and max
            expect(baseIndex).toBeLessThan(avgIndex);
            expect(baseIndex).toBeLessThan(maxIndex);
            // avg and max must come before diff
            expect(avgIndex).toBeLessThan(diffIndex);
            expect(maxIndex).toBeLessThan(diffIndex);
        });
    });

    describe('Multi-input Transforms', () => {
        test('should handle difference transform with two inputs', () => {
            const layerA = manager.addLayer('viz-1', { name: 'A', type: 'data' });
            const layerB = manager.addLayer('viz-1', { name: 'B', type: 'data' });
            const diff = manager.addLayer('viz-1', {
                name: 'Diff',
                type: 'transform',
                transformType: 'difference',
                inputLayerIds: [layerA.id, layerB.id]
            });

            expect(diff.inputLayerIds.length).toBe(2);
            expect(diff.inputLayerIds).toContain(layerA.id);
            expect(diff.inputLayerIds).toContain(layerB.id);
        });

        test('should handle intersections transform with two inputs', () => {
            const layerA = manager.addLayer('viz-1', { name: 'A', type: 'data' });
            const layerB = manager.addLayer('viz-1', { name: 'B', type: 'data' });
            const intersect = manager.addLayer('viz-1', {
                name: 'Crossings',
                type: 'transform',
                transformType: 'intersections',
                inputLayerIds: [layerA.id, layerB.id]
            });

            expect(intersect.inputLayerIds.length).toBe(2);
        });
    });
});
