/**
 * Tests for UserContextService
 * Run with: node services/userContextService.test.js
 */

import { UserContextService, UserContextError, createUserContextService } from './userContextService.js';

// Mock fetch for testing
const originalFetch = global.fetch;

function mockFetch(responses) {
  let callIndex = 0;
  global.fetch = async (url, options) => {
    const response = responses[callIndex] || responses[responses.length - 1];
    callIndex++;
    return {
      ok: response.ok !== false,
      status: response.status || 200,
      json: async () => response.data,
      text: async () => JSON.stringify(response.data)
    };
  };
}

function restoreFetch() {
  global.fetch = originalFetch;
}

// Test utilities
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertIncludes(str, substr, message) {
  if (!str || !str.includes(substr)) {
    throw new Error(`${message}: expected "${str}" to include "${substr}"`);
  }
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passedTests++;
  } catch (error) {
    console.error(`FAIL: ${name}`);
    console.error(`  Error: ${error.message}`);
    failedTests++;
  }
}

// Test data
const mockUser = {
  id: '12345',
  name: 'Test User',
  username: 'testuser',
  description: 'A test user bio',
  profile_image_url: 'https://example.com/avatar.jpg',
  public_metrics: {
    followers_count: 1000,
    following_count: 500,
    tweet_count: 5000
  },
  location: 'San Francisco',
  verified: false
};

const mockTweets = {
  data: [
    {
      id: 't1',
      text: 'Just shipped a major feature! Feeling great about the progress.',
      created_at: '2024-01-15T10:00:00Z',
      public_metrics: { like_count: 100, retweet_count: 20, reply_count: 10 },
      entities: { hashtags: [{ tag: 'coding' }], mentions: [], urls: [] }
    },
    {
      id: 't2',
      text: 'Hot take: TypeScript is overrated for small projects.',
      created_at: '2024-01-14T15:00:00Z',
      public_metrics: { like_count: 500, retweet_count: 100, reply_count: 200 },
      entities: { hashtags: [{ tag: 'TypeScript' }], mentions: [], urls: [] }
    },
    {
      id: 't3',
      text: 'Working on something cool. More details soon!',
      created_at: '2024-01-13T09:00:00Z',
      public_metrics: { like_count: 50, retweet_count: 5, reply_count: 15 },
      entities: {}
    }
  ]
};

const mockSummary = {
  summary: 'Test user has been actively coding and sharing opinions on tech.',
  topics: ['coding', 'TypeScript', 'product development'],
  mood: 'productive',
  controversies: ['TypeScript hot take sparked debate'],
  keyEvents: ['Shipped major feature'],
  engagementInsight: 'Controversial opinions get more engagement'
};

// Tests
async function runTests() {
  console.log('Running UserContextService tests...\n');

  // === Factory and instantiation tests ===

  await test('createUserContextService factory returns instance', async () => {
    const service = createUserContextService();
    assert(service instanceof UserContextService, 'Should return UserContextService instance');
  });

  await test('UserContextError has correct properties', async () => {
    const error = new UserContextError('Test error', 404, 'NOT_FOUND', { extra: 'data' });
    assertEqual(error.name, 'UserContextError', 'Error name');
    assertEqual(error.message, 'Test error', 'Error message');
    assertEqual(error.statusCode, 404, 'Status code');
    assertEqual(error.errorCode, 'NOT_FOUND', 'Error code');
    assert(error.details.extra === 'data', 'Error details');
  });

  // === getUserContext tests ===

  await test('getUserContext fetches user and tweets', async () => {
    mockFetch([
      { data: { data: mockUser } },
      { data: mockTweets },
      {
        data: {
          choices: [{
            message: { content: JSON.stringify(mockSummary) }
          }]
        }
      }
    ]);

    const service = createUserContextService({
      xBearerToken: 'test-token',
      xaiApiKey: 'test-key'
    });

    const result = await service.getUserContext('testuser');

    assertEqual(result.user.username, 'testuser', 'Username should match');
    assertEqual(result.user.id, '12345', 'User ID should match');
    assertEqual(result.user.location, 'San Francisco', 'Location should be included');
    assert(result.tweets.length > 0, 'Should have tweets');
    assert(result.context.summary, 'Should have summary');
    assert(result.context.topics.length > 0, 'Should have topics');
    assertEqual(result.context.mood, 'productive', 'Mood should match');

    restoreFetch();
  });

  await test('getUserContext handles @ prefix in username', async () => {
    mockFetch([
      { data: { data: mockUser } },
      { data: mockTweets },
      {
        data: {
          choices: [{
            message: { content: JSON.stringify(mockSummary) }
          }]
        }
      }
    ]);

    const service = createUserContextService({
      xBearerToken: 'test-token',
      xaiApiKey: 'test-key'
    });

    const result = await service.getUserContext('@testuser');
    assertEqual(result.user.username, 'testuser', 'Username should be cleaned');

    restoreFetch();
  });

  await test('getUserContext handles user not found (404)', async () => {
    mockFetch([
      { ok: false, status: 404, data: { error: 'User not found' } }
    ]);

    const service = createUserContextService({
      xBearerToken: 'test-token',
      xaiApiKey: 'test-key'
    });

    let errorThrown = false;
    try {
      await service.getUserContext('nonexistent');
    } catch (error) {
      errorThrown = true;
      assertEqual(error.statusCode, 404, 'Should have 404 status');
      assertEqual(error.errorCode, 'NOT_FOUND', 'Should have NOT_FOUND code');
    }

    assert(errorThrown, 'Should throw error for missing user');
    restoreFetch();
  });

  await test('getUserContext handles empty tweets', async () => {
    mockFetch([
      { data: { data: mockUser } },
      { data: { data: [] } }
    ]);

    const service = createUserContextService({
      xBearerToken: 'test-token',
      xaiApiKey: 'test-key'
    });

    const result = await service.getUserContext('testuser');
    assertEqual(result.tweetCount, 0, 'Tweet count should be 0');
    assert(result.context.summary.includes('hasn\'t been very active'), 'Should indicate inactivity');
    assertEqual(result.context.mood, 'quiet', 'Mood should be quiet');

    restoreFetch();
  });

  await test('getUserContext handles rate limiting (429)', async () => {
    mockFetch([
      { ok: false, status: 429, data: { error: 'Rate limit exceeded' } }
    ]);

    const service = createUserContextService({
      xBearerToken: 'test-token',
      xaiApiKey: 'test-key'
    });

    let errorThrown = false;
    try {
      await service.getUserContext('testuser');
    } catch (error) {
      errorThrown = true;
      assertEqual(error.statusCode, 429, 'Should have 429 status');
      assertEqual(error.errorCode, 'RATE_LIMITED', 'Should have RATE_LIMITED code');
    }

    assert(errorThrown, 'Should throw error for rate limit');
    restoreFetch();
  });

  await test('getUserContext handles unauthorized (401)', async () => {
    mockFetch([
      { ok: false, status: 401, data: { error: 'Unauthorized' } }
    ]);

    const service = createUserContextService({
      xBearerToken: 'invalid-token',
      xaiApiKey: 'test-key'
    });

    let errorThrown = false;
    try {
      await service.getUserContext('testuser');
    } catch (error) {
      errorThrown = true;
      assertEqual(error.statusCode, 401, 'Should have 401 status');
      assertEqual(error.errorCode, 'UNAUTHORIZED', 'Should have UNAUTHORIZED code');
    }

    assert(errorThrown, 'Should throw error for unauthorized');
    restoreFetch();
  });

  // === Parallel fetching tests ===

  await test('getMultipleUserContexts fetches users in parallel', async () => {
    let fetchCount = 0;
    global.fetch = async (url) => {
      fetchCount++;
      if (url.includes('/users/by/username/')) {
        return {
          ok: true,
          json: async () => ({ data: { ...mockUser, username: url.split('/').pop().split('?')[0] } })
        };
      }
      if (url.includes('/tweets')) {
        return {
          ok: true,
          json: async () => mockTweets
        };
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(mockSummary) } }]
        })
      };
    };

    const service = createUserContextService({
      xBearerToken: 'test-token',
      xaiApiKey: 'test-key'
    });

    const result = await service.getMultipleUserContexts(['user1', 'user2']);

    assert(result.user1, 'Should have user1 context');
    assert(result.user2, 'Should have user2 context');
    assert(!result.user1.error, 'user1 should not have error');
    assert(!result.user2.error, 'user2 should not have error');
    // With parallel execution, we should have made 6 calls (2 users x 3 calls each)
    assert(fetchCount >= 6, 'Should make multiple fetch calls');

    restoreFetch();
  });

  await test('getMultipleUserContexts handles partial failures gracefully', async () => {
    global.fetch = async (url) => {
      if (url.includes('failuser')) {
        return {
          ok: false,
          status: 404,
          text: async () => 'Not found'
        };
      }
      if (url.includes('/users/by/username/')) {
        return {
          ok: true,
          json: async () => ({ data: mockUser })
        };
      }
      if (url.includes('/tweets')) {
        return {
          ok: true,
          json: async () => mockTweets
        };
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(mockSummary) } }]
        })
      };
    };

    const service = createUserContextService({
      xBearerToken: 'test-token',
      xaiApiKey: 'test-key'
    });

    const result = await service.getMultipleUserContexts(['gooduser', 'failuser']);

    assert(result.gooduser && !result.gooduser.error, 'gooduser should succeed');
    assert(result.failuser.error, 'failuser should have error');
    assertEqual(result.failuser.errorCode, 'NOT_FOUND', 'failuser should have NOT_FOUND code');

    restoreFetch();
  });

  // === Summary parsing tests ===

  await test('summary handles malformed JSON response', async () => {
    mockFetch([
      { data: { data: mockUser } },
      { data: mockTweets },
      {
        data: {
          choices: [{
            message: { content: 'This is just plain text, not JSON' }
          }]
        }
      }
    ]);

    const service = createUserContextService({
      xBearerToken: 'test-token',
      xaiApiKey: 'test-key'
    });

    const result = await service.getUserContext('testuser');
    assert(result.context.summary, 'Should fallback to raw content as summary');
    assertEqual(result.context.mood, 'unknown', 'Mood should be unknown when parsing fails');

    restoreFetch();
  });

  await test('summary handles JSON embedded in text', async () => {
    mockFetch([
      { data: { data: mockUser } },
      { data: mockTweets },
      {
        data: {
          choices: [{
            message: { content: 'Here is the analysis:\n\n' + JSON.stringify(mockSummary) + '\n\nEnd of analysis.' }
          }]
        }
      }
    ]);

    const service = createUserContextService({
      xBearerToken: 'test-token',
      xaiApiKey: 'test-key'
    });

    const result = await service.getUserContext('testuser');
    assertEqual(result.context.mood, 'productive', 'Should extract JSON from surrounding text');
    assert(result.context.topics.includes('TypeScript'), 'Topics should be parsed');

    restoreFetch();
  });

  // === Tweet normalization tests ===

  await test('normalizes tweets correctly with replies and quotes', async () => {
    const tweetsWithReplies = {
      data: [
        {
          id: 't1',
          text: 'Original tweet',
          created_at: '2024-01-15T10:00:00Z',
          public_metrics: { like_count: 100 },
          entities: { hashtags: [{ tag: 'test' }], mentions: [{ username: 'someone' }], urls: [{ expanded_url: 'https://example.com' }] }
        },
        {
          id: 't2',
          text: 'This is a reply',
          created_at: '2024-01-14T10:00:00Z',
          public_metrics: { like_count: 50 },
          referenced_tweets: [{ type: 'replied_to', id: 'original' }]
        },
        {
          id: 't3',
          text: 'This is a quote tweet',
          created_at: '2024-01-13T10:00:00Z',
          public_metrics: { like_count: 75 },
          referenced_tweets: [{ type: 'quoted', id: 'quoted_tweet' }]
        }
      ]
    };

    mockFetch([
      { data: { data: mockUser } },
      { data: tweetsWithReplies },
      {
        data: {
          choices: [{
            message: { content: JSON.stringify(mockSummary) }
          }]
        }
      }
    ]);

    const service = createUserContextService({
      xBearerToken: 'test-token',
      xaiApiKey: 'test-key'
    });

    const result = await service.getUserContext('testuser');

    const tweets = result.tweets;
    assert(tweets[0].hashtags.includes('test'), 'Should extract hashtags');
    assert(tweets[0].mentions.includes('someone'), 'Should extract mentions');
    assert(tweets[0].urls.includes('https://example.com'), 'Should extract URLs');
    assertEqual(tweets[1].isReply, true, 'Should identify replies');
    assertEqual(tweets[2].isQuote, true, 'Should identify quote tweets');

    restoreFetch();
  });

  // === Options tests ===

  await test('respects tweetCount option', async () => {
    let capturedUrl = '';
    global.fetch = async (url, options) => {
      if (url.includes('/tweets')) {
        capturedUrl = url;
      }
      if (url.includes('/users/by/username/')) {
        return { ok: true, json: async () => ({ data: mockUser }) };
      }
      if (url.includes('/tweets')) {
        return { ok: true, json: async () => mockTweets };
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(mockSummary) } }]
        })
      };
    };

    const service = createUserContextService({
      xBearerToken: 'test-token',
      xaiApiKey: 'test-key'
    });

    await service.getUserContext('testuser', { tweetCount: 25 });
    assert(capturedUrl.includes('max_results=25'), 'Should use custom tweet count');

    restoreFetch();
  });

  await test('enforces min/max tweet count bounds', async () => {
    let capturedUrl = '';
    global.fetch = async (url, options) => {
      if (url.includes('/tweets')) {
        capturedUrl = url;
      }
      if (url.includes('/users/by/username/')) {
        return { ok: true, json: async () => ({ data: mockUser }) };
      }
      if (url.includes('/tweets')) {
        return { ok: true, json: async () => mockTweets };
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(mockSummary) } }]
        })
      };
    };

    const service = createUserContextService({
      xBearerToken: 'test-token',
      xaiApiKey: 'test-key'
    });

    // Test max bound
    await service.getUserContext('testuser', { tweetCount: 500 });
    assert(capturedUrl.includes('max_results=100'), 'Should cap at 100');

    // Test min bound
    await service.getUserContext('testuser', { tweetCount: 1 });
    assert(capturedUrl.includes('max_results=5'), 'Should enforce minimum of 5');

    restoreFetch();
  });

  // === Lightweight context tests ===

  await test('getLightweightContext returns minimal data', async () => {
    mockFetch([
      { data: { data: mockUser } },
      { data: mockTweets },
      {
        data: {
          choices: [{
            message: { content: JSON.stringify(mockSummary) }
          }]
        }
      }
    ]);

    const service = createUserContextService({
      xBearerToken: 'test-token',
      xaiApiKey: 'test-key'
    });

    const result = await service.getLightweightContext('testuser');

    assert(result.user.username, 'Should have username');
    assert(result.user.name, 'Should have name');
    assert(result.user.profileImage, 'Should have profile image');
    assert(!result.user.id, 'Should NOT have id (lightweight)');
    assert(!result.user.description, 'Should NOT have description (lightweight)');
    assert(!result.tweets, 'Should NOT have tweets array (lightweight)');
    assert(result.context, 'Should have context');
    assert(result.tweetCount >= 0, 'Should have tweetCount');

    restoreFetch();
  });

  // === Grok API error tests ===

  await test('handles Grok API errors gracefully', async () => {
    mockFetch([
      { data: { data: mockUser } },
      { data: mockTweets },
      { ok: false, status: 500, data: { error: 'Internal server error' } }
    ]);

    const service = createUserContextService({
      xBearerToken: 'test-token',
      xaiApiKey: 'test-key'
    });

    let errorThrown = false;
    try {
      await service.getUserContext('testuser');
    } catch (error) {
      errorThrown = true;
      assertEqual(error.errorCode, 'GROK_ERROR', 'Should have GROK_ERROR code');
    }

    assert(errorThrown, 'Should throw error for Grok API failure');
    restoreFetch();
  });

  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Tests: ${passedTests} passed, ${failedTests} failed`);
  console.log(`${'='.repeat(50)}`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
