import { XApiProvider, XApiError } from './providers/xApiProvider.js';

/**
 * ThreadFetcher - High-level service for fetching tweet threads
 *
 * Uses X API v2 to fetch complete conversation threads given a tweet ID.
 * Handles parent tweets, conversation context, and error recovery.
 */
export class ThreadFetcher {
  constructor(bearerToken) {
    this.bearerToken = bearerToken || process.env.X_BEARER_TOKEN;
    this.provider = null;
  }

  /**
   * Lazy initialization of the X API provider
   * Allows for better error messages when token is missing
   */
  getProvider() {
    if (!this.provider) {
      if (!this.bearerToken) {
        throw new Error(
          'X_BEARER_TOKEN environment variable is required for thread fetching. ' +
          'Set it in your .env file or pass it to the constructor.'
        );
      }
      this.provider = new XApiProvider(this.bearerToken);
    }
    return this.provider;
  }

  /**
   * Extract tweet ID from various input formats
   * Supports: raw ID, full URL, or mobile URL
   * @param {string} input - Tweet ID or URL
   * @returns {string} - Extracted tweet ID
   */
  extractTweetId(input) {
    if (!input || typeof input !== 'string') {
      throw new Error('Tweet ID or URL is required');
    }

    // If it's already just an ID (all digits)
    if (/^\d+$/.test(input.trim())) {
      return input.trim();
    }

    // Try to extract from URL
    // Matches: twitter.com/user/status/123, x.com/user/status/123
    const urlMatch = input.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/);
    if (urlMatch) {
      return urlMatch[1];
    }

    throw new Error(
      `Invalid tweet ID or URL format: "${input}". ` +
      'Expected a numeric ID or URL like https://x.com/user/status/123'
    );
  }

  /**
   * Fetch a single tweet by ID
   * @param {string} tweetIdOrUrl - Tweet ID or URL
   * @returns {Promise<object>} - Normalized tweet object
   */
  async getTweet(tweetIdOrUrl) {
    const tweetId = this.extractTweetId(tweetIdOrUrl);
    const provider = this.getProvider();

    try {
      return await provider.getTweet(tweetId);
    } catch (error) {
      throw this.enhanceError(error, tweetId);
    }
  }

  /**
   * Fetch the complete thread for a tweet
   * @param {string} tweetIdOrUrl - Tweet ID or URL
   * @param {object} options - Fetch options
   * @param {boolean} options.includeReplies - Include replies in conversation (default: true)
   * @param {number} options.maxParentDepth - Max depth for parent tweet fetching (default: 50)
   * @returns {Promise<object>} - Thread object with all tweets
   */
  async getThread(tweetIdOrUrl, options = {}) {
    const tweetId = this.extractTweetId(tweetIdOrUrl);
    const provider = this.getProvider();

    try {
      const thread = await provider.getThread(tweetId);

      // Add metadata
      return {
        ...thread,
        fetchedAt: new Date().toISOString(),
        options: {
          includeReplies: options.includeReplies !== false,
          maxParentDepth: options.maxParentDepth || 50
        }
      };
    } catch (error) {
      throw this.enhanceError(error, tweetId);
    }
  }

  /**
   * Get thread as formatted text (useful for AI processing)
   * @param {string} tweetIdOrUrl - Tweet ID or URL
   * @returns {Promise<string>} - Formatted thread text
   */
  async getThreadAsText(tweetIdOrUrl) {
    const thread = await this.getThread(tweetIdOrUrl);

    const lines = thread.thread.map((tweet, index) => {
      const isTarget = tweet.id === thread.targetTweet.id;
      const marker = isTarget ? '>>> ' : '    ';
      const timestamp = new Date(tweet.createdAt).toLocaleString();

      return [
        `${marker}@${tweet.author.username} (${timestamp})`,
        `${marker}${tweet.text}`,
        ''
      ].join('\n');
    });

    return [
      `Thread with ${thread.totalTweets} tweets`,
      `Conversation ID: ${thread.conversationId}`,
      '---',
      ...lines
    ].join('\n');
  }

  /**
   * Get thread context for beef analysis
   * Returns a structured summary useful for content generation
   * @param {string} tweetIdOrUrl - Tweet ID or URL
   * @returns {Promise<object>} - Structured thread context
   */
  async getThreadContext(tweetIdOrUrl) {
    const thread = await this.getThread(tweetIdOrUrl);

    // Identify unique participants
    const participants = new Map();
    for (const tweet of thread.thread) {
      if (!participants.has(tweet.author.id)) {
        participants.set(tweet.author.id, tweet.author);
      }
    }

    // Calculate engagement metrics
    const totalMetrics = thread.thread.reduce((acc, tweet) => {
      const metrics = tweet.metrics || {};
      return {
        likes: (acc.likes || 0) + (metrics.like_count || 0),
        retweets: (acc.retweets || 0) + (metrics.retweet_count || 0),
        replies: (acc.replies || 0) + (metrics.reply_count || 0),
        quotes: (acc.quotes || 0) + (metrics.quote_count || 0)
      };
    }, {});

    return {
      targetTweet: {
        id: thread.targetTweet.id,
        text: thread.targetTweet.text,
        author: thread.targetTweet.author,
        url: thread.targetTweet.url
      },
      thread: {
        totalTweets: thread.totalTweets,
        conversationId: thread.conversationId,
        tweets: thread.thread.map(t => ({
          id: t.id,
          text: t.text,
          author: t.author.username,
          isTarget: t.id === thread.targetTweet.id
        }))
      },
      participants: Array.from(participants.values()),
      engagement: totalMetrics,
      rootTweet: thread.rootTweet ? {
        id: thread.rootTweet.id,
        text: thread.rootTweet.text,
        author: thread.rootTweet.author
      } : null
    };
  }

  /**
   * Enhance error messages with helpful context
   */
  enhanceError(error, tweetId) {
    if (error instanceof XApiError) {
      const enhanced = new Error(error.message);
      enhanced.name = 'ThreadFetchError';
      enhanced.statusCode = error.statusCode;
      enhanced.errorCode = error.errorCode;
      enhanced.tweetId = tweetId;
      enhanced.details = error.details;

      // Add helpful messages for common errors
      if (error.statusCode === 401) {
        enhanced.message = 'X API authentication failed. Check your X_BEARER_TOKEN.';
      } else if (error.statusCode === 404) {
        enhanced.message = `Tweet not found (ID: ${tweetId}). It may be deleted or from a private account.`;
      } else if (error.statusCode === 429) {
        enhanced.message = 'X API rate limit exceeded. Please wait before retrying.';
        enhanced.retryAfter = error.details?.headers?.['retry-after'];
      }

      return enhanced;
    }

    // For non-API errors, just add context
    const enhanced = new Error(`Failed to fetch thread for tweet ${tweetId}: ${error.message}`);
    enhanced.name = 'ThreadFetchError';
    enhanced.tweetId = tweetId;
    enhanced.originalError = error;
    return enhanced;
  }
}

/**
 * Factory function for creating a ThreadFetcher
 * Convenience method that uses environment variable
 */
export function createThreadFetcher() {
  return new ThreadFetcher(process.env.X_BEARER_TOKEN);
}

export default ThreadFetcher;
