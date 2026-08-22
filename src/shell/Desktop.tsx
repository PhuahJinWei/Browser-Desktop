import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cycleFocus,
  restoreSession,
  serializeSession,
  setViewport,
  useFocusedWindowId,
  useViewport,
  useWindows,
  windowStore,
  snapRect,
  type SnapZone,
} from '../kernel/windows';
import { accelerator, isTypingTarget, listCommands } from '../kernel/commands';
import { loadSession, saveSession, useSettings } from '../kernel/settings';
import { WindowFrame } from './WindowFrame';
import { Taskbar } from './Taskbar';
import { Launcher } from './Launcher';
import { CommandPalette } from './CommandPalette';
import { NotificationLayer } from './Notifications';
import { DesktopIcons } from './DesktopIcons';
import styles from './Desktop.module.css';

/**
 * The desktop.
 *
 * Owns three things the apps must not: the size of the window area, the global key map, and
 * session persistence. Everything else is delegated.
 */

export function Desktop({ onOpenLauncher }: { onOpenLauncher?: () => void } = {}) {
  const windows = useWindows();
  const focusedId = useFocusedWindowId();
  const viewport = useViewport();
  const settings = useSettings();

  const areaRef = useRef<HTMLDivElement>(null);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [snapPreview, setSnapPreview] = useState<SnapZone | null>(null);

  /* The window area's size drives snapping and clamping, so it is measured, not assumed. */
  useEffect(() => {
    const element = areaRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box) setViewport({ width: Math.round(box.width), height: Math.round(box.height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /* Session restore, once the viewport is known so geometry lands correctly. */
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || viewport.width < 2) return;
    restoredRef.current = true;
    if (!settings.restoreSession) return;

    const session = loadSession();
    if (session && session.windows.length > 0) restoreSession(session, viewport);
  }, [viewport, settings.restoreSession]);

  /* Session save, debounced: window drags would otherwise write on every commit. */
  useEffect(() => {
    if (!settings.restoreSession) return;
    const timer = setTimeout(() => saveSession(serializeSession()), 400);
    return () => clearTimeout(timer);
  }, [windows, focusedId, settings.restoreSession]);

  /* Global keyboard map. */
  const openLauncher = useCallback(() => {
    setPaletteOpen(false);
    setLauncherOpen(true);
    onOpenLauncher?.();
  }, [onOpenLauncher]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const combo = accelerator(event);

      // Ctrl+` cycles windows. Alt+Tab belongs to the operating system and cannot be taken.
      if (combo === 'Ctrl+`' || combo === 'Ctrl+Shift+`') {
        event.preventDefault();
        cycleFocus(event.shiftKey ? -1 : 1);
        return;
      }
      if (combo === 'Ctrl+K' || combo === 'Ctrl+Shift+P') {
        event.preventDefault();
        setLauncherOpen(false);
        setPaletteOpen(true);
        return;
      }
      if (event.key === 'Escape') {
        setPaletteOpen(false);
        setLauncherOpen(false);
        return;
      }

      // Everything else comes from the command registry, so a shortcut cannot drift from the
      // palette entry that describes it.
      const command = listCommands().find((candidate) => candidate.shortcut === combo);
      if (!command) return;
      // Single-key shortcuts must not fire while typing; modified ones still should.
      if (!event.ctrlKey && !event.metaKey && !event.altKey && isTypingTarget(event.target)) return;

      event.preventDefault();
      void command.run();
    };

    globalThis.addEventListener('keydown', onKeyDown);
    return () => globalThis.removeEventListener('keydown', onKeyDown);
  }, []);

  /* Clicking bare desktop dismisses transient surfaces and drops window focus. */
  const onAreaPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    setLauncherOpen(false);
    setPaletteOpen(false);
    windowStore.set((state) => ({ ...state, focusedId: null }));
  }, []);

  const previewRect = snapPreview ? snapRect(snapPreview, viewport) : null;

  return (
    <div className={styles.root}>
      <div
        ref={areaRef}
        className={styles.area}
        onPointerDown={onAreaPointerDown}
        role="presentation"
      >
        <DesktopIcons />

        {previewRect ? (
          <div
            className={styles.snapPreview}
            style={{
              left: previewRect.x,
              top: previewRect.y,
              width: previewRect.width,
              height: previewRect.height,
            }}
            aria-hidden
          />
        ) : null}

        {windows.map((window) => (
          <WindowFrame
            key={window.id}
            window={window}
            focused={window.id === focusedId}
            viewport={viewport}
            onSnapPreview={setSnapPreview}
          />
        ))}

        {windows.length === 0 ? (
          <p className={styles.empty}>
            Nothing open. Press <kbd>Ctrl</kbd>+<kbd>K</kbd> for commands, or use the launcher.
          </p>
        ) : null}
      </div>

      <Taskbar
        launcherOpen={launcherOpen}
        onToggleLauncher={() => (launcherOpen ? setLauncherOpen(false) : openLauncher())}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      {launcherOpen ? <Launcher onClose={() => setLauncherOpen(false)} /> : null}
      {paletteOpen ? <CommandPalette onClose={() => setPaletteOpen(false)} /> : null}
      <NotificationLayer />
    </div>
  );
}
