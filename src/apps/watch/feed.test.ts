import { describe, expect, it } from 'vitest';
import { FEED, formatDuration, posterHue } from './feed';

/**
 * The feed is a hand-maintained list, which is the one thing about it that can rot. A mistyped id
 * does not fail loudly — it renders a perfectly ordinary card that plays nothing, and the person
 * who added it has usually stopped looking by then. These are the cheap checks that catch a bad
 * paste at the point it is made.
 *
 * What is deliberately *not* tested here is whether the videos still exist. That would need a
 * network call, and a test suite that quietly contacts YouTube would contradict the app it is
 * testing.
 */
describe('the curated list', () => {
  it('carries ids in the only shape YouTube issues', () => {
    for (const film of FEED) expect(film.id).toMatch(/^[A-Za-z0-9_-]{11}$/);
  });

  it('lists no film twice', () => {
    expect(new Set(FEED.map((film) => film.id)).size).toBe(FEED.length);
  });

  it('is ordered newest first, which is the rule the file claims to follow', () => {
    const years = FEED.map((film) => film.year);
    expect([...years].sort((a, b) => b - a)).toEqual(years);
  });

  it('gives every film a real title, channel and running time', () => {
    for (const film of FEED) {
      expect(film.title.trim().length).toBeGreaterThan(0);
      expect(film.channel.trim().length).toBeGreaterThan(0);
      expect(film.seconds).toBeGreaterThan(0);
      // Long enough to be a short film, short enough that a typo of three extra digits shows up.
      expect(film.seconds).toBeLessThan(4 * 60 * 60);
      expect(film.year).toBeGreaterThan(1990);
    }
  });
});

describe('formatDuration', () => {
  it('reads as the era wrote it', () => {
    expect(formatDuration(60)).toBe('1:00');
    expect(formatDuration(150)).toBe('2:30');
    expect(formatDuration(888)).toBe('14:48');
    expect(formatDuration(9)).toBe('0:09');
  });

  it('grows an hours field only when there are hours', () => {
    expect(formatDuration(3599)).toBe('59:59');
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('does not produce nonsense from nonsense', () => {
    expect(formatDuration(-5)).toBe('0:00');
    expect(formatDuration(12.7)).toBe('0:12');
  });
});

describe('posterHue', () => {
  it('gives a film the same colour every time, or it is a lottery rather than an identity', () => {
    for (const film of FEED) expect(posterHue(film.id)).toBe(posterHue(film.id));
  });

  it('stays inside the colour wheel', () => {
    for (const film of FEED) {
      const hue = posterHue(film.id);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
});
