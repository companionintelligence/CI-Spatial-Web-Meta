/**
 * A 2D-canvas stand-in for unit tests. It records every text draw together with
 * the fill colour and font in force at that moment, so tests can assert what a
 * surface actually paints (for example, that a status line uses the canon colour).
 */
import { vi } from 'vitest';

export function fakeCanvas() {
  const draws = [];
  const ctx = {
    fillStyle: '', strokeStyle: '', font: '', lineWidth: 0, textBaseline: '',
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    roundRect: vi.fn(),
    arc: vi.fn(),
    drawImage: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    measureText: vi.fn((text) => ({ width: text.length * 8 })),
  };
  ctx.fillText = vi.fn((text) => draws.push({ text, fillStyle: ctx.fillStyle, font: ctx.font }));
  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL: () => 'data:image/jpeg;base64,QUJD',
    ctx,
    draws,
  };
}
