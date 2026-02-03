// Transform Worker Implementation
// This runs in a Web Worker context (no DOM access)

self.onmessage = async (e) => {
    const { taskId, transformType, inputData, params } = e.data;

    try {
        let result;

        switch (transformType) {
            case 'peak_detection':
                result = computePeakDetection(inputData, params);
                break;
            case 'outlier_detection':
                result = computeOutlierDetection(inputData, params);
                break;
            case 'fft_lowpass':
                result = computeFFTLowpass(inputData, params);
                break;
            case 'fft_highpass':
                result = computeFFTHighpass(inputData, params);
                break;
            case 'fft_bandpass':
                result = computeFFTBandpass(inputData, params);
                break;
            case 'fft_dominant':
                result = computeFFTDominant(inputData, params);
                break;
            case 'moving_average':
                result = computeMovingAverage(inputData, params);
                break;
            case 'windowed_average':
                result = computeWindowedAverage(inputData, params);
                break;
            case 'static_average':
                result = computeStaticAverage(inputData, params);
                break;
            case 'percentile':
                result = computePercentile(inputData, params);
                break;
            case 'min_max':
                result = computeMinMax(inputData, params);
                break;
            case 'difference':
                result = computeDifference(inputData, params);
                break;
            case 'intersections':
                result = computeIntersections(inputData, params);
                break;
            default:
                throw new Error(`Unknown transform: ${transformType}`);
        }

        self.postMessage({ taskId, result });

    } catch (error) {
        self.postMessage({ taskId, error: error.message });
    }
};

// ============================================================================
// Transform Implementations
// ============================================================================

/**
 * Peak Detection - Simple local maxima detection
 */
function computePeakDetection(inputData, params) {
    const {
        waveletType = 'haar',
        decompositionLevel = 3,
        threshold = 0.7,
        featureType = 'peaks'
    } = params;

    if (!inputData || inputData.length === 0) {
        return [];
    }

    // Extract Y values
    const yValues = inputData.map(d => d.y !== undefined ? d.y : (d.value !== undefined ? d.value : d));

    // Detect peaks
    const peaks = detectPeaks(yValues, params);

    // Return input data points at peak indices
    return peaks.map(index => inputData[index]);
}

/**
 * Outlier Detection - Wavelet-based anomaly detection using MAD thresholding
 * Uses Haar wavelet detail coefficients and Median Absolute Deviation
 */
function computeOutlierDetection(inputData, params) {
    const { sensitivity = 2.5, minDistance = 1 } = params;
    // sensitivity: k value for MAD threshold (lower = more sensitive)
    // 2.0 = high sensitivity, 2.5 = moderate, 3.0 = low sensitivity

    if (!inputData || inputData.length === 0) {
        return [];
    }

    // Extract Y values
    const yValues = inputData.map(d => d.y !== undefined ? d.y : (d.value !== undefined ? d.value : d));

    // Single-level Haar wavelet decomposition (detail coefficients)
    const detailCoeffs = computeHaarDetailCoefficients(yValues);

    // Calculate MAD-based threshold
    const threshold = calculateMADThreshold(detailCoeffs, sensitivity);

    // Identify outlier indices in detail coefficients
    const outlierCoeffIndices = [];
    for (let i = 0; i < detailCoeffs.length; i++) {
        if (Math.abs(detailCoeffs[i]) > threshold) {
            outlierCoeffIndices.push(i);
        }
    }

    // Map coefficient indices back to original time series indices
    // Haar DWT downsamples by factor of 2, so coefficient index i corresponds to ~2*i in original
    const outlierIndices = new Set();
    outlierCoeffIndices.forEach(coeffIdx => {
        const timeIdx = coeffIdx * 2;
        // Add both samples that contributed to this coefficient
        if (timeIdx < inputData.length) outlierIndices.add(timeIdx);
        if (timeIdx + 1 < inputData.length) outlierIndices.add(timeIdx + 1);
    });

    // Apply minimum distance constraint
    const filteredIndices = Array.from(outlierIndices).sort((a, b) => a - b);
    const finalOutliers = [];
    for (let i = 0; i < filteredIndices.length; i++) {
        if (finalOutliers.length === 0 || filteredIndices[i] - finalOutliers[finalOutliers.length - 1] >= minDistance) {
            finalOutliers.push(filteredIndices[i]);
        }
    }

    // Return outlier points from original data
    return finalOutliers.map(index => inputData[index]);
}

/**
 * Compute Haar wavelet detail coefficients (single-level decomposition)
 */
function computeHaarDetailCoefficients(values) {
    const n = values.length;
    const detailCoeffs = [];

    // Haar detail coefficient: (a - b) / sqrt(2) for each pair
    for (let i = 0; i < n - 1; i += 2) {
        const a = values[i];
        const b = values[i + 1];
        detailCoeffs.push((a - b) / Math.sqrt(2));
    }

    return detailCoeffs;
}

/**
 * Calculate MAD (Median Absolute Deviation) threshold
 */
function calculateMADThreshold(coefficients, k = 2.5) {
    if (coefficients.length === 0) return 0;

    // 1. Calculate absolute values
    const absCoeffs = coefficients.map(c => Math.abs(c));

    // 2. Calculate median of absolute coefficients
    const sortedAbs = [...absCoeffs].sort((a, b) => a - b);
    const medianAbsDev = sortedAbs[Math.floor(sortedAbs.length / 2)];

    // 3. Apply consistency constant for normal distribution
    const sigma = medianAbsDev / 0.6745;

    // 4. Return threshold (k * sigma)
    return k * sigma;
}

function detectPeaks(values, params) {
    const { threshold = 0.7, minDistance = 1 } = params;
    const peaks = [];

    if (values.length < 3) return peaks;

    // Calculate threshold value (percentile-based)
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min;
    const thresholdValue = min + (range * threshold);

    for (let i = 1; i < values.length - 1; i++) {
        // Check if this is a local maximum above threshold
        if (values[i] > values[i-1] && values[i] > values[i+1] && values[i] > thresholdValue) {
            // Check minimum distance from last peak
            if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minDistance) {
                peaks.push(i);
            }
        }
    }

    return peaks;
}

/**
 * FFT Low-pass Filter - Extract smooth melodic contours
 * Removes high-frequency noise, keeps slow trends
 */
function computeFFTLowpass(inputData, params) {
    const { cutoffFrequency = 0.1 } = params; // 0.0 - 0.5 (fraction of Nyquist)

    if (!inputData || inputData.length === 0) {
        return [];
    }

    const yValues = inputData.map(d => d.y !== undefined ? d.y : (d.value !== undefined ? d.value : d));

    // Apply FFT-based low-pass filter
    const filtered = applyFrequencyFilter(yValues, cutoffFrequency, 'lowpass');

    return inputData.map((d, i) => ({
        x: d.x !== undefined ? d.x : i,
        y: filtered[i],
        value: filtered[i]
    }));
}

/**
 * FFT High-pass Filter - Extract rhythmic accents and rapid changes
 * Removes slow trends, keeps high-frequency variations
 */
function computeFFTHighpass(inputData, params) {
    const { cutoffFrequency = 0.1 } = params; // 0.0 - 0.5 (fraction of Nyquist)

    if (!inputData || inputData.length === 0) {
        return [];
    }

    const yValues = inputData.map(d => d.y !== undefined ? d.y : (d.value !== undefined ? d.value : d));

    // Apply FFT-based high-pass filter
    const filtered = applyFrequencyFilter(yValues, cutoffFrequency, 'highpass');

    return inputData.map((d, i) => ({
        x: d.x !== undefined ? d.x : i,
        y: filtered[i],
        value: filtered[i]
    }));
}

/**
 * FFT Band-pass Filter - Isolate specific frequency range
 * Extracts periodic patterns within frequency band
 */
function computeFFTBandpass(inputData, params) {
    const { lowCutoff = 0.05, highCutoff = 0.2 } = params; // Frequency range

    if (!inputData || inputData.length === 0) {
        return [];
    }

    const yValues = inputData.map(d => d.y !== undefined ? d.y : (d.value !== undefined ? d.value : d));

    // Apply FFT-based band-pass filter
    const filtered = applyBandpassFilter(yValues, lowCutoff, highCutoff);

    return inputData.map((d, i) => ({
        x: d.x !== undefined ? d.x : i,
        y: filtered[i],
        value: filtered[i]
    }));
}

/**
 * FFT Dominant Frequency - Extract main periodic component
 * Finds strongest frequency and reconstructs that component
 */
function computeFFTDominant(inputData, params) {
    const { minFrequency = 0.01, maxFrequency = 0.5 } = params;

    if (!inputData || inputData.length === 0) {
        return [];
    }

    const yValues = inputData.map(d => d.y !== undefined ? d.y : (d.value !== undefined ? d.value : d));

    // Extract dominant frequency component
    const dominant = extractDominantFrequency(yValues, minFrequency, maxFrequency);

    return inputData.map((d, i) => ({
        x: d.x !== undefined ? d.x : i,
        y: dominant[i]
    }));
}

/**
 * Apply frequency-domain filter (low-pass or high-pass)
 */
function applyFrequencyFilter(signal, cutoffFrequency, filterType) {
    const n = signal.length;

    // Forward FFT
    const fft = computeDFT(signal);

    // Apply filter in frequency domain
    const cutoffIndex = Math.floor(cutoffFrequency * n);

    for (let i = 0; i < fft.length; i++) {
        if (filterType === 'lowpass') {
            // Zero out high frequencies
            if (i > cutoffIndex && i < n - cutoffIndex) {
                fft[i].real = 0;
                fft[i].imag = 0;
            }
        } else if (filterType === 'highpass') {
            // Zero out low frequencies
            if (i <= cutoffIndex || i >= n - cutoffIndex) {
                fft[i].real = 0;
                fft[i].imag = 0;
            }
        }
    }

    // Inverse FFT
    return computeIDFT(fft);
}

/**
 * Apply band-pass filter
 */
function applyBandpassFilter(signal, lowCutoff, highCutoff) {
    const n = signal.length;

    // Forward FFT
    const fft = computeDFT(signal);

    // Apply filter in frequency domain
    const lowIndex = Math.floor(lowCutoff * n);
    const highIndex = Math.floor(highCutoff * n);

    for (let i = 0; i < fft.length; i++) {
        // Keep only frequencies in the band
        if ((i < lowIndex || i > highIndex) && (i < n - highIndex || i > n - lowIndex)) {
            fft[i].real = 0;
            fft[i].imag = 0;
        }
    }

    // Inverse FFT
    return computeIDFT(fft);
}

/**
 * Extract dominant frequency component
 */
function extractDominantFrequency(signal, minFreq, maxFreq) {
    const n = signal.length;

    // Forward FFT
    const fft = computeDFT(signal);

    // Find dominant frequency in allowed range
    const minIndex = Math.floor(minFreq * n);
    const maxIndex = Math.floor(maxFreq * n);

    let maxMagnitude = 0;
    let dominantIndex = 0;

    for (let i = minIndex; i <= maxIndex; i++) {
        const magnitude = Math.sqrt(fft[i].real * fft[i].real + fft[i].imag * fft[i].imag);
        if (magnitude > maxMagnitude) {
            maxMagnitude = magnitude;
            dominantIndex = i;
        }
    }

    // Zero out all frequencies except dominant
    for (let i = 0; i < fft.length; i++) {
        if (i !== dominantIndex && i !== n - dominantIndex) {
            fft[i].real = 0;
            fft[i].imag = 0;
        }
    }

    // Inverse FFT
    return computeIDFT(fft);
}

/**
 * Discrete Fourier Transform (DFT)
 * Simple implementation for moderate-sized signals
 */
function computeDFT(signal) {
    const n = signal.length;
    const fft = [];

    for (let k = 0; k < n; k++) {
        let real = 0;
        let imag = 0;

        for (let t = 0; t < n; t++) {
            const angle = -2 * Math.PI * k * t / n;
            real += signal[t] * Math.cos(angle);
            imag += signal[t] * Math.sin(angle);
        }

        fft.push({ real, imag });
    }

    return fft;
}

/**
 * Inverse Discrete Fourier Transform (IDFT)
 */
function computeIDFT(fft) {
    const n = fft.length;
    const signal = [];

    for (let t = 0; t < n; t++) {
        let sum = 0;

        for (let k = 0; k < n; k++) {
            const angle = 2 * Math.PI * k * t / n;
            sum += fft[k].real * Math.cos(angle) - fft[k].imag * Math.sin(angle);
        }

        signal.push(sum / n);
    }

    return signal;
}

/**
 * Moving Average - Smoothing Transform
 */
function computeMovingAverage(inputData, params) {
    const { windowSize = 10 } = params;  // Number of samples

    if (!inputData || inputData.length === 0) {
        return [];
    }

    const result = [];

    for (let i = 0; i < inputData.length; i++) {
        const start = Math.max(0, i - Math.floor(windowSize / 2));
        const end = Math.min(inputData.length, i + Math.ceil(windowSize / 2));

        const window = inputData.slice(start, end);
        const sum = window.reduce((acc, d) => {
            const val = d.y !== undefined ? d.y : (d.value !== undefined ? d.value : d);
            return acc + val;
        }, 0);
        const avg = sum / window.length;

        result.push({
            x: inputData[i].x !== undefined ? inputData[i].x : i,
            y: avg,
            value: avg
        });
    }

    return result;
}

/**
 * Windowed Average - Non-overlapping window averages (step function)
 * Divides data into windows of N samples, assigns average to all samples in window
 */
function computeWindowedAverage(inputData, params) {
    const { windowSize = 100 } = params;  // Number of samples per window

    if (!inputData || inputData.length === 0) {
        return [];
    }

    const result = [];
    const numWindows = Math.ceil(inputData.length / windowSize);

    for (let windowIndex = 0; windowIndex < numWindows; windowIndex++) {
        const start = windowIndex * windowSize;
        const end = Math.min(start + windowSize, inputData.length);
        const window = inputData.slice(start, end);

        // Calculate average for this window
        const sum = window.reduce((acc, d) => {
            const val = d.y !== undefined ? d.y : (d.value !== undefined ? d.value : d);
            return acc + val;
        }, 0);
        const avg = sum / window.length;

        // Assign this average to all points in the window
        for (let i = start; i < end; i++) {
            result.push({
                x: inputData[i].x !== undefined ? inputData[i].x : i,
                y: avg,
                value: avg
            });
        }
    }

    return result;
}

/**
 * Static Average - Horizontal line at mean value
 */
function computeStaticAverage(inputData, params) {
    if (!inputData || inputData.length === 0) {
        return [];
    }

    const yValues = inputData.map(d => d.y !== undefined ? d.y : (d.value !== undefined ? d.value : d));
    const mean = yValues.reduce((sum, v) => sum + v, 0) / yValues.length;

    // Return horizontal line at mean value
    return inputData.map(d => ({
        x: d.x !== undefined ? d.x : d,
        y: mean,
        value: mean
    }));
}

/**
 * Percentile - Horizontal line at percentile value
 */
function computePercentile(inputData, params) {
    const { percentile = 50 } = params;  // 0-100

    if (!inputData || inputData.length === 0) {
        return [];
    }

    const yValues = inputData.map(d => d.y !== undefined ? d.y : (d.value !== undefined ? d.value : d));
    const sorted = [...yValues].sort((a, b) => a - b);
    const index = Math.floor((percentile / 100) * sorted.length);
    const value = sorted[Math.min(index, sorted.length - 1)];

    // Return horizontal line at percentile value
    return inputData.map(d => ({
        x: d.x !== undefined ? d.x : d,
        y: value,
        value: value
    }));
}

/**
 * Min/Max - Horizontal line at min or max value
 */
function computeMinMax(inputData, params) {
    const { type = 'max' } = params;  // 'min' or 'max'

    if (!inputData || inputData.length === 0) {
        return [];
    }

    const yValues = inputData.map(d => d.y !== undefined ? d.y : (d.value !== undefined ? d.value : d));
    const value = type === 'max' ? Math.max(...yValues) : Math.min(...yValues);

    // Return horizontal line
    return inputData.map(d => ({
        x: d.x !== undefined ? d.x : d,
        y: value,
        value: value
    }));
}

/**
 * Intersections - Detect crossing points between two layers
 * Uses sign change detection on the difference signal
 */
function computeIntersections(inputData, params) {
    // inputData is an array of two layers: [layerA, layerB]
    if (!Array.isArray(inputData) || inputData.length !== 2) {
        throw new Error('Intersections transform requires exactly 2 input layers');
    }

    const [layerA, layerB] = inputData;

    if (!layerA || !layerB || layerA.length === 0 || layerB.length === 0) {
        return [];
    }

    const { interpolate = true, tolerance = 0.0 } = params;

    // Extract Y values from both layers
    const yValuesA = layerA.map(d => d.y !== undefined ? d.y : (d.value !== undefined ? d.value : d));
    const yValuesB = layerB.map(d => d.y !== undefined ? d.y : (d.value !== undefined ? d.value : d));

    const crossings = [];
    const n = Math.min(layerA.length, layerB.length);

    // Detect sign changes in difference (layerA - layerB)
    for (let i = 0; i < n - 1; i++) {
        const diff1 = yValuesA[i] - yValuesB[i];
        const diff2 = yValuesA[i + 1] - yValuesB[i + 1];

        // Check for sign change (or within tolerance of zero)
        const crosses = (diff1 > tolerance && diff2 < -tolerance) ||
                       (diff1 < -tolerance && diff2 > tolerance) ||
                       (Math.abs(diff1) <= tolerance || Math.abs(diff2) <= tolerance);

        if (crosses) {
            if (interpolate && Math.abs(diff1) > tolerance && Math.abs(diff2) > tolerance) {
                // Linear interpolation to find exact crossing point
                const t = Math.abs(diff1) / (Math.abs(diff1) + Math.abs(diff2));

                // Interpolate X
                const x1 = layerA[i].x !== undefined ? layerA[i].x : i;
                const x2 = layerA[i + 1].x !== undefined ? layerA[i + 1].x : i + 1;
                const crossX = x1 instanceof Date
                    ? new Date(x1.getTime() + t * (x2.getTime() - x1.getTime()))
                    : x1 + t * (x2 - x1);

                // Interpolate Y (should be approximately equal for both layers at crossing)
                const crossY = yValuesA[i] + t * (yValuesA[i + 1] - yValuesA[i]);

                crossings.push({
                    x: crossX,
                    y: crossY,
                    value: crossY
                });
            } else {
                // Use the point closest to zero difference
                const useI = Math.abs(diff1) < Math.abs(diff2) ? i : i + 1;
                const avgY = (yValuesA[useI] + yValuesB[useI]) / 2;
                crossings.push({
                    x: layerA[useI].x !== undefined ? layerA[useI].x : useI,
                    y: avgY,
                    value: avgY
                });
            }
        }
    }

    return crossings;
}

/**
 * Difference - Point-by-point difference between two layers, plotted relative to layer A
 * Supports three modes: normal (A - B), inverted (B - A), absolute (|A - B|)
 */
function computeDifference(inputData, params) {
    // inputData is an array of two layers: [layerA, layerB]
    if (!Array.isArray(inputData) || inputData.length !== 2) {
        throw new Error('Difference transform requires exactly 2 input layers');
    }

    const [layerA, layerB] = inputData;

    if (!layerA || !layerB || layerA.length === 0 || layerB.length === 0) {
        return [];
    }

    const { mode = 'normal' } = params;  // 'normal', 'inverted', 'absolute'

    // Extract Y values from both layers
    const yValuesA = layerA.map(d => d.y !== undefined ? d.y : (d.value !== undefined ? d.value : d));
    const yValuesB = layerB.map(d => d.y !== undefined ? d.y : (d.value !== undefined ? d.value : d));

    const result = [];

    for (let i = 0; i < Math.min(layerA.length, layerB.length); i++) {
        let difference;

        switch (mode) {
            case 'inverted':
                difference = yValuesB[i] - yValuesA[i];  // B - A (inverted)
                break;
            case 'absolute':
                difference = Math.abs(yValuesA[i] - yValuesB[i]);  // |A - B|
                break;
            case 'normal':
            default:
                difference = yValuesA[i] - yValuesB[i];  // A - B (normal)
                break;
        }

        // Plot relative to A: y = A + difference
        const derivedY = yValuesA[i] + difference;
        result.push({
            x: layerA[i].x !== undefined ? layerA[i].x : i,
            y: derivedY,
            value: derivedY
        });
    }

    return result;
}
