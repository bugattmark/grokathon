/**
 * Tweet Beef Video Generator - Content Script
 * Detects beef tweets and injects video player
 */

const API_BASE = 'http://localhost:3000/api/beef';

// Beef detection configuration - triggers on ALL tweets from these handles
const BEEF_CONFIG = {
  handles: ['elonmusk']
};

// Cache for video data (persists across DOM changes)
// Key: tweet_id or tweet_text, Value: API response data
const videoCache = new Map();

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
 * Note: Uses click-to-open popup due to X.com CSP blocking external video sources
 */
function createVideoPlayer(data) {
  const container = document.createElement('div');
  container.className = 'beef-video-container';

  // Store video URL for popup
  container.dataset.videoUrl = data.video_url || '';
  container.dataset.thumbnailUrl = data.thumbnail_url || '';

  container.innerHTML = `
    <div class="beef-video-header">
      <span class="beef-badge">🎬 BEEF ALERT</span>
      <span class="beef-title">${data.title || 'Loading...'}</span>
    </div>
    <div class="beef-video-wrapper">
      ${data.video_url
        ? `<div class="beef-video-preview" style="cursor: pointer; position: relative;">
            <img src="${data.thumbnail_url || ''}" alt="Video thumbnail" style="width: 100%; border-radius: 8px; ${!data.thumbnail_url ? 'display:none;' : ''}" />
            <div class="beef-play-overlay" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.7); border-radius: 50%; width: 60px; height: 60px; display: flex; align-items: center; justify-content: center;">
              <span style="color: white; font-size: 24px; margin-left: 4px;">▶</span>
            </div>
            <p style="text-align: center; color: #888; font-size: 12px; margin-top: 8px;">Click to watch video (opens in new window)</p>
          </div>`
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

  // Add click handler for video popup
  if (data.video_url) {
    const preview = container.querySelector('.beef-video-preview');
    if (preview) {
      preview.addEventListener('click', () => {
        log('Opening video in popup:', data.video_url);
        openVideoPopup(data.video_url, data.title || 'Beef Video', data.storyline || '');
      });
    }
  }

  return container;
}

/**
 * Open video in extension page (bypasses X.com CSP)
 * Uses chrome.runtime.getURL to open the extension's player.html
 */
function openVideoPopup(videoUrl, title, storyline = '') {
  const width = 850;
  const height = 700;
  const left = Math.round((screen.width - width) / 2);
  const top = Math.round((screen.height - height) / 2);

  // Build URL to extension's player page
  const playerUrl = chrome.runtime.getURL('player.html');
  const params = new URLSearchParams({
    video: videoUrl,
    title: title,
    storyline: storyline
  });
  const fullUrl = `${playerUrl}?${params.toString()}`;

  log('Opening extension player:', fullUrl);

  // Open in popup window
  const popup = window.open(fullUrl, '_blank', `width=${width},height=${height},left=${left},top=${top}`);
  if (!popup) {
    log('Popup blocked, opening in new tab');
    window.open(fullUrl, '_blank');
  }
}

/**
 * Embed video iframe into player element
 */
function embedVideoIframe(player, data) {
  log('Embedding video iframe with URL:', data.video_url);

  // Hide outer header/storyline since iframe has its own
  const header = player.querySelector('.beef-video-header');
  const storyline = player.querySelector('.beef-storyline');
  if (header) header.style.display = 'none';
  if (storyline) storyline.style.display = 'none';

  const wrapper = player.querySelector('.beef-video-wrapper');

  // Build iframe URL to extension's player page
  const playerUrl = chrome.runtime.getURL('player.html');
  const params = new URLSearchParams({
    video: data.video_url,
    title: data.title || 'Beef Video',
    storyline: data.storyline || ''
  });
  const iframeSrc = `${playerUrl}?${params.toString()}`;

  // Embed iframe inline (bypasses X.com CSP)
  wrapper.innerHTML = `
    <iframe
      src="${iframeSrc}"
      style="width: 100%; height: 420px; border: none; border-radius: 8px;"
      allow="autoplay"
    ></iframe>
  `;
  log('Video iframe embedded successfully');
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

  // Find insertion point (after tweet content, before engagement bar)
  const tweetTextEl = tweetElement.querySelector('[data-testid="tweetText"]');
  log('Tweet text element found:', !!tweetTextEl);

  const langDiv = tweetTextEl?.closest('div[lang]');
  log('Lang div found:', !!langDiv);

  const tweetContent = langDiv?.parentElement;
  log('Tweet content parent found:', !!tweetContent);

  if (!tweetContent) {
    logError('Could not find insertion point for video player');
    const altInsertPoint = tweetElement.querySelector('[data-testid="tweetText"]')?.parentElement;
    log('Alt insertion point:', !!altInsertPoint);
    if (!altInsertPoint) return;
  }

  const insertParent = tweetContent?.parentElement || tweetElement;
  const insertBefore = tweetContent?.nextSibling || null;

  // Check if we have cached data for this tweet
  if (videoCache.has(tweetKey)) {
    log('Cache HIT for tweet:', tweetKey.substring(0, 50));
    const cachedData = videoCache.get(tweetKey);

    // Create player with cached data immediately
    const player = createVideoPlayer(cachedData);
    insertParent.insertBefore(player, insertBefore);

    if (cachedData.video_url) {
      embedVideoIframe(player, cachedData);
    }
    return;
  }

  log('Cache MISS, calling API for tweet:', tweetKey.substring(0, 50));

  // Create placeholder
  const player = createVideoPlayer({ title: 'Processing...', storyline: 'Generating your beef content...' });
  insertParent.insertBefore(player, insertBefore);
  log('Player placeholder inserted');

  try {
    // Call backend API
    log('Calling backend API:', API_BASE);

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

    // Cache the response
    videoCache.set(tweetKey, data);
    log('Cached video data for tweet. Cache size:', videoCache.size);

    // Update player with real content
    player.querySelector('.beef-title').textContent = data.title;
    player.querySelector('.beef-storyline p').textContent = data.storyline;

    if (data.video_url) {
      embedVideoIframe(player, data);
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
