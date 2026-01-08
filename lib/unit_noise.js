/**
 * Unit Noise - 1D Perlin Noise Generator
 * Used for smooth, organic randomness in audio humanization
 *
 * Perlin noise produces smooth, continuous variations that feel natural
 * compared to pure random noise.
 */

class PerlinNoise1D {
    constructor(seed = 0) {
        this.seed = seed;
        this.permutation = this.generatePermutation();
    }

    /**
     * Generate permutation table for Perlin noise
     * @returns {number[]} Permutation array
     */
    generatePermutation() {
        const p = [];

        // Initialize with 0-255
        for (let i = 0; i < 256; i++) {
            p[i] = i;
        }

        // Shuffle using seed-based random
        const random = this.seededRandom(this.seed);
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [p[i], p[j]] = [p[j], p[i]];
        }

        // Duplicate to avoid wrapping
        return p.concat(p);
    }

    /**
     * Seeded random number generator
     * @param {number} seed - Random seed
     * @returns {function} Random function that returns 0-1
     */
    seededRandom(seed) {
        let state = seed || 1;
        return function() {
            state = (state * 9301 + 49297) % 233280;
            return state / 233280;
        };
    }

    /**
     * Fade function for smooth interpolation (6t^5 - 15t^4 + 10t^3)
     * @param {number} t - Input value (0-1)
     * @returns {number} Smoothed value
     */
    fade(t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    /**
     * Linear interpolation
     * @param {number} a - Start value
     * @param {number} b - End value
     * @param {number} t - Interpolation factor (0-1)
     * @returns {number} Interpolated value
     */
    lerp(a, b, t) {
        return a + t * (b - a);
    }

    /**
     * Gradient function for 1D noise
     * @param {number} hash - Hash value
     * @param {number} x - Position
     * @returns {number} Gradient value
     */
    grad(hash, x) {
        // In 1D, gradient is just +1 or -1
        return (hash & 1) === 0 ? x : -x;
    }

    /**
     * Core Perlin noise function (1D)
     * @param {number} x - Position in noise space
     * @returns {number} Noise value in range [-1, 1]
     */
    noise(x) {
        // Find unit grid cell containing point
        const X = Math.floor(x) & 255;

        // Relative x coordinate in cell (0-1)
        x -= Math.floor(x);

        // Compute fade curve
        const u = this.fade(x);

        // Hash coordinates of the 2 cell corners
        const a = this.permutation[X];
        const b = this.permutation[X + 1];

        // Blend results from corners
        return this.lerp(
            this.grad(a, x),
            this.grad(b, x - 1),
            u
        );
    }

    /**
     * Sample noise with frequency and amplitude scaling
     * @param {number} x - Position in noise space
     * @param {number} frequency - Frequency multiplier (higher = more variation)
     * @param {number} amplitude - Amplitude multiplier (higher = larger values)
     * @returns {number} Scaled noise value in range [-amplitude, amplitude]
     */
    sample(x, frequency = 1.0, amplitude = 1.0) {
        return this.noise(x * frequency) * amplitude;
    }

    /**
     * Octave noise - sum multiple frequencies for richer variation
     * @param {number} x - Position in noise space
     * @param {number} octaves - Number of octaves to sum
     * @param {number} persistence - Amplitude decay per octave (typically 0.5)
     * @returns {number} Multi-octave noise value
     */
    octaveNoise(x, octaves = 3, persistence = 0.5) {
        let total = 0;
        let frequency = 1;
        let amplitude = 1;
        let maxValue = 0;

        for (let i = 0; i < octaves; i++) {
            total += this.noise(x * frequency) * amplitude;
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= 2;
        }

        // Normalize to [-1, 1]
        return total / maxValue;
    }
}

// Export singleton instance with default seed
export const perlinNoise = new PerlinNoise1D();

// Also export class for custom instances
export { PerlinNoise1D };
