# Sonofire Technical Guide

**Version:** 1.0.0
**Last Updated:** February 2026

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Core Systems](#core-systems)
4. [Data Visualization](#data-visualization)
5. [Musical Generation](#musical-generation)
6. [Control Systems](#control-systems)
7. [State Management](#state-management)
8. [API Reference](#api-reference)
9. [Browser Compatibility](#browser-compatibility)

---

## Overview

Sonofire is a data sonification system that transforms time-series data into music. It visualizes data through interactive plots and generates real-time musical compositions using data-driven rhythms, melodies, and harmonies.

### Key Features

- **Data-Driven Music**: Mathematical transforms (layers) create contours that drive musical parameters
- **Real-Time Visualization**: D3.js-based XY plots with playheads and layer overlays
- **Precise Timing**: Web Audio API + Web Worker for sub-millisecond MIDI scheduling
- **Modular Architecture**: Web Components with PubSub messaging
- **Complete Serialization**: Save/restore entire compositions with all bindings and state
- **MIDI & Web Audio**: Dual output supporting both external synths and built-in synthesis

### Core Concepts

- **Layers**: Mathematical transforms (FFT, DWT, peaks, etc.) that create contour data
- **Playheads**: Time-based cursors that sample data and trigger musical events
- **Planners**: Convert contours into musical structures (melody, rhythm)
- **Bindings**: Connect data sources to musical parameters
  - **Whip Bindings**: Playhead values → scalar parameters (round drag handles)
  - **Contour Bindings**: Layer contours → contour parameters (square drag handles)
- **Composer**: Generates chord progressions from melody or probabilistic rules
- **Instrumentalists**: Perform musical parts (bassist, drummer, soloist, keyboardist)

---

## Architecture

### Component Hierarchy

```
Conductor (global tempo, key, mood)
  │
  ├── Visualizers (XY Plot)
  │   ├── Layers (data + transforms)
  │   └── Playheads (time cursors)
  │
  ├── Planners
  │   ├── Melody Planner (contour → melody)
  │   └── Rhythm Planner (contour → rhythm)
  │
  ├── Composer (melody → chords)
  │
  └── Instrumentalists
      ├── Bassist
      ├── Drummer
      ├── Soloist
      └── Keyboardist
```

### Message Flow

```
Data Load → Layers Compute → Playheads Sample
                                    ↓
                            PubSub: data:point
                                    ↓
                    ┌───────────────┼───────────────┐
                    ↓               ↓               ↓
              Whip Bindings   Contour Bindings   Planners
                    ↓               ↓               ↓
              Parameters      Parameters       Melody/Rhythm
                                                    ↓
                                                Composer
                                                    ↓
                                            Chord Progression
                                                    ↓
                                            Instrumentalists
                                                    ↓
                                              MIDI Output
```

---

## Core Systems

### 1. Timing & Scheduling

Sonofire uses Web Audio API's hardware clock with a Web Worker look-ahead scheduler for precise MIDI timing.

#### Architecture

**Timing Worker** (`lib/timing_worker.js`):
- Runs every 25ms (40Hz)
- Looks ahead 100ms
- Calculates upcoming ticks
- Posts messages to main thread
- Immune to main-thread blocking (GC, layout, etc.)

**MIDI Clock** (`lib/midi_clock.js`):
- Creates AudioContext for hardware timing
- Spawns timing worker
- Maintains event queue
- Fires events at precise `audioContext.currentTime`
- Processes queue on requestAnimationFrame

#### Configuration

- **Lookahead**: 100ms (resilient to jitter)
- **Scheduler Interval**: 25ms (responsive tempo changes)
- **PPQN**: 24 (pulses per quarter note)
- **Clock Source**: `audioContext.currentTime` (sub-millisecond precision)

#### Events

```javascript
// Clock tick (for MIDI scheduling)
'clock:tick' → {
    tick: number,
    audioTime: number,  // Precise Web Audio time
    timestamp: number,  // Wall clock
    ppqn: 24,
    bpm: number
}

// Visual tick (for animations)
'clock:visual-tick' → {
    tick: number,
    audioTime: number
}
```

#### Usage

```javascript
// Instrumentalists: schedule MIDI
this.subscribe('clock:tick', (data) => {
    const { audioTime } = data;
    this.scheduleMIDINote(note, audioTime);
});

// Visualizers: update animations
this.subscribe('clock:visual-tick', (data) => {
    this.updatePlayheads(data.tick);
});
```

### 2. PubSub Messaging

**File**: `lib/pubsub.js`

Centralized publish/subscribe system with localStorage persistence.

#### Features

- Topic-based subscriptions
- Automatic persistence to localStorage
- Context binding for `this`
- Subscription cleanup

#### Key Topics

```javascript
// Timing
'clock:tick', 'clock:start', 'clock:stop', 'clock:tempo'

// Harmonic Context
'context:pool', 'context:tempo', 'context:timeSignature'
'context:mood', 'context:density'

// Musical Content
'music:chord', 'melody:phrase', 'rhythm:pattern'

// Data Events
'data:point', 'playhead:*:value'

// Bindings
'whip:bindings:state', 'contour:bindings:state'

// Layers
'layer:*:computed', 'visualizer:*:layer:added'
```

#### Usage

```javascript
// Publish
PubSub.publish('music:chord', { symbol: 'Cmaj7', root: 60 });

// Subscribe
this.subscribe('music:chord', (data) => {
    console.log('New chord:', data.symbol);
}, this);

// Get last value
const lastChord = PubSub.last('music:chord');
```

### 3. Harmonic Context

**File**: `lib/harmonic_context.js`

Manages global harmonic state using pool/tonic notation.

#### Pool/Tonic System

- **Pool Key**: Number of sharps/flats (e.g., "3♯", "0", "2♭")
- **Tonic Note**: MIDI note number (e.g., 69 = A4)
- **Scale Type**: diatonic, pentatonic, blues, chromatic, octatonic

#### Methods

```javascript
harmonicContext.setPoolAndTonic('3♯', 69, 'A', 'diatonic');
const pool = harmonicContext.getNotePool('3♯');  // Array of MIDI notes
const inScale = harmonicContext.isInScale(note, pool);
```

---

## Data Visualization

### 1. Layers

**Files**: `lib/layer.js`, `lib/layer_manager.js`

Layers are mathematical transforms that create contour data from time-series inputs.

#### Layer Types

**Data Layer**: Original CSV data
```javascript
{
    type: 'data',
    name: 'Original Data',
    outputData: [{x: Date, y: number}, ...]
}
```

**Transform Layer**: Computed derivative
```javascript
{
    type: 'transform',
    transformType: 'fft_lowpass',
    inputLayerIds: ['layer-1'],
    transformParams: { cutoff: 0.1 },
    outputData: [{x: Date, y: number}, ...]
}
```

#### Available Transforms

- **FFT Filters**: `fft_lowpass`, `fft_highpass`, `fft_bandpass`, `fft_dominant`
- **Feature Detection**: `peak_detection`, `outlier_detection`
- **Averaging**: `moving_average`, `windowed_average`, `static_average`
- **Statistical**: `percentile`, `min_max`
- **Multi-Input**: `difference`, `intersections`

#### Computation

Layers compute in Web Workers (`lib/transform_worker.js`) with automatic invalidation:

```javascript
// Add layer
const layer = layerManager.addLayer('viz-1', {
    name: 'FFT Lowpass',
    type: 'transform',
    transformType: 'fft_lowpass',
    inputLayerIds: ['base-layer'],
    transformParams: { cutoff: 0.1 }
});

// Auto-computes in worker, publishes when complete
```

#### UI

Layers appear in right sidebar of XY Plot:
- Visibility toggle
- Opacity slider
- Delete button
- **Square whip source** for drag-and-drop contour bindings

### 2. Playheads

**Files**: `lib/playhead.js`, `lib/mixins/playheads.js`

Time-based cursors that advance through data and sample values.

#### Features

- **Speed Multipliers**: ÷48, ÷24, ÷16...×1...×16
- **Layer Assignment**: Each playhead samples from a specific layer
- **Color-Coded**: 20 distinct colors for easy identification
- **Enabled/Disabled**: Toggle playhead on/off

#### Advancement

```javascript
class Playhead {
    advance() {
        if (this.speed >= 1) {
            return Math.round(this.speed);  // Multiple steps per tick
        }
        // Clock division for slower speeds
        const ticksNeeded = Math.round(1 / this.speed);
        this.tickCounter++;
        if (this.tickCounter >= ticksNeeded) {
            this.tickCounter = 0;
            return 1;
        }
        return 0;
    }
}
```

#### Sampling

Playheads sample their assigned layer's `outputData`:

```javascript
sampleDataAtPlayhead(playhead) {
    const layer = layerManager.getLayer(playhead.layerId);
    const dataSource = layer.outputData || this.data;

    // Find data in window around playhead
    // Publish sampled value to PubSub
    playhead.sampleValue(yValue, normalizedValue);
}
```

#### UI

Playheads appear in left sidebar:
- Speed selector
- Enable/disable toggle
- Delete button
- **Round whip source** for drag-and-drop scalar bindings

### 3. XY Plot Visualizer

**File**: `components/visualizers/xy_plot.js`

D3.js-based time-series plot with layers and playheads.

#### Features

- CSV data loading
- Layer overlay rendering
- Playhead visualization (vertical lines + triangles)
- Y-axis zoom controls
- Click-and-drag playhead repositioning
- Layer/playhead selection and filtering

#### Layer Rendering

```javascript
// Data layer: render as circles (if visible)
if (baseLayer.visible) {
    svg.append('g')
        .selectAll('circle')
        .data(data)
        .enter().append('circle')
        .attr('r', 1.5)
        .style('fill', '#69b3a2');
}

// Transform layers: line (dense) or circles (sparse)
if (layer.outputData.length > 100) {
    // Line for dense data
    const line = d3.line()
        .x(d => xScale(d.x))
        .y(d => yScale(d.y));
    layerGroup.append('path')
        .datum(layer.outputData)
        .attr('d', line);
} else {
    // Circles for sparse data (peaks, etc.)
    layerGroup.selectAll('circle')
        .data(layer.outputData)
        .enter().append('circle')
        .attr('r', 2.5);
}
```

---

## Musical Generation

### 1. Melody Planner

**File**: `components/planners/melody_planner.js`

Converts contour data into melodic phrases.

#### Inputs (Contour Bindings)

- **Melody Input**: Main contour for pitch content
- **Tonic Center**: Contour for tonic/root movement

#### Algorithm

```javascript
generateMelodyFromContour() {
    // 1. Calculate differences between melody and tonic center contours
    const differences = melodyContour.map((point, i) =>
        point.y - tonicCenterContour[i].y
    );

    // 2. Map differences to scale degrees
    const scaleDegrees = differences.map(diff => {
        const scaleDegreeFloat = (diff / differenceRange) * scaleSize;
        return Math.round(scaleDegreeFloat);
    });

    // 3. Quantize to scale
    const melody = scaleDegrees.map(degree => {
        const pitch = tonicNote + intervals[degree];
        return { pitch, step: i, velocity: 80 };
    });

    // 4. Publish melody
    PubSub.publish('melody:phrase', { notes: melody });
}
```

#### Output

```javascript
{
    notes: [
        { step: 0, pitch: 60, velocity: 80 },
        { step: 1, pitch: 64, velocity: 75 },
        // ...
    ],
    scale: [60, 62, 64, 65, 67, 69, 71],  // MIDI notes in scale
    poolKey: '0',
    tonicNote: 60,
    scaleType: 'diatonic'
}
```

#### UI

Piano roll visualization showing:
- Notes as rectangles (X = time, Y = pitch)
- Scale notes highlighted
- Tonic center line
- Dynamic Y-domain based on melody range

### 2. Rhythm Planner

**File**: `components/planners/rhythm_planner.js`

Converts contour data into rhythmic patterns.

#### Input (Contour Binding)

- **Rhythm Input**: Contour for rhythm generation

#### Algorithm

```javascript
generateRhythmFromContour() {
    // 1. Resample contour to match grid resolution
    const gridPoints = resampleToGrid(contour, phraseLength, division);

    // 2. Threshold for hits
    const threshold = calculateThreshold(gridPoints);
    const hits = gridPoints.map(value => value > threshold);

    // 3. Detect accents (peaks)
    const accents = detectPeaks(gridPoints);

    // 4. Publish pattern
    PubSub.publish('rhythm:pattern', {
        hits,
        accents,
        division
    });
}
```

#### Output

```javascript
{
    hits: [true, false, true, false, ...],  // Boolean array
    accents: [false, false, true, false, ...],  // Peak markers
    division: 16,  // 16th notes
    beatsPerBar: 4
}
```

#### UI

Drum grid showing:
- X-axis: Time (grid divisions)
- Y-axis: Density layers
- Hits as filled squares
- Accents as triangular markers

### 3. Composer

**File**: `components/controllers/composer.js`

Generates chord progressions from melody or probabilistic rules.

#### Modes

**1. Melody-Driven** (Priority 1):
```javascript
// Analyze melody for chord tones
harmonizeMelody(melody) {
    const segments = splitMelodyIntoSegments(melody, chordsPerPhrase);

    segments.forEach(segment => {
        const strongBeatNotes = segment.filter((_, i) => i % 4 === 0);
        const targetPitch = strongBeatNotes[0].pitch;
        const degree = pitchToDegree(targetPitch);
        const chord = buildChord(degree);
        progression.push(chord);
    });
}
```

**2. Probabilistic** (Fallback):
```javascript
// Markov-style progression
generateProgression() {
    const matrix = this.probabilityMatrix[currentDegree];
    const nextDegree = weightedRandom(matrix);
    const chord = buildChord(nextDegree);
    progression.push(chord);
}
```

#### Composition Styles

- `jazz-swing`: 4 chords per phrase, complex voicings
- `blues-12bar`: 3 chords (I-IV-V pattern)
- `funk`: 2 chords, static harmony
- `rock`: 2 chords, power chords

#### Dot Notation

Visual chord timing notation:
```
Am7  • • • •
Dm7  • • • •
G7   • • • •
Cmaj7 • • • •
```

- `•` = quarter beat
- `*` = current beat
- `.` = rest

### 4. Instrumentalists

Components that perform musical parts based on harmonic context and rhythm.

#### Bassist (`components/instrumentalists/bassist.js`)

**Motion Types**:
- `root-5th`: Alternates root and fifth
- `walking`: Stepwise motion through scale
- `ostinato`: Repeated pattern

**Parameters**:
- `transpose`: Octave adjustment
- `rhythmPattern`: Timing (quarter, eighth, etc.)
- `humanizationIntensity`: Timing/velocity variation

#### Drummer (`components/instrumentalists/drummer.js`)

**Drum Styles**:
- `rock`: 4/4 backbeat
- `jazz-brush`: Swing feel with brushes
- `latin`: Clave-based patterns

**Parameters**:
- `swingAmount`: 0 = straight, 1 = maximum swing
- `humanizationIntensity`: Variation in timing/velocity

#### Soloist (`components/instrumentalists/soloist.js`)

**Playing Styles**:
- `melodic`: Follows melody planner output
- `arpeggio`: Arpeggiated chord tones
- `scalar`: Scale runs

**Parameters**:
- `noteRange`: `low`, `mid`, `high`
- `maxInterval`: Maximum leap (semitones)

#### Keyboardist (`components/instrumentalists/keyboardist.js`)

**Instrument Styles**:
- `piano`: Acoustic piano sound
- `rhodes`: Electric piano
- `organ`: Hammond-style organ

**Playing Approaches**:
- `comping`: Rhythmic chord stabs
- `pad`: Sustained chords
- `arpeggio`: Broken chords

---

## Control Systems

### 1. Whip Bindings

**Files**: `lib/whip_binding.js`, `lib/whip_manager.js`

Connect playhead scalar values (0-1) to component parameters.

#### Usage

```javascript
// Drag from playhead (round indicator) to parameter target light
// Creates binding:
{
    sourcePlayheadId: 'ph-1',
    targetComponentId: 'bassist',
    targetParameterId: 'transpose',
    mapping: {
        inputMin: 0,
        inputMax: 1,
        outputMin: -24,
        outputMax: 24
    }
}

// On playhead sample:
PubSub.publish('playhead:ph-1:value', {
    value: 0.75,  // Normalized
    rawValue: 42  // Original Y-value
});

// WhipManager updates parameter:
bassist.transpose = mapValue(0.75, 0, 1, -24, 24);  // = 12
```

#### Visual Feedback

- **Round whip source**: Playhead indicators
- **Target light**: Colored square next to parameter name
- **Drag line**: Shows connection being created
- **Active bindings**: Listed in parameter UI

### 2. Contour Bindings

**Files**: `lib/contour_binding.js`, `lib/contour_binding_manager.js`

Connect layer contour arrays to planner inputs.

#### Usage

```javascript
// Drag from layer (square indicator) to planner parameter
// Creates binding:
{
    sourceLayerId: 'layer-2',
    sourceVisualizerId: 'viz-1',
    targetComponentId: 'melody-planner',
    targetParameterId: 'melody_input'
}

// On layer compute:
const contour = layer.outputData;  // [{x: Date, y: number}, ...]
melodyPlanner.setInputContour({ points: contour });

// Planner automatically regenerates melody
```

#### Visual Feedback

- **Square whip source**: Layer indicators
- **Target light**: Square indicator on planner
- **Drag line**: Shows connection being created
- **Only one binding per target**: Prevents conflicts

### 3. Whippable Parameters

**File**: `lib/mixins/whippable_parameters.js`

Mixin that enables components to register parameters as binding targets.

#### Registration

```javascript
this.registerWhippableParameter('transpose', {
    label: 'Transpose',
    parameterType: 'number',
    min: -24,
    max: 24,
    elementSelector: '#transpose-slider',
    setter: (value) => {
        this.transpose = Math.round(value);
        this.updateUI();
    }
});
```

#### Parameter Types

- `number`: Scalar with min/max
- `select`: Discrete options
- `boolean`: On/off toggle

#### Target Light

Rendered automatically next to parameter:
```javascript
getTargetLightHTML(parameterId) {
    const binding = this.findBindingForParameter(parameterId);
    const color = binding ? binding.sourceColor : '#666';
    return `<div class="target-light" style="background: ${color}"></div>`;
}
```

---

## State Management

### Song Sections

**File**: `lib/song_section.js`

Complete serialization system for saving/restoring compositions.

#### Captured State

1. **Harmonic Context**: Pool, tonic, tempo, time signature, mood, density
2. **Layers**: All data and transform layers with outputData
3. **Playheads**: Positions, speeds, layer assignments, colors
4. **Contour Bindings**: Layer → parameter mappings
5. **Whip Bindings**: Playhead → parameter mappings
6. **Planners**: Melody/rhythm state and generated output
7. **Composer**: Style, progression, dot notation
8. **Instrumentalists**: All settings (motion, rhythm, transpose, etc.)
9. **Visualizer States**: Y-zoom levels

#### Restoration Order

Critical dependency order:
```
1. Harmonic Context (foundation)
2. Layers (data sources)
3. Playheads (depend on layers)
4. Whip Bindings (playhead → param)
5. Contour Bindings (layer → param)
6. Planners (recalculate from bindings)
7. Composer (harmonize melody)
8. Instrumentalists (apply settings)
9. Visualizer States (visual prefs)
```

#### Usage

```javascript
import { SongSection } from './lib/song_section.js';

// Capture
const section = new SongSection('My Composition');
await section.capture();

// Save to localStorage
section.saveToLocalStorage('my-song');

// Export to file
section.exportToFile();  // Downloads JSON

// Restore
const loaded = SongSection.loadFromLocalStorage('my-song');
await loaded.restore();

// Import from file
const section = await SongSection.importFromFile(file);
await section.restore();
```

#### Planner Recalculation

After restore, planners automatically recalculate:

```javascript
// 1.5 second delay for bindings to activate
setTimeout(() => {
    if (melodyPlanner.inputContour && melodyPlanner.tonicCenterContour) {
        melodyPlanner.generateMelodyFromContour();
        melodyPlanner.publishMelody();
    }
}, 500);
```

---

## API Reference

### MIDIClock

```javascript
import { midiClock } from './lib/midi_clock.js';

// Control
midiClock.start(bpm);
midiClock.stop();
midiClock.setBPM(140);
midiClock.reset();

// Query
const audioTime = midiClock.getAudioTime();
const ctx = midiClock.getAudioContext();
const tick = midiClock.getCurrentTick();
```

### LayerManager

```javascript
import { layerManager } from './lib/layer_manager.js';

// Add layer
const layer = layerManager.addLayer('viz-id', {
    name: 'My Layer',
    type: 'transform',
    transformType: 'fft_lowpass',
    inputLayerIds: ['base-layer'],
    transformParams: { cutoff: 0.1 }
});

// Compute
await layerManager.computeLayer(layer.id);

// Query
const layers = layerManager.getLayersForVisualizer('viz-id');
const layer = layerManager.getLayer('layer-id');

// Remove
layerManager.removeLayer('layer-id');
```

### ContourBindingManager

```javascript
import { contourBindingManager } from './lib/contour_binding_manager.js';

// Register binding
const binding = new ContourBinding({
    sourceLayerId: 'layer-2',
    targetComponentId: 'melody-planner',
    targetParameterId: 'melody_input'
});
contourBindingManager.registerBinding(binding);

// Query
const bindings = contourBindingManager.getBindingsForLayer('layer-2');

// Remove
contourBindingManager.removeBinding(binding.id);
```

### WhipManager

```javascript
import { WhipManager } from './lib/whip_manager.js';

// Create binding
const binding = new WhipBinding({
    sourcePlayheadId: 'ph-1',
    targetComponentId: 'bassist',
    targetParameterId: 'transpose'
});

// Register
WhipManager.registerBinding(binding);

// Query
const bindings = WhipManager.getBindingsForPlayhead('ph-1');

// Remove
WhipManager.removeBinding(binding.id);
```

### PubSub

```javascript
import { PubSub } from './lib/pubsub.js';

// Publish
PubSub.publish('topic:name', { data: 'value' });

// Subscribe
PubSub.subscribe('topic:name', (data) => {
    console.log(data);
}, context);

// Get last
const value = PubSub.last('topic:name');
```

---

## Browser Compatibility

### Required Features

- **Web Audio API**: Chrome 35+, Firefox 25+, Safari 14.1+
- **Web Workers**: All modern browsers
- **Web Components**: Chrome 67+, Firefox 63+, Safari 10.1+
- **D3.js**: All modern browsers
- **ES6 Modules**: All modern browsers

### Optional Features

- **Web MIDI API**: Chrome 43+, Edge 79+ (not supported in Firefox/Safari)
  - Fallback: Built-in Web Audio synthesis

### Performance

- **CPU**: Worker timing runs at 40Hz (very light)
- **Memory**: Event queue ~10-20 events max
- **Latency**: Sub-10ms MIDI scheduling with 100ms lookahead

---

## Testing

```bash
# Run all tests
npm test

# Specific test suites
npm test -- timing_worker.test.js
npm test -- song_section.test.js
npm test -- layer.test.js
npm test -- playhead.test.js
```

---

## Future Enhancements

- MIDI Clock slave mode (external sync)
- Adjustable lookahead time
- Web MIDI hardware integration
- Recording mode with timestamps
- Cloud storage integration
- Collaborative editing
- Undo/redo system
- Compression for large exports

---

**End of Guide**
