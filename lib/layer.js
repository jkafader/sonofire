import { PubSub } from './pubsub.js';
import { transformWorker } from './transform_worker.js';

function generateId() {
    return `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export class Layer {
    constructor(config) {
        this.id = config.id || generateId();
        this.name = config.name;
        this.type = config.type;  // 'data' (original) | 'transform' (derived)
        this.visualizerId = config.visualizerId;  // Parent visualizer

        // Source configuration (for transform layers)
        this.inputLayerIds = config.inputLayerIds || [];  // Can derive from other layers

        // Transform configuration
        this.transformType = config.transformType;  // 'dwt', 'fft', 'average', 'percentile', etc.
        this.transformParams = config.transformParams || {};

        // Output data - THIS IS THE CONTOUR
        this.outputData = config.outputData || [];  // Array of {x, y} points
        this.computeStatus = config.computeStatus || 'pending';  // 'pending' | 'computing' | 'complete' | 'error'

        // Visual properties
        this.visible = config.visible !== false;
        this.opacity = config.opacity || 0.67;  // 33% transparent = 67% opacity
        this.color = config.color || this.generateColor();
        this.selected = config.selected || false;

        // Whip source
        this.isContourSource = true;  // Indicates this has a square whip source
    }

    generateColor() {
        const colors = ['#4FC3F7', '#f39c12', '#e74c3c', '#9b59b6', '#2ecc71', '#e67e22', '#1abc9c', '#f1c40f'];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    // Compute output based on inputs
    async compute(layerManager) {
        this.computeStatus = 'computing';

        try {
            const inputData = await this.getInputData(layerManager);

            let result;
            switch (this.transformType) {
                case 'peak_detection':
                    result = await transformWorker.compute('peak_detection', inputData, this.transformParams);
                    break;
                case 'outlier_detection':
                    result = await transformWorker.compute('outlier_detection', inputData, this.transformParams);
                    break;
                case 'fft_lowpass':
                    result = await transformWorker.compute('fft_lowpass', inputData, this.transformParams);
                    break;
                case 'fft_highpass':
                    result = await transformWorker.compute('fft_highpass', inputData, this.transformParams);
                    break;
                case 'fft_bandpass':
                    result = await transformWorker.compute('fft_bandpass', inputData, this.transformParams);
                    break;
                case 'fft_dominant':
                    result = await transformWorker.compute('fft_dominant', inputData, this.transformParams);
                    break;
                case 'moving_average':
                    result = await transformWorker.compute('moving_average', inputData, this.transformParams);
                    break;
                case 'windowed_average':
                    result = await transformWorker.compute('windowed_average', inputData, this.transformParams);
                    break;
                case 'static_average':
                    result = await transformWorker.compute('static_average', inputData, this.transformParams);
                    break;
                case 'percentile':
                    result = await transformWorker.compute('percentile', inputData, this.transformParams);
                    break;
                case 'min_max':
                    result = await transformWorker.compute('min_max', inputData, this.transformParams);
                    break;
                case 'difference':
                    result = await transformWorker.compute('difference', inputData, this.transformParams);
                    break;
                case 'intersections':
                    result = await transformWorker.compute('intersections', inputData, this.transformParams);
                    break;
                default:
                    throw new Error(`Unknown transform type: ${this.transformType}`);
            }

            this.outputData = result;
            this.computeStatus = 'complete';

            // Publish update event
            PubSub.publish(`layer:${this.id}:computed`, {
                layerId: this.id,
                outputData: this.outputData
            });

        } catch (error) {
            this.computeStatus = 'error';
            console.error(`Layer ${this.name} (${this.transformType}) computation failed:`, error);
            console.error('Input layer IDs:', this.inputLayerIds);
            console.error('Transform params:', this.transformParams);
        }
    }

    async getInputData(layerManager) {
        if (this.type === 'data') {
            // Get from parent visualizer's CSV data
            const viz = document.getElementById(this.visualizerId);
            if (!viz || !viz.data) {
                throw new Error(`Visualizer ${this.visualizerId} not found or has no data`);
            }
            return viz.data;
        } else {
            // Get from input layers
            const outputs = [];
            for (const layerId of this.inputLayerIds) {
                const layer = layerManager.getLayer(layerId);
                if (layer && layer.outputData) {
                    outputs.push(layer.outputData);
                }
            }

            // Multi-input transforms (like 'difference', 'intersections') need array of inputs
            const multiInputTransforms = ['difference', 'intersections'];
            if (multiInputTransforms.includes(this.transformType)) {
                return outputs;  // Always return array for multi-input transforms
            }

            // Single-input transforms get first output directly
            return this.inputLayerIds.length === 1 ? outputs[0] : outputs;
        }
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            type: this.type,
            visualizerId: this.visualizerId,
            inputLayerIds: this.inputLayerIds,
            transformType: this.transformType,
            transformParams: this.transformParams,
            outputData: this.outputData,
            computeStatus: this.computeStatus,
            visible: this.visible,
            opacity: this.opacity,
            color: this.color,
            selected: this.selected
        };
    }
}
