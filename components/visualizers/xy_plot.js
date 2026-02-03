import '../../lib/d3.min.js';
import { SonofireVisualizerBase } from '../base/sonofire_visualizer_base.js';
import { MIDI_NOTES_FLAT, MIDI_NOTES_SHARP } from '../../lib/midi_data.js';
import { PLAYHEAD_SIDEBAR_WIDTH } from '../../lib/mixins/playheads.js';
import { layerManager } from '../../lib/layer_manager.js';

/**
 * XY Plot Visualizer - Refactored from pitch_generator.js
 * Displays time-series data as scatter plot with musical playback
 */
export class SonofireXYPlot extends SonofireVisualizerBase {
    // Number of ticks to sweep full width at 1x speed
    // At 24 PPQN and 90 BPM, 960 ticks = 40 beats = ~27 seconds
    static TICKS_PER_FULL_SWEEP = 960;

    constructor() {
        super();

        // Track recently sampled data indices per playhead to avoid re-sampling
        this.recentlySampledIndices = new Map(); // playheadId -> Set of indices

        // Y-domain zoom state
        this.yZoomLevel = 1.0; // 1.0 = full range, 0.1 = 10% of range (zoomed in)
        this.yZoomCenter = 0.5; // 0.0 = bottom, 1.0 = top, 0.5 = center
        this.autoYDomain = null; // Store auto-detected Y domain for reset
        this._isRestoringZoom = false; // Flag to prevent circular updates
        this._zoomRenderTimeout = null; // Debounce timer for zoom rendering

        // Layer system
        this.baseLayerCreated = false;
        this.LAYER_SIDEBAR_WIDTH = 250; // Width of right sidebar for layers
        this.isRenderingGraph = false; // Flag to prevent concurrent renders
        this._layersRenderPending = false; // Flag to prevent stacking deferred layer renders
    }

    /**
     * Render the component
     */
    async render() {
        // Detect container dimensions before rendering
        this.detectContainerDimensions();

        // Discover zoom state from PubSub before rendering
        this.discoverYZoomState();

        // Restore saved layers before rendering (but skip during section restore)
        // Note: Layers are NOT part of section save/restore, they have their own localStorage
        if (!this.sectionRestoreInProgress) {
            await layerManager.restoreLayers(this.getVisualizerId());
        } else {
            console.log('[XYPlot] Skipping localStorage layer restore during section restore');
        }

        // Check if base layer was restored
        const restoredLayers = layerManager.getLayersForVisualizer(this.getVisualizerId());
        const hasBaseLayer = restoredLayers.some(l => l.type === 'data');
        if (hasBaseLayer) {
            this.baseLayerCreated = true;
            console.log('XY Plot: Restored layers from storage:', restoredLayers.length);
        }

        // Create container with zoom slider and layer sidebar
        this.innerHTML = `
            <div style="display: flex; align-items: stretch; position: relative; height: 100%;">
                <div id="layer-sidebar" style="width: ${this.LAYER_SIDEBAR_WIDTH}px; margin-right: 5px; flex-shrink: 0; align-self: stretch;">
                    <!-- Layer controls will be added here -->
                </div>
                <div id="playhead-sidebar" style="
                    width: ${PLAYHEAD_SIDEBAR_WIDTH}px; margin-right: 5px; flex-shrink: 0; align-self: stretch;
                    width: ${PLAYHEAD_SIDEBAR_WIDTH}px;
                    background: #1e1e1e;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;">
                    <!-- Playhead controls will be rendered here -->
                </div>
                <div id="y-zoom-controls" style="display: flex; flex-direction: column; width: 40px; margin-right: 5px;">
                    <!-- Zoom slider will be added here -->
                </div>
                <div id="my_dataviz" style="flex: 1;"></div>
            </div>
        `;

        // Render graph
        await this.renderGraph();

        // Render zoom controls after graph is ready
        this.renderYZoomControls();

        // Render layer controls
        this.renderLayerControls();

        this.playheadControlsContainer = this.querySelector("#playhead-sidebar");
        // Render playhead controls after innerHTML is set (since we're async)
        // This ensures playheads aren't wiped out by innerHTML assignment above
        //if (this.renderPlayheadControls) {
            this.renderPlayheadControls();
        //}
    }

    /**
     * Discover Y-zoom state from PubSub on initialization
     */
    discoverYZoomState() {
        const visualizerId = this.getVisualizerId();
        const zoomData = this.getLastValue(`visualizer:${visualizerId}:yzoom`);

        if (zoomData) {
            console.log(`XY Plot: Discovered Y-zoom state for ${visualizerId}:`, zoomData);
            this._isRestoringZoom = true;
            this.yZoomLevel = zoomData.zoomLevel;
            this.yZoomCenter = zoomData.zoomCenter;
            this._isRestoringZoom = false;
        }
    }

    /**
     * Detect and set dimensions based on parent container
     * Only sets dimensions if they haven't been explicitly set via attributes
     */
    detectContainerDimensions() {
        const parentElement = this.parentElement;
        if (!parentElement) return;

        // Check if dimensions were explicitly set via attributes
        const hasExplicitWidth = this.getAttribute('width');
        const hasExplicitHeight = this.getAttribute('height');

        // Get computed dimensions of parent (excluding padding)
        const parentStyle = window.getComputedStyle(parentElement);
        const parentWidth = parentElement.clientWidth -
            parseFloat(parentStyle.paddingLeft) -
            parseFloat(parentStyle.paddingRight);
        const parentHeight = parentElement.clientHeight -
            parseFloat(parentStyle.paddingTop) -
            parseFloat(parentStyle.paddingBottom);

        // Only use parent dimensions if not explicitly set and available
        if (!hasExplicitWidth && parentWidth > 0) {
            // Subtract playhead sidebar width AND layer sidebar width
            this.width = parentWidth - PLAYHEAD_SIDEBAR_WIDTH - this.LAYER_SIDEBAR_WIDTH - 60; // Leave some margin
        }
        if (!hasExplicitHeight) {
            if (parentHeight > 0 && parentHeight > 200) {
                this.height = parentHeight - 20;
            } else {
                // Default height if parent has no explicit height
                this.height = 400;
            }
        }
    }

    /**
     * Cleanup when component is disconnected
     */
    disconnectedCallback() {
        // Clear any pending zoom render timeout
        if (this._zoomRenderTimeout) {
            clearTimeout(this._zoomRenderTimeout);
            this._zoomRenderTimeout = null;
        }

        // Call parent cleanup
        if (super.disconnectedCallback) {
            super.disconnectedCallback();
        }
    }

    /**
     * Load data from CSV
     */
    async loadData() {
        return await d3.csv(this.dataUrl);
    }

    /**
     * Override: Advance a specific playhead's position (domain-based)
     * Position advances by a fixed increment in the X domain (time), not percentage.
     * This ensures consistent playback timing aligned with the data's time scale.
     * @param {Playhead} playhead
     */
    advancePlayheadPosition(playhead) {
        if (!this.xDomain) return;

        // Get the X domain (date range)
        const [minDate, maxDate] = this.xDomain;
        const domainSpan = maxDate - minDate; // Total time span in milliseconds

        // Calculate time increment per tick
        // At 1x speed, playhead traverses the full domain in TICKS_PER_FULL_SWEEP ticks
        const timeIncrementMs = domainSpan / SonofireXYPlot.TICKS_PER_FULL_SWEEP;

        // Convert current percentage to date
        const currentDate = new Date(minDate.getTime() + (playhead.position * domainSpan));

        // Advance by time increment
        const newDate = new Date(currentDate.getTime() + timeIncrementMs);

        // Convert back to percentage
        let newPosition = (newDate - minDate) / domainSpan;

        // Loop back to start if reached end
        if (newPosition >= 1.0) {
            newPosition = newPosition - 1.0;
        }

        playhead.setPosition(newPosition);
    }

    /**
     * Override: Sample data at playhead's current position
     * Samples based on data domain, not pixel positions, ensuring consistent
     * event detection regardless of visualization width.
     * Tracks recently sampled indices to avoid re-sampling the same data points.
     * @param {Playhead} playhead
     */
    sampleDataAtPlayhead(playhead) {
        if (!this.data || this.data.length === 0) return;
        if (!this.xScale || !this.yScale) return;

        // Get the layer this playhead belongs to
        const layer = playhead.layerId ? layerManager.getLayer(playhead.layerId) : null;

        // Determine which data source to use
        let dataSource, getXFunc, getYFunc;

        if (layer && layer.outputData && layer.outputData.length > 0) {
            // Use layer's output data (both data and transform layers have outputData)
            dataSource = layer.outputData;
            getXFunc = (d) => d.x instanceof Date ? d.x : new Date(d.x);
            getYFunc = (d) => d.y;
        } else {
            // Fall back to original data if layer has no outputData
            if (layer) {
                console.log(`Playhead ${playhead.id} has layer "${layer.name}" but no outputData (type: ${layer.type}, status: ${layer.computeStatus}), using original CSV data`);
            } else {
                console.log(`Playhead ${playhead.id} has no layer, using original CSV data`);
            }
            dataSource = this.data;
            getXFunc = (d) => this.getX(d);
            getYFunc = (d) => this.getY(d);
        }

        // Initialize tracking set for this playhead if needed
        if (!this.recentlySampledIndices.has(playhead.id)) {
            this.recentlySampledIndices.set(playhead.id, new Set());
        }
        const recentlySampled = this.recentlySampledIndices.get(playhead.id);

        // Convert playhead percentage (0-1) to data domain value
        const [minDate, maxDate] = this.xDomain;
        const dateDomain = maxDate - minDate;
        const targetDate = new Date(minDate.getTime() + (playhead.position * dateDomain));

        // Use asymmetric window: small tolerance ahead, larger window behind
        // This makes notes trigger as the playhead crosses them, not before
        const windowAhead = 0.002;   // 0.2% ahead (small tolerance for timing)
        const windowBehind = 0.008;  // 0.8% behind (catch notes just passed)
        const windowStart = new Date(minDate.getTime() + ((playhead.position - windowBehind) * dateDomain));
        const windowEnd = new Date(minDate.getTime() + ((playhead.position + windowAhead) * dateDomain));

        // Find data points within window that haven't been sampled recently
        let yValueSum = 0;
        let yValueCount = 0;
        const sampledIndices = [];
        const newlySampledIndices = [];

        dataSource.forEach((d, index) => {
            const dataDate = getXFunc(d);
            if (dataDate >= windowStart && dataDate <= windowEnd) {
                sampledIndices.push(index);

                // Only sample if not recently sampled
                if (!recentlySampled.has(index)) {
                    const yValue = getYFunc(d);
                    yValueSum += yValue;
                    yValueCount++;
                    newlySampledIndices.push(index);
                    recentlySampled.add(index);
                }
            }
        });

        // Clear indices that are now behind the playhead (outside the window)
        const clearThreshold = playhead.position - (windowBehind * 2);
        dataSource.forEach((d, index) => {
            const dataDate = getXFunc(d);
            const dataPosition = (dataDate - minDate) / dateDomain;

            // Handle wrap-around: if playhead looped back to start, clear high positions
            if (clearThreshold < 0) {
                // Playhead just looped - clear positions > 0.95 (near end)
                if (dataPosition > 0.95) {
                    recentlySampled.delete(index);
                }
            } else {
                // Normal case - clear positions behind the playhead
                if (dataPosition < clearThreshold) {
                    recentlySampled.delete(index);
                }
            }
        });

        // Animate only newly sampled data points (not re-sampled ones)
        if (newlySampledIndices.length > 0) {
            const svg = d3.select(this.$('#my_dataviz svg'));
            if (svg.node()) {
                // Select the correct SVG group based on which layer we're sampling
                let circleGroup;
                const isTransformLayer = layer && layer.type === 'transform';
                const usesLineRendering = isTransformLayer && layer.outputData.length > 100;

                if (isTransformLayer) {
                    // Transform layer - target that layer's specific group
                    circleGroup = svg.select(`.layer-${layer.id}`);
                } else {
                    // Data layer or no layer - target original data circles
                    circleGroup = svg.select('.data-circles-group');
                }

                if (circleGroup.node()) {
                    if (usesLineRendering) {
                        // Layer uses line rendering - create temporary circles for animation
                        newlySampledIndices.forEach(index => {
                            const dataPoint = dataSource[index];
                            if (!dataPoint) return;

                            const xPos = this.xScale(getXFunc(dataPoint));
                            const yPos = this.yScale(getYFunc(dataPoint));

                            // Create temporary circle
                            const tempCircle = circleGroup.append('circle')
                                .attr('cx', xPos)
                                .attr('cy', yPos)
                                .attr('r', 2)
                                .style('fill', layer.color)
                                .style('opacity', 0.8);

                            // Animate and remove
                            tempCircle
                                .transition()
                                .duration(100)
                                .attr('r', 6)
                                .style('fill', playhead.color)
                                .style('opacity', 1)
                                .transition()
                                .duration(200)
                                .attr('r', 2)
                                .style('fill', layer.color)
                                .style('opacity', 0)
                                .remove(); // Remove after animation completes
                        });
                    } else {
                        // Layer uses circle rendering - animate existing circles
                        circleGroup.selectAll('circle')
                            .each(function(d, i) {
                                if (newlySampledIndices.includes(i)) {
                                    const circle = d3.select(this);
                                    const originalFill = isTransformLayer ? layer.color : '#69b3a2';
                                    const originalRadius = isTransformLayer ? (layer.selected ? 4 : 2.5) : 1.5;

                                    circle
                                        .transition()
                                        .duration(100)
                                        .attr('r', 6)
                                        .style('fill', playhead.color)
                                        .style('opacity', 1)
                                        .transition()
                                        .duration(200)
                                        .attr('r', originalRadius)
                                        .style('fill', originalFill)
                                        .style('opacity', 0.8);
                                }
                            });
                    }
                }
            }
        }

        if (yValueCount > 0) {
            // Average Y value in data coordinates
            const avgYData = yValueSum / yValueCount;

            // Convert to SVG coordinates for display
            const avgYPixel = this.yScale(avgYData);

            // Normalize to 0-1 (invert because SVG Y increases downward)
            const normalizedValue = 1.0 - (avgYPixel / this.height);

            // Call playhead's sample method
            playhead.sampleValue(avgYPixel, normalizedValue);
        }
    }

    /**
     * Override: Called after playheads advance
     */
    onPlayheadsAdvanced() {
        this.renderPlayheads();
    }

    /**
     * Override: Called when playhead list changes (add/remove/toggle)
     */
    onPlayheadListChanged() {
        this.renderPlayheads();
    }

    /**
     * Get lookahead data window for phrase planning
     * @param {Playhead} playhead - The playhead to look ahead from
     * @param {number} ticksAhead - How many ticks to look ahead
     * @returns {Array} Array of upcoming data points
     */
    getLookaheadData(playhead, ticksAhead) {
        if (!this.data || this.data.length === 0) {
            return [];
        }

        // Current position is percentage (0-1), convert to pixels
        const currentPosPercent = playhead.position;
        const speed = playhead.speed;
        const ticksPerPixel = 1.0 / speed; // How many ticks to advance 1 pixel
        const pixelsAhead = ticksAhead / ticksPerPixel;

        // Calculate percentage range for lookahead
        const percentAhead = pixelsAhead / this.width;
        const endPosPercent = currentPosPercent + percentAhead;

        // Convert to pixel positions for circle comparison
        const currentPos = currentPosPercent * this.width;
        const endPos = endPosPercent * this.width;

        // Get SVG scales for coordinate conversion
        const svg = d3.select(this.$('#my_dataviz svg'));
        if (!svg.node()) return [];

        const parent = svg.select('g');
        const upcomingPoints = [];
        const height = this.height; // Capture height before D3 loop

        // Find all circles between current position and end position
        parent.selectAll('circle').each(function() {
            const circle = d3.select(this);
            const cx = parseFloat(circle.attr('cx'));
            const cy = parseFloat(circle.attr('cy'));

            if (!isNaN(cx) && !isNaN(cy) && cx >= currentPos && cx <= endPos) {
                upcomingPoints.push({
                    x: cx,
                    y: cy,
                    normalizedValue: 1.0 - (cy / height) // Invert because SVG Y increases downward
                });
            }
        });

        return upcomingPoints;
    }

    /**
     * Calculate linear regression trend for lookahead data
     * @param {Array} dataPoints - Array of {x, y, normalizedValue} objects
     * @returns {Object} { slope, direction, confidence }
     */
    calculateDataTrend(dataPoints) {
        if (dataPoints.length < 2) {
            return { slope: 0, direction: 'flat', confidence: 0 };
        }

        // Simple linear regression: y = mx + b
        const n = dataPoints.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

        dataPoints.forEach((point, i) => {
            sumX += i;
            sumY += point.normalizedValue;
            sumXY += i * point.normalizedValue;
            sumX2 += i * i;
        });

        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const direction = slope > 0.05 ? 'rising' : slope < -0.05 ? 'falling' : 'flat';
        const confidence = Math.min(Math.abs(slope) * 2, 1.0);

        return { slope, direction, confidence };
    }

    /**
     * Setup subscriptions including chord change for lookahead and zoom state
     */
    setupSubscriptions() {
        super.setupSubscriptions();

        // Subscribe to chord changes to publish lookahead data
        this.subscribe('music:chord', (chordData) => {
            this.handleChordChangeForLookahead(chordData);
        });

        // Subscribe to Y-zoom state changes for this visualizer
        const visualizerId = this.getVisualizerId();
        this.subscribe(`visualizer:${visualizerId}:yzoom`, (zoomData) => {
            this.handleYZoomChange(zoomData);
        });

        // Subscribe to layer computation events to re-render
        this.subscribe(`layer:*:computed`, (data) => {
            // Check if this layer belongs to this visualizer
            const layer = layerManager.getLayer(data.layerId);
            if (layer && layer.visualizerId === visualizerId) {
                console.log(`XY Plot: Layer ${layer.name} computed, re-rendering`);

                // Auto-adjust Y-domain if user hasn't manually zoomed
                if (this.yZoomLevel === 1.0 && !this.yDomainOverride) {
                    // adjustYDomainForLayers() calls renderGraph(), which calls renderLayers()
                    this.adjustYDomainForLayers();
                } else {
                    // Otherwise, just render layers (domain stays the same)
                    this.renderLayers();
                }

                this.renderLayerControls();
            }
        });

        // Subscribe to layer added/removed events
        this.subscribe(`visualizer:${visualizerId}:layer:added`, (data) => {
            console.log(`XY Plot: Layer added, re-rendering controls`);
            this.renderLayerControls();
        });

        this.subscribe(`visualizer:${visualizerId}:layer:removed`, (data) => {
            console.log(`XY Plot: Layer removed, re-rendering`);
            this.renderLayers();
            this.renderLayerControls();
        });
    }

    /**
     * Handle Y-zoom state change from PubSub
     */
    handleYZoomChange(zoomData) {
        // Only update if the values are different (avoid circular updates)
        const zoomLevelChanged = Math.abs(this.yZoomLevel - zoomData.zoomLevel) > 0.001;
        const zoomCenterChanged = Math.abs(this.yZoomCenter - zoomData.zoomCenter) > 0.001;

        if (zoomLevelChanged || zoomCenterChanged) {
            // Set flag to prevent re-publishing during update
            this._isRestoringZoom = true;

            this.yZoomLevel = zoomData.zoomLevel;
            this.yZoomCenter = zoomData.zoomCenter;

            // Update the slider if it exists
            const slider = this.$('input[type="range"]');
            if (slider) {
                slider.value = this.yZoomLevel;
            }

            // Apply zoom
            this.updateYDomainFromZoom();

            this._isRestoringZoom = false;
        }
    }

    /**
     * Publish Y-zoom state to PubSub
     */
    publishYZoomState() {
        const visualizerId = this.getVisualizerId();
        const zoomData = {
            zoomLevel: this.yZoomLevel,
            zoomCenter: this.yZoomCenter,
            timestamp: Date.now()
        };

        this.publish(`visualizer:${visualizerId}:yzoom`, zoomData);
        console.log(`XY Plot: Published Y-zoom state for ${visualizerId}:`, zoomData);
    }

    /**
     * Handle chord change by publishing lookahead data for each playhead
     */
    handleChordChangeForLookahead(chordData) {
        // Wait a moment for music:nextChord to be published
        setTimeout(() => {
            const nextChordInfo = this.getLastValue('music:nextChord');
            if (!nextChordInfo) {
                console.log('XY Plot: No next chord info available for lookahead');
                return;
            }

            // For each active playhead, publish lookahead data
            this.playheads.forEach((playhead, index) => {
                if (!playhead.enabled) return;

                const lookaheadData = this.getLookaheadData(playhead, nextChordInfo.ticksUntilChange);
                const trend = this.calculateDataTrend(lookaheadData);

                const payload = {
                    visualizerId: this.getVisualizerId(),
                    playheadId: playhead.id,
                    dataPoints: lookaheadData,
                    trend: trend,
                    estimatedEventCount: lookaheadData.length,
                    ticksUntilChord: nextChordInfo.ticksUntilChange
                };

                // Publish per-playhead lookahead topic
                const topic = `data:lookahead:${playhead.id}`;
                this.publish(topic, payload);

                // Also publish to general topic for first playhead (backward compatibility)
                if (index === 0) {
                    this.publish('data:lookahead', payload);
                }

            });
        }, 100); // Wait 100ms for next chord to be published
    }

    /**
     * Render all playheads with source lights
     */
    renderPlayheads() {
        const svg = d3.select(this.$('#my_dataviz svg'));
        if (!svg.node()) return;

        const parent = svg.select('g');

        // Remove old playhead visuals
        parent.selectAll('.multi-playhead').remove();
        parent.selectAll('.playhead-indicator-triangle').remove();

        // Guard: Don't render if scales aren't set up yet
        if (!this.xDomain || !this.xScale) {
            return;
        }

        // Get selected layer for opacity determination
        const layers = layerManager.getLayersForVisualizer(this.getVisualizerId());
        const selectedLayer = layers.find(l => l.selected);

        // Render each playhead
        this.playheads.forEach((playhead, index) => {
            if (!playhead.enabled) return;

            // Determine opacity based on whether playhead's layer is selected
            // 50% opacity for non-selected layers, 70% for selected layer
            const isSelectedLayer = !selectedLayer || playhead.layerId === selectedLayer.id;
            const opacity = isSelectedLayer ? 0.7 : 0.35; // 50% of 0.7 = 0.35

            // Convert percentage position (0-1) to data domain, then use scale for pixel position
            // This ensures playhead aligns with where data is being sampled
            const [minDate, maxDate] = this.xDomain;
            const dateDomain = maxDate - minDate;
            const targetDate = new Date(minDate.getTime() + (playhead.position * dateDomain));
            const xPosition = this.xScale(targetDate);

            // Render playhead line
            const line = parent.append('line')
                .attr('class', 'multi-playhead')
                .attr('data-playhead-id', playhead.id)
                .style('stroke', playhead.color)
                .style('stroke-width', 2)
                .style('opacity', opacity)
                .style('cursor', 'pointer')
                .attr('x1', xPosition)
                .attr('y1', 0)
                .attr('x2', xPosition)
                .attr('y2', this.height);

            // Render draggable triangle at top of playhead (pointing down)
            const triangleSize = 8;
            const triangleTop = 0;  // Start at the very top
            const trianglePoints = [
                [xPosition - triangleSize, triangleTop], // Top left
                [xPosition + triangleSize, triangleTop], // Top right
                [xPosition, triangleTop + triangleSize * 1.5]  // Bottom point (pointing down)
            ];

            const triangle = parent.append('polygon')
                .attr('class', 'playhead-indicator-triangle')
                .attr('data-playhead-id', playhead.id)
                .attr('points', trianglePoints.map(p => p.join(',')).join(' '))
                .style('fill', playhead.color)
                .style('cursor', 'grab')
                .style('opacity', isSelectedLayer ? 0.9 : 0.45); // 50% opacity for non-selected layers

            triangle.append('title')
                .text(`Playhead ${index + 1}\nSpeed: ${playhead.getSpeedLabel()}\nDrag to reposition playhead`);

            // Add mousedown handler to select layer and scroll to playhead
            const self = this;
            const selectPlayheadHandler = function(event) {
                // Select the layer this playhead belongs to
                if (playhead.layerId) {
                    self.selectLayer(playhead.layerId);
                }

                // Scroll to playhead in the playhead list
                const playheadSidebar = self.querySelector('#playhead-sidebar');
                if (playheadSidebar) {
                    const playheadEntry = playheadSidebar.querySelector(`.playhead-item[data-playhead-id="${playhead.id}"]`);
                    if (playheadEntry) {
                        playheadEntry.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        // Flash the playhead entry to indicate selection
                        playheadEntry.style.transition = 'background-color 0.3s';
                        playheadEntry.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                        setTimeout(() => {
                            playheadEntry.style.backgroundColor = '';
                        }, 300);
                    }
                }
            };

            // Attach to both triangle and line
            triangle.on('mousedown', selectPlayheadHandler);
            line.on('mousedown', selectPlayheadHandler);

            // Add drag behavior using D3's drag API (more robust)
            const margin = self.margin || { left: 60, right: 20, top: 20, bottom: 50 };

            const dragBehavior = d3.drag()
                .on('start', function(event) {
                    triangle.style('cursor', 'grabbing');
                    event.sourceEvent.stopPropagation();
                })
                .on('drag', function(event) {
                    // Get mouse position relative to the plot
                    const svgNode = svg.node();
                    const svgRect = svgNode.getBoundingClientRect();

                    // Calculate x position relative to the SVG's left edge
                    const mouseX = event.sourceEvent.clientX - svgRect.left;

                    // Clamp to plot bounds (accounting for margins)
                    const plotLeft = margin.left;
                    const plotRight = self.width + margin.left;
                    const newX = Math.max(plotLeft, Math.min(plotRight, mouseX)) - margin.left;

                    // Update line position directly (smooth, no re-render)
                    line.attr('x1', newX)
                        .attr('x2', newX);

                    // Update triangle position directly
                    const newTrianglePoints = [
                        [newX - triangleSize, triangleTop],
                        [newX + triangleSize, triangleTop],
                        [newX, triangleTop + triangleSize * 1.5]
                    ];
                    triangle.attr('points', newTrianglePoints.map(p => p.join(',')).join(' '));

                    // Calculate and store new position as percentage (0-1)
                    const [minDate, maxDate] = self.xDomain;
                    const newDate = self.xScale.invert(newX);
                    const dateDomain = maxDate - minDate;
                    const newPosition = Math.max(0, Math.min(1, (newDate - minDate) / dateDomain));
                    playhead.setPosition(newPosition);
                })
                .on('end', function(event) {
                    triangle.style('cursor', 'grab');
                    // Save playhead state after drag
                    self.savePlayheads();
                });

            triangle.call(dragBehavior);
        });
    }

    /**
     * Render Y-axis zoom controls (vertical slider + zoom buttons)
     */
    renderYZoomControls() {
        const container = this.$('#y-zoom-controls');
        if (!container) return;

        // Clear existing controls
        container.innerHTML = '';

        // Create slider container (takes up most of the height)
        const sliderContainer = document.createElement('div');
        sliderContainer.style.cssText = `
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 10px 0;
            position: relative;
            height: 1px;
        `;

        // Create vertical range slider for zoom level
        // Range from 0.2 to 3.6, with midpoint at 1.0 (auto-detected range)
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0.2';
        slider.max = '3.6';
        slider.step = '0.05';
        slider.value = this.yZoomLevel;
        slider.orient = 'vertical'; // For older browsers (non-standard but supported)
        slider.style.cssText = `
            writing-mode: vertical-lr;
            direction: rtl;
            -webkit-appearance: slider-vertical; /* Fallback for older WebKit */
            appearance: auto; /* Modern standard */
            width: 8px; /* This becomes the visual height when rotated */
            height: 100%; /* This becomes the visual width when rotated */
            margin: 0;
            cursor: pointer;
        `;
        slider.title = 'Y-axis zoom level (drag to zoom)';

        // Update zoom when slider changes (debounced for smooth dragging)
        slider.addEventListener('input', (e) => {
            this.yZoomLevel = parseFloat(e.target.value);
            this.debouncedUpdateYDomainFromZoom();
        });

        sliderContainer.appendChild(slider);
        container.appendChild(sliderContainer);

        // Create buttons container at bottom
        const buttonsContainer = document.createElement('div');
        buttonsContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 2px;
            padding: 5px 0;
        `;

        // Zoom in button (decrease zoom level = zoom in)
        const zoomInBtn = document.createElement('button');
        zoomInBtn.textContent = '+';
        zoomInBtn.title = 'Zoom in (Y-axis)';
        zoomInBtn.style.cssText = `
            background: #0e639c;
            color: white;
            border: none;
            padding: 4px 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
        `;
        zoomInBtn.addEventListener('click', () => {
            this.yZoomLevel = Math.max(0.2, this.yZoomLevel - 0.1);
            slider.value = this.yZoomLevel;
            this.debouncedUpdateYDomainFromZoom();
        });

        // Zoom out button (increase zoom level = zoom out)
        const zoomOutBtn = document.createElement('button');
        zoomOutBtn.textContent = '−';
        zoomOutBtn.title = 'Zoom out (Y-axis)';
        zoomOutBtn.style.cssText = `
            background: #0e639c;
            color: white;
            border: none;
            padding: 4px 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
        `;
        zoomOutBtn.addEventListener('click', () => {
            this.yZoomLevel = Math.min(3.6, this.yZoomLevel + 0.1);
            slider.value = this.yZoomLevel;
            this.debouncedUpdateYDomainFromZoom();
        });

        // Reset button
        const resetBtn = document.createElement('button');
        resetBtn.textContent = '⟲';
        resetBtn.title = 'Reset Y-axis zoom';
        resetBtn.style.cssText = `
            background: #0e639c;
            color: white;
            border: none;
            padding: 4px 8px;
            cursor: pointer;
            font-size: 14px;
        `;
        resetBtn.addEventListener('click', () => {
            this.yZoomLevel = 1.0;
            this.yZoomCenter = 0.5;
            slider.value = this.yZoomLevel;
            this.debouncedUpdateYDomainFromZoom();
        });

        buttonsContainer.appendChild(zoomInBtn);
        buttonsContainer.appendChild(zoomOutBtn);
        buttonsContainer.appendChild(resetBtn);
        container.appendChild(buttonsContainer);
    }

    /**
     * Debounced version of updateYDomainFromZoom for smooth slider interaction
     * Delays graph re-render by 50ms to batch rapid zoom changes
     */
    debouncedUpdateYDomainFromZoom() {
        // Clear existing timeout
        if (this._zoomRenderTimeout) {
            clearTimeout(this._zoomRenderTimeout);
        }

        // Set new timeout to render after 50ms
        this._zoomRenderTimeout = setTimeout(() => {
            this.updateYDomainFromZoom();
            this._zoomRenderTimeout = null;
        }, 50);
    }

    /**
     * Update Y domain based on current zoom level and center
     * Then re-render the graph (but not zoom controls)
     */
    updateYDomainFromZoom() {
        if (!this.autoYDomain) return;

        const [autoMin, autoMax] = this.autoYDomain;
        const autoRange = autoMax - autoMin;

        // Calculate new range based on zoom level
        const newRange = autoRange * this.yZoomLevel;

        // Calculate center point in data coordinates
        const centerValue = autoMin + (autoRange * this.yZoomCenter);

        // Calculate new domain centered on centerValue
        const newMin = centerValue - (newRange / 2);
        const newMax = centerValue + (newRange / 2);

        // Update Y domain override
        this.yDomainOverride = [newMin, newMax];

        // Re-render graph with new Y domain
        this.renderGraph();

        // Publish zoom state to PubSub for persistence (unless we're restoring)
        if (!this._isRestoringZoom) {
            this.publishYZoomState();
        }

        console.log(`Y-axis zoom: level=${this.yZoomLevel.toFixed(2)}, domain=[${newMin.toFixed(2)}, ${newMax.toFixed(2)}]`);
    }

    /**
     * Override renderGraph to include playhead rendering
     */
    async renderGraph() {
        // Debug: Track what's triggering renderGraph
        console.log('[XYPlot] renderGraph() called from:', new Error().stack.split('\n')[2].trim());

        // Set flag to prevent concurrent renders
        this.isRenderingGraph = true;

        // Clear existing graph
        const existingSvg = this.$('#my_dataviz svg');
        if (existingSvg) {
            existingSvg.remove();
        }

        // Calculate scale partitions (note boundaries)
        const partitions = this.calculateScalePartitions(
            this.scale,
            this.scaleTones,
            this.scaleRoot,
            this.octaves
        );

        this.dataBoundaries = [];

        // Create SVG
        const svg = d3.select(this.$('#my_dataviz'))
            .append('svg')
            .attr('width', this.width + this.margin.left + this.margin.right)
            .attr('height', this.height + this.margin.top + this.margin.bottom)
            .append('g')
            .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

        this.svg = svg;

        // Add clip path to prevent data points from appearing outside axes
        svg.append('defs')
            .append('clipPath')
            .attr('id', `clip-${this.getVisualizerId()}`)
            .append('rect')
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', this.width)
            .attr('height', this.height);

        // Load data first to enable auto-detection
        const data = await this.loadData();
        this.data = data;

        const getX = (d) => new Date(d[this.xColumn]);
        const getY = (d) => parseFloat(d[this.yColumn]);

        // Store data accessors for sampling
        this.getX = getX;
        this.getY = getY;

        // Create base layer from original data (only once)
        // Normalize data to {x: Date, y: number, value: number} format for layers
        const normalizedData = data.map(d => {
            const yValue = getY(d);
            return {
                x: getX(d),
                y: yValue,
                value: yValue
            };
        });

        if (!this.baseLayerCreated) {
            const baseLayer = layerManager.addLayer(this.getVisualizerId(), {
                name: 'Original Data',
                type: 'data',
                transformType: null,
                color: '#4FC3F7'
            });
            // Update base layer with normalized data
            layerManager.updateLayerData(baseLayer.id, normalizedData);
            this.baseLayerCreated = true;
        } else {
            // Update existing base layer
            const layers = layerManager.getLayersForVisualizer(this.getVisualizerId());
            const baseLayer = layers.find(l => l.type === 'data');
            if (baseLayer) {
                layerManager.updateLayerData(baseLayer.id, normalizedData);
            }
        }

        // Determine X domain (manual override or auto-detect)
        let xDomain;
        if (this.xDomainOverride) {
            xDomain = this.xDomainOverride;
            console.log('XY Plot: Using manual X domain:', xDomain);
        } else {
            // Auto-detect from data
            xDomain = d3.extent(data, getX);
            console.log('XY Plot: Auto-detected X domain:', xDomain);
        }

        // Add X axis
        const x = d3.scaleTime()
            .domain(xDomain)
            .range([0, this.width]);

        // Store scales for data sampling
        this.xScale = x;
        this.xDomain = x.domain();

        svg.append('g')
            .attr('transform', `translate(0,${this.height})`)
            .call(d3.axisBottom(x));

        // Determine Y domain (manual override or auto-detect)
        let yDomain;
        if (this.yDomainOverride) {
            yDomain = this.yDomainOverride;
            console.log('XY Plot: Using manual Y domain:', yDomain);
        } else {
            // Auto-detect from data with 5% padding
            const [yMin, yMax] = d3.extent(data, getY);
            const yPadding = (yMax - yMin) * 0.05;
            yDomain = [yMin - yPadding, yMax + yPadding];

            // Store auto-detected domain for zoom controls (only if not already stored)
            if (!this.autoYDomain) {
                this.autoYDomain = yDomain;
            }

            console.log('XY Plot: Auto-detected Y domain:', yDomain);
        }

        // Add Y axis
        const y = d3.scaleLinear()
            .domain(yDomain)
            .range([this.height, 0]);

        this.yScale = y;

        svg.append('g')
            .call(d3.axisLeft(y));

        // Draw note boundary rectangles
        /*for (let i = 0; i < partitions.length; i++) {
            const opacity = i % 2 === 0 ? '0.1' : '0.00';
            const upperBoundary = (i + 1) * (this.height / partitions.length);
            const lowerBoundary = i * (this.height / partitions.length);

            this.dataBoundaries.push({
                lowerBoundary,
                upperBoundary,
                note: partitions[i]
            });

            svg.append('rect')
                .attr('fill', `rgba(0, 0, 0, ${opacity})`)
                .attr('x', 0)
                .attr('width', this.width)
                .attr('y', lowerBoundary)
                .attr('height', upperBoundary - lowerBoundary);
        }*/

        // Clear recently sampled tracking when data reloads
        this.recentlySampledIndices.clear();

        // Check if base layer is visible before rendering original data circles
        const layers = layerManager.getLayersForVisualizer(this.getVisualizerId());
        const baseLayer = layers.find(l => l.type === 'data');
        const shouldRenderBaseData = !baseLayer || baseLayer.visible;

        // Plot data points (with clipping to prevent overflow)
        if (shouldRenderBaseData) {
            svg.append('g')
                .attr('class', 'data-circles-group')
                .attr('clip-path', `url(#clip-${this.getVisualizerId()})`)
                .selectAll('dot')
                .data(data)
                .enter()
                .append('circle')
                .attr('cx', (d) => x(getX(d)))
                .attr('cy', (d) => y(getY(d)))
                .attr('class', (d) => {
                    let noteBoundary = '';
                    const yPos = y(getY(d));

                    // Find which note boundary this point falls into
                    for (let i = 0; i < this.dataBoundaries.length; i++) {
                        if (yPos >= this.dataBoundaries[i].lowerBoundary &&
                            yPos < this.dataBoundaries[i].upperBoundary) {
                            noteBoundary = `note-${this.dataBoundaries[i].note}`;
                            break;
                        }
                    }

                    return `x-${parseInt(x(getX(d)))} ${noteBoundary}`;
                })
                .attr('r', 1.5)
                .style('fill', '#69b3a2');
        }

        // Render layers (with slight delay to ensure SVG is fully ready)
        requestAnimationFrame(() => {
            this.renderLayers();
            // Clear flag after layers are rendered
            this.isRenderingGraph = false;
        });

        // Render playheads after data is loaded
        this.renderPlayheads();

        // Add resize handle (inherited from base class)
        this.addResizeHandle();

        // Set initial parent container size
        this.updateParentContainerSize();
    }

    /**
     * Render just the data circles (without rebuilding entire graph)
     * Used for toggling base layer visibility without triggering recomputation
     */
    renderDataCircles() {
        if (!this.svg || !this.xScale || !this.yScale) {
            console.warn('XY Plot: Cannot render data circles - svg or scales not ready');
            return;
        }

        // Remove existing data circles group
        this.svg.selectAll('.data-circles-group').remove();

        // Check if base layer is visible
        const layers = layerManager.getLayersForVisualizer(this.getVisualizerId());
        const baseLayer = layers.find(l => l.type === 'data');
        const shouldRenderBaseData = !baseLayer || baseLayer.visible;

        console.log('XY Plot: renderDataCircles - shouldRender:', shouldRenderBaseData, 'hasData:', !!this.data);

        if (!shouldRenderBaseData) {
            console.log('XY Plot: Base layer hidden, not rendering circles');
            return;
        }

        if (!this.data) {
            console.warn('XY Plot: No data available for rendering circles');
            return;
        }

        // Use the same data accessors as renderGraph() - access CSV columns
        const getX = (d) => new Date(d[this.xColumn]);
        const getY = (d) => parseFloat(d[this.yColumn]);

        // Re-render data circles
        this.svg.append('g')
            .attr('class', 'data-circles-group')
            .attr('clip-path', `url(#clip-${this.getVisualizerId()})`)
            .selectAll('dot')
            .data(this.data)
            .enter()
            .append('circle')
            .attr('cx', (d) => this.xScale(getX(d)))
            .attr('cy', (d) => this.yScale(getY(d)))
            .attr('class', (d) => {
                let noteBoundary = '';
                const yPos = this.yScale(getY(d));

                // Find which note boundary this point falls into
                for (let i = 0; i < this.dataBoundaries.length; i++) {
                    if (yPos >= this.dataBoundaries[i].lowerBoundary &&
                        yPos < this.dataBoundaries[i].upperBoundary) {
                        noteBoundary = `note-${this.dataBoundaries[i].note}`;
                        break;
                    }
                }

                return `x-${parseInt(this.xScale(getX(d)))} ${noteBoundary}`;
            })
            .attr('r', 1.5)
            .style('fill', '#69b3a2');

        console.log(`XY Plot: Rendered ${this.data.length} data circles`);
    }

    /**
     * Adjust Y-domain to include all layer data
     * Only called when user hasn't manually zoomed
     */
    adjustYDomainForLayers() {
        const layers = layerManager.getLayersForVisualizer(this.getVisualizerId());

        // Collect all Y values from all computed layers
        let allYValues = [];

        layers.forEach(layer => {
            if (layer.computeStatus === 'complete' && layer.outputData && layer.outputData.length > 0) {
                const yValues = layer.outputData.map(d => d.y !== undefined ? d.y : d.value);
                allYValues = allYValues.concat(yValues);
            }
        });

        if (allYValues.length === 0) return;

        // Find min/max across all layers
        const yMin = Math.min(...allYValues);
        const yMax = Math.max(...allYValues);

        // Add 5% padding
        const yPadding = (yMax - yMin) * 0.05;
        const newYDomain = [yMin - yPadding, yMax + yPadding];

        // Update auto domain
        this.autoYDomain = newYDomain;

        // Re-render graph with new domain
        this.renderGraph();

        console.log(`XY Plot: Auto-adjusted Y-domain to [${newYDomain[0].toFixed(2)}, ${newYDomain[1].toFixed(2)}]`);
    }

    /**
     * Render all layers
     */
    renderLayers() {
        // If graph is currently being rendered, defer this call
        if (this.isRenderingGraph) {
            // Only schedule one deferred call, not multiple
            if (!this._layersRenderPending) {
                console.log('XY Plot: Deferring renderLayers - graph render in progress');
                this._layersRenderPending = true;
                requestAnimationFrame(() => {
                    this._layersRenderPending = false;
                    this.renderLayers();
                });
            }
            return;
        }

        if (!this.svg || !this.xScale || !this.yScale) {
            console.warn('XY Plot: Cannot render layers - svg or scales not ready');
            return;
        }

        const layers = layerManager.getLayersForVisualizer(this.getVisualizerId());
        console.log(`XY Plot: Rendering ${layers.length} layers`);

        // Remove old layer groups
        this.svg.selectAll('.layer-group').remove();

        // Render each layer (skip the base 'data' layer as it's already rendered as circles)
        layers.forEach((layer, index) => {
            if (!layer.visible || layer.type === 'data') return;
            if (layer.computeStatus !== 'complete' || !layer.outputData || layer.outputData.length === 0) return;

            const layerGroup = this.svg.append('g')
                .attr('class', `layer-group layer-${layer.id}`)
                .attr('clip-path', `url(#clip-${this.getVisualizerId()})`)
                .style('opacity', layer.selected ? 1.0 : layer.opacity);

            const getX = (d) => d.x instanceof Date ? d.x : new Date(d.x);
            const getY = (d) => d.y !== undefined ? d.y : d.value;

            // Render layer data points or line
            if (layer.outputData.length > 100) {
                // Use line for dense data
                const line = d3.line()
                    .x(d => this.xScale(getX(d)))
                    .y(d => this.yScale(getY(d)));

                layerGroup.append('path')
                    .datum(layer.outputData)
                    .attr('d', line)
                    .attr('fill', 'none')
                    .attr('stroke', layer.color)
                    .attr('stroke-width', layer.selected ? 2 : 1);
            } else {
                // Use circles for sparse data (like DWT peaks)
                layerGroup.selectAll('circle')
                    .data(layer.outputData)
                    .enter()
                    .append('circle')
                    .attr('cx', d => this.xScale(getX(d)))
                    .attr('cy', d => this.yScale(getY(d)))
                    .attr('r', layer.selected ? 4 : 2.5)
                    .attr('fill', layer.color)
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 0.5);
            }

            // Click to select layer
            layerGroup.style('cursor', 'pointer')
                .on('click', () => {
                    this.selectLayer(layer.id);
                });
        });
    }

    /**
     * Select a layer (makes it opaque, others stay transparent)
     */
    selectLayer(layerId) {
        const layers = layerManager.getLayersForVisualizer(this.getVisualizerId());

        layers.forEach(l => {
            l.selected = (l.id === layerId);
        });

        this.renderLayers();
        this.renderLayerControls(); // Update UI to reflect selection
        this.renderPlayheadControls(); // Update playhead list for selected layer
        this.renderPlayheads(); // Update playhead opacity for non-selected layers
    }

    /**
     * Render layer controls sidebar
     */
    renderLayerControls() {
        const container = this.$('#layer-sidebar');
        if (!container) return;

        // Preserve scroll position
        const layerList = this.$('.layer-list');
        const scrollTop = layerList?.scrollTop || 0;

        const layers = layerManager.getLayersForVisualizer(this.getVisualizerId());

        container.innerHTML = `
            <div style="
                background: #1e1e1e;
                border-right: 1px solid #555;
                padding: 10px;
                height: 100%;
                overflow-y: auto;
                overflow-x: hidden;
                color: #d4d4d4;
                display: flex;
                flex-direction: column;
            ">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-shrink: 0;">
                    <strong>Layers</strong>
                    <button id="add-layer-btn" style="
                        padding: 4px 8px;
                        background: #0e639c;
                        color: white;
                        border: none;
                        cursor: pointer;
                        border-radius: 3px;
                        font-size: 11px;
                    ">+ Add Layer</button>
                </div>

                <div class="layer-list" style="flex: 1; overflow-y: auto; overflow-x: hidden;">
                    ${layers.map(layer => this.renderLayerItem(layer)).join('')}
                </div>
            </div>
        `;

        this.setupLayerEventHandlers();

        // Restore scroll position
        requestAnimationFrame(() => {
            const newLayerList = this.$('.layer-list');
            if (newLayerList) {
                newLayerList.scrollTop = scrollTop;
            }
        });
    }

    /**
     * Render a single layer item in the list
     */
    renderLayerItem(layer) {
        const statusIcon = {
            'pending': '⏳',
            'computing': '⚙️',
            'complete': '✓',
            'error': '❌'
        }[layer.computeStatus];

        return `
            <div class="layer-item" data-layer-id="${layer.id}" style="
                padding: 8px;
                margin-bottom: 8px;
                background: ${layer.selected ? '#264f78' : '#2d2d2d'};
                border-left: 3px solid ${layer.color};
                border-radius: 3px;
                cursor: pointer;
            ">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 5px;">
                    <!-- Square whip source for contour binding -->
                    <div class="layer-whip-source"
                         data-layer-id="${layer.id}"
                         style="
                             width: 12px;
                             height: 12px;
                             background: ${layer.color};
                             border: 1px solid #fff;
                             cursor: move;
                         "
                         title="Drag to create contour binding">
                    </div>

                    <strong style="flex: 1; font-size: 12px;">${layer.name}</strong>

                    <span style="font-size: 10px;">${statusIcon}</span>

                    <button class="layer-visibility-btn"
                            data-layer-id="${layer.id}"
                            style="
                                padding: 2px 6px;
                                background: transparent;
                                color: ${layer.visible ? '#4ec9b0' : '#888'};
                                border: 1px solid ${layer.visible ? '#4ec9b0' : '#888'};
                                cursor: pointer;
                                font-size: 11px;
                                border-radius: 2px;
                            ">
                        ${layer.visible ? '👁' : '👁‍🗨'}
                    </button>

                    ${layer.type === 'transform' ? `
                        <button class="layer-edit-btn"
                                data-layer-id="${layer.id}"
                                style="
                                    padding: 2px 6px;
                                    background: #0e639c;
                                    color: white;
                                    border: none;
                                    cursor: pointer;
                                    font-size: 11px;
                                    border-radius: 2px;
                                ">
                            ⚙️
                        </button>
                        <button class="layer-delete-btn"
                                data-layer-id="${layer.id}"
                                style="
                                    padding: 2px 6px;
                                    background: #d16969;
                                    color: white;
                                    border: none;
                                    cursor: pointer;
                                    font-size: 11px;
                                    border-radius: 2px;
                                ">
                            🗑️
                        </button>
                    ` : ''}
                </div>

                <div style="font-size: 10px; color: #888;">
                    ${layer.type === 'data' ? 'Original data' : `${layer.transformType.toUpperCase()}`}
                    ${this.renderInputLayerNames(layer)}
                </div>

                ${this.renderLayerSlider(layer)}
            </div>
        `;
    }

    /**
     * Render parameter slider/selector for a layer (if it has a tunable parameter)
     */
    renderLayerSlider(layer) {
        if (layer.type === 'data') return '';

        // Special case: difference uses a dropdown selector instead of slider
        if (layer.transformType === 'difference') {
            return this.renderLayerSelector(layer);
        }

        let sliderConfig = null;

        // Define slider config for each transform type
        switch (layer.transformType) {
            case 'peak_detection':
                sliderConfig = {
                    param: 'threshold',
                    label: 'Threshold',
                    min: 0.0,
                    max: 1.0,
                    step: 0.05,
                    value: layer.transformParams.threshold || 0.7
                };
                break;
            case 'outlier_detection':
                sliderConfig = {
                    param: 'sensitivity',
                    label: 'Sensitivity',
                    min: 1.5,
                    max: 4.0,
                    step: 0.1,
                    value: layer.transformParams.sensitivity || 2.5
                };
                break;
            case 'fft_lowpass':
                sliderConfig = {
                    param: 'cutoffFrequency',
                    label: 'Cutoff',
                    min: 0.01,
                    max: 0.5,
                    step: 0.01,
                    value: layer.transformParams.cutoffFrequency || 0.1
                };
                break;
            case 'fft_highpass':
                sliderConfig = {
                    param: 'cutoffFrequency',
                    label: 'Cutoff',
                    min: 0.01,
                    max: 0.5,
                    step: 0.01,
                    value: layer.transformParams.cutoffFrequency || 0.1
                };
                break;
            case 'moving_average':
                sliderConfig = {
                    param: 'windowSize',
                    label: 'Window',
                    min: 2,
                    max: 100,
                    step: 1,
                    value: layer.transformParams.windowSize || 10
                };
                break;
            case 'windowed_average':
                sliderConfig = {
                    param: 'windowSize',
                    label: 'Window',
                    min: 10,
                    max: 500,
                    step: 10,
                    value: layer.transformParams.windowSize || 100
                };
                break;
            case 'percentile':
                sliderConfig = {
                    param: 'percentile',
                    label: 'Percentile',
                    min: 0,
                    max: 100,
                    step: 1,
                    value: layer.transformParams.percentile || 50
                };
                break;
            default:
                return ''; // No slider for this transform type
        }

        if (!sliderConfig) return '';

        return `
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #444;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
                    <label style="font-size: 10px; color: #aaa;">${sliderConfig.label}</label>
                    <span class="layer-param-value" style="font-size: 10px; color: #4ec9b0;">${sliderConfig.value}</span>
                </div>
                <input type="range"
                       class="layer-param-slider"
                       data-layer-id="${layer.id}"
                       data-param="${sliderConfig.param}"
                       min="${sliderConfig.min}"
                       max="${sliderConfig.max}"
                       step="${sliderConfig.step}"
                       value="${sliderConfig.value}"
                       style="width: 100%; cursor: pointer;">
            </div>
        `;
    }

    /**
     * Render parameter selector (dropdown) for layers with discrete options
     */
    renderLayerSelector(layer) {
        let selectorConfig = null;

        switch (layer.transformType) {
            case 'difference':
                selectorConfig = {
                    param: 'mode',
                    label: 'Mode',
                    options: [
                        { value: 'normal', label: 'Normal (A - B)' },
                        { value: 'inverted', label: 'Inverted (B - A)' },
                        { value: 'absolute', label: 'Absolute (|A - B|)' }
                    ],
                    value: layer.transformParams.mode || 'normal'
                };
                break;
            default:
                return '';
        }

        if (!selectorConfig) return '';

        return `
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #444;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
                    <label style="font-size: 10px; color: #aaa;">${selectorConfig.label}</label>
                </div>
                <select class="layer-param-selector"
                        data-layer-id="${layer.id}"
                        data-param="${selectorConfig.param}"
                        style="width: 100%; padding: 4px; background: #3c3c3c; color: #d4d4d4; border: 1px solid #555; cursor: pointer;">
                    ${selectorConfig.options.map(opt => `
                        <option value="${opt.value}" ${opt.value === selectorConfig.value ? 'selected' : ''}>
                            ${opt.label}
                        </option>
                    `).join('')}
                </select>
            </div>
        `;
    }

    /**
     * Render input layer names for a layer
     */
    renderInputLayerNames(layer) {
        if (!layer.inputLayerIds || layer.inputLayerIds.length === 0) {
            return '';
        }

        const inputNames = layer.inputLayerIds.map(inputId => {
            const inputLayer = layerManager.getLayer(inputId);
            return inputLayer ? inputLayer.name : 'Unknown';
        });

        if (inputNames.length === 1) {
            return ` ← ${inputNames[0]}`;
        } else {
            return ` ← [${inputNames.join(', ')}]`;
        }
    }

    /**
     * Setup event handlers for layer controls
     */
    setupLayerEventHandlers() {
        // Add layer button
        const addBtn = this.$('#add-layer-btn');
        if (addBtn) {
            addBtn.onclick = () => this.showAddLayerDialog();
        }

        // Layer item clicks (selection)
        this.root.querySelectorAll('.layer-item').forEach(item => {
            item.onclick = (e) => {
                if (e.target.classList.contains('layer-visibility-btn') ||
                    e.target.classList.contains('layer-edit-btn') ||
                    e.target.classList.contains('layer-delete-btn') ||
                    e.target.classList.contains('layer-whip-source') ||
                    e.target.classList.contains('layer-param-slider') ||
                    e.target.classList.contains('layer-param-selector') ||
                    e.target.tagName === 'SELECT') {
                    return;  // Don't select on button/control clicks
                }

                const layerId = item.dataset.layerId;
                this.selectLayer(layerId);
            };

            // Right-click to change color
            item.oncontextmenu = (e) => {
                e.preventDefault();
                const layerId = item.dataset.layerId;
                this.showColorPicker(layerId);
            };
        });

        // Visibility toggles
        this.root.querySelectorAll('.layer-visibility-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const layerId = btn.dataset.layerId;
                const layer = layerManager.getLayer(layerId);
                const oldVisible = layer.visible;
                layer.visible = !layer.visible;

                console.log(`XY Plot: Toggled layer "${layer.name}" visibility: ${oldVisible} → ${layer.visible}`);

                // Batch all DOM updates in requestAnimationFrame
                requestAnimationFrame(() => {
                    // Update button text/appearance directly (no full re-render)
                    btn.textContent = layer.visible ? '👁' : '👁‍🗨';
                    btn.style.color = layer.visible ? '#4ec9b0' : '#888';
                    btn.style.borderColor = layer.visible ? '#4ec9b0' : '#888';

                    // If it's the base data layer, just re-render circles (don't rebuild entire graph)
                    if (layer.type === 'data') {
                        this.renderDataCircles();
                    } else {
                        this.renderLayers();
                    }
                });
            };
        });

        // Edit buttons
        this.root.querySelectorAll('.layer-edit-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const layerId = btn.dataset.layerId;
                this.showEditLayerDialog(layerId);
            };
        });

        // Delete buttons
        this.root.querySelectorAll('.layer-delete-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const layerId = btn.dataset.layerId;
                const layer = layerManager.getLayer(layerId);

                if (confirm(`Delete layer "${layer.name}"?`)) {
                    layerManager.removeLayer(layerId);
                    this.renderLayers();
                    this.renderLayerControls();
                }
            };
        });

        // Parameter sliders
        this.root.querySelectorAll('.layer-param-slider').forEach(slider => {
            const layerId = slider.dataset.layerId;
            const paramName = slider.dataset.param;

            // Update display value on input
            slider.oninput = (e) => {
                e.stopPropagation();
                const valueDisplay = slider.previousElementSibling?.querySelector('.layer-param-value');
                if (valueDisplay) {
                    valueDisplay.textContent = e.target.value;
                }
            };

            // Recompute layer on change (when user releases slider)
            slider.onchange = async (e) => {
                e.stopPropagation();
                const layer = layerManager.getLayer(layerId);
                if (!layer) return;

                // Update parameter
                const newValue = parseFloat(e.target.value);
                layer.transformParams[paramName] = newValue;

                // Mark as computing and update status icon directly
                layer.computeStatus = 'computing';

                requestAnimationFrame(() => {
                    const layerItem = this.root.querySelector(`.layer-item[data-layer-id="${layerId}"]`);
                    if (layerItem) {
                        const statusSpan = layerItem.querySelector('span[style*="font-size: 10px"]');
                        if (statusSpan) {
                            statusSpan.textContent = '⚙️';
                        }
                    }
                });

                // Recompute layer
                await layerManager.computeLayer(layerId);

                // Save updated parameters
                layerManager.saveLayers(this.getVisualizerId());

                // Update status icon and re-render layers
                requestAnimationFrame(() => {
                    const layerItem = this.root.querySelector(`.layer-item[data-layer-id="${layerId}"]`);
                    if (layerItem) {
                        const statusSpan = layerItem.querySelector('span[style*="font-size: 10px"]');
                        if (statusSpan) {
                            statusSpan.textContent = layer.computeStatus === 'complete' ? '✓' : '❌';
                        }
                    }

                    // Re-render just the layers (not the controls sidebar)
                    this.renderLayers();
                });

                console.log(`Layer ${layer.name}: Updated ${paramName} to ${newValue}, re-rendered`);
            };
        });

        // Parameter selectors (dropdowns)
        this.root.querySelectorAll('.layer-param-selector').forEach(selector => {
            const layerId = selector.dataset.layerId;
            const paramName = selector.dataset.param;

            // Recompute layer on change
            selector.onchange = async (e) => {
                e.stopPropagation();
                const layer = layerManager.getLayer(layerId);
                if (!layer) return;

                // Update parameter
                const newValue = e.target.value;
                layer.transformParams[paramName] = newValue;

                // Mark as computing
                layer.computeStatus = 'computing';

                requestAnimationFrame(() => {
                    const layerItem = this.root.querySelector(`.layer-item[data-layer-id="${layerId}"]`);
                    if (layerItem) {
                        const statusSpan = layerItem.querySelector('span[style*="font-size: 10px"]');
                        if (statusSpan) {
                            statusSpan.textContent = '⚙️';
                        }
                    }
                });

                // Recompute layer
                await layerManager.computeLayer(layerId);

                // Save updated parameters
                layerManager.saveLayers(this.getVisualizerId());

                // Update status icon and re-render layers
                requestAnimationFrame(() => {
                    const layerItem = this.root.querySelector(`.layer-item[data-layer-id="${layerId}"]`);
                    if (layerItem) {
                        const statusSpan = layerItem.querySelector('span[style*="font-size: 10px"]');
                        if (statusSpan) {
                            statusSpan.textContent = layer.computeStatus === 'complete' ? '✓' : '❌';
                        }
                    }

                    // Re-render just the layers (not the controls sidebar)
                    this.renderLayers();
                });

                console.log(`Layer ${layer.name}: Updated ${paramName} to ${newValue}, re-rendered`);
            };
        });

        // Square whip sources (drag to create contour bindings)
        this.root.querySelectorAll('.layer-whip-source').forEach(source => {
            source.onmousedown = (e) => {
                e.stopPropagation();
                const layerId = source.dataset.layerId;
                const layer = layerManager.getLayer(layerId);

                // Import contourDragHandler dynamically
                import('../../lib/contour_drag_handler.js').then(({ contourDragHandler }) => {
                    // Start contour binding drag
                    contourDragHandler.startDrag(e, {
                        sourceType: 'layer',
                        sourceId: layerId,
                        visualizerId: this.getVisualizerId(),
                        color: layer.color
                    });
                });
            };
        });
    }

    /**
     * Show dialog to add a new layer
     */
    showAddLayerDialog() {
        const transformType = prompt('Transform type:\n\nFeature Detection:\n- peak_detection (local maxima)\n- outlier_detection (wavelet anomalies)\n- intersections (crossing points, requires 2 layers)\n\nFrequency Filters (FFT):\n- fft_lowpass (smooth melodic trends)\n- fft_highpass (rhythmic accents)\n- fft_bandpass (isolate frequency range)\n- fft_dominant (main periodic component)\n\nAveraging:\n- moving_average (sliding window)\n- windowed_average (non-overlapping blocks)\n- static_average (mean line)\n\nOther:\n- percentile (percentile line)\n- min_max (min or max line)\n- difference (A - B, requires 2 layers)');
        if (!transformType) return;

        const name = prompt('Layer name:');
        if (!name) return;

        const layers = layerManager.getLayersForVisualizer(this.getVisualizerId());

        if (layers.length === 0) {
            alert('No layers available to use as input');
            return;
        }

        let inputLayerIds;

        // Multi-input transforms require 2 input layers
        if (transformType === 'difference' || transformType === 'intersections') {
            // Show layer selection dialog
            const layerOptions = layers.map((l, i) => `${i}: ${l.name} (${l.type === 'data' ? 'data' : l.transformType})`).join('\n');
            const layerAIndex = parseInt(prompt(`Select first layer (A):\n${layerOptions}`));
            if (isNaN(layerAIndex) || layerAIndex < 0 || layerAIndex >= layers.length) {
                alert('Invalid layer selection');
                return;
            }

            const promptText = transformType === 'difference'
                ? `Select second layer (B):\n${layerOptions}\n\nResult will be A - B`
                : `Select second layer (B):\n${layerOptions}\n\nWill find where A crosses B`;

            const layerBIndex = parseInt(prompt(promptText));
            if (isNaN(layerBIndex) || layerBIndex < 0 || layerBIndex >= layers.length) {
                alert('Invalid layer selection');
                return;
            }

            inputLayerIds = [layers[layerAIndex].id, layers[layerBIndex].id];
        } else {
            // Single-input transforms - let user choose input layer
            const layerOptions = layers.map((l, i) => `${i}: ${l.name} (${l.type === 'data' ? 'data' : l.transformType})`).join('\n');
            const inputIndex = parseInt(prompt(`Select input layer:\n${layerOptions}`));

            if (isNaN(inputIndex) || inputIndex < 0 || inputIndex >= layers.length) {
                alert('Invalid layer selection');
                return;
            }

            inputLayerIds = [layers[inputIndex].id];
        }

        // Get parameters for this transform type
        const params = this.promptForTransformParams(transformType);
        if (params === null) return; // User cancelled

        layerManager.addLayer(this.getVisualizerId(), {
            name,
            type: 'transform',
            transformType,
            transformParams: params,
            inputLayerIds
        });

        // Re-render after layer is added (ensure computation completes)
        setTimeout(() => {
            requestAnimationFrame(() => {
                this.renderLayers();
                this.renderLayerControls();
            });
        }, 100);
    }

    /**
     * Show dialog to edit layer parameters
     */
    showEditLayerDialog(layerId) {
        const layer = layerManager.getLayer(layerId);
        if (!layer) return;

        alert(`Edit layer "${layer.name}"\n\nParameter editing UI coming soon...`);
    }

    /**
     * Show color picker for a layer
     */
    showColorPicker(layerId) {
        const layer = layerManager.getLayer(layerId);
        if (!layer) return;

        // Create hidden color input
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = layer.color;
        colorInput.style.position = 'absolute';
        colorInput.style.opacity = '0';
        colorInput.style.pointerEvents = 'none';
        document.body.appendChild(colorInput);

        // Handle color change
        colorInput.onchange = (e) => {
            layer.color = e.target.value;

            // Save layer state
            layerManager.saveLayers(this.getVisualizerId());

            // Re-render
            this.renderLayers();
            this.renderLayerControls();

            // Cleanup
            document.body.removeChild(colorInput);
        };

        // Handle cancel (color picker closed without selection)
        colorInput.onblur = () => {
            setTimeout(() => {
                if (document.body.contains(colorInput)) {
                    document.body.removeChild(colorInput);
                }
            }, 100);
        };

        // Open color picker
        colorInput.click();
    }

    /**
     * Prompt user for transform-specific parameters
     */
    promptForTransformParams(transformType) {
        const params = {};

        switch (transformType) {
            case 'peak_detection':
                const peakThreshold = prompt('Peak detection threshold (0.0 - 1.0):', '0.7');
                if (peakThreshold === null) return null;
                params.threshold = parseFloat(peakThreshold) || 0.7;
                break;

            case 'outlier_detection':
                const sensitivity = prompt('Sensitivity (lower = more sensitive)\n2.0 = high, 2.5 = moderate, 3.0 = low:', '2.5');
                if (sensitivity === null) return null;
                params.sensitivity = parseFloat(sensitivity) || 2.5;
                params.minDistance = 1;
                break;

            case 'moving_average':
                const movingWindowSize = prompt('Window size (number of samples):', '10');
                if (movingWindowSize === null) return null;
                params.windowSize = parseInt(movingWindowSize) || 10;
                break;

            case 'windowed_average':
                const windowedSize = prompt('Window size (number of samples per window):', '100');
                if (windowedSize === null) return null;
                params.windowSize = parseInt(windowedSize) || 100;
                break;

            case 'fft_lowpass':
                const lpCutoff = prompt('Cutoff frequency (0.0 - 0.5, lower = smoother):', '0.1');
                if (lpCutoff === null) return null;
                params.cutoffFrequency = parseFloat(lpCutoff) || 0.1;
                break;

            case 'fft_highpass':
                const hpCutoff = prompt('Cutoff frequency (0.0 - 0.5, higher = more detail removed):', '0.1');
                if (hpCutoff === null) return null;
                params.cutoffFrequency = parseFloat(hpCutoff) || 0.1;
                break;

            case 'fft_bandpass':
                const lowCutoff = prompt('Low cutoff frequency (0.0 - 0.5):', '0.05');
                if (lowCutoff === null) return null;
                const highCutoff = prompt('High cutoff frequency (0.0 - 0.5):', '0.2');
                if (highCutoff === null) return null;
                params.lowCutoff = parseFloat(lowCutoff) || 0.05;
                params.highCutoff = parseFloat(highCutoff) || 0.2;
                break;

            case 'fft_dominant':
                const minFreq = prompt('Min frequency (0.0 - 0.5):', '0.01');
                if (minFreq === null) return null;
                const maxFreq = prompt('Max frequency (0.0 - 0.5):', '0.5');
                if (maxFreq === null) return null;
                params.minFrequency = parseFloat(minFreq) || 0.01;
                params.maxFrequency = parseFloat(maxFreq) || 0.5;
                break;

            case 'percentile':
                const percentile = prompt('Percentile (0 - 100):', '50');
                if (percentile === null) return null;
                params.percentile = parseFloat(percentile) || 50;
                // Clamp to 0-100
                params.percentile = Math.max(0, Math.min(100, params.percentile));
                break;

            case 'min_max':
                const type = prompt('Type (min or max):', 'max');
                if (type === null) return null;
                params.type = type === 'min' ? 'min' : 'max';
                break;

            case 'static_average':
            case 'difference':
            case 'fft':
            default:
                // No parameters needed
                break;
        }

        return params;
    }

    /**
     * Get default parameters for transform types (for backwards compatibility)
     */
    getDefaultParams(transformType) {
        switch (transformType) {
            case 'peak_detection':
                return { threshold: 0.7 };
            case 'outlier_detection':
                return { sensitivity: 2.5, minDistance: 1 };
            case 'fft_lowpass':
                return { cutoffFrequency: 0.1 };
            case 'fft_highpass':
                return { cutoffFrequency: 0.1 };
            case 'fft_bandpass':
                return { lowCutoff: 0.05, highCutoff: 0.2 };
            case 'fft_dominant':
                return { minFrequency: 0.01, maxFrequency: 0.5 };
            case 'moving_average':
                return { windowSize: 10 };
            case 'windowed_average':
                return { windowSize: 100 };
            case 'static_average':
                return {};
            case 'percentile':
                return { percentile: 50 };
            case 'min_max':
                return { type: 'max' };
            case 'difference':
                return { mode: 'normal' }; // Default to normal (A - B)
            case 'intersections':
                return { interpolate: true, tolerance: 0.0 };
            default:
                return {};
        }
    }
}

// Register custom element
customElements.define('sonofire-xy-plot', SonofireXYPlot);
