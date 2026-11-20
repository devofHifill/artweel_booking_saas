import { BRAND } from './content';

/** Local, so this module imports nothing from the templates that use it. */
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The BookAIHub logo, redrawn as SVG from the supplied artwork (2026-11-20):
 * a calendar with peach day tiles and one orange tile, an orange check
 * badge, and an orange orbit around it all. Colours for the calendar body
 * and face come from --lm-body / --lm-face, so the mark can flip to a light
 * calendar on dark backgrounds. `id` keeps gradient ids unique per use.
 */
export const logoMark = (id: string) => `<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none">
<defs>
<linearGradient id="lo${id}" x1="4" y1="50" x2="60" y2="10" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ff9a52"/><stop offset=".55" stop-color="#ff7a2e"/><stop offset="1" stop-color="#ff8a3d"/></linearGradient>
<linearGradient id="lc${id}" x1="34" y1="32" x2="54" y2="52" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ff8a3d"/><stop offset="1" stop-color="#ef4f17"/></linearGradient>
</defs>
<path d="M40 9.5C53 3.5 65 5.5 61.5 17.5 58 29.5 41 47 24.5 52 10.5 56.2.4 51.6 1.4 44.6 2.1 39.6 5.6 33.4 9.6 29.4 6.2 34.8 4.8 40.6 7.2 44 10.8 49.2 23.4 47.6 34.2 42.2 47.2 35.6 56.6 25.6 57 17.4 57.3 11.2 50.6 9.4 40 9.5Z" fill="url(#lo${id})"/>
<rect x="9" y="12" width="37" height="34" rx="7.5" fill="var(--lm-body,#262833)"/>
<rect x="14" y="19.5" width="27" height="21.5" rx="3.5" fill="var(--lm-face,#fff)"/>
<rect x="18.4" y="7" width="5.4" height="10.5" rx="2.7" fill="var(--lm-body,#262833)" stroke="var(--lm-face,#fff)" stroke-width="1.6"/>
<rect x="31.2" y="7" width="5.4" height="10.5" rx="2.7" fill="var(--lm-body,#262833)" stroke="var(--lm-face,#fff)" stroke-width="1.6"/>
<g fill="#fdd0b4"><rect x="17" y="23" width="5.6" height="5.6" rx="1.4"/><rect x="24.7" y="23" width="5.6" height="5.6" rx="1.4"/><rect x="32.4" y="23" width="5.6" height="5.6" rx="1.4"/><rect x="17" y="31" width="5.6" height="5.6" rx="1.4"/></g>
<rect x="24.7" y="31" width="5.6" height="5.6" rx="1.4" fill="#f25a1f"/>
<circle cx="44" cy="43" r="10.2" fill="url(#lc${id})" stroke="var(--lm-face,#fff)" stroke-width="2.4"/>
<path d="m39.4 43.2 3.2 3.1 6-6.2" stroke="#fff" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>
</svg></span>`;

/** The wordmark as text: Book, AI in the orange gradient, Hub. */
export const WORDMARK = `<span class="wm-text">${esc(BRAND).replace('AI', '<em>AI</em>')}</span>`;

/** The mark as a favicon: same drawing, fixed colours (no CSS variables). */
export const FAVICON_HREF = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' fill='none'%3E%3Cpath d='M40 9.5C53 3.5 65 5.5 61.5 17.5 58 29.5 41 47 24.5 52 10.5 56.2.4 51.6 1.4 44.6 2.1 39.6 5.6 33.4 9.6 29.4 6.2 34.8 4.8 40.6 7.2 44 10.8 49.2 23.4 47.6 34.2 42.2 47.2 35.6 56.6 25.6 57 17.4 57.3 11.2 50.6 9.4 40 9.5Z' fill='%23ff7a2e'/%3E%3Crect x='9' y='12' width='37' height='34' rx='7.5' fill='%23262833'/%3E%3Crect x='14' y='19.5' width='27' height='21.5' rx='3.5' fill='%23fff'/%3E%3Crect x='18.4' y='7' width='5.4' height='10.5' rx='2.7' fill='%23262833'/%3E%3Crect x='31.2' y='7' width='5.4' height='10.5' rx='2.7' fill='%23262833'/%3E%3Cg fill='%23fdd0b4'%3E%3Crect x='17' y='23' width='5.6' height='5.6' rx='1.4'/%3E%3Crect x='24.7' y='23' width='5.6' height='5.6' rx='1.4'/%3E%3Crect x='32.4' y='23' width='5.6' height='5.6' rx='1.4'/%3E%3Crect x='17' y='31' width='5.6' height='5.6' rx='1.4'/%3E%3C/g%3E%3Crect x='24.7' y='31' width='5.6' height='5.6' rx='1.4' fill='%23f25a1f'/%3E%3Ccircle cx='44' cy='43' r='10.2' fill='%23f25a1f' stroke='%23fff' stroke-width='2.4'/%3E%3Cpath d='m39.4 43.2 3.2 3.1 6-6.2' stroke='%23fff' stroke-width='2.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";
