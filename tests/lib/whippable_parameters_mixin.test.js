import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WhippableParametersMixin } from '../../lib/mixins/whippable_parameters.js';
import { PubSub } from '../../lib/pubsub.js';

// Create a mock base class (not extending HTMLElement to avoid custom element issues)
class MockBase {
    constructor() {
        this.id = 'test-component';
        this.tagName = 'TEST-COMPONENT';
        this._children = [];
    }

    publish(topic, data) {
        PubSub.publish(topic, data);
    }

    $(selector) {
        // Simple mock querySelector
        return this._children.find(el => el.id === selector.replace('#', ''));
    }

    querySelector(selector) {
        return this.$(selector);
    }

    appendChild(child) {
        this._children.push(child);
    }
}

// Apply the mixin
const TestComponent = WhippableParametersMixin(MockBase);

describe('WhippableParametersMixin', () => {
    let component;

    beforeEach(() => {
        // Clear PubSub
        PubSub.clearAllCallbacks();

        // Create component instance directly (not via createElement)
        component = new TestComponent();
    });

    afterEach(() => {
        // Clean up target light containers
        document.querySelectorAll('.target-light-container').forEach(el => el.remove());
    });

    describe('Initialization', () => {
        it('should initialize whippableParameters Map', () => {
            expect(component.whippableParameters).toBeInstanceOf(Map);
            expect(component.whippableParameters.size).toBe(0);
        });

        it('should initialize targetLightContainer as null', () => {
            expect(component.targetLightContainer).toBe(null);
        });
    });

    describe('Parameter Registration', () => {
        it('should register a parameter', () => {
            const publishSpy = vi.spyOn(PubSub, 'publish');

            component.registerWhippableParameter('testParam', {
                label: 'Test Parameter',
                parameterType: 'number',
                min: 0,
                max: 100,
            });

            expect(component.whippableParameters.has('testParam')).toBe(true);
            const target = component.whippableParameters.get('testParam');

            expect(target.componentId).toBe('test-component');
            expect(target.parameterId).toBe('testParam');
            expect(target.label).toBe('Test Parameter');
            expect(target.parameterType).toBe('number');
            expect(target.min).toBe(0);
            expect(target.max).toBe(100);

            expect(publishSpy).toHaveBeenCalledWith(
                'parameter:target:register',
                expect.objectContaining({
                    componentId: 'test-component',
                    parameterId: 'testParam',
                    label: 'Test Parameter',
                })
            );
        });

        it('should attach to element if selector provided', () => {
            const input = { id: 'test-input', tagName: 'INPUT' };
            component.appendChild(input);

            component.registerWhippableParameter('testParam', {
                elementSelector: '#test-input',
            });

            const target = component.whippableParameters.get('testParam');
            expect(target.element).toBe(input);
        });

        it('should store setter function if provided', () => {
            const setter = vi.fn();

            component.registerWhippableParameter('testParam', {
                setter: setter,
            });

            const target = component.whippableParameters.get('testParam');
            expect(target.setter).toBe(setter);
        });
    });

    describe('Parameter Unregistration', () => {
        it('should unregister a parameter', () => {
            const publishSpy = vi.spyOn(PubSub, 'publish');

            component.registerWhippableParameter('testParam', {});

            expect(component.whippableParameters.has('testParam')).toBe(true);

            component.unregisterWhippableParameter('testParam');

            expect(component.whippableParameters.has('testParam')).toBe(false);
            expect(publishSpy).toHaveBeenCalledWith(
                'parameter:target:unregister',
                {
                    componentId: 'test-component',
                    parameterId: 'testParam',
                }
            );
        });

        it('should remove target light from DOM when unregistering', () => {
            component.registerWhippableParameter('testParam', {});
            component.createTargetLightContainer();
            component.renderTargetLights();

            const target = component.whippableParameters.get('testParam');
            const light = target.targetLightElement;

            expect(document.body.contains(light)).toBe(true);

            component.unregisterWhippableParameter('testParam');

            expect(document.body.contains(light)).toBe(false);
        });
    });

    describe('Setting Whippable Values', () => {
        it('should map normalized value to number parameter range', () => {
            const setter = vi.fn();

            component.registerWhippableParameter('testParam', {
                parameterType: 'number',
                min: 0,
                max: 100,
                setter: setter,
            });

            component.setWhippableValue('testParam', 0.5);

            expect(setter).toHaveBeenCalledWith(50);
        });

        it('should map normalized value to boolean parameter', () => {
            const setter = vi.fn();

            component.registerWhippableParameter('testParam', {
                parameterType: 'boolean',
                setter: setter,
            });

            component.setWhippableValue('testParam', 0.7);
            expect(setter).toHaveBeenCalledWith(true);

            setter.mockClear();

            component.setWhippableValue('testParam', 0.3);
            expect(setter).toHaveBeenCalledWith(false);
        });

        it('should publish parameter change event', () => {
            const publishSpy = vi.spyOn(PubSub, 'publish');

            component.registerWhippableParameter('testParam', {
                parameterType: 'number',
                min: 0,
                max: 100,
            });

            component.setWhippableValue('testParam', 0.75);

            expect(publishSpy).toHaveBeenCalledWith(
                'parameter:test-component:testParam:changed',
                expect.objectContaining({
                    componentId: 'test-component',
                    parameterId: 'testParam',
                    value: 75,
                    normalizedValue: 0.75,
                    source: 'whip',
                })
            );
        });

        it('should handle unknown parameter gracefully', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            component.setWhippableValue('unknownParam', 0.5);

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Unknown whippable parameter "unknownParam"')
            );

            consoleSpy.mockRestore();
        });
    });

    describe('Target Light Container', () => {
        it('should create target light container', () => {
            component.createTargetLightContainer();

            expect(component.targetLightContainer).toBeInstanceOf(HTMLElement);
            expect(component.targetLightContainer.className).toBe('target-light-container');
            expect(component.targetLightContainer.style.position).toBe('fixed');
            expect(component.targetLightContainer.style.zIndex).toBe('999');
            expect(document.body.contains(component.targetLightContainer)).toBe(true);
        });

        it('should not create duplicate containers', () => {
            component.createTargetLightContainer();
            const firstContainer = component.targetLightContainer;

            component.createTargetLightContainer();

            expect(component.targetLightContainer).toBe(firstContainer);
        });
    });

    describe('Rendering Target Lights', () => {
        it('should render target lights for all registered parameters', () => {
            component.registerWhippableParameter('param1', {});
            component.registerWhippableParameter('param2', {});

            component.renderTargetLights();

            const param1Target = component.whippableParameters.get('param1');
            const param2Target = component.whippableParameters.get('param2');

            expect(param1Target.targetLightElement).toBeTruthy();
            expect(param2Target.targetLightElement).toBeTruthy();

            expect(component.targetLightContainer.children.length).toBe(2);
        });

        it('should clear existing lights before re-rendering', () => {
            component.registerWhippableParameter('param1', {});
            component.renderTargetLights();

            const firstLight = component.whippableParameters.get('param1').targetLightElement;

            component.renderTargetLights();

            const secondLight = component.whippableParameters.get('param1').targetLightElement;

            // Should be different instances
            expect(firstLight).not.toBe(secondLight);
        });
    });

    describe('Component ID', () => {
        it('should use id attribute if available', () => {
            component.id = 'custom-id';
            expect(component.getComponentId()).toBe('custom-id');
        });

        it('should fall back to tagName if no id', () => {
            component.id = '';
            expect(component.getComponentId()).toBe('test-component');
        });

        it('should return "unknown" if neither id nor tagName available', () => {
            const obj = { tagName: null };
            const result = TestComponent.prototype.getComponentId.call(obj);
            expect(result).toBe('unknown');
        });
    });

    describe('Cleanup on Disconnect', () => {
        it('should unregister all parameters on disconnect', () => {
            component.registerWhippableParameter('param1', {});
            component.registerWhippableParameter('param2', {});

            expect(component.whippableParameters.size).toBe(2);

            component.disconnectedCallback();

            expect(component.whippableParameters.size).toBe(0);
        });

        it('should remove target light container on disconnect', () => {
            component.createTargetLightContainer();
            const container = component.targetLightContainer;

            expect(document.body.contains(container)).toBe(true);

            component.disconnectedCallback();

            expect(document.body.contains(container)).toBe(false);
            expect(component.targetLightContainer).toBe(null);
        });
    });

    describe('Integration with Setter Functions', () => {
        it('should call setter with correct context', () => {
            let capturedThis = null;
            const setter = function(value) {
                capturedThis = this;
            };

            component.registerWhippableParameter('testParam', {
                parameterType: 'number',
                min: 0,
                max: 100,
                setter: setter,
            });

            component.setWhippableValue('testParam', 0.5);

            expect(capturedThis).toBe(component);
        });

        it('should allow setter to modify component state', () => {
            component.customValue = 0;

            component.registerWhippableParameter('testParam', {
                parameterType: 'number',
                min: 0,
                max: 100,
                setter: function(value) {
                    this.customValue = value;
                },
            });

            component.setWhippableValue('testParam', 0.8);

            expect(component.customValue).toBe(80);
        });
    });
});
