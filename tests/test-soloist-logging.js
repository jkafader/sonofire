/**
 * Quick demo of soloist logging behavior
 * Run with: node tests/test-soloist-logging.js
 */

// Mock the required imports
class MockHarmonicContext {
    midiToNoteName(midiNote) {
        const pitchClass = midiNote % 12;
        const sharpNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
        return sharpNames[pitchClass];
    }
}

class MockSoloist {
    constructor() {
        this.currentScale = [60, 62, 64, 65, 67, 69, 71]; // C major: C D E F G A B
        this.poolKey = '0';
        this.harmonicContext = new MockHarmonicContext();
    }

    isInScale(note) {
        const pitchClass = note % 12;
        const scalePitchClasses = this.currentScale.map(n => n % 12);
        return scalePitchClasses.includes(pitchClass);
    }

    logNoteContext(note, source) {
        const noteName = this.harmonicContext.midiToNoteName(note);
        const octave = Math.floor(note / 12) - 1;
        const inScale = this.isInScale(note);
        const scaleStatus = inScale ? '✓ IN POOL' : '✗ OUT OF POOL';

        const poolNotes = this.currentScale.map(n => this.harmonicContext.midiToNoteName(n)).join(' ');

        console.log(`Soloist [${source}]: ${noteName}${octave} (MIDI ${note}) ${scaleStatus}`);
        if (!inScale) {
            console.warn(`  ⚠️  Current pool (${this.poolKey}): ${poolNotes}`);
        }
    }
}

// Demo
console.log('=== Soloist Logging Demo ===\n');

const soloist = new MockSoloist();

console.log('1. Notes IN the pool (C major):');
soloist.logNoteContext(60, 'Data');  // C
soloist.logNoteContext(62, 'Data');  // D
soloist.logNoteContext(64, 'Data');  // E
soloist.logNoteContext(67, 'Whip Automation');  // G

console.log('\n2. Notes OUT OF the pool:');
soloist.logNoteContext(61, 'Data');  // C♯ - NOT in C major
soloist.logNoteContext(63, 'Data');  // D♯ - NOT in C major
soloist.logNoteContext(66, 'Data (dev: 0.85)');  // F♯ - NOT in C major (high deviation)

console.log('\n3. Mixed:');
soloist.logNoteContext(69, 'Data');  // A - IN pool
soloist.logNoteContext(70, 'Data');  // A♯ - OUT of pool
soloist.logNoteContext(71, 'Whip Automation');  // B - IN pool
