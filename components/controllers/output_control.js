import { SonofireBase } from '../base/sonofire_base.js';

/**
 * OutputControl Component
 * Manages audio output routing, MIDI devices, and MIDI clock
 */
export class SonofireOutputControl extends SonofireBase {
    constructor() {
        super();

        // Output state
        this.midiEnabled = true;
        this.midiClockEnabled = false;  // MIDI clock output disabled by default
        this.webAudioEnabled = false;
        this.selectedDeviceIndex = 0;
        this.availableDevices = [];
    }

    /**
     * Parse attributes
     */
    parseAttributes() {
        super.parseAttributes();

        this.midiEnabled = this.getAttribute('data-midi-enabled') !== 'false';
        this.midiClockEnabled = this.getAttribute('data-midi-clock-enabled') === 'true';
        this.webAudioEnabled = this.getAttribute('data-webaudio-enabled') === 'true';
    }

    /**
     * Setup subscriptions
     */
    setupSubscriptions() {
        super.setupSubscriptions();

        // Subscribe to clock events to send MIDI clock messages
        this.subscribe('clock:tick', (data) => {
            if (this.midiClockEnabled) {
                this.sendMIDIClockTick();
            }
        });

        this.subscribe('clock:start', (data) => {
            if (this.midiClockEnabled) {
                this.sendMIDIClockStart();
            }
        });

        this.subscribe('clock:stop', (data) => {
            if (this.midiClockEnabled) {
                this.sendMIDIClockStop();
            }
        });
    }

    /**
     * Initialize when connected
     */
    async connectedCallback() {
        super.connectedCallback();

        // Wait for audioRouter to be available
        if (window.audioRouter) {
            await this.initializeAudio();
        } else {
            // Retry after a delay
            setTimeout(() => this.connectedCallback(), 100);
        }
    }

    /**
     * Initialize audio system
     */
    async initializeAudio() {
        await window.audioRouter.initialize();

        // Set initial state
        window.audioRouter.setMIDIEnabled(this.midiEnabled);
        window.audioRouter.setWebAudioEnabled(this.webAudioEnabled);

        // Populate MIDI devices
        this.populateMIDIDevices();

        // Update status
        this.updateStatus();

        // Re-render after initialization
        this.render();
    }

    /**
     * Populate MIDI device list
     */
    populateMIDIDevices() {
        if (!window.audioRouter) return;

        const midiOutput = window.audioRouter.getMIDIOutput();
        this.availableDevices = midiOutput.getOutputs();
        this.selectedDeviceIndex = midiOutput.getSelectedOutputIndex();

        console.log(`OutputControl: Found ${this.availableDevices.length} MIDI device(s)`);
    }

    /**
     * Toggle MIDI output
     */
    toggleMIDI(enabled) {
        this.midiEnabled = enabled;
        if (window.audioRouter) {
            window.audioRouter.setMIDIEnabled(enabled);
        }
        this.updateStatus();
    }

    /**
     * Toggle MIDI clock output
     */
    toggleMIDIClock(enabled) {
        this.midiClockEnabled = enabled;
        console.log(`MIDI Clock output: ${enabled ? 'enabled' : 'disabled'}`);
        this.render();
    }

    /**
     * Toggle WebAudio output
     */
    toggleWebAudio(enabled) {
        this.webAudioEnabled = enabled;
        if (window.audioRouter) {
            window.audioRouter.setWebAudioEnabled(enabled);
        }
        this.updateStatus();
    }

    /**
     * Select MIDI device
     */
    selectMIDIDevice(index) {
        if (!window.audioRouter) return;

        const midiOutput = window.audioRouter.getMIDIOutput();
        midiOutput.setSelectedOutput(index);
        this.selectedDeviceIndex = index;

        console.log(`MIDI device selected: ${index}`);
    }

    /**
     * Trigger panic (all notes off)
     */
    async panic() {
        console.log('🚨 PANIC triggered');
        if (window.audioRouter) {
            await window.audioRouter.panic();
        }
        console.log('🚨 PANIC completed');
    }

    /**
     * Send MIDI clock tick
     */
    sendMIDIClockTick() {
        if (!window.audioRouter) return;

        const midiOutput = window.audioRouter.getMIDIOutput();
        midiOutput.sendClockTick();
    }

    /**
     * Send MIDI clock start
     */
    sendMIDIClockStart() {
        if (!window.audioRouter) return;

        const midiOutput = window.audioRouter.getMIDIOutput();
        midiOutput.sendClockStart();
    }

    /**
     * Send MIDI clock stop
     */
    sendMIDIClockStop() {
        if (!window.audioRouter) return;

        const midiOutput = window.audioRouter.getMIDIOutput();
        midiOutput.sendClockStop();
    }

    /**
     * Update status display
     */
    updateStatus() {
        const statusEl = this.$('#output-status');
        if (!statusEl) return;

        const midiStatus = this.midiEnabled ? 'ON' : 'OFF';
        const clockStatus = this.midiClockEnabled ? 'ON' : 'OFF';
        const webAudioStatus = this.webAudioEnabled ? 'ON' : 'OFF';

        statusEl.textContent = `MIDI: ${midiStatus}, Clock: ${clockStatus}, WebAudio: ${webAudioStatus}`;
    }

    /**
     * Render UI
     */
    render() {
        this.innerHTML = `
            <div style="background: #2d2d2d; padding: 15px; margin: 10px 0; border-left: 3px solid #4ec9b0;">
                <h3 style="margin: 0 0 10px 0; color: #4ec9b0;">🎛️ Output Control</h3>

                <div style="display: flex; align-items: center; gap: 15px; flex-wrap: wrap; margin-bottom: 10px;">
                    <!-- MIDI Output Toggle -->
                    <label>
                        <input type="checkbox" id="midi-toggle" ${this.midiEnabled ? 'checked' : ''}>
                        MIDI Output
                    </label>

                    <!-- MIDI Device Selector -->
                    <label>
                        MIDI Device:
                        <select id="midi-device-select" style="margin-left: 5px; padding: 4px; background: #3c3c3c; color: #d4d4d4; border: 1px solid #555;">
                            ${this.renderMIDIDeviceOptions()}
                        </select>
                    </label>

                    <!-- MIDI Clock Toggle -->
                    <label title="Send MIDI clock messages (0xF8) to external devices">
                        <input type="checkbox" id="midi-clock-toggle" ${this.midiClockEnabled ? 'checked' : ''}>
                        MIDI Clock
                    </label>

                    <!-- WebAudio Toggle -->
                    <label>
                        <input type="checkbox" id="webaudio-toggle" ${this.webAudioEnabled ? 'checked' : ''}>
                        WebAudio Output
                    </label>

                    <!-- Panic Button -->
                    <button class="panic" id="panic-btn" style="background: #d32f2f; font-weight: bold; padding: 8px 16px; margin-left: 10px;">
                        🚨 PANIC
                    </button>
                </div>

                <!-- Status Display -->
                <div id="output-status" style="padding: 8px; background: #252526; font-family: monospace; font-size: 12px; border-radius: 4px;">
                    ${this.getStatusText()}
                </div>
            </div>
        `;

        this.setupEventHandlers();
    }

    /**
     * Render MIDI device options
     */
    renderMIDIDeviceOptions() {
        if (this.availableDevices.length === 0) {
            return '<option value="-1">Loading...</option>';
        }

        return this.availableDevices.map(device => {
            const selected = device.index === this.selectedDeviceIndex ? 'selected' : '';
            const label = `${device.name}${device.manufacturer ? ` (${device.manufacturer})` : ''}`;
            return `<option value="${device.index}" ${selected}>${label}</option>`;
        }).join('');
    }

    /**
     * Get status text
     */
    getStatusText() {
        const midiStatus = this.midiEnabled ? 'ON' : 'OFF';
        const clockStatus = this.midiClockEnabled ? 'ON' : 'OFF';
        const webAudioStatus = this.webAudioEnabled ? 'ON' : 'OFF';
        return `MIDI: ${midiStatus}, Clock: ${clockStatus}, WebAudio: ${webAudioStatus}`;
    }

    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        // MIDI toggle
        const midiToggle = this.$('#midi-toggle');
        if (midiToggle) {
            midiToggle.onchange = (e) => {
                this.toggleMIDI(e.target.checked);
            };
        }

        // MIDI Clock toggle
        const midiClockToggle = this.$('#midi-clock-toggle');
        if (midiClockToggle) {
            midiClockToggle.onchange = (e) => {
                this.toggleMIDIClock(e.target.checked);
            };
        }

        // WebAudio toggle
        const webAudioToggle = this.$('#webaudio-toggle');
        if (webAudioToggle) {
            webAudioToggle.onchange = (e) => {
                this.toggleWebAudio(e.target.checked);
            };
        }

        // MIDI device selector
        const deviceSelect = this.$('#midi-device-select');
        if (deviceSelect) {
            deviceSelect.onchange = (e) => {
                this.selectMIDIDevice(parseInt(e.target.value));
            };
        }

        // Panic button
        const panicBtn = this.$('#panic-btn');
        if (panicBtn) {
            panicBtn.onclick = () => {
                this.panic();
            };
        }
    }
}

// Register custom element
customElements.define('sonofire-output-control', SonofireOutputControl);
