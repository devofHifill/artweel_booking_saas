import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { healthCheck } from './health.controller';

export const healthRouter = Router();

healthRouter.get('/', asyncHandler(healthCheck));
