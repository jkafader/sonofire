/**
 * Web Audio Synth - Built-in audio synthesis using Web Audio API
 * Singleton pattern: use `webAudioSynth` export
 *
 * Channel Routing:
 * - Channel 0: Soloist → FM Glockenspiel (bright, clear, metallic pitched percussion)
 *              Alternatives: FM Flute, FM Xylophone, FM Bell (see playNote method)
 * - Channel 1: Bassist → Plucked String (sawtooth with filter envelope)
 * - Channel 2-8: Default synthesis (simple filtered oscillator)
 * - Channel 9: Drummer → Percussion sounds (noise-based synthesis)
 * - Channel 10-15: Default synthesis
 *
 * All channels respond to velocity for both amplitude and timbral brightness.
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

        const now = this.audioContext.currentTime;

        // Route to channel-specific synthesis
        // Channel 0: Soloist (glockenspiel, xylophone, flute, or bell)
        // Channel 1: Bassist (plucked string)
        // Channel 2+: Default synthesis
        if (channel === 0) {
            this.playFMGlockenspiel(key, note, velocity, now);
            // Alternatives:
            // this.playFMXylophone(key, note, velocity, now);
            // this.playFMFlute(key, note, velocity, now);
            // this.playFMBell(key, note, velocity, now);
        } else if (channel === 1) {
            this.playPluckedString(key, note, velocity, now);
        } else {
            this.playDefault(key, note, velocity, now);
        }
    }

    /**
     * FM Flute Synthesis (for Soloist - Channel 0)
     * Breathy, harmonic-rich tone using frequency modulation
     * @param {string} key - Oscillator key (channel-note)
     * @param {number} note - MIDI note number
     * @param {number} velocity - Note velocity (0-127)
     * @param {number} startTime - Start time in audio context
     */
    playFMFlute(key, note, velocity, startTime) {
        const frequency = this.midiNoteToFrequency(note);

        // Non-linear velocity curve for more dynamic range
        const velocityNormalized = velocity / 127;
        const velocityGain = Math.pow(velocityNormalized, 2.2); // Exponential curve (gamma 2.2)

        // FM synthesis: carrier + modulator
        // Modulator frequency ratio for flute-like timbre (brightness)
        const modulatorRatio = 2.0; // 2:1 ratio for flute-like harmonics
        const modulatorFreq = frequency * modulatorRatio;

        // Modulation index (amount of FM) - velocity controls brightness
        const modIndex = 2 + (velocityNormalized * 3); // 2-5 range based on velocity
        const modDepth = modulatorFreq * modIndex;

        // Create modulator oscillator (sine wave)
        const modulator = this.audioContext.createOscillator();
        modulator.type = 'sine';
        modulator.frequency.value = modulatorFreq;

        // Create modulator gain (controls modulation depth)
        const modGain = this.audioContext.createGain();
        modGain.gain.setValueAtTime(modDepth, startTime);
        // Modulation envelope - decays over time for natural sound
        modGain.gain.exponentialRampToValueAtTime(modDepth * 0.3, startTime + 0.5);

        // Create carrier oscillator (sine wave)
        const carrier = this.audioContext.createOscillator();
        carrier.type = 'sine';
        carrier.frequency.value = frequency;

        // Connect modulator → modGain → carrier frequency (FM synthesis)
        modulator.connect(modGain);
        modGain.connect(carrier.frequency);

        // Add subtle noise for breath-like quality
        const noiseBuffer = this.audioContext.createBuffer(1, this.audioContext.sampleRate * 2, this.audioContext.sampleRate);
        const noiseData = noiseBuffer.getChannelData(0);
        for (let i = 0; i < noiseData.length; i++) {
            noiseData[i] = (Math.random() * 2 - 1) * 0.02; // Very quiet noise
        }
        const noise = this.audioContext.createBufferSource();
        noise.buffer = noiseBuffer;
        noise.loop = true;

        const noiseFilter = this.audioContext.createBiquadFilter();
        noiseFilter.type = 'highpass';
        noiseFilter.frequency.value = frequency * 2; // Filter relative to pitch

        const noiseGain = this.audioContext.createGain();
        noiseGain.gain.value = velocityNormalized * 0.1; // Breath increases with velocity (linear for noise)

        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);

        // Create main amplitude envelope
        const gainNode = this.audioContext.createGain();
        gainNode.gain.setValueAtTime(0, startTime);
        // Attack: soft, flute-like
        gainNode.gain.linearRampToValueAtTime(velocityGain * 0.25, startTime + 0.05);
        // Sustain with slight decay
        gainNode.gain.exponentialRampToValueAtTime(velocityGain * 0.2, startTime + 2.0);

        // Connect carrier and noise to output
        carrier.connect(gainNode);
        noiseGain.connect(gainNode);
        gainNode.connect(this.masterGain);

        // Start oscillators
        carrier.start(startTime);
        modulator.start(startTime);
        noise.start(startTime);

        // Store references for note-off
        this.activeOscillators.set(key, {
            oscillator: carrier,
            modulator: modulator,
            noise: noise,
            gainNode: gainNode,
            timestamp: Date.now()
        });
    }

    /**
     * FM Glockenspiel Synthesis (for Soloist - Channel 0)
     * Bright, clear, metallic pitched percussion
     * @param {string} key - Oscillator key (channel-note)
     * @param {number} note - MIDI note number
     * @param {number} velocity - Note velocity (0-127)
     * @param {number} startTime - Start time in audio context
     */
    playFMGlockenspiel(key, note, velocity, startTime) {
        const frequency = this.midiNoteToFrequency(note);

        // Non-linear velocity curve for more dynamic range
        const velocityNormalized = velocity / 127;
        const velocityGain = Math.pow(velocityNormalized, 2.2); // Exponential curve (gamma 2.2)

        // FM synthesis: carrier + modulator
        // Integer modulator ratio for harmonic, pure tone
        const modulatorRatio = 2.0; // 2:1 ratio for harmonic purity with subtle brightness
        const modulatorFreq = frequency * modulatorRatio;

        // Low modulation index for pure tone with subtle brightness
        // Use less aggressive curve for brightness (linear is fine for timbre)
        const modIndex = 1.5 + (velocityNormalized * 2); // 1.5-3.5 range based on velocity
        const modDepth = modulatorFreq * modIndex;

        // Create modulator oscillator (sine wave)
        const modulator = this.audioContext.createOscillator();
        modulator.type = 'sine';
        modulator.frequency.value = modulatorFreq;

        // Create modulator gain (controls modulation depth)
        const modGain = this.audioContext.createGain();
        modGain.gain.setValueAtTime(modDepth, startTime);
        // Gentle modulation decay
        modGain.gain.exponentialRampToValueAtTime(modDepth * 0.3, startTime + 0.4);
        modGain.gain.exponentialRampToValueAtTime(modDepth * 0.01, startTime + 1.5);

        // Create carrier oscillator (sine wave)
        const carrier = this.audioContext.createOscillator();
        carrier.type = 'sine';
        carrier.frequency.value = frequency;

        // Connect modulator → modGain → carrier frequency (FM synthesis)
        modulator.connect(modGain);
        modGain.connect(carrier.frequency);

        // Gentle lowpass filter for warmth without harshness
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = frequency * 6; // Allow harmonics but smooth tone
        filter.Q.value = 0.5; // Very gentle slope

        // Create main amplitude envelope - crisp attack, medium decay
        const gainNode = this.audioContext.createGain();
        gainNode.gain.setValueAtTime(0, startTime);
        // Very fast attack (crisp glockenspiel strike)
        gainNode.gain.linearRampToValueAtTime(velocityGain * 0.4, startTime + 0.003);
        // Medium exponential decay
        gainNode.gain.exponentialRampToValueAtTime(velocityGain * 0.2, startTime + 0.5);
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 1.8);

        // Connect carrier → filter → gain → master
        carrier.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.masterGain);

        // Start oscillators
        carrier.start(startTime);
        modulator.start(startTime);

        // Auto-stop after decay
        carrier.stop(startTime + 1.8);
        modulator.stop(startTime + 1.8);

        // Store references for note-off
        this.activeOscillators.set(key, {
            oscillator: carrier,
            modulator: modulator,
            gainNode: gainNode,
            timestamp: Date.now()
        });
    }

    /**
     * FM Xylophone Synthesis (for Soloist - Channel 0)
     * Bright, percussive, metallic tone using frequency modulation
     * @param {string} key - Oscillator key (channel-note)
     * @param {number} note - MIDI note number
     * @param {number} velocity - Note velocity (0-127)
     * @param {number} startTime - Start time in audio context
     */
    playFMXylophone(key, note, velocity, startTime) {
        const frequency = this.midiNoteToFrequency(note);

        // Non-linear velocity curve for more dynamic range
        const velocityNormalized = velocity / 127;
        const velocityGain = Math.pow(velocityNormalized, 2.2); // Exponential curve (gamma 2.2)

        // FM synthesis: carrier + modulator
        // Higher modulator ratio for bright, metallic xylophone timbre
        const modulatorRatio = 3.5; // 3.5:1 ratio for metallic character
        const modulatorFreq = frequency * modulatorRatio;

        // High modulation index for bright, inharmonic partials
        const modIndex = 8 + (velocityNormalized * 4); // 8-12 range based on velocity
        const modDepth = modulatorFreq * modIndex;

        // Create modulator oscillator (sine wave)
        const modulator = this.audioContext.createOscillator();
        modulator.type = 'sine';
        modulator.frequency.value = modulatorFreq;

        // Create modulator gain (controls modulation depth)
        const modGain = this.audioContext.createGain();
        modGain.gain.setValueAtTime(modDepth, startTime);
        // Fast modulation decay for xylophone "strike" character
        modGain.gain.exponentialRampToValueAtTime(modDepth * 0.01, startTime + 0.15);

        // Create carrier oscillator (sine wave)
        const carrier = this.audioContext.createOscillator();
        carrier.type = 'sine';
        carrier.frequency.value = frequency;

        // Connect modulator → modGain → carrier frequency (FM synthesis)
        modulator.connect(modGain);
        modGain.connect(carrier.frequency);

        // Optional: Resonant filter to emphasize certain partials
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = frequency * 4; // Emphasize 4th partial
        filter.Q.value = 3; // Sharp resonance

        // Create main amplitude envelope - percussive!
        const gainNode = this.audioContext.createGain();
        gainNode.gain.setValueAtTime(0, startTime);
        // Instant attack (percussive strike)
        gainNode.gain.linearRampToValueAtTime(velocityGain * 0.4, startTime + 0.002);
        // Fast exponential decay
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.8);

        // Connect carrier → filter → gain → master
        carrier.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.masterGain);

        // Start oscillators
        carrier.start(startTime);
        modulator.start(startTime);

        // Auto-stop after decay
        carrier.stop(startTime + 0.8);
        modulator.stop(startTime + 0.8);

        // Store references for note-off (though xylophone decays on its own)
        this.activeOscillators.set(key, {
            oscillator: carrier,
            modulator: modulator,
            gainNode: gainNode,
            timestamp: Date.now()
        });
    }

    /**
     * FM Bell Synthesis (for Soloist - Channel 0)
     * Resonant, sustained tone with slow decay using frequency modulation
     * @param {string} key - Oscillator key (channel-note)
     * @param {number} note - MIDI note number
     * @param {number} velocity - Note velocity (0-127)
     * @param {number} startTime - Start time in audio context
     */
    playFMBell(key, note, velocity, startTime) {
        const frequency = this.midiNoteToFrequency(note);

        // Non-linear velocity curve for more dynamic range
        const velocityNormalized = velocity / 127;
        const velocityGain = Math.pow(velocityNormalized, 2.2); // Exponential curve (gamma 2.2)

        // FM synthesis: carrier + modulator
        // Non-integer modulator ratio for inharmonic, bell-like timbre
        const modulatorRatio = 1.4; // 1.4:1 ratio creates bell-like inharmonicity
        const modulatorFreq = frequency * modulatorRatio;

        // High modulation index for rich, complex partials
        const modIndex = 10 + (velocityNormalized * 8); // 10-18 range based on velocity
        const modDepth = modulatorFreq * modIndex;

        // Create modulator oscillator (sine wave)
        const modulator = this.audioContext.createOscillator();
        modulator.type = 'sine';
        modulator.frequency.value = modulatorFreq;

        // Create modulator gain (controls modulation depth)
        const modGain = this.audioContext.createGain();
        modGain.gain.setValueAtTime(modDepth, startTime);
        // Modulation decays faster than amplitude for natural bell sound
        modGain.gain.exponentialRampToValueAtTime(modDepth * 0.1, startTime + 0.3);
        modGain.gain.exponentialRampToValueAtTime(modDepth * 0.01, startTime + 2.0);

        // Create carrier oscillator (sine wave)
        const carrier = this.audioContext.createOscillator();
        carrier.type = 'sine';
        carrier.frequency.value = frequency;

        // Connect modulator → modGain → carrier frequency (FM synthesis)
        modulator.connect(modGain);
        modGain.connect(carrier.frequency);

        // Optional: Gentle lowpass filter to tame harsh high frequencies
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = frequency * 8; // Allow harmonics but tame extremes
        filter.Q.value = 0.7; // Gentle slope

        // Create main amplitude envelope - slow bell decay
        const gainNode = this.audioContext.createGain();
        gainNode.gain.setValueAtTime(0, startTime);
        // Quick but not instant attack (bell strike)
        gainNode.gain.linearRampToValueAtTime(velocityGain * 0.35, startTime + 0.01);
        // Very slow exponential decay (bell resonance)
        gainNode.gain.exponentialRampToValueAtTime(velocityGain * 0.25, startTime + 0.5);
        gainNode.gain.exponentialRampToValueAtTime(velocityGain * 0.1, startTime + 2.0);
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 5.0);

        // Connect carrier → filter → gain → master
        carrier.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.masterGain);

        // Start oscillators
        carrier.start(startTime);
        modulator.start(startTime);

        // Auto-stop after long decay
        carrier.stop(startTime + 5.0);
        modulator.stop(startTime + 5.0);

        // Store references for note-off
        this.activeOscillators.set(key, {
            oscillator: carrier,
            modulator: modulator,
            gainNode: gainNode,
            timestamp: Date.now()
        });
    }

    /**
     * Plucked String Synthesis (for Bassist - Channel 1)
     * Sharp attack with resonant decay
     * @param {string} key - Oscillator key (channel-note)
     * @param {number} note - MIDI note number
     * @param {number} velocity - Note velocity (0-127)
     * @param {number} startTime - Start time in audio context
     */
    playPluckedString(key, note, velocity, startTime) {
        const frequency = this.midiNoteToFrequency(note);

        // Non-linear velocity curve for more dynamic range
        const velocityNormalized = velocity / 127;
        const velocityGain = Math.pow(velocityNormalized, 2.2); // Exponential curve (gamma 2.2)

        // Sawtooth wave for rich harmonic content (string-like)
        const oscillator = this.audioContext.createOscillator();
        oscillator.type = 'sawtooth';
        oscillator.frequency.value = frequency;

        // Filter for brightness control (velocity affects cutoff)
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'lowpass';
        // Higher velocity = brighter sound (higher cutoff)
        const baseCutoff = frequency * 4;
        const cutoffFreq = baseCutoff + (velocityNormalized * frequency * 8);
        filter.frequency.setValueAtTime(cutoffFreq, startTime);
        // Filter envelope - quick decay for pluck character
        filter.frequency.exponentialRampToValueAtTime(baseCutoff * 0.5, startTime + 0.3);
        filter.Q.value = 2; // Slight resonance

        // Amplitude envelope - sharp attack, exponential decay (pluck)
        const gainNode = this.audioContext.createGain();
        gainNode.gain.setValueAtTime(velocityGain * 0.35, startTime);
        // Very fast attack (pluck)
        gainNode.gain.setValueAtTime(velocityGain * 0.35, startTime + 0.001);
        // Exponential decay
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 2.0);

        // Connect: oscillator → filter → gain → master
        oscillator.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.masterGain);

        // Start oscillator
        oscillator.start(startTime);

        // Store reference
        this.activeOscillators.set(key, {
            oscillator,
            gainNode,
            timestamp: Date.now()
        });
    }

    /**
     * Default Synthesis (for other channels)
     * Simple oscillator with velocity-controlled amplitude and brightness
     * @param {string} key - Oscillator key (channel-note)
     * @param {number} note - MIDI note number
     * @param {number} velocity - Note velocity (0-127)
     * @param {number} startTime - Start time in audio context
     */
    playDefault(key, note, velocity, startTime) {
        const frequency = this.midiNoteToFrequency(note);

        // Non-linear velocity curve for more dynamic range
        const velocityNormalized = velocity / 127;
        const velocityGain = Math.pow(velocityNormalized, 2.2); // Exponential curve (gamma 2.2)

        // Create oscillator
        const oscillator = this.audioContext.createOscillator();
        oscillator.type = this.waveform;
        oscillator.frequency.value = frequency;

        // Optional filter for brightness control
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'lowpass';
        // Velocity affects brightness
        filter.frequency.value = 1000 + (velocityNormalized * 3000);
        filter.Q.value = 1;

        // Create gain node with velocity response
        const gainNode = this.audioContext.createGain();
        gainNode.gain.setValueAtTime(0, startTime);
        // Soft attack
        gainNode.gain.linearRampToValueAtTime(velocityGain * 0.3, startTime + 0.02);
        // Sustain
        gainNode.gain.setValueAtTime(velocityGain * 0.3, startTime + 2.0);

        // Connect: oscillator → filter → gain → master
        oscillator.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.masterGain);

        // Start oscillator
        oscillator.start(startTime);

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

        // Non-linear velocity curve for more dynamic range
        const velocityNormalized = velocity / 127;
        const velocityGain = Math.pow(velocityNormalized, 2.2) * 0.5;

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

        // Stop main oscillator after fade
        oscData.oscillator.stop(now + 0.05);

        // Stop modulator if present (FM synthesis)
        if (oscData.modulator) {
            oscData.modulator.stop(now + 0.05);
        }

        // Stop noise source if present (FM synthesis)
        if (oscData.noise) {
            oscData.noise.stop(now + 0.05);
        }

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
        console.log('Web Audio Panic: NUCLEAR OPTION - Killing ALL audio');

        // First, stop all tracked oscillators
        this.activeOscillators.forEach((oscData, key) => {
            try {
                oscData.oscillator.stop();

                // Stop modulator if present (FM synthesis)
                if (oscData.modulator) {
                    oscData.modulator.stop();
                }

                // Stop noise source if present (FM synthesis)
                if (oscData.noise) {
                    oscData.noise.stop();
                }
            } catch (e) {
                // Ignore errors if oscillator already stopped
            }
        });

        this.activeOscillators.clear();

        // NUCLEAR OPTION: Disconnect and reconnect master gain
        // This will kill ANY audio going through, even stuck notes
        if (this.initialized && this.masterGain) {
            console.log('Web Audio Panic: Disconnecting master gain to kill all audio');

            // Disconnect master from destination
            this.masterGain.disconnect();

            // Immediately reconnect it (but all old oscillators will be gone)
            this.masterGain.connect(this.audioContext.destination);

            // Set gain to zero briefly, then restore
            const currentGain = this.masterGain.gain.value;
            this.masterGain.gain.setValueAtTime(0, this.audioContext.currentTime);
            this.masterGain.gain.setValueAtTime(currentGain, this.audioContext.currentTime + 0.01);
        }

        console.log('Web Audio Panic: ALL audio killed and master gain reconnected');
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
