import { describe, expect, it } from 'vitest';
import express from 'express';
import pino from 'pino';
import request from 'supertest';
import { REDACT, requestLogger, scrubUrl } from '../../src/lib/logger';

/**
 * The app's logger is silent under test, so this builds one with the same
 * redaction and request serializers, writing to memory instead of stdout.
 */
function captureRequestLog() {
  const lines: Record<string, any>[] = [];
  const stream = { write: (line: string) => void lines.push(JSON.parse(line)) };
  const base = pino({ redact: REDACT }, stream);

  const app = express();
  app.use(requestLogger(base));
  app.get('/api/calendar/callback', (_req, res) => {
    res.setHeader('Set-Cookie', 'refresh=secret-refresh-token');
    res.json({ ok: true });
  });

  return { app, lines };
}

describe('request log redaction', () => {
  it('never writes the bearer token, cookies or OAuth code to the log', async () => {
    const { app, lines } = captureRequestLog();

    await request(app)
      .get('/api/calendar/callback?code=one-time-oauth-code&state=signed-state&page=2')
      .set('Authorization', 'Bearer eyJ.secret-access-token')
      .set('Cookie', 'session=secret-cookie')
      .expect(200);

    const raw = JSON.stringify(lines);
    for (const secret of [
      'secret-access-token',
      'secret-cookie',
      'secret-refresh-token',
      'one-time-oauth-code',
      'signed-state',
    ]) {
      expect(raw).not.toContain(secret);
    }

    const done = lines.find((l) => l.msg === 'request completed')!;
    expect(done.req.headers.authorization).toBe('[Redacted]');
    expect(done.req.headers.cookie).toBe('[Redacted]');
    expect(done.res.headers['set-cookie']).toBe('[Redacted]');
    // Harmless parameters stay readable — the log is still for debugging.
    expect(done.req.url).toBe(
      '/api/calendar/callback?code=[Redacted]&state=[Redacted]&page=2',
    );
  });

  it('scrubs secret parameters wherever they sit in the query', () => {
    expect(scrubUrl('/reset-password?token=abc')).toBe('/reset-password?token=[Redacted]');
    expect(scrubUrl('/x?a=1&CODE=abc#frag')).toBe('/x?a=1&CODE=[Redacted]#frag');
    expect(scrubUrl('/api/health')).toBe('/api/health');
    // Only whole parameter names: `zipcode` is not `code`.
    expect(scrubUrl('/x?zipcode=12345')).toBe('/x?zipcode=12345');
  });
});
