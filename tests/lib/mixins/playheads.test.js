import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlayheadsMixin } from '../../../lib/mixins/playheads.js';
import { PubSub } from '../../../lib/pubsub.js';

// Create a minimal base class for testing
class MockBase {
    constructor() {
        this.id = 'test-visualizer';
        this.tagName = 'TEST-VISUALIZER';
        this._subscriptions = new Map();

        // Mock DOM style property
        this.style = {
            position: '',
            display: '',
            paddingLeft: '',
        };

        // Mock children array
        this.children = [];
        this.firstChild = null;
    }

    // Mock PubSub methods
    subscribe(topic, callback) {
        if (!this._subscriptions.has(topic)) {
            this._subscriptions.set(topic, []);
        }
        this._subscriptions.get(topic).push(callback);
        return PubSub.subscribe(topic, callback);
    }

    publish(topic, data) {
        return PubSub.publish(topic, data);
    }

    getLastValue(topic) {
        return PubSub.last(topic);
    }

    // Mock DOM methods
    appendChild(child) {
        this.children.push(child);
        if (!this.firstChild) {
            this.firstChild = child;
        }
    }

    insertBefore(newChild, referenceChild) {
        if (!referenceChild) {
            this.appendChild(newChild);
        } else {
            const index = this.children.indexOf(referenceChild);
            if (index !== -1) {
                this.children.splice(index, 0, newChild);
            } else {
                this.children.push(newChild);
            }
        }
        if (!this.firstChild) {
            this.firstChild = newChild;
        }
    }

    querySelector(selector) {
        return null;
    }

    querySelectorAll(selector) {
        return [];
    }

    // Mock render method
    render() {
        // No-op for testing
    }
}

// Apply the mixin
const TestVisualizer = PlayheadsMixin(MockBase);

describe('PlayheadsMixin', () => {
    let visualizer;

    beforeEach(() => {
        // Clear PubSub state
        PubSub.clearAllCallbacks();

        // Create a new test visualizer instance
        visualizer = new TestVisualizer();

        // Setup subscriptions
        visualizer.setupPlayheadSubscriptions();

        // Mock the required abstract methods
        visualizer.advancePlayheadPosition = vi.fn((playhead) => {
            playhead.position += 1;
        });

        visualizer.sampleDataAtPlayhead = vi.fn((playhead) => {
            playhead.sampleValue(100, 0.5);
        });
    });

    describe('Mixin Application', () => {
        it('should apply mixin to base class', () => {
            expect(visualizer).toBeInstanceOf(MockBase);
            expect(visualizer.playheads).toBeDefined();
            expect(visualizer.playheads).toEqual([]);
        });

        it('should initialize playheadControlsContainer as null', () => {
            expect(visualizer.playheadControlsContainer).toBe(null);
        });

        it('should provide all mixin methods', () => {
            // CRUD
            expect(typeof visualizer.addPlayhead).toBe('function');
            expect(typeof visualizer.removePlayhead).toBe('function');
            expect(typeof visualizer.getPlayhead).toBe('function');

            // Advancement
            expect(typeof visualizer.advanceAllPlayheads).toBe('function');

            // State
            expect(typeof visualizer.savePlayheads).toBe('function');
            expect(typeof visualizer.restorePlayheads).toBe('function');

            // Transport
            expect(typeof visualizer.play).toBe('function');
            expect(typeof visualizer.stop).toBe('function');
            expect(typeof visualizer.rewind).toBe('function');

            // UI
            expect(typeof visualizer.renderPlayheadControls).toBe('function');
        });
    });

    describe('Playhead CRUD', () => {
        it('should add a playhead', () => {
            const playhead = visualizer.addPlayhead({ speed: 2 });

            expect(playhead).toBeDefined();
            expect(visualizer.playheads).toHaveLength(1);
            expect(visualizer.playheads[0]).toBe(playhead);
            expect(playhead.speed).toBe(2);
        });

        it('should add multiple playheads', () => {
            const ph1 = visualizer.addPlayhead({ speed: 1 });
            const ph2 = visualizer.addPlayhead({ speed: 2 });
            const ph3 = visualizer.addPlayhead({ speed: 4 });

            expect(visualizer.playheads).toHaveLength(3);
            expect(visualizer.playheads[0]).toBe(ph1);
            expect(visualizer.playheads[1]).toBe(ph2);
            expect(visualizer.playheads[2]).toBe(ph3);
        });

        it('should publish creation event when adding playhead', () => {
            const publishSpy = vi.spyOn(PubSub, 'publish');
            const playhead = visualizer.addPlayhead({});

            expect(publishSpy).toHaveBeenCalledWith(
                `playhead:${visualizer.getVisualizerId()}:created`,
                expect.objectContaining({
                    visualizerId: visualizer.getVisualizerId(),
                    playheadId: playhead.id,
                })
            );
        });

        it('should get playhead by ID', () => {
            const playhead = visualizer.addPlayhead({});
            const retrieved = visualizer.getPlayhead(playhead.id);

            expect(retrieved).toBe(playhead);
        });

        it('should return undefined for non-existent playhead ID', () => {
            const retrieved = visualizer.getPlayhead('non-existent-id');
            expect(retrieved).toBeUndefined();
        });

        it('should remove playhead by ID', () => {
            const ph1 = visualizer.addPlayhead({});
            const ph2 = visualizer.addPlayhead({});
            const ph3 = visualizer.addPlayhead({});

            visualizer.removePlayhead(ph2.id);

            expect(visualizer.playheads).toHaveLength(2);
            expect(visualizer.playheads[0]).toBe(ph1);
            expect(visualizer.playheads[1]).toBe(ph3);
        });

        it('should publish removal event when removing playhead', () => {
            const playhead = visualizer.addPlayhead({});
            const publishSpy = vi.spyOn(PubSub, 'publish');

            visualizer.removePlayhead(playhead.id);

            expect(publishSpy).toHaveBeenCalledWith(
                `playhead:${visualizer.getVisualizerId()}:removed`,
                expect.objectContaining({
                    visualizerId: visualizer.getVisualizerId(),
                    playheadId: playhead.id,
                })
            );
        });
    });

    describe('Playhead Advancement', () => {
        it('should advance all enabled playheads', () => {
            const ph1 = visualizer.addPlayhead({ speed: 1, enabled: true });
            const ph2 = visualizer.addPlayhead({ speed: 1, enabled: true });

            visualizer.advanceAllPlayheads();

            expect(visualizer.advancePlayheadPosition).toHaveBeenCalledTimes(2);
            expect(visualizer.sampleDataAtPlayhead).toHaveBeenCalledTimes(2);
        });

        it('should not advance disabled playheads', () => {
            const ph1 = visualizer.addPlayhead({ speed: 1, enabled: true });
            const ph2 = visualizer.addPlayhead({ speed: 1, enabled: false });

            visualizer.advanceAllPlayheads();

            expect(visualizer.advancePlayheadPosition).toHaveBeenCalledTimes(1);
            expect(visualizer.advancePlayheadPosition).toHaveBeenCalledWith(ph1);
        });

        it('should call onPlayheadsAdvanced hook', () => {
            const hookSpy = vi.fn();
            visualizer.onPlayheadsAdvanced = hookSpy;

            visualizer.addPlayhead({ speed: 1, enabled: true });
            visualizer.advanceAllPlayheads();

            expect(hookSpy).toHaveBeenCalledTimes(1);
        });

        it('should respond to clock:tick events', () => {
            const playhead = visualizer.addPlayhead({ speed: 1, position: 0, enabled: true });

            PubSub.publish('clock:tick', { tick: 1 });

            expect(visualizer.advancePlayheadPosition).toHaveBeenCalled();
        });
    });

    describe('State Persistence', () => {
        it('should save playheads state to PubSub', () => {
            const ph1 = visualizer.addPlayhead({ speed: 2 });
            const ph2 = visualizer.addPlayhead({ speed: 4 });

            // Clear previous publish calls
            const publishSpy = vi.spyOn(PubSub, 'publish');
            visualizer.savePlayheads();

            expect(publishSpy).toHaveBeenCalledWith(
                `visualizer:${visualizer.getVisualizerId()}:playheads`,
                expect.objectContaining({
                    visualizerId: visualizer.getVisualizerId(),
                    playheads: expect.arrayContaining([
                        expect.objectContaining({ id: ph1.id, speed: 2 }),
                        expect.objectContaining({ id: ph2.id, speed: 4 }),
                    ])
                })
            );
        });

        it('should restore playheads from PubSub', () => {
            // Add playheads and save state (using percentage positions 0-1)
            const ph1 = visualizer.addPlayhead({ speed: 2, position: 0.25 });
            const ph2 = visualizer.addPlayhead({ speed: 4, position: 0.75 });

            // Create new visualizer and restore
            const newVisualizer = new TestVisualizer();
            newVisualizer.setupPlayheadSubscriptions();
            newVisualizer.restorePlayheads();

            expect(newVisualizer.playheads).toHaveLength(2);
            expect(newVisualizer.playheads[0].speed).toBe(2);
            expect(newVisualizer.playheads[0].position).toBe(0.25);
            expect(newVisualizer.playheads[1].speed).toBe(4);
            expect(newVisualizer.playheads[1].position).toBe(0.75);
        });
    });

    describe('Transport Controls', () => {
        it('should handle play command', () => {
            const consoleSpy = vi.spyOn(console, 'log');
            visualizer.play();
            expect(consoleSpy).toHaveBeenCalledWith('Transport: PLAY');
        });

        it('should handle stop command', () => {
            const consoleSpy = vi.spyOn(console, 'log');
            visualizer.stop();
            expect(consoleSpy).toHaveBeenCalledWith('Transport: STOP');
        });

        it('should rewind all playheads to position 0', () => {
            const ph1 = visualizer.addPlayhead({ speed: 1, position: 0.5 });
            const ph2 = visualizer.addPlayhead({ speed: 2, position: 0.8 });

            visualizer.rewind();

            expect(ph1.position).toBe(0);
            expect(ph2.position).toBe(0);
        });

        it('should respond to transport:play events', () => {
            const playSpy = vi.spyOn(visualizer, 'play');
            PubSub.publish('transport:play', {});
            expect(playSpy).toHaveBeenCalled();
        });

        it('should respond to transport:stop events', () => {
            const stopSpy = vi.spyOn(visualizer, 'stop');
            PubSub.publish('transport:stop', {});
            expect(stopSpy).toHaveBeenCalled();
        });

        it('should respond to transport:rewind events', () => {
            const rewindSpy = vi.spyOn(visualizer, 'rewind');
            PubSub.publish('transport:rewind', {});
            expect(rewindSpy).toHaveBeenCalled();
        });
    });

    describe('UI Event Handlers', () => {
        it('should handle add playhead request', () => {
            const initialCount = visualizer.playheads.length;
            visualizer.handleAddPlayhead();
            expect(visualizer.playheads).toHaveLength(initialCount + 1);
        });

        it('should handle remove playhead request', () => {
            const playhead = visualizer.addPlayhead({});
            visualizer.handleRemovePlayhead(playhead.id);
            expect(visualizer.playheads).toHaveLength(0);
        });

        it('should handle toggle playhead request', () => {
            const playhead = visualizer.addPlayhead({ enabled: true });
            const initialState = playhead.enabled;

            visualizer.handleTogglePlayhead(playhead.id);

            expect(playhead.enabled).toBe(!initialState);
        });

        it('should handle set playhead speed request', () => {
            const playhead = visualizer.addPlayhead({ speed: 1 });

            visualizer.handleSetPlayheadSpeed(playhead.id, 4);

            expect(playhead.speed).toBe(4);
        });

        it('should handle set playhead color request', () => {
            const playhead = visualizer.addPlayhead({ color: '#ff0000' });

            visualizer.handleSetPlayheadColor(playhead.id, '#00ff00');

            expect(playhead.color).toBe('#00ff00');
        });
    });

    describe('Visualizer ID', () => {
        it('should return element ID if available', () => {
            visualizer.id = 'my-custom-id';
            expect(visualizer.getVisualizerId()).toBe('my-custom-id');
        });

        it('should return tag name if no ID', () => {
            visualizer.id = null;
            visualizer.tagName = 'SONOFIRE-XY-PLOT';
            expect(visualizer.getVisualizerId()).toBe('sonofire-xy-plot');
        });
    });

    describe('Abstract Method Requirements', () => {
        it('should throw error if advancePlayheadPosition not implemented', () => {
            const baseVisualizer = new TestVisualizer();
            baseVisualizer.setupPlayheadSubscriptions();
            baseVisualizer.advancePlayheadPosition = undefined;

            const playhead = baseVisualizer.addPlayhead({ enabled: true });

            // Mock the base class method that throws
            baseVisualizer.advancePlayheadPosition = () => {
                throw new Error('advancePlayheadPosition() must be implemented by subclass');
            };

            expect(() => baseVisualizer.advanceAllPlayheads()).toThrow(
                'advancePlayheadPosition() must be implemented by subclass'
            );
        });

        it('should throw error if sampleDataAtPlayhead not implemented', () => {
            const baseVisualizer = new TestVisualizer();
            baseVisualizer.setupPlayheadSubscriptions();
            baseVisualizer.sampleDataAtPlayhead = undefined;

            const playhead = baseVisualizer.addPlayhead({ enabled: true });

            // Mock the base class method that throws
            baseVisualizer.advancePlayheadPosition = () => {}; // no-op
            baseVisualizer.sampleDataAtPlayhead = () => {
                throw new Error('sampleDataAtPlayhead() must be implemented by subclass');
            };

            expect(() => baseVisualizer.advanceAllPlayheads()).toThrow(
                'sampleDataAtPlayhead() must be implemented by subclass'
            );
        });
    });

    describe('UI Rendering', () => {
        it('should render playhead speed options', () => {
            const options = visualizer.renderSpeedOptions(1);

            expect(options).toContain('value="1"');
            expect(options).toContain('selected');
        });

        it('should render playhead item HTML', () => {
            const playhead = visualizer.addPlayhead({ speed: 2, color: '#ff0000' });
            const html = visualizer.renderPlayheadItem(playhead, 0);

            // Check for essential UI elements
            expect(html).toContain('playhead-indicator'); // Color indicator div
            expect(html).toContain('#ff0000'); // Playhead color
            expect(html).toContain('speed-select'); // Speed selector
            expect(html).toContain('toggle-playhead-btn'); // Toggle button
            expect(html).toContain('remove-playhead-btn'); // Remove button
        });
    });
});
