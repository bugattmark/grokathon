/**
 * Tweet Beef Video Generator - Content Script
 * Detects beef tweets and injects video player
 */

const API_BASE = 'http://localhost:3000/api/beef';

// Beef detection configuration - triggers on ALL tweets
const BEEF_CONFIG = {
  enabled: true  // Process every tweet
};

// Cache for video data (persists across DOM changes)
// Key: tweet_id or tweet_text, Value: API response data
const videoCache = new Map();

// Track in-flight prefetch requests to avoid duplicates
const pendingFetches = new Set();

// Track tweets where user clicked "Generate Beef" (should show player, not button)
// Key: tweet_id or tweet_text, Value: 'loading' | 'complete' | 'error'
const activeTweets = new Map();

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
 * Now processes ALL tweets
 */
function isBeefTweet(tweetElement) {
  if (!BEEF_CONFIG.enabled) return false;

  // Verify it has tweet text (is a real tweet)
  const tweetText = tweetElement.querySelector('[data-testid="tweetText"]');
  if (!tweetText) {
    return false;
  }

  return true;
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
 * Prefetch video data for a tweet (called before it enters viewport)
 * Stores result in cache for instant display when user scrolls to it
 */
async function prefetchVideo(tweetElement) {
  const tweetData = extractTweetData(tweetElement);
  const tweetKey = tweetData.tweet_id || tweetData.tweet_text;

  if (!tweetData.tweet_text) return;

  // Skip if already cached or currently being fetched
  if (videoCache.has(tweetKey) || pendingFetches.has(tweetKey)) {
    logDebug('Prefetch skipped (cached or pending):', tweetKey.substring(0, 30));
    return;
  }

  log('Prefetching video for tweet:', tweetKey.substring(0, 50));
  pendingFetches.add(tweetKey);

  try {
    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tweetData)
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    videoCache.set(tweetKey, data);
    log('Prefetch complete, cached:', tweetKey.substring(0, 30));
  } catch (error) {
    logError('Prefetch failed:', error.message);
  } finally {
    pendingFetches.delete(tweetKey);
  }
}

// Prefetch observer disabled - now using click-to-generate button
// const prefetchObserver = new IntersectionObserver(...);

/**
 * Create "Generate Beef" button for a tweet
 */
function createBeefButton() {
  const button = document.createElement('button');
  button.className = 'beef-generate-btn';
  button.innerHTML = 'Analyze with Gork';
  return button;
}

/**
 * Add a log entry to the player's logs panel
 * @param {HTMLElement} container - The video container element
 * @param {string} message - Log message
 * @param {string} type - Log type: 'info', 'success', 'error', 'warning'
 */
function addLogToPlayer(container, message, type = 'info') {
  const logsContent = container.querySelector('.beef-logs-content');
  if (!logsContent) return;

  const entry = document.createElement('div');
  entry.className = `beef-log-entry beef-log-${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logsContent.appendChild(entry);

  // Auto-scroll to bottom
  logsContent.scrollTop = logsContent.scrollHeight;
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
 * Inject beef button into tweet (click-to-generate approach)
 */
function injectBeefButton(tweetElement) {
  log('injectBeefButton called');

  // Find insertion point (after tweet content, before engagement bar)
  const tweetTextEl = tweetElement.querySelector('[data-testid="tweetText"]');
  if (!tweetTextEl) return;

  const langDiv = tweetTextEl.closest('div[lang]');
  const tweetContent = langDiv?.parentElement;
  if (!tweetContent) return;

  const insertParent = tweetContent.parentElement || tweetElement;
  const insertBefore = tweetContent.nextSibling || null;

  // Create and insert button
  const button = createBeefButton();
  insertParent.insertBefore(button, insertBefore);

  // Handle click - replace button with video player
  button.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Replace button with player
    button.remove();
    await injectVideoPlayer(tweetElement, insertParent, insertBefore);
  });

  log('Beef button injected');
}

/**
 * Inject video player into tweet
 * @param {HTMLElement} tweetElement - The tweet DOM element
 * @param {HTMLElement} insertParent - Parent element to insert player into
 * @param {HTMLElement|null} insertBefore - Element to insert player before
 */
async function injectVideoPlayer(tweetElement, insertParent = null, insertBefore = null) {
  log('injectVideoPlayer called');
  const tweetData = extractTweetData(tweetElement);
  log('Tweet data extracted:', tweetData);

  const tweetKey = tweetData.tweet_id || tweetData.tweet_text;
  if (!tweetData.tweet_text) {
    logError('No tweet text found, aborting injection');
    return;
  }

  // Mark this tweet as active (user clicked Generate Beef)
  activeTweets.set(tweetKey, 'loading');

  // Find insertion point if not provided
  if (!insertParent) {
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

    insertParent = tweetContent?.parentElement || tweetElement;
    insertBefore = tweetContent?.nextSibling || null;
  }

  // Check if we have cached data for this tweet
  if (videoCache.has(tweetKey)) {
    log('Cache HIT for tweet:', tweetKey.substring(0, 50));
    const cachedData = videoCache.get(tweetKey);
    activeTweets.set(tweetKey, 'complete');

    // Create player with cached data immediately
    const player = createVideoPlayer(cachedData);
    insertParent.insertBefore(player, insertBefore);
    addLogToPlayer(player, 'Checking cache... HIT', 'success');
    addLogToPlayer(player, `Loaded from cache: ${cachedData.title}`, 'success');

    if (cachedData.video_url) {
      embedVideoIframe(player, cachedData);
      addLogToPlayer(player, 'Video ready!', 'success');
    }
    return;
  }

  log('Cache MISS, calling API for tweet:', tweetKey.substring(0, 50));

  // Create placeholder
  const player = createVideoPlayer({ title: 'Processing...', storyline: 'Generating your beef content...' });
  insertParent.insertBefore(player, insertBefore);
  log('Player placeholder inserted');

  // Add initial log entries
  addLogToPlayer(player, 'Extracting tweet data...', 'info');
  addLogToPlayer(player, 'Checking cache... MISS', 'warning');
  addLogToPlayer(player, 'Calling storyline API...', 'info');

  try {
    // Call backend API
    log('Calling backend API:', API_BASE);
    addLogToPlayer(player, 'Generating video (30-60s)...', 'info');

    const response = await fetch(`${API_BASE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tweetData)
    });

    log('API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      logError('API error response:', errorText);
      addLogToPlayer(player, `API error: ${response.status}`, 'error');
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    log('API response data:', data);
    addLogToPlayer(player, `Storyline ready: ${data.title}`, 'success');

    // Cache the response and mark as complete
    videoCache.set(tweetKey, data);
    activeTweets.set(tweetKey, 'complete');
    log('Cached video data for tweet. Cache size:', videoCache.size);

    // Update player with real content (check if player still exists in DOM)
    const storylineEl = player.querySelector('.beef-storyline p');
    if (storylineEl) {
      storylineEl.textContent = data.storyline;
    }

    if (data.video_url) {
      // Check if player is still in DOM before embedding
      if (document.contains(player)) {
        embedVideoIframe(player, data);
        addLogToPlayer(player, 'Video ready!', 'success');
      } else {
        log('Player was removed from DOM during generation, data cached for re-injection');
        // Trigger rescan to update any visible loading placeholders with completed data
        setTimeout(() => scanForBeefTweets(), 100);
      }
    }

  } catch (error) {
    logError('Beef generation failed:', error);
    logError('Error stack:', error.stack);
    activeTweets.set(tweetKey, 'error');
    addLogToPlayer(player, `Error: ${error.message}`, 'error');
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
 * Handles both new tweets (show button) and returning tweets (restore player if active)
 */
function scanForBeefTweets() {
  logDebug('=== SCANNING FOR TWEETS ===');

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
    if (found.length > 0 && tweets.length === 0) {
      tweets = found;
      break;
    }
  }

  logDebug(`Total tweet elements to check: ${tweets.length}`);

  tweets.forEach((tweet) => {
    const isBeef = isBeefTweet(tweet);
    if (!isBeef) return;

    const tweetData = extractTweetData(tweet);
    const tweetKey = tweetData.tweet_id || tweetData.tweet_text;

    // Check existing state in DOM
    const existingPlayer = tweet.querySelector('.beef-video-container');
    const existingButton = tweet.querySelector('.beef-generate-btn');

    // Check if this is an active tweet (user previously clicked Generate Beef)
    if (activeTweets.has(tweetKey)) {
      const status = activeTweets.get(tweetKey);

      // If status is complete and we have cached data, upgrade any loading placeholder
      if (status === 'complete' && videoCache.has(tweetKey)) {
        // Check if there's a loading placeholder that needs upgrading
        const loadingEl = existingPlayer?.querySelector('.beef-loading');
        if (loadingEl) {
          log(`⬆️ Upgrading loading placeholder to completed player:`, tweetKey.substring(0, 30));
          existingPlayer.remove();
          injectVideoPlayer(tweet);
        } else if (!existingPlayer) {
          // No player at all, inject fresh
          log(`🔄 Restoring completed tweet:`, tweetKey.substring(0, 30));
          injectVideoPlayer(tweet);
        }
        // If existingPlayer has iframe (not loading), it's already complete - skip
        return;
      }

      // Still loading
      if (status === 'loading') {
        if (!existingPlayer) {
          log(`🔄 Restoring loading state:`, tweetKey.substring(0, 30));
          const tweetTextEl = tweet.querySelector('[data-testid="tweetText"]');
          const langDiv = tweetTextEl?.closest('div[lang]');
          const tweetContent = langDiv?.parentElement;
          if (tweetContent) {
            const insertParent = tweetContent.parentElement || tweet;
            const insertBefore = tweetContent.nextSibling || null;
            const player = createVideoPlayer({ title: 'Processing...', storyline: 'Video generation in progress...' });
            insertParent.insertBefore(player, insertBefore);
            addLogToPlayer(player, 'Resumed - generation in progress...', 'info');
          }
        }
        // Already has loading placeholder - leave it
        return;
      }

      // Error state - show retry button
      if (status === 'error') {
        if (!existingButton && !existingPlayer) {
          injectBeefButton(tweet);
        }
        return;
      }
    }

    // New tweet - show button (only if nothing injected yet)
    if (!existingPlayer && !existingButton) {
      logDebug('New tweet, injecting button');
      injectBeefButton(tweet);
    }
  });

  logDebug('=== SCAN COMPLETE ===');
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
      // Debounce scanning - reduced to 100ms for faster button appearance
      clearTimeout(window.beefScanTimeout);
      window.beefScanTimeout = setTimeout(() => {
        logDebug('MutationObserver triggered scan');
        scanForBeefTweets();
      }, 100);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  log('MutationObserver initialized');
}

/**
 * Throttle utility for scroll handler
 */
function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Initialize scroll listener for faster re-injection
 * Twitter recycles DOM elements when scrolling, this helps restore our content quickly
 */
function initScrollListener() {
  log('Initializing scroll listener...');

  const throttledScan = throttle(() => {
    logDebug('Scroll triggered scan');
    scanForBeefTweets();
  }, 150); // Scan at most every 150ms during scroll

  window.addEventListener('scroll', throttledScan, { passive: true });

  log('Scroll listener initialized');
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
    initScrollListener();
  });
} else {
  log('DOM already loaded, starting immediately');
  scanForBeefTweets();
  initObserver();
  initScrollListener();
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
