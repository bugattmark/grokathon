import { XApiProvider } from './providers/xApiProvider.js';
import { XaiLiveSearchProvider } from './providers/xaiLiveSearchProvider.js';
import { ThreadFetcher } from './threadFetcher.js';

/**
 * Factory for creating tweet fetcher providers
 * Implements a common interface for swappable tweet sources
 */
export class TweetFetcher {
  constructor() {
    const provider = process.env.TWEET_PROVIDER || 'xai-live-search';

    if (provider === 'x-api') {
      this.provider = new XApiProvider(process.env.X_BEARER_TOKEN);
    } else {
      this.provider = new XaiLiveSearchProvider(process.env.XAI_API_KEY);
    }

    this.providerName = provider;

    // Thread fetcher always uses X API (requires bearer token)
    this.threadFetcher = null;
  }

  /**
   * Lazy initialization of thread fetcher
   * Only created when needed to avoid requiring X_BEARER_TOKEN for all uses
   */
  getThreadFetcher() {
    if (!this.threadFetcher) {
      this.threadFetcher = new ThreadFetcher(process.env.X_BEARER_TOKEN);
    }
    return this.threadFetcher;
  }

  /**
   * Search for beef tweets from a specific handle
   * @param {string} handle - Twitter handle (without @)
   * @param {string[]} keywords - Keywords to search for
   * @returns {Promise<{tweets: Array}>}
   */
  async searchBeefTweets(handle, keywords) {
    return this.provider.searchBeefTweets(handle, keywords);
  }

  /**
   * Fetch a single tweet by ID
   * @param {string} tweetIdOrUrl - Tweet ID or URL
   * @returns {Promise<object>} - Normalized tweet object
   */
  async getTweet(tweetIdOrUrl) {
    return this.getThreadFetcher().getTweet(tweetIdOrUrl);
  }

  /**
   * Fetch the complete thread for a tweet
   * @param {string} tweetIdOrUrl - Tweet ID or URL
   * @param {object} options - Fetch options
   * @returns {Promise<object>} - Thread object with all tweets
   */
  async getThread(tweetIdOrUrl, options = {}) {
    return this.getThreadFetcher().getThread(tweetIdOrUrl, options);
  }

  /**
   * Get thread context for beef analysis
   * @param {string} tweetIdOrUrl - Tweet ID or URL
   * @returns {Promise<object>} - Structured thread context
   */
  async getThreadContext(tweetIdOrUrl) {
    return this.getThreadFetcher().getThreadContext(tweetIdOrUrl);
  }

  getProviderName() {
    return this.providerName;
  }
}

export default TweetFetcher;
