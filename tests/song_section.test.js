import { describe, test, expect, beforeEach } from 'vitest';
import { SongSection } from '../lib/song_section.js';

/**
 * Tests for SongSection - Serialization/Deserialization
 *
 * Note: These tests focus on JSON serialization logic.
 * Full integration tests require all components in the DOM and are better
 * suited for browser-based end-to-end testing.
 */

describe('SongSection', () => {
    let section;

    beforeEach(() => {
        section = new SongSection('Test Section');
    });

    describe('Construction', () => {
        test('should create section with name', () => {
            expect(section.name).toBe('Test Section');
            expect(section.version).toBe('1.0.0');
            expect(section.id).toBeDefined();
            expect(section.timestamp).toBeDefined();
            expect(section.id).toMatch(/^section-/);
        });

        test('should have empty state initially', () => {
            expect(section.state).toEqual({});
        });

        test('should generate unique IDs', () => {
            const section2 = new SongSection('Another Section');
            expect(section.id).not.toBe(section2.id);
        });
    });

    describe('JSON Serialization', () => {
        test('should serialize to JSON', () => {
            // Set up some state
            section.state = {
                harmonicContext: {
                    poolKey: '0',
                    tonicNote: 60,
                    tempo: 120
                },
                layers: {
                    'viz-1': [{ id: 'layer-1', name: 'Test Layer' }]
                }
            };

            const json = section.toJSON();

            expect(json.id).toBe(section.id);
            expect(json.name).toBe('Test Section');
            expect(json.version).toBe('1.0.0');
            expect(json.timestamp).toBe(section.timestamp);
            expect(json.state).toBeDefined();
            expect(json.state.harmonicContext).toBeDefined();
            expect(json.state.harmonicContext.poolKey).toBe('0');
            expect(json.state.layers['viz-1'][0].name).toBe('Test Layer');
        });

        test('should deserialize from JSON', () => {
            const json = {
                id: 'test-id-123',
                name: 'Saved Section',
                version: '1.0.0',
                timestamp: 1234567890,
                state: {
                    harmonicContext: {
                        poolKey: '3♯',
                        tonicNote: 69,
                        tempo: 140
                    },
                    composer: {
                        compositionStyle: 'jazz-swing',
                        progression: [
                            { symbol: 'Am7', root: 69 }
                        ]
                    }
                }
            };

            const restored = SongSection.fromJSON(json);

            expect(restored.id).toBe('test-id-123');
            expect(restored.name).toBe('Saved Section');
            expect(restored.version).toBe('1.0.0');
            expect(restored.timestamp).toBe(1234567890);
            expect(restored.state.harmonicContext.poolKey).toBe('3♯');
            expect(restored.state.harmonicContext.tonicNote).toBe(69);
            expect(restored.state.composer.compositionStyle).toBe('jazz-swing');
        });

        test('should round-trip through JSON without data loss', () => {
            // Set up complex state
            section.state = {
                harmonicContext: {
                    poolKey: '3♯',
                    tonicName: 'A',
                    tonicNote: 69,
                    scaleType: 'diatonic',
                    tempo: 140,
                    timeSignature: '3/4',
                    beatsPerBar: 3,
                    mood: 'tense',
                    density: 0.8
                },
                layers: {
                    'viz-1': [
                        { id: 'layer-1', name: 'Original Data', type: 'data' },
                        { id: 'layer-2', name: 'FFT Lowpass', type: 'transform', transformType: 'fft_lowpass' }
                    ]
                },
                playheads: {
                    'viz-1': [
                        { id: 'ph-1', position: 0.5, speed: 1, layerId: 'layer-1', color: '#FF0000' }
                    ]
                },
                contourBindings: [
                    { id: 'cb-1', sourceLayerId: 'layer-2', targetComponentId: 'melody-planner' }
                ],
                whipBindings: [
                    { id: 'wb-1', sourcePlayheadId: 'ph-1', targetComponentId: 'bassist' }
                ],
                composer: {
                    compositionStyle: 'jazz-swing',
                    progression: [
                        { symbol: 'Am7', root: 69, quality: 'm7' },
                        { symbol: 'D7', root: 62, quality: '7' }
                    ],
                    progressionIndex: 1
                },
                instrumentalists: {
                    bassist: {
                        motionType: 'walking',
                        transpose: -12,
                        muted: false
                    }
                }
            };

            const json = section.toJSON();
            const restored = SongSection.fromJSON(json);

            expect(restored.name).toBe(section.name);
            expect(restored.state.harmonicContext.poolKey).toBe('3♯');
            expect(restored.state.harmonicContext.tempo).toBe(140);
            expect(restored.state.layers['viz-1'].length).toBe(2);
            expect(restored.state.playheads['viz-1'][0].position).toBe(0.5);
            expect(restored.state.contourBindings.length).toBe(1);
            expect(restored.state.whipBindings.length).toBe(1);
            expect(restored.state.composer.progression.length).toBe(2);
            expect(restored.state.instrumentalists.bassist.motionType).toBe('walking');
        });
    });

    describe('LocalStorage Persistence', () => {
        beforeEach(() => {
            localStorage.clear();
        });

        test('should save to localStorage', () => {
            section.state = {
                harmonicContext: { poolKey: '0', tempo: 120 }
            };

            section.saveToLocalStorage('test-section');

            const saved = localStorage.getItem('test-section');
            expect(saved).toBeDefined();

            const json = JSON.parse(saved);
            expect(json.name).toBe('Test Section');
            expect(json.state.harmonicContext.tempo).toBe(120);
        });

        test('should load from localStorage', () => {
            section.state = {
                harmonicContext: { poolKey: '0', tempo: 120 }
            };

            section.saveToLocalStorage('test-section');

            const loaded = SongSection.loadFromLocalStorage('test-section');
            expect(loaded).toBeDefined();
            expect(loaded.name).toBe('Test Section');
            expect(loaded.state.harmonicContext.tempo).toBe(120);
        });

        test('should return null if no saved state exists', () => {
            const loaded = SongSection.loadFromLocalStorage('nonexistent');
            expect(loaded).toBeNull();
        });

        test('should handle malformed JSON gracefully', () => {
            localStorage.setItem('bad-section', 'not valid json{{{');

            const loaded = SongSection.loadFromLocalStorage('bad-section');
            expect(loaded).toBeNull();
        });
    });

    describe('State Structure', () => {
        test('should support all expected state properties', () => {
            // Verify that the structure supports all documented properties
            const fullState = {
                harmonicContext: {},
                layers: {},
                playheads: {},
                contourBindings: [],
                whipBindings: [],
                planners: {},
                composer: {},
                instrumentalists: {},
                visualizerStates: {}
            };

            section.state = fullState;
            const json = section.toJSON();
            const restored = SongSection.fromJSON(json);

            expect(restored.state).toHaveProperty('harmonicContext');
            expect(restored.state).toHaveProperty('layers');
            expect(restored.state).toHaveProperty('playheads');
            expect(restored.state).toHaveProperty('contourBindings');
            expect(restored.state).toHaveProperty('whipBindings');
            expect(restored.state).toHaveProperty('planners');
            expect(restored.state).toHaveProperty('composer');
            expect(restored.state).toHaveProperty('instrumentalists');
            expect(restored.state).toHaveProperty('visualizerStates');
        });
    });
});
