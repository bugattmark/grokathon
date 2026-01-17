/**
 * User Context Service
 * Fetches recent tweets from a user and generates a contextual summary
 * using Grok to understand "what's going on in their life lately"
 */

import { XApiProvider, XApiError } from './providers/xApiProvider.js';

/**
 * Custom error class for User Context specific errors
 */
export class UserContextError extends Error {
  constructor(message, statusCode = null, errorCode = null, details = null) {
    super(message);
    this.name = 'UserContextError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
  }
}

/**
 * X API client extension for user-specific operations
 * Extends functionality beyond XApiProvider for user tweets
 */
class UserTweetClient {
  constructor(bearerToken) {
    this.bearerToken = bearerToken || process.env.X_BEARER_TOKEN;
    this.baseUrl = 'https://api.x.com/2';
  }

  /**
   * Make an authenticated request to the X API
   */
  async makeRequest(endpoint, params = new URLSearchParams()) {
    if (!this.bearerToken) {
      throw new UserContextError(
        'X_BEARER_TOKEN is required for fetching user context',
        401,
        'MISSING_TOKEN'
      );
    }

    const url = `${this.baseUrl}${endpoint}?${params}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.bearerToken}`
      }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let errorDetails = null;

      try {
        errorDetails = JSON.parse(errorBody);
      } catch {
        errorDetails = errorBody;
      }

      if (response.status === 401) {
        throw new UserContextError('Invalid or expired bearer token', 401, 'UNAUTHORIZED', errorDetails);
      }
      if (response.status === 404) {
        throw new UserContextError('User or resource not found', 404, 'NOT_FOUND', errorDetails);
      }
      if (response.status === 429) {
        throw new UserContextError('Rate limit exceeded', 429, 'RATE_LIMITED', errorDetails);
      }

      throw new UserContextError(
        `X API error: ${response.status}`,
        response.status,
        'API_ERROR',
        errorDetails
      );
    }

    return response.json();
  }

  /**
   * Get user ID from username
   * X API v2: GET /2/users/by/username/:username
   * @param {string} username - Twitter handle (without @)
   * @returns {Promise<Object>} User data including id, name, username, description
   */
  async getUserByUsername(username) {
    const cleanUsername = username.replace(/^@/, '');
    const params = new URLSearchParams({
      'user.fields': 'id,name,username,description,public_metrics,profile_image_url,created_at,verified,location,url'
    });

    const data = await this.makeRequest(`/users/by/username/${cleanUsername}`, params);

    if (!data.data) {
      throw new UserContextError(`User @${cleanUsername} not found`, 404, 'USER_NOT_FOUND');
    }

    return data.data;
  }

  /**
   * Get recent tweets from a user by ID
   * X API v2: GET /2/users/:id/tweets
   * @param {string} userId - Twitter user ID
   * @param {number} maxResults - Number of tweets to fetch (5-100)
   * @returns {Promise<Array>} Normalized tweets array
   */
  async getUserTweets(userId, maxResults = 50) {
    const params = new URLSearchParams({
      'tweet.fields': 'created_at,public_metrics,conversation_id,referenced_tweets,entities,context_annotations',
      'expansions': 'referenced_tweets.id,referenced_tweets.id.author_id',
      'user.fields': 'username,name',
      'max_results': String(Math.min(Math.max(maxResults, 5), 100)),
      'exclude': 'retweets'
    });

    const data = await this.makeRequest(`/users/${userId}/tweets`, params);
    return this.normalizeTweets(data);
  }

  /**
   * Normalize tweets response to common format
   */
  normalizeTweets(data) {
    if (!data.data) {
      return [];
    }

    return data.data.map(tweet => ({
      id: tweet.id,
      text: tweet.text,
      createdAt: tweet.created_at,
      metrics: tweet.public_metrics || {},
      isReply: tweet.referenced_tweets?.some(ref => ref.type === 'replied_to') || false,
      isQuote: tweet.referenced_tweets?.some(ref => ref.type === 'quoted') || false,
      hashtags: tweet.entities?.hashtags?.map(h => h.tag) || [],
      mentions: tweet.entities?.mentions?.map(m => m.username) || [],
      urls: tweet.entities?.urls?.map(u => u.expanded_url) || [],
      contextAnnotations: tweet.context_annotations || []
    }));
  }
}

/**
 * Grok client for generating summaries
 */
class GrokSummarizer {
  constructor(apiKey) {
    this.apiKey = apiKey || process.env.XAI_API_KEY;
    this.baseUrl = 'https://api.x.ai/v1';
  }

  /**
   * Generate a contextual summary of user's recent tweets
   * @param {Object} user - User data
   * @param {Array} tweets - Array of tweet objects
   * @returns {Promise<Object>} Summary object with topics, mood, controversies, etc.
   */
  async summarizeUserContext(user, tweets) {
    if (!this.apiKey) {
      throw new UserContextError(
        'XAI_API_KEY is required for generating summaries',
        401,
        'MISSING_API_KEY'
      );
    }

    if (!tweets.length) {
      return {
        summary: `@${user.username} hasn't been very active recently.`,
        topics: [],
        mood: 'quiet',
        controversies: [],
        keyEvents: [],
        engagementInsight: 'No recent activity to analyze'
      };
    }

    const tweetsText = tweets
      .map((t, i) => {
        const likes = t.metrics.like_count || 0;
        const retweets = t.metrics.retweet_count || 0;
        const replies = t.metrics.reply_count || 0;
        const type = t.isReply ? '[REPLY]' : t.isQuote ? '[QUOTE]' : '';
        return `[${i + 1}] ${type} ${t.text} (${likes} likes, ${retweets} RTs, ${replies} replies)`;
      })
      .join('\n\n');

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'grok-4-fast-reasoning',
        messages: [{
          role: 'system',
          content: `You are an expert at analyzing Twitter/X activity to understand what's going on in someone's life lately. Be insightful, pick up on subtle cues, and capture the vibe. Focus on recent events, ongoing themes, and emotional undertones.`
        }, {
          role: 'user',
          content: `Analyze @${user.username}'s (${user.name}) recent tweets and tell me what's going on in their life.

User bio: ${user.description || 'No bio'}
Followers: ${user.public_metrics?.followers_count || 'Unknown'}
${user.location ? `Location: ${user.location}` : ''}

Recent tweets (newest first):
${tweetsText}

Return a JSON object with:
{
  "summary": "2-3 sentence summary of what they've been up to lately - their current focus, mood, and situation",
  "topics": ["array", "of", "main", "topics", "they're", "discussing"],
  "mood": "their general vibe (e.g., 'fired up', 'chill', 'frustrated', 'excited', 'philosophical', 'trolling', 'promotional')",
  "controversies": ["any drama, beefs, or controversial takes they're involved in - empty if none"],
  "keyEvents": ["notable announcements, achievements, or life updates - empty if none"],
  "engagementInsight": "brief note on what types of posts get them the most engagement"
}

Only return valid JSON, no other text.`
        }],
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new UserContextError(
        `Grok summary generation failed: ${response.status}`,
        response.status,
        'GROK_ERROR',
        error
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('[UserContext] Failed to parse summary JSON:', e.message);
    }

    // Fallback when JSON parsing fails
    return {
      summary: content,
      topics: [],
      mood: 'unknown',
      controversies: [],
      keyEvents: [],
      engagementInsight: 'Could not parse structured analysis'
    };
  }
}

/**
 * Main service that orchestrates user context fetching and summarization
 */
export class UserContextService {
  constructor(options = {}) {
    this.userTweetClient = new UserTweetClient(options.xBearerToken);
    this.grokSummarizer = new GrokSummarizer(options.xaiApiKey);
  }

  /**
   * Get full context for a user including their recent activity summary
   * @param {string} username - Twitter handle (with or without @)
   * @param {Object} options - Optional settings
   * @param {number} options.tweetCount - Number of tweets to analyze (default: 50)
   * @returns {Promise<Object>} User context object with user info, tweets, and summary
   */
  async getUserContext(username, options = {}) {
    const { tweetCount = 50 } = options;
    const cleanUsername = username.replace(/^@/, '');

    console.log(`[UserContext] Fetching context for @${cleanUsername}`);

    // Step 1: Fetch user data (needed for user ID)
    const user = await this.userTweetClient.getUserByUsername(cleanUsername);
    console.log(`[UserContext] Found user: ${user.name} (ID: ${user.id})`);

    // Step 2: Fetch tweets using the user ID
    const tweets = await this.userTweetClient.getUserTweets(user.id, tweetCount);
    console.log(`[UserContext] Fetched ${tweets.length} tweets`);

    // Step 3: Generate summary with Grok
    const summary = await this.grokSummarizer.summarizeUserContext(user, tweets);
    console.log(`[UserContext] Generated summary for @${cleanUsername}`);

    return {
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        description: user.description,
        profileImage: user.profile_image_url,
        metrics: user.public_metrics,
        location: user.location,
        verified: user.verified
      },
      tweetCount: tweets.length,
      tweets: tweets.slice(0, 10), // Include first 10 tweets for reference
      context: summary
    };
  }

  /**
   * Get context for multiple users in parallel
   * Uses Promise.allSettled to handle partial failures gracefully
   * @param {string[]} usernames - Array of Twitter handles
   * @param {Object} options - Optional settings
   * @returns {Promise<Object>} Map of username to context (or error)
   */
  async getMultipleUserContexts(usernames, options = {}) {
    console.log(`[UserContext] Fetching context for ${usernames.length} users in parallel`);

    const results = await Promise.allSettled(
      usernames.map(username => this.getUserContext(username, options))
    );

    const contexts = {};
    results.forEach((result, index) => {
      const username = usernames[index].replace(/^@/, '');
      if (result.status === 'fulfilled') {
        contexts[username] = result.value;
      } else {
        console.error(`[UserContext] Failed to fetch @${username}:`, result.reason.message);
        contexts[username] = {
          error: result.reason.message,
          errorCode: result.reason.errorCode || 'UNKNOWN_ERROR',
          user: { username }
        };
      }
    });

    return contexts;
  }

  /**
   * Get a lightweight context summary (no full tweets, just the summary)
   * Useful when you only need the analysis for storyline generation
   * @param {string} username - Twitter handle
   * @param {Object} options - Optional settings
   * @returns {Promise<Object>} Lightweight context with just user info and summary
   */
  async getLightweightContext(username, options = {}) {
    const fullContext = await this.getUserContext(username, options);

    return {
      user: {
        username: fullContext.user.username,
        name: fullContext.user.name,
        profileImage: fullContext.user.profileImage
      },
      tweetCount: fullContext.tweetCount,
      context: fullContext.context
    };
  }
}

/**
 * Factory function for creating UserContextService
 * @param {Object} options - Configuration options
 * @param {string} options.xBearerToken - X API Bearer Token
 * @param {string} options.xaiApiKey - xAI API Key
 * @returns {UserContextService}
 */
export function createUserContextService(options = {}) {
  return new UserContextService(options);
}

export default UserContextService;
