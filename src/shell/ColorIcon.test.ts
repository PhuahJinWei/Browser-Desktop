import { describe, expect, it } from 'vitest';
import { APPS } from '../kernel/apps';
import { hasColorIcon } from './ColorIcon';

describe('colour icons', () => {
  it('draws every app, so no app falls back to a line icon on the modern desktop', () => {
    // `apps` is what installed third-party apps are drawn with; `file` is the title bar's fallback.
    const needed = [...new Set([...APPS.map((app) => app.icon), 'apps', 'file'] as const)];
    expect(needed.filter((name) => !hasColorIcon(name))).toEqual([]);
  });
});
