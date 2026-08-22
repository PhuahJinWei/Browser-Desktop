import { describe, expect, it } from 'vitest';
import { AppFormatError, parseApp, unpackAppLink } from '../sdk/package';

const manifest = (extra: string = '') => `/* tabula-app
{
  "id": "com.example.demo",
  "name": "Demo",
  "version": "1.2.3",
  "description": "A demo",
  "permissions": ["fs:read"]${extra}
}
*/
os.ui.setTitle('hi');`;

describe('parseApp', () => {
  it('reads a well-formed manifest', () => {
    const parsed = parseApp(manifest());
    expect(parsed.id).toBe('com.example.demo');
    expect(parsed.name).toBe('Demo');
    expect(parsed.version).toBe('1.2.3');
    expect(parsed.permissions).toEqual(['fs:read']);
  });

  it('rejects a file with no manifest block', () => {
    expect(() => parseApp('alert(1)')).toThrow(AppFormatError);
  });

  it('rejects malformed JSON rather than guessing', () => {
    expect(() => parseApp('/* tabula-app { not json } */')).toThrow(/not valid JSON/);
  });

  it('rejects an unknown permission instead of ignoring it', () => {
    // Ignoring it would turn a typo into "no permission needed", which is the wrong direction
    // for a mistake to fail in.
    const source = manifest().replace('"fs:read"', '"fs:rread"');
    expect(() => parseApp(source)).toThrow(/Unknown permission/);
  });

  it('rejects an id that could escape a storage key or collide with a built-in', () => {
    for (const id of ['', 'ab', 'has spaces', 'has/slash', 'has:colon', '.leadingdot']) {
      const source = manifest().replace('com.example.demo', id);
      expect(() => parseApp(source), id).toThrow(AppFormatError);
    }
  });

  it('requires a name and caps its length', () => {
    expect(() => parseApp(manifest().replace('"Demo"', '""'))).toThrow(AppFormatError);
    expect(() => parseApp(manifest().replace('"Demo"', `"${'x'.repeat(41)}"`))).toThrow(
      AppFormatError,
    );
  });

  it('truncates an over-long description rather than rejecting the app', () => {
    const source = manifest().replace('"A demo"', `"${'y'.repeat(500)}"`);
    expect(parseApp(source).description).toHaveLength(200);
  });

  it('defaults a missing version and permission list', () => {
    const source = `/* tabula-app
{ "id": "com.example.min", "name": "Minimal" }
*/`;
    const parsed = parseApp(source);
    expect(parsed.version).toBe('0.0.0');
    expect(parsed.permissions).toEqual([]);
  });

  it('clamps a default window size to something usable', () => {
    const source = manifest(`,\n  "defaultSize": { "width": 99999, "height": 1 }`);
    const parsed = parseApp(source);
    expect(parsed.defaultSize?.width).toBeLessThanOrEqual(1600);
    expect(parsed.defaultSize?.height).toBeGreaterThanOrEqual(200);
  });

  it('takes the first manifest block, so trailing comments cannot redefine it', () => {
    const source = `${manifest()}\n/* tabula-app { "id": "evil.app", "name": "Evil" } */`;
    expect(parseApp(source).id).toBe('com.example.demo');
  });
});

describe('unpackAppLink', () => {
  it('round-trips a source through the fragment encoding', () => {
    const source = manifest();
    // Mirrors packAppLink's encoding without needing a `location`.
    const bytes = new TextEncoder().encode(source);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    expect(unpackAppLink(`#app=${encoded}`)).toBe(source);
  });

  it('returns null for a fragment that is not an app', () => {
    expect(unpackAppLink('#something-else')).toBeNull();
    expect(unpackAppLink('')).toBeNull();
  });

  it('returns null rather than throwing on corrupt input', () => {
    expect(unpackAppLink('#app=!!!!not-base64!!!!')).toBeNull();
  });
});
