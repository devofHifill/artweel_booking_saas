# /demo — static product prototypes

**This directory is temporary.** It holds self-contained front-end prototypes
served by the Artweel app at `/demo`, so they can be shown from this host
without deploying anything else. They are plain HTML/CSS/JS: no build step, no
database, no API, no session. Nothing in `src/` imports them and nothing here
imports the app.

```
demos/
  index.html          the demo gallery served at /demo
  tourflow/           TourFlow — booking & management SaaS prototype
```

## How it is wired in

Three places, all marked `TEMPORARY`:

| File | What it does |
| --- | --- |
| `server/src/app.ts` | `express.static` mount at `/demo` |
| `server/Dockerfile` | `COPY demos ./demos` into the runtime image |
| `server/src/modules/marketing/landing.ts` and `render.ts` | the `Demo` link in the site header |

**To remove it all:** delete those four edits and this directory. Nothing else
references them, and no test asserts on them.

## Running it locally

The demos are static, so any static server works, but the simplest check is the
app itself:

```bash
npm run dev
```

then open <http://localhost:4000/demo/>. Opening `demos/tourflow/index.html`
straight from the filesystem also works — there is no server dependency.

## Content Security Policy

The app's helmet CSP is `default-src 'self'` with `'unsafe-inline'` allowed for
scripts and styles. Everything in here is same-origin and self-contained: no
CDN, no web font, no external image, no network call of any kind. Keep it that
way or the demos will silently break behind the CSP.
