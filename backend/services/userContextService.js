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
      conversationId: tweet.conversation_id,
      metrics: tweet.public_metrics || {},
      isReply: tweet.referenced_tweets?.some(ref => ref.type === 'replied_to') || false,
      isQuote: tweet.referenced_tweets?.some(ref => ref.type === 'quoted') || false,
      hashtags: tweet.entities?.hashtags?.map(h => h.tag) || [],
      mentions: tweet.entities?.mentions?.map(m => m.username) || [],
      urls: tweet.entities?.urls?.map(u => u.expanded_url) || [],
      contextAnnotations: tweet.context_annotations || []
    }));
  }

  /**
   * Get user's recent threads (conversations they've participated in)
   * Groups tweets by conversation_id to identify threads
   * @param {string} userId - Twitter user ID
   * @param {number} maxThreads - Maximum number of threads to return (default: 10)
   * @returns {Promise<Array>} Array of thread objects sorted by most recent activity
   */
  async getUserThreads(userId, maxThreads = 10) {
    // Fetch more tweets to get enough threads
    const params = new URLSearchParams({
      'tweet.fields': 'created_at,public_metrics,conversation_id,referenced_tweets,entities',
      'expansions': 'referenced_tweets.id',
      'user.fields': 'username,name',
      'max_results': '100',  // Fetch 100 tweets to find threads
      'exclude': 'retweets'
    });

    const data = await this.makeRequest(`/users/${userId}/tweets`, params);

    if (!data.data) {
      return [];
    }

    // Group tweets by conversation_id
    const threadMap = new Map();

    data.data.forEach(tweet => {
      const convId = tweet.conversation_id;
      if (!convId) return;

      if (!threadMap.has(convId)) {
        threadMap.set(convId, {
          conversationId: convId,
          tweets: [],
          latestActivity: null,
          totalEngagement: 0
        });
      }

      const thread = threadMap.get(convId);
      const tweetDate = new Date(tweet.created_at);

      thread.tweets.push({
        id: tweet.id,
        text: tweet.text,
        createdAt: tweet.created_at,
        metrics: tweet.public_metrics || {}
      });

      // Track most recent activity
      if (!thread.latestActivity || tweetDate > thread.latestActivity) {
        thread.latestActivity = tweetDate;
      }

      // Sum up engagement
      const metrics = tweet.public_metrics || {};
      thread.totalEngagement += (metrics.like_count || 0) + (metrics.retweet_count || 0) + (metrics.reply_count || 0);
    });

    // Convert to array, filter threads with multiple tweets or high engagement
    const threads = Array.from(threadMap.values())
      .filter(thread => thread.tweets.length > 1 || thread.totalEngagement > 10)
      .sort((a, b) => b.latestActivity - a.latestActivity)
      .slice(0, maxThreads)
      .map(thread => ({
        conversationId: thread.conversationId,
        tweetCount: thread.tweets.length,
        latestActivity: thread.latestActivity.toISOString(),
        totalEngagement: thread.totalEngagement,
        firstTweet: thread.tweets[thread.tweets.length - 1], // Oldest tweet
        latestTweet: thread.tweets[0], // Newest tweet
        preview: thread.tweets[0].text.substring(0, 100) + (thread.tweets[0].text.length > 100 ? '...' : '')
      }));

    return threads;
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
   * @param {Array} threads - Array of thread objects (optional)
   * @returns {Promise<Object>} Summary object with topics, mood, controversies, etc.
   */
  async summarizeUserContext(user, tweets, threads = []) {
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

    // Add thread information if available
    let threadInfo = '';
    if (threads.length > 0) {
      threadInfo = '\n\nACTIVE THREADS (conversations they\'re participating in):\n' +
        threads.slice(0, 5).map((thread, i) => {
          return `[Thread ${i + 1}] ${thread.tweetCount} tweets, ${thread.totalEngagement} engagement - Preview: "${thread.preview}"`;
        }).join('\n');
    }

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
${tweetsText}${threadInfo}

Return a JSON object with:
{
  "summary": "2-3 sentence summary of what they've been up to lately - their current focus, mood, and situation${threads.length > 0 ? '. Include what they\'re actively discussing in threads.' : ''}",
  "topics": ["array", "of", "main", "topics", "they're", "discussing"],
  "mood": "their general vibe (e.g., 'fired up', 'chill', 'frustrated', 'excited', 'philosophical', 'trolling', 'promotional')",
  "controversies": ["any drama, beefs, or controversial takes they're involved in - empty if none"],
  "keyEvents": ["notable announcements, achievements, or life updates - empty if none"],
  "engagementInsight": "brief note on what types of posts get them the most engagement",
  "recentActivity": "what they've been doing in the last 24-48 hours based on thread activity"
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
      engagementInsight: 'Could not parse structured analysis',
      recentActivity: 'Could not determine recent activity'
    };
  }

  /**
   * Generate savage roasting points from user's recent activity
   * Returns an array of specific things to roast them about
   * @param {Object} user - User data
   * @param {Array} tweets - Array of tweet objects
   * @param {Array} threads - Array of thread objects
   * @returns {Promise<string[]>} Array of roasting points
   */
  async generateRoastingPoints(user, tweets, threads = []) {
    if (!this.apiKey) {
      throw new UserContextError(
        'XAI_API_KEY is required for generating roasting points',
        401,
        'MISSING_API_KEY'
      );
    }

    if (!tweets.length) {
      return ['Has been suspiciously quiet - probably hiding something'];
    }

    // Prepare tweet data with engagement metrics
    const tweetsText = tweets.slice(0, 30)
      .map((t, i) => {
        const likes = t.metrics.like_count || 0;
        const retweets = t.metrics.retweet_count || 0;
        const type = t.isReply ? '[REPLY]' : t.isQuote ? '[QUOTE]' : '';
        return `${type} "${t.text}" (${likes} likes, ${retweets} RTs)`;
      })
      .join('\n');

    // Add thread info
    let threadInfo = '';
    if (threads.length > 0) {
      threadInfo = '\n\nTHEIR ACTIVE THREADS:\n' +
        threads.slice(0, 5).map((thread, i) => {
          return `- ${thread.totalEngagement} engagement: "${thread.preview}"`;
        }).join('\n');
    }

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
          content: `You are a savage comedy writer finding ammunition to ROAST someone. Be brutal, funny, and specific. Look for:
- Hypocrisies (saying one thing, doing another)
- Failed predictions or promises
- Embarrassing engagement patterns (what gets likes vs what doesn't)
- Cringe takes or self-owns
- Repeated obsessions that are mockable
- Ratio'd tweets or controversial takes that backfired`
        }, {
          role: 'user',
          content: `Find the BEST roasting ammunition from @${user.username}'s (${user.name}) recent tweets.

User bio: ${user.description || 'No bio'}
Followers: ${user.public_metrics?.followers_count || 'Unknown'}

THEIR RECENT TWEETS:
${tweetsText}${threadInfo}

Return a JSON array of 3-5 SAVAGE roasting points. Each point should be:
- Specific and based on their actual tweets
- Mockable and funny
- Something that exposes hypocrisy, failure, or cringe

Format: ["roasting point 1", "roasting point 2", ...]

Examples of good roasting points:
- "Claims to be a tech visionary but political rants get 10x more engagement than product updates"
- "Tweeted 'AI will change everything' right after laying off the AI team"
- "Posts about 'hustle culture' at 2am while complaining about burnout"

Only return the JSON array, nothing else.`
        }],
        temperature: 0.8
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[RoastingPoints] Grok API error:', error);
      // Return fallback roasting points
      return ['Their Twitter feed exists - that\'s roastable enough'];
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const points = JSON.parse(jsonMatch[0]);
        if (Array.isArray(points) && points.length > 0) {
          console.log(`[RoastingPoints] Generated ${points.length} roasting points for @${user.username}`);
          return points;
        }
      }
    } catch (e) {
      console.error('[RoastingPoints] Failed to parse JSON:', e.message);
    }

    // Fallback
    return ['Their Twitter history speaks for itself'];
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
   * @param {number} options.maxThreads - Maximum threads to fetch (default: 10)
   * @returns {Promise<Object>} User context object with user info, tweets, threads, and summary
   */
  async getUserContext(username, options = {}) {
    const { tweetCount = 50, maxThreads = 10 } = options;
    const cleanUsername = username.replace(/^@/, '');

    console.log(`[UserContext] Fetching context for @${cleanUsername}`);

    // Step 1: Fetch user data (needed for user ID)
    const user = await this.userTweetClient.getUserByUsername(cleanUsername);
    console.log(`[UserContext] Found user: ${user.name} (ID: ${user.id})`);

    // Step 2: Fetch tweets and threads in parallel
    const [tweets, threads] = await Promise.all([
      this.userTweetClient.getUserTweets(user.id, tweetCount),
      this.userTweetClient.getUserThreads(user.id, maxThreads)
    ]);
    console.log(`[UserContext] Fetched ${tweets.length} tweets and ${threads.length} threads`);

    // Step 3: Generate summary with Grok (include thread context)
    const summary = await this.grokSummarizer.summarizeUserContext(user, tweets, threads);
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
      threads: threads, // Include user's active threads
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
      threadCount: fullContext.threads?.length || 0,
      context: fullContext.context
    };
  }

  /**
   * Get savage roasting points for a user based on their recent activity
   * Fast method that fetches tweets and generates roasting ammunition
   * @param {string} username - Twitter handle (with or without @)
   * @param {Object} options - Optional settings
   * @param {number} options.tweetCount - Number of tweets to analyze (default: 50)
   * @returns {Promise<Object>} Object with username and roastingPoints array
   */
  async getRoastingPoints(username, options = {}) {
    const { tweetCount = 50 } = options;
    const cleanUsername = username.replace(/^@/, '');

    console.log(`[RoastingPoints] Fetching roasting ammo for @${cleanUsername}`);

    try {
      // Step 1: Fetch user data
      const user = await this.userTweetClient.getUserByUsername(cleanUsername);

      // Step 2: Fetch tweets and threads in parallel
      const [tweets, threads] = await Promise.all([
        this.userTweetClient.getUserTweets(user.id, tweetCount),
        this.userTweetClient.getUserThreads(user.id, 10)
      ]);

      // Step 3: Generate roasting points
      const roastingPoints = await this.grokSummarizer.generateRoastingPoints(user, tweets, threads);

      return {
        username: cleanUsername,
        name: user.name,
        roastingPoints,
        tweetCount: tweets.length,
        threadCount: threads.length
      };
    } catch (error) {
      console.error(`[RoastingPoints] Failed for @${cleanUsername}:`, error.message);
      // Return fallback so roasting can still happen
      return {
        username: cleanUsername,
        roastingPoints: [`Being @${cleanUsername} is punishment enough`],
        error: error.message
      };
    }
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
