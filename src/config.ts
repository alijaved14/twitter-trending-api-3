import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  apiSecret: process.env.API_SECRET || '',
  twitterUsername: process.env.TWITTER_USERNAME || '',
  twitterPassword: process.env.TWITTER_PASSWORD || '',
  twitterEmail: process.env.TWITTER_EMAIL || '',
  // Cookies JSON string, e.g. export from a browser extension like "EditThisCookie"
  // Takes priority over username/password login when set
  twitterCookies: process.env.TWITTER_COOKIES || '',
  minFollowers: parseInt(process.env.MIN_FOLLOWERS || '1000'),
  bufferSize: parseInt(process.env.BUFFER_SIZE || '200'),
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '3000'),
  profileCacheTtlMs: parseInt(process.env.PROFILE_CACHE_TTL_MS || '3600000'),
  maxRetryDelayMs: 30000,
  baseRetryDelayMs: 1000,
};

// Diverse queries to maximize global trending coverage
export const SEARCH_QUERIES = [
  'lang:en -is:retweet min_faves:10',
  'lang:en -is:retweet (breaking OR viral OR trending) min_faves:5',
  'lang:en -is:retweet filter:media min_faves:10',
  '(news OR update OR announcement) lang:en -is:retweet min_faves:5',
  'lang:en -is:retweet min_faves:20 -filter:links',
];
