/**
 * Tweet Beef Video Generator - Content Script
 * Detects beef tweets and injects video player
 */

const API_BASE = 'http://localhost:3000/api/beef';

// Beef detection configuration - triggers on ALL tweets from these handles
const BEEF_CONFIG = {
  handles: ['elonmusk']
};

// Track processed tweets
const processedTweets = new Set();

// Logging utility
const LOG_PREFIX = '🥩 [BEEF]';
function log(...args) {
  console.log(LOG_PREFIX, ...args);
}
function logDebug(...args) {
  console.debug(LOG_PREFIX, '[DEBUG]', ...args);
}
function logError(...args) {
  console.error(LOG_PREFIX, '[ERROR]', ...args);
}

/**
 * Check if tweet matches beef criteria
 */
function isBeefTweet(tweetElement) {
  // Log all potential author elements for debugging
  const allLinks = tweetElement.querySelectorAll('a[href^="/"]');
  logDebug('All links in tweet:', Array.from(allLinks).map(a => a.getAttribute('href')));

  const authorElement = tweetElement.querySelector('[data-testid="User-Name"] a[href^="/"]');
  logDebug('Author element found:', !!authorElement);

  if (!authorElement) {
    // Try alternative selectors
    const altAuthor = tweetElement.querySelector('a[role="link"][href^="/"]');
    logDebug('Alt author element:', altAuthor?.getAttribute('href'));
  }

  const authorHandle = authorElement?.getAttribute('href')?.replace('/', '').split('/')[0] || '';
  logDebug('Extracted author handle:', authorHandle);

  // Check if author is in our watch list - triggers on ALL their tweets
  const isMatch = BEEF_CONFIG.handles.some(h =>
    authorHandle.toLowerCase() === h.toLowerCase()
  );

  log(`isBeefTweet check: handle="${authorHandle}" matches=${isMatch}`);
  return isMatch;
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
  log('injectVideoPlayer called');
  const tweetData = extractTweetData(tweetElement);
  log('Tweet data extracted:', tweetData);

  const tweetKey = tweetData.tweet_id || tweetData.tweet_text;
  if (!tweetData.tweet_text) {
    logError('No tweet text found, aborting injection');
    return;
  }

  if (processedTweets.has(tweetKey)) {
    log('Tweet already processed, skipping:', tweetKey.substring(0, 50));
    return;
  }

  processedTweets.add(tweetKey);
  log('Added to processed tweets. Total processed:', processedTweets.size);

  // Find insertion point (after tweet content, before engagement bar)
  const tweetTextEl = tweetElement.querySelector('[data-testid="tweetText"]');
  log('Tweet text element found:', !!tweetTextEl);

  const langDiv = tweetTextEl?.closest('div[lang]');
  log('Lang div found:', !!langDiv);

  const tweetContent = langDiv?.parentElement;
  log('Tweet content parent found:', !!tweetContent);

  if (!tweetContent) {
    logError('Could not find insertion point for video player');
    // Try alternative insertion points
    const altInsertPoint = tweetElement.querySelector('[data-testid="tweetText"]')?.parentElement;
    log('Alt insertion point:', !!altInsertPoint);
    if (!altInsertPoint) return;
  }

  // Create placeholder
  log('Creating video player placeholder...');
  const player = createVideoPlayer({ title: 'Processing...', storyline: 'Generating your beef content...' });

  const insertParent = tweetContent?.parentElement || tweetElement;
  const insertBefore = tweetContent?.nextSibling || null;
  log('Inserting player into DOM');
  insertParent.insertBefore(player, insertBefore);
  log('Player inserted successfully!');

  try {
    // Call backend API
    log('Calling backend API:', API_BASE);
    log('Request body:', JSON.stringify(tweetData));

    const response = await fetch(`${API_BASE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tweetData)
    });

    log('API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      logError('API error response:', errorText);
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    log('API response data:', data);

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
    logError('Beef generation failed:', error);
    logError('Error stack:', error.stack);
    const loadingEl = player.querySelector('.beef-loading');
    if (loadingEl) {
      loadingEl.innerHTML = `
        <p class="beef-error">Failed to generate beef content 😢</p>
        <p style="font-size: 10px; color: #666;">${error.message}</p>
      `;
    }
  }
}

/**
 * Scan page for beef tweets
 */
function scanForBeefTweets() {
  log('=== SCANNING FOR TWEETS ===');

  // Try multiple selectors for tweets
  const selectors = [
    '[data-testid="tweet"]',
    'article[data-testid="tweet"]',
    'article',
    '[data-testid="cellInnerDiv"]'
  ];

  let tweets = [];
  for (const selector of selectors) {
    const found = document.querySelectorAll(selector);
    log(`Selector "${selector}" found ${found.length} elements`);
    if (found.length > 0 && tweets.length === 0) {
      tweets = found;
    }
  }

  log(`Total tweet elements to check: ${tweets.length}`);

  tweets.forEach((tweet, index) => {
    logDebug(`--- Checking tweet #${index} ---`);
    logDebug('Tweet HTML preview:', tweet.innerHTML.substring(0, 200));

    const alreadyProcessed = tweet.querySelector('.beef-video-container');
    logDebug('Already has video container:', !!alreadyProcessed);

    if (alreadyProcessed) {
      logDebug('Skipping - already processed');
      return;
    }

    const isBeef = isBeefTweet(tweet);
    if (isBeef) {
      log('✅ BEEF DETECTED! Injecting video player...');
      log('Tweet data:', extractTweetData(tweet));
      injectVideoPlayer(tweet);
    }
  });

  log('=== SCAN COMPLETE ===');
}

/**
 * Initialize observer for dynamic content
 */
function initObserver() {
  log('Initializing MutationObserver...');

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
      window.beefScanTimeout = setTimeout(() => {
        logDebug('MutationObserver triggered scan');
        scanForBeefTweets();
      }, 500);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  log('MutationObserver initialized');
}

// Initialize
log('========================================');
log('🥩 Tweet Beef Video Generator LOADED');
log('========================================');
log('Config:', BEEF_CONFIG);
log('Current URL:', window.location.href);
log('Document readyState:', document.readyState);

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  log('Waiting for DOMContentLoaded...');
  document.addEventListener('DOMContentLoaded', () => {
    log('DOMContentLoaded fired');
    scanForBeefTweets();
    initObserver();
  });
} else {
  log('DOM already loaded, starting immediately');
  scanForBeefTweets();
  initObserver();
}

// Also scan after a delay in case X loads content dynamically
setTimeout(() => {
  log('Delayed scan (2s after load)');
  scanForBeefTweets();
}, 2000);

setTimeout(() => {
  log('Delayed scan (5s after load)');
  scanForBeefTweets();
}, 5000);
