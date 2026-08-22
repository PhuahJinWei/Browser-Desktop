import { describe, expect, it } from 'vitest';
import {
  classifyTier,
  preferredBackend,
  probeCapabilities,
  type Capabilities,
  type GpuCapability,
} from './capabilities';

const gpu = (overrides: Partial<GpuCapability> = {}): GpuCapability => ({
  available: true,
  fallbackAdapter: false,
  shaderF16: true,
  maxBufferBytes: 2 ** 31,
  ...overrides,
});

describe('classifyTier', () => {
  it('puts machines without WebGPU in tier C', () => {
    const { tier } = classifyTier(gpu({ available: false }), 32, 16);
    expect(tier).toBe('C');
  });

  it('treats a software fallback adapter as tier C', () => {
    // A fallback adapter reports as WebGPU but is a CPU rasteriser; scheduling GPU work on it
    // is slower than the WASM path, so it must not count as GPU capability.
    const { tier, reason } = classifyTier(gpu({ fallbackAdapter: true }), 32, 16);
    expect(tier).toBe('C');
    expect(reason).toMatch(/fallback/i);
  });

  it('gives tier A to a roomy machine with large buffers', () => {
    expect(classifyTier(gpu(), 16, 12).tier).toBe('A');
  });

  it('drops to tier B when memory is small', () => {
    expect(classifyTier(gpu(), 4, 12).tier).toBe('B');
  });

  it('drops to tier B when max buffer size is small', () => {
    expect(classifyTier(gpu({ maxBufferBytes: 256 * 1024 * 1024 }), 32, 16).tier).toBe('B');
  });

  it('falls back to core count when device memory is not reported', () => {
    // Firefox and Safari do not expose navigator.deviceMemory.
    expect(classifyTier(gpu(), undefined, 12).tier).toBe('A');
    expect(classifyTier(gpu(), undefined, 4).tier).toBe('B');
  });
});

describe('preferredBackend', () => {
  const caps = (overrides: Partial<Capabilities>): Capabilities =>
    ({
      gpu: gpu(),
      wasm: { simd: true, threads: true },
      crossOriginIsolated: true,
      ...overrides,
    }) as Capabilities;

  it('prefers threaded WASM for text embeddings', () => {
    // M0 measured WASM ~2.2x faster than WebGPU for a small int8 encoder; the default has to
    // follow the measurement rather than the assumption that GPU always wins.
    expect(preferredBackend(caps({}), 'text-embedding')).toBe('wasm');
  });

  it('prefers the GPU for heavier models', () => {
    expect(preferredBackend(caps({}), 'image-text-embedding')).toBe('webgpu');
    expect(preferredBackend(caps({}), 'speech-recognition')).toBe('webgpu');
  });

  it('falls back to the GPU for embeddings when threads are unavailable', () => {
    expect(preferredBackend(caps({ crossOriginIsolated: false }), 'text-embedding')).toBe('webgpu');
  });

  it('uses WASM when there is no usable GPU', () => {
    const noGpu = caps({ gpu: gpu({ available: false }), crossOriginIsolated: false });
    expect(preferredBackend(noGpu, 'speech-recognition')).toBe('wasm');
  });
});

describe('probeCapabilities', () => {
  it('degrades to a usable result outside a browser', async () => {
    // Guards the contract that every probe answers false rather than throwing, which is what
    // keeps boot from dying on an unexpected platform.
    const caps = await probeCapabilities();
    expect(caps.gpu.available).toBe(false);
    expect(caps.tier).toBe('C');
    expect(caps.storage.opfs).toBe(false);
    expect(caps.builtinAi.promptApi).toBe(false);
    expect(preferredBackend(caps)).toBe('wasm');
    expect(typeof caps.probedAt).toBe('string');
  });

  it('detects WebAssembly features in Node', async () => {
    // Node has full WASM support, so this asserts the detector actually validates modules
    // rather than always returning false.
    const caps = await probeCapabilities();
    expect(caps.wasm.simd).toBe(true);
    expect(caps.wasm.threads).toBe(true);
  });
});
