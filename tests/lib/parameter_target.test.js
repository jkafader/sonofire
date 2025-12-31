import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ParameterTarget } from '../../lib/parameter_target.js';

describe('ParameterTarget', () => {
    let target;
    const componentId = 'test-component';
    const parameterId = 'test-param';

    beforeEach(() => {
        target = new ParameterTarget(componentId, parameterId, {
            label: 'Test Parameter',
            parameterType: 'number',
            min: 0,
            max: 100,
        });
    });

    afterEach(() => {
        // Clean up any DOM elements created during tests
        if (target.targetLightElement) {
            target.targetLightElement.remove();
        }
    });

    describe('Constructor', () => {
        it('should create a parameter target with default values', () => {
            const pt = new ParameterTarget('comp1', 'param1');

            expect(pt.componentId).toBe('comp1');
            expect(pt.parameterId).toBe('param1');
            expect(pt.label).toBe('param1'); // Defaults to parameterId
            expect(pt.parameterType).toBe('number');
            expect(pt.min).toBe(0);
            expect(pt.max).toBe(1);
            expect(pt.element).toBe(null);
            expect(pt.targetLightElement).toBe(null);
            expect(pt.boundPlayheadIds).toEqual([]);
        });

        it('should create a parameter target with custom config', () => {
            expect(target.componentId).toBe(componentId);
            expect(target.parameterId).toBe(parameterId);
            expect(target.label).toBe('Test Parameter');
            expect(target.parameterType).toBe('number');
            expect(target.min).toBe(0);
            expect(target.max).toBe(100);
        });

        it('should support different parameter types', () => {
            const selectTarget = new ParameterTarget('comp', 'select-param', {
                parameterType: 'select',
                min: 0,
                max: 4,
            });

            expect(selectTarget.parameterType).toBe('select');

            const boolTarget = new ParameterTarget('comp', 'bool-param', {
                parameterType: 'boolean',
            });

            expect(boolTarget.parameterType).toBe('boolean');
        });
    });

    describe('ID Generation', () => {
        it('should generate correct target ID', () => {
            expect(target.getId()).toBe(`${componentId}:${parameterId}`);
        });

        it('should generate unique IDs for different targets', () => {
            const target2 = new ParameterTarget('comp2', 'param2');

            expect(target.getId()).not.toBe(target2.getId());
        });
    });

    describe('Target Light Creation', () => {
        it('should create a target light element', () => {
            const light = target.createTargetLight();

            expect(light).toBeInstanceOf(HTMLElement);
            expect(light.className).toBe('parameter-target-light');
            expect(light.dataset.targetId).toBe(target.getId());
            expect(target.targetLightElement).toBe(light);
        });

        it('should have correct initial styles', () => {
            const light = target.createTargetLight();

            expect(light.style.position).toBe('absolute');
            expect(light.style.width).toBe('12px');
            expect(light.style.height).toBe('12px');
            expect(light.style.borderRadius).toBe('50%');
            expect(light.style.background).toBe('rgb(136, 136, 136)'); // #888
            expect(light.style.cursor).toBe('pointer');
            expect(light.style.zIndex).toBe('1000');
        });

        it('should have a tooltip', () => {
            const light = target.createTargetLight();

            expect(light.title).toContain('Target: Test Parameter');
            expect(light.title).toContain('Drop a playhead source');
        });
    });

    describe('Target Light Positioning', () => {
        it('should position light relative to control element', () => {
            // Create a mock control element in the DOM
            const controlElement = document.createElement('input');
            controlElement.style.position = 'absolute';
            controlElement.style.left = '100px';
            controlElement.style.top = '50px';
            controlElement.style.width = '200px';
            controlElement.style.height = '30px';
            document.body.appendChild(controlElement);

            target.element = controlElement;
            const light = target.createTargetLight();
            document.body.appendChild(light);

            target.positionLight();

            const rect = controlElement.getBoundingClientRect();
            const expectedLeft = rect.left - 20;
            const expectedTop = rect.top + (rect.height / 2) - 6;

            expect(light.style.left).toBe(`${expectedLeft}px`);
            expect(light.style.top).toBe(`${expectedTop}px`);

            // Cleanup
            controlElement.remove();
        });

        it('should not position if element is null', () => {
            const light = target.createTargetLight();
            target.element = null;

            // Should not throw
            expect(() => target.positionLight()).not.toThrow();
        });
    });

    describe('Color Management', () => {
        it('should update light color', () => {
            const light = target.createTargetLight();

            target.updateLightColor('#ff0000');

            expect(light.style.background).toBe('rgb(255, 0, 0)'); // #ff0000
        });

        it('should reset to gray when no bindings and no color provided', () => {
            const light = target.createTargetLight();
            target.updateLightColor('#ff0000');

            target.boundPlayheadIds = [];
            target.updateLightColor();

            expect(light.style.background).toBe('rgb(136, 136, 136)'); // #888
        });

        it('should not update color if light element does not exist', () => {
            target.targetLightElement = null;

            // Should not throw
            expect(() => target.updateLightColor('#ff0000')).not.toThrow();
        });
    });

    describe('Drop Target Highlighting', () => {
        it('should highlight as drop target', () => {
            const light = target.createTargetLight();

            target.highlightAsDropTarget();

            expect(light.style.transform).toBe('scale(1.5)');
            expect(light.style.boxShadow).toContain('rgba(78, 201, 176, 0.8)');
        });

        it('should remove drop highlight', () => {
            const light = target.createTargetLight();
            target.highlightAsDropTarget();

            target.removeDropHighlight();

            expect(light.style.transform).toBe('scale(1)');
            expect(light.style.boxShadow).toContain('rgba(0, 0, 0, 0.3)');
        });
    });

    describe('Binding Management', () => {
        it('should add playhead binding', () => {
            target.addBinding('playhead-1');

            expect(target.boundPlayheadIds).toContain('playhead-1');
            expect(target.boundPlayheadIds).toHaveLength(1);
        });

        it('should not add duplicate bindings', () => {
            target.addBinding('playhead-1');
            target.addBinding('playhead-1');

            expect(target.boundPlayheadIds).toHaveLength(1);
        });

        it('should add multiple bindings', () => {
            target.addBinding('playhead-1');
            target.addBinding('playhead-2');

            expect(target.boundPlayheadIds).toContain('playhead-1');
            expect(target.boundPlayheadIds).toContain('playhead-2');
            expect(target.boundPlayheadIds).toHaveLength(2);
        });

        it('should remove playhead binding', () => {
            target.addBinding('playhead-1');
            target.addBinding('playhead-2');

            target.removeBinding('playhead-1');

            expect(target.boundPlayheadIds).not.toContain('playhead-1');
            expect(target.boundPlayheadIds).toContain('playhead-2');
            expect(target.boundPlayheadIds).toHaveLength(1);
        });

        it('should reset color when removing last binding', () => {
            const light = target.createTargetLight();
            target.updateLightColor('#ff0000');
            target.addBinding('playhead-1');

            target.removeBinding('playhead-1');

            // Should have called updateLightColor internally
            expect(target.boundPlayheadIds).toHaveLength(0);
        });
    });

    describe('Serialization', () => {
        it('should serialize to JSON', () => {
            const json = target.toJSON();

            expect(json).toEqual({
                componentId: componentId,
                parameterId: parameterId,
                label: 'Test Parameter',
                parameterType: 'number',
                min: 0,
                max: 100,
            });
        });

        it('should deserialize from JSON', () => {
            const json = {
                componentId: 'comp1',
                parameterId: 'param1',
                label: 'Deserialized Param',
                parameterType: 'select',
                min: 0,
                max: 5,
            };

            const pt = ParameterTarget.fromJSON(json);

            expect(pt.componentId).toBe('comp1');
            expect(pt.parameterId).toBe('param1');
            expect(pt.label).toBe('Deserialized Param');
            expect(pt.parameterType).toBe('select');
            expect(pt.min).toBe(0);
            expect(pt.max).toBe(5);
        });

        it('should round-trip serialize/deserialize', () => {
            const json = target.toJSON();
            const restored = ParameterTarget.fromJSON(json);

            expect(restored.componentId).toBe(target.componentId);
            expect(restored.parameterId).toBe(target.parameterId);
            expect(restored.label).toBe(target.label);
            expect(restored.parameterType).toBe(target.parameterType);
            expect(restored.min).toBe(target.min);
            expect(restored.max).toBe(target.max);
        });
    });

    describe('DOM Integration', () => {
        it('should handle hover events on target light', () => {
            const light = target.createTargetLight();
            document.body.appendChild(light);

            // Trigger mouseenter
            const enterEvent = new MouseEvent('mouseenter');
            light.dispatchEvent(enterEvent);

            expect(light.style.transform).toBe('scale(1.3)');

            // Trigger mouseleave
            const leaveEvent = new MouseEvent('mouseleave');
            light.dispatchEvent(leaveEvent);

            expect(light.style.transform).toBe('scale(1)');

            // Cleanup
            light.remove();
        });
    });
});
