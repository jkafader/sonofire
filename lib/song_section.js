import { PubSub } from './pubsub.js';
import { layerManager } from './layer_manager.js';
import { contourBindingManager } from './contour_binding_manager.js';
import { WhipManager } from './whip_manager.js';
import { harmonicContext } from './harmonic_context.js';

/**
 * SongSection - Serializes and restores complete Sonofire state
 *
 * Captures:
 * - Harmonic context (pool, tonic, scale type, tempo, time signature, mood, density)
 * - Layers (data and transform layers with outputData)
 * - Playheads (positions, speeds, layer assignments, colors)
 * - Contour bindings (layer → parameter mappings)
 * - Whip bindings (playhead → parameter mappings)
 * - Planner state (melody, rhythm planners with their generated output)
 * - Composer state (style, progression, dot notation)
 * - Instrumentalist settings (all parameters and bindings)
 * - Visualizer states (Y-zoom levels)
 *
 * Ensures correct initialization order on restore.
 */
export class SongSection {
    constructor(name = 'Untitled Section') {
        this.id = `section-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.name = name;
        this.version = '1.0.0';
        this.timestamp = Date.now();
        this.state = {};
    }

    /**
     * Capture current state from all components
     */
    async capture() {
        console.log('[SongSection] Capturing current state...');

        this.timestamp = Date.now();

        // 1. Harmonic Context
        this.state.harmonicContext = {
            poolKey: PubSub.last('context:pool')?.poolKey,
            tonicName: PubSub.last('context:pool')?.tonicName,
            tonicNote: PubSub.last('context:pool')?.tonicNote,
            scaleType: PubSub.last('context:pool')?.scaleType,
            tempo: PubSub.last('clock:tempo')?.bpm,
            timeSignature: PubSub.last('context:timeSignature')?.timeSignature,
            beatsPerBar: PubSub.last('context:timeSignature')?.beatsPerBar,
            sixteenthsPerBar: PubSub.last('context:timeSignature')?.sixteenthsPerBar,
            mood: PubSub.last('context:mood')?.mood,
            density: PubSub.last('context:density')?.density
        };

        // NOTE: Layers and Playheads are NOT saved in sections
        // They persist via their own localStorage mechanism and are independent of sections

        // Get visualizer IDs for later use (visualizer states)
        const visualizerIds = this.findAllVisualizerIds();

        // 2. Contour Bindings
        this.state.contourBindings = Array.from(contourBindingManager.bindings.values())
            .map(b => b.toJSON());

        // 3. Whip Bindings
        const whipState = PubSub.last('whip:bindings:state');
        this.state.whipBindings = whipState?.bindings || [];

        // 4. Planners
        this.state.planners = {};

        // Melody Planner
        const melodyPlanner = document.querySelector('sonofire-melody-planner');
        if (melodyPlanner) {
            this.state.planners.melody = {
                poolKey: melodyPlanner.poolKey,
                tonicNote: melodyPlanner.tonicNote,
                scaleType: melodyPlanner.scaleType,
                phraseLength: melodyPlanner.phraseLength,
                resolution: melodyPlanner.resolution,
                melody: JSON.parse(JSON.stringify(melodyPlanner.melody)), // Deep copy
                // Note: Contour bindings are captured separately above
            };
        }

        // Rhythm Planner
        const rhythmPlanner = document.querySelector('sonofire-rhythm-planner');
        if (rhythmPlanner) {
            this.state.planners.rhythm = {
                beatsPerBar: rhythmPlanner.beatsPerBar,
                division: rhythmPlanner.division,
                swing: rhythmPlanner.swing,
                density: rhythmPlanner.density,
                pattern: rhythmPlanner.pattern ? JSON.parse(JSON.stringify(rhythmPlanner.pattern)) : null,
                // Note: Contour bindings are captured separately above
            };
        }

        // 5. Composer
        const composer = document.querySelector('sonofire-composer');
        if (composer) {
            this.state.composer = {
                compositionStyle: composer.compositionStyle,
                progression: JSON.parse(JSON.stringify(composer.progression)), // Deep copy
                progressionIndex: composer.progressionIndex,
                progressionLength: composer.progressionLength,
                beatsPerBar: composer.beatsPerBar,
                barsPerChord: composer.barsPerChord,
                useProbabilistic: composer.useProbabilistic,
                probabilityMatrix: composer.probabilityMatrix ? JSON.parse(JSON.stringify(composer.probabilityMatrix)) : null,
                voicingType: composer.voicingType,
                progressionStyle: composer.progressionStyle,
                // Dot notation progression
                dotNotationProgression: composer.serializeProgressionToDotNotation?.() || null
            };
        }

        // 6. Instrumentalists
        this.state.instrumentalists = {};

        // Bassist
        const bassist = document.querySelector('sonofire-bassist');
        if (bassist) {
            this.state.instrumentalists.bassist = {
                motionType: bassist.motionType,
                rhythmPattern: bassist.rhythmPattern,
                transpose: bassist.transpose,
                humanizationEnabled: bassist.humanizationEnabled,
                humanizationIntensity: bassist.humanizationIntensity,
                muted: bassist.muted
            };
        }

        // Drummer
        const drummer = document.querySelector('sonofire-drummer');
        if (drummer) {
            this.state.instrumentalists.drummer = {
                drumStyle: drummer.drumStyle,
                humanizationEnabled: drummer.humanizationEnabled,
                humanizationIntensity: drummer.humanizationIntensity,
                swingAmount: drummer.swingAmount,
                muted: drummer.muted
            };
        }

        // Soloist
        const soloist = document.querySelector('sonofire-soloist');
        if (soloist) {
            this.state.instrumentalists.soloist = {
                playingStyle: soloist.playingStyle,
                noteRange: soloist.noteRange,
                maxInterval: soloist.maxInterval,
                humanizationEnabled: soloist.humanizationEnabled,
                humanizationIntensity: soloist.humanizationIntensity,
                muted: soloist.muted
            };
        }

        // Keyboardist
        const keyboardist = document.querySelector('sonofire-keyboardist');
        if (keyboardist) {
            this.state.instrumentalists.keyboardist = {
                instrumentStyle: keyboardist.instrumentStyle,
                playingApproach: keyboardist.playingApproach,
                humanizationEnabled: keyboardist.humanizationEnabled,
                humanizationIntensity: keyboardist.humanizationIntensity,
                muted: keyboardist.muted
            };
        }

        // 9. Visualizer States (Y-zoom)
        this.state.visualizerStates = {};
        visualizerIds.forEach(vizId => {
            const viz = document.getElementById(vizId);
            if (viz) {
                this.state.visualizerStates[vizId] = {
                    yZoomLevel: viz.yZoomLevel,
                    yZoomCenter: viz.yZoomCenter
                };
            }
        });

        console.log('[SongSection] State captured:', this.state);
        console.log('[SongSection] Melody Planner state:', this.state.planners?.melody);
        console.log('[SongSection] Composer state:', this.state.composer);

        return this;
    }

    /**
     * Restore state to all components
     * Order is critical: harmonic context → layers → playheads → bindings → planners → composer → instrumentalists
     */
    async restore() {
        console.log('[SongSection] Restoring state...', this.state);

        // Broadcast section loading start - components will pause their subscriptions
        PubSub.publish('section:loading:start', {});
        console.log('[SongSection] Published section:loading:start');

        // 1. Harmonic Context (FIRST - others depend on this)
        if (this.state.harmonicContext) {
            const hc = this.state.harmonicContext;

            if (hc.poolKey && hc.tonicNote) {
                harmonicContext.setPoolAndTonic(
                    hc.poolKey,
                    hc.tonicNote,
                    hc.tonicName,
                    hc.scaleType || 'diatonic'
                );
            }

            if (hc.tempo) {
                PubSub.publish('context:tempo', { bpm: hc.tempo });
            }

            if (hc.timeSignature) {
                PubSub.publish('context:timeSignature', {
                    timeSignature: hc.timeSignature,
                    beatsPerBar: hc.beatsPerBar,
                    sixteenthsPerBar: hc.sixteenthsPerBar
                });
            }

            if (hc.mood) {
                PubSub.publish('context:mood', { mood: hc.mood });
            }

            if (hc.density !== undefined) {
                PubSub.publish('context:density', { density: hc.density });
            }
        }

        // NOTE: Layers and Playheads are NOT restored from sections
        // They persist via their own localStorage mechanism and are independent of sections

        // 2. Whip Bindings (SECOND - before contour bindings, planners need them)
        if (this.state.whipBindings && this.state.whipBindings.length > 0) {
            PubSub.publish('whip:bindings:state', {
                bindings: this.state.whipBindings,
                timestamp: this.timestamp
            });
            // WhipManager will restore these automatically
            WhipManager.restoreBindings();
        }

        // 3. Contour Bindings (THIRD - depend on parameters)
        if (this.state.contourBindings && this.state.contourBindings.length > 0) {
            PubSub.publish('contour:bindings:state', {
                bindings: this.state.contourBindings,
                timestamp: this.timestamp
            });
            // ContourBindingManager will restore these automatically
            contourBindingManager.restoreBindings();
        }

        // 4. Planners (FOURTH - depend on harmonic context and bindings)
        if (this.state.planners) {
            // Melody Planner
            if (this.state.planners.melody) {
                const melodyPlanner = document.querySelector('sonofire-melody-planner');
                if (melodyPlanner) {
                    const mp = this.state.planners.melody;

                    // Restore properties silently (no publish, no render)
                    console.log('[SongSection] Restoring melody planner:', mp);
                    melodyPlanner.poolKey = mp.poolKey;
                    melodyPlanner.tonicNote = mp.tonicNote;
                    melodyPlanner.scaleType = mp.scaleType;
                    melodyPlanner.phraseLength = mp.phraseLength;
                    melodyPlanner.resolution = mp.resolution;
                    melodyPlanner.melody = JSON.parse(JSON.stringify(mp.melody)); // Deep copy

                    // Update scale (internal state only, no render)
                    if (melodyPlanner.updateScale) {
                        melodyPlanner.updateScale();
                    }

                    // Don't publish or render during restore - will happen after section:loading:complete

                    console.log('[SongSection] Melody planner restored');
                }
            }

            // Rhythm Planner
            if (this.state.planners.rhythm) {
                const rhythmPlanner = document.querySelector('sonofire-rhythm-planner');
                if (rhythmPlanner) {
                    const rp = this.state.planners.rhythm;

                    // Restore properties silently (no publish, no render)
                    rhythmPlanner.beatsPerBar = rp.beatsPerBar;
                    rhythmPlanner.division = rp.division;
                    rhythmPlanner.swing = rp.swing;
                    rhythmPlanner.density = rp.density;
                    rhythmPlanner.pattern = rp.pattern ? JSON.parse(JSON.stringify(rp.pattern)) : null;

                    // Don't publish or render during restore - will happen after section:loading:complete

                    console.log('[SongSection] Rhythm planner restored');
                }
            }
        }

        // 5. Composer (FIFTH - depends on harmonic context and planners)
        if (this.state.composer) {
            const composer = document.querySelector('sonofire-composer');
            if (composer) {
                const c = this.state.composer;

                // Restore composition style
                if (c.compositionStyle) {
                    composer.compositionStyle = c.compositionStyle;
                }

                // Restore progression
                if (c.progression) {
                    composer.progression = JSON.parse(JSON.stringify(c.progression));
                    composer.progressionIndex = c.progressionIndex || 0;
                    composer.progressionLength = c.progressionLength || c.progression.length;
                }

                if (c.beatsPerBar) {
                    composer.beatsPerBar = c.beatsPerBar;
                }

                if (c.barsPerChord) {
                    composer.barsPerChord = c.barsPerChord;
                }

                if (c.useProbabilistic !== undefined) {
                    composer.useProbabilistic = c.useProbabilistic;
                }

                if (c.voicingType) {
                    composer.voicingType = c.voicingType;
                }

                if (c.progressionStyle) {
                    composer.progressionStyle = c.progressionStyle;
                }

                // Restore dot notation progression
                if (c.dotNotationProgression && composer.parseDotNotationProgression) {
                    composer.parseDotNotationProgression(c.dotNotationProgression);
                }

                // Don't render during restore - will happen after section:loading:complete
            }
        }

        // 6. Instrumentalists (SIXTH - depend on everything else)
        if (this.state.instrumentalists) {
            // Bassist
            if (this.state.instrumentalists.bassist) {
                const bassist = document.querySelector('sonofire-bassist');
                if (bassist) {
                    Object.assign(bassist, this.state.instrumentalists.bassist);
                    // Don't render during restore
                }
            }

            // Drummer
            if (this.state.instrumentalists.drummer) {
                const drummer = document.querySelector('sonofire-drummer');
                if (drummer) {
                    Object.assign(drummer, this.state.instrumentalists.drummer);
                    // Don't render during restore
                }
            }

            // Soloist
            if (this.state.instrumentalists.soloist) {
                const soloist = document.querySelector('sonofire-soloist');
                if (soloist) {
                    Object.assign(soloist, this.state.instrumentalists.soloist);
                    // Don't render during restore
                }
            }

            // Keyboardist
            if (this.state.instrumentalists.keyboardist) {
                const keyboardist = document.querySelector('sonofire-keyboardist');
                if (keyboardist) {
                    Object.assign(keyboardist, this.state.instrumentalists.keyboardist);
                    // Don't render during restore
                }
            }
        }

        // 7. Visualizer States (LAST - visual preferences, Y-zoom only)
        if (this.state.visualizerStates) {
            for (const [vizId, vizState] of Object.entries(this.state.visualizerStates)) {
                const viz = document.getElementById(vizId);
                if (viz && vizState.yZoomLevel !== undefined) {
                    viz.yZoomLevel = vizState.yZoomLevel;
                    viz.yZoomCenter = vizState.yZoomCenter;
                    // Don't call updateYDomainFromZoom() - the upcoming render() from
                    // resumeSubscriptions() will handle it. Calling it here causes double render.
                }
            }
        }

        // Broadcast section loading complete - components will resume their subscriptions
        PubSub.publish('section:loading:complete', {});
        console.log('[SongSection] Published section:loading:complete');

        console.log('[SongSection] State restored successfully');
    }

    /**
     * Serialize to JSON object
     */
    toJSON() {
        return {
            id: this.id,
            name: this.name,
            version: this.version,
            timestamp: this.timestamp,
            state: this.state
        };
    }

    /**
     * Deserialize from JSON object
     */
    static fromJSON(json) {
        const section = new SongSection(json.name);
        section.id = json.id;
        section.version = json.version;
        section.timestamp = json.timestamp;
        section.state = json.state;
        return section;
    }

    /**
     * Save to PubSub (for persistence via PubSub's localStorage mechanism)
     */
    saveToPubSub(key = 'sonofire-current-section') {
        const json = this.toJSON();
        PubSub.publish(key, json);
        console.log(`[SongSection] Saved to PubSub: ${key}`);
        return this;
    }

    /**
     * Load from PubSub
     */
    static loadFromPubSub(key = 'sonofire-current-section') {
        const json = PubSub.last(key);
        if (!json) {
            console.warn(`[SongSection] No saved state found in PubSub: ${key}`);
            return null;
        }

        try {
            const section = SongSection.fromJSON(json);
            console.log(`[SongSection] Loaded from PubSub: ${key}`);
            return section;
        } catch (error) {
            console.error('[SongSection] Failed to parse saved state:', error);
            return null;
        }
    }

    /**
     * Save to localStorage directly
     */
    saveToLocalStorage(key = 'sonofire-current-section') {
        const json = this.toJSON();
        localStorage.setItem(key, JSON.stringify(json));
        console.log(`[SongSection] Saved to localStorage: ${key}`);
        return this;
    }

    /**
     * Load from localStorage
     */
    static loadFromLocalStorage(key = 'sonofire-current-section') {
        const json = localStorage.getItem(key);
        if (!json) {
            console.warn(`[SongSection] No saved state found in localStorage: ${key}`);
            return null;
        }

        try {
            const data = JSON.parse(json);
            const section = SongSection.fromJSON(data);
            console.log(`[SongSection] Loaded from localStorage: ${key}`);
            return section;
        } catch (error) {
            console.error('[SongSection] Failed to parse saved state:', error);
            return null;
        }
    }

    /**
     * Export to downloadable JSON file
     */
    exportToFile() {
        const json = JSON.stringify(this.toJSON(), null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.name.replace(/\s+/g, '_')}_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        console.log(`[SongSection] Exported to file: ${a.download}`);
    }

    /**
     * Import from file
     */
    static async importFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    const section = SongSection.fromJSON(data);
                    console.log(`[SongSection] Imported from file: ${file.name}`);
                    resolve(section);
                } catch (error) {
                    console.error('[SongSection] Failed to parse imported file:', error);
                    reject(error);
                }
            };
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    /**
     * Find all visualizer IDs in the DOM
     */
    findAllVisualizerIds() {
        const visualizers = document.querySelectorAll('sonofire-xy-plot');
        return Array.from(visualizers).map(viz => viz.id).filter(id => id);
    }
}
