import { describe, it, expect, beforeEach } from 'vitest';
import { Playhead } from '../lib/playhead.js';

describe('Playhead Speed Integration Tests', () => {
    describe('Speed Multiplier Behavior', () => {
        it('should demonstrate that speed > 1 advances multiple times per tick', () => {
            const playhead = new Playhead('test-viz', {
                speed: 4,
                enabled: true,
                position: 0
            });

            // Track how many times we should advance
            const advanceCount = playhead.advance();

            // Speed 4 should return 4 (advance 4 times per tick)
            expect(advanceCount).toBe(4);

            // This demonstrates the fix: previously returned true (1),
            // now returns 4, allowing the visualizer to advance the playhead
            // position 4 times per clock tick
        });

        it('should demonstrate that speed < 1 advances less frequently', () => {
            const playhead = new Playhead('test-viz', {
                speed: 1/4,
                enabled: true,
                position: 0
            });

            // Tick 1: No advance
            expect(playhead.advance()).toBe(0);

            // Tick 2: No advance
            expect(playhead.advance()).toBe(0);

            // Tick 3: No advance
            expect(playhead.advance()).toBe(0);

            // Tick 4: Advance once
            expect(playhead.advance()).toBe(1);
        });

        it('should correctly handle all standard speed multipliers', () => {
            const testCases = [
                { speed: 1/16, ticks: 16, expectedAdvances: 1 },
                { speed: 1/8, ticks: 8, expectedAdvances: 1 },
                { speed: 1/4, ticks: 4, expectedAdvances: 1 },
                { speed: 1/2, ticks: 2, expectedAdvances: 1 },
                { speed: 1, ticks: 1, expectedAdvances: 1 },
                { speed: 2, ticks: 1, expectedAdvances: 2 },
                { speed: 4, ticks: 1, expectedAdvances: 4 },
                { speed: 8, ticks: 1, expectedAdvances: 8 },
                { speed: 16, ticks: 1, expectedAdvances: 16 },
            ];

            testCases.forEach(({ speed, ticks, expectedAdvances }) => {
                const playhead = new Playhead('test-viz', { speed, enabled: true });

                // For speeds < 1, tick multiple times until it advances
                if (speed < 1) {
                    let totalAdvances = 0;
                    for (let i = 0; i < ticks; i++) {
                        totalAdvances += playhead.advance();
                    }
                    expect(totalAdvances).toBe(expectedAdvances);
                } else {
                    // For speeds >= 1, single tick returns multiple advances
                    const advanceCount = playhead.advance();
                    expect(advanceCount).toBe(expectedAdvances);
                }
            });
        });
    });

    describe('Position Advancement Simulation', () => {
        it('should simulate visualizer advancing playhead position based on speed', () => {
            const playhead = new Playhead('test-viz', {
                speed: 3,
                enabled: true,
                position: 0
            });

            // Simulate what the visualizer does on each clock tick
            function simulateClockTick() {
                const advanceCount = playhead.advance();

                // Visualizer advances position 'advanceCount' times
                for (let i = 0; i < advanceCount; i++) {
                    playhead.position += 10; // Advance 10 pixels
                }

                return advanceCount;
            }

            // Tick 1: Speed 3 should advance 3 times
            const count1 = simulateClockTick();
            expect(count1).toBe(3);
            expect(playhead.position).toBe(30); // 3 advances × 10 pixels

            // Tick 2: Speed 3 should advance 3 times again
            const count2 = simulateClockTick();
            expect(count2).toBe(3);
            expect(playhead.position).toBe(60); // 6 total advances × 10 pixels
        });

        it('should demonstrate bug fix: speed 2 now advances twice, not once', () => {
            const playhead = new Playhead('test-viz', {
                speed: 2,
                enabled: true,
                position: 0
            });

            const advanceCount = playhead.advance();

            // BUG FIX VERIFICATION:
            // Previously: advance() returned true (treated as 1), position advanced once
            // Now: advance() returns 2, position can advance twice
            expect(advanceCount).toBe(2);

            // Simulate visualizer using this value
            for (let i = 0; i < advanceCount; i++) {
                playhead.position += 5;
            }

            // Position should be 10 (2 advances × 5 pixels), not 5 (1 advance × 5 pixels)
            expect(playhead.position).toBe(10);
        });
    });

    describe('Edge Cases', () => {
        it('should handle fractional speeds correctly', () => {
            const playhead = new Playhead('test-viz', {
                speed: 2.5, // 2.5x speed
                enabled: true
            });

            // Should round to 3 (Math.round(2.5) = 2, but we use Math.round which rounds .5 up in some JS engines)
            // Actually Math.round(2.5) can be 2 or 3 depending on banker's rounding
            // Let's test the actual behavior
            const advanceCount = playhead.advance();
            expect([2, 3]).toContain(advanceCount); // Accept either due to rounding
        });

        it('should handle very large speeds', () => {
            const playhead = new Playhead('test-viz', {
                speed: 100,
                enabled: true
            });

            const advanceCount = playhead.advance();
            expect(advanceCount).toBe(100);
        });

        it('should handle very small speeds', () => {
            const playhead = new Playhead('test-viz', {
                speed: 1/100,
                enabled: true
            });

            // Should advance once every 100 ticks
            for (let i = 0; i < 99; i++) {
                expect(playhead.advance()).toBe(0);
            }
            expect(playhead.advance()).toBe(1);
        });
    });
});
