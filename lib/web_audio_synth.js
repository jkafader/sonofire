/**
 * Web Audio Synth - Built-in audio synthesis using Web Audio API
 * Singleton pattern: use `webAudioSynth` export
 */
class WebAudioSynth {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.activeOscillators = new Map(); // "channel-note" -> {oscillator, gainNode, timestamp}
        this.waveform = 'sine'; // 'sine', 'square', 'sawtooth', 'triangle'
        this.masterVolume = 0.3; // 0.0 - 1.0
        this.initialized = false;
    }

    /**
     * Initialize Web Audio API context
     * Note: Must be called after user interaction in many browsers
     */
    initialize() {
        if (this.initialized) {
            return;
        }

        try {
            // Create audio context
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();

            // Create master gain node
            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = this.masterVolume;
            this.masterGain.connect(this.audioContext.destination);

            this.initialized = true;
            console.log('Web Audio Synth initialized');
        } catch (err) {
            console.error('Failed to initialize Web Audio:', err);
        }
    }

    /**
     * Resume audio context if suspended (e.g., due to browser autoplay policy)
     */
    async resume() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
            console.log('Web Audio context resumed');
        }
    }

    /**
     * Convert MIDI note number to frequency in Hz
     * @param {number} midiNote - MIDI note number (0-127)
     * @returns {number} Frequency in Hz
     */
    midiNoteToFrequency(midiNote) {
        // A4 (MIDI note 69) = 440 Hz
        return 440 * Math.pow(2, (midiNote - 69) / 12);
    }

    /**
     * Play a note
     * @param {number} channel - MIDI channel (0-15) - channel 9 is drums
     * @param {number} note - MIDI note number (0-127)
     * @param {number} velocity - Note velocity (0-127)
     */
    playNote(channel, note, velocity = 100) {
        if (!this.initialized) {
            console.warn('Web Audio Synth not initialized. Call initialize() first.');
            return;
        }

        // Ensure context is running
        this.resume();

        // Channel 9 (MIDI channel 10, 0-indexed = 9) is drums
        if (channel === 9) {
            this.playDrumSound(note, velocity);
            return;
        }

        const key = `${channel}-${note}`;

        // Stop existing note if already playing
        if (this.activeOscillators.has(key)) {
            this.stopNote(channel, note);
        }

        // Calculate frequency
        const frequency = this.midiNoteToFrequency(note);

        // Calculate gain from velocity (MIDI velocity 0-127 → gain 0.0-1.0)
        const velocityGain = velocity / 127;

        // Create oscillator
        const oscillator = this.audioContext.createOscillator();
        oscillator.type = this.waveform;
        oscillator.frequency.value = frequency;

        // Create gain node for this note
        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = velocityGain * 0.3; // Scale down to prevent clipping

        // Connect: oscillator → gain → master → destination
        oscillator.connect(gainNode);
        gainNode.connect(this.masterGain);

        // Start oscillator
        oscillator.start();

        // Store active oscillator
        this.activeOscillators.set(key, {
            oscillator,
            gainNode,
            timestamp: Date.now()
        });
    }

    /**
     * Play drum sound (for channel 9)
     * @param {number} note - MIDI note number (drum type)
     * @param {number} velocity - Note velocity (0-127)
     */
    playDrumSound(note, velocity) {
        const now = this.audioContext.currentTime;
        const velocityGain = (velocity / 127) * 0.5;

        // Different drum sounds based on MIDI note number (General MIDI standard)
        switch (note) {
            case 36: // Kick drum
                this.playKick(now, velocityGain);
                break;
            case 38: // Snare
                this.playSnare(now, velocityGain);
                break;
            case 42: // Closed hi-hat
                this.playHiHat(now, velocityGain, 0.05);
                break;
            case 46: // Open hi-hat
                this.playHiHat(now, velocityGain, 0.15);
                break;
            case 49: // Crash cymbal
            case 51: // Ride cymbal
                this.playCymbal(now, velocityGain);
                break;
            case 45: // Low tom
            case 48: // High tom
                this.playTom(now, velocityGain, note === 48 ? 200 : 120);
                break;
            default:
                // Generic percussion sound for unknown drums
                this.playSnare(now, velocityGain * 0.5);
        }
    }

    /**
     * Synthesize kick drum sound
     */
    playKick(startTime, gain) {
        const osc = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        osc.frequency.setValueAtTime(120, startTime);
        osc.frequency.exponentialRampToValueAtTime(40, startTime + 0.1);

        gainNode.gain.setValueAtTime(gain, startTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + 0.3);

        osc.connect(gainNode);
        gainNode.connect(this.masterGain);

        osc.start(startTime);
        osc.stop(startTime + 0.3);
    }

    /**
     * Synthesize snare drum sound
     */
    playSnare(startTime, gain) {
        // Noise component
        const bufferSize = this.audioContext.sampleRate * 0.15;
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = this.audioContext.createBufferSource();
        noise.buffer = buffer;

        const noiseFilter = this.audioContext.createBiquadFilter();
        noiseFilter.type = 'highpass';
        noiseFilter.frequency.value = 1000;

        const noiseGain = this.audioContext.createGain();
        noiseGain.gain.setValueAtTime(gain * 0.7, startTime);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.15);

        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.masterGain);

        noise.start(startTime);

        // Tone component (snare body)
        const osc = this.audioContext.createOscillator();
        osc.frequency.value = 180;

        const oscGain = this.audioContext.createGain();
        oscGain.gain.setValueAtTime(gain * 0.3, startTime);
        oscGain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.1);

        osc.connect(oscGain);
        oscGain.connect(this.masterGain);

        osc.start(startTime);
        osc.stop(startTime + 0.1);
    }

    /**
     * Synthesize hi-hat sound
     */
    playHiHat(startTime, gain, duration) {
        const bufferSize = this.audioContext.sampleRate * duration;
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = this.audioContext.createBufferSource();
        noise.buffer = buffer;

        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 7000;

        const gainNode = this.audioContext.createGain();
        gainNode.gain.setValueAtTime(gain * 0.4, startTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

        noise.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.masterGain);

        noise.start(startTime);
    }

    /**
     * Synthesize cymbal sound
     */
    playCymbal(startTime, gain) {
        const bufferSize = this.audioContext.sampleRate * 0.5;
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = this.audioContext.createBufferSource();
        noise.buffer = buffer;

        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 5000;
        filter.Q.value = 1;

        const gainNode = this.audioContext.createGain();
        gainNode.gain.setValueAtTime(gain * 0.5, startTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + 0.5);

        noise.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.masterGain);

        noise.start(startTime);
    }

    /**
     * Synthesize tom drum sound
     */
    playTom(startTime, gain, frequency) {
        const osc = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        osc.frequency.setValueAtTime(frequency, startTime);
        osc.frequency.exponentialRampToValueAtTime(frequency * 0.5, startTime + 0.15);

        gainNode.gain.setValueAtTime(gain, startTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + 0.2);

        osc.connect(gainNode);
        gainNode.connect(this.masterGain);

        osc.start(startTime);
        osc.stop(startTime + 0.2);
    }

    /**
     * Stop a note
     * @param {number} channel - MIDI channel (0-15)
     * @param {number} note - MIDI note number (0-127)
     */
    stopNote(channel, note) {
        if (!this.initialized) {
            return;
        }

        const key = `${channel}-${note}`;
        const oscData = this.activeOscillators.get(key);

        if (!oscData) {
            return; // Note not playing
        }

        // Apply envelope (quick fade out to avoid clicks)
        const now = this.audioContext.currentTime;
        oscData.gainNode.gain.setValueAtTime(oscData.gainNode.gain.value, now);
        oscData.gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

        // Stop oscillator after fade
        oscData.oscillator.stop(now + 0.05);

        // Remove from active oscillators
        this.activeOscillators.delete(key);
    }

    /**
     * Set waveform type
     * @param {string} waveform - 'sine', 'square', 'sawtooth', 'triangle'
     */
    setWaveform(waveform) {
        const validWaveforms = ['sine', 'square', 'sawtooth', 'triangle'];
        if (!validWaveforms.includes(waveform)) {
            console.error('Invalid waveform:', waveform);
            return;
        }

        this.waveform = waveform;
        console.log('Web Audio waveform set to:', waveform);
    }

    /**
     * Set master volume
     * @param {number} gain - Volume level (0.0 - 1.0)
     */
    setGain(gain) {
        if (gain < 0 || gain > 1) {
            console.error('Invalid gain value:', gain);
            return;
        }

        this.masterVolume = gain;

        if (this.masterGain) {
            this.masterGain.gain.value = gain;
        }

        console.log('Web Audio master volume set to:', gain);
    }

    /**
     * Stop all notes
     */
    panic() {
        console.log('Web Audio Panic: Stopping all oscillators');

        this.activeOscillators.forEach((oscData, key) => {
            oscData.oscillator.stop();
        });

        this.activeOscillators.clear();
    }

    /**
     * Get list of active notes
     * @returns {Array} Array of {channel, note, timestamp}
     */
    getActiveNotes() {
        const notes = [];
        this.activeOscillators.forEach((oscData, key) => {
            const [channel, note] = key.split('-').map(Number);
            notes.push({ channel, note, timestamp: oscData.timestamp });
        });
        return notes;
    }

    /**
     * Check if a specific note is currently active
     * @param {number} channel - MIDI channel
     * @param {number} note - MIDI note number
     * @returns {boolean}
     */
    isNoteActive(channel, note) {
        const key = `${channel}-${note}`;
        return this.activeOscillators.has(key);
    }
}

// Export singleton instance
export const webAudioSynth = new WebAudioSynth();
