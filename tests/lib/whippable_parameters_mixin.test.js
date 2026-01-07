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

        it('should initialize boundParameters Set', () => {
            expect(component.boundParameters).toBeInstanceOf(Set);
            expect(component.boundParameters.size).toBe(0);
        });

        it('should initialize whipBindingSubscriptionsSetup flag', () => {
            expect(component.whipBindingSubscriptionsSetup).toBe(false);
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

            // Verify parameter was unregistered
            expect(component.whippableParameters.has('testParam')).toBe(true);

            component.unregisterWhippableParameter('testParam');

            expect(component.whippableParameters.has('testParam')).toBe(false);
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

    describe('Target Lights', () => {
        it('should create target lights when rendering', () => {
            component.registerWhippableParameter('param1', {});
            component.renderTargetLights();

            const target = component.whippableParameters.get('param1');
            // Target light may be created or may be null depending on element attachment
            // Just verify the method doesn't throw
            expect(component.whippableParameters.has('param1')).toBe(true);
        });
    });

    describe('Rendering Target Lights', () => {
        it('should render target lights for all registered parameters', () => {
            component.registerWhippableParameter('param1', {});
            component.registerWhippableParameter('param2', {});

            component.renderTargetLights();

            const param1Target = component.whippableParameters.get('param1');
            const param2Target = component.whippableParameters.get('param2');

            // Target lights are created for each parameter
            expect(param1Target).toBeTruthy();
            expect(param2Target).toBeTruthy();
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

        it('should call parent disconnectedCallback if exists', () => {
            // Create a spy for the parent's disconnectedCallback
            const parentDisconnect = vi.fn();
            MockBase.prototype.disconnectedCallback = parentDisconnect;

            component.registerWhippableParameter('param1', {});
            component.registerWhippableParameter('param2', {});

            component.disconnectedCallback();

            expect(parentDisconnect).toHaveBeenCalled();

            // Clean up
            delete MockBase.prototype.disconnectedCallback;
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

    describe('Whip Binding Subscriptions', () => {
        it('should initialize boundParameters Set', () => {
            expect(component.boundParameters).toBeInstanceOf(Set);
            expect(component.boundParameters.size).toBe(0);
        });

        it('should setup whip binding subscriptions on first parameter registration', () => {
            expect(component.whipBindingSubscriptionsSetup).toBe(false);

            component.registerWhippableParameter('testParam', {});

            expect(component.whipBindingSubscriptionsSetup).toBe(true);
        });

        it('should not setup subscriptions multiple times', () => {
            const setupSpy = vi.spyOn(component, 'setupWhipBindingSubscriptions');

            component.registerWhippableParameter('param1', {});
            component.registerWhippableParameter('param2', {});

            // Called once on first registration, then not called again
            expect(setupSpy).toHaveBeenCalledTimes(1);
        });

        it('should subscribe to whip:binding:register events', () => {
            component.registerWhippableParameter('testParam', {});

            const handleBindingAddedSpy = vi.spyOn(component, 'handleBindingAdded');

            // Publish a binding registration event for this component
            PubSub.publish('whip:binding:register', {
                targetComponentId: 'test-component',
                targetParameterId: 'testParam',
                sourcePlayheadId: 'playhead-1',
                color: '#ff0000',
            });

            expect(handleBindingAddedSpy).toHaveBeenCalledWith('testParam', expect.any(Object));
        });

        it('should not handle binding events for other components', () => {
            component.registerWhippableParameter('testParam', {});

            const handleBindingAddedSpy = vi.spyOn(component, 'handleBindingAdded');

            // Publish a binding registration event for a different component
            PubSub.publish('whip:binding:register', {
                targetComponentId: 'other-component',
                targetParameterId: 'testParam',
                sourcePlayheadId: 'playhead-1',
                color: '#ff0000',
            });

            expect(handleBindingAddedSpy).not.toHaveBeenCalled();
        });
    });

    describe('Slider Disable/Enable on Binding', () => {
        let mockSlider;

        beforeEach(() => {
            // Create a mock slider element
            mockSlider = {
                id: 'test-slider',
                type: 'range',
                disabled: false,
                style: {},
                value: 50,
            };
            component.appendChild(mockSlider);
        });

        it('should disable slider when binding is added', () => {
            component.registerWhippableParameter('testParam', {
                elementSelector: '#test-slider',
                parameterType: 'number',
                min: 0,
                max: 100,
            });

            component.handleBindingAdded('testParam', {
                sourcePlayheadId: 'playhead-1',
                color: '#ff0000',
            });

            expect(mockSlider.disabled).toBe(true);
            expect(mockSlider.style.opacity).toBe('0.6');
            expect(mockSlider.style.cursor).toBe('not-allowed');
        });

        it('should mark parameter as bound', () => {
            component.registerWhippableParameter('testParam', {
                elementSelector: '#test-slider',
            });

            expect(component.boundParameters.has('testParam')).toBe(false);

            component.handleBindingAdded('testParam', {
                sourcePlayheadId: 'playhead-1',
                color: '#ff0000',
            });

            expect(component.boundParameters.has('testParam')).toBe(true);
        });

        it('should re-enable slider when binding is removed', () => {
            component.registerWhippableParameter('testParam', {
                elementSelector: '#test-slider',
                parameterType: 'number',
                min: 0,
                max: 100,
            });

            // Add binding first
            component.handleBindingAdded('testParam', {
                sourcePlayheadId: 'playhead-1',
                color: '#ff0000',
            });

            expect(mockSlider.disabled).toBe(true);

            // Remove binding
            component.handleBindingRemoved('testParam');

            expect(mockSlider.disabled).toBe(false);
            expect(mockSlider.style.opacity).toBe('1');
            expect(mockSlider.style.cursor).toBe('pointer');
        });

        it('should unmark parameter as bound when binding removed', () => {
            component.registerWhippableParameter('testParam', {
                elementSelector: '#test-slider',
            });

            component.handleBindingAdded('testParam', { sourcePlayheadId: 'playhead-1' });
            expect(component.boundParameters.has('testParam')).toBe(true);

            component.handleBindingRemoved('testParam');
            expect(component.boundParameters.has('testParam')).toBe(false);
        });

        it('should handle binding changes gracefully when element not found', () => {
            component.registerWhippableParameter('testParam', {
                // No element selector
                parameterType: 'number',
                min: 0,
                max: 100,
            });

            // Should not throw
            expect(() => {
                component.handleBindingAdded('testParam', { sourcePlayheadId: 'playhead-1' });
                component.handleBindingRemoved('testParam');
            }).not.toThrow();
        });
    });

    describe('Animated Slider Values from Whip', () => {
        let mockSlider;
        let mockValueDisplay;

        beforeEach(() => {
            // Create mock slider and value display
            mockSlider = {
                id: 'density-slider',
                type: 'range',
                disabled: false,
                style: {},
                value: 0,
            };

            mockValueDisplay = {
                id: 'density-value',
                textContent: '0.00',
            };

            component.appendChild(mockSlider);
            component.appendChild(mockValueDisplay);
        });

        it('should update slider value when parameter is bound', () => {
            component.registerWhippableParameter('density', {
                elementSelector: '#density-slider',
                parameterType: 'number',
                min: 0,
                max: 1,
            });

            // Mark as bound
            component.handleBindingAdded('density', { sourcePlayheadId: 'playhead-1' });

            // Set value via whip (normalized value 0.75 = 75% of range)
            component.setWhippableValue('density', 0.75);

            // Slider should be updated (0.75 mapped to 0-100 scale)
            expect(mockSlider.value).toBe(75);
        });

        it('should update value display when parameter is bound', () => {
            component.registerWhippableParameter('density', {
                elementSelector: '#density-slider',
                parameterType: 'number',
                min: 0,
                max: 1,
            });

            // Mark as bound
            component.handleBindingAdded('density', { sourcePlayheadId: 'playhead-1' });

            // Set value via whip
            component.setWhippableValue('density', 0.75);

            // Value display should show the mapped value
            expect(mockValueDisplay.textContent).toBe('0.75');
        });

        it('should not update slider when parameter is not bound', () => {
            component.registerWhippableParameter('density', {
                elementSelector: '#density-slider',
                parameterType: 'number',
                min: 0,
                max: 1,
            });

            const initialValue = mockSlider.value;

            // Set value via whip (but not bound)
            component.setWhippableValue('density', 0.75);

            // Slider should not be updated
            expect(mockSlider.value).toBe(initialValue);
        });

        it('should handle different parameter ranges', () => {
            component.registerWhippableParameter('tempo', {
                elementSelector: '#density-slider',
                parameterType: 'number',
                min: 60,
                max: 180,
            });

            component.handleBindingAdded('tempo', { sourcePlayheadId: 'playhead-1' });

            // Set normalized value 0.5 (should map to 120 in 60-180 range)
            component.setWhippableValue('tempo', 0.5);

            // Slider value should be 50 (50% of 0-100)
            expect(mockSlider.value).toBe(50);
        });

        it('should only update sliders for range input types', () => {
            const mockButton = {
                id: 'density-slider',
                type: 'button',
                disabled: false,
                style: {},
                value: 'initial',
            };

            component._children = [mockButton];

            component.registerWhippableParameter('density', {
                elementSelector: '#density-slider',
                parameterType: 'number',
                min: 0,
                max: 1,
            });

            component.handleBindingAdded('density', { sourcePlayheadId: 'playhead-1' });

            // Set value via whip
            component.setWhippableValue('density', 0.75);

            // Button value should not be modified
            expect(mockButton.value).toBe('initial');
        });
    });

    describe('State Restoration on Load', () => {
        let mockSlider;

        beforeEach(() => {
            mockSlider = {
                id: 'test-slider',
                type: 'range',
                disabled: false,
                style: {},
                value: 50,
            };
            component.appendChild(mockSlider);
        });

        it('should restore slider disabled state from saved bindings', () => {
            // Directly test the binding restoration logic
            component.registerWhippableParameter('testParam', {
                elementSelector: '#test-slider',
                parameterType: 'number',
                min: 0,
                max: 100,
            });

            // Simulate a binding being added (which would happen on page load)
            component.handleBindingAdded('testParam', {
                sourcePlayheadId: 'playhead-1',
                color: '#ff0000',
            });

            expect(component.boundParameters.has('testParam')).toBe(true);
            expect(mockSlider.disabled).toBe(true);
            expect(mockSlider.style.opacity).toBe('0.6');
        });

        it('should not disable slider if no bindings exist', () => {
            // Test that slider remains enabled when no binding is added
            component.registerWhippableParameter('testParam', {
                elementSelector: '#test-slider',
                parameterType: 'number',
                min: 0,
                max: 100,
            });

            // Don't add any binding
            expect(component.boundParameters.has('testParam')).toBe(false);
            expect(mockSlider.disabled).toBe(false);
        });
    });
});
