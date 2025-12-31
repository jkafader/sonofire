import { SonofireBase } from '../base/sonofire_base.js';
import { Playhead } from '../../lib/playhead.js';

/**
 * Playhead Manager Component
 * Manages playheads for a specific visualizer
 *
 * Usage: <sonofire-playhead-manager data-visualizer-id="sonofire-xy-plot"></sonofire-playhead-manager>
 */
export class SonofirePlayheadManager extends SonofireBase {
    constructor() {
        super();
        this.visualizerId = null;
        this.visualizer = null;  // Reference to the visualizer component
    }

    /**
     * Specify which attributes to observe
     */
    static get observedAttributes() {
        return [
            ...super.observedAttributes,
            'data-visualizer-id'
        ];
    }

    /**
     * Parse attributes
     */
    parseAttributes() {
        super.parseAttributes();
        this.visualizerId = this.getAttribute('data-visualizer-id');
    }

    /**
     * Component connected to DOM
     */
    connectedCallback() {
        super.connectedCallback();
        this.findVisualizer();
        this.render();
    }

    /**
     * Find and store reference to the visualizer component
     */
    findVisualizer() {
        if (!this.visualizerId) return;

        // Try to find by ID first
        this.visualizer = document.getElementById(this.visualizerId);

        // If not found by ID, try querySelector with tag name
        if (!this.visualizer) {
            this.visualizer = document.querySelector(this.visualizerId);
        }

        if (this.visualizer) {
            console.log(`Playhead Manager: Found visualizer ${this.visualizerId}`);
        } else {
            console.warn(`Playhead Manager: Could not find visualizer ${this.visualizerId}`);
        }
    }

    /**
     * Add a new playhead to the visualizer
     */
    addPlayhead() {
        if (!this.visualizer || !this.visualizer.addPlayhead) {
            console.error('Playhead Manager: Visualizer does not support playheads');
            return;
        }

        const config = {
            speed: 1,  // Default speed
            enabled: true
        };

        this.visualizer.addPlayhead(config);
        this.render();
    }

    /**
     * Remove a playhead
     * @param {string} playheadId
     */
    removePlayhead(playheadId) {
        if (!this.visualizer || !this.visualizer.removePlayhead) {
            console.error('Playhead Manager: Visualizer does not support playheads');
            return;
        }

        this.visualizer.removePlayhead(playheadId);
        this.render();
    }

    /**
     * Toggle playhead enabled state
     * @param {string} playheadId
     */
    togglePlayhead(playheadId) {
        if (!this.visualizer || !this.visualizer.playheads) return;

        const playhead = this.visualizer.playheads.find(ph => ph.id === playheadId);
        if (playhead) {
            playhead.setEnabled(!playhead.enabled);
            this.render();
        }
    }

    /**
     * Change playhead speed
     * @param {string} playheadId
     * @param {number} speed
     */
    setPlayheadSpeed(playheadId, speed) {
        if (!this.visualizer || !this.visualizer.playheads) return;

        const playhead = this.visualizer.playheads.find(ph => ph.id === playheadId);
        if (playhead) {
            playhead.setSpeed(parseFloat(speed));
            this.visualizer.savePlayheads();
            this.render();
        }
    }

    /**
     * Change playhead color
     * @param {string} playheadId
     * @param {string} color
     */
    setPlayheadColor(playheadId, color) {
        if (!this.visualizer || !this.visualizer.playheads) return;

        const playhead = this.visualizer.playheads.find(ph => ph.id === playheadId);
        if (playhead) {
            playhead.color = color;
            this.visualizer.savePlayheads();
            this.visualizer.render();
        }
    }

    /**
     * Render the playhead manager UI
     */
    render() {
        if (!this.visualizer) {
            this.innerHTML = `
                <div style="background: #2d2d2d; padding: 15px; margin: 10px 0; border-left: 3px solid #888;">
                    <strong style="color: #888;">Playhead Manager</strong>
                    <p style="color: #888;">Waiting for visualizer: ${this.visualizerId}</p>
                </div>
            `;
            return;
        }

        const playheads = this.visualizer.playheads || [];

        this.innerHTML = `
            <div style="background: #2d2d2d; padding: 15px; margin: 10px 0; border-left: 3px solid #4ec9b0;">
                <h3 style="margin: 0 0 10px 0; color: #4ec9b0;">⚡ Playhead Manager: ${this.visualizerId}</h3>

                <button id="add-playhead-btn" style="background: #0e639c; color: white; border: none; padding: 8px 16px; margin-bottom: 10px; cursor: pointer;">
                    + Add Playhead
                </button>

                <div id="playhead-list">
                    ${playheads.length === 0 ? '<p style="color: #888;">No playheads yet. Click "+ Add Playhead" to create one.</p>' : ''}
                    ${playheads.map((ph, index) => this.renderPlayheadItem(ph, index)).join('')}
                </div>
            </div>
        `;

        this.setupEventHandlers();
    }

    /**
     * Render individual playhead item
     * @param {Playhead} playhead
     * @param {number} index
     * @returns {string} HTML
     */
    renderPlayheadItem(playhead, index) {
        const enabledIcon = playhead.enabled ? '●' : '○';
        const enabledText = playhead.enabled ? 'Enabled' : 'Disabled';
        const enabledStyle = playhead.enabled ? '' : 'opacity: 0.5;';

        return `
            <div class="playhead-item" data-playhead-id="${playhead.id}" style="background: #252526; padding: 10px; margin: 5px 0; border-left: 3px solid ${playhead.color}; ${enabledStyle}">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="flex: 1;">
                        <strong style="color: ${playhead.color};">${enabledIcon} Playhead ${index + 1}</strong>
                        <span style="margin-left: 10px; color: #888;">ID: ${playhead.id.substr(0, 8)}...</span>
                    </div>
                    <div>
                        <button class="remove-playhead-btn" data-playhead-id="${playhead.id}" style="background: #d16969; color: white; border: none; padding: 4px 8px; cursor: pointer;">
                            × Remove
                        </button>
                    </div>
                </div>

                <div style="margin-top: 8px; display: flex; gap: 15px; align-items: center;">
                    <div>
                        <strong style="color: #569cd6;">Speed:</strong>
                        <select class="speed-select" data-playhead-id="${playhead.id}" style="margin-left: 5px; padding: 2px;">
                            ${this.renderSpeedOptions(playhead.speed)}
                        </select>
                    </div>

                    <div>
                        <strong style="color: #569cd6;">Color:</strong>
                        <input type="color" class="color-picker" data-playhead-id="${playhead.id}" value="${playhead.color}" style="margin-left: 5px; width: 30px; height: 25px; border: 1px solid #fff; cursor: pointer; vertical-align: middle;">
                    </div>

                    <div>
                        <strong style="color: #569cd6;">Position:</strong>
                        <span style="margin-left: 5px; color: #d4d4d4;">${Math.round(playhead.position)}px</span>
                    </div>

                    <div>
                        <button class="toggle-playhead-btn" data-playhead-id="${playhead.id}" style="background: ${playhead.enabled ? '#608b4e' : '#888'}; color: white; border: none; padding: 4px 8px; cursor: pointer;">
                            ${playhead.enabled ? '✓ Disable' : '○ Enable'}
                        </button>
                    </div>
                </div>

                <div style="margin-top: 5px;">
                    <strong style="color: #569cd6;">Bindings:</strong>
                    <span style="margin-left: 5px; color: ${playhead.bindingIds.length > 0 ? '#4ec9b0' : '#888'};">
                        ${playhead.bindingIds.length > 0 ? `${playhead.bindingIds.length} whip${playhead.bindingIds.length !== 1 ? 's' : ''}` : 'No bindings'}
                    </span>
                </div>
            </div>
        `;
    }

    /**
     * Render speed selector options
     * @param {number} currentSpeed
     * @returns {string} HTML options
     */
    renderSpeedOptions(currentSpeed) {
        return Playhead.SPEED_MULTIPLIERS.map(multiplier => {
            const selected = multiplier.value === currentSpeed ? 'selected' : '';
            return `<option value="${multiplier.value}" ${selected}>${multiplier.label}</option>`;
        }).join('');
    }

    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        // Add playhead button
        const addBtn = this.$('#add-playhead-btn');
        if (addBtn) {
            addBtn.onclick = () => this.addPlayhead();
        }

        // Remove playhead buttons
        this.$$('.remove-playhead-btn').forEach(btn => {
            btn.onclick = () => {
                const playheadId = btn.dataset.playheadId;
                if (confirm('Remove this playhead? This will also delete any whip bindings.')) {
                    this.removePlayhead(playheadId);
                }
            };
        });

        // Toggle playhead buttons
        this.$$('.toggle-playhead-btn').forEach(btn => {
            btn.onclick = () => {
                const playheadId = btn.dataset.playheadId;
                this.togglePlayhead(playheadId);
            };
        });

        // Speed selectors
        this.$$('.speed-select').forEach(select => {
            select.onchange = (e) => {
                const playheadId = select.dataset.playheadId;
                const speed = e.target.value;
                this.setPlayheadSpeed(playheadId, speed);
            };
        });

        // Color pickers
        this.$$('.color-picker').forEach(picker => {
            picker.onchange = (e) => {
                const playheadId = picker.dataset.playheadId;
                const color = e.target.value;
                this.setPlayheadColor(playheadId, color);
            };
        });
    }
}

// Register custom element
customElements.define('sonofire-playhead-manager', SonofirePlayheadManager);
