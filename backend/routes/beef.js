import { Router } from 'express';
import { GrokClient } from '../services/grok.js';
import { TweetFetcher } from '../services/tweetFetcher.js';
import { Cache, globalCache } from '../services/cache.js';
import { createUserContextService, UserContextError } from '../services/userContextService.js';

const router = Router();

// Lazy initialization to ensure env vars are loaded
let grok = null;
let tweetFetcher = null;
let userContextService = null;

function getGrok() {
  if (!grok) grok = new GrokClient();
  return grok;
}

function getTweetFetcher() {
  if (!tweetFetcher) tweetFetcher = new TweetFetcher();
  return tweetFetcher;
}

function getUserContextService() {
  if (!userContextService) userContextService = createUserContextService();
  return userContextService;
}

// Cache TTL constants
const CACHE_TTL = {
  STORYLINE: 10 * 60 * 1000,    // 10 minutes for storylines
  TWEETS: 2 * 60 * 1000,         // 2 minutes for tweets (more dynamic)
  USER_CONTEXT: 5 * 60 * 1000,   // 5 minutes for user context
  VIDEO: 30 * 60 * 1000,         // 30 minutes for generated videos
  THUMBNAIL: 30 * 60 * 1000      // 30 minutes for thumbnails
};

/**
 * Timing utility for measuring operation durations
 */
class Timer {
  constructor(requestId) {
    this.requestId = requestId;
    this.startTime = Date.now();
    this.marks = new Map();
  }

  start(label) {
    this.marks.set(label, { start: Date.now() });
    console.log(`[${this.requestId}] START: ${label}`);
  }

  end(label) {
    const mark = this.marks.get(label);
    if (mark) {
      mark.end = Date.now();
      mark.duration = mark.end - mark.start;
      console.log(`[${this.requestId}] END: ${label} (${mark.duration}ms)`);
      return mark.duration;
    }
    return 0;
  }

  getTotalTime() {
    return Date.now() - this.startTime;
  }

  getTimings() {
    const timings = {};
    for (const [label, mark] of this.marks) {
      if (mark.duration !== undefined) {
        timings[label] = mark.duration;
      }
    }
    timings.total = this.getTotalTime();
    return timings;
  }

  logSummary() {
    const timings = this.getTimings();
    console.log(`[${this.requestId}] TIMING SUMMARY:`, JSON.stringify(timings, null, 2));
    return timings;
  }
}

/**
 * Generate a unique request ID for tracking
 */
function generateRequestId() {
  return `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * POST /api/beef
 * Analyze a tweet and generate beef content with maximum parallelization
 *
 * Request body:
 *   - tweet_id: string (optional)
 *   - tweet_text: string (required)
 *   - author: string (required)
 *   - thread_context: string (optional) - previous tweets in thread
 *   - user_bio: string (optional) - author's bio
 *   - user_followers: string (optional) - follower count
 *   - replying_to: string[] (optional) - users being replied to
 *   - use_cohesive_video: boolean (optional) - use thumbnail-first approach
 */
router.post('/', async (req, res) => {
  const requestId = generateRequestId();
  const timer = new Timer(requestId);

  // Target duration: 15 seconds
  // NOTE: xAI API generates ~5-6s clips, so this is a target not a guarantee
  const TARGET_DURATION = 15;

  try {
    timer.start('total');
    const {
      tweet_id,
      tweet_text,
      author,
      handle,
      thread_context,
      user_bio,
      user_followers,
      replying_to,
      use_cohesive_video = false
    } = req.body;

    if (!tweet_text || !author) {
      return res.status(400).json({ error: 'tweet_text and author are required' });
    }

    console.log(`[${requestId}] Processing beef request for @${author}`);

    // Build context object for richer storylines
    const context = {
      threadContext: thread_context,
      userBio: user_bio,
      userFollowers: user_followers,
      replyingTo: replying_to
    };

    // Phase 1: Generate storyline (required for video/thumbnail prompts)
    // This is the critical path - video and thumbnail depend on it
    timer.start('storyline');
    const cacheKey = Cache.generateKey('storyline', { tweet_text, author, context });
    const storyline = await globalCache.getOrCompute(
      cacheKey,
      () => getGrok().generateStoryline(tweet_text, author, context),
      CACHE_TTL.STORYLINE
    );
    timer.end('storyline');

    // Phase 2: Generate video and thumbnail in parallel
    // These are independent once we have the storyline
    timer.start('media_generation');

    const videoPrompt = storyline.videoPrompt || storyline.storyline;
    const thumbnailPrompt = `${storyline.videoPrompt || storyline.storyline}, dramatic movie poster style`;

    let videoResult, thumbnailResult;

    if (use_cohesive_video) {
      // Use thumbnail-first approach for more cohesive videos
      timer.start('cohesive_video');
      const cohesiveCacheKey = Cache.generateKey('cohesive_video', { scenePrompt: videoPrompt, thumbnailPrompt });
      const cohesiveResult = await globalCache.getOrCompute(
        cohesiveCacheKey,
        () => getGrok().generateCohesiveVideo(videoPrompt, thumbnailPrompt),
        CACHE_TTL.VIDEO
      );
      timer.end('cohesive_video');

      videoResult = { status: 'fulfilled', value: cohesiveResult };
      thumbnailResult = { status: 'fulfilled', value: { thumbnailUrl: cohesiveResult.thumbnailUrl } };
    } else {
      // Standard parallel generation
      // Use Promise.allSettled for partial failure tolerance
      // If thumbnail fails, we can still return the video
      [videoResult, thumbnailResult] = await Promise.allSettled([
        (async () => {
          timer.start('video');
          const videoCacheKey = Cache.generateKey('video', { prompt: videoPrompt });
          const result = await globalCache.getOrCompute(
            videoCacheKey,
            () => getGrok().generateVideo(videoPrompt, TARGET_DURATION),
            CACHE_TTL.VIDEO
          );
          timer.end('video');
          return result;
        })(),
        (async () => {
          timer.start('thumbnail');
          const thumbnailCacheKey = Cache.generateKey('thumbnail', { prompt: thumbnailPrompt });
          const result = await globalCache.getOrCompute(
            thumbnailCacheKey,
            () => getGrok().generateThumbnail(thumbnailPrompt),
            CACHE_TTL.THUMBNAIL
          );
          timer.end('thumbnail');
          return result;
        })()
      ]);
    }

    timer.end('media_generation');

    // Extract results, handling partial failures
    const video = videoResult.status === 'fulfilled' ? videoResult.value : null;
    const thumbnail = thumbnailResult.status === 'fulfilled' ? thumbnailResult.value : null;

    // Log any failures
    if (videoResult.status === 'rejected') {
      console.error(`[${requestId}] Video generation failed:`, videoResult.reason);
    }
    if (thumbnailResult.status === 'rejected') {
      console.error(`[${requestId}] Thumbnail generation failed:`, thumbnailResult.reason);
    }

    // Video is required, thumbnail is optional
    if (!video) {
      throw new Error('Video generation failed: ' + (videoResult.reason?.message || 'Unknown error'));
    }

    timer.end('total');
    const timings = timer.logSummary();

    res.json({
      tweet_id,
      title: storyline.title,
      storyline: storyline.storyline,
      video_url: video.videoUrl,
      thumbnail_url: thumbnail?.thumbnailUrl || null,
      duration: video.duration,
      target_duration: TARGET_DURATION,
      scenes: storyline.scenes,
      limitation: video.limitation,
      _meta: {
        requestId,
        timings,
        cached: {
          storyline: globalCache.get(cacheKey) !== undefined,
          video: globalCache.get(Cache.generateKey('video', { prompt: videoPrompt })) !== undefined,
          thumbnail: globalCache.get(Cache.generateKey('thumbnail', { prompt: thumbnailPrompt })) !== undefined
        }
      }
    });

  } catch (error) {
    console.error(`[${requestId}] Beef generation error:`, error);
    timer.end('total');
    res.status(500).json({
      error: error.message,
      _meta: {
        requestId,
        timings: timer.getTimings()
      }
    });
  }
});

/**
 * POST /api/beef/batch
 * Process multiple tweets in parallel for maximum throughput
 */
router.post('/batch', async (req, res) => {
  const requestId = generateRequestId();
  const timer = new Timer(requestId);

  try {
    timer.start('total');
    const { tweets } = req.body;

    if (!Array.isArray(tweets) || tweets.length === 0) {
      return res.status(400).json({ error: 'tweets array is required' });
    }

    // Limit batch size to prevent resource exhaustion
    const MAX_BATCH_SIZE = 5;
    if (tweets.length > MAX_BATCH_SIZE) {
      return res.status(400).json({
        error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}`
      });
    }

    console.log(`[${requestId}] Processing batch of ${tweets.length} tweets`);

    // Phase 1: Generate all storylines in parallel
    timer.start('storylines');
    const storylinePromises = tweets.map(async (tweet, index) => {
      const { tweet_text, author } = tweet;
      if (!tweet_text || !author) {
        return { error: 'tweet_text and author are required', index };
      }

      const cacheKey = Cache.generateKey('storyline', { tweet_text, author });
      try {
        const storyline = await globalCache.getOrCompute(
          cacheKey,
          () => getGrok().generateStoryline(tweet_text, author),
          CACHE_TTL.STORYLINE
        );
        return { storyline, tweet, index };
      } catch (error) {
        return { error: error.message, tweet, index };
      }
    });

    const storylineResults = await Promise.allSettled(storylinePromises);
    timer.end('storylines');

    // Phase 2: Generate all videos and thumbnails in parallel
    timer.start('media_generation');
    const mediaPromises = storylineResults.map(async (result, index) => {
      if (result.status === 'rejected' || result.value.error) {
        return result.value || { error: result.reason?.message, index };
      }

      const { storyline, tweet } = result.value;
      const videoPrompt = storyline.videoPrompt || storyline.storyline;
      const thumbnailPrompt = `${videoPrompt}, dramatic movie poster style`;

      const [videoResult, thumbnailResult] = await Promise.allSettled([
        globalCache.getOrCompute(
          Cache.generateKey('video', { prompt: videoPrompt }),
          () => getGrok().generateVideo(videoPrompt, 15),
          CACHE_TTL.VIDEO
        ),
        globalCache.getOrCompute(
          Cache.generateKey('thumbnail', { prompt: thumbnailPrompt }),
          () => getGrok().generateThumbnail(thumbnailPrompt),
          CACHE_TTL.THUMBNAIL
        )
      ]);

      const video = videoResult.status === 'fulfilled' ? videoResult.value : null;
      const thumbnail = thumbnailResult.status === 'fulfilled' ? thumbnailResult.value : null;

      return {
        tweet_id: tweet.tweet_id,
        title: storyline.title,
        storyline: storyline.storyline,
        video_url: video?.videoUrl || null,
        thumbnail_url: thumbnail?.thumbnailUrl || null,
        duration: video?.duration || null,
        error: !video ? 'Video generation failed' : null,
        index
      };
    });

    const results = await Promise.allSettled(mediaPromises);
    timer.end('media_generation');

    // Flatten results
    const processedResults = results.map(r =>
      r.status === 'fulfilled' ? r.value : { error: r.reason?.message }
    );

    timer.end('total');
    const timings = timer.logSummary();

    res.json({
      results: processedResults,
      _meta: {
        requestId,
        timings,
        processed: processedResults.filter(r => !r.error).length,
        failed: processedResults.filter(r => r.error).length
      }
    });

  } catch (error) {
    console.error(`[${requestId}] Batch generation error:`, error);
    timer.end('total');
    res.status(500).json({
      error: error.message,
      _meta: {
        requestId,
        timings: timer.getTimings()
      }
    });
  }
});

/**
 * POST /api/beef/storyline
 * Generate only storyline (for testing)
 */
router.post('/storyline', async (req, res) => {
  const requestId = generateRequestId();
  const timer = new Timer(requestId);

  try {
    timer.start('total');
    const { tweet_text, author } = req.body;

    if (!tweet_text || !author) {
      return res.status(400).json({ error: 'tweet_text and author are required' });
    }

    timer.start('storyline');
    const cacheKey = Cache.generateKey('storyline', { tweet_text, author });
    const storyline = await globalCache.getOrCompute(
      cacheKey,
      () => getGrok().generateStoryline(tweet_text, author),
      CACHE_TTL.STORYLINE
    );
    timer.end('storyline');

    timer.end('total');
    const timings = timer.logSummary();

    res.json({
      ...storyline,
      _meta: {
        requestId,
        timings,
        cached: globalCache.get(cacheKey) !== undefined
      }
    });

  } catch (error) {
    console.error(`[${requestId}] Storyline error:`, error);
    timer.end('total');
    res.status(500).json({
      error: error.message,
      _meta: {
        requestId,
        timings: timer.getTimings()
      }
    });
  }
});

/**
 * POST /api/beef/search
 * Search for beef tweets and generate content in a parallelized pipeline
 */
router.post('/search', async (req, res) => {
  const requestId = generateRequestId();
  const timer = new Timer(requestId);

  try {
    timer.start('total');
    const { handle, keywords = ['beef', 'drama', 'controversial'] } = req.body;

    if (!handle) {
      return res.status(400).json({ error: 'handle is required' });
    }

    console.log(`[${requestId}] Searching beef tweets for @${handle}`);

    // Search for tweets
    timer.start('tweet_search');
    const tweetCacheKey = Cache.generateKey('tweets', { handle, keywords });
    const { tweets } = await globalCache.getOrCompute(
      tweetCacheKey,
      () => getTweetFetcher().searchBeefTweets(handle, keywords),
      CACHE_TTL.TWEETS
    );
    timer.end('tweet_search');

    if (!tweets || tweets.length === 0) {
      timer.end('total');
      return res.json({
        tweets: [],
        message: 'No beef tweets found',
        _meta: { requestId, timings: timer.getTimings() }
      });
    }

    // Limit to top 3 tweets for processing
    const topTweets = tweets.slice(0, 3);

    // Phase 2: Generate all storylines in parallel
    timer.start('storylines');
    const storylinePromises = topTweets.map(async (tweet) => {
      const cacheKey = Cache.generateKey('storyline', {
        tweet_text: tweet.text,
        author: tweet.author?.username || handle
      });

      const storyline = await globalCache.getOrCompute(
        cacheKey,
        () => getGrok().generateStoryline(tweet.text, tweet.author?.username || handle),
        CACHE_TTL.STORYLINE
      );

      return { tweet, storyline };
    });

    const storylineResults = await Promise.allSettled(storylinePromises);
    timer.end('storylines');

    // Phase 3: Generate videos and thumbnails in parallel for all successful storylines
    timer.start('media_generation');
    const mediaPromises = storylineResults
      .filter(r => r.status === 'fulfilled')
      .map(async (result) => {
        const { tweet, storyline } = result.value;
        const videoPrompt = storyline.videoPrompt || storyline.storyline;
        const thumbnailPrompt = `${videoPrompt}, dramatic movie poster style`;

        const [videoResult, thumbnailResult] = await Promise.allSettled([
          globalCache.getOrCompute(
            Cache.generateKey('video', { prompt: videoPrompt }),
            () => getGrok().generateVideo(videoPrompt, 15),
            CACHE_TTL.VIDEO
          ),
          globalCache.getOrCompute(
            Cache.generateKey('thumbnail', { prompt: thumbnailPrompt }),
            () => getGrok().generateThumbnail(thumbnailPrompt),
            CACHE_TTL.THUMBNAIL
          )
        ]);

        const video = videoResult.status === 'fulfilled' ? videoResult.value : null;
        const thumbnail = thumbnailResult.status === 'fulfilled' ? thumbnailResult.value : null;

        return {
          tweet_id: tweet.id,
          tweet_text: tweet.text,
          tweet_url: tweet.url,
          author: tweet.author?.username || handle,
          title: storyline.title,
          storyline: storyline.storyline,
          video_url: video?.videoUrl || null,
          thumbnail_url: thumbnail?.thumbnailUrl || null,
          duration: video?.duration || null
        };
      });

    const results = await Promise.allSettled(mediaPromises);
    timer.end('media_generation');

    const beefContent = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    timer.end('total');
    const timings = timer.logSummary();

    res.json({
      handle,
      provider: getTweetFetcher().getProviderName(),
      results: beefContent,
      _meta: {
        requestId,
        timings,
        tweetsFound: tweets.length,
        processed: beefContent.length
      }
    });

  } catch (error) {
    console.error(`[${requestId}] Search error:`, error);
    timer.end('total');
    res.status(500).json({
      error: error.message,
      _meta: {
        requestId,
        timings: timer.getTimings()
      }
    });
  }
});

/**
 * GET /api/beef/cache/stats
 * Get cache statistics for monitoring
 */
router.get('/cache/stats', (req, res) => {
  const stats = globalCache.getStats();
  res.json(stats);
});

/**
 * POST /api/beef/cache/clear
 * Clear the cache (admin endpoint)
 */
router.post('/cache/clear', (req, res) => {
  globalCache.clear();
  res.json({ message: 'Cache cleared', stats: globalCache.getStats() });
});

/**
 * GET /api/beef/thread/:tweetId
 * Fetch a tweet thread by ID
 * Returns the complete conversation thread including parent tweets
 */
router.get('/thread/:tweetId', async (req, res) => {
  const requestId = generateRequestId();
  const timer = new Timer(requestId);

  try {
    timer.start('total');
    const { tweetId } = req.params;

    if (!tweetId) {
      return res.status(400).json({ error: 'Tweet ID is required' });
    }

    console.log(`[${requestId}] Fetching thread for tweet: ${tweetId}`);

    timer.start('thread_fetch');
    const cacheKey = Cache.generateKey('thread', { tweetId });
    const thread = await globalCache.getOrCompute(
      cacheKey,
      () => getTweetFetcher().getThread(tweetId),
      CACHE_TTL.TWEETS
    );
    timer.end('thread_fetch');

    timer.end('total');
    const timings = timer.logSummary();

    res.json({
      ...thread,
      _meta: {
        requestId,
        timings,
        cached: globalCache.get(cacheKey) !== undefined
      }
    });

  } catch (error) {
    console.error(`[${requestId}] Thread fetch error:`, error);
    timer.end('total');

    // Handle specific error types
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: error.message,
      errorCode: error.errorCode,
      tweetId: error.tweetId,
      _meta: {
        requestId,
        timings: timer.getTimings()
      }
    });
  }
});

/**
 * POST /api/beef/thread
 * Fetch a tweet thread by ID or URL (POST version for URL flexibility)
 * Returns the complete conversation thread including parent tweets
 */
router.post('/thread', async (req, res) => {
  const requestId = generateRequestId();
  const timer = new Timer(requestId);

  try {
    timer.start('total');
    const { tweet_id, tweet_url } = req.body;
    const tweetIdOrUrl = tweet_id || tweet_url;

    if (!tweetIdOrUrl) {
      return res.status(400).json({ error: 'tweet_id or tweet_url is required' });
    }

    console.log(`[${requestId}] Fetching thread for: ${tweetIdOrUrl}`);

    timer.start('thread_fetch');
    const thread = await getTweetFetcher().getThread(tweetIdOrUrl);
    timer.end('thread_fetch');

    timer.end('total');
    const timings = timer.logSummary();

    res.json({
      ...thread,
      _meta: {
        requestId,
        timings
      }
    });

  } catch (error) {
    console.error(`[${requestId}] Thread fetch error:`, error);
    timer.end('total');

    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: error.message,
      errorCode: error.errorCode,
      tweetId: error.tweetId,
      _meta: {
        requestId,
        timings: timer.getTimings()
      }
    });
  }
});

/**
 * GET /api/beef/thread/:tweetId/context
 * Get thread context formatted for beef analysis
 * Returns structured data useful for content generation
 */
router.get('/thread/:tweetId/context', async (req, res) => {
  const requestId = generateRequestId();
  const timer = new Timer(requestId);

  try {
    timer.start('total');
    const { tweetId } = req.params;

    if (!tweetId) {
      return res.status(400).json({ error: 'Tweet ID is required' });
    }

    console.log(`[${requestId}] Fetching thread context for tweet: ${tweetId}`);

    timer.start('context_fetch');
    const cacheKey = Cache.generateKey('thread_context', { tweetId });
    const context = await globalCache.getOrCompute(
      cacheKey,
      () => getTweetFetcher().getThreadContext(tweetId),
      CACHE_TTL.TWEETS
    );
    timer.end('context_fetch');

    timer.end('total');
    const timings = timer.logSummary();

    res.json({
      ...context,
      _meta: {
        requestId,
        timings,
        cached: globalCache.get(cacheKey) !== undefined
      }
    });

  } catch (error) {
    console.error(`[${requestId}] Thread context error:`, error);
    timer.end('total');

    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: error.message,
      errorCode: error.errorCode,
      tweetId: error.tweetId,
      _meta: {
        requestId,
        timings: timer.getTimings()
      }
    });
  }
});

/**
 * GET /api/beef/tweet/:tweetId
 * Fetch a single tweet by ID
 */
router.get('/tweet/:tweetId', async (req, res) => {
  const requestId = generateRequestId();
  const timer = new Timer(requestId);

  try {
    timer.start('total');
    const { tweetId } = req.params;

    if (!tweetId) {
      return res.status(400).json({ error: 'Tweet ID is required' });
    }

    console.log(`[${requestId}] Fetching tweet: ${tweetId}`);

    timer.start('tweet_fetch');
    const cacheKey = Cache.generateKey('tweet', { tweetId });
    const tweet = await globalCache.getOrCompute(
      cacheKey,
      () => getTweetFetcher().getTweet(tweetId),
      CACHE_TTL.TWEETS
    );
    timer.end('tweet_fetch');

    timer.end('total');
    const timings = timer.logSummary();

    res.json({
      tweet,
      _meta: {
        requestId,
        timings,
        cached: globalCache.get(cacheKey) !== undefined
      }
    });

  } catch (error) {
    console.error(`[${requestId}] Tweet fetch error:`, error);
    timer.end('total');

    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: error.message,
      errorCode: error.errorCode,
      tweetId: error.tweetId,
      _meta: {
        requestId,
        timings: timer.getTimings()
      }
    });
  }
});

/**
 * GET /api/beef/user/:username/context
 * Get user's recent activity summary using X API v2
 * Fetches user info, recent tweets, and generates a Grok-powered summary
 *
 * Query params:
 *   - tweetCount: number (optional, default 50) - Number of tweets to analyze (5-100)
 *   - lightweight: boolean (optional) - Return minimal data without full tweet list
 *
 * Response includes:
 *   - user: User profile info (id, username, name, description, metrics, etc.)
 *   - tweetCount: Number of tweets analyzed
 *   - tweets: Sample of recent tweets (first 10, omitted if lightweight)
 *   - context: AI-generated summary including:
 *     - summary: What's going on in their life lately
 *     - topics: Main discussion topics
 *     - mood: General vibe (e.g., 'fired up', 'chill', 'frustrated')
 *     - controversies: Any drama or controversial takes
 *     - keyEvents: Notable announcements or life updates
 *     - engagementInsight: What types of posts get most engagement
 */
router.get('/user/:username/context', async (req, res) => {
  const requestId = generateRequestId();
  const timer = new Timer(requestId);

  try {
    timer.start('total');
    const { username } = req.params;
    const { tweetCount = 50, lightweight = false } = req.query;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const cleanUsername = username.replace(/^@/, '');
    console.log(`[${requestId}] Fetching user context for @${cleanUsername}`);

    timer.start('user_context');
    const cacheKey = Cache.generateKey('user_context', {
      username: cleanUsername,
      tweetCount: parseInt(tweetCount, 10),
      lightweight: lightweight === 'true' || lightweight === true
    });

    const options = { tweetCount: parseInt(tweetCount, 10) };
    const isLightweight = lightweight === 'true' || lightweight === true;

    const context = await globalCache.getOrCompute(
      cacheKey,
      () => isLightweight
        ? getUserContextService().getLightweightContext(cleanUsername, options)
        : getUserContextService().getUserContext(cleanUsername, options),
      CACHE_TTL.USER_CONTEXT
    );
    timer.end('user_context');

    timer.end('total');
    const timings = timer.logSummary();

    res.json({
      ...context,
      _meta: {
        requestId,
        timings,
        cached: globalCache.get(cacheKey) !== undefined,
        lightweight: isLightweight
      }
    });

  } catch (error) {
    console.error(`[${requestId}] User context fetch error:`, error);
    timer.end('total');

    // Handle specific error types from UserContextError
    const statusCode = error.statusCode || 500;
    const errorResponse = {
      error: error.message,
      errorCode: error.errorCode || 'UNKNOWN_ERROR',
      _meta: {
        requestId,
        timings: timer.getTimings()
      }
    };

    // Add details for debugging if available (but not in production)
    if (error.details && process.env.NODE_ENV !== 'production') {
      errorResponse.details = error.details;
    }

    res.status(statusCode).json(errorResponse);
  }
});

/**
 * POST /api/beef/user/context/batch
 * Get context for multiple users in parallel
 *
 * Request body:
 *   - usernames: string[] (required) - Array of Twitter handles
 *   - tweetCount: number (optional, default 50) - Tweets per user
 *
 * Response:
 *   - contexts: Object mapping username to context (or error info)
 */
router.post('/user/context/batch', async (req, res) => {
  const requestId = generateRequestId();
  const timer = new Timer(requestId);

  try {
    timer.start('total');
    const { usernames, tweetCount = 50 } = req.body;

    if (!Array.isArray(usernames) || usernames.length === 0) {
      return res.status(400).json({ error: 'usernames array is required' });
    }

    // Limit batch size to prevent resource exhaustion
    const MAX_BATCH_SIZE = 5;
    if (usernames.length > MAX_BATCH_SIZE) {
      return res.status(400).json({
        error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}`
      });
    }

    console.log(`[${requestId}] Fetching context for ${usernames.length} users`);

    timer.start('batch_context');
    const contexts = await getUserContextService().getMultipleUserContexts(
      usernames,
      { tweetCount: parseInt(tweetCount, 10) }
    );
    timer.end('batch_context');

    timer.end('total');
    const timings = timer.logSummary();

    // Count successes and failures
    const results = Object.entries(contexts);
    const successful = results.filter(([_, ctx]) => !ctx.error).length;
    const failed = results.filter(([_, ctx]) => ctx.error).length;

    res.json({
      contexts,
      _meta: {
        requestId,
        timings,
        userCount: usernames.length,
        successful,
        failed
      }
    });

  } catch (error) {
    console.error(`[${requestId}] Batch user context error:`, error);
    timer.end('total');

    res.status(500).json({
      error: error.message,
      _meta: {
        requestId,
        timings: timer.getTimings()
      }
    });
  }
});

export default router;
