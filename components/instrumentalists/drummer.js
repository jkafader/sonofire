import { BaseInstrumentalist } from './base_instrumentalist.js';
//import { PubSub } from '../../lib/pubsub.js';

/**
 * Drummer Component
 * Generates locked, repetitive drum grooves
 * The groove is the foundation - it repeats consistently
 */
export class SonofireDrummer extends BaseInstrumentalist {
    constructor() {
        super();

        // Drummer-specific settings
        this.channel = 9;                 // Standard MIDI drum channel
        this.drumStyle = 'rock';          // 'rock', 'jazz', 'funk', 'breakbeat'

        // MIDI drum note numbers (General MIDI standard)
        this.drumNotes = {
            kick: 36,      // Bass Drum 1
            snare: 38,     // Acoustic Snare
            hihat: 42,     // Closed Hi-Hat
            hihatOpen: 46, // Open Hi-Hat
            ride: 51,      // Ride Cymbal 1
            crash: 49,     // Crash Cymbal 1
            tom1: 48,      // Hi Tom
            tom2: 45,      // Low Tom
        };

        // Pattern state
        this.lastTick = -1;
        this.lastStep = -1;  // Track last step played
        this.barCount = 0;
        this.currentPattern = null;

        // Define grooves (16 steps = 16th notes in one bar of 4/4)
        // 1 = hit, 0 = rest
        this.grooves = this.defineGrooves();
    }

    /**
     * Define locked drum grooves
     * Each groove is a fixed pattern that repeats every bar
     * Steps: 0-15 = sixteen 16th notes in 4/4 time
     */
    defineGrooves() {
        return {
            // Basic rock - kick on 1 & 3, snare on 2 & 4, 8th note hi-hats
            rock_basic: {
                kick:   [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
                snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
                hihat:  [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0]
            },

            // Rock with more kicks - classic rock beat
            rock_driving: {
                kick:   [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,1,0],  // Kick on 1, 3, and "and" of 2 & 4
                snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
                hihat:  [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0]
            },

            // Disco/Four-on-floor - kick every quarter note
            disco: {
                kick:   [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],  // Four on the floor
                snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
                hihat:  [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
                hihatOpen: [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0]  // Open on "and" of 2 & 4
            },

            // Funk - syncopated kick, 16th note hi-hats
            funk: {
                kick:   [1,0,0,1, 0,0,1,0, 1,0,1,0, 0,0,1,0],  // Syncopated funk kick
                snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
                hihat:  [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1]   // 16th notes
            },

            // Jazz - ride cymbal pattern (triplet feel approximated)
            jazz_ride: {
                kick:   [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],  // Light kick on 1
                snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],  // Backbeat
                ride:   [1,0,0,1, 0,0,1,0, 0,1,0,0, 1,0,0,1]   // Swing pattern
            },

            // Breakbeat (Amen break inspired)
            breakbeat: {
                kick:   [1,0,0,1, 0,0,0,0, 0,0,1,0, 0,0,0,0],
                snare:  [0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,0,1],
                hihat:  [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0]
            },

            // Sparse - minimal pattern for high spareness
            sparse: {
                kick:   [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
                snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
                hihat:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0]   // Quarter notes only
            },

            // Very sparse - just backbeat
            very_sparse: {
                kick:   [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],  // Only on 1
                snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
                hihat:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]   // No hi-hat when very sparse
            }
        };
    }

    /**
     * Define fill patterns (last beat or two of a bar)
     */
    defineFills() {
        return {
            simple: {
                snare: [0,0,0,0, 0,0,0,0, 0,0,0,0, 1,1,1,1],  // 16th notes on beat 4
                crash: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]   // Crash on next downbeat
            },
            tom_roll: {
                tom1:  [0,0,0,0, 0,0,0,0, 0,0,1,0, 1,0,0,0],
                tom2:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,1,1,1],
                crash: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]
            }
        };
    }

    /**
     * Specify which attributes to observe
     */
    static get observedAttributes() {
        return [
            ...super.observedAttributes,
            'data-drum-style'
        ];
    }

    /**
     * Parse attributes
     */
    parseAttributes() {
        super.parseAttributes();
        this.drumStyle = this.getAttribute('data-drum-style') || 'rock';
    }

    /**
     * Initialize when connected
     */
    connectedCallback() {
        super.connectedCallback();

        // Select initial groove so UI doesn't show "Unknown"
        this.selectGroove();
    }

    /**
     * Setup subscriptions
     */
    setupSubscriptions() {
        super.setupSubscriptions();

        //console.log('Drummer: Setting up subscriptions');

        // Subscribe to clock ticks
        this.subscribe('clock:tick', (data) => {
            //console.log('Drummer: clock:tick callback fired!', data);
            this.handleClockTick(data);
        });

        //console.log('Drummer: Subscribed to clock:tick');

        // TEST: Direct PubSub subscription to compare
        //console.log('Drummer: Also subscribing directly via PubSub');
        /*PubSub.subscribe('clock:tick', (data) => {
            console.log('Drummer: DIRECT PubSub callback fired!', data.tick);
        });*/

        // Subscribe to mood changes (drummer is primary responder)
        this.subscribe('context:mood', (data) => {
            this.mood = data.mood;
            console.log(`Drummer: Mood changed to ${this.mood}, selecting groove`);
            this.selectGroove();
            this.render(); // Update UI
        });

        // Subscribe to spareness changes (drummer is primary responder)
        this.subscribe('context:spareness', (data) => {
            this.spareness = data.spareness;
            console.log(`Drummer: Spareness changed to ${this.spareness.toFixed(2)}`);
            this.selectGroove();
            this.render(); // Update UI
        });
    }

    /**
     * Initialize when connected
     */
    connectedCallback() {
        super.connectedCallback();

        // Register whippable parameters (after render)
        this.registerWhippableParameters();
    }

    /**
     * Register parameters as whip targets
     */
    registerWhippableParameters() {
        // Initialize accent velocity tracking
        this.accentVelocity = 100; // Default accent velocity

        // Register Velocity/Accent parameter
        this.registerWhippableParameter('accent', {
            label: 'Accent/Velocity',
            parameterType: 'number',
            min: 60,
            max: 127,
            icon: '🔊',
            customPosition: 'strong', // Position after component name
            setter: (value) => {
                this.accentVelocity = Math.round(value);
            }
        });

        // Register Groove parameter (select)
        this.registerWhippableParameter('groove', {
            label: 'Groove',
            parameterType: 'select',
            elementSelector: '#groove-select',
            setter: (value) => {
                // Map 0-1 to groove options
                const grooves = Object.keys(this.grooves);
                const index = Math.floor(value * grooves.length);
                const clampedIndex = Math.min(index, grooves.length - 1);
                this.setGroove(grooves[clampedIndex]);
            }
        });

        // Render target lights after component is fully rendered
        requestAnimationFrame(() => {
            this.renderTargetLights();
        });
    }

    /**
     * Select groove based on mood, spareness, and style
     */
    selectGroove() {
        // Spareness overrides everything
        if (this.spareness > 0.8) {
            this.currentPattern = this.grooves.very_sparse;
            return;
        } else if (this.spareness > 0.5) {
            this.currentPattern = this.grooves.sparse;
            return;
        }

        // Map mood + style to groove
        if (this.mood === 'tense') {
            // Tense = driving, busy
            if (this.drumStyle === 'funk') {
                this.currentPattern = this.grooves.funk;
            } else if (this.drumStyle === 'breakbeat') {
                this.currentPattern = this.grooves.breakbeat;
            } else if (this.drumStyle === 'disco') {
                this.currentPattern = this.grooves.disco;
            } else {
                this.currentPattern = this.grooves.rock_driving;
            }
        } else if (this.mood === 'relaxed') {
            // Relaxed = laid back
            if (this.drumStyle === 'jazz') {
                this.currentPattern = this.grooves.jazz_ride;
            } else {
                this.currentPattern = this.grooves.rock_basic;
            }
        } else {
            // Default based on style
            switch (this.drumStyle) {
                case 'jazz':
                    this.currentPattern = this.grooves.jazz_ride;
                    break;
                case 'funk':
                    this.currentPattern = this.grooves.funk;
                    break;
                case 'disco':
                    this.currentPattern = this.grooves.disco;
                    break;
                case 'breakbeat':
                    this.currentPattern = this.grooves.breakbeat;
                    break;
                default:
                    this.currentPattern = this.grooves.rock_basic;
            }
        }
    }

    /**
     * Manually set groove by name
     * @param {string} grooveName - Name of groove (e.g., 'rock_basic', 'funk', etc.)
     */
    setGroove(grooveName) {
        if (this.grooves[grooveName]) {
            this.currentPattern = this.grooves[grooveName];
            console.log(`Drummer: Groove manually set to ${grooveName}`);
            this.render(); // Update UI
        } else {
            console.warn(`Drummer: Unknown groove "${grooveName}"`);
        }
    }

    /**
     * Get current groove name
     * @returns {string} Current groove name
     */
    getCurrentGrooveName() {
        for (const [name, pattern] of Object.entries(this.grooves)) {
            if (pattern === this.currentPattern) {
                return name;
            }
        }
        return 'unknown';
    }

    /**
     * Handle clock tick - play the locked groove
     */
    handleClockTick(clockData) {
        //console.log('Drummer handleClockTick called, enabled:', this.enabled, 'data:', clockData);

        if (!this.enabled) {
            console.log('Drummer: Disabled, returning');
            return;
        }

        const { tick, ppqn } = clockData;

        // Prevent duplicate processing
        //console.log('Drummer: Checking duplicate tick:', tick, 'lastTick:', this.lastTick);
        if (tick === this.lastTick) {
            console.log('Drummer: Duplicate tick, returning');
            return;
        }
        this.lastTick = tick;

        // Select groove on first tick
        if (!this.currentPattern) {
            console.log('Drummer: No pattern, selecting groove');
            this.selectGroove();
        }

        // Calculate position in bar
        const ticksPerBar = ppqn * 4; // 4/4 time
        const tickInBar = tick % ticksPerBar;
        const sixteenthNote = ppqn / 4;
        const stepInBar = Math.floor(tickInBar / sixteenthNote); // 0-15

        //console.log('Drummer: Calculated step:', stepInBar, 'lastStep:', this.lastStep);

        // Only play on the FIRST tick of each step (not every tick)
        if (stepInBar === this.lastStep) {
            //console.log('Drummer: Same step as last, returning');
            return; // Still in the same step, don't play again
        }
        this.lastStep = stepInBar;

        //console.log(`Drummer: Playing step ${stepInBar} (tick ${tick})`);

        // Track bar changes
        if (tickInBar === 0 && tick > 0) {
            this.barCount++;
        }

        // Check for fill (every 8 bars, last beat)
        const barInPhrase = this.barCount % 8;
        const shouldFill = (barInPhrase === 7 && stepInBar >= 12);

        if (shouldFill) {
            this.playFill(stepInBar);
        } else {
            this.playGroove(stepInBar);
        }
    }

    /**
     * Play the current groove pattern (locked, repeating)
     * @param {number} step - Step in bar (0-15)
     */
    playGroove(step) {
        if (!this.currentPattern) {
            console.log('Drummer: No current pattern!');
            return;
        }

        const baseVelocity = this.calculateBaseVelocity();

        //console.log(`Drummer playGroove: step ${step}, pattern:`, this.currentPattern);

        // Play each voice according to the locked pattern
        for (const [voiceName, pattern] of Object.entries(this.currentPattern)) {
            if (pattern[step] === 1) {
                //console.log(`Drummer: Hit ${voiceName} at step ${step}`);
                this.playDrumHit(voiceName, step, baseVelocity);
            }
        }
    }

    /**
     * Play a fill pattern
     * @param {number} step - Step in bar (12-15 typically)
     */
    playFill(step) {
        const fills = this.defineFills();
        const fillPattern = fills.simple;
        const baseVelocity = this.calculateBaseVelocity() + 10;

        for (const [voiceName, pattern] of Object.entries(fillPattern)) {
            if (pattern[step] === 1) {
                this.playDrumHit(voiceName, step, baseVelocity);
            }
        }

        // Crash on downbeat after fill
        if (step === 15) {
            // Next step will be 0, schedule crash
            setTimeout(() => {
                this.playDrumHit('crash', 0, baseVelocity + 15);
            }, 50); // Small delay to align with downbeat
        }
    }

    /**
     * Play a drum hit with velocity humanization
     * @param {string} voiceName - Drum voice name
     * @param {number} step - Current step (for accents)
     * @param {number} baseVelocity - Base velocity
     */
    playDrumHit(voiceName, step, baseVelocity) {
        const note = this.drumNotes[voiceName];
        if (!note) return;

        let velocity = baseVelocity;

        // Voice-specific adjustments
        if (voiceName === 'kick') {
            velocity += 12;
        } else if (voiceName === 'crash') {
            velocity += 20;
        } else if (voiceName === 'ride') {
            velocity -= 5;
        }

        // Accent downbeats (beats 1, 2, 3, 4 = steps 0, 4, 8, 12)
        if (step % 4 === 0) {
            // Use whip-controlled accent velocity or default
            const accentBoost = this.accentVelocity ? (this.accentVelocity - 100) : 10;
            velocity += accentBoost;
        }

        // Humanization - ONLY on velocity (±5), not on whether to play
        const humanization = Math.floor(Math.random() * 10) - 5;
        velocity = Math.max(30, Math.min(127, velocity + humanization));

        // Duration
        let duration = 100;
        if (voiceName === 'crash' || voiceName === 'ride') {
            duration = 500;
        } else if (voiceName === 'hihat') {
            duration = 60;
        } else if (voiceName === 'hihatOpen') {
            duration = 200;
        }

        this.sendNote(note, velocity, duration);
    }

    /**
     * Calculate base velocity from mood
     * @returns {number} Base MIDI velocity
     */
    calculateBaseVelocity() {
        switch (this.mood) {
            case 'tense':
                return 95;
            case 'relaxed':
                return 60;
            case 'sparse':
                return 50;
            case 'dense':
                return 80;
            default:
                return 70;
        }
    }

    /**
     * Render groove selector options
     * @returns {string} HTML options for groove selector
     */
    renderGrooveOptions() {
        const currentGrooveName = this.getCurrentGrooveName();
        const grooveNames = Object.keys(this.grooves);

        return grooveNames.map(name => {
            const displayName = name.replace('_', ' ');
            const selected = name === currentGrooveName ? 'selected' : '';
            return `<option value="${name}" ${selected}>${displayName}</option>`;
        }).join('');
    }

    /**
     * Render UI
     */
    render() {
        const grooveName = this.getCurrentGrooveName().replace('_', ' ');

        this.innerHTML = `
            <div style="background: #2d2d2d; padding: 10px; margin: 5px 0; border-left: 3px solid #d7ba7d;">
                <strong style="color: #d7ba7d;">🥁 Drummer</strong>
                <span style="margin-left: 10px; color: #888;">
                    Channel:
                    <select id="channel-select" style="margin: 0 5px;">
                        ${this.renderChannelOptions()}
                    </select>
                    | Groove:
                    <select id="groove-select" style="margin: 0 5px;">
                        ${this.renderGrooveOptions()}
                    </select>
                    | Mood: ${this.mood}
                    | Sparse: ${(this.spareness * 100).toFixed(0)}%
                    | <button id="mute-btn" style="padding: 2px 8px; margin: 0 5px;">${this.muted ? '🔇 Unmute' : '🔊 Mute'}</button>
                    | <button id="debug-btn" style="padding: 2px 8px; margin: 0 5px;">${this.debug ? '🐛 Debug OFF' : '🐛 Debug'}</button>
                    | ${this.enabled ? '✓ Enabled' : '✗ Disabled'}
                </span>
            </div>
        `;

        // Setup event handlers
        const channelSelect = this.$('#channel-select');
        if (channelSelect) {
            channelSelect.onchange = (e) => {
                this.setChannel(parseInt(e.target.value));
            };
        }

        const grooveSelect = this.$('#groove-select');
        if (grooveSelect) {
            grooveSelect.onchange = (e) => {
                this.setGroove(e.target.value);
            };
        }

        const muteBtn = this.$('#mute-btn');
        if (muteBtn) {
            muteBtn.onclick = () => {
                this.toggleMute();
            };
        }

        const debugBtn = this.$('#debug-btn');
        if (debugBtn) {
            debugBtn.onclick = () => {
                this.toggleDebug();
            };
        }

        // Re-render target lights after DOM update
        requestAnimationFrame(() => {
            this.renderTargetLights();
        });
    }
}

// Register custom element
customElements.define('sonofire-drummer', SonofireDrummer);
