/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { parseApp } from '../sdk/package';
import { SAMPLE_APPS } from './sampleAppSources';

/**
 * The Calculator's sums, run the way the sandbox runs it: its source wrapped in a function and
 * evaluated against a document. It is a string in the bundle, so nothing else would notice if a
 * key stopped working.
 */
const calculator = SAMPLE_APPS.find((app) => app.id === 'tabula.calculator')!.source;

function boot(skin: 'classic' | 'modern') {
  document.body.textContent = '';
  document.documentElement.dataset['skin'] = skin;
  new Function('os', `"use strict";\n${calculator}`)({});
  const press = (...names: string[]) => {
    for (const name of names) {
      const button = [...document.querySelectorAll('button')].find(
        (candidate) => candidate.getAttribute('aria-label') === name,
      );
      if (!button) throw new Error(`no key labelled ${name}`);
      button.click();
    }
  };
  const display = () => document.querySelector('[role="status"]')?.textContent;
  return { press, display };
}

afterEach(() => {
  document.body.textContent = '';
});

describe('the bundled Calculator', () => {
  it('declares a fixed window with a smaller classic size', () => {
    const manifest = parseApp(calculator);
    expect(manifest.resizable).toBe(false);
    expect(manifest.skinSizes?.classic?.width).toBeLessThan(manifest.defaultSize!.width);
  });

  for (const skin of ['classic', 'modern'] as const) {
    describe(skin, () => {
      it('adds, chains and divides', () => {
        const { press, display } = boot(skin);
        press('7', 'Multiply by', '6', 'Equals');
        expect(display()).toBe(skin === 'classic' ? '42.' : '42');
        press('Clear', '1', 'Plus', '2', 'Plus', '3', 'Equals');
        expect(display()).toMatch(/^6\.?$/);
      });

      it('says so on division by zero rather than showing Infinity', () => {
        const { press, display } = boot(skin);
        press('1', 'Divide by', '0', 'Equals');
        expect(display()).toBe('Cannot divide by zero');
      });

      it('stores and recalls memory, and backspaces a digit', () => {
        const { press, display } = boot(skin);
        press('1', '2', '3', '4', 'Memory store', 'Clear', 'Memory recall');
        expect(display()).toBe(skin === 'classic' ? '1234.' : '1,234');
        press('Clear', '9', '8', 'Backspace');
        expect(display()).toMatch(/^9\.?$/);
      });
    });
  }
});
