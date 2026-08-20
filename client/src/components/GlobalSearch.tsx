import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useOrgBase } from '../lib/auth';
import { Icon } from './Icon';

/**
 * Search across customers, upcoming bookings and classes.
 *
 * One request per settled keystroke, answered by `/shell/search`, rather than
 * the client fanning out to three list endpoints. Beyond the extra traffic, the
 * fan-out version has to decide which of three in-flight responses is still
 * current — and gets it wrong exactly when somebody types fast.
 */

type Results = {
  customers: { id: string; name: string; email: string }[];
  bookings: {
    id: string;
    startsAt: string;
    status: string;
    customerId: string;
    customerName: string;
    className: string;
  }[];
  classes: { id: string; name: string; color: string }[];
};

const EMPTY: Results = { customers: [], bookings: [], classes: [] };

/** Flattened, because the keyboard walks one list regardless of the headings. */
type Hit = { key: string; label: string; meta?: string; to: string };

function flatten(results: Results): Hit[] {
  return [
    ...results.customers.map((c) => ({
      key: `c-${c.id}`,
      label: c.name,
      meta: c.email,
      to: `/customers/${c.id}`,
    })),
    ...results.bookings.map((b) => ({
      key: `b-${b.id}`,
      label: `${b.customerName} — ${b.className}`,
      meta: new Date(b.startsAt).toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }),
      /*
        A booking has no page of its own, so this lands on the customer, where
        the booking is listed. Pointing at a route that does not exist to keep
        the result "complete" would be worse than sending somebody one click
        away from what they wanted.
      */
      to: `/customers/${b.customerId}`,
    })),
    ...results.classes.map((s) => ({
      key: `s-${s.id}`,
      label: s.name,
      meta: 'Class',
      to: '/classes',
    })),
  ];
}

export function GlobalSearch() {
  const base = useOrgBase();
  const navigate = useNavigate();
  const listId = useId();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Results>(EMPTY);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const hits = flatten(results);

  /**
   * "/" focuses the box, the way every search-first tool behaves.
   *
   * Guarded against firing while somebody is typing a slash into a real field —
   * without the check, a note containing a URL becomes impossible to write.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/') return;

      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      if (typing) return;

      event.preventDefault();
      inputRef.current?.focus();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Clicking anywhere else closes the results. */
  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  /**
   * Debounced, and cancelled on the way out.
   *
   * `cancelled` is what stops an earlier, slower response overwriting a later
   * one — the classic search race, where deleting a character leaves you looking
   * at results for the word you already removed.
   */
  useEffect(() => {
    const term = query.trim();

    if (term.length < 2) {
      setResults(EMPTY);
      return;
    }

    let cancelled = false;

    const timer = setTimeout(() => {
      api
        .get<Results>(`${base}/shell/search?q=${encodeURIComponent(term)}`)
        .then((res) => {
          if (cancelled) return;
          setResults(res);
          setActive(0);
          setOpen(true);
        })
        .catch(() => {
          if (!cancelled) setResults(EMPTY);
        });
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, base]);

  function go(hit: Hit) {
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
    navigate(hit.to);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }

    if (!hits.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = hits[active];
      if (hit) go(hit);
    }
  }

  const showPanel = open && query.trim().length >= 2;

  return (
    <div className="search-wrap" ref={wrapRef}>
      <Icon name="search" size={16} className="search-icon" />

      <input
        ref={inputRef}
        className="search-input"
        type="search"
        value={query}
        placeholder="Search customers, bookings, classes…"
        aria-label="Search"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => query.trim().length >= 2 && setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {/* Hidden once typing starts — a shortcut hint over your own text is noise. */}
      {!query && <span className="kbd" aria-hidden="true">/</span>}

      {showPanel && (
        <div className="search-results" id={listId} role="listbox">
          {hits.length === 0 ? (
            <p className="search-none">No matches for “{query.trim()}”.</p>
          ) : (
            <>
              <Group
                title="Customers"
                hits={hits.filter((h) => h.key.startsWith('c-'))}
                allHits={hits}
                active={active}
                onPick={go}
                onHover={setActive}
              />
              <Group
                title="Upcoming bookings"
                hits={hits.filter((h) => h.key.startsWith('b-'))}
                allHits={hits}
                active={active}
                onPick={go}
                onHover={setActive}
              />
              <Group
                title="Classes"
                hits={hits.filter((h) => h.key.startsWith('s-'))}
                allHits={hits}
                active={active}
                onPick={go}
                onHover={setActive}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Group({
  title,
  hits,
  allHits,
  active,
  onPick,
  onHover,
}: {
  title: string;
  hits: Hit[];
  /** The flat list, so a heading does not restart the highlight index. */
  allHits: Hit[];
  active: number;
  onPick: (hit: Hit) => void;
  onHover: (index: number) => void;
}) {
  if (!hits.length) return null;

  return (
    <>
      <p className="search-group">{title}</p>
      {hits.map((hit) => {
        const index = allHits.indexOf(hit);
        return (
          <button
            key={hit.key}
            type="button"
            role="option"
            aria-selected={index === active}
            className={`search-hit ${index === active ? 'on' : ''}`}
            /*
              mousedown, not click: the input's blur fires first on click and
              closes the panel, so the click lands on nothing. This is the single
              most common bug in hand-rolled autocompletes.
            */
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(hit);
            }}
            onMouseEnter={() => onHover(index)}
          >
            <span className="hit-label">{hit.label}</span>
            {hit.meta && <span className="hit-meta">{hit.meta}</span>}
          </button>
        );
      })}
    </>
  );
}
