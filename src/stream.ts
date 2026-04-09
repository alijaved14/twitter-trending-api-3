import { Response } from 'express';
import { TwitterScraper } from './scraper';
import { config, SEARCH_QUERIES } from './config';
import { TweetResponse, StreamClient } from './types';

export class TweetStream {
  private scraper: TwitterScraper;
  private buffer: TweetResponse[] = [];
  private seenIds = new Set<string>();
  private clients = new Map<string, StreamClient>();
  private queryIndex = 0;
  private retryDelay = config.baseRetryDelayMs;
  private running = false;

  constructor() {
    this.scraper = new TwitterScraper();
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    await this.scraper.ensureLoggedIn().catch((err) => {
      console.error('[Stream] Initial login failed:', err.message);
    });

    // Evict stale profiles every 10 minutes
    setInterval(() => this.scraper.evictExpiredProfiles(), 10 * 60 * 1000);

    this._loop();
  }

  private async _loop(): Promise<void> {
    while (this.running) {
      try {
        await this._poll();
        this.retryDelay = config.baseRetryDelayMs;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Stream] Poll error (retry in ${this.retryDelay}ms):`, msg);

        if (msg.includes('Could not authenticate') || msg.includes('401') || msg.includes('403')) {
          console.warn('[Stream] Re-logging in...');
          try {
            await this.scraper.relogin();
          } catch (loginErr) {
            console.error('[Stream] Re-login failed:', loginErr);
          }
        }

        await this._sleep(this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, config.maxRetryDelayMs);
      }

      await this._sleep(config.pollIntervalMs);
    }
  }

  private async _poll(): Promise<void> {
    const query = SEARCH_QUERIES[this.queryIndex % SEARCH_QUERIES.length];
    this.queryIndex++;

    const newTweets: TweetResponse[] = [];

    for await (const tweet of this.scraper.searchLatest(query, 20)) {
      if (!tweet.id) continue;
      if (this.seenIds.has(tweet.id)) continue;

      const username = tweet.username;
      if (!username) continue;

      const profile = await this.scraper.getProfile(username);
      if (!profile) continue;
      if (profile.followerCount < config.minFollowers) continue;

      this.seenIds.add(tweet.id);
      const formatted = this.scraper.formatTweet(tweet, profile);
      newTweets.push(formatted);

      // Limit seen IDs memory — keep latest 50k
      if (this.seenIds.size > 50000) {
        const first = this.seenIds.values().next().value;
        if (first) this.seenIds.delete(first);
      }
    }

    if (newTweets.length === 0) return;

    // Newest first
    newTweets.reverse();

    // Add to buffer
    this.buffer.unshift(...newTweets);
    if (this.buffer.length > config.bufferSize) {
      this.buffer = this.buffer.slice(0, config.bufferSize);
    }

    // Emit to SSE clients
    for (const tweet of newTweets) {
      this._emit(tweet);
    }

    console.log(
      `[Stream] +${newTweets.length} tweets | buffer=${this.buffer.length} | clients=${this.clients.size} | query="${query}"`
    );
  }

  private _emit(tweet: TweetResponse): void {
    const payload = `data: ${JSON.stringify(tweet)}\n\n`;
    for (const [id, client] of this.clients.entries()) {
      try {
        client.res.write(payload);
      } catch {
        this.clients.delete(id);
      }
    }
  }

  addClient(id: string, res: Response): void {
    // Send headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send current buffer immediately so client has data right away
    for (const tweet of this.buffer.slice(0, 20)) {
      res.write(`data: ${JSON.stringify(tweet)}\n\n`);
    }

    this.clients.set(id, { id, res });
    console.log(`[Stream] SSE client connected: ${id} | total=${this.clients.size}`);
  }

  removeClient(id: string): void {
    this.clients.delete(id);
    console.log(`[Stream] SSE client disconnected: ${id} | total=${this.clients.size}`);
  }

  getBuffer(limit = 50): TweetResponse[] {
    return this.buffer.slice(0, Math.min(limit, config.bufferSize));
  }

  getStats() {
    return {
      bufferSize: this.buffer.length,
      seenIds: this.seenIds.size,
      connectedClients: this.clients.size,
      queryIndex: this.queryIndex,
    };
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
