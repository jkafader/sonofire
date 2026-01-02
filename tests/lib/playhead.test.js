import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Playhead } from '../../lib/playhead.js';
import { PubSub } from '../../lib/pubsub.js';

describe('Playhead', () => {
    let playhead;
    const visualizerId = 'test-visualizer';

    beforeEach(() => {
        // Clear PubSub state before each test
        PubSub.clearAllCallbacks();

        // Create a fresh playhead instance
        playhead = new Playhead(visualizerId, {
            speed: 1,
            enabled: true,
            position: 0,
        });
    });

    describe('Constructor', () => {
        it('should create a playhead with default values', () => {
            const ph = new Playhead(visualizerId);

            expect(ph.visualizerId).toBe(visualizerId);
            expect(ph.speed).toBe(1);
            expect(ph.enabled).toBe(true);
            expect(ph.position).toBe(0);
            expect(ph.tickCounter).toBe(0);
            expect(ph.id).toMatch(/^ph-\d+-[a-z0-9]+$/);
        });

        it('should create a playhead with custom config', () => {
            const config = {
                id: 'custom-id',
                speed: 2,
                position: 100,
                enabled: false,
                color: '#ff0000',
            };
            const ph = new Playhead(visualizerId, config);

            expect(ph.id).toBe('custom-id');
            expect(ph.speed).toBe(2);
            expect(ph.position).toBe(100);
            expect(ph.enabled).toBe(false);
            expect(ph.color).toBe('#ff0000');
        });

        it('should generate a color from palette if not provided', () => {
            const ph = new Playhead(visualizerId);
            expect(Playhead.COLOR_PALETTE).toContain(ph.color);
        });
    });

    describe('Speed Multipliers', () => {
        it('should have correct speed multiplier values', () => {
            expect(Playhead.SPEED_MULTIPLIERS).toHaveLength(13);

            // Check some key values
            const speedValues = Playhead.SPEED_MULTIPLIERS.map(s => s.value);
            expect(speedValues).toContain(1/16);  // ÷16
            expect(speedValues).toContain(1/2);   // ÷2
            expect(speedValues).toContain(1);     // ×1
            expect(speedValues).toContain(2);     // ×2
            expect(speedValues).toContain(16);    // ×16
        });
    });

    describe('Advance Logic', () => {
        it('should advance once per tick when speed = 1', () => {
            playhead.speed = 1;

            expect(playhead.advance()).toBe(1);
            expect(playhead.advance()).toBe(1);
            expect(playhead.advance()).toBe(1);
        });

        it('should advance every 2 ticks when speed = 1/2', () => {
            playhead.speed = 1/2;

            expect(playhead.advance()).toBe(0);
            expect(playhead.tickCounter).toBe(1);
            expect(playhead.advance()).toBe(1);
            expect(playhead.tickCounter).toBe(0);
        });

        it('should advance every 4 ticks when speed = 1/4', () => {
            playhead.speed = 1/4;

            expect(playhead.advance()).toBe(0);
            expect(playhead.tickCounter).toBe(1);
            expect(playhead.advance()).toBe(0);
            expect(playhead.tickCounter).toBe(2);
            expect(playhead.advance()).toBe(0);
            expect(playhead.tickCounter).toBe(3);
            expect(playhead.advance()).toBe(1);
            expect(playhead.tickCounter).toBe(0);
        });

        it('should advance every 16 ticks when speed = 1/16', () => {
            playhead.speed = 1/16;

            // Advance 15 times - should not trigger
            for (let i = 0; i < 15; i++) {
                expect(playhead.advance()).toBe(0);
            }
            expect(playhead.tickCounter).toBe(15);

            // 16th tick should trigger
            expect(playhead.advance()).toBe(1);
            expect(playhead.tickCounter).toBe(0);
        });

        it('should advance twice per tick when speed = 2', () => {
            playhead.speed = 2;

            // Should return 2 (advance twice per tick)
            expect(playhead.advance()).toBe(2);
            expect(playhead.advance()).toBe(2);
            expect(playhead.advance()).toBe(2);
        });

        it('should advance 4 times per tick when speed = 4', () => {
            playhead.speed = 4;

            expect(playhead.advance()).toBe(4);
            expect(playhead.advance()).toBe(4);
        });

        it('should advance 8 times per tick when speed = 8', () => {
            playhead.speed = 8;

            expect(playhead.advance()).toBe(8);
        });

        it('should advance 16 times per tick when speed = 16', () => {
            playhead.speed = 16;

            expect(playhead.advance()).toBe(16);
        });

        it('should not advance when disabled', () => {
            playhead.enabled = false;

            expect(playhead.advance()).toBe(0);
            expect(playhead.tickCounter).toBe(0);
        });
    });

    describe('Position Management', () => {
        it('should set position', () => {
            playhead.setPosition(150);
            expect(playhead.position).toBe(150);
        });

        it('should update position independently of tick counter', () => {
            playhead.setPosition(100);
            playhead.advance();
            expect(playhead.position).toBe(100); // Position unchanged by advance
        });
    });

    describe('Speed Management', () => {
        it('should set speed and reset tick counter', () => {
            playhead.speed = 1/2;
            playhead.advance(); // tickCounter becomes 1
            expect(playhead.tickCounter).toBe(1);

            playhead.setSpeed(2);
            expect(playhead.speed).toBe(2);
            expect(playhead.tickCounter).toBe(0);
        });
    });

    describe('Enable/Disable', () => {
        it('should enable and disable playhead', () => {
            playhead.setEnabled(false);
            expect(playhead.enabled).toBe(false);
            expect(playhead.tickCounter).toBe(0);

            playhead.setEnabled(true);
            expect(playhead.enabled).toBe(true);
        });

        it('should reset tick counter when disabling', () => {
            playhead.speed = 1/2;
            playhead.advance(); // tickCounter becomes 1

            playhead.setEnabled(false);
            expect(playhead.tickCounter).toBe(0);
        });
    });

    describe('Value Sampling', () => {
        it('should sample value and publish to PubSub', () => {
            const publishSpy = vi.spyOn(PubSub, 'publish');

            const yValue = 150;
            const normalizedValue = 0.75;

            playhead.sampleValue(yValue, normalizedValue);

            expect(playhead.lastSampledValue).toBe(yValue);
            expect(publishSpy).toHaveBeenCalledWith(
                `playhead:${visualizerId}:${playhead.id}:value`,
                expect.objectContaining({
                    visualizerId: visualizerId,
                    playheadId: playhead.id,
                    value: normalizedValue,
                    rawValue: yValue,
                    position: playhead.position,
                    color: playhead.color,
                })
            );
        });
    });

    describe('Binding Management', () => {
        it('should add binding IDs', () => {
            playhead.addBinding('binding-1');
            playhead.addBinding('binding-2');

            expect(playhead.bindingIds).toContain('binding-1');
            expect(playhead.bindingIds).toContain('binding-2');
            expect(playhead.bindingIds).toHaveLength(2);
        });

        it('should not add duplicate binding IDs', () => {
            playhead.addBinding('binding-1');
            playhead.addBinding('binding-1');

            expect(playhead.bindingIds).toHaveLength(1);
        });

        it('should remove binding IDs', () => {
            playhead.addBinding('binding-1');
            playhead.addBinding('binding-2');

            playhead.removeBinding('binding-1');

            expect(playhead.bindingIds).not.toContain('binding-1');
            expect(playhead.bindingIds).toContain('binding-2');
            expect(playhead.bindingIds).toHaveLength(1);
        });
    });

    describe('Speed Label', () => {
        it('should return correct speed label for known values', () => {
            playhead.speed = 1/16;
            expect(playhead.getSpeedLabel()).toBe('÷16');

            playhead.speed = 1;
            expect(playhead.getSpeedLabel()).toBe('×1');

            playhead.speed = 2;
            expect(playhead.getSpeedLabel()).toBe('×2');
        });

        it('should return formatted label for unknown values', () => {
            playhead.speed = 5.5;
            expect(playhead.getSpeedLabel()).toBe('×5.5');
        });
    });

    describe('Serialization', () => {
        it('should serialize to JSON', () => {
            playhead.position = 200;
            playhead.speed = 2;
            playhead.color = '#ff0000';
            playhead.addBinding('binding-1');

            const json = playhead.toJSON();

            expect(json).toEqual({
                id: playhead.id,
                visualizerId: visualizerId,
                color: '#ff0000',
                speed: 2,
                position: 200,
                enabled: true,
                bindingIds: ['binding-1'],
            });
        });

        it('should deserialize from JSON', () => {
            const json = {
                id: 'test-id',
                visualizerId: 'viz-1',
                color: '#00ff00',
                speed: 4,
                position: 300,
                enabled: false,
            };

            const ph = Playhead.fromJSON(json);

            expect(ph.id).toBe('test-id');
            expect(ph.visualizerId).toBe('viz-1');
            expect(ph.color).toBe('#00ff00');
            expect(ph.speed).toBe(4);
            expect(ph.position).toBe(300);
            expect(ph.enabled).toBe(false);
        });

        it('should round-trip serialize/deserialize', () => {
            playhead.position = 150;
            playhead.speed = 1/2;
            playhead.addBinding('test-binding');

            const json = playhead.toJSON();
            const restored = Playhead.fromJSON(json);

            expect(restored.id).toBe(playhead.id);
            expect(restored.speed).toBe(playhead.speed);
            expect(restored.position).toBe(playhead.position);
            expect(restored.color).toBe(playhead.color);
        });
    });

    describe('Color Palette', () => {
        it('should have 16 distinct colors', () => {
            expect(Playhead.COLOR_PALETTE).toHaveLength(16);

            // Check all are unique
            const uniqueColors = new Set(Playhead.COLOR_PALETTE);
            expect(uniqueColors.size).toBe(16);
        });

        it('should have valid hex colors', () => {
            Playhead.COLOR_PALETTE.forEach(color => {
                expect(color).toMatch(/^#[0-9a-f]{6}$/i);
            });
        });
    });
});
