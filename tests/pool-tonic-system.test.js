import { describe, it, expect } from 'vitest';
import { harmonicContext } from '../lib/harmonic_context.js';
import { getChordQualityForDegreeInPool, selectNextTonicByFunction } from '../lib/music_theory.js';

describe('Pool/Tonic System', () => {
    describe('getScaleDegreeInPool', () => {
        it('should return degree 1 for tonic A in pool 3♯', () => {
            // Pool 3♯ contains: C♯, D, E, F♯, G♯, A, B (A major scale)
            // With tonic A, degrees should be: A=1, B=2, C♯=3, D=4, E=5, F♯=6, G♯=7
            const tonicNote = 69; // A4
            const poolKey = '3♯';
            // Pass tonicNote as both the note to find AND the reference tonic
            const degree = harmonicContext.getScaleDegreeInPool(tonicNote, poolKey, tonicNote);

            expect(degree).toBe(1);
        });

        it('should return degree 3 for C♯ in pool 3♯ with tonic A', () => {
            // C♯ is a major third above A, so it's degree 3
            const cSharpNote = 61; // C♯4
            const poolKey = '3♯';
            const tonicNote = 69; // A4 (reference tonic)

            // First set the pool/tonic context
            harmonicContext.setPoolAndTonic(poolKey, tonicNote, 'A');

            const degree = harmonicContext.getScaleDegreeInPool(cSharpNote, poolKey);

            expect(degree).toBe(3);
        });

        it('should return degree 2 for B in pool 3♯ with tonic A', () => {
            // B is a major second above A, so it's degree 2
            const bNote = 71; // B4
            const poolKey = '3♯';

            const degree = harmonicContext.getScaleDegreeInPool(bNote, poolKey);

            expect(degree).toBe(2);
        });

        it('should return degree 5 for E in pool 3♯ with tonic A', () => {
            // E is a perfect fifth above A, so it's degree 5
            const eNote = 64; // E4
            const poolKey = '3♯';

            const degree = harmonicContext.getScaleDegreeInPool(eNote, poolKey);

            expect(degree).toBe(5);
        });

        it('should work with pool 0 (C major) and tonic C', () => {
            // Pool 0 contains: C, D, E, F, G, A, B
            // With tonic C, degrees should be: C=1, D=2, E=3, F=4, G=5, A=6, B=7
            const tonicNote = 60; // C4
            const poolKey = '0';
            const degree = harmonicContext.getScaleDegreeInPool(tonicNote, poolKey, tonicNote);

            expect(degree).toBe(1);
        });

        it('should work with pool 0 (C major) and tonic A (relative minor)', () => {
            // Pool 0 contains: C, D, E, F, G, A, B
            // With tonic A, degrees should be: A=1, B=2, C=3, D=4, E=5, F=6, G=7
            const tonicNote = 69; // A4
            const poolKey = '0';
            const degree = harmonicContext.getScaleDegreeInPool(tonicNote, poolKey);

            expect(degree).toBe(1);
        });

        it('should return degree 3 for C in pool 0 with tonic A (Am scale)', () => {
            // C is a minor third above A, degree 3 in A natural minor
            const cNote = 60; // C4
            const poolKey = '0';

            const degree = harmonicContext.getScaleDegreeInPool(cNote, poolKey);

            // When tonic is A, C is degree 3 (A, B, C)
            expect(degree).toBe(3);
        });
    });

    describe('getChordQualityForDegreeInPool', () => {
        it('should return maj7 for degree 1 in major mode', () => {
            const quality = getChordQualityForDegreeInPool(1, 'major');
            expect(quality).toBe('maj7');
        });

        it('should return min7 for degree 2 in major mode', () => {
            const quality = getChordQualityForDegreeInPool(2, 'major');
            expect(quality).toBe('min7');
        });

        it('should return 7 (dominant 7) for degree 5 in major mode', () => {
            const quality = getChordQualityForDegreeInPool(5, 'major');
            expect(quality).toBe('7');
        });

        it('should return min7 for degree 6 in major mode', () => {
            const quality = getChordQualityForDegreeInPool(6, 'major');
            expect(quality).toBe('min7');
        });

        it('should return min7 for degree 1 in minor mode', () => {
            const quality = getChordQualityForDegreeInPool(1, 'minor');
            expect(quality).toBe('min7');
        });
    });

    describe('selectNextTonicByFunction', () => {
        it('should return notes within the pool', () => {
            const currentDegree = 1; // I chord
            const referenceTonic = 69; // A4
            const poolKey = '3♯';
            const style = 'jazz';

            const next = selectNextTonicByFunction(currentDegree, referenceTonic, poolKey, style);

            // Should return a valid degree (1-7)
            expect(next.degree).toBeGreaterThanOrEqual(1);
            expect(next.degree).toBeLessThanOrEqual(7);

            // Should return a valid MIDI note
            expect(next.tonicNote).toBeGreaterThanOrEqual(0);
            expect(next.tonicNote).toBeLessThanOrEqual(127);

            // Pitch class should be in the pool 3♯: [C♯=1, D=2, E=4, F♯=6, G♯=8, A=9, B=11]
            const poolPitchClasses = [1, 2, 4, 6, 8, 9, 11];
            expect(poolPitchClasses).toContain(next.pitchClass);
        });

        it('should respect reference tonic when calculating degrees', () => {
            const currentDegree = 1; // I chord
            const referenceTonic = 69; // A4
            const poolKey = '3♯';
            const style = 'default';

            // Run multiple times to test probabilistic behavior
            const results = new Set();
            for (let i = 0; i < 100; i++) {
                const next = selectNextTonicByFunction(currentDegree, referenceTonic, poolKey, style);
                results.add(next.pitchClass);
            }

            // Should only return pitch classes from pool 3♯
            const poolPitchClasses = [1, 2, 4, 6, 8, 9, 11];
            results.forEach(pitchClass => {
                expect(poolPitchClasses).toContain(pitchClass);
            });
        });

        it('should map degree 1 to reference tonic note', () => {
            // When we ask for degree 1, it should return a note with the same pitch class as reference tonic
            const currentDegree = 5; // Currently on V
            const referenceTonic = 69; // A4 (pitch class 9)
            const poolKey = '3♯';
            const style = 'default';

            // With high probability from V, we should go to I
            // Run multiple times and check that when degree 1 is selected, it has pitch class 9
            let foundDegree1 = false;
            for (let i = 0; i < 100; i++) {
                const next = selectNextTonicByFunction(currentDegree, referenceTonic, poolKey, style);
                if (next.degree === 1) {
                    foundDegree1 = true;
                    // Degree 1 should have same pitch class as reference tonic
                    expect(next.pitchClass).toBe(9); // A
                    break;
                }
            }

            // V→I is very common, so we should have found at least one degree 1
            expect(foundDegree1).toBe(true);
        });
    });

    describe('Full Chord Progression Generation', () => {
        it('should generate progression with correct tonic chord for pool 3♯ / tonic A', () => {
            // Set pool and tonic
            const poolKey = '3♯';
            const tonicNote = 69; // A4
            const tonicName = 'A';

            harmonicContext.setPoolAndTonic(poolKey, tonicNote, tonicName);

            // Get degree of tonic
            const degree = harmonicContext.getScaleDegreeInPool(tonicNote, poolKey);
            expect(degree).toBe(1);

            // Get chord quality for degree 1
            const quality = getChordQualityForDegreeInPool(degree, 'major');
            expect(quality).toBe('maj7');

            // Build chord symbol
            const symbol = `${harmonicContext.midiToNoteName(tonicNote)}${quality}`;
            expect(symbol).toBe('Amaj7');
        });

        it('should NOT generate Amin7 when pool is 3♯ and tonic is A', () => {
            // This was the original bug: Amin7 was generated instead of Amaj7
            const poolKey = '3♯';
            const tonicNote = 69; // A4

            const degree = harmonicContext.getScaleDegreeInPool(tonicNote, poolKey);
            const quality = getChordQualityForDegreeInPool(degree, 'major');

            // Should be maj7, not min7
            expect(quality).not.toBe('min7');
            expect(quality).toBe('maj7');
        });

        it('should generate correct progression for pool 2♯ / tonic D', () => {
            // Pool 2♯ = D major scale: D, E, F♯, G, A, B, C♯
            const poolKey = '2♯';
            const tonicNote = 62; // D4
            const tonicName = 'D';

            harmonicContext.setPoolAndTonic(poolKey, tonicNote, tonicName);

            const degree = harmonicContext.getScaleDegreeInPool(tonicNote, poolKey);
            expect(degree).toBe(1);

            const quality = getChordQualityForDegreeInPool(degree, 'major');
            expect(quality).toBe('maj7');

            const symbol = `${harmonicContext.midiToNoteName(tonicNote)}${quality}`;
            expect(symbol).toBe('Dmaj7');
        });

        it('should generate different qualities for different degrees in same pool', () => {
            const poolKey = '3♯';
            const referenceTonic = 69; // A4

            // Degree 1 (A) should be maj7
            const degree1Quality = getChordQualityForDegreeInPool(1, 'major');
            expect(degree1Quality).toBe('maj7');

            // Degree 2 (B) should be min7
            const degree2Quality = getChordQualityForDegreeInPool(2, 'major');
            expect(degree2Quality).toBe('min7');

            // Degree 5 (E) should be dominant 7
            const degree5Quality = getChordQualityForDegreeInPool(5, 'major');
            expect(degree5Quality).toBe('7');

            // Degree 6 (F♯) should be min7
            const degree6Quality = getChordQualityForDegreeInPool(6, 'major');
            expect(degree6Quality).toBe('min7');
        });
    });

    describe('Edge Cases', () => {
        it('should handle octave-different notes correctly', () => {
            // A4 and A5 should both be degree 1 in pool 3♯ with tonic A
            const poolKey = '3♯';
            const referenceTonic = 69; // A4

            const a4 = 69;
            const a5 = 81;

            const degree4 = harmonicContext.getScaleDegreeInPool(a4, poolKey, referenceTonic);
            const degree5 = harmonicContext.getScaleDegreeInPool(a5, poolKey, referenceTonic);

            expect(degree4).toBe(degree5);
            expect(degree4).toBe(1);
        });

        it('should return 0 for note not in pool', () => {
            // F natural (pitch class 5) is not in pool 3♯
            const fNote = 65; // F4
            const poolKey = '3♯';

            const degree = harmonicContext.getScaleDegreeInPool(fNote, poolKey);

            expect(degree).toBe(0);
        });

        it('should handle enharmonic equivalents', () => {
            // C♯ (pitch class 1) in pool 3♯ should be degree 3 when tonic is A
            const cSharp = 61; // C♯4 (pitch class 1)
            const dFlat = 61;  // D♭4 (same MIDI note, pitch class 1)
            const poolKey = '3♯';
            const referenceTonic = 69; // A4

            const degreeCSharp = harmonicContext.getScaleDegreeInPool(cSharp, poolKey, referenceTonic);
            const degreeDFlat = harmonicContext.getScaleDegreeInPool(dFlat, poolKey, referenceTonic);

            expect(degreeCSharp).toBe(degreeDFlat);
            expect(degreeCSharp).toBe(3);
        });
    });
});
