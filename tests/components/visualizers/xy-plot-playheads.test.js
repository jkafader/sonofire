import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../../components/visualizers/xy_plot.js';
import { PubSub } from '../../../lib/pubsub.js';

describe('XY Plot - Playhead Rendering', () => {
    let xyPlot;
    let container;

    beforeEach(async () => {
        // Clear PubSub state completely (including lastEvents for persistence)
        PubSub.clearAllCallbacks();

        // Clear any persisted playhead state from localStorage
        const visualizerId = 'test-xy-plot';
        PubSub.publish(`visualizer:${visualizerId}:playheads`, {
            visualizerId,
            playheads: []
        });

        // Create container element
        container = document.createElement('div');
        document.body.appendChild(container);

        // Create XY plot element
        xyPlot = document.createElement('sonofire-xy-plot');
        xyPlot.id = 'test-xy-plot';
        xyPlot.setAttribute('width', '720');
        xyPlot.setAttribute('height', '300');
        container.appendChild(xyPlot);

        // Wait for component to initialize
        await new Promise(resolve => setTimeout(resolve, 100));

        // Ensure playheads array is empty (override any restored playheads)
        xyPlot.playheads = [];

        // Mock loadData to return test data with proper date format
        // Data spread across the domain (1956-1995) with many points for reliable sampling
        // Using fixed values so data is consistent across multiple renders
        xyPlot.loadData = async () => {
            const data = [];
            for (let year = 1956; year <= 1995; year++) {
                data.push({
                    date: `${year}-01-01T00:00:00Z`,
                    production: 100 + ((year - 1956) * 3.75)  // Linear progression from 100 to 246
                });
            }
            return data;
        };

        // Trigger initial render
        await xyPlot.renderGraph();
    });

    afterEach(() => {
        // Clean up
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
    });

    describe('Playhead Visual Rendering', () => {
        it('should render playhead line when playhead is added', () => {
            // Add a playhead at 50% position (percentage-based: 0-1)
            const playhead = xyPlot.addPlayhead({ speed: 1, position: 0.5, enabled: true });

            // Query for playhead line in SVG
            const svg = xyPlot.querySelector('#my_dataviz svg');
            expect(svg).toBeTruthy();

            const playheadLine = svg.querySelector(`.multi-playhead[data-playhead-id="${playhead.id}"]`);
            expect(playheadLine).toBeTruthy();

            // Position should be converted to pixels: 0.5 * 720 = 360
            const expectedX = (0.5 * xyPlot.width).toString();
            expect(playheadLine.getAttribute('x1')).toBe(expectedX);
            expect(playheadLine.getAttribute('x2')).toBe(expectedX);
        });

        it('should render source light (draggable circle) when playhead is added', () => {
            // Add a playhead at 25% position
            const playhead = xyPlot.addPlayhead({ speed: 1, position: 0.25, color: '#ff0000', enabled: true });

            // Query for source light circle in SVG
            const svg = xyPlot.querySelector('#my_dataviz svg');
            const sourceLight = svg.querySelector(`.playhead-source-light[data-playhead-id="${playhead.id}"]`);

            expect(sourceLight).toBeTruthy();

            // Position should be converted to pixels: 0.25 * 720 = 180
            const expectedCx = (0.25 * xyPlot.width).toString();
            expect(sourceLight.getAttribute('cx')).toBe(expectedCx);
            expect(sourceLight.style.fill).toBe('rgb(255, 0, 0)'); // #ff0000
        });

        it('should render multiple playheads', () => {
            // Add multiple playheads at different percentage positions
            const ph1 = xyPlot.addPlayhead({ speed: 1, position: 0.1, enabled: true });
            const ph2 = xyPlot.addPlayhead({ speed: 2, position: 0.5, enabled: true });
            const ph3 = xyPlot.addPlayhead({ speed: 4, position: 0.9, enabled: true });

            // Query for all playhead lines
            const svg = xyPlot.querySelector('#my_dataviz svg');
            const playheadLines = svg.querySelectorAll('.multi-playhead');

            expect(playheadLines.length).toBe(3);
        });

        it('should remove playhead line when playhead is removed', () => {
            // Add a playhead
            const playhead = xyPlot.addPlayhead({ speed: 1, position: 0.5, enabled: true });

            // Verify it's rendered
            let svg = xyPlot.querySelector('#my_dataviz svg');
            let playheadLine = svg.querySelector(`.multi-playhead[data-playhead-id="${playhead.id}"]`);
            expect(playheadLine).toBeTruthy();

            // Remove the playhead
            xyPlot.removePlayhead(playhead.id);

            // Verify it's no longer rendered
            svg = xyPlot.querySelector('#my_dataviz svg');
            playheadLine = svg.querySelector(`.multi-playhead[data-playhead-id="${playhead.id}"]`);
            expect(playheadLine).toBeFalsy();
        });

        it('should remove source light when playhead is removed', () => {
            // Add a playhead
            const playhead = xyPlot.addPlayhead({ speed: 1, position: 0.5, enabled: true });

            // Verify source light is rendered
            let svg = xyPlot.querySelector('#my_dataviz svg');
            let sourceLight = svg.querySelector(`.playhead-source-light[data-playhead-id="${playhead.id}"]`);
            expect(sourceLight).toBeTruthy();

            // Remove the playhead
            xyPlot.removePlayhead(playhead.id);

            // Verify source light is no longer rendered
            svg = xyPlot.querySelector('#my_dataviz svg');
            sourceLight = svg.querySelector(`.playhead-source-light[data-playhead-id="${playhead.id}"]`);
            expect(sourceLight).toBeFalsy();
        });

        it('should not render disabled playheads', () => {
            // Add a disabled playhead
            const playhead = xyPlot.addPlayhead({ speed: 1, position: 0.5, enabled: false });

            // Query for playhead line
            const svg = xyPlot.querySelector('#my_dataviz svg');
            const playheadLine = svg.querySelector(`.multi-playhead[data-playhead-id="${playhead.id}"]`);

            expect(playheadLine).toBeFalsy();
        });

        it('should update playhead visual when toggled on', () => {
            // Add a disabled playhead
            const playhead = xyPlot.addPlayhead({ speed: 1, position: 0.5, enabled: false });

            // Verify not rendered
            let svg = xyPlot.querySelector('#my_dataviz svg');
            let playheadLine = svg.querySelector(`.multi-playhead[data-playhead-id="${playhead.id}"]`);
            expect(playheadLine).toBeFalsy();

            // Enable the playhead
            playhead.setEnabled(true);
            xyPlot.renderPlayheads(); // Trigger re-render

            // Verify now rendered
            svg = xyPlot.querySelector('#my_dataviz svg');
            playheadLine = svg.querySelector(`.multi-playhead[data-playhead-id="${playhead.id}"]`);
            expect(playheadLine).toBeTruthy();
        });

        it('should update playhead visual when toggled off', () => {
            // Add an enabled playhead
            const playhead = xyPlot.addPlayhead({ speed: 1, position: 0.5, enabled: true });

            // Verify rendered
            let svg = xyPlot.querySelector('#my_dataviz svg');
            let playheadLine = svg.querySelector(`.multi-playhead[data-playhead-id="${playhead.id}"]`);
            expect(playheadLine).toBeTruthy();

            // Disable the playhead
            playhead.setEnabled(false);
            xyPlot.renderPlayheads(); // Trigger re-render

            // Verify no longer rendered
            svg = xyPlot.querySelector('#my_dataviz svg');
            playheadLine = svg.querySelector(`.multi-playhead[data-playhead-id="${playhead.id}"]`);
            expect(playheadLine).toBeFalsy();
        });

        it('should update playhead color when changed', () => {
            // Add a playhead
            const playhead = xyPlot.addPlayhead({ speed: 1, position: 0.5, color: '#ff0000', enabled: true });

            // Change the color
            playhead.color = '#00ff00';
            xyPlot.renderPlayheads(); // Trigger re-render

            // Verify color updated
            const svg = xyPlot.querySelector('#my_dataviz svg');
            const playheadLine = svg.querySelector(`.multi-playhead[data-playhead-id="${playhead.id}"]`);
            expect(playheadLine.style.stroke).toBe('rgb(0, 255, 0)'); // #00ff00
        });
    });

    describe('Playhead UI Controls Integration', () => {
        it('should render UI controls when playhead is added', () => {
            const playhead = xyPlot.addPlayhead({ speed: 1, enabled: true });

            // Check that UI controls sidebar exists
            const controlsContainer = xyPlot.querySelector('.playhead-controls');
            expect(controlsContainer).toBeTruthy();

            // Check that playhead item is in the list
            const playheadItem = controlsContainer.querySelector(`.playhead-item[data-playhead-id="${playhead.id}"]`);
            expect(playheadItem).toBeTruthy();
        });

        it('should remove from UI controls when playhead is removed', () => {
            const playhead = xyPlot.addPlayhead({ speed: 1, enabled: true });

            // Verify in UI
            let controlsContainer = xyPlot.querySelector('.playhead-controls');
            let playheadItem = controlsContainer.querySelector(`.playhead-item[data-playhead-id="${playhead.id}"]`);
            expect(playheadItem).toBeTruthy();

            // Remove playhead
            xyPlot.removePlayhead(playhead.id);

            // Verify no longer in UI
            controlsContainer = xyPlot.querySelector('.playhead-controls');
            playheadItem = controlsContainer.querySelector(`.playhead-item[data-playhead-id="${playhead.id}"]`);
            expect(playheadItem).toBeFalsy();
        });
    });

    describe('Playhead Advancement', () => {
        it('should update playhead position when advanced', async () => {
            const playhead = xyPlot.addPlayhead({ speed: 1, position: 0.1, enabled: true });
            const initialPosition = playhead.position;

            // Simulate clock tick to advance playhead
            PubSub.publish('clock:tick', { tick: 1 });

            // Wait for advancement
            await new Promise(resolve => setTimeout(resolve, 10));

            // Verify position changed (percentage-based: should be > initial position)
            expect(playhead.position).toBeGreaterThan(initialPosition);

            // Verify playhead is still rendered (visual should exist)
            const svg = xyPlot.querySelector('#my_dataviz svg');
            const playheadLine = svg.querySelector(`.multi-playhead[data-playhead-id="${playhead.id}"]`);
            expect(playheadLine).toBeTruthy();

            // Verify position is consistent between internal state and visual
            const expectedPixelPosition = Math.floor(playhead.position * xyPlot.width);
            const actualPixelPosition = parseInt(playheadLine.getAttribute('x1'));
            expect(actualPixelPosition).toBe(expectedPixelPosition);
        });
    });

    describe('Width-Independent Event Sampling', () => {
        it('should detect same number of events regardless of visualization width', async () => {
            // Track sampled events by spying on playhead.sampleValue
            const sampledEvents = [];
            const playhead = xyPlot.addPlayhead({ speed: 1, position: 0.0, enabled: true });

            const originalSampleValue = playhead.sampleValue.bind(playhead);
            playhead.sampleValue = (rawValue, normalizedValue) => {
                sampledEvents.push({ rawValue, normalizedValue, width: xyPlot.width });
                originalSampleValue(rawValue, normalizedValue);
            };

            // Sample at position 0.5 with original width (720px)
            playhead.setPosition(0.5);
            xyPlot.sampleDataAtPlayhead(playhead);
            await new Promise(resolve => setTimeout(resolve, 10));

            const eventsAtWidth720 = sampledEvents.length;

            // Resize to a different width
            xyPlot.width = 1440;
            await xyPlot.renderGraph();

            // Clear sampled events and sample at same position with new width
            sampledEvents.length = 0;
            playhead.setPosition(0.5);
            xyPlot.sampleDataAtPlayhead(playhead);
            await new Promise(resolve => setTimeout(resolve, 10));

            const eventsAtWidth1440 = sampledEvents.length;

            // Both should have detected events (data exists at 50% position)
            expect(eventsAtWidth720).toBeGreaterThan(0);
            expect(eventsAtWidth1440).toBeGreaterThan(0);

            // Event count should be the same regardless of width
            expect(eventsAtWidth1440).toBe(eventsAtWidth720);

            // Resize to an even different width
            xyPlot.width = 360;
            await xyPlot.renderGraph();

            // Clear and sample again
            sampledEvents.length = 0;
            playhead.setPosition(0.5);
            xyPlot.sampleDataAtPlayhead(playhead);
            await new Promise(resolve => setTimeout(resolve, 10));

            const eventsAtWidth360 = sampledEvents.length;

            // Should still be the same
            expect(eventsAtWidth360).toBe(eventsAtWidth720);
        });

        it('should sample same data values at same percentage position after resize', async () => {
            const playhead = xyPlot.addPlayhead({ speed: 1, position: 0.3, enabled: true });

            // Capture sampled value at original width
            let sample1 = null;
            const originalSampleValue = playhead.sampleValue.bind(playhead);
            playhead.sampleValue = (rawValue, normalizedValue) => {
                sample1 = { rawValue, normalizedValue };
                originalSampleValue(rawValue, normalizedValue);
            };

            xyPlot.sampleDataAtPlayhead(playhead);
            await new Promise(resolve => setTimeout(resolve, 10));

            // Resize to different width
            xyPlot.width = 1000;
            await xyPlot.renderGraph();

            // Capture sampled value at new width
            let sample2 = null;
            playhead.sampleValue = (rawValue, normalizedValue) => {
                sample2 = { rawValue, normalizedValue };
                originalSampleValue(rawValue, normalizedValue);
            };

            playhead.setPosition(0.3); // Same percentage position
            xyPlot.sampleDataAtPlayhead(playhead);
            await new Promise(resolve => setTimeout(resolve, 10));

            // Should have sampled data both times
            expect(sample1).toBeTruthy();
            expect(sample2).toBeTruthy();

            // Normalized values should be very close (within small tolerance for floating point)
            expect(Math.abs(sample1.normalizedValue - sample2.normalizedValue)).toBeLessThan(0.01);
        });
    });
});
