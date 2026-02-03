import { PubSub } from './pubsub.js';
import { ContourBinding } from './contour_binding.js';
import { layerManager } from './layer_manager.js';

/**
 * ContourBindingManager - Manages all contour bindings in the system
 *
 * Similar to WhipManager for scalar bindings, but handles contour-to-parameter bindings.
 * Automatically cleans up bindings when layers or parameters are removed.
 */
class ContourBindingManager {
    constructor() {
        this.bindings = new Map();  // bindingId -> ContourBinding
        this.initialized = false;
    }

    /**
     * Initialize the manager - restore saved bindings and subscribe to events
     */
    initialize() {
        if (this.initialized) return;

        // Restore saved bindings
        this.restoreBindings();

        // Subscribe to layer removal events (wildcard pattern)
        PubSub.subscribe('layer:*:removed', (data) => {
            this.removeBindingsForLayer(data.layerId);
        });

        // Subscribe to parameter unregistration
        PubSub.subscribe('contour-parameter:target:unregister', (data) => {
            this.removeBindingsForTarget(data.componentId, data.parameterId);
        });

        this.initialized = true;

        console.log('ContourBindingManager initialized');
    }

    /**
     * Register a new contour binding
     */
    registerBinding(binding) {
        this.bindings.set(binding.id, binding);
        binding.activate();

        this.saveBindings();

        PubSub.publish('contour-binding:register', binding);

        console.log(`Contour binding registered: ${binding.getDisplayName()}`);

        return binding;
    }

    /**
     * Remove a contour binding
     */
    removeBinding(bindingId) {
        const binding = this.bindings.get(bindingId);
        if (!binding) return;

        binding.deactivate();
        this.bindings.delete(bindingId);

        this.saveBindings();

        PubSub.publish('contour-binding:remove', { bindingId });

        console.log(`Contour binding removed: ${binding.getDisplayName()}`);
    }

    /**
     * Remove all bindings for a specific layer
     */
    removeBindingsForLayer(layerId) {
        const bindingsToRemove = Array.from(this.bindings.values())
            .filter(b => b.sourceLayerId === layerId);

        bindingsToRemove.forEach(b => this.removeBinding(b.id));
    }

    /**
     * Remove all bindings for a specific target
     */
    removeBindingsForTarget(componentId, parameterId) {
        const bindingsToRemove = Array.from(this.bindings.values())
            .filter(b => b.targetComponentId === componentId &&
                        (parameterId ? b.targetParameterId === parameterId : true));

        bindingsToRemove.forEach(b => this.removeBinding(b.id));
    }

    /**
     * Get all bindings for a specific layer
     */
    getBindingsForLayer(layerId) {
        return Array.from(this.bindings.values())
            .filter(b => b.sourceLayerId === layerId);
    }

    /**
     * Get all bindings for a specific target
     */
    getBindingsForTarget(componentId, parameterId) {
        return Array.from(this.bindings.values())
            .filter(b => b.targetComponentId === componentId &&
                        (parameterId ? b.targetParameterId === parameterId : true));
    }

    /**
     * Save all bindings to PubSub
     */
    saveBindings() {
        const state = {
            bindings: Array.from(this.bindings.values()).map(b => b.toJSON()),
            timestamp: Date.now()
        };

        PubSub.publish('contour:bindings:state', state);
    }

    /**
     * Restore bindings from PubSub
     * Retry mechanism for components that aren't loaded yet
     */
    restoreBindings() {
        const state = PubSub.last('contour:bindings:state');
        if (!state || !state.bindings || state.bindings.length === 0) return;

        const pendingBindings = [...state.bindings];
        let attemptCount = 0;
        const maxAttempts = 5;

        const tryRestore = () => {
            attemptCount++;
            const stillPending = [];

            pendingBindings.forEach(bindingData => {
                // Verify source layer exists
                const layer = layerManager.getLayer(bindingData.sourceLayerId);
                if (!layer) {
                    if (attemptCount < maxAttempts) {
                        stillPending.push(bindingData);
                    } else {
                        console.warn(`Cannot restore contour binding: source layer ${bindingData.sourceLayerId} not found`);
                    }
                    return;
                }

                // Verify target exists
                const targetElement = document.getElementById(bindingData.targetComponentId);
                if (!targetElement) {
                    if (attemptCount < maxAttempts) {
                        stillPending.push(bindingData);
                    } else {
                        console.warn(`Cannot restore contour binding: target ${bindingData.targetComponentId} not found`);
                    }
                    return;
                }

                // Both layer and target exist - restore binding
                const binding = ContourBinding.fromJSON(bindingData);
                this.bindings.set(binding.id, binding);
                binding.activate();
            });

            if (stillPending.length > 0 && attemptCount < maxAttempts) {
                // Some bindings still pending - try again in 500ms
                setTimeout(tryRestore, 500);
            } else {
                console.log(`Restored ${this.bindings.size} contour binding(s)`);
            }
        };

        // Start restoration attempts
        tryRestore();
    }
}

// Singleton instance
export const contourBindingManager = new ContourBindingManager();
