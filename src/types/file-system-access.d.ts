/**
 * Types for the worker-only half of the File System API.
 *
 * `createSyncAccessHandle` is the fast path for OPFS — synchronous, unbuffered reads and writes —
 * but it only exists inside workers, so it is absent from lib.dom. Rather than typecheck the
 * workers under a separate WebWorker project (they share modules with the main thread, which
 * would drag those into both programs), the capability is declared here as optional. Code must
 * feature-detect it before use, which is what the runtime requires anyway.
 *
 * Remove this file once lib.dom ships the declarations.
 */

interface FileSystemSyncAccessHandle {
  read(buffer: ArrayBufferView, options?: { at?: number }): number;
  write(buffer: ArrayBufferView, options?: { at?: number }): number;
  truncate(size: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}

interface FileSystemFileHandle {
  /** Present in workers only; always feature-detect. */
  createSyncAccessHandle?(): Promise<FileSystemSyncAccessHandle>;
}
