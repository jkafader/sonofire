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
        statusEl.innerHTML = this.getStatusText();
    }

    /**
     * Render UI
     */
    render() {
        this.innerHTML = `
            <div class='sf-component output-control' style="border-left: 3px solid #4ec9b0;">
                <h3 style="margin: 0; color: #4ec9b0;">Output Control</h3>
                <div style='display:flex'>
                    <fieldset>
                        <label>MIDI Output</label>
                        <table>
                            <tr>
                                <th>
                                    Output Device
                                </th>
                                <th>
                                    Enabled
                                </th>
                                <th>
                                    Send&nbsp;Clock
                                </th>
                                <th></th>
                            </tr>
                            <tr>
                                <td>
                                    <select id="midi-device-select" class="sf-select">
                                        ${this.renderMIDIDeviceOptions()}
                                    </select>
                                </td>
                                <td>
                                    <input type="checkbox" id="midi-toggle" ${this.midiEnabled ? 'checked' : ''}>
                                </td>
                                <td>
                                    <input type="checkbox" id="midi-clock-toggle" ${this.midiClockEnabled ? 'checked' : ''}>
                                </td>
                                <td>
                                    <button id='panic-btn'>Notes&nbspOff</button>
                                </td>
                            </tr>
                        </table>
                    </fieldset>

                    <fieldset>
                        <label>WebAudio Output</label>
                        <table>
                            <tr>
                                <th>Enabled
                                </th>
                                <th></th>
                            </tr>
                            <tr>
                                <td>
                                    <input type="checkbox" id="webaudio-toggle" ${this.webAudioEnabled ? 'checked' : ''}>
                                </td>
                                <td>
                                    <button>Notes&nbspOff</button>
                                </td>
                            </tr>
                        </table>
                    </fieldset>

                    <fieldset style='display:none;'>
                        <label>Status</label>
                        <div id="output-status" style='display:flex;'>
                            ${this.getStatusText()}
                        </div>
                    </fieldset>
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
        return `<table>
                    <tr><th>MIDI</th><th>Clock</th><th>WebAudio</th></tr>
                    <tr><td>${midiStatus}</td><td>${clockStatus}</td><td>${webAudioStatus}</td>`;
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
