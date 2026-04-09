import { Router, Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { TweetStream } from './stream';
import { config } from './config';

function requireSecret(req: Request, res: Response, next: NextFunction): void {
  if (!config.apiSecret) {
    next();
    return;
  }
  const provided =
    (req.headers['x-api-secret'] as string) ||
    (req.query['secret'] as string);
  if (provided !== config.apiSecret) {
    res.status(401).json({ ok: false, error: 'Invalid or missing API secret' });
    return;
  }
  next();
}

export function createRouter(stream: TweetStream): Router {
  const router = Router();

  // GET /api/tweets — returns latest buffered tweets (REST)
  router.get('/tweets', requireSecret, (req: Request, res: Response) => {
    const limit = Math.min(parseInt((req.query.limit as string) || '50'), 200);
    const tweets = stream.getBuffer(limit);
    res.json({
      ok: true,
      count: tweets.length,
      tweets,
    });
  });

  // GET /api/stream — Server-Sent Events real-time stream
  router.get('/stream', requireSecret, (req: Request, res: Response) => {
    const clientId = randomUUID();
    stream.addClient(clientId, res);

    req.on('close', () => {
      stream.removeClient(clientId);
    });
  });

  // GET /api/health — health check
  router.get('/health', (_req: Request, res: Response) => {
    const stats = stream.getStats();
    res.json({
      ok: true,
      status: 'running',
      ...stats,
      timestamp: Date.now(),
    });
  });

  return router;
}
