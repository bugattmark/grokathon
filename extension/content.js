/**
 * Tweet Beef Video Generator - Content Script
 * Detects beef tweets and injects video player
 */

const API_BASE = 'http://localhost:3000/api/beef';

// Beef detection configuration
const BEEF_CONFIG = {
  handles: ['elonmusk'],
  keywords: ['OpenAI', 'Altman', 'ChatGPT', 'AGI', 'open source', 'closed']
};

// Track processed tweets
const processedTweets = new Set();

/**
 * Check if tweet matches beef criteria
 */
function isBeefTweet(tweetElement) {
  const tweetText = tweetElement.querySelector('[data-testid="tweetText"]')?.textContent || '';
  const authorElement = tweetElement.querySelector('[data-testid="User-Name"] a[href^="/"]');
  const authorHandle = authorElement?.getAttribute('href')?.replace('/', '') || '';

  // Check if author is in our watch list
  const isWatchedAuthor = BEEF_CONFIG.handles.some(h =>
    authorHandle.toLowerCase() === h.toLowerCase()
  );

  // Check if tweet contains beef keywords
  const hasKeywords = BEEF_CONFIG.keywords.some(k =>
    tweetText.toLowerCase().includes(k.toLowerCase())
  );

  return isWatchedAuthor && hasKeywords;
}

/**
 * Extract tweet data from DOM element
 */
function extractTweetData(tweetElement) {
  const tweetText = tweetElement.querySelector('[data-testid="tweetText"]')?.textContent || '';
  const authorElement = tweetElement.querySelector('[data-testid="User-Name"] a[href^="/"]');
  const authorHandle = authorElement?.getAttribute('href')?.replace('/', '') || '';

  // Try to extract tweet ID from the tweet link
  const tweetLink = tweetElement.querySelector('a[href*="/status/"]');
  const tweetId = tweetLink?.getAttribute('href')?.match(/status\/(\d+)/)?.[1] || '';

  return {
    tweet_id: tweetId,
    tweet_text: tweetText,
    author: authorHandle
  };
}

/**
 * Create video player element
 */
function createVideoPlayer(data) {
  const container = document.createElement('div');
  container.className = 'beef-video-container';
  container.innerHTML = `
    <div class="beef-video-header">
      <span class="beef-badge">🎬 BEEF ALERT</span>
      <span class="beef-title">${data.title || 'Loading...'}</span>
    </div>
    <div class="beef-video-wrapper">
      ${data.video_url
        ? `<video class="beef-video" controls poster="${data.thumbnail_url || ''}">
            <source src="${data.video_url}" type="video/mp4">
          </video>`
        : `<div class="beef-loading">
            <div class="beef-spinner"></div>
            <p>Generating epic drama...</p>
          </div>`
      }
    </div>
    <div class="beef-storyline">
      <p>${data.storyline || 'Analyzing the beef...'}</p>
    </div>
  `;
  return container;
}

/**
 * Inject video player into tweet
 */
async function injectVideoPlayer(tweetElement) {
  const tweetData = extractTweetData(tweetElement);

  if (!tweetData.tweet_text || processedTweets.has(tweetData.tweet_id || tweetData.tweet_text)) {
    return;
  }

  processedTweets.add(tweetData.tweet_id || tweetData.tweet_text);

  // Find insertion point (after tweet content, before engagement bar)
  const tweetContent = tweetElement.querySelector('[data-testid="tweetText"]')?.closest('div[lang]')?.parentElement;
  if (!tweetContent) return;

  // Create placeholder
  const player = createVideoPlayer({ title: 'Processing...', storyline: 'Generating your beef content...' });
  tweetContent.parentElement.insertBefore(player, tweetContent.nextSibling);

  try {
    // Call backend API
    const response = await fetch(`${API_BASE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tweetData)
    });

    if (!response.ok) throw new Error('API error');

    const data = await response.json();

    // Update player with real content
    player.querySelector('.beef-title').textContent = data.title;
    player.querySelector('.beef-storyline p').textContent = data.storyline;

    if (data.video_url) {
      const wrapper = player.querySelector('.beef-video-wrapper');
      wrapper.innerHTML = `
        <video class="beef-video" controls poster="${data.thumbnail_url || ''}">
          <source src="${data.video_url}" type="video/mp4">
        </video>
      `;
    }

  } catch (error) {
    console.error('Beef generation failed:', error);
    player.querySelector('.beef-loading').innerHTML = `
      <p class="beef-error">Failed to generate beef content 😢</p>
    `;
  }
}

/**
 * Scan page for beef tweets
 */
function scanForBeefTweets() {
  const tweets = document.querySelectorAll('[data-testid="tweet"]');

  tweets.forEach(tweet => {
    if (isBeefTweet(tweet) && !tweet.querySelector('.beef-video-container')) {
      console.log('🥩 Beef detected!', extractTweetData(tweet));
      injectVideoPlayer(tweet);
    }
  });
}

/**
 * Initialize observer for dynamic content
 */
function initObserver() {
  const observer = new MutationObserver((mutations) => {
    let shouldScan = false;

    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        shouldScan = true;
        break;
      }
    }

    if (shouldScan) {
      // Debounce scanning
      clearTimeout(window.beefScanTimeout);
      window.beefScanTimeout = setTimeout(scanForBeefTweets, 500);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Initialize
console.log('🥩 Tweet Beef Video Generator loaded');
scanForBeefTweets();
initObserver();
