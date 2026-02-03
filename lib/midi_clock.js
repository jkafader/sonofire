import { PubSub } from './pubsub.js';

/**
 * MIDI Clock service - Provides timing/sync for all Sonofire components
 * Uses Web Audio API clock and Web Worker for precise timing
 * Singleton pattern: use `midiClock` export
 *
 * Architecture:
 * - Web Worker runs look-ahead scheduler (immune to main-thread blocking)
 * - AudioContext provides hardware-precise timing reference
 * - Events scheduled ahead using audioContext.currentTime
 */
class MIDIClock {
    constructor() {
        this.mode = 'master'; // 'master' | 'slave' (future: external MIDI sync)
        this.bpm = 120;
        this.ppqn = 24; // Pulses per quarter note (MIDI standard)
        this.isRunning = false;
        this.currentTick = 0;
        this.startTimestamp = null;

        // Web Audio API for precise timing
        this.audioContext = null;
        this.audioStartTime = 0;  // When clock started in audioContext.currentTime

        // Timing worker for look-ahead scheduling
        this.timingWorker = null;
        this.workerReady = false;

        // Event queue for scheduled events
        this.scheduledEvents = [];  // [{tick, audioTime, scheduled: bool}]

        // Initialize audio context and worker
        this.initializeAudioContext();
        this.initializeWorker();

        // Start continuous event processing loop
        this.startEventProcessingLoop();
    }

    /**
     * Start continuous event processing loop
     * Runs on animation frame to check for events ready to fire
     */
    startEventProcessingLoop() {
        const processLoop = () => {
            if (this.isRunning) {
                this.processScheduledEvents();
            }
            requestAnimationFrame(processLoop);
        };
        requestAnimationFrame(processLoop);
    }

    /**
     * Initialize Web Audio API context
     */
    initializeAudioContext() {
        try {
            // Create audio context (use webkit prefix for Safari compatibility)
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContextClass();

            console.log('[MIDIClock] AudioContext initialized');
            console.log(`[MIDIClock] Sample rate: ${this.audioContext.sampleRate}Hz`);
        } catch (error) {
            console.error('[MIDIClock] Failed to initialize AudioContext:', error);
            console.warn('[MIDIClock] Falling back to Date.now() timing (less precise)');
        }
    }

    /**
     * Initialize timing web worker
     */
    initializeWorker() {
        try {
            this.timingWorker = new Worker('/lib/timing_worker.js');

            this.timingWorker.addEventListener('message', (event) => {
                this.handleWorkerMessage(event.data);
            });

            this.timingWorker.addEventListener('error', (error) => {
                console.error('[MIDIClock] Worker error:', error);
            });

            console.log('[MIDIClock] Timing worker initialized');
        } catch (error) {
            console.error('[MIDIClock] Failed to initialize timing worker:', error);
            console.warn('[MIDIClock] Clock will use main-thread timing (less precise)');
        }
    }

    /**
     * Handle messages from timing worker
     */
    handleWorkerMessage(message) {
        const { type, ...data } = message;

        switch (type) {
            case 'ready':
                this.workerReady = true;
                console.log('[MIDIClock] Worker ready');
                break;

            case 'started':
                console.log(`[MIDIClock] Worker started at ${data.bpm} BPM`);
                break;

            case 'stopped':
                console.log(`[MIDIClock] Worker stopped at tick ${data.finalTick}`);
                this.currentTick = data.finalTick;
                break;

            case 'tick':
                // Schedule this tick event
                this.scheduleTick(data.tick, data.audioTime, data.bpm, data.ppqn);
                break;

            case 'tempo-changed':
                console.log(`[MIDIClock] Worker tempo: ${data.previousBPM} → ${data.bpm} BPM`);
                break;

            case 'reset':
                console.log('[MIDIClock] Worker reset to tick 0');
                this.currentTick = 0;
                break;

            default:
                console.warn('[MIDIClock] Unknown worker message:', type);
        }
    }

    /**
     * Schedule a tick event with precise audio timing
     */
    scheduleTick(tick, workerTimeMs, bpm, ppqn) {
        // Convert worker time (performance.now()) to audio context time
        let audioTime;

        if (this.audioContext) {
            // Calculate offset between worker time and audio time
            const currentWorkerTime = performance.now();
            const currentAudioTime = this.audioContext.currentTime * 1000; // Convert to ms
            const offset = workerTimeMs - currentWorkerTime;
            audioTime = (currentAudioTime + offset) / 1000; // Convert back to seconds
        } else {
            // Fallback: use Date.now() (less precise)
            audioTime = (Date.now() + (workerTimeMs - performance.now())) / 1000;
        }

        // Add to scheduled events queue
        this.scheduledEvents.push({
            tick,
            audioTime,
            scheduled: false
        });

        // Process events that should fire now
        this.processScheduledEvents();
    }

    /**
     * Process scheduled events that are ready to fire
     */
    processScheduledEvents() {
        if (!this.audioContext) return;

        const currentTime = this.audioContext.currentTime;
        const threshold = currentTime + 0.01; // 10ms threshold for "now"

        // Find and fire events that are ready
        this.scheduledEvents = this.scheduledEvents.filter(event => {
            if (!event.scheduled && event.audioTime <= threshold) {
                // Fire this tick event
                this.fireTick(event.tick, event.audioTime);
                return false; // Remove from queue
            }
            return true; // Keep in queue
        });
    }

    /**
     * Fire a tick event at precise audio time
     */
    fireTick(tick, audioTime) {
        // Update current tick
        this.currentTick = tick;

        // Publish tick event with precise audio timing
        PubSub.publish('clock:tick', {
            tick: tick,
            audioTime: audioTime,
            timestamp: Date.now(),  // Wall clock time for logging
            ppqn: this.ppqn,
            bpm: this.bpm
        });

        // Also schedule visual update on next animation frame
        requestAnimationFrame(() => {
            PubSub.publish('clock:visual-tick', {
                tick: tick,
                audioTime: audioTime
            });
        });
    }

    /**
     * Start the MIDI clock in master mode
     * @param {number} bpm - Beats per minute (optional, uses current BPM if not specified)
     */
    start(bpm = null) {
        if (this.isRunning) {
            console.warn('[MIDIClock] Already running');
            return;
        }

        if (bpm !== null) {
            this.bpm = bpm;
        }

        // Resume audio context if suspended (required by browser autoplay policies)
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume().then(() => {
                console.log('[MIDIClock] AudioContext resumed');
                this.startInternal();
            });
        } else {
            this.startInternal();
        }
    }

    /**
     * Internal start method (called after audio context is ready)
     */
    startInternal() {
        this.isRunning = true;
        this.currentTick = 0;
        this.startTimestamp = Date.now();

        // Get audio context start time
        if (this.audioContext) {
            this.audioStartTime = this.audioContext.currentTime;
        }

        // Clear event queue
        this.scheduledEvents = [];

        // Publish start event
        PubSub.publish('clock:start', {
            timestamp: this.startTimestamp,
            audioTime: this.audioStartTime,
            bpm: this.bpm,
            ppqn: this.ppqn
        });

        // Start timing worker
        if (this.timingWorker && this.workerReady) {
            // Send current performance.now() time to worker
            const startTimeMs = performance.now();

            this.timingWorker.postMessage({
                type: 'start',
                data: {
                    bpm: this.bpm,
                    startTimeMs: startTimeMs
                }
            });
        } else {
            console.warn('[MIDIClock] Worker not ready, using fallback timing');
            // TODO: Implement fallback timing on main thread
        }

        console.log(`[MIDIClock] Started at ${this.bpm} BPM`);
    }

    /**
     * Stop the MIDI clock
     */
    stop() {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;

        // Stop timing worker
        if (this.timingWorker) {
            this.timingWorker.postMessage({ type: 'stop' });
        }

        // Clear scheduled events
        this.scheduledEvents = [];

        // Publish stop event
        PubSub.publish('clock:stop', {
            timestamp: Date.now(),
            audioTime: this.audioContext ? this.audioContext.currentTime : 0,
            finalTick: this.currentTick
        });

        console.log(`[MIDIClock] Stopped at tick ${this.currentTick}`);
    }

    /**
     * Set BPM and update interval
     * @param {number} bpm - Beats per minute
     */
    setBPM(bpm) {
        if (bpm <= 0 || bpm > 300) {
            console.error('[MIDIClock] Invalid BPM:', bpm);
            return;
        }

        const oldBPM = this.bpm;
        this.bpm = bpm;

        // Publish tempo change
        PubSub.publish('clock:tempo', {
            bpm: this.bpm,
            previousBPM: oldBPM
        });

        // Update worker tempo
        if (this.timingWorker && this.isRunning) {
            this.timingWorker.postMessage({
                type: 'set-bpm',
                data: { bpm: this.bpm }
            });
        }

        console.log(`[MIDIClock] Tempo changed: ${oldBPM} → ${this.bpm} BPM`);
    }

    /**
     * Get the current tick count
     * @returns {number}
     */
    getCurrentTick() {
        return this.currentTick;
    }

    /**
     * Get the tick number for the next beat
     * @returns {number}
     */
    getNextBeat() {
        // Beat occurs every ppqn ticks
        const currentBeat = Math.floor(this.currentTick / this.ppqn);
        return (currentBeat + 1) * this.ppqn;
    }

    /**
     * Get the current bar number (assuming 4/4 time)
     * @returns {number}
     */
    getCurrentBar() {
        // Bar = 4 beats in 4/4 time
        const ticksPerBar = this.ppqn * 4;
        return Math.floor(this.currentTick / ticksPerBar);
    }

    /**
     * Get the current beat within the bar (0-3 in 4/4 time)
     * @returns {number}
     */
    getCurrentBeat() {
        const ticksInBar = this.currentTick % (this.ppqn * 4);
        return Math.floor(ticksInBar / this.ppqn);
    }

    /**
     * Reset tick counter to zero
     */
    reset() {
        const wasRunning = this.isRunning;

        if (wasRunning) {
            this.stop();
        }

        this.currentTick = 0;
        this.scheduledEvents = [];

        // Reset worker
        if (this.timingWorker) {
            this.timingWorker.postMessage({ type: 'reset' });
        }

        if (wasRunning) {
            this.start();
        }

        console.log('[MIDIClock] Reset to tick 0');
    }

    /**
     * Get audio context time (for precise MIDI scheduling)
     * @returns {number} Current time in seconds
     */
    getAudioTime() {
        return this.audioContext ? this.audioContext.currentTime : Date.now() / 1000;
    }

    /**
     * Get the audio context (for external use)
     * @returns {AudioContext}
     */
    getAudioContext() {
        return this.audioContext;
    }
}

// Export singleton instance
export const midiClock = new MIDIClock();
