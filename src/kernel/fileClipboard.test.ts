import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VfsNode } from './vfs/types';

/*
 * The real VFS client starts a worker at module load, which no test environment can host. The
 * clipboard only needs three of its methods, and keeping the stub that small is also a check that
 * it has not quietly grown a dependency on more of the file system than it should.
 */
const vfsStub = vi.hoisted(() => ({
  statMany: vi.fn(),
  copy: vi.fn(),
  move: vi.fn(),
}));
vi.mock('./vfs/client', () => ({ vfs: vfsStub }));

function node(id: string, trashed = false): VfsNode {
  return {
    id,
    parentId: 'home',
    name: `${id}.txt`,
    kind: 'file',
    mime: 'text/plain',
    size: 1,
    createdAt: 0,
    modifiedAt: 0,
    trashed,
  };
}

/** The clipboard is module state, so each test takes a fresh module rather than the last one's. */
async function fresh() {
  vi.resetModules();
  return import('./fileClipboard');
}

beforeEach(() => {
  vi.clearAllMocks();
  vfsStub.statMany.mockImplementation(async (ids: string[]) => ids.map((id) => node(id)));
  vfsStub.copy.mockImplementation(async (ids: string[]) => ids.map((id) => node(`copy-of-${id}`)));
  vfsStub.move.mockImplementation(async (ids: string[]) => ids.map((id) => node(id)));
});

describe('the file clipboard', () => {
  it('has nothing to paste until something is cut or copied', async () => {
    const clip = await fresh();
    expect(clip.canPaste()).toBe(false);
    await expect(clip.pasteFiles('target')).resolves.toEqual([]);
    expect(vfsStub.copy).not.toHaveBeenCalled();
    expect(vfsStub.move).not.toHaveBeenCalled();
  });

  it('ignores an empty selection rather than replacing what was there with nothing', async () => {
    const clip = await fresh();
    clip.copyFiles(['a']);
    clip.cutFiles([]);
    clip.copyFiles([]);
    await clip.pasteFiles('target');
    expect(vfsStub.copy).toHaveBeenCalledWith(['a'], 'target');
  });
});

describe('copy, then paste', () => {
  it('copies into the target and keeps the clipboard, so it can be pasted again', async () => {
    const clip = await fresh();
    clip.copyFiles(['a', 'b']);

    const landed = await clip.pasteFiles('target');
    expect(vfsStub.copy).toHaveBeenCalledWith(['a', 'b'], 'target');
    expect(landed.map((entry) => entry.id)).toEqual(['copy-of-a', 'copy-of-b']);

    expect(clip.canPaste()).toBe(true);
    await clip.pasteFiles('elsewhere');
    expect(vfsStub.copy).toHaveBeenLastCalledWith(['a', 'b'], 'elsewhere');
    expect(vfsStub.move).not.toHaveBeenCalled();
  });
});

describe('cut, then paste', () => {
  it('moves into the target and is used up by doing so', async () => {
    const clip = await fresh();
    clip.cutFiles(['a']);

    await clip.pasteFiles('target');
    expect(vfsStub.move).toHaveBeenCalledWith(['a'], 'target');
    expect(vfsStub.copy).not.toHaveBeenCalled();
    expect(clip.canPaste()).toBe(false);
  });

  it('can be abandoned, which touches nothing because nothing had happened yet', async () => {
    const clip = await fresh();
    clip.cutFiles(['a']);
    clip.cancelCut();
    expect(clip.canPaste()).toBe(false);
    expect(vfsStub.move).not.toHaveBeenCalled();
  });

  it('abandoning a cut leaves a copy alone, because a copy marks nothing', async () => {
    const clip = await fresh();
    clip.copyFiles(['a']);
    clip.cancelCut();
    expect(clip.canPaste()).toBe(true);
  });

  it('keeps the cut when the move fails, so nothing has been lost and it can be retried', async () => {
    const clip = await fresh();
    vfsStub.move.mockRejectedValueOnce(new Error('Cannot move a into itself'));
    clip.cutFiles(['a']);

    await expect(clip.pasteFiles('inside-a')).rejects.toThrow('into itself');
    expect(clip.canPaste()).toBe(true);
  });

  it('does not throw away something copied while the paste was still running', async () => {
    const clip = await fresh();
    let finishMove: (value: VfsNode[]) => void = () => {};
    vfsStub.move.mockImplementationOnce(
      () => new Promise<VfsNode[]>((resolve) => (finishMove = resolve)),
    );

    clip.cutFiles(['a']);
    const pasting = clip.pasteFiles('target');
    // Let the paste get as far as the move before the user copies something else.
    await vi.waitFor(() => expect(vfsStub.move).toHaveBeenCalled());
    clip.copyFiles(['b']);
    finishMove([node('a')]);
    await pasting;

    expect(clip.canPaste()).toBe(true);
    await clip.pasteFiles('target');
    expect(vfsStub.copy).toHaveBeenCalledWith(['b'], 'target');
  });
});

describe('when what was on the clipboard has gone', () => {
  it('pastes only what still exists, leaving out anything since binned', async () => {
    const clip = await fresh();
    // `c` was deleted outright, so it does not come back at all; `b` was binned.
    vfsStub.statMany.mockResolvedValueOnce([node('a'), node('b', true)]);
    clip.copyFiles(['a', 'b', 'c']);

    await clip.pasteFiles('target');
    expect(vfsStub.copy).toHaveBeenCalledWith(['a'], 'target');
  });

  it('empties the clipboard and says so when none of it is left', async () => {
    const clip = await fresh();
    vfsStub.statMany.mockResolvedValueOnce([node('a', true)]);
    clip.cutFiles(['a']);

    await expect(clip.pasteFiles('target')).rejects.toThrow('since been deleted');
    expect(vfsStub.move).not.toHaveBeenCalled();
    expect(clip.canPaste()).toBe(false);
  });
});
