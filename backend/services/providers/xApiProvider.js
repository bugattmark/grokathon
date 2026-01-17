/**
 * X API v2 Provider
 * Uses Twitter/X API v2 Recent Search endpoint
 */
export class XApiProvider {
  constructor(bearerToken) {
    this.bearerToken = bearerToken;
    this.baseUrl = 'https://api.x.com/2';
  }

  /**
   * Search for beef tweets
   * @param {string} handle - Twitter handle (without @)
   * @param {string[]} keywords - Keywords to search for
   */
  async searchBeefTweets(handle, keywords) {
    const query = `from:${handle} (${keywords.join(' OR ')})`;

    const params = new URLSearchParams({
      query,
      'tweet.fields': 'created_at,public_metrics,author_id,conversation_id',
      'expansions': 'author_id',
      'user.fields': 'username,name,profile_image_url',
      'max_results': '10'
    });

    const response = await fetch(`${this.baseUrl}/tweets/search/recent?${params}`, {
      headers: {
        'Authorization': `Bearer ${this.bearerToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`X API error: ${response.status}`);
    }

    const data = await response.json();
    return this.normalize(data);
  }

  /**
   * Normalize X API response to common format
   */
  normalize(data) {
    if (!data.data) {
      return { tweets: [] };
    }

    const users = new Map(
      (data.includes?.users || []).map(u => [u.id, u])
    );

    return {
      tweets: data.data.map(tweet => {
        const author = users.get(tweet.author_id);
        return {
          id: tweet.id,
          text: tweet.text,
          author: {
            id: tweet.author_id,
            username: author?.username || 'unknown',
            name: author?.name || 'Unknown',
            avatar: author?.profile_image_url
          },
          metrics: tweet.public_metrics,
          createdAt: tweet.created_at,
          url: `https://x.com/${author?.username}/status/${tweet.id}`
        };
      })
    };
  }
}

export default XApiProvider;
