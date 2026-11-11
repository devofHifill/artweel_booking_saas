import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Modal } from './layout';

/**
 * Activity categories (FB-13).
 *
 * The server could create and delete categories from the start; no screen
 * ever called it, so every picker offered "Uncategorised" and nothing else.
 * Two pieces close that:
 *
 * - `CategoryPicker`, the select both activity editors use, with a
 *   "New category…" choice that creates one on the spot and selects it, so
 *   nobody has to leave a half-filled form to go and make one.
 * - `CategoryManager`, a dialog on the Activities page to add, rename and
 *   delete them, saying how many activities each one holds.
 */

export type Category = { id: string; name: string; activityCount?: number };

const NEW = '__new__';

export function CategoryPicker({
  base,
  id,
  value,
  onChange,
  categories,
  onCategoriesChange,
  canCreate = true,
}: {
  base: string;
  id: string;
  value: string;
  onChange: (categoryId: string) => void;
  categories: Category[];
  onCategoriesChange: (next: Category[]) => void;
  canCreate?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const trimmed = name.trim();
    if (busy) return;
    if (!trimmed) {
      setError('Give the category a name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ category: Category }>(`${base}/services/categories`, {
        name: trimmed,
      });
      onCategoriesChange(
        [...categories, res.category].sort((a, b) => a.name.localeCompare(b.name)),
      );
      onChange(res.category.id);
      setAdding(false);
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the category.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <select
        id={id}
        value={adding ? NEW : value}
        onChange={(e) => {
          if (e.target.value === NEW) {
            setAdding(true);
            setError(null);
            return;
          }
          setAdding(false);
          onChange(e.target.value);
        }}
      >
        <option value="">Uncategorised</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        {canCreate && <option value={NEW}>+ New category…</option>}
      </select>

      {adding && (
        <div className="category-add">
          <input
            aria-label="New category name"
            placeholder="e.g. Kids, Date night, Wheel"
            value={name}
            maxLength={100}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              /* Enter adds the category; it must not submit the form around it. */
              if (e.key === 'Enter') {
                e.preventDefault();
                void add();
              }
            }}
          />
          <button type="button" className="primary" disabled={busy} onClick={() => void add()}>
            {busy ? 'Adding…' : 'Add'}
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              setAdding(false);
              setName('');
              setError(null);
            }}
          >
            Cancel
          </button>
          {error && <span className="err tiny" role="alert">{error}</span>}
        </div>
      )}
    </>
  );
}

export function CategoryManager({
  base,
  onClose,
  onChanged,
}: {
  base: string;
  onClose: () => void;
  /** After any change, so the page can reload the activities it shows. */
  onChanged: () => void;
}) {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await api.get<{ categories: Category[] }>(`${base}/services/categories`);
      setCategories(res.categories);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load categories.');
    }
  }

  // Loaded once, when the dialog opens.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      onChanged();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  /* Kept focused after each add, so several categories can be typed in a row;
     the Add button disables while saving, which otherwise drops the focus. */
  const newRef = useRef<HTMLInputElement>(null);

  async function add() {
    const name = newName.trim();
    /* Enter submits the form even while the Add button is disabled; one save
       at a time, or a name typed during the first save is saved half-joined. */
    if (!name || busy) return;
    /* Cleared at once, so the next name starts in an empty box; put back if
       the save fails, so nothing typed is lost. */
    setNewName('');
    if (!(await run(() => api.post(`${base}/services/categories`, { name })))) {
      setNewName(name);
    }
    requestAnimationFrame(() => newRef.current?.focus());
  }

  async function rename() {
    if (!renaming) return;
    const target = renaming;
    if (
      await run(() =>
        api.patch(`${base}/services/categories/${target.id}`, { name: target.name.trim() }),
      )
    ) {
      setRenaming(null);
    }
  }

  async function remove(id: string) {
    if (await run(() => api.del(`${base}/services/categories/${id}`))) setConfirmDelete(null);
  }

  return (
    <Modal
      title="Categories"
      subtitle="They group your activities on your booking page and in the filter above."
      onClose={onClose}
    >
      {error && (
        <div className="err" role="alert">
          {error}
        </div>
      )}

      <form
        className="category-add"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          ref={newRef}
          aria-label="New category name"
          placeholder="New category, e.g. Kids"
          value={newName}
          maxLength={100}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button className="primary" disabled={busy || !newName.trim()}>
          Add
        </button>
      </form>

      {categories === null ? (
        <p className="muted tiny">Loading…</p>
      ) : categories.length === 0 ? (
        <p className="muted">
          No categories yet. Add one above, or choose "+ New category…" while editing an
          activity.
        </p>
      ) : (
        <ul className="category-list">
          {categories.map((c) => {
            const count = c.activityCount ?? 0;
            const used = `${count} ${count === 1 ? 'activity' : 'activities'}`;
            return (
              <li key={c.id}>
                {renaming?.id === c.id ? (
                  <form
                    className="category-add"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void rename();
                    }}
                  >
                    <input
                      aria-label={`New name for ${c.name}`}
                      value={renaming.name}
                      maxLength={100}
                      autoFocus
                      onChange={(e) => setRenaming({ id: c.id, name: e.target.value })}
                    />
                    <button className="primary" disabled={busy || !renaming.name.trim()}>
                      Save
                    </button>
                    <button type="button" className="link" onClick={() => setRenaming(null)}>
                      Cancel
                    </button>
                  </form>
                ) : confirmDelete === c.id ? (
                  <div className="category-confirm">
                    <span>
                      Delete <b>{c.name}</b>?{' '}
                      {count > 0
                        ? `Its ${used} stay on your booking page, as Uncategorised.`
                        : 'Nothing uses it.'}
                    </span>
                    <span className="category-actions">
                      <button
                        type="button"
                        className="primary"
                        disabled={busy}
                        onClick={() => void remove(c.id)}
                      >
                        Delete
                      </button>
                      <button type="button" className="link" onClick={() => setConfirmDelete(null)}>
                        Keep it
                      </button>
                    </span>
                  </div>
                ) : (
                  <>
                    <span className="category-name">
                      {c.name}
                      <span className="tiny muted"> · {used}</span>
                    </span>
                    <span className="category-actions">
                      <button
                        type="button"
                        className="link"
                        onClick={() => {
                          setConfirmDelete(null);
                          setRenaming({ id: c.id, name: c.name });
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="link danger-text"
                        onClick={() => {
                          setRenaming(null);
                          setConfirmDelete(c.id);
                        }}
                      >
                        Delete
                      </button>
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
