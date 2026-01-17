/**
 * Tests for ThreadFetcher
 * Run with: node --test services/threadFetcher.test.js
 */

import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ThreadFetcher, createThreadFetcher } from './threadFetcher.js';

describe('ThreadFetcher', () => {
  describe('constructor', () => {
    it('should create instance with provided bearer token', () => {
      const fetcher = new ThreadFetcher('test-token');
      assert.ok(fetcher);
      assert.equal(fetcher.bearerToken, 'test-token');
    });

    it('should use environment variable if no token provided', () => {
      const originalEnv = process.env.X_BEARER_TOKEN;
      process.env.X_BEARER_TOKEN = 'env-token';

      const fetcher = new ThreadFetcher();
      assert.equal(fetcher.bearerToken, 'env-token');

      process.env.X_BEARER_TOKEN = originalEnv;
    });
  });

  describe('extractTweetId', () => {
    let fetcher;

    beforeEach(() => {
      fetcher = new ThreadFetcher('test-token');
    });

    it('should return numeric ID as-is', () => {
      assert.equal(fetcher.extractTweetId('1234567890'), '1234567890');
      assert.equal(fetcher.extractTweetId(' 1234567890 '), '1234567890');
    });

    it('should extract ID from x.com URL', () => {
      const result = fetcher.extractTweetId('https://x.com/elonmusk/status/1234567890');
      assert.equal(result, '1234567890');
    });

    it('should extract ID from twitter.com URL', () => {
      const result = fetcher.extractTweetId('https://twitter.com/elonmusk/status/1234567890');
      assert.equal(result, '1234567890');
    });

    it('should extract ID from URL with query params', () => {
      const result = fetcher.extractTweetId('https://x.com/user/status/1234567890?s=20');
      assert.equal(result, '1234567890');
    });

    it('should throw error for empty input', () => {
      assert.throws(() => fetcher.extractTweetId(''), {
        message: /Tweet ID or URL is required/
      });

      assert.throws(() => fetcher.extractTweetId(null), {
        message: /Tweet ID or URL is required/
      });
    });

    it('should throw error for invalid format', () => {
      assert.throws(() => fetcher.extractTweetId('not-a-valid-id'), {
        message: /Invalid tweet ID or URL format/
      });

      assert.throws(() => fetcher.extractTweetId('https://example.com/tweet/123'), {
        message: /Invalid tweet ID or URL format/
      });
    });
  });

  describe('getProvider', () => {
    it('should throw error when no bearer token is available', () => {
      const fetcher = new ThreadFetcher(null);
      fetcher.bearerToken = null; // Ensure it's null

      assert.throws(() => fetcher.getProvider(), {
        message: /X_BEARER_TOKEN environment variable is required/
      });
    });

    it('should create provider lazily', () => {
      const fetcher = new ThreadFetcher('test-token');
      assert.equal(fetcher.provider, null);

      const provider = fetcher.getProvider();
      assert.ok(provider);
      assert.equal(fetcher.provider, provider);

      // Should return same instance
      const provider2 = fetcher.getProvider();
      assert.strictEqual(provider, provider2);
    });
  });

  describe('enhanceError', () => {
    let fetcher;

    beforeEach(() => {
      fetcher = new ThreadFetcher('test-token');
    });

    it('should enhance generic errors with context', () => {
      const originalError = new Error('Network failed');
      const enhanced = fetcher.enhanceError(originalError, '123456');

      assert.equal(enhanced.name, 'ThreadFetchError');
      assert.equal(enhanced.tweetId, '123456');
      assert.ok(enhanced.message.includes('123456'));
      assert.ok(enhanced.message.includes('Network failed'));
    });

    it('should provide helpful message for 401 errors', () => {
      // Create a mock XApiError-like object
      const xApiError = {
        statusCode: 401,
        errorCode: 'UNAUTHORIZED',
        message: 'Unauthorized',
        details: {}
      };
      // Add XApiError prototype behavior
      Object.setPrototypeOf(xApiError, Error.prototype);
      xApiError.name = 'XApiError';

      // Import the actual XApiError
      import('./providers/xApiProvider.js').then(({ XApiError }) => {
        const apiError = new XApiError('Unauthorized', 401, 'UNAUTHORIZED');
        const enhanced = fetcher.enhanceError(apiError, '123456');

        assert.ok(enhanced.message.includes('X_BEARER_TOKEN'));
        assert.equal(enhanced.statusCode, 401);
      });
    });

    it('should provide helpful message for 404 errors', async () => {
      const { XApiError } = await import('./providers/xApiProvider.js');
      const apiError = new XApiError('Not found', 404, 'NOT_FOUND');
      const enhanced = fetcher.enhanceError(apiError, '123456');

      assert.ok(enhanced.message.includes('not found'));
      assert.ok(enhanced.message.includes('123456'));
      assert.equal(enhanced.statusCode, 404);
    });

    it('should provide helpful message for 429 errors', async () => {
      const { XApiError } = await import('./providers/xApiProvider.js');
      const apiError = new XApiError('Rate limited', 429, 'RATE_LIMITED');
      const enhanced = fetcher.enhanceError(apiError, '123456');

      assert.ok(enhanced.message.includes('rate limit'));
      assert.equal(enhanced.statusCode, 429);
    });
  });
});

describe('createThreadFetcher', () => {
  it('should create ThreadFetcher using environment variable', () => {
    const originalEnv = process.env.X_BEARER_TOKEN;
    process.env.X_BEARER_TOKEN = 'factory-token';

    const fetcher = createThreadFetcher();
    assert.ok(fetcher instanceof ThreadFetcher);

    process.env.X_BEARER_TOKEN = originalEnv;
  });
});
