/**
 * MIDI Output Service - Manages Web MIDI API output
 * Singleton pattern: use `midiOutput` export
 */
class MIDIOutputService {
    constructor() {
        this.midiAccess = null;
        this.outputs = [];
        this.activeNotes = new Map(); // Track note-on events: "channel-note" -> {channel, note, velocity, timestamp}
        this.initialized = false;
    }

    /**
     * Initialize Web MIDI API access
     * @returns {Promise<boolean>} True if MIDI access granted
     */
    async initialize() {
        if (this.initialized) {
            return true;
        }

        if (!navigator.requestMIDIAccess) {
            console.error('Web MIDI API not supported in this browser');
            return false;
        }

        try {
            this.midiAccess = await navigator.requestMIDIAccess();
            this.outputs = Array.from(this.midiAccess.outputs.values());

            console.log('MIDI Output initialized');
            console.log(`Found ${this.outputs.length} MIDI output(s):`);
            this.outputs.forEach((output, index) => {
                console.log(`  [${index}] ${output.name} (${output.manufacturer})`);
            });

            this.initialized = true;
            return true;
        } catch (err) {
            console.error('MIDI access denied:', err);
            return false;
        }
    }

    /**
     * Send MIDI note-on message
     * @param {number} channel - MIDI channel (0-15)
     * @param {number} note - MIDI note number (0-127)
     * @param {number} velocity - Note velocity (0-127)
     */
    sendNoteOn(channel, note, velocity = 100) {
        if (!this.initialized) {
            console.warn('MIDI Output not initialized. Call initialize() first.');
            return;
        }

        // Validate parameters
        if (channel < 0 || channel > 15) {
            console.error('Invalid MIDI channel:', channel);
            return;
        }
        if (note < 0 || note > 127) {
            console.error('Invalid MIDI note:', note);
            return;
        }
        if (velocity < 0 || velocity > 127) {
            console.error('Invalid MIDI velocity:', velocity);
            return;
        }

        const header = 0x90; // Note On
        const message = [header + channel, note, velocity];

        // Send to all outputs
        this.outputs.forEach(output => {
            output.send(message);
        });

        // Track active note
        const key = `${channel}-${note}`;
        this.activeNotes.set(key, {
            channel,
            note,
            velocity,
            timestamp: Date.now()
        });
    }

    /**
     * Send MIDI note-off message
     * @param {number} channel - MIDI channel (0-15)
     * @param {number} note - MIDI note number (0-127)
     */
    sendNoteOff(channel, note) {
        if (!this.initialized) {
            console.warn('MIDI Output not initialized. Call initialize() first.');
            return;
        }

        // Validate parameters
        if (channel < 0 || channel > 15) {
            console.error('Invalid MIDI channel:', channel);
            return;
        }
        if (note < 0 || note > 127) {
            console.error('Invalid MIDI note:', note);
            return;
        }

        const header = 0x80; // Note Off
        const message = [header + channel, note, 0];

        // Send to all outputs
        this.outputs.forEach(output => {
            output.send(message);
        });

        // Remove from active notes
        const key = `${channel}-${note}`;
        this.activeNotes.delete(key);
    }

    /**
     * Send control change message
     * @param {number} channel - MIDI channel (0-15)
     * @param {number} controller - Controller number (0-127)
     * @param {number} value - Controller value (0-127)
     */
    sendControlChange(channel, controller, value) {
        if (!this.initialized) {
            console.warn('MIDI Output not initialized. Call initialize() first.');
            return;
        }

        const header = 0xB0; // Control Change
        const message = [header + channel, controller, value];

        this.outputs.forEach(output => {
            output.send(message);
        });
    }

    /**
     * All notes off - Send note-off for all active notes
     * Attempts to initialize MIDI if not already initialized to kill stuck notes
     */
    async panic() {
        console.log('MIDI Panic: Attempting to kill all MIDI notes');

        // Try to initialize MIDI if not already initialized
        // This handles the case where notes got stuck but MIDI wasn't fully initialized
        if (!this.initialized) {
            try {
                console.log('MIDI Panic: Initializing MIDI to send note-offs...');
                await this.initialize();
            } catch (e) {
                console.warn('MIDI Panic: Could not initialize MIDI', e);
            }
        }

        // Send note-off for ALL possible notes (0-127) on ALL channels (0-15)
        // This ensures stuck notes are turned off even if they weren't tracked
        if (this.outputs && this.outputs.length > 0) {
            for (let channel = 0; channel < 16; channel++) {
                for (let note = 0; note < 128; note++) {
                    this.sendNoteOff(channel, note);
                }

                // Also send MIDI CC messages for good measure
                this.sendControlChange(channel, 121, 0); // All Notes Off
                this.sendControlChange(channel, 123, 0); // All Sound Off
            }
            console.log('MIDI Panic: Sent note-off for all 128 notes on all 16 channels');
        } else {
            console.warn('MIDI Panic: No MIDI outputs available after initialization attempt');
        }

        // Always clear tracked active notes, even if MIDI isn't connected
        this.activeNotes.clear();
    }

    /**
     * Get list of active notes
     * @returns {Array} Array of active note objects
     */
    getActiveNotes() {
        return Array.from(this.activeNotes.values());
    }

    /**
     * Check if a specific note is currently active
     * @param {number} channel - MIDI channel
     * @param {number} note - MIDI note number
     * @returns {boolean}
     */
    isNoteActive(channel, note) {
        const key = `${channel}-${note}`;
        return this.activeNotes.has(key);
    }
}

// Export singleton instance
export const midiOutput = new MIDIOutputService();
