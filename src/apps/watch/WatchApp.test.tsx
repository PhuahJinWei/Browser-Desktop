// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSettings, updateSettings } from '../../kernel/settings';
import { useWindowChip } from '../../kernel/windowChips';
import WatchApp from './WatchApp';
import { FEED } from './feed';

/**
 * What these tests are for.
 *
 * Watch is the one app that contacts another company's server, and ADR 20 defends that with a
 * short list of promises: nothing loads until asked, consent comes first, the title-bar chip is
 * true exactly while a frame exists. Those are the project's central privacy claim expressed as
 * component behaviour — a regression would break the claim silently, with everything still looking
 * right, which is precisely the kind of bug a screenshot does not catch.
 *
 * So the assertions are mostly about the **absence** of an iframe. "Renders correctly" is not the
 * point; "has not quietly started talking to Google" is.
 *
 * Driven with `react-dom/client` and `act` rather than a query library: the DOM implementation is
 * the hard part worth a dependency (ADR 7), and finding an element by tag name is not.
 */

// The VFS client builds a worker in a field initialiser at module load, which no test environment
// can honour. Watch only reads and writes one Markdown file, so a stub of four methods is the whole
// surface — and keeping it this small is a check on the app not quietly growing a dependency on
// more of the file system than it needs.
// `vi.hoisted`, because `vi.mock` is lifted above ordinary declarations and would otherwise read
// the stub before it exists.
const vfsStub = vi.hoisted(() => ({
  list: vi.fn(async () => [] as unknown[]),
  readText: vi.fn(async () => ''),
  writeText: vi.fn(async () => ({ id: 'file', name: 'Watched.md' })),
  createDirectory: vi.fn(async () => ({ id: 'folder', name: 'Videos' })),
}));
vi.mock('../../kernel/vfs/client', () => ({ vfs: vfsStub }));

const WINDOW_ID = 'window-under-test';

/** Reports the chip through the real subscription, so the test exercises the path the shell uses. */
function ChipProbe() {
  const chip = useWindowChip(WINDOW_ID);
  return <span data-chip>{chip?.label ?? ''}</span>;
}

let container: HTMLDivElement;
let root: Root;
let probeContainer: HTMLDivElement;
let probeRoot: Root;

/**
 * The probe lives in its own root, mounted for the whole test and never unmounted with the app.
 *
 * This is load-bearing rather than tidiness. Sharing one root meant "the chip does not outlive its
 * window" was tested by unmounting and mounting again — but mounting runs the app's own effect with
 * no video loaded, which clears the chip by itself. The test passed with the unmount cleanup
 * deleted, which a mutation check caught and the assertion never would have. Observing from outside
 * is the only way to see what the shell would still be reading after the window has gone.
 */
function mountProbe() {
  probeContainer = document.createElement('div');
  document.body.append(probeContainer);
  probeRoot = createRoot(probeContainer);
  act(() => probeRoot.render(<ChipProbe />));
}

function unmountProbe() {
  act(() => probeRoot.unmount());
  probeContainer.remove();
}

function mount() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(<WatchApp windowId={WINDOW_ID} args={undefined} />);
  });
}

function unmount() {
  act(() => root.unmount());
  container.remove();
}

const frames = () => [...container.querySelectorAll('iframe')];

/** A film on the homepage, found by the title the card carries rather than by a styling class. */
function card(index: number): HTMLButtonElement {
  const film = FEED[index];
  if (!film) throw new Error('no film at ' + index);
  const found = container.querySelector<HTMLButtonElement>('button[title="' + film.title + '"]');
  if (!found) throw new Error('no card for ' + film.title);
  return found;
}
const chip = () => probeContainer.querySelector('[data-chip]')?.textContent ?? '';
const text = () => container.textContent ?? '';

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((element) =>
    (element.textContent ?? '').trim().toLowerCase().includes(label.toLowerCase()),
  );
  if (!found) throw new Error(`no button matching "${label}" in: ${text().slice(0, 300)}`);
  return found;
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** React installs its own value setter, so a controlled input needs the native one to notice. */
function typeInto(value: string) {
  const input = container.querySelector('input');
  if (!input) throw new Error('no input');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function paste(link: string) {
  typeInto(link);
  click(button('Play'));
}

/** The app gates on this, and happy-dom has no opinion about it, so each test states its own world. */
function setCredentiallessSupport(supported: boolean) {
  if (supported) {
    Object.defineProperty(HTMLIFrameElement.prototype, 'credentialless', {
      value: false,
      writable: true,
      configurable: true,
    });
  } else {
    delete (HTMLIFrameElement.prototype as unknown as Record<string, unknown>)['credentialless'];
  }
}

beforeEach(() => {
  resetSettings();
  vi.clearAllMocks();
  setCredentiallessSupport(true);
  mountProbe();
});

afterEach(() => {
  unmountProbe();
  resetSettings();
  setCredentiallessSupport(false);
});

describe('before anything is asked for', () => {
  it('loads no frame and says so', () => {
    mount();
    expect(frames()).toHaveLength(0);
    expect(text()).toContain('Featured');
    expect(chip()).toBe('');
    unmount();
  });

  it('does not touch the file system beyond reading its own file', () => {
    mount();
    expect(vfsStub.writeText).not.toHaveBeenCalled();
    expect(vfsStub.createDirectory).not.toHaveBeenCalled();
    unmount();
  });
});

describe('consent', () => {
  it('stands in front of the first video, and loads nothing while it waits', () => {
    mount();
    paste('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
    expect(text()).toContain('Watch plays videos from YouTube');
    // The whole point: the card is not decoration in front of a frame that already loaded.
    expect(frames()).toHaveLength(0);
    expect(chip()).toBe('');
    unmount();
  });

  it('loads nothing and remembers nothing when cancelled', () => {
    mount();
    paste('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
    click(button('Cancel'));
    expect(frames()).toHaveLength(0);
    expect(text()).toContain('Featured');
    unmount();

    // A second attempt must ask again, or "Cancel" quietly meant "not this once".
    mount();
    paste('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
    expect(text()).toContain('Watch plays videos from YouTube');
    unmount();
  });

  it('is not asked again once given', () => {
    updateSettings({ watchConsent: true });
    mount();
    paste('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
    expect(text()).not.toContain('Watch plays videos from YouTube');
    expect(frames()).toHaveLength(1);
    unmount();
  });
});

/*
 * The homepage is the app's largest surface and the one most likely to acquire a network request
 * by accident — a thumbnail, a poster, a font — so it is tested for the absence of one rather than
 * for looking right.
 */
describe('the homepage', () => {
  it('renders every film without fetching anything to do it', () => {
    mount();
    expect(frames()).toHaveLength(0);
    expect(container.querySelectorAll('button[title]')).toHaveLength(FEED.length);

    // The grid has real pictures now, and that is fine: ADR 20's rule is about requests, not
    // images. The stills are committed files served from this origin. What must never appear is a
    // URL pointing off it — a hotlinked thumbnail would contact Google's image host the moment the
    // window opened, before anyone had chosen a thing. So the assertion is not "no images", it is
    // "nothing on this page points anywhere else".
    const images = [...container.querySelectorAll('img')];
    expect(images.length).toBeGreaterThan(0);
    const remote = [...container.querySelectorAll('*')].filter((element) =>
      ['src', 'href', 'srcset', 'poster'].some((attribute) =>
        /^(https?:)?[/][/]/.test(element.getAttribute(attribute) ?? ''),
      ),
    );
    expect(remote).toHaveLength(0);
    expect(chip()).toBe('');
    unmount();
  });

  it('puts a clicked film behind the same consent card as a pasted link', () => {
    mount();
    click(card(0));
    expect(text()).toContain('Watch plays videos from YouTube');
    expect(frames()).toHaveLength(0);
    expect(chip()).toBe('');
    unmount();
  });

  it('plays the film that was clicked, and only once consent is given', () => {
    updateSettings({ watchConsent: true });
    mount();
    click(card(2));
    const [frame] = frames();
    expect(frame?.getAttribute('src')).toContain('/embed/' + FEED[2]!.id);
    unmount();
  });
});

describe('the frame', () => {
  beforeEach(() => updateSettings({ watchConsent: true }));

  it('is exactly one, from the nocookie host, carrying credentialless', () => {
    mount();
    paste('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
    const [frame, ...rest] = frames();
    expect(rest).toHaveLength(0);
    expect(frame?.getAttribute('src') ?? '').toContain(
      'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ',
    );
    expect(frame?.hasAttribute('credentialless')).toBe(true);
    unmount();
  });

  it('does not pull in any script of Google’s', () => {
    mount();
    paste('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
    // `iframe_api` would be a third-party script in this origin and a script-src change with it.
    expect(container.innerHTML).not.toContain('iframe_api');
    expect(container.querySelectorAll('script')).toHaveLength(0);
    unmount();
  });

  it('carries a pasted playlist so the player’s own next and previous work', () => {
    mount();
    paste('https://www.youtube.com/watch?v=aqz-KE-bpKQ&list=PLtest123456');
    expect(frames()[0]?.getAttribute('src') ?? '').toContain('list=PLtest123456');
    unmount();
  });

  it('refuses a link that is not YouTube, and loads nothing', () => {
    mount();
    paste('https://example.com/watch?v=aqz-KE-bpKQ');
    expect(text()).toContain('does not look like a YouTube link');
    expect(frames()).toHaveLength(0);
    unmount();
  });
});

describe('the title-bar chip', () => {
  beforeEach(() => updateSettings({ watchConsent: true }));

  it('names the host while a frame is loaded', () => {
    mount();
    paste('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
    expect(chip()).toContain('youtube-nocookie.com');
    unmount();
  });

  it('goes when Stop does, along with the frame', () => {
    mount();
    paste('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
    click(button('Stop'));
    expect(frames()).toHaveLength(0);
    expect(chip()).toBe('');
    unmount();
  });

  it('does not outlive the window it belongs to', () => {
    mount();
    paste('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
    expect(chip()).toContain('youtube-nocookie.com');

    // Closing a window mid-video must not leave a badge claiming a connection that went with it.
    // Read from the probe, which is still mounted, rather than from a second WatchApp — a fresh
    // app clears the chip on its own and would make this pass whatever the cleanup did.
    unmount();
    act(() => {});
    expect(chip()).toBe('');
  });
});

describe('where credentialless frames do not exist', () => {
  beforeEach(() => {
    updateSettings({ watchConsent: true });
    setCredentiallessSupport(false);
  });

  it('names the missing capability rather than showing a broken frame', () => {
    mount();
    paste('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
    expect(frames()).toHaveLength(0);
    expect(text()).toContain('credentialless');
    unmount();
  });

  it('still lists what was saved, so the app is not simply dead', () => {
    mount();
    expect(text()).toContain('Saved');
    expect(text()).toContain('Recent');
    unmount();
  });
});
