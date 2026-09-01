import { PageHead } from '../components/layout';
import { SHORTCUTS } from '../components/HelpMenu';

/**
 * Help & Support.
 *
 * A page rather than a popover, because it is reached from the sidebar and
 * every other item in that list navigates. A nav row that opens a panel
 * instead is a small lie about what it does — and the panel was clipped by the
 * sidebar's own scrolling anyway, which is the practical half of the argument.
 *
 * The `?` in the top bar keeps the popover: from there it IS a glance, and
 * leaving the page you are on to read two lines would be the wrong trade.
 * Both read `SHORTCUTS`, so the two can never disagree.
 *
 * The support section says what is true today. There is no help desk, no
 * documentation site and no support address in this product — checked in the
 * config and the marketing pages, not assumed — so this points at the person
 * who can actually act, which for a studio account is its owner.
 */
export default function Help() {
  return (
    <>
      <PageHead
        title="Help &amp; Support"
        lede="Getting around, and where to go when something is wrong."
      />

      <section className="card settings-section">
        <h2>Keyboard shortcuts</h2>
        <ul className="mini-list">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="mini-row">
              <span className="mini-main">{s.what}</span>
              <kbd>{s.keys}</kbd>
            </li>
          ))}
        </ul>
      </section>

      <section className="card settings-section">
        <h2>Something looks wrong</h2>
        <p className="sub">
          The bell in the top bar carries live problems rather than a history —
          payments not connected, a calendar whose access expired, messages that
          failed to send. If something is wrong with your studio, it is usually
          named there, with a link to the screen that fixes it.
        </p>
        <p className="sub">
          For anything else, your studio owner can reach the Artweel team. There
          is no support desk inside the product yet.
        </p>
      </section>
    </>
  );
}
