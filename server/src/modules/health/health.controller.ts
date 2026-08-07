import type { Request, Response } from 'express';
import { getHealth } from './health.service';

export async function healthCheck(_req: Request, res: Response) {
  const report = await getHealth();
  res.status(report.status === 'ok' ? 200 : 503).json(report);
}
