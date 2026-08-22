import { createContext, useContext, type ReactNode } from 'react';
import { preferredBackend, type Capabilities, type InferenceTask } from '../kernel/capabilities';
import type { WorkerCapabilities } from '../kernel/worker-probe';
import type { BootResult } from '../kernel/boot';
import { settingsStore } from '../kernel/settings';

/**
 * What the boot probe learned, available to the whole shell.
 *
 * Passed through context rather than re-probed: `requestAdapter()` is not free, and every
 * consumer must agree on the answer — a taskbar that says WebGPU while the indexer runs on WASM
 * would be worse than showing nothing.
 */

export interface SystemCapabilities {
  capabilities: Capabilities;
  workerCapabilities: WorkerCapabilities | null;
  boot: BootResult;
  /** The backend actually used for text embeddings, after the user's Settings override. */
  backend: 'webgpu' | 'wasm';
  gpu: Capabilities['gpu'];
  backendFor: (task: InferenceTask) => 'webgpu' | 'wasm';
}

const CapabilitiesContext = createContext<SystemCapabilities | null>(null);

export function CapabilitiesProvider({
  capabilities,
  workerCapabilities,
  boot,
  children,
}: {
  capabilities: Capabilities;
  workerCapabilities: WorkerCapabilities | null;
  boot: BootResult;
  children: ReactNode;
}) {
  const backendFor = (task: InferenceTask): 'webgpu' | 'wasm' => {
    const override = settingsStore.get().backend;
    if (override === 'webgpu') return capabilities.gpu.available ? 'webgpu' : 'wasm';
    if (override === 'wasm') return 'wasm';
    return preferredBackend(capabilities, task);
  };

  const value: SystemCapabilities = {
    capabilities,
    workerCapabilities,
    boot,
    backend: backendFor('text-embedding'),
    gpu: capabilities.gpu,
    backendFor,
  };

  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>;
}

export function useCapabilities(): SystemCapabilities | null {
  return useContext(CapabilitiesContext);
}

/** For code that cannot render without the probe — everything below the boot screen. */
export function useRequiredCapabilities(): SystemCapabilities {
  const value = useContext(CapabilitiesContext);
  if (!value) throw new Error('CapabilitiesProvider is missing above this component');
  return value;
}
