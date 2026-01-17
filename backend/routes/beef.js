import { Router } from 'express';
import { TweetFetcher } from '../services/tweetFetcher.js';
import { GrokClient } from '../services/grok.js';

const router = Router();

// Lazy initialization to ensure env vars are loaded
let tweetFetcher = null;
let grok = null;

function getTweetFetcher() {
  if (!tweetFetcher) tweetFetcher = new TweetFetcher();
  return tweetFetcher;
}

function getGrok() {
  if (!grok) grok = new GrokClient();
  return grok;
}

// Beef categories configuration
const BEEF_CATEGORIES = {
  'elon-vs-openai': {
    handles: ['elonmusk'],
    keywords: ['OpenAI', 'Altman', 'ChatGPT', 'AGI', 'Sam']
  },
  'tech-rivalry': {
    handles: ['elonmusk', 'satlovedotorg'],
    keywords: ['rival', 'competition', 'better', 'wrong']
  }
};

/**
 * POST /api/beef
 * Analyze a tweet and generate beef content
 */
router.post('/', async (req, res) => {
  try {
    const { tweet_id, tweet_text, author } = req.body;

    if (!tweet_text || !author) {
      return res.status(400).json({ error: 'tweet_text and author are required' });
    }

    // Detect category based on content
    const category = detectCategory(tweet_text, author);

    // Generate storyline
    console.log('Generating storyline...');
    const storyline = await getGrok().generateStoryline(tweet_text, author, category);

    // Generate video (parallel with thumbnail)
    console.log('Generating video and thumbnail...');
    const [video, thumbnail] = await Promise.all([
      getGrok().generateVideo(storyline.videoPrompt || storyline.storyline, 6),
      getGrok().generateThumbnail(`${storyline.videoPrompt}, dramatic movie poster style`)
    ]);

    res.json({
      tweet_id,
      category,
      title: storyline.title,
      storyline: storyline.storyline,
      video_url: video.videoUrl,
      thumbnail_url: thumbnail.thumbnailUrl,
      duration: video.duration
    });

  } catch (error) {
    console.error('Beef generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/beef/search
 * Search for beef tweets
 */
router.get('/search', async (req, res) => {
  try {
    const { handle = 'elonmusk', keywords } = req.query;
    const keywordList = keywords?.split(',') || ['OpenAI', 'Altman'];

    console.log(`Searching tweets: @${handle} [${keywordList.join(', ')}]`);
    const result = await getTweetFetcher().searchBeefTweets(handle, keywordList);

    res.json({
      provider: getTweetFetcher().getProviderName(),
      ...result
    });

  } catch (error) {
    console.error('Tweet search error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/beef/categories
 * Get available beef categories
 */
router.get('/categories', (req, res) => {
  res.json({ categories: BEEF_CATEGORIES });
});

/**
 * POST /api/beef/storyline
 * Generate only storyline (for testing)
 */
router.post('/storyline', async (req, res) => {
  try {
    const { tweet_text, author, category = 'tech-beef' } = req.body;

    if (!tweet_text || !author) {
      return res.status(400).json({ error: 'tweet_text and author are required' });
    }

    const storyline = await getGrok().generateStoryline(tweet_text, author, category);
    res.json(storyline);

  } catch (error) {
    console.error('Storyline error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Detect beef category from tweet content
 */
function detectCategory(text, author) {
  const lowerText = text.toLowerCase();
  const lowerAuthor = author.toLowerCase();

  if (lowerAuthor.includes('elon') || lowerAuthor === 'elonmusk') {
    if (lowerText.includes('openai') || lowerText.includes('altman') || lowerText.includes('chatgpt')) {
      return 'elon-vs-openai';
    }
  }

  return 'tech-rivalry';
}

export default router;
