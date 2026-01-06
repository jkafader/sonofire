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

        // Load test data
        xyPlot.data = [
            { x: 0, y: 100 },
            { x: 100, y: 200 },
            { x: 200, y: 150 },
            { x: 300, y: 250 },
        ];

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
            // Add a playhead
            const playhead = xyPlot.addPlayhead({ speed: 1, position: 100, enabled: true });

            // Query for playhead line in SVG
            const svg = xyPlot.querySelector('#my_dataviz svg');
            expect(svg).toBeTruthy();

            const playheadLine = svg.querySelector(`.multi-playhead[data-playhead-id="${playhead.id}"]`);
            expect(playheadLine).toBeTruthy();
            expect(playheadLine.getAttribute('x1')).toBe('100');
            expect(playheadLine.getAttribute('x2')).toBe('100');
        });

        it('should render source light (draggable circle) when playhead is added', () => {
            // Add a playhead
            const playhead = xyPlot.addPlayhead({ speed: 1, position: 150, color: '#ff0000', enabled: true });

            // Query for source light circle in SVG
            const svg = xyPlot.querySelector('#my_dataviz svg');
            const sourceLight = svg.querySelector(`.playhead-source-light[data-playhead-id="${playhead.id}"]`);

            expect(sourceLight).toBeTruthy();
            expect(sourceLight.getAttribute('cx')).toBe('150');
            expect(sourceLight.style.fill).toBe('rgb(255, 0, 0)'); // #ff0000
        });

        it('should render multiple playheads', () => {
            // Add multiple playheads
            const ph1 = xyPlot.addPlayhead({ speed: 1, position: 50, enabled: true });
            const ph2 = xyPlot.addPlayhead({ speed: 2, position: 150, enabled: true });
            const ph3 = xyPlot.addPlayhead({ speed: 4, position: 250, enabled: true });

            // Query for all playhead lines
            const svg = xyPlot.querySelector('#my_dataviz svg');
            const playheadLines = svg.querySelectorAll('.multi-playhead');

            expect(playheadLines.length).toBe(3);
        });

        it('should remove playhead line when playhead is removed', () => {
            // Add a playhead
            const playhead = xyPlot.addPlayhead({ speed: 1, position: 100, enabled: true });

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
            const playhead = xyPlot.addPlayhead({ speed: 1, position: 100, enabled: true });

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
            const playhead = xyPlot.addPlayhead({ speed: 1, position: 100, enabled: false });

            // Query for playhead line
            const svg = xyPlot.querySelector('#my_dataviz svg');
            const playheadLine = svg.querySelector(`.multi-playhead[data-playhead-id="${playhead.id}"]`);

            expect(playheadLine).toBeFalsy();
        });

        it('should update playhead visual when toggled on', () => {
            // Add a disabled playhead
            const playhead = xyPlot.addPlayhead({ speed: 1, position: 100, enabled: false });

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
            const playhead = xyPlot.addPlayhead({ speed: 1, position: 100, enabled: true });

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
            const playhead = xyPlot.addPlayhead({ speed: 1, position: 100, color: '#ff0000', enabled: true });

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
            const playhead = xyPlot.addPlayhead({ speed: 1, position: 100, enabled: true });

            // Simulate clock tick to advance playhead
            PubSub.publish('clock:tick', { tick: 1 });

            // Wait for advancement
            await new Promise(resolve => setTimeout(resolve, 10));

            // Verify position changed
            expect(playhead.position).toBeGreaterThan(100);

            // Verify visual updated
            const svg = xyPlot.querySelector('#my_dataviz svg');
            const playheadLine = svg.querySelector(`.multi-playhead[data-playhead-id="${playhead.id}"]`);
            expect(parseInt(playheadLine.getAttribute('x1'))).toBeGreaterThan(100);
        });
    });
});
