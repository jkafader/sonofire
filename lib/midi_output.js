/**
 * MIDI Output Service - Manages Web MIDI API output
 * Singleton pattern: use `midiOutput` export
 */
class MIDIOutputService {
    constructor() {
        this.midiAccess = null;
        this.outputs = [];
        this.selectedOutputIndex = 0; // Default to first output
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

        // Send to selected output only
        const selectedOutput = this.getSelectedOutput();
        if (selectedOutput) {
            selectedOutput.send(message);
        }

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

        // Send to selected output only
        const selectedOutput = this.getSelectedOutput();
        if (selectedOutput) {
            selectedOutput.send(message);
        }

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

        // Send to selected output only
        const selectedOutput = this.getSelectedOutput();
        if (selectedOutput) {
            selectedOutput.send(message);
        }
    }

    /**
     * Send MIDI Clock Tick (0xF8)
     * Should be sent 24 times per quarter note
     */
    sendClockTick() {
        if (!this.initialized) return;

        const selectedOutput = this.getSelectedOutput();
        if (selectedOutput) {
            selectedOutput.send([0xF8]);
        }
    }

    /**
     * Send MIDI Clock Start (0xFA)
     */
    sendClockStart() {
        if (!this.initialized) return;

        const selectedOutput = this.getSelectedOutput();
        if (selectedOutput) {
            selectedOutput.send([0xFA]);
        }
        console.log('MIDI Clock: Sent Start (0xFA)');
    }

    /**
     * Send MIDI Clock Stop (0xFC)
     */
    sendClockStop() {
        if (!this.initialized) return;

        const selectedOutput = this.getSelectedOutput();
        if (selectedOutput) {
            selectedOutput.send([0xFC]);
        }
        console.log('MIDI Clock: Sent Stop (0xFC)');
    }

    /**
     * Send MIDI Clock Continue (0xFB)
     */
    sendClockContinue() {
        if (!this.initialized) return;

        const selectedOutput = this.getSelectedOutput();
        if (selectedOutput) {
            selectedOutput.send([0xFB]);
        }
        console.log('MIDI Clock: Sent Continue (0xFB)');
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

    /**
     * Get list of available MIDI outputs
     * @returns {Array} Array of output objects with name and manufacturer
     */
    getOutputs() {
        if (!this.initialized) {
            return [];
        }

        return this.outputs.map((output, index) => ({
            index: index,
            name: output.name,
            manufacturer: output.manufacturer,
            id: output.id
        }));
    }

    /**
     * Get the currently selected output device
     * @returns {MIDIOutput|null}
     */
    getSelectedOutput() {
        if (!this.initialized || this.outputs.length === 0) {
            return null;
        }

        // Clamp to valid range
        const index = Math.max(0, Math.min(this.selectedOutputIndex, this.outputs.length - 1));
        return this.outputs[index];
    }

    /**
     * Set the selected output device by index
     * @param {number} index - Index of output device
     */
    setSelectedOutput(index) {
        if (!this.initialized) {
            console.warn('MIDI Output not initialized. Call initialize() first.');
            return;
        }

        if (index < 0 || index >= this.outputs.length) {
            console.error(`Invalid output index: ${index}. Must be 0-${this.outputs.length - 1}`);
            return;
        }

        this.selectedOutputIndex = index;
        const output = this.outputs[index];
        console.log(`MIDI Output device set to: [${index}] ${output.name} (${output.manufacturer})`);
    }

    /**
     * Get the currently selected output device index
     * @returns {number}
     */
    getSelectedOutputIndex() {
        return this.selectedOutputIndex;
    }
}

// Export singleton instance
export const midiOutput = new MIDIOutputService();
