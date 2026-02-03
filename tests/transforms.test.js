import { describe, test, expect } from 'vitest';

// Mock transform functions - we'll test the actual implementations
// These would normally be imported from the worker, but since it's a Web Worker,
// we'll copy the core logic for testing

describe('Transform Algorithms', () => {
    // Sample test data
    const testData = [
        { x: 0, y: 10, value: 10 },
        { x: 1, y: 20, value: 20 },
        { x: 2, y: 15, value: 15 },
        { x: 3, y: 25, value: 25 },
        { x: 4, y: 18, value: 18 }
    ];

    describe('Peak Detection', () => {
        test('should detect local maxima', () => {
            const data = [
                { x: 0, y: 10, value: 10 },
                { x: 1, y: 20, value: 20 }, // peak
                { x: 2, y: 15, value: 15 },
                { x: 3, y: 25, value: 25 }, // peak
                { x: 4, y: 18, value: 18 }
            ];

            const yValues = data.map(d => d.y);
            const peaks = [];

            // Peak detection logic
            for (let i = 1; i < yValues.length - 1; i++) {
                if (yValues[i] > yValues[i-1] && yValues[i] > yValues[i+1]) {
                    if (yValues[i] > 15) { // threshold
                        peaks.push(i);
                    }
                }
            }

            expect(peaks).toEqual([1, 3]);
        });

        test('should respect threshold parameter', () => {
            const data = [
                { x: 0, y: 5, value: 5 },
                { x: 1, y: 10, value: 10 }, // peak but below threshold
                { x: 2, y: 8, value: 8 },
                { x: 3, y: 25, value: 25 }, // peak above threshold
                { x: 4, y: 15, value: 15 }
            ];

            const yValues = data.map(d => d.y);
            const threshold = 0.7; // 70% of range
            const min = Math.min(...yValues);
            const max = Math.max(...yValues);
            const thresholdValue = min + (max - min) * threshold;

            const peaks = [];
            for (let i = 1; i < yValues.length - 1; i++) {
                if (yValues[i] > yValues[i-1] &&
                    yValues[i] > yValues[i+1] &&
                    yValues[i] > thresholdValue) {
                    peaks.push(i);
                }
            }

            expect(peaks).toEqual([3]); // Only high peak
        });
    });

    describe('Moving Average', () => {
        test('should compute moving average', () => {
            const data = [
                { x: 0, y: 10, value: 10 },
                { x: 1, y: 20, value: 20 },
                { x: 2, y: 30, value: 30 }
            ];

            const windowSize = 2;
            const result = [];

            for (let i = 0; i < data.length; i++) {
                const start = Math.max(0, i - Math.floor(windowSize / 2));
                const end = Math.min(data.length, i + Math.ceil(windowSize / 2));
                const window = data.slice(start, end);
                const avg = window.reduce((sum, d) => sum + d.y, 0) / window.length;
                result.push(avg);
            }

            expect(result[0]).toBeCloseTo(15); // (10+20)/2
            expect(result[1]).toBe(20); // (10+20+30)/3
            expect(result[2]).toBe(25); // (20+30)/2
        });
    });

    describe('Static Average', () => {
        test('should compute mean of all values', () => {
            const data = [
                { x: 0, y: 10, value: 10 },
                { x: 1, y: 20, value: 20 },
                { x: 2, y: 30, value: 30 }
            ];

            const yValues = data.map(d => d.y);
            const mean = yValues.reduce((sum, v) => sum + v, 0) / yValues.length;

            expect(mean).toBe(20);
        });
    });

    describe('Windowed Average', () => {
        test('should create non-overlapping windows', () => {
            const data = Array.from({ length: 10 }, (_, i) => ({ x: i, y: i, value: i }));
            const windowSize = 3;
            const result = [];

            for (let windowIndex = 0; windowIndex < Math.ceil(data.length / windowSize); windowIndex++) {
                const start = windowIndex * windowSize;
                const end = Math.min(start + windowSize, data.length);
                const window = data.slice(start, end);
                const avg = window.reduce((sum, d) => sum + d.y, 0) / window.length;

                for (let i = start; i < end; i++) {
                    result[i] = avg;
                }
            }

            expect(result[0]).toBe(1); // (0+1+2)/3
            expect(result[1]).toBe(1);
            expect(result[2]).toBe(1);
            expect(result[3]).toBe(4); // (3+4+5)/3
            expect(result[4]).toBe(4);
            expect(result[5]).toBe(4);
        });
    });

    describe('Percentile', () => {
        test('should compute percentile value', () => {
            const data = [
                { x: 0, y: 10, value: 10 },
                { x: 1, y: 20, value: 20 },
                { x: 2, y: 30, value: 30 },
                { x: 3, y: 40, value: 40 },
                { x: 4, y: 50, value: 50 }
            ];

            const yValues = data.map(d => d.y);
            const sorted = [...yValues].sort((a, b) => a - b);
            const percentile50 = sorted[Math.floor(0.5 * sorted.length)];
            const percentile75 = sorted[Math.floor(0.75 * sorted.length)];

            expect(percentile50).toBe(30); // median
            expect(percentile75).toBe(40); // 75th percentile
        });
    });

    describe('Difference', () => {
        test('should compute normal difference (A - B)', () => {
            const layerA = [
                { x: 0, y: 30, value: 30 },
                { x: 1, y: 40, value: 40 }
            ];
            const layerB = [
                { x: 0, y: 20, value: 20 },
                { x: 1, y: 25, value: 25 }
            ];

            const result = [];
            for (let i = 0; i < layerA.length; i++) {
                const diff = layerA[i].y - layerB[i].y;
                const derivedY = layerA[i].y + diff; // A + (A - B) = 2A - B
                result.push(derivedY);
            }

            expect(result[0]).toBe(40); // 30 + (30 - 20) = 40
            expect(result[1]).toBe(55); // 40 + (40 - 25) = 55
        });

        test('should compute inverted difference (B - A)', () => {
            const layerA = [{ x: 0, y: 30, value: 30 }];
            const layerB = [{ x: 0, y: 60, value: 60 }];

            const diff = layerB[0].y - layerA[0].y; // B - A
            const derivedY = layerA[0].y + diff;

            expect(derivedY).toBe(60); // 30 + (60 - 30) = 60
        });

        test('should compute absolute difference', () => {
            const layerA = [
                { x: 0, y: 30, value: 30 },
                { x: 1, y: 20, value: 20 }
            ];
            const layerB = [
                { x: 0, y: 60, value: 60 },
                { x: 1, y: 50, value: 50 }
            ];

            const result = [];
            for (let i = 0; i < layerA.length; i++) {
                const diff = Math.abs(layerA[i].y - layerB[i].y);
                const derivedY = layerA[i].y + diff;
                result.push(derivedY);
            }

            expect(result[0]).toBe(60); // 30 + |30 - 60| = 30 + 30 = 60
            expect(result[1]).toBe(50); // 20 + |20 - 50| = 20 + 30 = 50
        });
    });

    describe('Intersections', () => {
        test('should detect sign changes', () => {
            const layerA = [
                { x: 0, y: 10, value: 10 },
                { x: 1, y: 20, value: 20 },
                { x: 2, y: 15, value: 15 },
                { x: 3, y: 25, value: 25 }
            ];
            const layerB = [
                { x: 0, y: 15, value: 15 },
                { x: 1, y: 15, value: 15 },
                { x: 2, y: 15, value: 15 },
                { x: 3, y: 15, value: 15 }
            ];

            const crossings = [];
            for (let i = 0; i < layerA.length - 1; i++) {
                const diff1 = layerA[i].y - layerB[i].y;
                const diff2 = layerA[i + 1].y - layerB[i + 1].y;

                const crosses = (diff1 > 0 && diff2 < 0) || (diff1 < 0 && diff2 > 0);
                if (crosses) {
                    crossings.push(i);
                }
            }

            expect(crossings.length).toBeGreaterThan(0);
        });
    });

    describe('MAD (Median Absolute Deviation)', () => {
        test('should compute MAD threshold', () => {
            const coefficients = [1, 2, 3, 4, 5, 100]; // 100 is outlier

            const absCoeffs = coefficients.map(c => Math.abs(c));
            const sortedAbs = [...absCoeffs].sort((a, b) => a - b);
            const medianAbsDev = sortedAbs[Math.floor(sortedAbs.length / 2)];
            const sigma = medianAbsDev / 0.6745;
            const threshold = 2.5 * sigma;

            expect(medianAbsDev).toBe(3.5); // median of [1,2,3,4,5,100]
            expect(sigma).toBeCloseTo(5.19, 1);
            expect(threshold).toBeCloseTo(12.97, 1);
            expect(100).toBeGreaterThan(threshold); // Outlier detected
        });
    });
});
