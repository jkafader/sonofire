# Soloist Note Generation - Complete Trace

This document traces all paths that generate notes in the Soloist component, showing every transformation applied.

---

## PATH 1: Whip Automation (`generateAndPlayNote()`)

**Trigger**: Whip binding from playhead → `noteGeneration` parameter (line 133-142)

### Step-by-Step Process:

#### 1. Initial Note Selection (Lines 228-248)

**Case 1A: First note ever (`lastNote === null`)**
```javascript
if (this.currentChord?.root) {
    // Get pitch class and place in middle of soloist's range
    const pitchClass = this.currentChord.root % 12;
    const middleOctave = Math.floor((this.minNote + this.maxNote) / 24) * 12;
    note = middleOctave + pitchClass;

    // Ensure it's in range
    while (note < this.minNote) note += 12;
    while (note > this.maxNote) note -= 12;
}
```
- Takes chord root's pitch class
- Places it in middle octave of soloist's range
- Adjusts octave to fit within `minNote`-`maxNote`
- ⚠️ **ISSUE**: Does NOT quantize to scale! Uses raw chord root pitch class

**Case 1B: First note, no chord available**
```javascript
else if (this.currentScale?.length > 0) {
    note = this.currentScale[0];

    // Adjust to soloist's range
    while (note < this.minNote) note += 12;
    while (note > this.maxNote) note -= 12;
}
```
- Uses first note from `currentScale`
- Adjusts octave to fit range
- ✓ Safe: Uses note from scale

**Case 1C: First note, no scale data**
```javascript
else {
    note = 60; // Default to middle C
}
```
- ⚠️ **ISSUE**: Middle C might not be in the current pool!

---

#### 2. Subsequent Notes - Chord Tone Bias (Lines 251-257)

**60% probability path:**
```javascript
if (this.currentChord?.voicing && Math.random() < 0.6) {
    const chordTones = this.currentChord.voicing;
    note = chordTones[Math.floor(Math.random() * chordTones.length)];

    // Adjust to current octave range
    while (note < this.lastNote - 12) note += 12;
    while (note > this.lastNote + 12) note -= 12;
}
```
- Picks random note from chord voicing
- Adjusts to be within ±1 octave of last note
- ✓ Safe: Chord voicings should be in pool (from Composer)

---

#### 3. Subsequent Notes - Scale-Based Motion (Lines 258-264)

**40% probability path:**
```javascript
else {
    // Use scale-based melodic motion
    const direction = Math.random() < 0.5 ? 1 : -1;
    const stepSize = Math.floor(Math.random() * 3) + 1; // 1-3 scale steps
    note = this.lastNote + (direction * stepSize * 2); // Approximately scale steps
    note = this.getNearestScaleNote(note);
}
```
- Random direction (up/down)
- Random step size (1-3 scale steps)
- Multiplies by 2 (approximate whole steps)
- ⚠️ **ISSUE**: `stepSize * 2` assumes whole tone steps, not scale steps!
  - Example: Moving 3 scale steps = +6 semitones
  - But in major scale, 3 steps could be +5 semitones (C→F) or +7 semitones (C→G)
- Then quantizes via `getNearestScaleNote()`
- ✓ Quantization makes it safe

---

#### 4. Interval Constraint (Line 267)

```javascript
note = constrainInterval(this.lastNote, note, this.maxInterval);
```

**From `lib/generative_algorithms.js`:**
```javascript
export function constrainInterval(fromNote, toNote, maxInterval) {
    const interval = Math.abs(toNote - fromNote);

    if (interval > maxInterval) {
        // Interval too large, bring it closer
        const direction = toNote > fromNote ? 1 : -1;
        return fromNote + (direction * maxInterval);
    }

    return toNote;
}
```
- Limits melodic jumps to `maxInterval` semitones
- ⚠️ **ISSUE**: If `maxInterval` forces a chromatic interval, the note might be out of pool!
  - Example: `lastNote = 60` (C), `note = 72` (C), `maxInterval = 7`
  - Constrained to `60 + 7 = 67` (G), which IS in C major ✓
  - But if `lastNote = 60` (C), `note = 71` (B), `maxInterval = 5`
  - Constrained to `60 + 5 = 65` (F), which IS in C major ✓
  - Actually this works because it just limits distance, doesn't pick specific semitones

---

#### 5. Quantization to Scale (Line 271)

```javascript
note = this.getNearestScaleNote(note);
```

**From `base_instrumentalist.js` (lines 228-256):**
```javascript
getNearestScaleNote(note) {
    if (this.currentScale.length === 0) return note; // ⚠️ No quantization if scale empty!

    // Get pitch classes from scale (0-11)
    const scalePitchClasses = [...new Set(this.currentScale.map(n => n % 12))];

    // Check if note is already in scale
    const notePitchClass = note % 12;
    if (scalePitchClasses.includes(notePitchClass)) {
        return note; // Already in scale
    }

    // Find nearest pitch class
    let closestPC = scalePitchClasses[0];
    let minDistance = Math.min(
        Math.abs(notePitchClass - closestPC),
        12 - Math.abs(notePitchClass - closestPC) // Wraparound distance
    );

    scalePitchClasses.forEach(pc => {
        const distance = Math.min(
            Math.abs(notePitchClass - pc),
            12 - Math.abs(notePitchClass - pc)
        );

        if (distance < minDistance) {
            minDistance = distance;
            closestPC = pc;
        }
    });

    // Construct note with closest pitch class
    const octave = Math.floor(note / 12);
    return octave * 12 + closestPC;
}
```
- ⚠️ **CRITICAL ISSUE**: If `currentScale.length === 0`, returns note unchanged!
- Otherwise, finds nearest pitch class in scale
- ✓ Returns note in correct octave with quantized pitch class

---

#### 6. Range Clamping (Line 274)

```javascript
note = Math.max(this.minNote, Math.min(this.maxNote, note));
```
- Hard clamp to `[minNote, maxNote]`
- ⚠️ **CRITICAL ISSUE**: This happens AFTER quantization!
  - Example: `getNearestScaleNote()` returns 74 (D5, in pool)
  - But `maxNote = 73` (C#5)
  - Clamping produces 73
  - If C#5 is NOT in pool (e.g., pool 0/C = C major, no C#), note is now out of pool!

---

#### 7. Note Output (Lines 276-285)

```javascript
const velocity = this.nextNoteVelocity || 80;
const baseDuration = 300;
const duration = baseDuration * (1 + this.spareness);

this.sendNote(note, velocity, duration);
this.lastNote = note;

this.logNoteContext(note, 'Whip Automation');
```
- Uses velocity from whip binding or default 80
- Duration scales with spareness
- ✓ Logs whether note is in pool or not

---

## PATH 2: Data Point Event (`handleDataPoint()`)

**Trigger**: PubSub event `data:point` from visualizers (line 103-105)

### Step-by-Step Process:

#### 1. Initial Note from Data (Lines 297-303)

```javascript
let note = data.note;

if (!note && data.value !== undefined) {
    // Map value directly to pitch (primary data-to-pitch mapping)
    note = this.mapValueToNote(data.value);
}
```

**`mapValueToNote()` (lines 377-384):**
```javascript
mapValueToNote(value) {
    // Normalize value (assuming 0-1 range)
    const normalizedValue = Math.max(0, Math.min(1, value));
    const note = Math.floor(this.minNote + normalizedValue * (this.maxNote - this.minNote));
    return note;
}
```
- Maps normalized value (0-1) to note range
- ⚠️ **ISSUE**: Direct linear mapping, no quantization to pool!
- Returns any chromatic note within range

---

#### 2. Melodic Smoothing (Lines 306-309)

```javascript
if (this.lastNote !== null) {
    note = constrainInterval(this.lastNote, note, this.maxInterval);
}
```
- Same as whip path: limits jump size
- ⚠️ Can produce chromatic notes

---

#### 3. Quantization to Scale (Line 312)

```javascript
note = this.getNearestScaleNote(note);
```
- ✓ Quantizes to pool (if `currentScale` has notes)
- ⚠️ If `currentScale.length === 0`, no quantization!

---

#### 4. Chord Tone Adjustment (Lines 316-329)

```javascript
if (this.currentChord?.voicing && Math.random() < 0.3) {
    const chordTones = this.currentChord.voicing;
    for (const chordTone of chordTones) {
        const distance = Math.abs((note % 12) - (chordTone % 12));
        if (distance <= 2 && distance > 0) {
            // Within 2 semitones of a chord tone - occasionally adjust to it
            const adjustedNote = note + (chordTone % 12) - (note % 12);
            if (this.isInScale(adjustedNote)) {
                note = adjustedNote;
                break;
            }
        }
    }
}
```
- 30% chance to adjust to nearby chord tone
- Only if within 2 semitones
- ✓ Checks `isInScale()` before applying
- ✓ Safe

---

#### 5. Dissonance Application (Lines 332-339)

**ONLY if forecast data exists:**
```javascript
if (this.hasForecastData && this.currentDeviation !== null) {
    note = this.applyDissonance(note, this.currentDeviation);

    // After applying dissonance, quantize back to scale if deviation is low
    if (this.currentDeviation < 0.2) {
        note = this.getNearestScaleNote(note);
    }
}
```

**`applyDissonance()` (lines 392-418):**
```javascript
applyDissonance(note, deviation) {
    if (deviation < 0.2) {
        // Low deviation: consonant (keep note as-is)
        return note;
    } else if (deviation < 0.5) {
        // Medium deviation: mildly dissonant
        if (Math.random() < 0.3) {
            return note + (Math.random() < 0.5 ? 1 : 2); // +1 or +2 semitones
        }
        return note;
    } else if (deviation < 0.8) {
        // High deviation: dissonant
        if (Math.random() < 0.5) {
            return note + (Math.random() < 0.5 ? -1 : 1); // ±1 semitone
        }
        return note;
    } else {
        // Very high deviation: very dissonant
        if (Math.random() < 0.7) {
            return note + Math.floor(Math.random() * 3) - 1; // -1, 0, or +1
        }
        return note;
    }
}
```

**Analysis:**
- ⚠️ **CRITICAL ISSUE**: Adds chromatic alterations (+1, +2, -1 semitones)
- Only re-quantizes if `deviation < 0.2`
- If `deviation >= 0.2`, chromatic notes are INTENTIONALLY left out-of-pool for "dissonance"
- **This is the primary source of out-of-pool notes!**

---

#### 6. Range Clamping (Line 342)

```javascript
note = Math.max(this.minNote, Math.min(this.maxNote, note));
```
- ⚠️ **CRITICAL ISSUE**: Same as whip path - clamping AFTER quantization can produce out-of-pool notes

---

#### 7. Velocity & Duration Calculation (Lines 345-348)

```javascript
const velocity = this.calculateVelocity(data);
const duration = this.calculateDuration();
```
- ✓ No impact on pitch

---

#### 8. Note Output (Lines 351-356)

```javascript
this.sendNote(note, velocity, duration);

const source = this.hasForecastData ?
    `Data (dev: ${this.currentDeviation?.toFixed(2) || 'N/A'})` : 'Data';
this.logNoteContext(note, source);
```
- ✓ Logs with deviation info

---

## PATH 3: Forecast Data (`handleForecastData()`)

**Trigger**: PubSub event `data:forecast` (line 108-110)

```javascript
handleForecastData(data) {
    if (data.deviation !== undefined) {
        this.currentDeviation = Math.min(data.deviation, 1.0);
        this.hasForecastData = true;
    }
}
```
- Just sets flags, doesn't generate notes
- Affects dissonance in PATH 2

---

## CRITICAL ISSUES IDENTIFIED

### Issue 1: Empty Scale Check
**Location**: `base_instrumentalist.js` line 229
```javascript
if (this.currentScale.length === 0) return note;
```
- If `currentScale` is empty, ALL quantization is bypassed
- **Check**: Are you receiving `context:pool` events with notes?

### Issue 2: Clamping After Quantization
**Locations**:
- `soloist.js` line 274 (whip path)
- `soloist.js` line 342 (data path)

**Example failure:**
1. Pool 0/C (C major): C D E F G A B
2. `maxNote = 73` (C#5)
3. `getNearestScaleNote(74)` returns 74 (D5) ✓ in pool
4. Clamp: `Math.min(73, 74)` = 73 (C#5) ✗ NOT in pool!

### Issue 3: Dissonance by Design
**Location**: `soloist.js` lines 332-339, 392-418

- Intentionally adds chromatic notes when `deviation >= 0.2`
- Only re-quantizes if `deviation < 0.2`
- **Is forecast data active?** Check console for "Data (dev: X.XX)"

### Issue 4: First Note Selection
**Location**: `soloist.js` lines 232-246

- Case 1A: Uses chord root pitch class without checking pool
- Case 1C: Defaults to middle C (60) without checking pool

### Issue 5: Scale Motion Approximation
**Location**: `soloist.js` line 262
```javascript
note = this.lastNote + (direction * stepSize * 2); // Approximately scale steps
```
- Multiplies by 2 assuming whole steps
- Not accurate for all scale intervals
- But gets quantized afterward, so probably OK

---

## RECOMMENDATIONS

### Immediate Checks:

1. **Check console logs** when soloist plays out-of-pool notes:
   - Does it show "Data (dev: X.XX)" → Dissonance active!
   - Does it show "Whip Automation" → Check clamping issue
   - What does "⚠️ Current pool" show? Is the scale empty?

2. **Check if forecast data is active:**
   ```javascript
   console.log('Has forecast data:', this.hasForecastData);
   console.log('Current deviation:', this.currentDeviation);
   ```

3. **Check if scale is being received:**
   ```javascript
   console.log('Current scale length:', this.currentScale.length);
   console.log('Current scale notes:', this.currentScale);
   ```

### Proposed Fixes:

**Fix 1: Clamp BEFORE quantization**
```javascript
// Clamp first
note = Math.max(this.minNote, Math.min(this.maxNote, note));

// Then quantize (has final say)
note = this.getNearestScaleNote(note);
```

**Fix 2: Always quantize after dissonance**
```javascript
if (this.hasForecastData && this.currentDeviation !== null) {
    note = this.applyDissonance(note, this.currentDeviation);
    // Always quantize, not just when deviation < 0.2
    note = this.getNearestScaleNote(note);
}
```

**Fix 3: Safe first note selection**
```javascript
if (this.lastNote === null) {
    if (this.currentScale?.length > 0) {
        // Use first scale note, adjusted to range
        note = this.currentScale[0];
        while (note < this.minNote) note += 12;
        while (note > this.maxNote) note -= 12;
    } else if (this.currentChord?.root) {
        // Use chord root, then quantize
        note = this.currentChord.root;
        note = this.getNearestScaleNote(note);
    } else {
        note = 60; // Fallback
    }
}
```

---

## FLOW DIAGRAMS

### Whip Automation Flow:
```
Playhead triggers whip → noteGeneration parameter
    ↓
generateAndPlayNote()
    ↓
Select note (first time: chord root/scale note/60, subsequent: chord tone or scale motion)
    ↓
constrainInterval() → limit jump size
    ↓
getNearestScaleNote() → quantize to pool ✓
    ↓
CLAMP to range ⚠️ Can produce out-of-pool notes!
    ↓
sendNote()
```

### Data Point Flow:
```
Visualizer emits data:point
    ↓
handleDataPoint()
    ↓
mapValueToNote() → linear mapping (chromatic)
    ↓
constrainInterval() → limit jump size
    ↓
getNearestScaleNote() → quantize to pool ✓
    ↓
Chord tone adjustment (30% chance, checks pool) ✓
    ↓
applyDissonance() if forecast data ⚠️ ADDS CHROMATIC NOTES!
    ↓
Re-quantize ONLY if deviation < 0.2 ⚠️
    ↓
CLAMP to range ⚠️ Can produce out-of-pool notes!
    ↓
sendNote()
```

---

## QUESTIONS FOR USER:

1. **Are you seeing forecast deviation values in the console?**
   - If yes → Dissonance is intentionally adding chromatic notes

2. **What does the log show for out-of-pool notes?**
   - Check "⚠️ Current pool" line
   - Check "⚠️ Scale length" line

3. **Which generation path is producing out-of-pool notes?**
   - "Whip Automation" → Clamping issue
   - "Data (dev: X.XX)" → Dissonance issue
   - "Data" → mapValueToNote() or clamping issue

4. **Do you want dissonance to stay chromatic or be quantized?**
   - Musical choice: Should high forecast deviation sound "wrong" (chromatic)?
   - Or should it stay in-pool but use chord extensions (7ths, 9ths)?
