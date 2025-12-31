import 'https://unpkg.com/d3@7.9.0';
import { SonofireVisualizerBase } from '../base/sonofire_visualizer_base.js';
import { MIDI_NOTES_FLAT, MIDI_NOTES_SHARP } from '../../lib/midi_data.js';
import { WhipDragHandler } from '../../lib/whip_drag_handler.js';

/**
 * XY Plot Visualizer - Refactored from pitch_generator.js
 * Displays time-series data as scatter plot with musical playback
 */
export class SonofireXYPlot extends SonofireVisualizerBase {
    constructor() {
        super();
    }

    /**
     * Render the component
     */
    async render() {
        // Create container
        this.innerHTML = `
            <div id="sonofire-xy-controls" style="background: #2d2d2d; padding: 15px; margin: 10px 0; border-left: 3px solid #4ec9b0;">
                <div style="margin-bottom: 10px;">
                    <strong style="color: #4ec9b0;">📊 XY Plot</strong>
                    <span style="margin-left: 15px; color: #888;">
                        Status: ${this.isPlaying ? '▶ Playing' : '⏸ Stopped'}
                    </span>
                    <span style="margin-left: 15px; color: #888; font-size: 0.9em;">
                        (Use Conductor transport controls to play/stop/rewind)
                    </span>
                </div>
            </div>
            <div id="my_dataviz"></div>
        `;

        // Render graph
        await this.renderGraph();
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

        svg.append('g')
            .attr('transform', `translate(0,${this.height})`)
            .call(d3.axisBottom(x));

        // Add Y axis
        const y = d3.scaleLinear()
            .domain([50, 250])
            .range([this.height, 0]);

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
     * Override: Advance a specific playhead's position
     * @param {Playhead} playhead
     */
    advancePlayheadPosition(playhead) {
        // Advance X position by 1 pixel
        playhead.setPosition(playhead.position + 1);

        // Loop back to start if reached end
        if (playhead.position > this.width) {
            playhead.setPosition(0);
        }
    }

    /**
     * Override: Sample data at playhead's current position
     * @param {Playhead} playhead
     */
    sampleDataAtPlayhead(playhead) {
        if (!this.data || this.data.length === 0) return;

        const xPos = Math.floor(playhead.position);

        // Find data points at this X position
        const svg = d3.select(this.$('#my_dataviz svg'));
        if (!svg.node()) return;

        const parent = svg.select('g');
        let yValueSum = 0;
        let yValueCount = 0;

        // Sample Y values from circles at this X position and animate them
        parent.selectAll(`.x-${xPos}`).each(function() {
            const circle = d3.select(this);
            const cy = parseFloat(circle.attr('cy'));
            if (!isNaN(cy)) {
                yValueSum += cy;
                yValueCount++;

                // Animate the sampled datapoint with playhead color
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

        if (yValueCount > 0) {
            // Average Y position in SVG coordinates
            const avgY = yValueSum / yValueCount;

            // Normalize to 0-1 (invert because SVG Y increases downward)
            const normalizedValue = 1.0 - (avgY / this.height);

            // Call playhead's sample method
            playhead.sampleValue(avgY, normalizedValue);
        }
    }

    /**
     * Override: Called after playheads advance
     */
    onPlayheadsAdvanced() {
        this.renderPlayheads();
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

            // Render playhead line
            parent.append('line')
                .attr('class', 'multi-playhead')
                .attr('data-playhead-id', playhead.id)
                .style('stroke', playhead.color)
                .style('stroke-width', 2)
                .style('opacity', 0.7)
                .attr('x1', playhead.position)
                .attr('y1', 0)
                .attr('x2', playhead.position)
                .attr('y2', this.height);

            // Render source light (draggable circle at top of playhead)
            const sourceLight = parent.append('circle')
                .attr('class', 'playhead-source-light')
                .attr('data-playhead-id', playhead.id)
                .attr('data-visualizer-id', this.getVisualizerId())
                .attr('cx', playhead.position)
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

        svg.append('g')
            .attr('transform', `translate(0,${this.height})`)
            .call(d3.axisBottom(x));

        // Add Y axis
        const y = d3.scaleLinear()
            .domain([50, 250])
            .range([this.height, 0]);

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
    }
}

// Register custom element
customElements.define('sonofire-xy-plot', SonofireXYPlot);
