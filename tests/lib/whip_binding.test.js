import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WhipBinding } from '../../lib/whip_binding.js';
import { PubSub } from '../../lib/pubsub.js';

describe('WhipBinding', () => {
    let binding;
    let mockComponent;

    beforeEach(() => {
        // Clear PubSub
        PubSub.clearAllCallbacks();

        // Create mock component as a real DOM element
        mockComponent = document.createElement('div');
        mockComponent.id = 'test-component';
        mockComponent.setWhippableValue = vi.fn();

        // Add to DOM
        document.body.appendChild(mockComponent);

        // Create binding
        binding = new WhipBinding({
            sourcePlayheadId: 'playhead-1',
            sourceVisualizerId: 'viz-1',
            targetComponentId: 'test-component',
            targetParameterId: 'testParam',
            mappingFunction: 'linear',
            color: '#ff0000',
            enabled: true,
        });
    });

    afterEach(() => {
        if (mockComponent && mockComponent.parentNode) {
            mockComponent.parentNode.removeChild(mockComponent);
        }
        PubSub.clearAllCallbacks();
    });

    describe('Initialization', () => {
        it('should initialize with correct properties', () => {
            expect(binding.sourcePlayheadId).toBe('playhead-1');
            expect(binding.sourceVisualizerId).toBe('viz-1');
            expect(binding.targetComponentId).toBe('test-component');
            expect(binding.targetParameterId).toBe('testParam');
            expect(binding.mappingFunction).toBe('linear');
            expect(binding.color).toBe('#ff0000');
            expect(binding.enabled).toBe(true);
        });

        it('should generate unique ID', () => {
            const binding2 = new WhipBinding({
                sourcePlayheadId: 'playhead-2',
                sourceVisualizerId: 'viz-2',
                targetComponentId: 'component-2',
                targetParameterId: 'param2',
            });

            expect(binding.id).toBeTruthy();
            expect(binding2.id).toBeTruthy();
            expect(binding.id).not.toBe(binding2.id);
        });

        it('should default to enabled=true', () => {
            const binding2 = new WhipBinding({
                sourcePlayheadId: 'playhead-2',
                sourceVisualizerId: 'viz-2',
                targetComponentId: 'component-2',
                targetParameterId: 'param2',
            });

            expect(binding2.enabled).toBe(true);
        });
    });

    describe('Activation', () => {
        it('should subscribe to playhead value topic', () => {
            const subscribeSpy = vi.spyOn(PubSub, 'subscribe');

            binding.activate();

            expect(subscribeSpy).toHaveBeenCalledWith(
                'playhead:viz-1:playhead-1:value',
                expect.any(Function)
            );
        });

        it('should not activate if already activated', () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            binding.activate();
            binding.activate();

            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Already activated')
            );

            consoleWarnSpy.mockRestore();
        });
    });

    describe('Value Mapping', () => {
        it('should map linear values correctly', () => {
            binding.mappingFunction = 'linear';

            expect(binding.mapValue(0)).toBe(0);
            expect(binding.mapValue(0.5)).toBe(0.5);
            expect(binding.mapValue(1)).toBe(1);
        });

        it('should map exponential values correctly', () => {
            binding.mappingFunction = 'exponential';
            binding.mappingCurve = 2;

            expect(binding.mapValue(0)).toBe(0);
            expect(binding.mapValue(0.5)).toBeCloseTo(0.25);
            expect(binding.mapValue(1)).toBe(1);
        });

        it('should map inverse values correctly', () => {
            binding.mappingFunction = 'inverse';

            expect(binding.mapValue(0)).toBe(1);
            expect(binding.mapValue(0.5)).toBe(0.5);
            expect(binding.mapValue(1)).toBe(0);
        });

        it('should map logarithmic values correctly', () => {
            binding.mappingFunction = 'logarithmic';

            expect(binding.mapValue(0)).toBeCloseTo(0);
            expect(binding.mapValue(1)).toBeCloseTo(1);
            // Middle value should be greater than 0.5 (logarithmic curve starts fast, slows down)
            expect(binding.mapValue(0.5)).toBeGreaterThan(0.5);
        });

        it('should clamp values to 0-1 range', () => {
            binding.mappingFunction = 'linear';

            expect(binding.mapValue(-0.5)).toBe(0);
            expect(binding.mapValue(1.5)).toBe(1);
        });

        it('should default to linear for unknown mapping function', () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            binding.mappingFunction = 'unknown';

            expect(binding.mapValue(0.5)).toBe(0.5);
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Unknown mapping function')
            );

            consoleWarnSpy.mockRestore();
        });
    });

    describe('Applying Values to Target', () => {
        it('should call setWhippableValue on target component', () => {
            binding.activate();

            // Publish playhead value
            PubSub.publish('playhead:viz-1:playhead-1:value', {
                value: 0.5,
                rawValue: 100,
                position: 50,
                color: '#ff0000',
            });

            expect(mockComponent.setWhippableValue).toHaveBeenCalledWith('testParam', 0.5);
        });

        it('should apply mapped value, not original', () => {
            binding.mappingFunction = 'inverse';
            binding.activate();

            PubSub.publish('playhead:viz-1:playhead-1:value', {
                value: 0.25,
            });

            // Inverse of 0.25 is 0.75
            expect(mockComponent.setWhippableValue).toHaveBeenCalledWith('testParam', 0.75);
        });

        it('should not apply value if binding is disabled', () => {
            binding.enabled = false;
            binding.activate();

            PubSub.publish('playhead:viz-1:playhead-1:value', {
                value: 0.5,
            });

            expect(mockComponent.setWhippableValue).not.toHaveBeenCalled();
        });

        it('should handle missing target component gracefully', () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            // Remove component from DOM
            document.body.removeChild(mockComponent);

            binding.activate();

            PubSub.publish('playhead:viz-1:playhead-1:value', {
                value: 0.5,
            });

            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Target component')
            );

            consoleWarnSpy.mockRestore();
        });
    });

    describe('Enable/Disable', () => {
        it('should enable and disable binding', () => {
            expect(binding.enabled).toBe(true);

            binding.setEnabled(false);
            expect(binding.enabled).toBe(false);

            binding.setEnabled(true);
            expect(binding.enabled).toBe(true);
        });
    });

    describe('Mapping Function Changes', () => {
        it('should update mapping function', () => {
            binding.setMappingFunction('exponential', 3);

            expect(binding.mappingFunction).toBe('exponential');
            expect(binding.mappingCurve).toBe(3);
        });

        it('should use default curve if not provided', () => {
            binding.setMappingFunction('exponential');

            expect(binding.mappingCurve).toBe(2);
        });
    });

    describe('Serialization', () => {
        it('should serialize to JSON', () => {
            const json = binding.toJSON();

            expect(json).toEqual({
                id: binding.id,
                sourcePlayheadId: 'playhead-1',
                sourceVisualizerId: 'viz-1',
                targetComponentId: 'test-component',
                targetParameterId: 'testParam',
                mappingFunction: 'linear',
                mappingCurve: 2,
                color: '#ff0000',
                enabled: true,
            });
        });

        it('should deserialize from JSON', () => {
            const json = {
                id: 'test-binding-123',
                sourcePlayheadId: 'playhead-2',
                sourceVisualizerId: 'viz-2',
                targetComponentId: 'component-2',
                targetParameterId: 'param2',
                mappingFunction: 'exponential',
                mappingCurve: 3,
                color: '#00ff00',
                enabled: false,
            };

            const restored = WhipBinding.fromJSON(json);

            expect(restored.id).toBe('test-binding-123');
            expect(restored.sourcePlayheadId).toBe('playhead-2');
            expect(restored.sourceVisualizerId).toBe('viz-2');
            expect(restored.targetComponentId).toBe('component-2');
            expect(restored.targetParameterId).toBe('param2');
            expect(restored.mappingFunction).toBe('exponential');
            expect(restored.mappingCurve).toBe(3);
            expect(restored.color).toBe('#00ff00');
            expect(restored.enabled).toBe(false);
        });
    });

    describe('Display Name', () => {
        it('should generate display name', () => {
            expect(binding.getDisplayName()).toBe('viz-1/playhead-1 → test-component/testParam');
        });
    });

    describe('Static Constants', () => {
        it('should provide mapping function options', () => {
            expect(WhipBinding.MAPPING_FUNCTIONS).toBeInstanceOf(Array);
            expect(WhipBinding.MAPPING_FUNCTIONS.length).toBe(4);

            const functionValues = WhipBinding.MAPPING_FUNCTIONS.map(f => f.value);
            expect(functionValues).toContain('linear');
            expect(functionValues).toContain('exponential');
            expect(functionValues).toContain('inverse');
            expect(functionValues).toContain('logarithmic');
        });
    });
});
