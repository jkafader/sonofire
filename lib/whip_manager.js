import { PubSub } from './pubsub.js';
import { WhipBinding } from './whip_binding.js';

/**
 * WhipManager - Singleton that manages all whip bindings globally
 *
 * Responsibilities:
 * - Register and remove whip bindings
 * - Persist bindings to PubSub/localStorage
 * - Restore bindings on page load
 * - Coordinate between playheads and parameters
 * - Handle cleanup when playheads or parameters are removed
 */
class WhipManagerClass {
    constructor() {
        this.bindings = new Map(); // bindingId -> WhipBinding
        this.initialized = false;
    }

    /**
     * Initialize the manager (call once on app startup)
     */
    initialize() {
        if (this.initialized) return;

        console.log('WhipManager: Initializing');

        // Restore bindings from PubSub
        this.restoreBindings();

        // Subscribe to playhead removal events
        PubSub.subscribe('playhead:removed', (data) => {
            this.handlePlayheadRemoved(data);
        });

        // Subscribe to parameter unregistration events
        PubSub.subscribe('parameter:target:unregister', (data) => {
            this.handleParameterUnregistered(data);
        });

        this.initialized = true;
        console.log('WhipManager: Initialized');
    }

    /**
     * Register a new whip binding
     * @param {WhipBinding} binding - The binding to register
     */
    registerBinding(binding) {
        this.bindings.set(binding.id, binding);

        // Activate the binding (subscribe to playhead updates)
        binding.activate();

        // Update playhead's binding list
        this.updatePlayheadBindings(binding.sourceVisualizerId, binding.sourcePlayheadId, binding.id, 'add');

        // Update target's binding list
        this.updateTargetBindings(binding.targetComponentId, binding.targetParameterId, binding.id, 'add');

        // Save state
        this.saveBindings();

        // Publish registration event
        PubSub.publish('whip:binding:register', binding.toJSON());

        console.log(`WhipManager: Registered binding ${binding.id}`);
        return binding;
    }

    /**
     * Remove a whip binding
     * @param {string} bindingId - ID of the binding to remove
     */
    removeBinding(bindingId) {
        const binding = this.bindings.get(bindingId);
        if (!binding) {
            console.warn(`WhipManager: Binding ${bindingId} not found`);
            return;
        }

        // Deactivate the binding
        binding.deactivate();

        // Update playhead's binding list
        this.updatePlayheadBindings(binding.sourceVisualizerId, binding.sourcePlayheadId, bindingId, 'remove');

        // Update target's binding list
        this.updateTargetBindings(binding.targetComponentId, binding.targetParameterId, bindingId, 'remove');

        // Remove from map
        this.bindings.delete(bindingId);

        // Save state
        this.saveBindings();

        // Publish removal event
        PubSub.publish('whip:binding:remove', { id: bindingId });

        console.log(`WhipManager: Removed binding ${bindingId}`);
    }

    /**
     * Get all bindings for a specific playhead
     * @param {string} visualizerId
     * @param {string} playheadId
     * @returns {Array<WhipBinding>}
     */
    getBindingsForPlayhead(visualizerId, playheadId) {
        const result = [];
        this.bindings.forEach(binding => {
            if (binding.sourceVisualizerId === visualizerId &&
                binding.sourcePlayheadId === playheadId) {
                result.push(binding);
            }
        });
        return result;
    }

    /**
     * Get all bindings for a specific parameter target
     * @param {string} componentId
     * @param {string} parameterId
     * @returns {Array<WhipBinding>}
     */
    getBindingsForTarget(componentId, parameterId) {
        const result = [];
        this.bindings.forEach(binding => {
            if (binding.targetComponentId === componentId &&
                binding.targetParameterId === parameterId) {
                result.push(binding);
            }
        });
        return result;
    }

    /**
     * Get a binding by ID
     * @param {string} bindingId
     * @returns {WhipBinding|null}
     */
    getBinding(bindingId) {
        return this.bindings.get(bindingId) || null;
    }

    /**
     * Get all bindings
     * @returns {Array<WhipBinding>}
     */
    getAllBindings() {
        return Array.from(this.bindings.values());
    }

    /**
     * Update playhead's binding list
     * @private
     */
    updatePlayheadBindings(visualizerId, playheadId, bindingId, action) {
        // Find the visualizer component
        const visualizer = document.getElementById(visualizerId) ||
                          document.querySelector(visualizerId);

        if (!visualizer || !visualizer.playheads) return;

        // Find the playhead
        const playhead = visualizer.playheads.find(ph => ph.id === playheadId);
        if (!playhead) return;

        // Update binding list
        if (action === 'add') {
            playhead.addBinding(bindingId);
        } else if (action === 'remove') {
            playhead.removeBinding(bindingId);
        }

        // Save playhead state
        if (typeof visualizer.savePlayheads === 'function') {
            visualizer.savePlayheads();
        }
    }

    /**
     * Update parameter target's binding list
     * @private
     */
    updateTargetBindings(componentId, parameterId, bindingId, action) {
        // Find the target component
        const component = document.getElementById(componentId) ||
                         document.querySelector(componentId);

        if (!component || !component.whippableParameters) return;

        // Find the parameter target
        const target = component.whippableParameters.get(parameterId);
        if (!target) return;

        // Update binding list and color
        if (action === 'add') {
            target.addBinding(bindingId);
            const binding = this.bindings.get(bindingId);
            if (binding && binding.color) {
                target.updateLightColor(binding.color);
            }
        } else if (action === 'remove') {
            target.removeBinding(bindingId);
        }
    }

    /**
     * Handle playhead removal
     * @private
     */
    handlePlayheadRemoved(data) {
        const { visualizerId, playheadId } = data;

        // Find and remove all bindings from this playhead
        const bindingsToRemove = this.getBindingsForPlayhead(visualizerId, playheadId);

        bindingsToRemove.forEach(binding => {
            console.log(`WhipManager: Removing binding ${binding.id} due to playhead removal`);
            this.removeBinding(binding.id);
        });
    }

    /**
     * Handle parameter unregistration
     * @private
     */
    handleParameterUnregistered(data) {
        const { componentId, parameterId } = data;

        // Find and remove all bindings to this parameter
        const bindingsToRemove = this.getBindingsForTarget(componentId, parameterId);

        bindingsToRemove.forEach(binding => {
            console.log(`WhipManager: Removing binding ${binding.id} due to parameter unregistration`);
            this.removeBinding(binding.id);
        });
    }

    /**
     * Save all bindings to PubSub
     */
    saveBindings() {
        const state = {
            bindings: Array.from(this.bindings.values()).map(b => b.toJSON()),
            timestamp: Date.now(),
        };

        PubSub.publish('whip:bindings:state', state);
    }

    /**
     * Restore bindings from PubSub
     */
    restoreBindings() {
        const state = PubSub.last('whip:bindings:state');

        if (!state || !state.bindings) {
            console.log('WhipManager: No saved bindings found');
            return;
        }

        console.log(`WhipManager: Restoring ${state.bindings.length} bindings`);

        state.bindings.forEach(bindingData => {
            try {
                const binding = WhipBinding.fromJSON(bindingData);

                // Check if source playhead and target still exist
                const sourceExists = this.checkPlayheadExists(
                    binding.sourceVisualizerId,
                    binding.sourcePlayheadId
                );

                const targetExists = this.checkParameterExists(
                    binding.targetComponentId,
                    binding.targetParameterId
                );

                if (sourceExists && targetExists) {
                    // Register without saving (to avoid recursive save)
                    this.bindings.set(binding.id, binding);
                    binding.activate();
                    this.updatePlayheadBindings(binding.sourceVisualizerId, binding.sourcePlayheadId, binding.id, 'add');
                    this.updateTargetBindings(binding.targetComponentId, binding.targetParameterId, binding.id, 'add');
                    console.log(`WhipManager: Restored binding ${binding.id}`);
                } else {
                    console.warn(`WhipManager: Skipping binding ${binding.id} (source or target no longer exists)`);
                }
            } catch (e) {
                console.error('WhipManager: Error restoring binding:', e);
            }
        });
    }

    /**
     * Check if a playhead exists
     * @private
     */
    checkPlayheadExists(visualizerId, playheadId) {
        const visualizer = document.getElementById(visualizerId) ||
                          document.querySelector(visualizerId);

        if (!visualizer || !visualizer.playheads) return false;

        return visualizer.playheads.some(ph => ph.id === playheadId);
    }

    /**
     * Check if a parameter exists
     * @private
     */
    checkParameterExists(componentId, parameterId) {
        const component = document.getElementById(componentId) ||
                         document.querySelector(componentId);

        if (!component || !component.whippableParameters) return false;

        return component.whippableParameters.has(parameterId);
    }

    /**
     * Clear all bindings
     */
    clearAllBindings() {
        console.log('WhipManager: Clearing all bindings');

        this.bindings.forEach((binding, id) => {
            binding.deactivate();
            this.updatePlayheadBindings(binding.sourceVisualizerId, binding.sourcePlayheadId, id, 'remove');
            this.updateTargetBindings(binding.targetComponentId, binding.targetParameterId, id, 'remove');
        });

        this.bindings.clear();
        this.saveBindings();
    }
}

// Export singleton instance
export const WhipManager = new WhipManagerClass();

// Auto-initialize when imported
// Note: We'll call initialize() explicitly from components instead
// to ensure proper initialization order
