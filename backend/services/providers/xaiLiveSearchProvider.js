/**
 * xAI Live Search Provider
 * Uses Grok 4 with Live Search to find tweets
 */
export class XaiLiveSearchProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.x.ai/v1';
  }

  /**
   * Search for beef tweets using xAI Live Search
   * @param {string} handle - Twitter handle (without @)
   * @param {string[]} keywords - Keywords to search for
   */
  async searchBeefTweets(handle, keywords) {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'grok-4-latest',
        messages: [{
          role: 'system',
          content: 'You are a tweet search assistant. Return tweet information in valid JSON format only.'
        }, {
          role: 'user',
          content: `Find recent viral tweets from @${handle} about: ${keywords.join(', ')}.
          Return as JSON array with fields: id, text, author_username, likes, retweets, url.
          Only return the JSON array, no other text.`
        }],
        search_parameters: {
          mode: 'on',
          sources: [{
            type: 'x',
            included_x_handles: [handle],
            post_favorite_count: 100
          }],
          return_citations: true
        },
        temperature: 0
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`xAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return this.normalize(data);
  }

  /**
   * Normalize xAI Live Search response to common format
   */
  normalize(data) {
    const content = data.choices?.[0]?.message?.content || '';
    const citations = data.citations || [];

    // Try to parse JSON from content
    let parsedTweets = [];
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        parsedTweets = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.log('Could not parse tweets from content, using citations');
    }

    // Use citations as fallback/supplement
    const tweetsFromCitations = citations.map(c => ({
      id: c.id || this.extractTweetId(c.url),
      text: c.text || c.title,
      author: {
        username: this.extractUsername(c.url) || 'unknown',
        name: 'Unknown'
      },
      url: c.url,
      metrics: {}
    }));

    // Merge parsed tweets with citation data
    const tweets = parsedTweets.length > 0
      ? parsedTweets.map(t => ({
          id: t.id,
          text: t.text,
          author: {
            username: t.author_username || 'unknown',
            name: t.author_name || 'Unknown'
          },
          metrics: {
            like_count: t.likes,
            retweet_count: t.retweets
          },
          url: t.url
        }))
      : tweetsFromCitations;

    return { tweets };
  }

  extractTweetId(url) {
    if (!url) return null;
    const match = url.match(/status\/(\d+)/);
    return match ? match[1] : null;
  }

  extractUsername(url) {
    if (!url) return null;
    const match = url.match(/x\.com\/([^/]+)/);
    return match ? match[1] : null;
  }
}

export default XaiLiveSearchProvider;
