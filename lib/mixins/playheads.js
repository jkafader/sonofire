/**
 * Playheads Mixin - Adds playhead management logic + UI to visualizer components
 *
 * This mixin combines:
 * - Playhead CRUD operations and state management
 * - Advancement engine and clock integration
 * - Transport controls (play/stop/rewind)
 * - UI rendering for playhead management controls
 *
 * Components that apply this mixin must implement:
 * - advancePlayheadPosition(playhead) - move playhead forward by advancement amount
 * - sampleDataAtPlayhead(playhead) - sample data at current playhead position
 *
 * Components may optionally override:
 * - onPlayheadsAdvanced() - called after all playheads advance (for rendering)
 */

import { PubSub } from '../pubsub.js';
import { Playhead } from '../playhead.js';

const WIDTH=110;

export function PlayheadsMixin(BaseClass) {
    return class extends BaseClass {
        constructor() {
            super();

            // Playhead state
            this.playheads = [];
            this.playheadPosition = 0; // Legacy - for backward compatibility

            // UI container
            this.playheadControlsContainer = null;
        }

        /**
         * Setup playhead-specific subscriptions
         * Should be called during connectedCallback
         */
        setupPlayheadSubscriptions() {
            // Clock tick drives playhead advancement
            this.subscribe('clock:tick', (data) => {
                this.onClockTick(data);
            });

            // Transport controls
            this.subscribe('transport:play', () => {
                this.play();
            });

            this.subscribe('transport:stop', () => {
                this.stop();
            });

            this.subscribe('transport:rewind', () => {
                this.rewind();
            });

            // Harmonic context changes
            this.subscribe('context:pool', (data) => {
                this.onPoolChange(data);
            });
        }

        // ========================================
        // Playhead CRUD Operations
        // ========================================

        /**
         * Get unique identifier for this visualizer (for playhead management)
         * @returns {string} Visualizer ID
         */
        getVisualizerId() {
            return this.id || this.tagName.toLowerCase();
        }

        /**
         * Add a new playhead to this visualizer
         * @param {Object} config - Playhead configuration
         * @returns {Playhead} Created playhead
         */
        addPlayhead(config = {}) {
            const visualizerId = this.getVisualizerId();
            const playhead = new Playhead(visualizerId, config);

            this.playheads.push(playhead);
            this.savePlayheads();

            // Publish creation event
            this.publish(`playhead:${visualizerId}:created`, {
                visualizerId,
                playheadId: playhead.id,
                playhead: playhead.toJSON()
            });

            // Re-render UI to show new playhead
            this.renderPlayheadControls();

            // Hook for subclasses to update their visualization
            this.onPlayheadListChanged();

            console.log(`Playhead ${playhead.id} added to visualizer ${visualizerId}`);
            return playhead;
        }

        /**
         * Remove a playhead by ID
         * @param {string} playheadId - Playhead ID to remove
         */
        removePlayhead(playheadId) {
            const visualizerId = this.getVisualizerId();
            const index = this.playheads.findIndex(ph => ph.id === playheadId);

            if (index === -1) {
                console.warn(`Playhead ${playheadId} not found`);
                return;
            }

            this.playheads.splice(index, 1);
            this.savePlayheads();

            // Publish removal event for cleanup (whip bindings, etc.)
            this.publish(`playhead:${visualizerId}:removed`, {
                visualizerId,
                playheadId
            });

            // Re-render UI to remove from list
            this.renderPlayheadControls();

            // Hook for subclasses to update their visualization
            this.onPlayheadListChanged();

            console.log(`Playhead ${playheadId} removed from visualizer ${visualizerId}`);
        }

        /**
         * Get a playhead by ID
         * @param {string} playheadId - Playhead ID
         * @returns {Playhead|undefined} Playhead or undefined
         */
        getPlayhead(playheadId) {
            return this.playheads.find(ph => ph.id === playheadId);
        }

        // ========================================
        // Advancement Engine
        // ========================================

        /**
         * Advance all enabled playheads by one clock tick
         * Called by clock:tick handler
         */
        advanceAllPlayheads() {
            this.playheads.forEach(playhead => {
                if (!playhead.enabled) return;

                const advancement = playhead.advance();
                if (advancement === 0) return;

                // Move playhead forward (subclass implements)
                this.advancePlayheadPosition(playhead);

                // Sample data at new position (subclass implements)
                this.sampleDataAtPlayhead(playhead);
            });

            // Hook for rendering updates (optional override)
            this.onPlayheadsAdvanced();
        }

        /**
         * Advance a playhead's position by its advancement amount
         * MUST be implemented by subclass
         * @param {Playhead} playhead - Playhead to advance
         */
        advancePlayheadPosition(playhead) {
            throw new Error('advancePlayheadPosition() must be implemented by subclass');
        }

        /**
         * Sample data at the playhead's current position
         * MUST be implemented by subclass
         * @param {Playhead} playhead - Playhead at which to sample
         */
        sampleDataAtPlayhead(playhead) {
            throw new Error('sampleDataAtPlayhead() must be implemented by subclass');
        }

        /**
         * Hook called after all playheads have advanced
         * Subclasses can override for rendering updates
         */
        onPlayheadsAdvanced() {
            // Optional override - default is no-op
        }

        /**
         * Hook called when playhead list changes (add/remove/toggle)
         * Subclasses should override to update their visualization
         */
        onPlayheadListChanged() {
            // Optional override - default is no-op
        }

        // ========================================
        // State Persistence
        // ========================================

        /**
         * Save playheads state to PubSub persistence
         */
        savePlayheads() {
            const visualizerId = this.getVisualizerId();
            const state = this.playheads.map(ph => ph.toJSON());

            this.publish(`visualizer:${visualizerId}:playheads`, {
                visualizerId,
                playheads: state
            });
        }

        /**
         * Restore playheads from PubSub persistence
         */
        restorePlayheads() {
            const visualizerId = this.getVisualizerId();
            const lastState = this.getLastValue(`visualizer:${visualizerId}:playheads`);

            if (!lastState || !lastState.playheads) {
                console.log(`No saved playheads for ${visualizerId}`);
                return;
            }

            this.playheads = lastState.playheads.map(data => {
                return Playhead.fromJSON(data);
            });

            console.log(`Restored ${this.playheads.length} playhead(s) for ${visualizerId}`);

            // Re-render UI with restored playheads
            this.renderPlayheadControls();

            // Hook for subclasses to update their visualization
            this.onPlayheadListChanged();
        }

        // ========================================
        // Transport Controls
        // ========================================

        /**
         * Start playback
         */
        play() {
            console.log('Transport: PLAY');
            // Playheads will advance via clock:tick
        }

        /**
         * Stop playback
         */
        stop() {
            console.log('Transport: STOP');
            // Playheads will stop advancing (clock stops ticking)
        }

        /**
         * Rewind all playheads to position 0
         */
        rewind() {
            console.log('Transport: REWIND');
            this.playheads.forEach(playhead => {
                playhead.setPosition(0);
            });
            this.onPlayheadsAdvanced(); // Trigger render update
        }

        // ========================================
        // Event Handlers
        // ========================================

        /**
         * Handle clock tick event
         * @param {Object} data - Clock tick data
         */
        onClockTick(data) {
            this.advanceAllPlayheads();
        }

        /**
         * Handle pool/tonic change event
         * @param {Object} data - Pool change data
         */
        onPoolChange(data) {
            // Hook for subclasses if needed
            // Default: no-op
        }

        // ========================================
        // UI Rendering
        // ========================================

        /**
         * Render playhead management controls UI
         * Creates compact sidebar control panel with playhead list and add button
         */
        renderPlayheadControls() {
            const visualizerId = this.getVisualizerId();

            // Create container if it doesn't exist
            if (!this.playheadControlsContainer) {
                this.playheadControlsContainer = document.createElement('div');
                this.playheadControlsContainer.className = 'playhead-controls';
                this.playheadControlsContainer.style.cssText = `
                    position: absolute;
                    left: 0;
                    top: 0;
                    width: ${WIDTH}px;
                    height: 100%;
                    background: #1e1e1e;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                    z-index: 10;
                `;

                // Make the visualizer container position:relative so sidebar can be positioned
                this.style.position = 'relative';
                this.style.display = 'block';

                // Add padding to the visualizer to make room for sidebar
                // Store original padding if it exists
                const currentPadding = this.style.paddingLeft;
                const currentPaddingValue = currentPadding ? parseInt(currentPadding) : 0;
                this.style.paddingLeft = `${currentPaddingValue + WIDTH}px`;

                // Insert at the beginning of the visualizer
                this.insertBefore(this.playheadControlsContainer, this.firstChild);
            }

            // Render compact sidebar HTML
            this.playheadControlsContainer.innerHTML = `

                <div id="playhead-list" style="flex: 1; overflow-y: auto;">
                    ${this.playheads.length === 0 ?
                        '<div style="padding: 10px; color: #888; font-size: 11px; text-align: center;">No playheads</div>' :
                        this.playheads.map((ph, index) => this.renderPlayheadItem(ph, index)).join('')
                    }
                </div>
                    <button id="add-playhead-btn" style="
                        background: #0e639c;
                        color: white;
                        border: none;
                        padding: 4px 2px;
                        cursor: pointer;
                        font-size: 10px;
                    ">+ Add Playhead</button>
            `;

            // Setup event handlers
            this.setupPlayheadEventHandlers();
        }

        /**
         * Render individual playhead item HTML (compact sidebar version)
         * @param {Playhead} playhead - Playhead to render
         * @param {number} index - Index in playheads array
         * @returns {string} HTML string
         */
        renderPlayheadItem(playhead, index) {
            const enabledStyle = playhead.enabled ? '' : 'opacity: 0.5;';

            return `
                <div class="playhead-item" data-playhead-id="${playhead.id}" style="
                    background: #252526;
                    padding: 2px 8px;
                    margin: 4px;
                    border-left: 3px solid ${playhead.color};
                    ${enabledStyle}
                    font-size: 11px;
                ">
                    <!-- Header with color indicator and number -->
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <div style="
                                width: 12px;
                                height: 12px;
                                background: ${playhead.color};
                                border-radius: 50%;
                                border: 1px solid #fff;
                            " class='playhead-indicator'>
                                <input type="color" id='the-picker' class="color-picker" data-playhead-id="${playhead.id}" value="${playhead.color}" style="
                                    width: 1px;
                                    height: 1px;
                                    border: 0px solid #555;
                                    cursor: pointer;
                                    padding: 0;
                                    opacity: 0;
                                " title="Change color">
                            </div>
                            <strong style="color: white; font-size: 11px;">&nbsp;</strong>
                        </div>

                        <button class="toggle-playhead-btn" data-playhead-id="${playhead.id}" style="
                            background: ${playhead.enabled ? '#608b4e' : '#888'};
                            color: white;
                            border: none;
                            padding: 3px 4px;
                            cursor: pointer;
                            font-size: 9px;
                            border-radius: 50%;
                        ">${playhead.enabled ? '▶' : '⏸'}</button>
                        <button class="remove-playhead-btn" data-playhead-id="${playhead.id}" style="
                            background: #d16969;
                            color: white;
                            border: none;
                            padding: 3px 5px;
                            cursor: pointer;
                            font-size: 10px;
                            line-height: 1;
                            border-radius: 50%;
                        ">×</button>
                    </div>

                    <!-- Speed selector -->
                    <div>
                        <label style="color: #888; font-size: 10px; display: block; margin-bottom: 2px;">Speed:</label>
                        <select class="speed-select" data-playhead-id="${playhead.id}" style="
                            width: 100%;
                            padding: 3px;
                            font-size: 10px;
                            background: #1e1e1e;
                            color: #d4d4d4;
                            border: 1px solid #555;
                        ">
                            ${this.renderSpeedOptions(playhead.speed)}
                        </select>
                    </div>

                    <!-- Control buttons row -->
                    <div style="display: flex; gap: 4px; margin-bottom: 4px;">

                    </div>

                </div>
            `;

        }

        /**
         * Render speed selector options
         * @param {number} currentSpeed - Current speed value
         * @returns {string} HTML options
         */
        renderSpeedOptions(currentSpeed) {
            return Playhead.SPEED_MULTIPLIERS.map(multiplier => {
                const selected = multiplier.value === currentSpeed ? 'selected' : '';
                return `<option value="${multiplier.value}" ${selected}>${multiplier.label}</option>`;
            }).join('');
        }

        /**
         * Setup event handlers for playhead controls
         */
        setupPlayheadEventHandlers() {
            if (!this.playheadControlsContainer) return;

            // Add playhead button
            const addBtn = this.playheadControlsContainer.querySelector('#add-playhead-btn');
            if (addBtn) {
                addBtn.onclick = () => this.handleAddPlayhead();
            }

            // Remove playhead buttons
            this.playheadControlsContainer.querySelectorAll('.remove-playhead-btn').forEach(btn => {
                btn.onclick = () => {
                    const playheadId = btn.dataset.playheadId;
                    if (confirm('Remove this playhead? This will also delete any whip bindings.')) {
                        this.handleRemovePlayhead(playheadId);
                    }
                };
            });

            // Toggle playhead buttons
            this.playheadControlsContainer.querySelectorAll('.toggle-playhead-btn').forEach(btn => {
                btn.onclick = () => {
                    const playheadId = btn.dataset.playheadId;
                    this.handleTogglePlayhead(playheadId);
                };
            });

            // Speed selectors
            this.playheadControlsContainer.querySelectorAll('.speed-select').forEach(select => {
                select.onchange = (e) => {
                    const playheadId = select.dataset.playheadId;
                    const speed = parseFloat(e.target.value);
                    this.handleSetPlayheadSpeed(playheadId, speed);
                };
            });

            this.playheadControlsContainer.querySelectorAll('.playhead-indicator').forEach(indicator => {
                indicator.onclick = () => {
                    const e = new MouseEvent('click');
                    indicator.querySelector('.color-picker').dispatchEvent(e);
                }
            })

            // Color pickers
            this.playheadControlsContainer.querySelectorAll('.color-picker').forEach(picker => {
                picker.onchange = (e) => {
                    const playheadId = picker.dataset.playheadId;
                    const color = e.target.value;
                    this.handleSetPlayheadColor(playheadId, color);
                };
            });
        }

        // ========================================
        // UI Event Handlers
        // ========================================

        /**
         * Handle "Add Playhead" button click
         */
        handleAddPlayhead() {
            this.addPlayhead({});
        }

        /**
         * Handle "Remove Playhead" button click
         * @param {string} playheadId - Playhead ID to remove
         */
        handleRemovePlayhead(playheadId) {
            this.removePlayhead(playheadId);
        }

        /**
         * Handle "Toggle Playhead" button click
         * @param {string} playheadId - Playhead ID to toggle
         */
        handleTogglePlayhead(playheadId) {
            const playhead = this.getPlayhead(playheadId);
            if (!playhead) return;

            playhead.setEnabled(!playhead.enabled);
            this.savePlayheads();
            this.renderPlayheadControls();
            this.onPlayheadListChanged(); // Trigger visual update
        }

        /**
         * Handle speed selector change
         * @param {string} playheadId - Playhead ID
         * @param {number} speed - New speed value
         */
        handleSetPlayheadSpeed(playheadId, speed) {
            const playhead = this.getPlayhead(playheadId);
            if (!playhead) return;

            playhead.setSpeed(speed);
            this.savePlayheads();
            this.renderPlayheadControls();
        }

        /**
         * Handle color picker change
         * @param {string} playheadId - Playhead ID
         * @param {string} color - New color value
         */
        handleSetPlayheadColor(playheadId, color) {
            const playhead = this.getPlayhead(playheadId);
            if (!playhead) return;

            playhead.color = color;
            this.savePlayheads();
            this.renderPlayheadControls();
            this.onPlayheadsAdvanced(); // Trigger render to update playhead visual
        }
    };
}
