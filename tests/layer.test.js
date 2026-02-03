import { describe, test, expect, beforeEach } from 'vitest';
import { Layer } from '../lib/layer.js';

describe('Layer', () => {
    let mockLayerManager;

    beforeEach(() => {
        mockLayerManager = {
            getLayer: (id) => null
        };
    });

    describe('Layer Creation', () => {
        test('should create a data layer', () => {
            const layer = new Layer({
                name: 'Test Data',
                type: 'data',
                visualizerId: 'viz-1'
            });

            expect(layer.name).toBe('Test Data');
            expect(layer.type).toBe('data');
            expect(layer.visualizerId).toBe('viz-1');
            expect(layer.isContourSource).toBe(true);
            expect(layer.computeStatus).toBe('pending');
        });

        test('should create a transform layer', () => {
            const layer = new Layer({
                name: 'Moving Average',
                type: 'transform',
                transformType: 'moving_average',
                transformParams: { windowSize: 10 },
                inputLayerIds: ['layer-1'],
                visualizerId: 'viz-1'
            });

            expect(layer.type).toBe('transform');
            expect(layer.transformType).toBe('moving_average');
            expect(layer.transformParams.windowSize).toBe(10);
            expect(layer.inputLayerIds).toEqual(['layer-1']);
        });

        test('should generate unique IDs', () => {
            const layer1 = new Layer({ name: 'L1', type: 'data', visualizerId: 'v1' });
            const layer2 = new Layer({ name: 'L2', type: 'data', visualizerId: 'v1' });

            expect(layer1.id).not.toBe(layer2.id);
            expect(layer1.id).toMatch(/^layer-/);
        });

        test('should apply default values', () => {
            const layer = new Layer({
                name: 'Test',
                type: 'transform',
                transformType: 'peak_detection',
                visualizerId: 'viz-1'
            });

            expect(layer.visible).toBe(true);
            expect(layer.opacity).toBe(0.67);
            expect(layer.selected).toBe(false);
            expect(layer.inputLayerIds).toEqual([]);
            expect(layer.transformParams).toEqual({});
        });
    });

    describe('Layer Serialization', () => {
        test('should serialize to JSON', () => {
            const layer = new Layer({
                id: 'test-id',
                name: 'Test Layer',
                type: 'transform',
                transformType: 'fft_lowpass',
                transformParams: { cutoffFrequency: 0.1 },
                inputLayerIds: ['input-1'],
                visualizerId: 'viz-1',
                visible: true,
                opacity: 0.5,
                color: '#ff0000'
            });

            const json = layer.toJSON();

            expect(json.id).toBe('test-id');
            expect(json.name).toBe('Test Layer');
            expect(json.type).toBe('transform');
            expect(json.transformType).toBe('fft_lowpass');
            expect(json.transformParams).toEqual({ cutoffFrequency: 0.1 });
            expect(json.inputLayerIds).toEqual(['input-1']);
            expect(json.visible).toBe(true);
            expect(json.opacity).toBe(0.5);
            expect(json.color).toBe('#ff0000');
        });

        test('should restore from JSON', () => {
            const data = {
                id: 'restored-id',
                name: 'Restored',
                type: 'data',
                visualizerId: 'viz-1',
                outputData: [{ x: 0, y: 10, value: 10 }],
                computeStatus: 'complete'
            };

            const layer = new Layer(data);

            expect(layer.id).toBe('restored-id');
            expect(layer.name).toBe('Restored');
            expect(layer.outputData).toEqual([{ x: 0, y: 10, value: 10 }]);
            expect(layer.computeStatus).toBe('complete');
        });
    });

    describe('Color Generation', () => {
        test('should generate a color if none provided', () => {
            const layer = new Layer({
                name: 'Test',
                type: 'data',
                visualizerId: 'viz-1'
            });

            expect(layer.color).toMatch(/^#[0-9a-f]{6}$/i);
        });

        test('should use provided color', () => {
            const layer = new Layer({
                name: 'Test',
                type: 'data',
                visualizerId: 'viz-1',
                color: '#123456'
            });

            expect(layer.color).toBe('#123456');
        });
    });
});
