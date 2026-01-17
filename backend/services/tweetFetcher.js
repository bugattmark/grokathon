import { XApiProvider } from './providers/xApiProvider.js';
import { XaiLiveSearchProvider } from './providers/xaiLiveSearchProvider.js';

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

  getProviderName() {
    return this.providerName;
  }
}

export default TweetFetcher;
