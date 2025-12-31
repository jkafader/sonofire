import { midiOutput } from './midi_output.js';
import { webAudioSynth } from './web_audio_synth.js';

/**
 * Audio Router - Routes audio to MIDI output, Web Audio, or both
 * Singleton pattern: use `audioRouter` export
 */
class AudioRouter {
    constructor() {
        this.midiEnabled = true;
        this.webAudioEnabled = true;
        this.scheduledNotes = new Map(); // Track scheduled note-offs: noteId -> timeoutHandle
        this.noteIdCounter = 0;
    }

    /**
     * Initialize audio outputs
     * @returns {Promise<Object>} Object with {midi: boolean, webAudio: boolean}
     */
    async initialize() {
        const results = {
            midi: false,
            webAudio: false
        };

        // Initialize MIDI
        if (this.midiEnabled) {
            results.midi = await midiOutput.initialize();
            if (!results.midi) {
                console.warn('MIDI initialization failed - MIDI output disabled');
                this.midiEnabled = false;
            }
        }

        // Initialize Web Audio
        if (this.webAudioEnabled) {
            try {
                webAudioSynth.initialize();
                results.webAudio = true;
            } catch (err) {
                console.warn('Web Audio initialization failed - Web Audio disabled');
                this.webAudioEnabled = false;
            }
        }

        console.log('Audio Router initialized:', results);
        return results;
    }

    /**
     * Send a note to enabled outputs
     * @param {number} channel - MIDI channel (0-15)
     * @param {number} note - MIDI note number (0-127)
     * @param {number} velocity - Note velocity (0-127)
     * @param {number} duration - Note duration in milliseconds
     * @returns {string} Note ID (for manual cancellation if needed)
     */
    sendNote(channel, note, velocity = 100, duration = 200) {
        const noteId = `note-${this.noteIdCounter++}`;

        // Send note-on to enabled outputs
        if (this.midiEnabled) {
            midiOutput.sendNoteOn(channel, note, velocity);
        }

        if (this.webAudioEnabled) {
            webAudioSynth.playNote(channel, note, velocity);
        }

        // Schedule note-off after duration
        const timeoutHandle = setTimeout(() => {
            this.stopNote(channel, note);
            this.scheduledNotes.delete(noteId);
        }, duration);

        this.scheduledNotes.set(noteId, {
            timeoutHandle,
            channel,
            note,
            velocity,
            duration,
            startTime: Date.now()
        });

        return noteId;
    }

    /**
     * Stop a note on all enabled outputs
     * @param {number} channel - MIDI channel (0-15)
     * @param {number} note - MIDI note number (0-127)
     */
    stopNote(channel, note) {
        if (this.midiEnabled) {
            midiOutput.sendNoteOff(channel, note);
        }

        if (this.webAudioEnabled) {
            webAudioSynth.stopNote(channel, note);
        }
    }

    /**
     * Cancel a scheduled note by ID
     * @param {string} noteId - Note ID returned from sendNote()
     */
    cancelNote(noteId) {
        const noteData = this.scheduledNotes.get(noteId);
        if (!noteData) {
            return;
        }

        clearTimeout(noteData.timeoutHandle);
        this.stopNote(noteData.channel, noteData.note);
        this.scheduledNotes.delete(noteId);
    }

    /**
     * Panic - Stop all notes on all outputs
     */
    panic() {
        console.log('Audio Router: Panic - stopping all notes');

        // Clear all scheduled note-offs
        this.scheduledNotes.forEach((noteData, noteId) => {
            clearTimeout(noteData.timeoutHandle);
        });
        this.scheduledNotes.clear();

        // Panic on enabled outputs
        if (this.midiEnabled) {
            midiOutput.panic();
        }

        if (this.webAudioEnabled) {
            webAudioSynth.panic();
        }
    }

    /**
     * Enable/disable MIDI output
     * @param {boolean} enabled
     */
    setMIDIEnabled(enabled) {
        this.midiEnabled = enabled;
        console.log('MIDI output', enabled ? 'enabled' : 'disabled');
    }

    /**
     * Enable/disable Web Audio output
     * @param {boolean} enabled
     */
    setWebAudioEnabled(enabled) {
        this.webAudioEnabled = enabled;
        console.log('Web Audio output', enabled ? 'enabled' : 'disabled');
    }

    /**
     * Get current routing configuration
     * @returns {Object} {midi: boolean, webAudio: boolean}
     */
    getConfig() {
        return {
            midi: this.midiEnabled,
            webAudio: this.webAudioEnabled
        };
    }

    /**
     * Get count of scheduled notes
     * @returns {number}
     */
    getScheduledNoteCount() {
        return this.scheduledNotes.size;
    }

    /**
     * Set Web Audio waveform
     * @param {string} waveform - 'sine', 'square', 'sawtooth', 'triangle'
     */
    setWaveform(waveform) {
        webAudioSynth.setWaveform(waveform);
    }

    /**
     * Set Web Audio master volume
     * @param {number} gain - Volume level (0.0 - 1.0)
     */
    setGain(gain) {
        webAudioSynth.setGain(gain);
    }
}

// Export singleton instance
export const audioRouter = new AudioRouter();
