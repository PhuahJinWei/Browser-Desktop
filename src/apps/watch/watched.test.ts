import { describe, expect, it } from 'vitest';
import {
  RECENT_LIMIT,
  emptyWatched,
  forget,
  parseLink,
  parseWatched,
  remember,
  save,
  serialiseWatched,
  unsave,
  type WatchedEntry,
} from './watched';

const entry = (id: string, title = 'A video'): WatchedEntry => ({
  id,
  title,
  channel: 'A channel',
  at: '2026-08-24',
});

describe('parseLink', () => {
  it.each([
    ['https://www.youtube.com/watch?v=aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
    ['https://youtube.com/watch?v=aqz-KE-bpKQ&t=42s', 'aqz-KE-bpKQ'],
    ['https://youtu.be/aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
    ['https://youtu.be/aqz-KE-bpKQ?t=42', 'aqz-KE-bpKQ'],
    ['https://www.youtube.com/embed/aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
    ['https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
    ['https://www.youtube.com/shorts/aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
    ['https://m.youtube.com/watch?v=aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
    ['youtube.com/watch?v=aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
    ['  aqz-KE-bpKQ  ', 'aqz-KE-bpKQ'],
  ])('reads %s', (input, id) => {
    expect(parseLink(input)?.videoId).toBe(id);
  });

  it.each([
    [''],
    ['not a link'],
    ['https://example.com/watch?v=aqz-KE-bpKQ'],
    ['https://www.youtube.com/watch?v=tooshort'],
    ['https://www.youtube.com/'],
    ['https://vimeo.com/12345678'],
  ])('refuses %s rather than guessing', (input) => {
    expect(parseLink(input)).toBeNull();
  });

  it('keeps a playlist id so next/previous work', () => {
    const parsed = parseLink('https://www.youtube.com/watch?v=aqz-KE-bpKQ&list=PL1234567890');
    expect(parsed).toEqual({ videoId: 'aqz-KE-bpKQ', listId: 'PL1234567890' });
  });

  it('drops the private watch-later list, which no one else can open', () => {
    const parsed = parseLink('https://www.youtube.com/watch?v=aqz-KE-bpKQ&list=WL');
    expect(parsed).toEqual({ videoId: 'aqz-KE-bpKQ' });
  });
});

describe('the file', () => {
  it('round-trips', () => {
    const before = {
      ...emptyWatched(),
      saved: [entry('aqz-KE-bpKQ', 'Big Buck Bunny')],
      recent: [entry('dQw4w9WgXcQ', 'Another')],
    };
    const after = parseWatched(serialiseWatched(before));
    expect(after.saved).toEqual(before.saved);
    expect(after.recent).toEqual(before.recent);
  });

  it('keeps a note the user wrote above the lists', () => {
    const text =
      'my own notes\nsecond line\n\n## Saved\n\n- [T](https://youtu.be/aqz-KE-bpKQ) — C · 2026-08-24\n';
    const parsed = parseWatched(text);
    expect(parsed.preamble).toContain('my own notes');
    expect(serialiseWatched(parsed)).toContain('my own notes');
  });

  it('skips an unreadable line instead of losing the rest of the file', () => {
    const text = [
      '## Saved',
      '',
      '- [Good](https://youtu.be/aqz-KE-bpKQ) — C · 2026-08-24',
      '- this line is nonsense',
      '- [Also good](https://youtu.be/dQw4w9WgXcQ) — C · 2026-08-24',
    ].join('\n');
    expect(parseWatched(text).saved.map((e) => e.id)).toEqual(['aqz-KE-bpKQ', 'dQw4w9WgXcQ']);
  });

  it('does not read an unrelated heading as a list of videos', () => {
    const text = [
      '## Saved',
      '- [Good](https://youtu.be/aqz-KE-bpKQ) — C · 2026-08-24',
      '## Something else',
      '- [Not a video](https://youtu.be/dQw4w9WgXcQ) — C · 2026-08-24',
    ].join('\n');
    const parsed = parseWatched(text);
    expect(parsed.saved.map((e) => e.id)).toEqual(['aqz-KE-bpKQ']);
    expect(parsed.recent).toEqual([]);
  });

  it('tolerates a hand-typed line with no channel or date', () => {
    const parsed = parseWatched('## Saved\n- [Just a title](https://youtu.be/aqz-KE-bpKQ)');
    expect(parsed.saved[0]).toEqual({
      id: 'aqz-KE-bpKQ',
      title: 'Just a title',
      channel: '',
      at: '',
    });
  });

  it('ignores a duplicated line rather than showing the video twice', () => {
    const line = '- [T](https://youtu.be/aqz-KE-bpKQ) — C · 2026-08-24';
    expect(parseWatched(`## Saved\n${line}\n${line}`).saved).toHaveLength(1);
  });

  it('writes something a reader can understand when both lists are empty', () => {
    const text = serialiseWatched(emptyWatched());
    expect(text).toContain('## Saved');
    expect(text).toContain('_Nothing saved yet._');
    expect(parseWatched(text).saved).toEqual([]);
  });

  it('strips brackets from a title, which would otherwise cut the link short', () => {
    const text = serialiseWatched({
      ...emptyWatched(),
      saved: [entry('aqz-KE-bpKQ', 'A [bracket] title')],
    });
    expect(parseWatched(text).saved[0]?.title).toBe('A bracket title');
  });
});

describe('operations', () => {
  it('moves a re-watched video up rather than duplicating it', () => {
    let w = { ...emptyWatched(), recent: [entry('aaaaaaaaaaa'), entry('bbbbbbbbbbb')] };
    w = remember(w, entry('bbbbbbbbbbb'));
    expect(w.recent.map((e) => e.id)).toEqual(['bbbbbbbbbbb', 'aaaaaaaaaaa']);
  });

  it('caps Recent', () => {
    let w = emptyWatched();
    for (let i = 0; i < RECENT_LIMIT + 5; i++) {
      w = remember(w, entry(String(i).padStart(11, 'x')));
    }
    expect(w.recent).toHaveLength(RECENT_LIMIT);
  });

  it('updates a saved row when the player reports a better title', () => {
    let w = save(emptyWatched(), entry('aqz-KE-bpKQ', 'aqz-KE-bpKQ'));
    w = remember(w, entry('aqz-KE-bpKQ', 'Big Buck Bunny'));
    expect(w.saved[0]?.title).toBe('Big Buck Bunny');
  });

  it('saves once, and unsaves', () => {
    let w = save(emptyWatched(), entry('aqz-KE-bpKQ'));
    w = save(w, entry('aqz-KE-bpKQ'));
    expect(w.saved).toHaveLength(1);
    expect(unsave(w, 'aqz-KE-bpKQ').saved).toEqual([]);
  });

  it('forgets one recent row without touching the rest', () => {
    const w = { ...emptyWatched(), recent: [entry('aaaaaaaaaaa'), entry('bbbbbbbbbbb')] };
    expect(forget(w, 'aaaaaaaaaaa').recent.map((e) => e.id)).toEqual(['bbbbbbbbbbb']);
  });
});
