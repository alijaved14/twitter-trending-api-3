export interface TweetResponse {
  id: string;
  text: string;
  profileImage: string;
  displayName: string;
  username: string;
  isVerified: boolean;
  followerCount: number;
  timestamp: number;
  photos: Array<{ url: string }>;
  tweetLink: string;
  fetchedAt: number;
}

export interface CachedProfile {
  username: string;
  displayName: string;
  profileImage: string;
  isVerified: boolean;
  followerCount: number;
  cachedAt: number;
}

export interface StreamClient {
  id: string;
  res: import('express').Response;
}
