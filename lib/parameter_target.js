/**
 * ParameterTarget - Represents a tunable parameter that can receive whip bindings
 *
 * Each parameter target:
 * - Has a unique ID (componentId:parameterId)
 * - Displays a colored "target light" indicator next to the parameter control
 * - Can receive drag-and-drop whip bindings from playhead source lights
 * - Updates its color to match bound playhead(s)
 */
export class ParameterTarget {
    constructor(componentId, parameterId, config = {}) {
        this.componentId = componentId;
        this.parameterId = parameterId;
        this.label = config.label || parameterId;
        this.parameterType = config.parameterType || 'number'; // 'number', 'select', 'boolean', 'trigger', 'pulse'
        this.min = config.min !== undefined ? config.min : 0;
        this.max = config.max !== undefined ? config.max : 1;
        this.element = config.element || null; // Reference to the control element
        this.targetLightElement = null; // The visual target light container
        this.circleElement = null; // The colored circle inside the container
        this.boundPlayheadIds = []; // IDs of playheads bound to this parameter
        this.icon = config.icon || null; // Emoji icon (shown next to circle)
        this.customPosition = config.customPosition || null; // Custom position selector
        this.lastValue = null; // For trigger detection
    }

    /**
     * Get unique target ID
     * @returns {string}
     */
    getId() {
        return `${this.componentId}:${this.parameterId}`;
    }

    /**
     * Create target light indicator (colored circle or emoji)
     * @returns {HTMLElement}
     */
    createTargetLight() {
        // Create container span
        const container = document.createElement('span');
        container.className = 'parameter-target-light';
        container.dataset.targetId = this.getId();
        container.style.cssText = `
            display: inline-block;
            margin-right: 5px;
            vertical-align: middle;
        `;

        // Always create the colored circle (this is the actual drop target)
        const circle = document.createElement('span');
        circle.className = 'parameter-target-circle';
        circle.style.cssText = `
            display: inline-block;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #888;
            border: 2px solid #fff;
            cursor: pointer;
            box-shadow: 0 0 4px rgba(0,0,0,0.3);
            transition: transform 0.2s, background 0.2s;
            margin-right: 3px;
            vertical-align: middle;
        `;

        // Hover effect for circle
        circle.addEventListener('mouseenter', () => {
            circle.style.transform = 'scale(1.3)';
        });
        circle.addEventListener('mouseleave', () => {
            circle.style.transform = 'scale(1.0)';
        });

        // Click handler - remove all bindings
        circle.addEventListener('click', (event) => {
            event.stopPropagation();
            this.handleClick();
        });

        // Tooltip on circle
        circle.title = `${this.componentId} > ${this.label}\nDrop playhead here to automate this parameter\nClick to remove bindings`;

        container.appendChild(circle);

        // If there's an icon, add it after the circle
        if (this.icon) {
            const iconSpan = document.createElement('span');
            iconSpan.className = 'parameter-target-icon';
            iconSpan.textContent = this.icon;
            iconSpan.style.cssText = `
                display: inline-block;
                font-size: 16px;
                margin-right: 3px;
                vertical-align: middle;
            `;
            container.appendChild(iconSpan);
        }

        this.targetLightElement = container;
        this.circleElement = circle; // Store reference to circle for color updates
        return container;
    }

    /**
     * Attach target light to element or custom position
     * @param {HTMLElement} componentRoot - The component's root element for custom positioning
     */
    attachLightToElement(componentRoot) {
        if (!this.targetLightElement) return;

        if (this.customPosition && componentRoot) {
            // Use custom position selector
            const targetElement = componentRoot.querySelector(this.customPosition);
            if (targetElement) {
                // Insert after the target element
                targetElement.parentNode.insertBefore(
                    this.targetLightElement,
                    targetElement.nextSibling
                );
                return;
            }
        }

        if (this.element) {
            // Default: insert before the control element
            this.element.parentNode.insertBefore(this.targetLightElement, this.element);
        }
    }

    /**
     * Update target light color based on bound playheads
     * @param {string} color - Hex color from playhead
     */
    updateLightColor(color = null) {
        if (!this.circleElement) return;

        if (color) {
            this.circleElement.style.background = color;
        } else if (this.boundPlayheadIds.length === 0) {
            // No bindings - gray
            this.circleElement.style.background = '#888';
        }
    }

    /**
     * Highlight target light during drag (potential drop target)
     */
    highlightAsDropTarget() {
        if (!this.circleElement) return;
        this.circleElement.style.transform = 'scale(1.5)';
        this.circleElement.style.boxShadow = '0 0 8px rgba(78, 201, 176, 0.8)';
    }

    /**
     * Remove drop target highlight
     */
    removeDropHighlight() {
        if (!this.circleElement) return;
        this.circleElement.style.transform = 'scale(1.0)';
        this.circleElement.style.boxShadow = '0 0 4px rgba(0,0,0,0.3)';
    }

    /**
     * Add a playhead binding to this target
     * @param {string} playheadId
     */
    addBinding(playheadId) {
        if (!this.boundPlayheadIds.includes(playheadId)) {
            this.boundPlayheadIds.push(playheadId);
        }
    }

    /**
     * Remove a playhead binding from this target
     * @param {string} playheadId
     */
    removeBinding(playheadId) {
        this.boundPlayheadIds = this.boundPlayheadIds.filter(id => id !== playheadId);

        // If no more bindings, reset color
        if (this.boundPlayheadIds.length === 0) {
            this.updateLightColor();
        }
    }

    /**
     * Handle click on target light - show option to remove bindings
     */
    handleClick() {
        // Dynamically import WhipManager to avoid circular dependency
        import('./whip_manager.js').then(({ WhipManager }) => {
            // Get all bindings for this target
            const bindings = WhipManager.getBindingsForTarget(this.componentId, this.parameterId);

            if (bindings.length === 0) {
                alert(`No bindings found for ${this.componentId} > ${this.label}`);
                return;
            }

            // Confirm removal
            const bindingCount = bindings.length;
            const bindingList = bindings.map(b => `  • ${b.sourceVisualizerId}:${b.sourcePlayheadId}`).join('\n');
            const message = `Remove ${bindingCount} binding${bindingCount > 1 ? 's' : ''} for "${this.label}"?\n\n${bindingList}`;

            if (confirm(message)) {
                // Remove all bindings
                bindings.forEach(binding => {
                    WhipManager.removeBinding(binding.id);
                });

                // Reset light color
                this.updateLightColor();

                console.log(`ParameterTarget: Removed ${bindingCount} binding(s) for ${this.getId()}`);
            }
        }).catch(err => {
            console.error('ParameterTarget: Error handling click:', err);
        });
    }

    /**
     * Serialize to JSON for PubSub registration
     * @returns {Object}
     */
    toJSON() {
        return {
            componentId: this.componentId,
            parameterId: this.parameterId,
            label: this.label,
            parameterType: this.parameterType,
            min: this.min,
            max: this.max
        };
    }

    /**
     * Deserialize from JSON
     * @param {Object} json
     * @returns {ParameterTarget}
     */
    static fromJSON(json) {
        return new ParameterTarget(json.componentId, json.parameterId, {
            label: json.label,
            parameterType: json.parameterType,
            min: json.min,
            max: json.max
        });
    }
}
