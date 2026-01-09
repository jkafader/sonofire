/**
 * WhipTargetLight - Web component for whip binding target indicators
 *
 * Usage:
 * <whip-target-light
 *   data-component-id="drummer"
 *   data-parameter-id="accent"
 *   data-position="inline">
 * </whip-target-light>
 */
export class WhipTargetLight extends HTMLElement {
    constructor() {
        super();
        // No Shadow DOM - use regular DOM for simpler drag-and-drop
    }

    static get observedAttributes() {
        return ['data-component-id', 'data-parameter-id', 'data-color', 'data-position'];
    }

    connectedCallback() {
        this.render();
        this.setupBindingSync();
    }

    disconnectedCallback() {
        // Clean up any subscriptions if needed
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue !== newValue) {
            this.render();
        }
    }

    get componentId() {
        return this.getAttribute('data-component-id');
    }

    get parameterId() {
        return this.getAttribute('data-parameter-id');
    }

    get color() {
        return this.getAttribute('data-color') || '#666';
    }

    get position() {
        return this.getAttribute('data-position') || 'inline';
    }

    setColor(color) {
        this.setAttribute('data-color', color);

        // Immediately update the visual without waiting for re-render
        const light = this.querySelector('.light');
        if (light) {
            light.style.backgroundColor = color;
            light.style.boxShadow = `0 0 4px ${color}`;
        }
    }

    render() {
        // Position styles based on position attribute
        let positionStyle = '';
        switch (this.position) {
            case 'inline':
                positionStyle = 'display: inline-block; margin-left: 5px; vertical-align: middle;';
                break;
            case 'strong':
                positionStyle = 'display: inline-block; margin-left: 8px; vertical-align: middle;';
                break;
            default:
                positionStyle = 'display: inline-block; margin-left: 5px; vertical-align: middle;';
        }

        // Set target ID for drag-and-drop system
        const targetId = `${this.componentId}:${this.parameterId}`;

        this.innerHTML = `
            <div class="parameter-target-light"
                 data-target-id="${targetId}"
                 style="border-radius: 50%; ${positionStyle}"
                 title="${this.componentId}.${this.parameterId}">
                <div class="light" style="
                    border: 1px solid white;
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    background-color: ${this.color};
                    box-shadow: 0 0 4px ${this.color};
                    cursor: pointer;
                    transition: background-color 0.2s ease, box-shadow 0.2s ease;
                "></div>
            </div>
        `;

        // Add hover effect
        const lightContainer = this.querySelector('.parameter-target-light');
        const light = this.querySelector('.light');

        if (lightContainer && light) {
            lightContainer.addEventListener('mouseenter', () => {
                light.style.boxShadow = `0 0 8px ${this.color}`;
            });

            lightContainer.addEventListener('mouseleave', () => {
                light.style.boxShadow = `0 0 4px ${this.color}`;
            });

            lightContainer.addEventListener('click', () => {
                this.dispatchEvent(new CustomEvent('target-light-click', {
                    bubbles: true,
                    detail: {
                        componentId: this.componentId,
                        parameterId: this.parameterId
                    }
                }));
            });
        }
    }

    /**
     * Setup sync with WhipManager to update color when bindings change
     */
    async setupBindingSync() {
        if (!this.componentId || !this.parameterId) return;

        try {
            const { WhipManager } = await import('../../lib/whip_manager.js');

            // Check for existing bindings and update color
            const bindings = WhipManager.getBindingsForTarget(this.componentId, this.parameterId);
            if (bindings.length > 0) {
                const binding = bindings[0];
                if (binding.color) {
                    this.setColor(binding.color);
                }
            }
        } catch (err) {
            // WhipManager might not be available yet, that's ok
        }
    }
}

// Register custom element
customElements.define('whip-target-light', WhipTargetLight);
