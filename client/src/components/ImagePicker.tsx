import { useRef, useState } from 'react';
import { api, mediaUrl, type UploadedImage } from '../lib/api';

/**
 * A photo field (FB-11): choose, preview, replace, remove, describe.
 *
 * The file is uploaded as soon as it is chosen, so the preview is the real
 * processed photo (turned the right way up, resized) and the form only saves
 * a key. The key is not attached to anything until the form is saved; if the
 * form is abandoned the upload is simply never used.
 *
 * Alt text sits right under the photo and is required whenever there is
 * one — the server refuses a photo without it too.
 */
export type ImageValue = { key: string | null; alt: string };

export function ImagePicker({
  base,
  id,
  label,
  value,
  onChange,
  shape = 'wide',
  hint,
}: {
  base: string;
  id: string;
  label: string;
  value: ImageValue;
  onChange: (next: ImageValue) => void;
  /** 'wide' for an activity card, 'square' for a portrait. */
  shape?: 'wide' | 'square';
  hint?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > 8 * 1024 * 1024) {
      setError('That photo is over 8 MB. Please choose a smaller one.');
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const res = await api.upload<{ image: UploadedImage }>(`${base}/media`, form);
      onChange({ key: res.image.key, alt: value.alt });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload that photo.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  const src = mediaUrl(value.key, 'small');
  const needsAlt = Boolean(value.key) && !value.alt.trim();

  return (
    <div className="setting setting-stack image-picker">
      <label htmlFor={id}>{label}</label>

      <div className={`image-picker-row ${shape}`}>
        <div className={`image-picker-frame ${shape}`}>
          {src ? (
            <img src={src} alt={value.alt || ''} />
          ) : (
            <span className="tiny muted">No photo</span>
          )}
        </div>

        <div className="image-picker-actions">
          <input
            ref={input}
            id={id}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => void choose(e.target.files?.[0])}
          />
          <button type="button" className="sm" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Uploading…' : value.key ? 'Replace photo' : 'Add a photo'}
          </button>
          {value.key && !busy && (
            <button
              type="button"
              className="sm link"
              onClick={() => onChange({ key: null, alt: '' })}
            >
              Remove
            </button>
          )}
          <p className="tiny muted">{hint ?? 'JPEG, PNG or WebP, up to 8 MB.'}</p>
        </div>
      </div>

      {error && <p className="tiny err" role="alert">{error}</p>}

      {value.key && (
        <div className="setting setting-stack">
          <label htmlFor={`${id}Alt`}>Describe the photo</label>
          <input
            id={`${id}Alt`}
            value={value.alt}
            maxLength={300}
            placeholder={shape === 'square' ? 'e.g. Sam at the wheel, smiling' : 'e.g. Two people shaping bowls on the wheel'}
            aria-invalid={needsAlt}
            onChange={(e) => onChange({ key: value.key, alt: e.target.value })}
          />
          <p className={`tiny ${needsAlt ? 'danger-text' : 'muted'}`}>
            {needsAlt
              ? 'Needed before saving — read aloud to people who cannot see the photo.'
              : 'Read aloud to people who cannot see the photo.'}
          </p>
        </div>
      )}
    </div>
  );
}
