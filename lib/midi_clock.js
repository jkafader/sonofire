import { PubSub } from './pubsub.js';

/**
 * MIDI Clock service - Provides timing/sync for all Sonofire components
 * Singleton pattern: use `midiClock` export
 */
class MIDIClock {
    constructor() {
        this.mode = 'master'; // 'master' | 'slave' (future: external MIDI sync)
        this.bpm = 120;
        this.ppqn = 24; // Pulses per quarter note (MIDI standard)
        this.isRunning = false;
        this.currentTick = 0;
        this.intervalHandle = null;
        this.startTimestamp = null;

        // Calculate interval in milliseconds
        this.updateInterval();
    }

    /**
     * Calculate interval between ticks based on BPM and PPQN
     */
    updateInterval() {
        // 60 seconds/minute * 1000 ms/second / (BPM * PPQN)
        this.intervalMs = (60 * 1000) / (this.bpm * this.ppqn);
    }

    /**
     * Start the MIDI clock in master mode
     * @param {number} bpm - Beats per minute (optional, uses current BPM if not specified)
     */
    start(bpm = null) {
        if (this.isRunning) {
            console.warn('MIDI Clock already running');
            return;
        }

        if (bpm !== null) {
            this.setBPM(bpm);
        }

        this.isRunning = true;
        this.currentTick = 0;
        this.startTimestamp = Date.now();

        // Publish start event
        PubSub.publish('clock:start', {
            timestamp: this.startTimestamp,
            bpm: this.bpm,
            ppqn: this.ppqn
        });

        // Start interval-based clock
        this.intervalHandle = setInterval(() => {
            this.tick();
        }, this.intervalMs);

        console.log(`MIDI Clock started at ${this.bpm} BPM (${this.intervalMs.toFixed(2)}ms per tick)`);
    }

    /**
     * Stop the MIDI clock
     */
    stop() {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;

        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }

        // Publish stop event
        PubSub.publish('clock:stop', {
            timestamp: Date.now(),
            finalTick: this.currentTick
        });

        console.log(`MIDI Clock stopped at tick ${this.currentTick}`);
    }

    /**
     * Internal tick handler
     */
    tick() {
        const timestamp = Date.now();

        // Publish tick event
        PubSub.publish('clock:tick', {
            tick: this.currentTick,
            timestamp: timestamp,
            ppqn: this.ppqn,
            bpm: this.bpm
        });

        this.currentTick++;
    }

    /**
     * Set BPM and update interval
     * @param {number} bpm - Beats per minute
     */
    setBPM(bpm) {
        if (bpm <= 0 || bpm > 300) {
            console.error('Invalid BPM:', bpm);
            return;
        }

        const oldBPM = this.bpm;
        this.bpm = bpm;
        this.updateInterval();

        // Publish tempo change
        PubSub.publish('clock:tempo', {
            bpm: this.bpm,
            previousBPM: oldBPM
        });

        // If running, restart with new interval
        if (this.isRunning) {
            this.stop();
            this.start();
        }

        console.log(`MIDI Clock tempo changed: ${oldBPM} → ${this.bpm} BPM`);
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

        if (wasRunning) {
            this.start();
        }

        console.log('MIDI Clock reset to tick 0');
    }
}

// Export singleton instance
export const midiClock = new MIDIClock();
