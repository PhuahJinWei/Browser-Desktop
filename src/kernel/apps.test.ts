import { describe, expect, it } from 'vitest';
import { withKnownApps } from './apps';
import type { WindowSession } from './windows';

const window = (id: string, appId: string): WindowSession['windows'][number] => ({
  id,
  appId,
  title: appId,
  x: 0,
  y: 0,
  width: 400,
  height: 300,
  minimized: false,
  snap: null,
  restore: null,
});

describe('withKnownApps', () => {
  it('drops windows of apps that no longer exist, and a focus that pointed at one', () => {
    const session = {
      windows: [window('win-1', 'files'), window('win-2', 'watch')],
      focusedId: 'win-2',
    } as WindowSession;

    const known = withKnownApps(session);

    expect(known.windows.map((w) => w.id)).toEqual(['win-1']);
    expect(known.focusedId).toBeNull();
  });

  it('returns a session with nothing to drop unchanged', () => {
    const session = { windows: [window('win-1', 'notes')], focusedId: 'win-1' } as WindowSession;
    expect(withKnownApps(session)).toBe(session);
  });
});
