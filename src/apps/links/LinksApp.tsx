import { useOnlineStatus } from '../../kernel/network';
import { ContextMenu, useContextMenu, type MenuSpec } from '../../shell/ContextMenu';
import { Icon } from '../../shell/Icon';
import { copyText } from '../../shell/nodeMenu';
import { PORTFOLIO_LINKS, type PortfolioLink } from './links';
import styles from './LinksApp.module.css';

/**
 * Portfolio.
 *
 * The desktop's answer to "can I put a web browser in here", which is no: an in-page browser would
 * need to load third-party origins, and this project's whole claim is that it contacts one host and
 * can prove it in the Task Manager. Most sites refuse to be framed anyway, and the CSP that buys
 * cross-origin isolation forbids it — so the honest version is a list of links that hand the URL to
 * the real browser and let it do the browsing. See ADR 19.
 *
 * Nothing here is fetched. Every link shows its own host, because a link that does not say where it
 * goes is asking for trust it has not earned — including this one.
 */
export default function LinksApp() {
  const online = useOnlineStatus();
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <h2 className={styles.title}>Other things I have built</h2>
        <p className={styles.subtitle}>
          These open in a new browser tab. Tabula does not load them — watch the network panel in
          Task Manager while you click one, and it stays empty.
        </p>
      </header>

      {!online ? (
        <p className={styles.offline} role="status">
          <Icon name="offline" size={14} /> You are offline, so these will not load until you are
          back. The desktop itself carries on regardless.
        </p>
      ) : null}

      <ul className={styles.list}>
        {PORTFOLIO_LINKS.map((link) => (
          <li key={link.id}>
            <LinkCard link={link} onMenu={openMenu} />
          </li>
        ))}
      </ul>

      {menu ? <ContextMenu request={menu} onClose={closeMenu} /> : null}

      <footer className={styles.footer}>
        <Icon name="info" size={13} />
        <span>
          Edit <code>src/apps/links/links.ts</code> to change this list.
        </span>
      </footer>
    </div>
  );
}

function LinkCard({
  link,
  onMenu,
}: {
  link: PortfolioLink;
  onMenu: (event: React.MouseEvent, items: MenuSpec) => void;
}) {
  const host = hostOf(link.url);

  return (
    <a
      className={styles.card}
      href={link.url}
      target="_blank"
      // noreferrer as well as noopener: the destination has no business knowing which page sent you.
      rel="noopener noreferrer"
      onContextMenu={(event) =>
        onMenu(event, [
          {
            id: 'link.open',
            label: 'Open in a new tab',
            run: () => globalThis.open(link.url, '_blank', 'noopener,noreferrer'),
          },
          { id: 'link.copy', label: 'Copy link', run: () => copyText(link.url, 'Link copied') },
        ])
      }
    >
      <span className={styles.badge} aria-hidden>
        {link.kind === 'source' ? (
          <Icon name="apps" size={18} />
        ) : link.kind === 'profile' ? (
          <Icon name="info" size={18} />
        ) : (
          link.name.slice(0, 1).toUpperCase()
        )}
      </span>

      <span className={styles.body}>
        <span className={styles.name}>
          {link.name}
          <Icon name="external" size={13} className={styles.externalIcon} />
        </span>
        <span className={styles.blurb}>{link.blurb}</span>
        <span className={styles.meta}>
          <span className={styles.host}>{host}</span>
          {link.tag ? <span className={styles.tag}>{link.tag}</span> : null}
        </span>
      </span>
    </a>
  );
}

/** The host, or the raw string if it will not parse — never a silent blank. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
