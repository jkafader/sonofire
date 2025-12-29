# Sonofire Data Sonification System - Implementation Plan

## Overview

Transform the working proof-of-concept (`components/pitch_generator.js`) into a comprehensive, modular data sonification web component system. The system will visualize data in multiple ways (radial, X/Y, X/Y/Z, heatmap) and generate music through instrumentalist components (Drummer, Bassist, Pianist, Soloist, Free) that respond to data events and harmonic context.

## Architecture Principles

1. **Modular Components**: Each graph type and instrumentalist is a separate web component
2. **Event-Driven**: Central pub/sub message bus for loose coupling
3. **Hybrid Independence**: Visualizers work standalone with basic functionality, enhanced when Conductor/Composer present
4. **Dual Audio Output**: Support both MIDI output (Web MIDI API) and built-in Web Audio synthesis
5. **Flexible Forecasting**: Support both pre-computed forecast data and algorithmic forecast generation
6. **Attribute-Based Configuration**: All components accept JSON configuration via HTML attributes

## Implementation Phases

### Phase 1: Core Infrastructure ⚙️

**Goal**: Build the foundational services that all components depend on.

**Files to create:**

1. **`lib/message_bus.js`** - Singleton pub/sub system
   - Topic-based subscriptions with wildcard support
   - Priority queue for real-time MIDI events
   - Unsubscribe function pattern for cleanup
   - Message topics:
     - `clock:tick`, `clock:start`, `clock:stop`, `clock:tempo`
     - `context:key`, `context:chord`, `context:mood`, `context:spareness`
     - `data:point`, `data:forecast`, `data:region`
     - `music:chord`, `music:scale`, `music:progression`
     - `instrument:register`, `instrument:mute`

2. **`lib/midi_clock.js`** - Timing/sync service (singleton)
   - Master mode: Internal high-precision timer (BPM-based)
   - Configurable PPQN (pulses per quarter note, default 24)
   - Publishes `clock:tick` events with tick count and timestamp
   - Methods: `start()`, `stop()`, `setBPM()`, `getNextBeat()`, `getCurrentBar()`

3. **`lib/midi_output.js`** - MIDI output manager (singleton)
   - Initialize Web MIDI access
   - Track active notes (prevent duplicate note-ons)
   - Methods: `sendNoteOn()`, `sendNoteOff()`, `panic()` (all notes off)
   - Send to all available MIDI outputs

4. **`lib/web_audio_synth.js`** - Built-in audio synthesis (singleton)
   - Web Audio API oscillator-based synth
   - Methods: `playNote()`, `stopNote()`, `setWaveform()`, `setGain()`
   - Same interface as midi_output for seamless switching

5. **`lib/audio_router.js`** - Audio output router (singleton)
   - Configurable routing: MIDI only, Web Audio only, or both
   - Unified interface: `sendNote(channel, note, velocity, duration)`
   - Automatically routes to enabled outputs

6. **`lib/harmonic_context.js`** - Key/chord management (singleton)
   - Track current key, scale, chord
   - Methods: `setKey()`, `voiceChord()`, `isInScale()`, `getNearestScaleNote()`
   - Supports major, minor, dorian modes

7. **`components/base/sonofire_base.js`** - Base component class
   - Extends `HTMLElement`
   - Lifecycle: `connectedCallback()`, `disconnectedCallback()`, `attributeChangedCallback()`
   - Methods: `parseAttributes()`, `setupSubscriptions()`, `cleanup()`, `render()`
   - Tracks subscriptions for automatic cleanup on disconnect

**Testing:**
- Unit tests for message bus (subscribe, publish, unsubscribe)
- Unit tests for MIDI clock timing accuracy
- Manual verification of MIDI output and Web Audio synthesis

**Success Criteria:**
- Message bus can route 1000+ messages/second without blocking
- MIDI Clock maintains accurate BPM (±1ms jitter)
- MIDI notes can be sent to external synths
- Web Audio synth produces audible tones

---

### Phase 2: Refactor Existing XY Plot 🔄

**Goal**: Refactor `components/pitch_generator.js` to use the new architecture as validation and reference implementation.

**Files to modify/create:**

1. **Refactor: `components/pitch_generator.js` → `components/visualizers/xy_plot.js`**
   - Extract base visualization logic to `components/base/sonofire_visualizer_base.js`
   - Remove direct MIDI sending (replace with `messageBus.publish('data:point', ...)`)
   - Subscribe to `clock:tick` instead of `setInterval`
   - Accept configuration via `data-config` attribute
   - Keep D3.js rendering logic
   - Emit `data:point` events with `{x, y, value, note, timestamp, source}`

2. **Create: `components/base/sonofire_visualizer_base.js`**
   - Base class for all visualizers
   - Extends `SonofireBase`
   - Methods: `loadData()`, `calculateDataBoundaries()`, `advancePlayhead()`, `emitDataEvents()`
   - Subscribe to `clock:tick` for playhead advancement

3. **Update: `index.html`**
   - Import refactored XY plot component
   - Use new attribute-based configuration

**Testing:**
- Verify playhead advances with MIDI Clock
- Verify `data:point` events published correctly
- Confirm visual rendering matches original
- Test with `beer_production.csv`

**Success Criteria:**
- Refactored XY plot produces same visual output as original
- Events flow through message bus
- No regressions in functionality

---

### Phase 3: Control Components 🎭

**Goal**: Implement Conductor and Composer to manage harmonic context.

**Files to create:**

1. **`components/controllers/conductor.js`** - `<sonofire-conductor>`
   - Attributes: `data-initial-key`, `data-initial-scale`, `data-tempo`, `data-mode` (auto/manual)
   - Initialize harmonic context and MIDI Clock
   - Listen to `data:forecast` and `data:region` events
   - Publish `context:key`, `context:mood`, `context:spareness`
   - Auto mode: Change mood/spareness based on data patterns
   - Manual mode: Optional UI controls for user override
   - When NOT present: Components use default key (C major), neutral mood

2. **`components/controllers/composer.js`** - `<sonofire-composer>`
   - Attributes: `data-progression-style` (jazz/blues/pop), `data-bars-per-chord`
   - Subscribe to `context:key` to generate chord progressions
   - Subscribe to `clock:tick` to advance chords based on bars
   - Publish `music:chord` with `{chord, notes, root, quality, duration}`
   - When NOT present: Instrumentalists use static scale tones

3. **`lib/music_theory.js`** - Music theory utilities
   - `generateProgression(key, scale, style)` - Returns array of chord objects
   - `voiceChord(chord, voicingType)` - Returns MIDI note array
   - Chord progressions: jazz (II-V-I), blues (I-IV-I-V), pop (I-V-vi-IV)

**Testing:**
- Test key changes propagate through message bus
- Test chord progressions advance with clock ticks
- Integration test: Conductor + Composer working together
- Test standalone behavior when components absent

**Success Criteria:**
- Conductor manages global harmonic context
- Composer generates valid chord progressions
- All context signals flow through message bus
- Components gracefully degrade without Conductor/Composer

---

### Phase 4: First Instrumentalist (Soloist) 🎵

**Goal**: Create the Soloist component to recreate original pitch_generator MIDI functionality.

**Files to create:**

1. **`components/instrumentalists/soloist.js`** - `<sonofire-soloist>`
   - Extends `BaseInstrumentalist` (to be created)
   - Attributes: `data-channel`, `data-style`, `data-enabled`, `data-listen-to-data`
   - Subscribe to `data:point` events (from visualizers)
   - Subscribe to `data:forecast` events (for deviation-based dissonance)
   - Subscribe to `music:chord`, `context:mood`, `context:spareness`
   - Generate melody based on data values
   - Map deviation to dissonance (consonant when forecast matches, dissonant when large deviation)
   - Melodic smoothing (avoid large jumps, max 5th interval)
   - Send notes via `audioRouter.sendNote()`

2. **`components/instrumentalists/base_instrumentalist.js`** - Base class
   - Extends `SonofireBase`
   - Properties: `channel`, `enabled`, `currentChord`, `currentScale`, `mood`, `spareness`
   - Subscribe to `clock:tick`, `music:chord`, `context:mood`, `context:spareness`
   - Methods: `generate(clockMsg)` (abstract), `sendNote(note, velocity, duration)`

**Testing:**
- Integration test: XY Plot → Soloist → MIDI/Audio output
- Compare behavior to original `pitch_generator.js`
- Test with and without Conductor/Composer
- Test deviation-based dissonance with forecast data

**Success Criteria:**
- Soloist plays notes based on data events
- Output matches original pitch_generator behavior
- Works standalone and with Conductor/Composer
- Dissonance increases with forecast deviation

---

### Phase 5: Additional Visualizers 📊

**Goal**: Implement radial, 3D, and heatmap graph components.

**Files to create:**

1. **`components/visualizers/radial_plot.js`** - `<sonofire-radial-plot>`
   - D3.js polar coordinate visualization
   - Attributes: `data-angle-column`, `data-radius-column`, `data-mode` (radial/solar-system)
   - Playhead: Rotating line from center
   - Solar system mode: Group by category, different orbit speeds
   - Emit `data:point` when playhead crosses data points
   - Angular threshold: ±5 degrees

2. **`components/visualizers/xyz_plot.js`** - `<sonofire-xyz-plot>`
   - Three.js 3D scatter plot
   - Add dependency: `three` from npm/CDN
   - Attributes: `data-x-column`, `data-y-column`, `data-z-column`, `data-playhead-axis`
   - Playhead: Semi-transparent plane sweeping through space
   - Map X→pitch, Y→velocity, Z→timbre (configurable)
   - Emit `data:point` when playhead intersects points

3. **`components/visualizers/heatmap_plot.js`** - `<sonofire-heatmap-plot>`
   - D3.js rect-based heatmap
   - Attributes: `data-x-column`, `data-y-column`, `data-value-column`, `data-playhead-mode` (raster/column/row)
   - Color scale: cold (blue) → hot (red)
   - Playhead modes:
     - Raster: Left-to-right, top-to-bottom scan
     - Column: Scan column by column
     - Row: Scan row by row
   - Emit `data:region` events for hot/cold zones
   - Detect regions via simple thresholding (intensity > threshold = hot)

**Testing:**
- Create test datasets for each type:
  - `tests/datasets/circular_data.csv` - For radial plot
  - `tests/datasets/xyz_spatial.csv` - For 3D plot
  - `tests/datasets/heatmap_data.csv` - For heatmap
- Visual verification of graph rendering
- Event emission verification
- Integration with Soloist

**Success Criteria:**
- All three visualizers render correctly
- Playheads advance with clock
- Data events emitted at correct times
- Soloist responds to all visualizer types

---

### Phase 6: Forecast Visualizers & Algorithms 🔮

**Goal**: Implement forecast-enabled visualizers with both pre-computed and generated forecasts.

**Files to create:**

1. **`lib/forecast_algorithms.js`** - Time-series forecasting utilities
   - `movingAverage(data, windowSize)` - Simple moving average
   - `exponentialSmoothing(data, alpha)` - EMA forecast
   - `linearTrend(data)` - Linear regression forecast
   - Return format: `{expected: value, confidence: 0-1}`

2. **`components/visualizers/xy_forecast_plot.js`** - `<sonofire-xy-forecast-plot>`
   - Attributes: `data-actual-url`, `data-forecast-url`, `data-forecast-algorithm` (none/moving-average/exponential/linear)
   - Load both actual and forecast data (or generate forecast)
   - D3.js: Plot forecast as line, actual as points
   - Color code by deviation (green=match, yellow=small, red=large)
   - Emit `data:forecast` events: `{expected, actual, deviation, confidence, note}`
   - Map deviation to dissonance level:
     - <20% max deviation: Consonant (root, 3rd, 5th)
     - 20-50%: Mildly dissonant (7th, 9th)
     - 50-80%: Dissonant (b9, #9, #11)
     - >80%: Very dissonant (chromatic, clusters)

3. **`components/visualizers/xyz_forecast_plot.js`** - `<sonofire-xyz-forecast-plot>`
   - Similar to xyz_plot but with forecast data
   - Show forecast as ghost points, actual as solid
   - Emit `data:forecast` events

4. **Research: Heatmap forecast approach**
   - Implement spatial smoothing (Gaussian blur)
   - Calculate expected value: `convolve(heatmap, gaussianKernel)`
   - Spikes above smoothed value = unexpected = hot zones
   - Emit `data:region` with unexpectedness metric

**Testing:**
- Create `tests/datasets/timeseries_forecast.csv` with actual and forecast columns
- Test with perfect match (deviation=0) → consonant output
- Test with large deviation → dissonant output
- Test algorithmic forecast generation
- Verify Conductor changes mood during high deviation

**Success Criteria:**
- Forecast plots visualize both expected and actual data
- Support both pre-computed and generated forecasts
- Deviation correctly mapped to dissonance
- Soloist plays consonant notes when forecast matches, dissonant when deviated

---

### Phase 7: Rhythm Section (Drummer + Bassist) 🥁

**Goal**: Implement time-aligned generative rhythm and bass patterns.

**Files to create:**

1. **`components/instrumentalists/drummer.js`** - `<sonofire-drummer>`
   - Attributes: `data-channel` (default 9), `data-style`, `data-enabled`
   - Subscribe to `clock:tick` for timing
   - Standard MIDI drum notes: kick (36), snare (38), hihat (42)
   - Algorithmic patterns:
     - Kick: Steps 0, 8 (beats 1, 3) + variation based on mood
     - Snare: Steps 4, 12 (beats 2, 4)
     - Hihat: Every eighth note, thinned by spareness
   - Velocity variation based on mood (tense=100, relaxed=70)
   - Respond to spareness: More sparse = fewer hihat hits

2. **`components/instrumentalists/bassist.js`** - `<sonofire-bassist>`
   - Attributes: `data-channel`, `data-style` (walking/roots/pedal), `data-enabled`
   - Subscribe to `clock:tick` and `music:chord`
   - Play on quarter notes (tick % ppqn === 0)
   - Styles:
     - **Roots**: Root note, octave below chord root
     - **Pedal**: Stay on same note (drone)
     - **Walking**: Algorithmic bass line with weighted selection:
       - 40% root, 30% fifth, 20% chord tone, 10% chromatic approach
   - Bias toward root, 5th, chord tones
   - Optional chromatic approaches (half-step below next root)

3. **`lib/generative_algorithms.js`** - Shared generation utilities
   - `weightedRandom(options, weights)` - Weighted random selection
   - `chromaticApproach(targetNote, currentNote)` - Return approach note
   - `generateRhythmPattern(density, swing)` - Rhythm generation

**Testing:**
- Test drummer timing accuracy (on beat)
- Test bassist follows chord changes
- Test spareness affects playing density
- Integration test: Drummer + Bassist + Composer
- Verify both work without Composer (use scale tones)

**Success Criteria:**
- Drummer plays in time with MIDI Clock
- Bassist follows chord progressions from Composer
- Both respond to mood/spareness signals
- Graceful degradation without Composer

---

### Phase 8: Harmonic Instruments (Pianist + Free) 🎹

**Goal**: Complete the instrumentalist suite with chordal and experimental components.

**Files to create:**

1. **`components/instrumentalists/pianist.js`** - `<sonofire-pianist>`
   - Attributes: `data-channel`, `data-style` (comping/arpeggios/block-chords), `data-enabled`
   - Subscribe to `music:chord` for voicings
   - Styles:
     - **Comping**: Syncopated chord stabs (rhythmic pattern, sparse)
     - **Arpeggios**: Cycle through chord notes on 16th notes
     - **Block chords**: Full chord on downbeats/half notes
   - Respond to spareness: Skip comping hits when sparse
   - When no Composer: Arpeggiate current scale

2. **`components/instrumentalists/free_player.js`** - `<sonofire-free-player>`
   - Attributes: `data-channel`, `data-randomness` (0-1), `data-min-note`, `data-max-note`
   - Ignore harmonic context (completely free)
   - Generate random notes within MIDI range
   - Play on random intervals (affected by spareness)
   - Useful for: Experimental sounds, sound effects, noise

**Testing:**
- Test pianist chord voicings match Composer chords
- Test pianist styles produce expected rhythmic patterns
- Test free player ignores harmonic context
- Full system test: All instrumentalists + all visualizers

**Success Criteria:**
- Pianist plays harmonically correct voicings
- All three styles work as expected
- Free player provides experimental contrast
- Full ensemble works together musically

---

### Phase 9: Polish, Documentation & Testing 📝

**Goal**: Complete testing suite, performance optimization, and comprehensive documentation.

**Files to create:**

1. **`tests/unit/message_bus.test.js`** - Message bus tests
2. **`tests/unit/midi_clock.test.js`** - Clock timing tests
3. **`tests/unit/harmonic_context.test.js`** - Music theory tests
4. **`tests/integration/full_system.html`** - Complete integration demo
5. **`README.md`** - Project overview, quick start, component list
6. **`docs/API.md`** - Complete component API reference
7. **`docs/ARCHITECTURE.md`** - System design and message flow diagrams
8. **`docs/MUSICAL_ALGORITHMS.md`** - Music theory implementation details
9. **`docs/EXAMPLES.md`** - Usage examples for each component
10. **`package.json`** - Dependencies and scripts

**Testing datasets to create:**
- `tests/datasets/timeseries_simple.csv` - Simple time series (already have beer_production.csv)
- `tests/datasets/timeseries_forecast.csv` - With forecast column
- `tests/datasets/circular_data.csv` - For radial plots
- `tests/datasets/xyz_spatial.csv` - 3D scatter data
- `tests/datasets/heatmap_data.csv` - 2D grid data

**Performance optimization:**
- Profile message bus overhead
- Implement data decimation for large datasets (>1000 points)
- Add note deduplication in instrumentalists
- Optimize D3 rendering (use canvas for large datasets?)

**Demo page updates:**
- Update `index.html` with comprehensive demo
- Multiple example configurations
- UI for starting/stopping different ensembles
- Visual feedback of message bus activity

**Success Criteria:**
- All unit tests passing
- Integration tests demonstrate all features
- Documentation complete and accurate
- Performance acceptable (CPU <50% with full ensemble)

---

### Phase 10: Grafana Plugin (Future) 🔌

**Goal**: Package Sonofire components as Grafana panel plugin.

**Deferred to later phase** - Complete core web component system first, then adapt for Grafana.

**Research needed:**
- Grafana panel plugin architecture
- How to bundle web components for Grafana
- Data source integration patterns
- Plugin manifest structure

**Files to create (future):**
- `grafana-plugin/` directory structure
- Plugin manifest and configuration
- Panel component wrapper
- Build scripts for Grafana packaging

---

## Critical Files Reference

### Phase 1 - Core Infrastructure
- `lib/message_bus.js` ⭐ (foundation)
- `lib/midi_clock.js` ⭐ (timing)
- `lib/midi_output.js`
- `lib/web_audio_synth.js`
- `lib/audio_router.js`
- `lib/harmonic_context.js`
- `components/base/sonofire_base.js` ⭐ (all components inherit)

### Phase 2 - XY Plot Refactor
- `components/pitch_generator.js` → `components/visualizers/xy_plot.js` ⭐ (reference implementation)
- `components/base/sonofire_visualizer_base.js`

### Phase 3 - Control Components
- `components/controllers/conductor.js`
- `components/controllers/composer.js`
- `lib/music_theory.js`

### Phase 4 - First Instrumentalist
- `components/instrumentalists/base_instrumentalist.js`
- `components/instrumentalists/soloist.js`

### Phase 5 - Additional Visualizers
- `components/visualizers/radial_plot.js`
- `components/visualizers/xyz_plot.js`
- `components/visualizers/heatmap_plot.js`

### Phase 6 - Forecasts
- `lib/forecast_algorithms.js`
- `components/visualizers/xy_forecast_plot.js`
- `components/visualizers/xyz_forecast_plot.js`

### Phase 7 - Rhythm Section
- `components/instrumentalists/drummer.js`
- `components/instrumentalists/bassist.js`
- `lib/generative_algorithms.js`

### Phase 8 - Harmonic Instruments
- `components/instrumentalists/pianist.js`
- `components/instrumentalists/free_player.js`

### Existing Files (to preserve)
- `lib/midi_data.js` ✓ (existing, reference for scales)
- `beer_production.csv` ✓ (existing test data)
- `Makefile` ✓ (existing, keep for dev server)

---

## Component Dependencies

```
Message Bus (singleton)
    ↓
MIDI Clock (singleton)
    ↓
├── Audio Router → MIDI Output + Web Audio Synth
├── Harmonic Context (singleton)
├── SonofireBase → SonofireVisualizerBase → All Visualizers
└── SonofireBase → BaseInstrumentalist → All Instrumentalists
```

---

## Message Flow Example

```
1. User loads page with:
   <sonofire-conductor data-tempo="120" data-initial-key="C"></sonofire-conductor>
   <sonofire-composer data-progression-style="jazz"></sonofire-composer>
   <sonofire-xy-plot data-url="data.csv"></sonofire-xy-plot>
   <sonofire-drummer data-channel="9"></sonofire-drummer>
   <sonofire-soloist data-channel="0"></sonofire-soloist>

2. Conductor initializes:
   - Starts MIDI Clock at 120 BPM
   - Publishes context:key = {key: 'C', scale: 'major'}

3. Composer receives context:key:
   - Generates jazz progression [Cmaj7, Dm7, G7, Cmaj7]
   - Publishes music:chord = {chord: 'Cmaj7', notes: [60,64,67,71]}

4. XY Plot loads data:
   - Subscribes to clock:tick
   - Loads CSV, maps Y values to notes in C major scale

5. Clock ticks (24 ppqn):
   - Publishes clock:tick = {tick: 0, timestamp: ...}

6. Every tick:
   - XY Plot advances playhead → publishes data:point = {x, y, note: 64, ...}
   - Drummer checks if beat → plays kick/snare/hihat via audioRouter
   - Soloist receives data:point → plays note via audioRouter

7. Every 4 bars (based on tick count):
   - Composer advances chord → publishes music:chord = {chord: 'Dm7', ...}

8. Drummer and Soloist adjust playing based on new chord context

```

---

## Key Design Decisions

1. **Hybrid Independence**: Visualizers work standalone (use defaults) but enhance when Conductor/Composer present
2. **Dual Audio Output**: Support both MIDI (professional) and Web Audio (ease of use)
3. **Flexible Forecasting**: Support pre-computed data AND algorithmic generation
4. **Event-Driven**: Loose coupling via message bus (components don't know about each other)
5. **Singleton Services**: Single MIDI Clock, Message Bus, etc. (no duplication)
6. **Attribute-Based Config**: HTML attributes for declarative configuration
7. **Graceful Degradation**: Components work with partial system (just visualizer, just instrumentalist, etc.)

---

## Testing Strategy

1. **Unit Tests**: Each service/utility in isolation (Jest)
2. **Integration Tests**: Component combinations in HTML test pages
3. **Visual Tests**: Manual verification of graph rendering
4. **Audio Tests**: Manual verification of MIDI/audio output
5. **Performance Tests**: CPU/memory monitoring with full ensemble
6. **Real Data Tests**: Use actual datasets in addition to synthetic test data

---

## Success Metrics

- ✅ All visualizer types render correctly and emit events
- ✅ All instrumentalists generate musically coherent output
- ✅ System works with partial component sets (graceful degradation)
- ✅ Message bus handles high event volume without lag
- ✅ MIDI Clock maintains accurate timing (±1ms)
- ✅ Components can be combined in any configuration
- ✅ Deviation from forecasts produces appropriate dissonance
- ✅ Full ensemble CPU usage <50% on modern hardware
- ✅ Documentation complete and examples working

---

## Implementation Order Summary

1. **Phase 1**: Core infrastructure (message bus, MIDI clock, audio routing)
2. **Phase 2**: Refactor XY plot to validate architecture
3. **Phase 3**: Control components (Conductor, Composer)
4. **Phase 4**: First instrumentalist (Soloist) - validates data→music flow
5. **Phase 5**: Additional visualizers (radial, 3D, heatmap)
6. **Phase 6**: Forecast visualizers + algorithms
7. **Phase 7**: Rhythm section (Drummer, Bassist)
8. **Phase 8**: Harmonic instruments (Pianist, Free)
9. **Phase 9**: Polish, testing, documentation
10. **Phase 10**: Grafana plugin (future)

---

## Dependencies to Add

**package.json additions:**
```json
{
  "dependencies": {
    "d3": "^7.9.0",
    "three": "^0.160.0"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  }
}
```

**Or use CDN imports in HTML:**
```html
<script type="importmap">
{
  "imports": {
    "d3": "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm",
    "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/+esm"
  }
}
</script>
```
