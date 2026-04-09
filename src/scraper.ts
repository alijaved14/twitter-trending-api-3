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
      let cookies: Array<{ name: string; value: string; domain?: string; path?: string }>;
      try {
        cookies = JSON.parse(twitterCookies);
      } catch {
        throw new Error('TWITTER_COOKIES is not valid JSON. Export cookies as JSON array from your browser.');
      }
      const cookieStrings = cookies.map(
        (c) => `${c.name}=${c.value}; Domain=${c.domain ?? '.twitter.com'}; Path=${c.path ?? '/'}`
      );
      await this.scraper.setCookies(cookieStrings);
      const loggedIn = await this.scraper.isLoggedIn();
      if (!loggedIn) throw new Error('Cookie auth failed — cookies may be expired. Update TWITTER_COOKIES.');
      this.isLoggedIn = true;
      console.log('[Scraper] Cookie auth successful.');
      return;
    }

    if (!twitterUsername || !twitterPassword) {
      throw new Error('Set TWITTER_COOKIES or both TWITTER_USERNAME and TWITTER_PASSWORD in .env');
    }

    console.log(`[Scraper] Logging in as @${twitterUsername}...`);
    await this.scraper.login(twitterUsername, twitterPassword, twitterEmail || undefined);
    this.isLoggedIn = true;
    console.log('[Scraper] Login successful.');
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
