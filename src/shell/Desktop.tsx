import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  closeAllWindows,
  cycleFocus,
  restoreSession,
  serializeSession,
  setViewport,
  useFocusedWindowId,
  useViewport,
  useViewportMeasured,
  useWindows,
  windowStore,
  snapRect,
  type SnapZone,
} from '../kernel/windows';
import { accelerator, isTypingTarget, listCommands } from '../kernel/commands';
import { launchApp, withKnownApps } from '../kernel/apps';
import { rowsForHeight } from '../kernel/desktop';
import { loadSession, saveSession, useSettings } from '../kernel/settings';
import { notifyError } from '../kernel/notifications';
import { pickWallpaperImage, startWallpaper } from '../kernel/wallpaper';
import { vfs } from '../kernel/vfs/client';
import { ROOT_ID } from '../kernel/vfs/types';
import { WindowFrame } from './WindowFrame';
import { Taskbar } from './Taskbar';
import { Launcher } from './Launcher';
import { CommandPalette } from './CommandPalette';
import { NotificationLayer } from './Notifications';
import { PermissionPrompt } from './PermissionPrompt';
import { canPaste, pasteFiles } from '../kernel/fileClipboard';
import { loadInstalledApps } from '../kernel/installedApps';
import { DesktopIcons, iconLayoutMenu } from './DesktopIcons';
import { ContextMenu, separator, useContextMenu, type MenuSpec } from './ContextMenu';
import { LimitedNotice } from './LimitedNotice';
import { Tooltips } from './Tooltips';
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
  const viewportMeasured = useViewportMeasured();
  const settings = useSettings();

  const areaRef = useRef<HTMLDivElement>(null);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [snapPreview, setSnapPreview] = useState<SnapZone | null>(null);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  /* The wallpaper is a file, so it can only be applied once the file system is up. */
  useEffect(() => startWallpaper(), []);

  /*
   * The window area's size drives snapping and clamping, so it is measured, not assumed.
   *
   * Measured once synchronously before the first paint, then watched. Relying on the observer's
   * initial callback alone would be a frame late — and session restore, below, has to wait for
   * this — so the first measurement is taken by hand rather than awaited.
   *
   * A zero-sized box is not a measurement. It is what a detached or hidden element reports, and
   * accepting it would clamp every window to nothing.
   */
  useLayoutEffect(() => {
    const element = areaRef.current;
    if (!element) return;

    const measure = (width: number, height: number) => {
      if (width < 2 || height < 2) return;
      setViewport({ width: Math.round(width), height: Math.round(height) });
    };

    const box = element.getBoundingClientRect();
    measure(box.width, box.height);

    const observer = new ResizeObserver(([entry]) => {
      const size = entry?.contentRect;
      if (size) measure(size.width, size.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /*
   * Session restore, once the desktop has been measured so the geometry lands correctly.
   *
   * The wait is on `viewportMeasured` rather than on the viewport looking plausible. The store
   * starts at a placeholder 1280x800, which passes every sanity check and is wrong on every screen
   * that is not that size: restoring against it laid windows out for a display that was not there,
   * and the re-flow that followed only partly hid it.
   */
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !viewportMeasured) return;
    restoredRef.current = true;
    if (!settings.restoreSession) return;

    const session = loadSession();
    const known = session && withKnownApps(session);
    if (known && known.windows.length > 0) restoreSession(known, viewport);
  }, [viewport, viewportMeasured, settings.restoreSession]);

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

  /*
   * Refresh.
   *
   * This desktop renders from live state, so there is never a stale frame sitting here waiting to
   * be redrawn the way there was on a machine that painted its icons once and then remembered them.
   * That makes Refresh easy to fake and worth not faking: it re-reads the installed apps from
   * storage, which is what the icons are actually drawn from, and remounts the icon layer so the
   * re-read is visible and the selection is dropped with it. Somewhere nothing has changed — the
   * usual case — it is a genuine re-read that finds the same answer, followed by a repaint. Which
   * is all Refresh has ever been anywhere else, too.
   */
  const [refreshToken, setRefreshToken] = useState(0);
  const refreshDesktop = useCallback(() => {
    void loadInstalledApps();
    setRefreshToken((token) => token + 1);
  }, []);

  /*
   * The desktop's own menu. Everything here acts on the desktop rather than on any one window.
   *
   * Grouped the way a desktop menu has been grouped for thirty years: what to do with the icons,
   * then what to paste or make, then where to change how the place looks. It still does not carry
   * Undo, because there is no undo stack to put behind it, and a row that is permanently greyed out
   * is a picture of a feature rather than a feature.
   */
  const backgroundMenu = (): MenuSpec => [
    {
      id: 'desktop.view',
      label: 'View',
      items: iconLayoutMenu(rowsForHeight(viewport.height), settings.hiddenIcons.length),
    },
    {
      id: 'desktop.refresh',
      label: 'Refresh',
      run: refreshDesktop,
    },
    separator('desktop.s1'),
    /*
     * The desktop holds app shortcuts rather than files, so there is nowhere on it for a pasted file
     * to appear. It lands in Home and Files opens there with it selected — the same answer New ›
     * Folder gives, for the same reason. No accelerator is shown: none is bound out here, where Ctrl+V
     * would otherwise be taken from every text field in every window.
     */
    {
      id: 'desktop.paste',
      label: 'Paste',
      disabled: !canPaste(),
      run: () => {
        void pasteFiles(ROOT_ID)
          .then(([first]) => {
            if (first) launchApp('files', { args: { directoryId: ROOT_ID, selectId: first.id } });
          })
          .catch((error: unknown) => notifyError('Could not paste', error));
      },
    },
    separator('desktop.s4'),
    {
      id: 'desktop.new',
      label: 'New',
      items: [
        {
          id: 'desktop.newFolder',
          label: 'Folder',
          run: () => {
            void vfs
              .createDirectory(ROOT_ID, 'New folder')
              .then((node) =>
                launchApp('files', { args: { directoryId: ROOT_ID, selectId: node.id } }),
              )
              .catch((error: unknown) => notifyError('Could not create the folder', error));
          },
        },
        {
          id: 'desktop.newNote',
          label: 'Note',
          run: () => void launchApp('notes', { args: { create: true } }),
        },
      ],
    },
    separator('desktop.s2'),
    {
      id: 'desktop.wallpaper',
      label: 'Personalise…',
      run: () => {
        void pickWallpaperImage().catch((error: unknown) =>
          notifyError('That picture could not be used', error),
        );
      },
    },
    {
      id: 'desktop.settings',
      label: 'Display settings',
      shortcut: 'Ctrl+,',
      run: () => void launchApp('settings'),
    },
    {
      id: 'desktop.tasks',
      label: 'Task Manager',
      run: () => void launchApp('tasks'),
    },
    windows.length > 0 && separator('desktop.s3'),
    windows.length > 0 && {
      id: 'desktop.closeAll',
      label: `Close all windows (${windows.length})`,
      run: closeAllWindows,
      danger: true,
    },
  ];

  const previewRect = snapPreview ? snapRect(snapPreview, viewport) : null;

  return (
    <div className={styles.root}>
      <div
        ref={areaRef}
        className={styles.area}
        /* What DesktopIcons tests a press against before starting a rubber band. */
        data-desktop-surface
        onPointerDown={onAreaPointerDown}
        onContextMenu={(event) => {
          // Only the bare desktop: a menu raised over a window belongs to that window.
          if (event.target !== event.currentTarget) return;
          openMenu(event, backgroundMenu());
        }}
        role="presentation"
      >
        {/* Keyed so Refresh rebuilds the layer rather than merely re-rendering it. */}
        <DesktopIcons key={refreshToken} />
        <LimitedNotice />

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
      </div>

      <Taskbar
        launcherOpen={launcherOpen}
        onToggleLauncher={() => (launcherOpen ? setLauncherOpen(false) : openLauncher())}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      {menu ? <ContextMenu request={menu} onClose={closeMenu} /> : null}
      {launcherOpen ? <Launcher onClose={() => setLauncherOpen(false)} /> : null}
      {paletteOpen ? <CommandPalette onClose={() => setPaletteOpen(false)} /> : null}
      <NotificationLayer />
      <PermissionPrompt />
      {/* One listener for every `title` on the desktop; see Tooltips.tsx. */}
      <Tooltips />
    </div>
  );
}
