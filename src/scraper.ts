import { Scraper, SearchMode, Tweet, Profile } from '@the-convocation/twitter-scraper';
import { config } from './config';
import { CachedProfile, TweetResponse } from './types';

export class TwitterScraper {
  private scraper: Scraper;
  private profileCache = new Map<string, CachedProfile>();
  private loginPromise: Promise<void> | null = null;
  private isLoggedIn = false;

  constructor() {
    this.scraper = new Scraper();
  }

  async ensureLoggedIn(): Promise<void> {
    if (this.isLoggedIn) return;
    if (this.loginPromise) return this.loginPromise;

    this.loginPromise = this._login();
    await this.loginPromise;
    this.loginPromise = null;
  }

  private async _login(): Promise<void> {
    const { twitterUsername, twitterPassword, twitterEmail, twitterCookies } = config;

    // Cookie-based auth takes priority — more stable, avoids login challenges
    if (twitterCookies) {
      console.log('[Scraper] Authenticating via TWITTER_COOKIES...');
      const cookieStrings = this._parseCookies(twitterCookies);
      if (cookieStrings.length === 0) {
        console.warn('[Scraper] TWITTER_COOKIES parsed to empty list — falling back to username/password.');
      } else {
        await this.scraper.setCookies(cookieStrings);
        const loggedIn = await this.scraper.isLoggedIn();
        if (loggedIn) {
          this.isLoggedIn = true;
          console.log('[Scraper] Cookie auth successful.');
          return;
        }
        console.warn('[Scraper] Cookie auth failed (expired?) — falling back to username/password.');
        // Reset scraper instance so stale cookies don't interfere
        this.scraper = new Scraper();
      }
    }

    if (!twitterUsername || !twitterPassword) {
      throw new Error('Set TWITTER_COOKIES or both TWITTER_USERNAME and TWITTER_PASSWORD in .env');
    }

    console.log(`[Scraper] Logging in as @${twitterUsername}...`);
    await this.scraper.login(twitterUsername, twitterPassword, twitterEmail || undefined);
    this.isLoggedIn = true;
    console.log('[Scraper] Login successful.');
  }

  /**
   * Accepts cookies in two formats:
   *   1. JSON array: [{"name":"auth_token","value":"xxx",...}, ...]
   *   2. Raw string: "auth_token=xxx; ct0=yyy; ..."
   * Returns an array of Set-Cookie-compatible strings.
   */
  private _parseCookies(raw: string): string[] {
    const trimmed = raw.trim();

    // Try JSON array first
    if (trimmed.startsWith('[')) {
      try {
        const parsed: Array<{ name: string; value: string; domain?: string; path?: string }> =
          JSON.parse(trimmed);
        return parsed.map(
          (c) => `${c.name}=${c.value}; Domain=${c.domain ?? '.twitter.com'}; Path=${c.path ?? '/'}`
        );
      } catch {
        console.warn('[Scraper] TWITTER_COOKIES looks like JSON but failed to parse — trying raw format.');
      }
    }

    // Fall back to raw "key=value; key=value" string
    return trimmed
      .split(';')
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => `${pair}; Domain=.twitter.com; Path=/`);
  }

  async relogin(): Promise<void> {
    this.isLoggedIn = false;
    this.loginPromise = null;
    this.scraper = new Scraper();
    await this.ensureLoggedIn();
  }

  async getProfile(username: string): Promise<CachedProfile | null> {
    const now = Date.now();
    const cached = this.profileCache.get(username);
    if (cached && now - cached.cachedAt < config.profileCacheTtlMs) {
      return cached;
    }

    try {
      const profile: Profile = await this.scraper.getProfile(username);
      if (!profile) return null;

      const entry: CachedProfile = {
        username: profile.username ?? username,
        displayName: profile.name ?? username,
        profileImage: (profile.avatar ?? '').replace('_normal', '_400x400'),
        isVerified: !!(profile.isVerified || profile.isBlueVerified),
        followerCount: profile.followersCount ?? 0,
        cachedAt: now,
      };
      this.profileCache.set(username, entry);
      return entry;
    } catch {
      return null;
    }
  }

  async *searchLatest(query: string, count: number): AsyncGenerator<Tweet> {
    await this.ensureLoggedIn();
    try {
      for await (const tweet of this.scraper.searchTweets(query, count, SearchMode.Latest)) {
        yield tweet;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Could not authenticate') || msg.includes('401') || msg.includes('403')) {
        console.warn('[Scraper] Auth error — forcing re-login');
        this.isLoggedIn = false;
      }
      throw err;
    }
  }

  formatTweet(tweet: Tweet, profile: CachedProfile): TweetResponse {
    const photos = (tweet.photos ?? []).map((p) => ({
      url: typeof p === 'string' ? p : (p as { url: string }).url ?? '',
    }));

    return {
      id: tweet.id ?? '',
      text: tweet.text ?? '',
      profileImage: profile.profileImage,
      displayName: profile.displayName,
      username: profile.username,
      isVerified: profile.isVerified,
      followerCount: profile.followerCount,
      timestamp: tweet.timestamp ? tweet.timestamp * 1000 : Date.now(),
      photos,
      tweetLink: tweet.permanentUrl ?? `https://twitter.com/${profile.username}/status/${tweet.id}`,
      fetchedAt: Date.now(),
    };
  }

  evictExpiredProfiles(): void {
    const now = Date.now();
    for (const [username, cached] of this.profileCache.entries()) {
      if (now - cached.cachedAt > config.profileCacheTtlMs) {
        this.profileCache.delete(username);
      }
    }
  }
}
