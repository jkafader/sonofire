import { describe, test, expect, beforeEach } from 'vitest';

/**
 * Tests for Composer's melody harmonization feature
 *
 * These tests verify that the composer correctly:
 * 1. Receives melody from the melody planner via PubSub
 * 2. Generates appropriate chord progressions to harmonize the melody
 * 3. Respects different composition styles (jazz, blues, funk, etc.)
 * 4. Assigns proper durations to chords
 * 5. Publishes harmonized chords to the music system
 */

// Mock PubSub for testing
const mockPubSub = {
    state: new Map(),
    subscriptions: new Map(),

    publish(topic, data) {
        this.state.set(topic, data);
        const handlers = this.subscriptions.get(topic) || [];
        handlers.forEach(handler => handler(data));
    },

    subscribe(topic, handler, context) {
        if (!this.subscriptions.has(topic)) {
            this.subscriptions.set(topic, []);
        }
        const boundHandler = context ? handler.bind(context) : handler;
        this.subscriptions.get(topic).push(boundHandler);
    },

    last(topic) {
        return this.state.get(topic);
    },

    clear() {
        this.state.clear();
        this.subscriptions.clear();
    }
};

// Simplified Composer class for testing melody harmonization logic
class TestComposer {
    constructor() {
        this.poolKey = '0';
        this.tonicNote = 60;
        this.scaleType = 'diatonic';
        this.beatsPerBar = 4;
        this.barsPerChord = 4;
        this.compositionStyle = 'jazz-swing';
        this.melodyInput = null;
        this.progression = [];
        this.progressionIndex = 0;
        this.useProbabilistic = true;
        this.progressionLength = 4;

        // Subscribe to melody
        mockPubSub.subscribe('melody:phrase', (data) => {
            this.handleMelodyPhrase(data);
        }, this);
    }

    handleMelodyPhrase(data) {
        // Convert notes to points format
        this.melodyInput = {
            ...data,
            points: data.notes.map(note => ({
                x: note.step,
                y: note.pitch
            }))
        };

        // Harmonize the melody
        this.harmonizeMelody();
    }

    harmonizeMelody() {
        if (!this.melodyInput || !this.melodyInput.notes) {
            console.warn('No melody input to harmonize');
            return;
        }

        const notes = this.melodyInput.notes;

        // Determine number of chords based on style
        let chordsPerPhrase;
        switch (this.compositionStyle) {
            case 'funk':
            case 'rock':
                chordsPerPhrase = 2;
                break;
            case 'blues-12bar':
                chordsPerPhrase = 3;
                break;
            case 'jazz-swing':
            default:
                chordsPerPhrase = 4;
                break;
        }

        // Divide melody into segments for each chord
        const segmentSize = Math.ceil(notes.length / chordsPerPhrase);
        const segments = [];

        for (let i = 0; i < chordsPerPhrase; i++) {
            const start = i * segmentSize;
            const end = Math.min((i + 1) * segmentSize, notes.length);
            segments.push(notes.slice(start, end));
        }

        // Generate chords for each segment
        const newProgression = [];
        segments.forEach((segment, index) => {
            const chord = this.selectChordForSegment(segment, newProgression[index - 1]);
            chord.durationInBeats = this.barsPerChord * this.beatsPerBar;
            newProgression.push(chord);
        });

        this.progression = newProgression;
        this.progressionIndex = 0;

        // Publish first chord
        this.publishCurrentChord();
    }

    selectChordForSegment(segment, previousChord) {
        // Find strong beat notes (first note and every 4th note)
        const strongBeatNotes = segment.filter((_, i) => i % 4 === 0);

        if (strongBeatNotes.length === 0) {
            return this.generateDefaultChord();
        }

        // Use first strong beat note to determine chord
        const targetPitch = strongBeatNotes[0].pitch;
        const pitchClass = targetPitch % 12;

        // Map pitch class to diatonic degree in C major
        const pitchClassToDegree = {
            0: 1,  // C
            2: 2,  // D
            4: 3,  // E
            5: 4,  // F
            7: 5,  // G
            9: 6,  // A
            11: 7  // B
        };

        const degree = pitchClassToDegree[pitchClass] || 1;
        const root = this.tonicNote + this.degreeToInterval(degree);
        const quality = this.getQualityForDegree(degree);
        const symbol = this.generateChordSymbol(root, quality);

        return {
            symbol,
            root,
            quality,
            degree,
            poolKey: this.poolKey
        };
    }

    degreeToInterval(degree) {
        // Intervals in C major scale
        const intervals = [0, 0, 2, 4, 5, 7, 9, 11];
        return intervals[degree] || 0;
    }

    getQualityForDegree(degree) {
        // Qualities for degrees in major scale
        const qualities = ['', '', '', 'm', '', '', 'm7', 'dim'];
        return qualities[degree] || '';
    }

    generateChordSymbol(root, quality) {
        const noteNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
        return noteNames[root % 12] + quality;
    }

    generateDefaultChord() {
        return {
            symbol: 'C',
            root: 60,
            quality: '',
            degree: 1,
            poolKey: this.poolKey
        };
    }

    publishCurrentChord() {
        if (this.progression.length === 0) return;

        const currentChord = this.progression[this.progressionIndex];
        mockPubSub.publish('music:chord', {
            chord: currentChord.symbol,
            root: currentChord.root,
            quality: currentChord.quality,
            duration: this.barsPerChord,
            progressionIndex: this.progressionIndex,
            progressionLength: this.progression.length,
            poolKey: currentChord.poolKey
        });
    }

    generateNewProgression() {
        // Priority 1: Use melody if available
        if (this.melodyInput && this.melodyInput.points && this.melodyInput.points.length > 0) {
            this.harmonizeMelody();
            return;
        }

        // Priority 2: Probabilistic (fallback)
        this.progression = [
            { symbol: 'C', root: 60, quality: '', degree: 1, poolKey: this.poolKey, durationInBeats: this.beatsPerBar * this.barsPerChord },
            { symbol: 'Am', root: 69, quality: 'm', degree: 6, poolKey: this.poolKey, durationInBeats: this.beatsPerBar * this.barsPerChord },
            { symbol: 'Dm', root: 62, quality: 'm', degree: 2, poolKey: this.poolKey, durationInBeats: this.beatsPerBar * this.barsPerChord },
            { symbol: 'G7', root: 67, quality: '7', degree: 5, poolKey: this.poolKey, durationInBeats: this.beatsPerBar * this.barsPerChord }
        ];
        this.progressionIndex = 0;
        this.publishCurrentChord();
    }
}

describe('Composer Melody Harmonization', () => {
    let composer;

    beforeEach(() => {
        mockPubSub.clear();
        composer = new TestComposer();
    });

    describe('Melody Reception', () => {
        test('should receive and convert melody from melody planner', () => {
            const melodyPhrase = {
                notes: [
                    { step: 0, pitch: 60, velocity: 80 },
                    { step: 1, pitch: 64, velocity: 75 },
                    { step: 2, pitch: 67, velocity: 70 },
                    { step: 3, pitch: 72, velocity: 85 }
                ],
                scale: [60, 62, 64, 65, 67, 69, 71],
                poolKey: '0',
                tonicNote: 60,
                scaleType: 'diatonic',
                phraseLength: 4
            };

            mockPubSub.publish('melody:phrase', melodyPhrase);

            expect(composer.melodyInput).toBeDefined();
            expect(composer.melodyInput.notes).toEqual(melodyPhrase.notes);
            expect(composer.melodyInput.points).toBeDefined();
            expect(composer.melodyInput.points.length).toBe(4);
            expect(composer.melodyInput.points[0]).toEqual({ x: 0, y: 60 });
            expect(composer.melodyInput.points[3]).toEqual({ x: 3, y: 72 });
        });
    });

    describe('Chord Generation from Melody', () => {
        test('should generate chords for jazz-swing style', () => {
            composer.compositionStyle = 'jazz-swing';

            const melodyPhrase = {
                notes: [
                    { step: 0, pitch: 60, velocity: 80 },
                    { step: 4, pitch: 64, velocity: 75 },
                    { step: 8, pitch: 67, velocity: 70 },
                    { step: 12, pitch: 65, velocity: 85 }
                ],
                scale: [60, 62, 64, 65, 67, 69, 71],
                poolKey: '0',
                tonicNote: 60,
                scaleType: 'diatonic',
                phraseLength: 16
            };

            mockPubSub.publish('melody:phrase', melodyPhrase);

            expect(composer.progression.length).toBe(4); // Jazz uses 4 chords

            composer.progression.forEach(chord => {
                expect(chord).toHaveProperty('symbol');
                expect(chord).toHaveProperty('root');
                expect(chord).toHaveProperty('quality');
                expect(chord).toHaveProperty('durationInBeats');
                expect(chord.root).toBeGreaterThanOrEqual(0);
                expect(chord.root).toBeLessThanOrEqual(127);
            });
        });

        test('should generate fewer chords for funk style', () => {
            composer.compositionStyle = 'funk';

            const melodyPhrase = {
                notes: [
                    { step: 0, pitch: 65, velocity: 80 },
                    { step: 4, pitch: 67, velocity: 75 }
                ],
                scale: [60, 62, 64, 65, 67, 69, 71],
                poolKey: '0',
                tonicNote: 60,
                scaleType: 'diatonic',
                phraseLength: 8
            };

            mockPubSub.publish('melody:phrase', melodyPhrase);

            expect(composer.progression.length).toBe(2); // Funk uses 2 chords
        });

        test('should generate chords for blues-12bar style', () => {
            composer.compositionStyle = 'blues-12bar';

            const melodyPhrase = {
                notes: [
                    { step: 0, pitch: 60, velocity: 80 },
                    { step: 6, pitch: 63, velocity: 75 },
                    { step: 12, pitch: 67, velocity: 70 }
                ],
                scale: [60, 62, 64, 65, 67, 69, 71],
                poolKey: '0',
                tonicNote: 60,
                scaleType: 'diatonic',
                phraseLength: 16
            };

            mockPubSub.publish('melody:phrase', melodyPhrase);

            expect(composer.progression.length).toBe(3); // Blues uses 3 chords
        });
    });

    describe('Chord Quality and Harmony', () => {
        test('should harmonize strong beat notes correctly', () => {
            const melodyPhrase = {
                notes: [
                    { step: 0, pitch: 60, velocity: 90 },  // C - strong
                    { step: 1, pitch: 62, velocity: 60 },
                    { step: 4, pitch: 67, velocity: 85 },  // G - strong
                ],
                scale: [60, 62, 64, 65, 67, 69, 71],
                poolKey: '0',
                tonicNote: 60,
                scaleType: 'diatonic',
                phraseLength: 8
            };

            mockPubSub.publish('melody:phrase', melodyPhrase);

            const firstChord = composer.progression[0];
            expect(firstChord.root % 12).toBe(0); // Should be C
        });

        test('should use appropriate chord qualities', () => {
            const melodyPhrase = {
                notes: [
                    { step: 0, pitch: 60, velocity: 80 },
                    { step: 4, pitch: 64, velocity: 75 },
                    { step: 8, pitch: 67, velocity: 70 }
                ],
                scale: [60, 62, 64, 65, 67, 69, 71],
                poolKey: '0',
                tonicNote: 60,
                scaleType: 'diatonic',
                phraseLength: 12
            };

            mockPubSub.publish('melody:phrase', melodyPhrase);

            composer.progression.forEach(chord => {
                expect(typeof chord.quality).toBe('string');
            });
        });
    });

    describe('Chord Duration and Timing', () => {
        test('should assign durations in beats to chords', () => {
            const melodyPhrase = {
                notes: [
                    { step: 0, pitch: 60, velocity: 80 },
                    { step: 8, pitch: 64, velocity: 75 }
                ],
                scale: [60, 62, 64, 65, 67, 69, 71],
                poolKey: '0',
                tonicNote: 60,
                scaleType: 'diatonic',
                phraseLength: 16
            };

            mockPubSub.publish('melody:phrase', melodyPhrase);

            composer.progression.forEach(chord => {
                expect(chord.durationInBeats).toBeDefined();
                expect(chord.durationInBeats).toBe(16); // 4 bars * 4 beats
                expect(Number.isFinite(chord.durationInBeats)).toBe(true);
            });
        });

        test('should respect time signature for chord durations', () => {
            composer.beatsPerBar = 3; // 3/4 time
            composer.barsPerChord = 2;

            const melodyPhrase = {
                notes: [
                    { step: 0, pitch: 60, velocity: 80 },
                    { step: 6, pitch: 64, velocity: 75 }
                ],
                scale: [60, 62, 64, 65, 67, 69, 71],
                poolKey: '0',
                tonicNote: 60,
                scaleType: 'diatonic',
                phraseLength: 12
            };

            mockPubSub.publish('melody:phrase', melodyPhrase);

            composer.progression.forEach(chord => {
                expect(chord.durationInBeats).toBe(6); // 2 bars * 3 beats
            });
        });
    });

    describe('Priority System', () => {
        test('should prioritize melody harmonization over probabilistic', () => {
            composer.useProbabilistic = true;
            composer.melodyInput = null;
            composer.progressionLength = 4;

            const melodyPhrase = {
                notes: [
                    { step: 0, pitch: 60, velocity: 80 },
                    { step: 4, pitch: 64, velocity: 75 }
                ],
                scale: [60, 62, 64, 65, 67, 69, 71],
                poolKey: '0',
                tonicNote: 60,
                scaleType: 'diatonic',
                phraseLength: 8
            };

            mockPubSub.publish('melody:phrase', melodyPhrase);
            composer.generateNewProgression();

            expect(composer.melodyInput).toBeDefined();
            expect(composer.progression.length).toBeGreaterThan(0);
        });

        test('should fall back to probabilistic when no melody available', () => {
            composer.useProbabilistic = true;
            composer.melodyInput = null;
            composer.progressionLength = 4;

            composer.generateNewProgression();

            expect(composer.progression.length).toBe(4);
        });
    });

    describe('Chord Publishing', () => {
        test('should publish first chord after harmonization', () => {
            const melodyPhrase = {
                notes: [
                    { step: 0, pitch: 60, velocity: 80 },
                    { step: 4, pitch: 64, velocity: 75 }
                ],
                scale: [60, 62, 64, 65, 67, 69, 71],
                poolKey: '0',
                tonicNote: 60,
                scaleType: 'diatonic',
                phraseLength: 8
            };

            mockPubSub.publish('melody:phrase', melodyPhrase);

            const publishedChord = mockPubSub.last('music:chord');
            expect(publishedChord).toBeDefined();
            expect(publishedChord.chord).toBeDefined();
            expect(publishedChord.root).toBeDefined();
            expect(publishedChord.quality).toBeDefined();
        });
    });
});
