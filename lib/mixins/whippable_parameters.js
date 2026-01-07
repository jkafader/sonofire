import { ParameterTarget } from '../parameter_target.js';
import { PubSub } from '../pubsub.js';

/**
 * WhippableParametersMixin - Adds parameter registration capabilities to components
 *
 * Components that include this mixin can:
 * - Register parameters as whip targets
 * - Automatically create target lights next to parameter controls
 * - Receive whip binding updates via PubSub
 * - Apply parameter values from playhead data
 */
export const WhippableParametersMixin = (BaseClass) => class extends BaseClass {
    constructor() {
        super();
        this.whippableParameters = new Map(); // parameterId -> ParameterTarget
        this.boundParameters = new Set(); // Set of parameterId strings that have active whip bindings
        this.whipBindingSubscriptionsSetup = false; // Track if we've set up subscriptions
    }

    /**
     * Register a parameter as a whip target
     * @param {string} parameterId - Unique parameter identifier
     * @param {Object} config - Parameter configuration
     *   - label: Display label
     *   - parameterType: 'number', 'select', 'boolean'
     *   - min: Minimum value (for number type)
     *   - max: Maximum value (for number type)
     *   - elementSelector: Query selector for the control element (optional)
     *   - setter: Function to call when value changes (optional)
     */
    registerWhippableParameter(parameterId, config = {}) {
        const componentId = this.getComponentId();
        const target = new ParameterTarget(componentId, parameterId, config);

        this.whippableParameters.set(parameterId, target);

        // Find and attach to control element if selector provided
        if (config.elementSelector) {
            target.element = this.$(config.elementSelector);
        }

        // Store setter function if provided
        if (config.setter) {
            target.setter = config.setter;
        }

        // Setup whip binding subscriptions on first parameter registration
        if (!this.whipBindingSubscriptionsSetup) {
            this.setupWhipBindingSubscriptions();
            this.whipBindingSubscriptionsSetup = true;
        }

        // Publish registration event
        this.publish('parameter:target:register', target.toJSON());

        console.log(`${componentId}: Registered whippable parameter "${parameterId}"`);

        return target;
    }

    /**
     * Unregister a parameter
     * @param {string} parameterId
     */
    unregisterWhippableParameter(parameterId) {
        const target = this.whippableParameters.get(parameterId);
        if (!target) return;

        // Remove target light from DOM
        if (target.targetLightElement) {
            target.targetLightElement.remove();
        }

        // Publish unregistration event
        this.publish('parameter:target:unregister', {
            componentId: this.getComponentId(),
            parameterId: parameterId
        });

        this.whippableParameters.delete(parameterId);
    }

    /**
     * Set a parameter value (called by whip bindings)
     * @param {string} parameterId
     * @param {number} value - Normalized value (0-1) from playhead
     */
    setWhippableValue(parameterId, value) {
        const target = this.whippableParameters.get(parameterId);
        if (!target) {
            console.warn(`${this.getComponentId()}: Unknown whippable parameter "${parameterId}"`);
            return;
        }

        // Map normalized value to parameter range
        let mappedValue;
        let shouldTrigger = true;

        switch (target.parameterType) {
            case 'pulse':
                // Pulse: Trigger on EVERY value update (no threshold)
                // Used for note generation where we want a note on every playhead position
                mappedValue = 1;
                target.lastValue = value;
                // Always trigger
                break;
            case 'trigger':
                // Trigger on threshold crossing (bi-directional edge detection)
                const threshold = 0.5;
                const wasAbove = target.lastValue !== null && target.lastValue >= threshold;
                const wasBelow = target.lastValue !== null && target.lastValue < threshold;
                const nowAbove = value >= threshold;
                const nowBelow = value < threshold;

                // Trigger on any crossing of the threshold (rising or falling edge)
                shouldTrigger = (wasAbove && nowBelow) || (wasBelow && nowAbove);
                mappedValue = shouldTrigger ? 1 : 0;
                target.lastValue = value;
                if (!shouldTrigger) return; // Don't call setter unless triggered
                break;
            case 'number':
                mappedValue = target.min + (value * (target.max - target.min));
                break;
            case 'boolean':
                mappedValue = value > 0.5;
                break;
            case 'select':
                // For select, value represents index position
                // This will be implemented by specific components
                mappedValue = value;
                break;
            default:
                mappedValue = value;
        }

        // Update slider visual value if parameter is bound
        if (this.boundParameters.has(parameterId) && target.element) {
            if (target.parameterType === 'number') {
                // For range sliders, update the value
                if (target.element.type === 'range') {
                    const sliderValue = ((mappedValue - target.min) / (target.max - target.min)) * 100;
                    target.element.value = sliderValue;

                    // Also update associated value display if it exists
                    const valueDisplayId = target.element.id.replace('-slider', '-value');
                    const valueDisplay = this.$(`#${valueDisplayId}`);
                    if (valueDisplay) {
                        valueDisplay.textContent = mappedValue.toFixed(2);
                    }
                }
            }
        }

        // Call setter if provided
        if (target.setter) {
            target.setter.call(this, mappedValue);
        }

        // Publish parameter change event
        this.publish(`parameter:${this.getComponentId()}:${parameterId}:changed`, {
            componentId: this.getComponentId(),
            parameterId: parameterId,
            value: mappedValue,
            normalizedValue: value,
            source: 'whip'
        });

        console.log(`${this.getComponentId()}: Parameter "${parameterId}" set to ${mappedValue} (normalized: ${value})`);
    }

    /**
     * Render target lights for all registered parameters
     */
    renderTargetLights() {
        // Create and attach lights directly to their control elements
        this.whippableParameters.forEach((target, parameterId) => {
            // Remove old light if it exists
            if (target.targetLightElement) {
                target.targetLightElement.remove();
            }

            // Create new light
            target.createTargetLight();

            // Attach it to the DOM (pass component root for custom positioning)
            requestAnimationFrame(() => {
                target.attachLightToElement(this);
            });
        });

        // After all lights are attached, sync colors with existing bindings
        requestAnimationFrame(() => {
            this.syncTargetLightColors();
        });
    }

    /**
     * Sync target light colors and slider states with existing bindings
     * Call this after rendering target lights to restore colors from saved bindings
     */
    syncTargetLightColors() {
        // Import WhipManager dynamically to avoid circular dependency
        import('../whip_manager.js').then(({ WhipManager }) => {
            const componentId = this.getComponentId();

            this.whippableParameters.forEach((target, parameterId) => {
                // Get all bindings for this parameter
                const bindings = WhipManager.getBindingsForTarget(componentId, parameterId);

                if (bindings.length > 0) {
                    // Use the first binding's color (in future could blend multiple colors)
                    const binding = bindings[0];
                    if (binding.color) {
                        target.updateLightColor(binding.color);
                        console.log(`${componentId}: Synced color for "${parameterId}" to ${binding.color}`);
                    }

                    // Mark as bound and disable slider
                    this.boundParameters.add(parameterId);
                    if (target.element) {
                        target.element.disabled = true;
                        target.element.style.opacity = '0.6';
                        target.element.style.cursor = 'not-allowed';
                    }
                }
            });
        }).catch(err => {
            console.warn('Could not sync target light colors:', err);
        });
    }

    /**
     * Setup subscriptions for whip binding events
     * Call this during component initialization
     */
    setupWhipBindingSubscriptions() {
        const componentId = this.getComponentId();

        // Subscribe to binding registration
        PubSub.subscribe('whip:binding:register', (binding) => {
            if (binding.targetComponentId === componentId) {
                this.handleBindingAdded(binding.targetParameterId, binding);
            }
        });

        // Subscribe to binding removal
        PubSub.subscribe('whip:binding:remove', (data) => {
            // Need to check if this binding was for our component
            // We'll track this by checking our boundParameters set
            this.whippableParameters.forEach((target, parameterId) => {
                if (this.boundParameters.has(parameterId)) {
                    // Re-check if this parameter still has bindings
                    import('../whip_manager.js').then(({ WhipManager }) => {
                        const bindings = WhipManager.getBindingsForTarget(componentId, parameterId);
                        if (bindings.length === 0) {
                            this.handleBindingRemoved(parameterId);
                        }
                    });
                }
            });
        });
    }

    /**
     * Handle a binding being added to one of our parameters
     * @param {string} parameterId
     * @param {Object} binding
     */
    handleBindingAdded(parameterId, binding) {
        const target = this.whippableParameters.get(parameterId);
        if (!target) return;

        // Mark parameter as bound
        this.boundParameters.add(parameterId);

        // Disable the slider element
        if (target.element) {
            target.element.disabled = true;
            target.element.style.opacity = '0.6';
            target.element.style.cursor = 'not-allowed';
        }

        console.log(`${this.getComponentId()}: Parameter "${parameterId}" bound to whip, slider disabled`);
    }

    /**
     * Handle a binding being removed from one of our parameters
     * @param {string} parameterId
     */
    handleBindingRemoved(parameterId) {
        const target = this.whippableParameters.get(parameterId);
        if (!target) return;

        // Mark parameter as unbound
        this.boundParameters.delete(parameterId);

        // Re-enable the slider element
        if (target.element) {
            target.element.disabled = false;
            target.element.style.opacity = '1';
            target.element.style.cursor = 'pointer';
        }

        console.log(`${this.getComponentId()}: Parameter "${parameterId}" unbound from whip, slider enabled`);
    }

    /**
     * Get component ID for target identification
     * @returns {string}
     */
    getComponentId() {
        return this.id || this.tagName?.toLowerCase() || 'unknown';
    }

    /**
     * Cleanup target lights on disconnect
     */
    disconnectedCallback() {
        // Remove all target lights
        this.whippableParameters.forEach((target, parameterId) => {
            this.unregisterWhippableParameter(parameterId);
        });

        if (super.disconnectedCallback) {
            super.disconnectedCallback();
        }
    }
};
