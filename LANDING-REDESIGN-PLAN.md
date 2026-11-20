# Public landing page: review and redesign plan

Reviewed 2026-11-20 against the live site (https://bookaihub.com) at desktop (1130px) and phone (375px) widths, and against `server/src/modules/marketing/`.

## 1. What's there today

The home page is rendered by the server from `landing.ts` + `landing-css.ts` + `landing-js.ts`, with copy in `verticals.ts` (`GENERAL`) and `content.ts`. The ten `/for/<trade>` pages use the same template. `/pricing`, `/alternatives/*` and `/guides/*` use a second, plainer template in `render.ts`.

Home, top to bottom (15 blocks, about 10,500px tall on desktop and **18,300px on a phone, about 22 screens**):

| # | Section | Height (desktop) |
|---|---|---|
| 1 | Hero + schedule mock-up | 1,220px |
| 2 | Stats band (0% / 100% / 14 / 1) | 166 |
| 3 | How it works (3 steps) | 743 |
| 4 | Features (8 cards) | 1,060 |
| 5 | "Built for how it actually runs" + capacity mock-up | 498 |
| 6 | Booking page | 546 |
| 7 | On-site work | 611 |
| 8 | Integrations | 455 |
| 9 | Comparison table | 946 |
| 10 | Being built next | 571 |
| 11 | Pricing | 1,226 |
| 12 | FAQ | 468 |
| 13 | Who it's for (10 trades) | 911 |
| 14 | Final CTA | 597 |
| 15 | Footer | 378 |

**What works and should stay:** the positioning (equipment-aware capacity, studio + mobile in one schedule, no commission) is specific and strong. The copy is written in owners' words. The ten trade pages are a good SEO and conversion engine, and `organizations.signup_landing` already measures them. The "never claim what doesn't ship" rule is right. No horizontal scroll on phones, and canonical, robots, sitemap and JSON-LD are in place.

## 2. Problems found

### A. Claims that are wrong (fix first, whatever happens with the redesign)

1. **The roadmap undersells.** "Being built next" lists waitlists, class packs, make-up sessions and piece tracking as not available. All four shipped in commit `61ce328` (`modules/waitlists`, `packs`, `credits`, `pieces`, `firings`, with `Packs.tsx`, `Pieces.tsx`, `Firings.tsx` in the app). `COMING_SOON` in `content.ts` and FAQ answers in `verticals.ts` (around lines 479, 755, 892) still say "not yet". *Confirm they're production-ready, then move them into the features.*
2. **The Pro plan sells two things that don't exist.** The card says "API access and your own domain". `billing/plan.ts:132-134` itself records: "There is no public API to gate" and `whiteLabel` is "referenced by nothing at all". This breaks the page's own rule. Either drop both from Pro or build them.
3. **The comparison table's labels contradict the content.** In the "Commission on bookings" row, the BookAIHub column reads "Yes. Nothing", and the generic column reads "No. A percentage…". The ✓/✗ marks mean "good/bad", but the hidden text says yes/no, so screen readers read nonsense.
4. `/alternatives/momence` is titled "A Momence alternative for **pottery studios**", left over from before the site went multi-trade.

### B. Structure and length

5. **Too long, and it repeats itself.** "Capacity = what you own" is explained four times: feature card 1, the "How it runs" section (whose paragraph repeats feature card 1 almost word for word), comparison row 1 and the trade grid. "No commission" appears seven times: hero, stats, feature card, comparison, pricing, final CTA and footer badge. The same schedule mock-up appears twice (hero and section 5).
6. **The hero is 1,220px tall.** On a 646px-high laptop screen, the product mock-up starts below the fold. The headline breaks into three lines with "own" left alone on the last one.
7. **The order works against the reader.** "Who it's for" (the strongest "this is for me" moment) comes 13th, after pricing and the FAQ. The roadmap sits between the comparison and pricing, so the last thing read before the price is "not available yet".
8. **Eight equal feature cards of about 50 words each** make a wall of text. Nothing is ranked.

### C. Visual and trust

9. **No images at all** (0 `<img>`). Everything is a hand-built CSS mock-up. There are no real product screenshots and no photos of the trades being sold to (pottery, kayaks, workshops), which are very photogenic.
10. **No social proof:** no testimonials, studio names, numbers or logos.
11. **The integrations strip uses letter tiles** (S, G, @, #) instead of real logos. Instagram is a place to paste a link, not an integration.
12. **Two visual identities.** Home and trade pages are warm dark brown with orange. `/pricing`, `/alternatives`, `/guides` are slate blue-grey with a different header and type scale. They feel like two different companies.
13. **No social preview image.** `twitter:card` is `summary_large_image`, but there's no `og:image` (`/og.png` returns 404), so links shared on Instagram, Facebook or Slack show no picture.

### D. Behaviour and speed

14. **Nav highlighting is off.** While reading Pricing and the roadmap, "Features" stays highlighted. At the final CTA, "Who it is for" is highlighted. "FAQ" links to `#guides`. In the footer, Pricing goes to `/pricing` while the header goes to `#pricing`.
15. **The home HTML is 116 KB and served uncompressed** (no `content-encoding` header). Gzip would cut it to about 25 KB. Two Google Font families (Inter 5 weights + Instrument Serif) block rendering.

## 3. Redesign goals

1. A visitor knows **what it is, who it's for and that it fits their trade** within the first screen.
2. Halve the length: **about 9 sections, about 6,000px on desktop and 10–11 screens on a phone.**
3. Show the real product: **actual app screenshots** and trade photography instead of only CSS mock-ups.
4. **One design system** for home, trade pages, pricing, guides and comparisons.
5. Every claim stays true. Shipped features are shown as shipped.

## 4. Proposed page structure

| # | Section | What it does | Replaces |
|---|---|---|---|
| 1 | **Header** | Logo · Product ▾ · Who it's for ▾ (all 10 trades) · Pricing · Demo · Sign in · **Start free** | Current header (fixes highlighting) |
| 2 | **Hero (split)** | Two-line headline, sub-line, two CTAs, "No card · no commission" line. On the right, a real schedule screenshot with **trade chips** (Pottery · Kayak · Workshop · Tours) that swap the nouns and resources in the mock-up. Fits in one laptop screen. | Hero + stats band |
| 3 | **Trust strip** | Real Stripe and Google Calendar logos, "Payments go to your own Stripe", plus studio logos or a quote once we have them | Integrations strip |
| 4 | **The problem** | "Generic tools count appointments. You have eight wheels." One short paragraph and a **5-row comparison** | "How it runs" + comparison table |
| 5 | **Three big features**, alternating left and right with real screenshots | ① Capacity from what you own ② Booking link + deposits + refunds ③ On-site work with travel zones | Feature cards 1–4, booking page, on-site |
| 6 | **Everything else**, a compact grid of 9 with an icon and one line each | Courses · Register · Reminders · Calendar sync · **Waitlists** · **Class packs** · **Make-up credits** · **Piece tracking** · Self-serve reschedule | Feature cards 5–8 + roadmap |
| 7 | **How it works** (3 steps, tightened) | Kept, with shorter copy | Same |
| 8 | **Who it's for** | 10 trade cards with a photo each, linking to `/for/...` | Moved up from #13 |
| 9 | **Pricing** | 3 cards with corrected Pro claims and a "Compare plans" link to `/pricing` | Same, shorter |
| 10 | **FAQ** (5–6 questions) + **final CTA** | Merged into one block | FAQ + CTA |
| 11 | **Footer** | Same links, fixed | Same |

"Being built next" is removed from home. If something new is on the way, it goes on a `/roadmap` page linked from the footer.

## 5. Design system: direction A, "clean and light" (chosen 2026-11-20)

The look of a modern booking platform (Calendly, Fresha, Cal.com): white and airy, built around real app screenshots.

- **Colour:** white page (`#ffffff`) with soft grey section bands (`#f6f7f9`), near-black text (`#111318`), grey body text (`#5b616e`) and hairline borders (`#e6e8ec`). **The brand orange (`#e8642c`) is the one accent**, used for primary buttons, links and highlights only. Status colours appear only inside the product mock-ups: green for "spots left", red for "full", plus pale orange, blue and green tints for event types.
- **Type:** Inter for everything, in three weights (400, 500, 600). Drop Instrument Serif. Headings are large and tight (hero about 56px on desktop, 36px on phones) with no italic accent words.
- **Shape:** 12–16px rounded cards, pill buttons, soft shadows only on the product screenshots (browser and phone frames). No glows, rings or aurora backgrounds.
- **Dark mode:** none for the marketing site (`color-scheme: light`). The app itself is unaffected.
- **Imagery:** (a) app screenshots taken from the demo studio, at 2× and in WebP; (b) one photo per trade, licensed stock or ideally from real studios such as Art Wheel.
- **Components** in one shared stylesheet for both templates: section header, split feature block, icon grid card, plan card, FAQ item, CTA band, trade card.
- **Motion:** keep the subtle fade-up on scroll, respect `prefers-reduced-motion`, and drop the decorative rings and aurora on phones.

## 6. Work plan

| Phase | Work | Files | Size |
|---|---|---|---|
| **0. Truth fixes** (can ship now) | Confirm the four shipped features and move them out of `COMING_SOON` and the FAQ "not yet" answers. Remove API and own domain from Pro (or decide to build them). Fix comparison yes/no labels. Fix the Momence page title. | `content.ts`, `verticals.ts`, `billing/plan.ts`, `landing.ts` | Small |
| **1. Quick wins** | Gzip or Brotli for HTML in nginx. Add an `og:image` (1200×630). Fix nav highlighting and the FAQ anchor. Trim font weights. | `docker/` nginx config, `landing.ts`, `landing-js.ts` | Small |
| **2. Assets** | Capture app screenshots from the demo studio. Pick 10 trade photos. Make real logo SVGs. | new `server/public/marketing/` (or wherever static files are served) | Medium |
| **3. Home rebuild** | New section order and components from §4–5, keeping copy as data in `verticals.ts` so the 10 trade pages get the new layout for free | `landing.ts`, `landing-css.ts`, `landing-js.ts`, `verticals.ts` | Large |
| **4. One template** | Move `/pricing`, `/alternatives/*`, `/guides/*` onto the shared header, footer and styles | `render.ts`, `landing-css.ts` | Medium |
| **5. Check and measure** | Lighthouse (aim for 95+ on mobile performance and accessibility), phone checks at 360/390/430px, then compare `signup_landing` sign-ups for 4 weeks before and after | — | Small |

Each phase can ship separately. Phase 0 matters most: it's what a careful buyer could catch us on today.

## 7. Decisions

Decided 2026-11-20:

1. **Look:** direction A, clean and light (see §5).
2. **Waitlists, class packs, make-up credits and piece tracking:** advertise them as shipped (default; they're built in commit `61ce328`).
3. **Pro plan:** remove "API access" and "your own domain" until they exist (default).
4. **Testimonials:** launch without them and leave a slot in the design (default).

Still open:

5. **Demo:** `/demo/` is linked from the header. Should it become the main secondary CTA instead of "See pricing"?
