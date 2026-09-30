import { describe, expect, it } from 'vitest';
import { SETUP_FORMAT, fromBase64, parseSetup, toBase64 } from './setupFormat';

const file = (body: Record<string, unknown>) =>
  JSON.stringify({
    format: SETUP_FORMAT,
    version: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    ...body,
  });

describe('parseSetup', () => {
  it('refuses anything that is not a setup file', () => {
    expect(() => parseSetup('{}')).toThrow(/not a Tabula desktop setup/);
    expect(() => parseSetup('[]')).toThrow(/does not contain a desktop setup/);
    expect(() => parseSetup('not json')).toThrow();
  });

  it('refuses a file from a future version rather than guessing at it', () => {
    expect(() => parseSetup(file({ version: 99 }))).toThrow(/newer version/);
  });

  it('keeps the settings it recognises', () => {
    const setup = parseSetup(
      file({ settings: { skin: 'classic', accent: 'rose', fontScale: 1.25, autoIndex: false } }),
    );
    expect(setup.settings).toEqual({
      skin: 'classic',
      accent: 'rose',
      fontScale: 1.25,
      autoIndex: false,
    });
  });

  it('drops values outside the allowed set instead of trusting the file', () => {
    const setup = parseSetup(
      file({
        settings: {
          skin: 'aqua',
          accent: 'javascript:alert(1)',
          fontScale: 400,
          backend: 'cuda',
          autoIndex: 'yes',
          somethingElse: { nested: true },
        },
      }),
    );
    expect(setup.settings).toEqual({});
  });

  it('clamps icon positions and ignores malformed ones', () => {
    const setup = parseSetup(
      file({
        settings: {
          iconPositions: {
            files: { col: 2, row: 3 },
            search: { col: -5, row: 1e9 },
            notes: { col: 'three', row: 1 },
            photos: 'nope',
          },
        },
      }),
    );
    expect(setup.settings.iconPositions).toEqual({
      files: { col: 2, row: 3 },
      search: { col: 0, row: 255 },
    });
  });

  it('accepts a window session and normalises its geometry', () => {
    const setup = parseSetup(
      file({
        session: {
          focusedId: 'win-1',
          windows: [
            { id: 'win-1', appId: 'files', title: 'Files', x: 10, y: 20, width: 800, height: 600 },
            { id: 'win-2', appId: 'notes', x: 'left', y: null, snap: 'sideways' },
            { nonsense: true },
          ],
        },
      }),
    );

    expect(setup.session?.windows).toHaveLength(2);
    expect(setup.session?.windows[1]).toMatchObject({
      appId: 'notes',
      title: 'Window',
      x: 40,
      y: 40,
      snap: null,
    });
  });

  it('keeps a snap zone it knows', () => {
    const setup = parseSetup(
      file({ session: { windows: [{ id: 'w', appId: 'files', snap: 'left' }] } }),
    );
    expect(setup.session?.windows[0]?.snap).toBe('left');
  });

  it('only carries a wallpaper that claims to be an image', () => {
    const image = file({ wallpaper: { name: 'sky.png', mime: 'image/png', dataBase64: 'AAA=' } });
    expect(parseSetup(image).wallpaper?.name).toBe('sky.png');

    const script = file({
      wallpaper: { name: 'x.js', mime: 'text/javascript', dataBase64: 'AAA=' },
    });
    expect(parseSetup(script).wallpaper).toBeUndefined();
  });

  it('strips path separators out of the wallpaper name', () => {
    const setup = parseSetup(
      file({
        wallpaper: { name: '../../etc/passwd', mime: 'image/png', dataBase64: 'AAA=' },
      }),
    );
    expect(setup.wallpaper?.name).toBe('..-..-etc-passwd');
  });
});

describe('base64', () => {
  it('round-trips bytes, including ones that are not valid text', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 200, 255]);
    const back = new Uint8Array(fromBase64(toBase64(bytes.buffer)));
    expect([...back]).toEqual([...bytes]);
  });

  it('handles an image-sized buffer without blowing the argument limit', () => {
    const bytes = new Uint8Array(200_000).map((_, index) => index % 256);
    const back = new Uint8Array(fromBase64(toBase64(bytes.buffer)));
    expect(back.length).toBe(bytes.length);
    expect(back[199_999]).toBe(bytes[199_999]);
  });
});
