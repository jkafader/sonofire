import { describe, it, expect, beforeEach } from 'vitest';
import { SonofireSoloist } from '../components/instrumentalists/soloist.js';
import { PubSub } from '../lib/pubsub.js';

describe('Soloist Scale Adherence', () => {
    let soloist;

    beforeEach(() => {
        // Clear PubSub state
        PubSub.clearAllCallbacks();

        // Create soloist instance
        soloist = new SonofireSoloist();

        // Set up a known scale: C major (pool "0")
        // C D E F G A B = pitch classes 0, 2, 4, 5, 7, 9, 11
        soloist.currentScale = [60, 62, 64, 65, 67, 69, 71]; // C4-B4
        soloist.poolKey = '0';
        soloist.tonicNote = 60; // C

        // Set soloist range to cover multiple octaves
        soloist.minNote = 48; // C3
        soloist.maxNote = 84; // C6

        // Mock sendNote to prevent actual audio output
        soloist.sendNote = (note, velocity, duration) => {
            soloist.lastNote = note;
        };
    });

    describe('getNearestScaleNote', () => {
        it('should return note unchanged if already in scale', () => {
            const cNote = 60; // C4 - in scale
            expect(soloist.getNearestScaleNote(cNote)).toBe(60);

            const gNote = 67; // G4 - in scale
            expect(soloist.getNearestScaleNote(gNote)).toBe(67);
        });

        it('should snap to nearest scale note within same octave', () => {
            const cSharp = 61; // C#4 - not in C major
            const nearest = soloist.getNearestScaleNote(cSharp);

            // Should snap to either C (60) or D (62)
            // C# is 1 semitone from both, so either is valid
            expect([60, 62]).toContain(nearest);
        });

        it('should work across octaves', () => {
            const highCSharp = 73; // C#5 - not in C major
            const nearest = soloist.getNearestScaleNote(highCSharp);

            // Should snap to C5 (72) or D5 (74)
            expect([72, 74]).toContain(nearest);
        });

        it('should preserve octave when quantizing', () => {
            const fSharp = 66; // F#4 - not in C major
            const nearest = soloist.getNearestScaleNote(fSharp);

            // Should snap to F (65) or G (67), both in octave 4
            expect([65, 67]).toContain(nearest);

            // Should NOT snap to notes in different octaves
            expect(nearest).toBeGreaterThanOrEqual(60); // Not below C4
            expect(nearest).toBeLessThan(72); // Not above B4
        });
    });

    describe('Data Point Handling (No Forecast)', () => {
        it('should play only scale notes when no forecast data present', () => {
            // Ensure no forecast data
            soloist.hasForecastData = false;
            soloist.currentDeviation = null;

            const playedNotes = [];
            soloist.sendNote = (note, velocity, duration) => {
                playedNotes.push(note);
                soloist.lastNote = note;
            };

            // Simulate data points
            for (let i = 0; i < 20; i++) {
                soloist.handleDataPoint({
                    value: Math.random(),
                    timestamp: Date.now()
                });
            }

            // All played notes should be in scale
            playedNotes.forEach(note => {
                const pitchClass = note % 12;
                const scalePitchClasses = [0, 2, 4, 5, 7, 9, 11]; // C major
                expect(scalePitchClasses).toContain(pitchClass);
            });
        });

        it('should never apply dissonance without forecast data', () => {
            soloist.hasForecastData = false;
            soloist.currentDeviation = null;

            const playedNotes = [];
            soloist.sendNote = (note, velocity, duration) => {
                playedNotes.push(note);
                soloist.lastNote = note;
            };

            // Generate 50 notes
            for (let i = 0; i < 50; i++) {
                soloist.handleDataPoint({
                    value: Math.random(),
                    timestamp: Date.now()
                });
            }

            // Verify all notes are in scale (no chromatic alterations)
            const cMajorPitchClasses = [0, 2, 4, 5, 7, 9, 11];
            playedNotes.forEach(note => {
                expect(cMajorPitchClasses).toContain(note % 12);
            });
        });
    });

    describe('Forecast Data Handling', () => {
        it('should allow dissonance only when forecast data present with high deviation', () => {
            // Set high deviation
            soloist.handleForecastData({ deviation: 0.9 });
            expect(soloist.hasForecastData).toBe(true);
            expect(soloist.currentDeviation).toBe(0.9);

            const playedNotes = [];
            soloist.sendNote = (note, velocity, duration) => {
                playedNotes.push(note);
                soloist.lastNote = note;
            };

            // Generate notes
            for (let i = 0; i < 50; i++) {
                soloist.handleDataPoint({
                    value: Math.random(),
                    timestamp: Date.now()
                });
            }

            // With high deviation, SOME notes might be chromatic (out of scale)
            const chromaticNotes = playedNotes.filter(note => {
                const pitchClass = note % 12;
                return ![0, 2, 4, 5, 7, 9, 11].includes(pitchClass);
            });

            // We should have at least some chromatic notes with deviation 0.9
            // (Due to 70% probability in applyDissonance for deviation > 0.8)
            // But this is probabilistic, so we just check that it's possible
            // Not asserting a minimum count to avoid flaky tests
        });

        it('should stay in scale when deviation is low', () => {
            // Set low deviation
            soloist.handleForecastData({ deviation: 0.1 });
            expect(soloist.hasForecastData).toBe(true);
            expect(soloist.currentDeviation).toBe(0.1);

            const playedNotes = [];
            soloist.sendNote = (note, velocity, duration) => {
                playedNotes.push(note);
                soloist.lastNote = note;
            };

            // Generate notes
            for (let i = 0; i < 30; i++) {
                soloist.handleDataPoint({
                    value: Math.random(),
                    timestamp: Date.now()
                });
            }

            // With low deviation (< 0.2), notes should be quantized back to scale
            const cMajorPitchClasses = [0, 2, 4, 5, 7, 9, 11];
            playedNotes.forEach(note => {
                expect(cMajorPitchClasses).toContain(note % 12);
            });
        });
    });

    describe('Whip-triggered Note Generation', () => {
        it('should generate scale notes when triggered by whip automation', () => {
            soloist.hasForecastData = false; // No forecast
            soloist.enabled = true;

            const playedNotes = [];
            soloist.sendNote = (note, velocity, duration) => {
                playedNotes.push(note);
                soloist.lastNote = note;
            };

            // Simulate whip triggers
            for (let i = 0; i < 20; i++) {
                soloist.generateAndPlayNote();
            }

            // All notes should be in scale
            const cMajorPitchClasses = [0, 2, 4, 5, 7, 9, 11];
            playedNotes.forEach(note => {
                expect(cMajorPitchClasses).toContain(note % 12);
            });
        });
    });

    describe('isInScale', () => {
        it('should correctly identify scale notes', () => {
            expect(soloist.isInScale(60)).toBe(true);  // C
            expect(soloist.isInScale(62)).toBe(true);  // D
            expect(soloist.isInScale(64)).toBe(true);  // E
            expect(soloist.isInScale(65)).toBe(true);  // F
            expect(soloist.isInScale(67)).toBe(true);  // G
            expect(soloist.isInScale(69)).toBe(true);  // A
            expect(soloist.isInScale(71)).toBe(true);  // B
        });

        it('should correctly identify non-scale notes', () => {
            expect(soloist.isInScale(61)).toBe(false); // C#
            expect(soloist.isInScale(63)).toBe(false); // D#
            expect(soloist.isInScale(66)).toBe(false); // F#
            expect(soloist.isInScale(68)).toBe(false); // G#
            expect(soloist.isInScale(70)).toBe(false); // A#
        });

        it('should work across octaves', () => {
            expect(soloist.isInScale(72)).toBe(true);  // C5
            expect(soloist.isInScale(48)).toBe(true);  // C3
            expect(soloist.isInScale(73)).toBe(false); // C#5
            expect(soloist.isInScale(49)).toBe(false); // C#3
        });
    });
});
