import 'https://unpkg.com/d3@7.9.0';
import { SonofireVisualizerBase } from '../base/sonofire_visualizer_base.js';
import { MIDI_NOTES_FLAT, MIDI_NOTES_SHARP } from '../../lib/midi_data.js';
import { WhipDragHandler } from '../../lib/whip_drag_handler.js';
import { PLAYHEAD_SIDEBAR_WIDTH } from '../../lib/mixins/playheads.js';

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
    }

    /**
     * Render the component
     */
    async render() {
        // Detect container dimensions before rendering
        this.detectContainerDimensions();

        // Create container
        this.innerHTML = `
            <div id="my_dataviz"></div>
        `;

        // Render graph
        await this.renderGraph();
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
            // Subtract playhead sidebar width (imported from PlayheadsMixin)
            this.width = parentWidth - PLAYHEAD_SIDEBAR_WIDTH - 20; // Leave some margin
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
     * Load data from CSV
     */
    async loadData() {
        return await d3.csv(this.dataUrl);
    }

    /**
     * Render the D3 graph
     */
    async renderGraph() {
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

        // Add X axis (time)
        const x = d3.scaleTime()
            .domain([
                new Date('1956-01-01T00:00:00Z'),
                new Date('1995-09-01T00:00:00Z')
            ])
            .range([0, this.width]);

        // Store scales for data sampling
        this.xScale = x;
        this.xDomain = x.domain();

        svg.append('g')
            .attr('transform', `translate(0,${this.height})`)
            .call(d3.axisBottom(x));

        // Add Y axis
        const y = d3.scaleLinear()
            .domain([50, 250])
            .range([this.height, 0]);

        this.yScale = y;

        svg.append('g')
            .call(d3.axisLeft(y));

        // Draw note boundary rectangles
        for (let i = 0; i < partitions.length; i++) {
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
        }

        // Load and plot data
        const data = await this.loadData();
        this.data = data;

        const getX = (d) => new Date(d[this.xColumn]);
        const getY = (d) => d[this.yColumn];

        // Store data accessors for sampling
        this.getX = getX;
        this.getY = getY;

        // Clear recently sampled tracking when data reloads
        this.recentlySampledIndices.clear();

        // Plot data points
        svg.append('g')
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


    /**
     * Override: Advance a specific playhead's position (percentage-based)
     * Position advances as a constant percentage per tick, independent of pixel width.
     * This ensures consistent playback speed regardless of visualization size.
     * @param {Playhead} playhead
     */
    advancePlayheadPosition(playhead) {
        // Calculate percentage increment based on fixed sweep time
        // At 1x speed, playhead takes TICKS_PER_FULL_SWEEP ticks to traverse 0-1
        const increment = 1.0 / SonofireXYPlot.TICKS_PER_FULL_SWEEP;

        // Advance position as percentage (0-1)
        playhead.setPosition(playhead.position + increment);

        // Loop back to start if reached end
        if (playhead.position >= 1.0) {
            playhead.setPosition(playhead.position - 1.0);
        }
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

        // Initialize tracking set for this playhead if needed
        if (!this.recentlySampledIndices.has(playhead.id)) {
            this.recentlySampledIndices.set(playhead.id, new Set());
        }
        const recentlySampled = this.recentlySampledIndices.get(playhead.id);

        // Convert playhead percentage (0-1) to data domain value
        const [minDate, maxDate] = this.xDomain;
        const dateDomain = maxDate - minDate;
        const targetDate = new Date(minDate.getTime() + (playhead.position * dateDomain));

        // Use wider window for reliable data catching, but track indices to prevent re-sampling
        const sampleWindow = 0.005; // ±0.5% of domain - wide enough to reliably catch data
        const windowStart = new Date(minDate.getTime() + ((playhead.position - sampleWindow) * dateDomain));
        const windowEnd = new Date(minDate.getTime() + ((playhead.position + sampleWindow) * dateDomain));

        // Find data points within window that haven't been sampled recently
        let yValueSum = 0;
        let yValueCount = 0;
        const sampledIndices = [];
        const newlySampledIndices = [];

        this.data.forEach((d, index) => {
            const dataDate = this.getX(d);
            if (dataDate >= windowStart && dataDate <= windowEnd) {
                sampledIndices.push(index);

                // Only sample if not recently sampled
                if (!recentlySampled.has(index)) {
                    const yValue = this.getY(d);
                    yValueSum += yValue;
                    yValueCount++;
                    newlySampledIndices.push(index);
                    recentlySampled.add(index);
                }
            }
        });

        // Clear indices that are now behind the playhead (outside the window)
        const clearThreshold = playhead.position - (sampleWindow * 2);
        this.data.forEach((d, index) => {
            const dataDate = this.getX(d);
            const dataPosition = (dataDate - minDate) / dateDomain;
            if (dataPosition < clearThreshold) {
                recentlySampled.delete(index);
            }
        });

        // Animate only newly sampled data points (not re-sampled ones)
        if (newlySampledIndices.length > 0) {
            const svg = d3.select(this.$('#my_dataviz svg'));
            if (svg.node()) {
                const parent = svg.select('g');
                parent.selectAll('circle')
                    .each(function(d, i) {
                        if (newlySampledIndices.includes(i)) {
                            const circle = d3.select(this);
                            circle
                                .transition()
                                .duration(100)
                                .attr('r', 6)
                                .style('fill', playhead.color)
                                .style('opacity', 1)
                                .transition()
                                .duration(200)
                                .attr('r', 1.5)
                                .style('fill', '#69b3a2')
                                .style('opacity', 0.8);
                        }
                    });
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

        console.log(`XY Plot: Found ${upcomingPoints.length} data points in lookahead window (${currentPos.toFixed(0)} to ${endPos.toFixed(0)})`);

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
     * Setup subscriptions including chord change for lookahead
     */
    setupSubscriptions() {
        super.setupSubscriptions();

        // Subscribe to chord changes to publish lookahead data
        this.subscribe('music:chord', (chordData) => {
            this.handleChordChangeForLookahead(chordData);
        });
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

                console.log(`XY Plot: Published lookahead for playhead ${playhead.id}:`, {
                    eventCount: lookaheadData.length,
                    trend: trend.direction,
                    slope: trend.slope.toFixed(3),
                    topics: index === 0 ? ['data:lookahead', topic] : [topic]
                });
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
        parent.selectAll('.playhead-source-light').remove();

        // Render each playhead
        this.playheads.forEach((playhead, index) => {
            if (!playhead.enabled) return;

            // Convert percentage position (0-1) to pixel position
            const xPosition = playhead.position * this.width;

            // Render playhead line
            parent.append('line')
                .attr('class', 'multi-playhead')
                .attr('data-playhead-id', playhead.id)
                .style('stroke', playhead.color)
                .style('stroke-width', 2)
                .style('opacity', 0.7)
                .attr('x1', xPosition)
                .attr('y1', 0)
                .attr('x2', xPosition)
                .attr('y2', this.height);

            // Render source light (draggable circle at top of playhead)
            const sourceLight = parent.append('circle')
                .attr('class', 'playhead-source-light')
                .attr('data-playhead-id', playhead.id)
                .attr('data-visualizer-id', this.getVisualizerId())
                .attr('cx', xPosition)
                .attr('cy', 10)  // Near the top of the plot area
                .attr('r', 8)
                .style('fill', playhead.color)
                .style('stroke', '#ffffff')
                .style('stroke-width', 2)
                .style('cursor', 'grab')
                .style('opacity', 0.9);

            // Add tooltip to source light
            sourceLight.append('title')
                .text(`Playhead ${index + 1}\nSpeed: ${playhead.getSpeedLabel()}\nDrag to create whip binding`);

            // Attach drag handler
            sourceLight.on('mousedown', (event) => {
                WhipDragHandler.startDrag(event, {
                    visualizerId: this.getVisualizerId(),
                    playheadId: playhead.id,
                    playhead: playhead,
                    color: playhead.color,
                });
            });
        });
    }

    /**
     * Override renderGraph to include playhead rendering
     */
    async renderGraph() {
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

        // Add X axis (time)
        const x = d3.scaleTime()
            .domain([
                new Date('1956-01-01T00:00:00Z'),
                new Date('1995-09-01T00:00:00Z')
            ])
            .range([0, this.width]);

        // Store scales for data sampling
        this.xScale = x;
        this.xDomain = x.domain();

        svg.append('g')
            .attr('transform', `translate(0,${this.height})`)
            .call(d3.axisBottom(x));

        // Add Y axis
        const y = d3.scaleLinear()
            .domain([50, 250])
            .range([this.height, 0]);

        this.yScale = y;

        svg.append('g')
            .call(d3.axisLeft(y));

        // Draw note boundary rectangles
        for (let i = 0; i < partitions.length; i++) {
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
        }

        // Load and plot data
        const data = await this.loadData();
        this.data = data;

        const getX = (d) => new Date(d[this.xColumn]);
        const getY = (d) => d[this.yColumn];

        // Store data accessors for sampling
        this.getX = getX;
        this.getY = getY;

        // Clear recently sampled tracking when data reloads
        this.recentlySampledIndices.clear();

        // Plot data points
        svg.append('g')
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

        // Render playheads after data is loaded
        this.renderPlayheads();

        // Add resize handle (inherited from base class)
        this.addResizeHandle();

        // Set initial parent container size
        this.updateParentContainerSize();
    }
}

// Register custom element
customElements.define('sonofire-xy-plot', SonofireXYPlot);
