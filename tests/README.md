# Sonofire Test Suite

## Phase 1: Layer System Tests

This directory contains automated tests for the Sonofire layer system.

### Test Files

1. **`layer.test.js`** - Tests for Layer class
   - Layer creation (data and transform layers)
   - Serialization/deserialization
   - Color generation
   - Default values

2. **`layer_manager.test.js`** - Tests for LayerManager
   - Adding/removing layers
   - Layer organization by visualizer
   - Topological sorting (dependency resolution)
   - Circular dependency detection
   - Multi-input transforms

3. **`transforms.test.js`** - Tests for transform algorithms
   - Peak detection
   - Outlier detection (MAD threshold)
   - Moving average
   - Windowed average
   - Static average
   - Percentile
   - Difference (normal, inverted, absolute)
   - Intersections
   - FFT filters (conceptual tests)

### Running Tests

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run tests in watch mode (re-run on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

### Test Coverage

Current test coverage:
- ✅ Layer creation and properties
- ✅ Layer serialization
- ✅ LayerManager operations
- ✅ Dependency resolution (topological sort)
- ✅ Transform algorithm correctness
- ✅ Multi-input transforms
- ✅ Edge cases (circular dependencies, empty data)

### Future Test Additions

For Phase 2 and beyond:
- Contour binding creation/removal
- Drag-and-drop simulation
- Rhythm planner pattern generation
- Melody planner note quantization
- Integration tests with full component stack

### Notes

- Tests use Vitest with ES modules support
- Transform worker tests use copied logic (not actual Web Worker)
- Some UI tests would require jsdom/browser environment
- Current tests focus on core logic and algorithms
