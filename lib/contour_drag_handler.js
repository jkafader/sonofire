import { ContourBinding } from './contour_binding.js';
import { contourBindingManager } from './contour_binding_manager.js';

/**
 * ContourDragHandler - Handles drag-and-drop creation of contour bindings
 *
 * When a user drags from a layer's square whip source, this handler:
 * 1. Shows all available contour target lights
 * 2. Draws a temporary line following the mouse
 * 3. Highlights targets on hover
 * 4. Creates a ContourBinding when dropped on a valid target
 */
class ContourDragHandler {
    constructor() {
        this.isDragging = false;
        this.dragData = null;
        this.tempLine = null;
        this.tempLineSvg = null;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
    }

    /**
     * Start a drag operation from a layer's square whip source
     */
    startDrag(event, dragData) {
        this.isDragging = true;
        this.dragData = dragData;
        this.lastMouseX = event.clientX;
        this.lastMouseY = event.clientY;

        event.preventDefault();
        event.stopPropagation();

        // Prevent text selection during drag
        document.body.style.userSelect = 'none';
        document.body.style.webkitUserSelect = 'none';
        document.body.style.cursor = 'crosshair';

        // Show all contour parameter target lights
        this.showAllContourTargets();

        // Create temporary line
        this.createTemporaryLine(event);

        // Add event listeners
        document.addEventListener('mousemove', this.handleMouseMove);
        document.addEventListener('mouseup', this.handleMouseUp);
        document.addEventListener('keydown', this.handleKeyDown);
        document.addEventListener('scroll', this.updateLinePosition, true);

        console.log('Contour drag started:', dragData);
    }

    /**
     * Handle mouse move - update line and highlight targets
     */
    handleMouseMove = (e) => {
        if (!this.isDragging) return;

        e.preventDefault();  // Prevent text selection

        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;

        this.updateTemporaryLine(e);

        // Highlight target on hover
        const target = e.target.closest('[data-contour-target]');
        this.highlightTarget(target);
    }

    /**
     * Handle mouse up - create binding if dropped on target
     */
    handleMouseUp = (e) => {
        if (!this.isDragging) return;

        // Check if dropped on a target
        const target = e.target.closest('[data-contour-target]');

        if (target) {
            const targetId = target.dataset.contourTarget;  // "componentId:parameterId"
            const [targetComponentId, targetParameterId] = targetId.split(':');

            // Create contour binding
            this.createContourBinding(targetComponentId, targetParameterId);
        }

        this.cleanup();
    }

    /**
     * Handle ESC key - cancel drag
     */
    handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            console.log('Contour drag cancelled');
            this.cleanup();
        }
    }

    /**
     * Create a contour binding between source layer and target parameter
     */
    createContourBinding(targetComponentId, targetParameterId) {
        // Remove any existing bindings to this target (only one binding per input)
        const existingBindings = contourBindingManager.getBindingsForTarget(targetComponentId, targetParameterId);
        if (existingBindings.length > 0) {
            console.log(`Removing ${existingBindings.length} existing binding(s) to ${targetComponentId}.${targetParameterId}`);
            existingBindings.forEach(binding => {
                contourBindingManager.removeBinding(binding.id);
            });
        }

        const config = {
            targetComponentId,
            targetParameterId,
            color: this.dragData.color
        };

        // Check source type and add appropriate properties
        if (this.dragData.sourceType === 'layer') {
            // Layer source
            config.sourceType = 'layer';
            config.sourceLayerId = this.dragData.sourceId;
            config.sourceVisualizerId = this.dragData.visualizerId;
        } else {
            // Generic source (melody-planner, etc.)
            config.sourceType = this.dragData.sourceType;
            config.sourceId = this.dragData.sourceId;
            config.sourceTopic = this.dragData.sourceTopic;
        }

        const binding = new ContourBinding(config);

        contourBindingManager.registerBinding(binding);

        console.log(`Contour binding created: ${binding.getDisplayName()}`);
    }

    /**
     * Show all contour target lights (scale up and brighten)
     */
    showAllContourTargets() {
        const targets = document.querySelectorAll('[data-contour-target]');
        targets.forEach(target => {
            target.style.transform = 'scale(1.2)';
            target.style.opacity = '1';
            target.style.transition = 'all 0.2s ease';
        });
    }

    /**
     * Hide all contour target lights (back to normal)
     */
    hideAllContourTargets() {
        const targets = document.querySelectorAll('[data-contour-target]');
        targets.forEach(target => {
            target.style.transform = 'scale(1.0)';
            target.style.opacity = '0.7';
            target.style.boxShadow = 'none';
        });
    }

    /**
     * Highlight a specific target on hover
     */
    highlightTarget(target) {
        // Remove previous highlight
        document.querySelectorAll('[data-contour-target]').forEach(t => {
            t.style.transform = 'scale(1.2)';
            t.style.boxShadow = 'none';
        });

        if (target) {
            target.style.transform = 'scale(1.5)';
            target.style.boxShadow = `0 0 10px ${this.dragData.color}`;
        }
    }

    /**
     * Create temporary drag line (SVG overlay)
     */
    createTemporaryLine(event) {
        // Create fixed-position SVG overlay for drag line
        this.tempLineSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.tempLineSvg.style.position = 'fixed';
        this.tempLineSvg.style.top = '0';
        this.tempLineSvg.style.left = '0';
        this.tempLineSvg.style.width = '100%';
        this.tempLineSvg.style.height = '100%';
        this.tempLineSvg.style.pointerEvents = 'none';
        this.tempLineSvg.style.zIndex = '10000';
        document.body.appendChild(this.tempLineSvg);

        this.tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        this.tempLine.setAttribute('stroke', this.dragData.color);
        this.tempLine.setAttribute('stroke-width', '2');
        this.tempLine.setAttribute('stroke-dasharray', '5,5');
        this.tempLineSvg.appendChild(this.tempLine);

        this.updateTemporaryLine(event);
    }

    /**
     * Update temporary line position
     */
    updateTemporaryLine(event) {
        if (!this.tempLine || !this.dragData) return;

        // Get source position - handle different source types
        let sourceElement;

        if (this.dragData.sourceType === 'layer') {
            // Layer source - look for layer whip source element
            sourceElement = document.querySelector(`[data-layer-id="${this.dragData.sourceId}"] .layer-whip-source`);
        } else {
            // Generic source (melody-planner, etc.) - look for output source element
            sourceElement = document.querySelector(`[data-source-id="${this.dragData.sourceId}"]`);
        }

        if (!sourceElement) {
            console.warn('Source element not found for drag:', this.dragData);
            return;
        }

        const sourceRect = sourceElement.getBoundingClientRect();
        const sourceCenterX = sourceRect.left + sourceRect.width / 2;
        const sourceCenterY = sourceRect.top + sourceRect.height / 2;

        this.tempLine.setAttribute('x1', sourceCenterX);
        this.tempLine.setAttribute('y1', sourceCenterY);
        this.tempLine.setAttribute('x2', event.clientX);
        this.tempLine.setAttribute('y2', event.clientY);
    }

    /**
     * Update line position on scroll
     */
    updateLinePosition = () => {
        if (this.isDragging) {
            const event = { clientX: this.lastMouseX, clientY: this.lastMouseY };
            this.updateTemporaryLine(event);
        }
    }

    /**
     * Clean up drag state and UI
     */
    cleanup() {
        this.isDragging = false;
        this.dragData = null;

        // Restore text selection and cursor
        document.body.style.userSelect = '';
        document.body.style.webkitUserSelect = '';
        document.body.style.cursor = '';

        if (this.tempLineSvg) {
            this.tempLineSvg.remove();
            this.tempLineSvg = null;
            this.tempLine = null;
        }

        this.hideAllContourTargets();

        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('mouseup', this.handleMouseUp);
        document.removeEventListener('keydown', this.handleKeyDown);
        document.removeEventListener('scroll', this.updateLinePosition, true);
    }
}

// Singleton instance
export const contourDragHandler = new ContourDragHandler();
