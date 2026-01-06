# Sonofire - Data Sonification System

A modular, event-driven web component system for converting data visualizations into musical performances through probabilistic composition and modal harmony.

## Features

- **Pool/Tonic Notation System**: Musical representation using pool keys (e.g., "3♯", "0", "2♭") and tonic centers
- **Modal Harmonization**: Complete support for all 7 modes (Ionian, Dorian, Phrygian, Lydian, Mixolydian, Aeolian, Locrian)
- **Probabilistic Chord Progressions**: Harmonic function-based chord generation with style modifiers (jazz, pop, blues, folk)
- **Multiple Playheads**: Each visualizer supports multiple independent playheads with configurable speeds
- **Parameter Automation ("Whip Controls")**: Drag-and-drop bindings from playheads to component parameters
- **Event-Driven Architecture**: PubSub system for loose coupling between components
- **Dual Audio Output**: MIDI output (Web MIDI API) and Web Audio synthesis

## Quick Start

1. **Start the development server:**
   ```bash
   make serve
   ```

2. **Open in browser:**
   ```
   http://localhost:8080
   ```

3. **Initialize audio outputs:**
   Click "Initialize Audio Outputs" to enable MIDI and/or Web Audio

4. **Start playback:**
   Use the Conductor's Play button to start the MIDI Clock

## Architecture

### Components

#### Controllers
- **Conductor** (`sonofire-conductor`) - Manages harmonic context (pool/tonic), tempo, mood, spareness
- **Composer** (`sonofire-composer`) - Generates probabilistic chord progressions

#### Visualizers
- **XY Plot** (`sonofire-xy-plot`) - 2D scatter plot with playhead scanning
- **Playhead Manager** (`sonofire-playhead-manager`) - Manages multiple playheads per visualizer

#### Instrumentalists
- **Soloist** (`sonofire-soloist`) - Melodic lead instrument
- **Bassist** (`sonofire-bassist`) - Bass line generation (walking bass, root notes, pedal)
- **Drummer** (`sonofire-drummer`) - Algorithmic drum patterns

### Core Libraries

- **`lib/pubsub.js`** - Event pub/sub system with `PubSub.last()` for state discovery
- **`lib/midi_clock.js`** - High-precision MIDI clock (configurable BPM and PPQN)
- **`lib/harmonic_context.js`** - Pool/tonic notation and key/scale management
- **`lib/music_theory.js`** - Modal harmonization, chord voicing, progression generation
- **`lib/audio_router.js`** - Dual audio output routing (MIDI + Web Audio)
- **`lib/playhead.js`** - Playhead state management with speed multipliers
- **`lib/whip_manager.js`** - Parameter automation binding system

## Pool/Tonic Notation

Traditional key/scale notation (e.g., "D major") has been replaced with pool/tonic notation:

- **Pool Key**: Defines the 7-note collection (e.g., "3♯" = A major scale notes)
- **Tonic**: Defines which note is the tonal center (e.g., "A" for A Ionian, "F♯" for F♯ Aeolian)

### Examples

| Pool/Tonic | Traditional Name | Mode |
|------------|------------------|------|
| `0/C` | C major | Ionian |
| `0/A` | A minor | Aeolian |
| `0/D` | D dorian | Dorian |
| `3♯/A` | A major | Ionian |
| `3♯/F♯` | F♯ minor | Aeolian |
| `3♯/C♯` | C♯ phrygian | Phrygian |
| `2♯/D` | D major | Ionian |

### Circle of Fifths (Pools)

```
6♯ = F♯ major scale
5♯ = B major scale
4♯ = E major scale
3♯ = A major scale
2♯ = D major scale
1♯ = G major scale
0  = C major scale
1♭ = F major scale
2♭ = B♭ major scale
3♭ = E♭ major scale
4♭ = A♭ major scale
5♭ = D♭ major scale
```

## Modal Harmonization

Each mode has unique chord qualities for each scale degree:

### Ionian (Major)
`I maj7, ii min7, iii min7, IV maj7, V7, vi min7, vii min7♭5`

### Dorian
`i min7, ii min7, ♭III maj7, IV7, v min7, vi min7♭5, ♭VII maj7`

### Phrygian
`i min7, ♭II maj7, ♭III7, iv min7, v min7♭5, ♭VI maj7, ♭vii min7`

### Lydian
`I maj7, II7, iii min7, ♯iv min7♭5, V maj7, vi min7, vii min7`

### Mixolydian
`I7, ii min7, iii min7♭5, IV maj7, v min7, vi min7, ♭VII maj7`

### Aeolian (Natural Minor)
`i min7, ii min7♭5, ♭III maj7, iv min7, v min7, ♭VI maj7, ♭VII7`

### Locrian
`i min7♭5, ♭II maj7, ♭iii min7, iv min7, ♭V maj7, ♭VI7, ♭vii min7`

## Running Tests

Sonofire includes comprehensive automated tests for modal harmonization and chord generation.

### Test Suite Index

Open `tests/index.html` in your browser to access all tests.

Or visit individual test files:

1. **Modal Harmonization Tests** (`tests/music_theory_test.html`)
   - Tests all 7 modal harmonization tables
   - 80+ assertions covering chord qualities, mode detection, edge cases
   - Validates pool/tonic to mode conversion

2. **Composer Integration Tests** (`tests/composer_integration_test.html`)
   - Tests actual chord progression generation
   - All 7 modes in pools 0 and 3♯
   - **Critical regression test**: Verifies 3♯/F♯ generates F♯m7 (not F♯maj7)

3. **Phase 1 Tests** (`tests/phase1_test.html`)
   - Core infrastructure tests (PubSub, MIDI Clock, Audio Router)

### Running Tests

```bash
# Start dev server
make serve

# Open test suite
open http://localhost:8080/tests/
```

Tests run automatically on page load and display results with ✓/✗ indicators.

### Expected Results

**All tests should pass.** If any fail:
- Check browser console for detailed error messages
- Failed tests show expected vs. actual values
- Fix the underlying code and re-run

## PubSub Topics

### Harmonic Context
- `context:pool` - Pool/tonic changes `{ poolKey, tonicNote, tonicName, notes }`
- `context:mood` - Mood changes `{ mood: 'tense'|'relaxed'|'sparse'|'dense' }`
- `context:spareness` - Spareness level `{ spareness: 0.0-1.0 }`

### Musical Events
- `music:chord` - Chord changes `{ chord, root, quality, voicing, poolKey, tonicNote, scaleDegree }`
- `clock:tick` - MIDI clock ticks `{ tick, timestamp, ppqn }`
- `clock:tempo` - Tempo changes `{ bpm }`

### Data Events
- `data:point` - Data point sampled `{ x, y, value, note, timestamp, source }`
- `playhead:{visualizerId}:{playheadId}:value` - Playhead sampled value

### Transport
- `transport:play` - Start playback `{ timestamp }`
- `transport:stop` - Stop playback `{ timestamp }`
- `transport:rewind` - Rewind to beginning `{ timestamp }`

## Configuration

### Conductor Attributes

```html
<sonofire-conductor
    data-pool="3♯"
    data-tonic="A"
    data-tempo="120"
    data-mode="manual">
</sonofire-conductor>
```

### Composer Attributes

```html
<sonofire-composer
    data-progression-style="jazz"
    data-bars-per-chord="4"
    data-progression-length="4"
    data-use-probabilistic="true">
</sonofire-composer>
```

### Soloist Attributes

```html
<sonofire-soloist
    data-channel="0"
    data-style="melodic"
    data-note-range="mid"
    data-max-interval="7"
    data-enabled="true">
</sonofire-soloist>
```

## Component Lifecycle

All components follow this startup pattern:

1. **`connectedCallback()`** - Component connects to DOM
2. **`parseAttributes()`** - Read HTML attributes
3. **`discoverOperationalModes()`** - Use `PubSub.last()` to discover current state
4. **`setupSubscriptions()`** - Subscribe to relevant PubSub topics
5. **`render()`** - Render initial UI

This allows components to start in any order and discover the current system state.

## Development

### File Structure

```
sonofire/
├── components/
│   ├── base/
│   │   ├── sonofire_base.js
│   │   └── sonofire_visualizer_base.js
│   ├── controllers/
│   │   ├── conductor.js
│   │   └── composer.js
│   ├── instrumentalists/
│   │   ├── base_instrumentalist.js
│   │   ├── soloist.js
│   │   ├── bassist.js
│   │   └── drummer.js
│   └── visualizers/
│       └── xy_plot.js
├── lib/
│   ├── pubsub.js
│   ├── midi_clock.js
│   ├── harmonic_context.js
│   ├── music_theory.js
│   ├── audio_router.js
│   ├── playhead.js
│   └── whip_manager.js
├── tests/
│   ├── index.html
│   ├── music_theory_test.html
│   ├── composer_integration_test.html
│   └── phase1_test.html
└── index.html
```

### Making Changes

1. **Update music theory**: Edit `lib/music_theory.js`
2. **Run tests**: Open `tests/index.html`
3. **Verify in UI**: Open `index.html` and test manually

### Adding New Modes

To add support for additional modes:

1. Add harmonization table to `music_theory.js::getChordQualityForDegreeInPool()`
2. Add mode name to `modeNames` array in composer and conductor
3. Add test cases to `tests/music_theory_test.html`

## Known Issues

### Fixed Issues

- ✅ **Pool/tonic mode detection**: Fixed pitch class ordering to start from pool's major tonic
- ✅ **F♯ Aeolian harmonization**: Fixed to generate F♯m7 instead of F♯maj7
- ✅ **PubSub hash collision**: Fixed component subscription deduplication using WeakMap context IDs

## Contributing

1. Follow existing code style (ES6 modules, web components)
2. Add tests for new features
3. Update documentation
4. Ensure all existing tests pass

## License

[Your license here]

## Credits

Built with:
- D3.js for data visualization
- Web MIDI API for MIDI output
- Web Audio API for synthesis
