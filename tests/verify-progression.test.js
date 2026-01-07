import { describe, it, expect } from 'vitest';
import { harmonicContext } from '../lib/harmonic_context.js';
import { getChordQualityForDegreeInPool } from '../lib/music_theory.js';

describe('Pool/Tonic Chord Progression System', () => {
    const poolKey = '3♯';
    const tonicNote = 69; // A4
    const tonicName = 'A';

    describe('Scale degree calculation', () => {
        it('should identify tonic A as degree 1 in pool 3♯', () => {
            const degree = harmonicContext.getScaleDegreeInPool(tonicNote, poolKey, tonicNote);
            expect(degree).toBe(1);
        });

        it('should return correct chord quality for degree 1', () => {
            const degree = harmonicContext.getScaleDegreeInPool(tonicNote, poolKey, tonicNote);
            const quality = getChordQualityForDegreeInPool(degree, 'major');
            expect(quality).toBe('maj7');
        });

        it('should generate Amaj7 as first chord symbol', () => {
            const degree = harmonicContext.getScaleDegreeInPool(tonicNote, poolKey, tonicNote);
            const quality = getChordQualityForDegreeInPool(degree, 'major');
            const symbol = harmonicContext.midiToNoteName(tonicNote) + quality;

            expect(symbol).toBe('Amaj7');
        });
    });

    describe('All degrees in pool 3♯ with tonic A', () => {
        const pool3Sharp = [
            { name: 'A', midi: 69, expectedDegree: 1, expectedQuality: 'maj7' },
            { name: 'B', midi: 71, expectedDegree: 2, expectedQuality: 'min7' },
            { name: 'C♯', midi: 61, expectedDegree: 3, expectedQuality: 'min7' },
            { name: 'D', midi: 62, expectedDegree: 4, expectedQuality: 'maj7' },
            { name: 'E', midi: 64, expectedDegree: 5, expectedQuality: '7' },
            { name: 'F♯', midi: 66, expectedDegree: 6, expectedQuality: 'min7' },
            { name: 'G♯', midi: 68, expectedDegree: 7, expectedQuality: 'min7b5' }
        ];

        pool3Sharp.forEach(note => {
            it(`should identify ${note.name} as degree ${note.expectedDegree} with quality ${note.expectedQuality}`, () => {
                const degree = harmonicContext.getScaleDegreeInPool(note.midi, poolKey, tonicNote);
                expect(degree).toBe(note.expectedDegree);

                const quality = getChordQualityForDegreeInPool(degree, 'major');
                expect(quality).toBe(note.expectedQuality);

                const symbol = note.name + quality;
                expect(symbol).toBe(note.name + note.expectedQuality);
            });
        });
    });

    describe('Chord symbol generation', () => {
        it('should not generate Amin7 for A in 3♯ pool (should be Amaj7)', () => {
            const degree = harmonicContext.getScaleDegreeInPool(tonicNote, poolKey, tonicNote);
            const quality = getChordQualityForDegreeInPool(degree, 'major');
            const symbol = harmonicContext.midiToNoteName(tonicNote) + quality;

            expect(symbol).not.toBe('Amin7');
            expect(symbol).toBe('Amaj7');
        });
    });
});
