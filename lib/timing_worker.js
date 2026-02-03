/**
 * Timing Web Worker - Precise scheduling with look-ahead
 *
 * Architecture:
 * - Runs scheduler loop every 25ms
 * - Looks ahead 100ms each tick
 * - Calculates which beats/ticks fall in look-ahead window
 * - Posts timing events to main thread for precise Web Audio scheduling
 *
 * Based on Web Audio best practices:
 * https://web.dev/articles/audio-scheduling
 */

const SCHEDULER_INTERVAL_MS = 25;  // How often to check schedule (25ms recommended)
const LOOKAHEAD_TIME_MS = 100;     // How far ahead to schedule (100ms recommended)

class TimingScheduler {
    constructor() {
        this.isRunning = false;
        this.bpm = 120;
        this.ppqn = 24;  // Pulses per quarter note (MIDI standard)
        this.currentTick = 0;
        this.schedulerIntervalHandle = null;

        // Timing state
        this.nextTickTime = 0;  // Next tick time in milliseconds
        this.tickIntervalMs = 0;  // Milliseconds between ticks

        this.updateTickInterval();
    }

    /**
     * Calculate interval between ticks based on BPM and PPQN
     */
    updateTickInterval() {
        // 60 seconds/minute * 1000 ms/second / (BPM * PPQN)
        this.tickIntervalMs = (60 * 1000) / (this.bpm * this.ppqn);
    }

    /**
     * Start the scheduler
     */
    start(bpm = null, startTimeMs = null) {
        if (this.isRunning) {
            console.warn('[TimingWorker] Scheduler already running');
            return;
        }

        if (bpm !== null) {
            this.setBPM(bpm);
        }

        this.isRunning = true;
        this.currentTick = 0;

        // Initialize timing based on audio context time from main thread
        this.nextTickTime = (startTimeMs || 0) + this.tickIntervalMs;

        // Start scheduler loop
        this.schedulerIntervalHandle = setInterval(() => {
            this.schedule();
        }, SCHEDULER_INTERVAL_MS);

        postMessage({
            type: 'started',
            bpm: this.bpm,
            ppqn: this.ppqn,
            tickIntervalMs: this.tickIntervalMs
        });

        console.log(`[TimingWorker] Started at ${this.bpm} BPM (${this.tickIntervalMs.toFixed(2)}ms per tick)`);
    }

    /**
     * Stop the scheduler
     */
    stop() {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;

        if (this.schedulerIntervalHandle) {
            clearInterval(this.schedulerIntervalHandle);
            this.schedulerIntervalHandle = null;
        }

        postMessage({
            type: 'stopped',
            finalTick: this.currentTick
        });

        console.log(`[TimingWorker] Stopped at tick ${this.currentTick}`);
    }

    /**
     * Look-ahead scheduler
     * Called every SCHEDULER_INTERVAL_MS to schedule upcoming events
     */
    schedule() {
        if (!this.isRunning) return;

        // Get current time from performance.now() (worker's high-res timer)
        const currentTime = performance.now();

        // Schedule all ticks that fall within the look-ahead window
        while (this.nextTickTime < currentTime + LOOKAHEAD_TIME_MS) {
            // Post tick event to main thread with exact timing
            postMessage({
                type: 'tick',
                tick: this.currentTick,
                audioTime: this.nextTickTime,  // When to schedule in audio context
                bpm: this.bpm,
                ppqn: this.ppqn
            });

            // Advance to next tick
            this.nextTickTime += this.tickIntervalMs;
            this.currentTick++;
        }
    }

    /**
     * Set BPM and update tick interval
     */
    setBPM(bpm) {
        if (bpm <= 0 || bpm > 300) {
            console.error('[TimingWorker] Invalid BPM:', bpm);
            return;
        }

        const oldBPM = this.bpm;
        this.bpm = bpm;
        this.updateTickInterval();

        postMessage({
            type: 'tempo-changed',
            bpm: this.bpm,
            previousBPM: oldBPM,
            tickIntervalMs: this.tickIntervalMs
        });

        console.log(`[TimingWorker] Tempo changed: ${oldBPM} → ${this.bpm} BPM`);
    }

    /**
     * Reset tick counter
     */
    reset() {
        this.currentTick = 0;
        this.nextTickTime = performance.now() + this.tickIntervalMs;

        postMessage({
            type: 'reset',
            tick: 0
        });

        console.log('[TimingWorker] Reset to tick 0');
    }
}

// Create scheduler instance
const scheduler = new TimingScheduler();

// Handle messages from main thread
self.addEventListener('message', (event) => {
    const { type, data } = event.data;

    switch (type) {
        case 'start':
            scheduler.start(data.bpm, data.startTimeMs);
            break;

        case 'stop':
            scheduler.stop();
            break;

        case 'set-bpm':
            scheduler.setBPM(data.bpm);
            break;

        case 'reset':
            scheduler.reset();
            break;

        default:
            console.warn('[TimingWorker] Unknown message type:', type);
    }
});

// Signal that worker is ready
postMessage({ type: 'ready' });
console.log('[TimingWorker] Initialized and ready');
