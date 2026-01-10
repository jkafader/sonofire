import { WhipManager } from './whip_manager.js';
import { WhipBinding } from './whip_binding.js';

/**
 * WhipDragHandler - Manages drag-and-drop interactions for creating whip bindings
 *
 * Flow:
 * 1. User mousedown on playhead source light
 * 2. Show all parameter target lights
 * 3. User drags - temporary line follows cursor
 * 4. Highlight targets on hover
 * 5. User mouseup on target light - create binding
 * 6. User mouseup elsewhere - cancel
 */
class WhipDragHandlerClass {
    constructor() {
        this.dragging = false;
        this.dragData = null;
        this.tempLine = null;
        this.allTargetLights = [];
        this.hoveredTarget = null;
    }

    /**
     * Initialize drag handler
     */
    initialize() {
        // Bind event handlers
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onScroll = this.onScroll.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
    }

    /**
     * Start drag from a source light
     * @param {MouseEvent} event - Mouse event
     * @param {Object} sourceData - { visualizerId, playheadId, playhead, color, sourceElement }
     */
    startDrag(event, sourceData) {
        event.preventDefault();

        this.dragging = true;
        this.dragData = {
            ...sourceData,
            // Store the source element so we can recalculate its position
            sourceElement: event.target,
        };

        // Add global event listeners
        document.addEventListener('mousemove', this.onMouseMove);
        document.addEventListener('mouseup', this.onMouseUp);
        document.addEventListener('scroll', this.onScroll, true); // Use capture to catch all scroll events
        document.addEventListener('keydown', this.onKeyDown);

        // Show all target lights
        this.showAllTargetLights();

        // Create temporary drag line
        this.createTempLine(event.clientX, event.clientY);
    }

    /**
     * Handle mouse move during drag
     * @param {MouseEvent} event
     */
    onMouseMove(event) {
        if (!this.dragging) return;

        // Update temporary line position
        this.updateTempLine(event.clientX, event.clientY);

        // Check if hovering over a target light
        const targetLight = this.findTargetLightAtPosition(event.clientX, event.clientY);

        if (targetLight !== this.hoveredTarget) {
            // Unhighlight previous target
            if (this.hoveredTarget) {
                this.unhighlightTarget(this.hoveredTarget);
            }

            // Highlight new target
            if (targetLight) {
                this.highlightTarget(targetLight);
            }

            this.hoveredTarget = targetLight;
        }
    }

    /**
     * Handle mouse up (end drag)
     * @param {MouseEvent} event
     */
    onMouseUp(event) {
        if (!this.dragging) return;

        // Check if dropped on a target light
        const targetLight = this.findTargetLightAtPosition(event.clientX, event.clientY);

        if (targetLight) {
            // Create whip binding
            this.createBinding(targetLight);
        }

        // Cleanup
        this.endDrag();
    }

    /**
     * Handle scroll during drag - update line position
     * @param {Event} event
     */
    onScroll(event) {
        if (!this.dragging || !this.tempLine) return;

        // Get current mouse position from last known position
        // We need to recalculate source position when page scrolls
        const sourceRect = this.dragData.sourceElement.getBoundingClientRect();
        const startX = sourceRect.left + sourceRect.width / 2;
        const startY = sourceRect.top + sourceRect.height / 2;

        this.tempLine.line.setAttribute('x1', startX);
        this.tempLine.line.setAttribute('y1', startY);
        // Keep x2, y2 unchanged - they're set by mouse position
    }

    /**
     * Handle keydown during drag - ESC cancels
     * @param {KeyboardEvent} event
     */
    onKeyDown(event) {
        if (!this.dragging) return;

        if (event.key === 'Escape') {
            event.preventDefault();
            this.cancel();
        }
    }

    /**
     * Create a whip binding from drag data to target
     * @param {HTMLElement} targetLightElement
     */
    createBinding(targetLightElement) {
        const targetId = targetLightElement.dataset.targetId;
        if (!targetId) {
            console.error('WhipDragHandler: Target light missing data-target-id');
            return;
        }

        // Parse target ID (format: "componentId:parameterId")
        const [targetComponentId, targetParameterId] = targetId.split(':');

        // Create binding
        const binding = new WhipBinding({
            sourceVisualizerId: this.dragData.visualizerId,
            sourcePlayheadId: this.dragData.playheadId,
            targetComponentId: targetComponentId,
            targetParameterId: targetParameterId,
            color: this.dragData.color,
            mappingFunction: 'linear',
            enabled: true,
        });

        // Register with WhipManager
        WhipManager.registerBinding(binding);
    }

    /**
     * End drag operation (cleanup)
     */
    endDrag() {
        // Remove event listeners
        document.removeEventListener('mousemove', this.onMouseMove);
        document.removeEventListener('mouseup', this.onMouseUp);
        document.removeEventListener('scroll', this.onScroll, true);
        document.removeEventListener('keydown', this.onKeyDown);

        // Remove temporary line
        if (this.tempLine) {
            this.tempLine.svg.remove();
            this.tempLine = null;
        }

        // Unhighlight hovered target
        if (this.hoveredTarget) {
            this.unhighlightTarget(this.hoveredTarget);
            this.hoveredTarget = null;
        }

        // Hide all target lights
        this.hideAllTargetLights();

        // Reset state
        this.dragging = false;
        this.dragData = null;
    }

    /**
     * Create temporary drag line
     * @param {number} x - Mouse X position
     * @param {number} y - Mouse Y position
     */
    createTempLine(x, y) {
        // Create SVG line element
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = 'whip-temp-drag-line';
        svg.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 10000;
        `;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');

        // Get source element position (accounts for scroll)
        const sourceRect = this.dragData.sourceElement.getBoundingClientRect();
        const startX = sourceRect.left + sourceRect.width / 2;
        const startY = sourceRect.top + sourceRect.height / 2;

        line.setAttribute('x1', startX);
        line.setAttribute('y1', startY);
        line.setAttribute('x2', x);
        line.setAttribute('y2', y);
        line.setAttribute('stroke', this.dragData.color || '#4ec9b0');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('stroke-dasharray', '5,5');
        line.setAttribute('opacity', '0.7');

        svg.appendChild(line);
        document.body.appendChild(svg);

        this.tempLine = { svg, line };
    }

    /**
     * Update temporary line position
     * @param {number} x - Mouse X position
     * @param {number} y - Mouse Y position
     */
    updateTempLine(x, y) {
        if (!this.tempLine) return;

        // Recalculate source position (accounts for scroll changes during drag)
        const sourceRect = this.dragData.sourceElement.getBoundingClientRect();
        const startX = sourceRect.left + sourceRect.width / 2;
        const startY = sourceRect.top + sourceRect.height / 2;

        this.tempLine.line.setAttribute('x1', startX);
        this.tempLine.line.setAttribute('y1', startY);
        this.tempLine.line.setAttribute('x2', x);
        this.tempLine.line.setAttribute('y2', y);
    }

    /**
     * Show all parameter target lights
     */
    showAllTargetLights() {
        // Find all target lights in the DOM
        this.allTargetLights = Array.from(
            document.querySelectorAll('.parameter-target-light')
        );

        // Make them more visible during drag
        this.allTargetLights.forEach(light => {
            light.style.transform = 'scale(1.2)';
            light.style.opacity = '1';
            light.style.zIndex = '10001';
        });
    }

    /**
     * Hide all parameter target lights
     */
    hideAllTargetLights() {
        this.allTargetLights.forEach(light => {
            light.style.transform = 'scale(1.0)';
            light.style.opacity = '';
            light.style.zIndex = '';
        });

        this.allTargetLights = [];
    }

    /**
     * Highlight a target light
     * @param {HTMLElement} targetLight
     */
    highlightTarget(targetLight) {
        targetLight.style.transform = 'scale(1.5)';
        targetLight.style.boxShadow = `0 0 12px ${this.dragData.color || '#4ec9b0'}`;
    }

    /**
     * Unhighlight a target light
     * @param {HTMLElement} targetLight
     */
    unhighlightTarget(targetLight) {
        targetLight.style.transform = 'scale(1.2)'; // Back to "shown" state
        targetLight.style.boxShadow = '';
    }

    /**
     * Find target light at position
     * @param {number} x - Mouse X position
     * @param {number} y - Mouse Y position
     * @returns {HTMLElement|null}
     */
    findTargetLightAtPosition(x, y) {
        for (const light of this.allTargetLights) {
            const rect = light.getBoundingClientRect();
            if (x >= rect.left && x <= rect.right &&
                y >= rect.top && y <= rect.bottom) {
                return light;
            }
        }
        return null;
    }

    /**
     * Cancel current drag operation
     */
    cancel() {
        if (!this.dragging) return;

        this.endDrag();
    }
}

// Export singleton instance
export const WhipDragHandler = new WhipDragHandlerClass();
