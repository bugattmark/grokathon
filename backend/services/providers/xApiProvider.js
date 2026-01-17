/**
 * X API v2 Provider
 * Uses Twitter/X API v2 endpoints for tweet search and thread fetching
 *
 * Key endpoints used:
 * - GET /2/tweets/:id - Fetch a single tweet with conversation_id
 * - GET /2/tweets/search/recent - Search for tweets in a conversation
 *
 * Key fields:
 * - conversation_id: All tweets in the same thread share this
 * - referenced_tweets: Shows what tweet this is replying to
 * - in_reply_to_user_id: Who the tweet is replying to
 */

/**
 * Custom error class for X API specific errors
 */
export class XApiError extends Error {
  constructor(message, statusCode, errorCode, details = null) {
    super(message);
    this.name = 'XApiError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
  }
}

export class XApiProvider {
  constructor(bearerToken) {
    if (!bearerToken) {
      throw new Error('X_BEARER_TOKEN is required for XApiProvider');
    }
    this.bearerToken = bearerToken;
    this.baseUrl = 'https://api.x.com/2';

    // Default tweet fields to request
    this.defaultTweetFields = [
      'conversation_id',
      'author_id',
      'created_at',
      'referenced_tweets',
      'in_reply_to_user_id',
      'public_metrics',
      'text'
    ].join(',');

    // Default expansions to request
    this.defaultExpansions = [
      'author_id',
      'referenced_tweets.id',
      'referenced_tweets.id.author_id',
      'in_reply_to_user_id'
    ].join(',');

    // Default user fields to request
    this.defaultUserFields = [
      'name',
      'username',
      'profile_image_url'
    ].join(',');
  }

  /**
   * Make an authenticated request to the X API
   * @param {string} endpoint - API endpoint path
   * @param {URLSearchParams} params - Query parameters
   * @returns {Promise<object>} - Parsed JSON response
   */
  async makeRequest(endpoint, params = new URLSearchParams()) {
    const url = `${this.baseUrl}${endpoint}?${params}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.bearerToken}`
      }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let errorDetails = null;
      let errorCode = null;

      try {
        const parsed = JSON.parse(errorBody);
        errorDetails = parsed;
        errorCode = parsed.errors?.[0]?.code || parsed.error?.code;
      } catch {
        errorDetails = errorBody;
      }

      // Handle specific error codes
      if (response.status === 401) {
        throw new XApiError('Invalid or expired bearer token', 401, 'UNAUTHORIZED', errorDetails);
      }
      if (response.status === 403) {
        throw new XApiError('Access forbidden - check API permissions', 403, 'FORBIDDEN', errorDetails);
      }
      if (response.status === 404) {
        throw new XApiError('Resource not found', 404, 'NOT_FOUND', errorDetails);
      }
      if (response.status === 429) {
        throw new XApiError('Rate limit exceeded', 429, 'RATE_LIMITED', errorDetails);
      }

      throw new XApiError(
        `X API error: ${response.status}`,
        response.status,
        errorCode,
        errorDetails
      );
    }

    return response.json();
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
      'tweet.fields': 'created_at,public_metrics,author_id,conversation_id,in_reply_to_user_id,referenced_tweets',
      'expansions': 'author_id,referenced_tweets.id',
      'user.fields': 'username,name,profile_image_url',
      'max_results': '10'
    });

    const data = await this.makeRequest('/tweets/search/recent', params);
    return this.normalize(data);
  }

  /**
   * Fetch a single tweet by ID with full context
   *
   * X API v2 endpoint: GET /2/tweets/:id
   *
   * @param {string} tweetId - The tweet ID
   * @returns {Promise<object>} - Normalized tweet object with:
   *   - id: Tweet ID
   *   - text: Tweet content
   *   - author: { id, username, name, avatar }
   *   - metrics: { like_count, retweet_count, reply_count, quote_count }
   *   - createdAt: ISO timestamp
   *   - conversationId: Conversation thread ID (all tweets in same thread share this)
   *   - inReplyToUserId: User ID being replied to
   *   - referencedTweets: Array of { type, id } for replied_to/quoted/retweeted
   *   - url: Direct link to the tweet
   */
  async getTweet(tweetId) {
    if (!tweetId || typeof tweetId !== 'string') {
      throw new XApiError('Invalid tweet ID', 400, 'INVALID_TWEET_ID');
    }

    const params = new URLSearchParams({
      'tweet.fields': this.defaultTweetFields,
      'expansions': this.defaultExpansions,
      'user.fields': this.defaultUserFields
    });

    const data = await this.makeRequest(`/tweets/${tweetId}`, params);

    if (!data.data) {
      throw new XApiError('Tweet not found', 404, 'TWEET_NOT_FOUND');
    }

    return this.normalizeSingleTweet(data);
  }

  /**
   * Fetch the entire conversation thread for a tweet
   *
   * This method:
   * 1. Fetches the target tweet to get its conversation_id
   * 2. Walks up the reply chain to get all parent tweets
   * 3. Searches for all tweets in the conversation using the conversation_id
   * 4. Builds a chronologically sorted thread
   *
   * X API v2 endpoints used:
   * - GET /2/tweets/:id - Get the target tweet
   * - GET /2/tweets/search/recent?query=conversation_id:XXXX - Get conversation tweets
   *
   * @param {string} tweetId - The starting tweet ID
   * @param {object} options - Thread fetching options
   * @param {number} options.maxResults - Max tweets to fetch per page (default: 100, max: 100)
   * @param {boolean} options.fetchReplies - Whether to fetch replies (default: true)
   * @param {number} options.maxPages - Max pages to fetch for conversation (default: 5)
   * @returns {Promise<object>} - Thread object with all tweets in order
   */
  async getThread(tweetId, options = {}) {
    const { maxResults = 100, fetchReplies = true, maxPages = 5 } = options;

    // First, get the original tweet to find conversation_id
    const originalTweet = await this.getTweet(tweetId);
    const conversationId = originalTweet.conversationId;

    if (!conversationId) {
      // Tweet is not part of a conversation, return it as a single-tweet thread
      return {
        conversationId: tweetId,
        rootTweet: originalTweet,
        parentTweets: [],
        childTweets: [],
        targetTweet: originalTweet,
        thread: [originalTweet],
        totalTweets: 1
      };
    }

    // Fetch parent tweets by walking up the reply chain
    const parentTweets = await this.getParentTweets(originalTweet);

    // Fetch conversation context using search (includes replies if enabled)
    const conversationTweets = fetchReplies
      ? await this.getConversationTweets(conversationId, { maxResults, maxPages })
      : [];

    // Identify child/reply tweets (tweets that directly reply to our target)
    const childTweets = conversationTweets.filter(tweet =>
      tweet.referencedTweets?.some(ref =>
        ref.type === 'replied_to' && ref.id === tweetId
      )
    );

    // Build the complete thread (sorted chronologically)
    const thread = this.buildThread(originalTweet, parentTweets, conversationTweets);

    // Identify the root tweet (first tweet in the conversation)
    const rootTweet = thread.find(t => t.id === conversationId) || thread[0] || originalTweet;

    return {
      conversationId,
      rootTweet,
      parentTweets,
      childTweets,
      targetTweet: originalTweet,
      thread,
      totalTweets: thread.length
    };
  }

  /**
   * Walk up the reply chain to get all parent tweets
   * @param {object} tweet - The starting tweet
   * @returns {Promise<Array>} - Array of parent tweets (oldest first)
   */
  async getParentTweets(tweet) {
    const parents = [];
    let currentTweet = tweet;
    const maxDepth = 50; // Prevent infinite loops
    let depth = 0;

    while (currentTweet.referencedTweets && depth < maxDepth) {
      const replyTo = currentTweet.referencedTweets.find(ref => ref.type === 'replied_to');

      if (!replyTo) {
        break;
      }

      try {
        const parentTweet = await this.getTweet(replyTo.id);
        parents.unshift(parentTweet); // Add to beginning to maintain chronological order
        currentTweet = parentTweet;
        depth++;
      } catch (error) {
        // Parent tweet may be deleted or unavailable
        console.log(`Could not fetch parent tweet ${replyTo.id}: ${error.message}`);
        break;
      }
    }

    return parents;
  }

  /**
   * Get tweets in a conversation using search with pagination support
   *
   * X API v2 endpoint: GET /2/tweets/search/recent
   * Query: conversation_id:XXXX
   *
   * Note: The recent search endpoint only returns tweets from the last 7 days.
   * For older tweets, you would need the Full Archive Search (Academic Research access).
   *
   * @param {string} conversationId - The conversation ID
   * @param {object} options - Search options
   * @param {number} options.maxResults - Max results per page (10-100, default: 100)
   * @param {number} options.maxPages - Max pages to fetch (default: 5)
   * @returns {Promise<Array>} - Array of tweets in the conversation
   */
  async getConversationTweets(conversationId, options = {}) {
    const { maxResults = 100, maxPages = 5 } = options;
    const allTweets = [];
    let nextToken = null;
    let pagesProcessed = 0;

    // Track users across all pages for proper normalization
    const allUsers = new Map();

    try {
      do {
        const params = new URLSearchParams({
          'query': `conversation_id:${conversationId}`,
          'tweet.fields': this.defaultTweetFields,
          'expansions': this.defaultExpansions,
          'user.fields': this.defaultUserFields,
          'max_results': String(Math.min(maxResults, 100))
        });

        if (nextToken) {
          params.set('next_token', nextToken);
        }

        const data = await this.makeRequest('/tweets/search/recent', params);

        // Collect users from this page
        if (data.includes?.users) {
          for (const user of data.includes.users) {
            allUsers.set(user.id, user);
          }
        }

        if (data.data) {
          // Normalize tweets with accumulated user data
          const normalizedPage = data.data.map(tweet => {
            const author = allUsers.get(tweet.author_id);
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
              conversationId: tweet.conversation_id,
              inReplyToUserId: tweet.in_reply_to_user_id,
              referencedTweets: tweet.referenced_tweets,
              url: `https://x.com/${author?.username || 'user'}/status/${tweet.id}`
            };
          });

          allTweets.push(...normalizedPage);
        }

        nextToken = data.meta?.next_token;
        pagesProcessed++;

      } while (nextToken && pagesProcessed < maxPages);

      return allTweets;
    } catch (error) {
      // Search may fail for various reasons, log and continue
      console.log(`Could not fetch conversation tweets: ${error.message}`);
      return allTweets; // Return any tweets we've collected so far
    }
  }

  /**
   * Build a chronologically ordered thread from collected tweets
   *
   * This method:
   * 1. Deduplicates tweets from all sources
   * 2. Sorts tweets chronologically (oldest first)
   * 3. Optionally filters to only include the direct reply chain
   *
   * @param {object} targetTweet - The originally requested tweet
   * @param {Array} parentTweets - Parent tweets from reply chain
   * @param {Array} conversationTweets - Tweets from conversation search
   * @param {object} options - Build options
   * @param {boolean} options.directChainOnly - Only include direct reply chain (default: false)
   * @returns {Array} - Ordered array of tweets
   */
  buildThread(targetTweet, parentTweets, conversationTweets, options = {}) {
    const { directChainOnly = false } = options;

    // Create a map to deduplicate tweets
    const tweetMap = new Map();

    // Add parent tweets
    for (const tweet of parentTweets) {
      tweetMap.set(tweet.id, tweet);
    }

    // Add target tweet
    tweetMap.set(targetTweet.id, targetTweet);

    // Add conversation tweets
    for (const tweet of conversationTweets) {
      if (!tweetMap.has(tweet.id)) {
        tweetMap.set(tweet.id, tweet);
      }
    }

    // If we only want the direct chain, filter to parent tweets + target
    if (directChainOnly) {
      const chainIds = new Set([
        targetTweet.id,
        ...parentTweets.map(t => t.id)
      ]);
      for (const [id] of tweetMap) {
        if (!chainIds.has(id)) {
          tweetMap.delete(id);
        }
      }
    }

    // Sort by creation time (oldest first)
    const sorted = Array.from(tweetMap.values()).sort((a, b) => {
      const dateA = new Date(a.createdAt);
      const dateB = new Date(b.createdAt);
      return dateA - dateB;
    });

    return sorted;
  }

  /**
   * Build a tree structure from the thread
   * Useful for rendering nested replies
   *
   * @param {Array} thread - Flat array of tweets
   * @returns {object} - Tree structure with nested replies
   */
  buildReplyTree(thread) {
    // Create a map for O(1) lookup
    const tweetMap = new Map(thread.map(t => [t.id, { ...t, replies: [] }]));

    const roots = [];

    for (const tweet of tweetMap.values()) {
      const parentRef = tweet.referencedTweets?.find(ref => ref.type === 'replied_to');

      if (parentRef && tweetMap.has(parentRef.id)) {
        // This is a reply to another tweet in the thread
        tweetMap.get(parentRef.id).replies.push(tweet);
      } else {
        // This is a root tweet (no parent in this thread)
        roots.push(tweet);
      }
    }

    // Sort replies by creation time at each level
    const sortReplies = (node) => {
      node.replies.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      for (const reply of node.replies) {
        sortReplies(reply);
      }
    };

    for (const root of roots) {
      sortReplies(root);
    }

    // Sort roots by creation time
    roots.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    return {
      roots,
      totalTweets: thread.length
    };
  }

  /**
   * Normalize X API response to common format for search results
   */
  normalize(data) {
    if (!data.data) {
      return { tweets: [] };
    }

    const users = new Map(
      (data.includes?.users || []).map(u => [u.id, u])
    );

    const referencedTweets = new Map(
      (data.includes?.tweets || []).map(t => [t.id, t])
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
          conversationId: tweet.conversation_id,
          inReplyToUserId: tweet.in_reply_to_user_id,
          referencedTweets: tweet.referenced_tweets,
          url: `https://x.com/${author?.username}/status/${tweet.id}`
        };
      })
    };
  }

  /**
   * Normalize a single tweet response
   */
  normalizeSingleTweet(data) {
    const tweet = data.data;
    const users = new Map(
      (data.includes?.users || []).map(u => [u.id, u])
    );

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
      conversationId: tweet.conversation_id,
      inReplyToUserId: tweet.in_reply_to_user_id,
      referencedTweets: tweet.referenced_tweets,
      url: `https://x.com/${author?.username}/status/${tweet.id}`
    };
  }

  /**
   * Normalize multiple tweets from a response
   */
  normalizeMultipleTweets(data) {
    const result = this.normalize(data);
    return result.tweets;
  }
}

export default XApiProvider;
