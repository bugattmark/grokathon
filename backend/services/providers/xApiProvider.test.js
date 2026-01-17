/**
 * Tests for XApiProvider
 * Run with: node --test services/providers/xApiProvider.test.js
 */

import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { XApiProvider, XApiError } from './xApiProvider.js';

describe('XApiProvider', () => {
  describe('constructor', () => {
    it('should throw error when bearer token is not provided', () => {
      assert.throws(() => new XApiProvider(), {
        message: 'X_BEARER_TOKEN is required for XApiProvider'
      });
    });

    it('should create instance with valid bearer token', () => {
      const provider = new XApiProvider('test-token');
      assert.ok(provider);
      assert.equal(provider.baseUrl, 'https://api.x.com/2');
    });
  });

  describe('makeRequest', () => {
    let provider;
    let originalFetch;

    beforeEach(() => {
      provider = new XApiProvider('test-bearer-token');
      originalFetch = global.fetch;
    });

    it('should add authorization header to requests', async () => {
      let capturedRequest;
      global.fetch = mock.fn(async (url, options) => {
        capturedRequest = { url, options };
        return {
          ok: true,
          json: async () => ({ data: {} })
        };
      });

      await provider.makeRequest('/test', new URLSearchParams({ foo: 'bar' }));

      assert.ok(capturedRequest.options.headers.Authorization);
      assert.equal(capturedRequest.options.headers.Authorization, 'Bearer test-bearer-token');

      global.fetch = originalFetch;
    });

    it('should throw XApiError on 401 response', async () => {
      global.fetch = mock.fn(async () => ({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: 'Unauthorized' })
      }));

      await assert.rejects(
        provider.makeRequest('/test'),
        (error) => {
          assert.ok(error instanceof XApiError);
          assert.equal(error.statusCode, 401);
          assert.equal(error.errorCode, 'UNAUTHORIZED');
          return true;
        }
      );

      global.fetch = originalFetch;
    });

    it('should throw XApiError on 429 rate limit response', async () => {
      global.fetch = mock.fn(async () => ({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ error: 'Rate limit exceeded' })
      }));

      await assert.rejects(
        provider.makeRequest('/test'),
        (error) => {
          assert.ok(error instanceof XApiError);
          assert.equal(error.statusCode, 429);
          assert.equal(error.errorCode, 'RATE_LIMITED');
          return true;
        }
      );

      global.fetch = originalFetch;
    });

    it('should throw XApiError on 404 response', async () => {
      global.fetch = mock.fn(async () => ({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ error: 'Not found' })
      }));

      await assert.rejects(
        provider.makeRequest('/test'),
        (error) => {
          assert.ok(error instanceof XApiError);
          assert.equal(error.statusCode, 404);
          assert.equal(error.errorCode, 'NOT_FOUND');
          return true;
        }
      );

      global.fetch = originalFetch;
    });
  });

  describe('getTweet', () => {
    let provider;
    let originalFetch;

    beforeEach(() => {
      provider = new XApiProvider('test-bearer-token');
      originalFetch = global.fetch;
    });

    it('should throw error for invalid tweet ID', async () => {
      await assert.rejects(
        provider.getTweet(null),
        (error) => {
          assert.ok(error instanceof XApiError);
          assert.equal(error.errorCode, 'INVALID_TWEET_ID');
          return true;
        }
      );

      await assert.rejects(
        provider.getTweet(123), // number instead of string
        (error) => {
          assert.ok(error instanceof XApiError);
          assert.equal(error.errorCode, 'INVALID_TWEET_ID');
          return true;
        }
      );
    });

    it('should fetch and normalize tweet data', async () => {
      const mockResponse = {
        data: {
          id: '1234567890',
          text: 'Test tweet text',
          author_id: 'user123',
          public_metrics: {
            like_count: 100,
            retweet_count: 50
          },
          created_at: '2024-01-15T12:00:00.000Z',
          conversation_id: 'conv123',
          in_reply_to_user_id: null,
          referenced_tweets: null
        },
        includes: {
          users: [{
            id: 'user123',
            username: 'testuser',
            name: 'Test User',
            profile_image_url: 'https://example.com/avatar.jpg'
          }]
        }
      };

      global.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => mockResponse
      }));

      const result = await provider.getTweet('1234567890');

      assert.equal(result.id, '1234567890');
      assert.equal(result.text, 'Test tweet text');
      assert.equal(result.author.username, 'testuser');
      assert.equal(result.author.name, 'Test User');
      assert.equal(result.conversationId, 'conv123');
      assert.ok(result.url.includes('testuser'));
      assert.ok(result.url.includes('1234567890'));

      global.fetch = originalFetch;
    });
  });

  describe('getThread', () => {
    let provider;
    let originalFetch;

    beforeEach(() => {
      provider = new XApiProvider('test-bearer-token');
      originalFetch = global.fetch;
    });

    it('should return single-tweet thread when no conversation_id', async () => {
      const mockTweet = {
        data: {
          id: '1234567890',
          text: 'Standalone tweet',
          author_id: 'user123',
          public_metrics: {},
          created_at: '2024-01-15T12:00:00.000Z',
          conversation_id: null // No conversation
        },
        includes: {
          users: [{ id: 'user123', username: 'testuser', name: 'Test' }]
        }
      };

      global.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => mockTweet
      }));

      const result = await provider.getThread('1234567890');

      assert.equal(result.totalTweets, 1);
      assert.equal(result.thread.length, 1);
      assert.equal(result.thread[0].id, '1234567890');
      assert.deepEqual(result.parentTweets, []);
      assert.deepEqual(result.childTweets, []);

      global.fetch = originalFetch;
    });

    it('should fetch full thread with parent tweets', async () => {
      let callCount = 0;

      // Mock responses for: target tweet, parent tweet, conversation search
      global.fetch = mock.fn(async (url) => {
        callCount++;

        // First call: get target tweet
        if (url.includes('/tweets/3')) {
          return {
            ok: true,
            json: async () => ({
              data: {
                id: '3',
                text: 'Reply to parent',
                author_id: 'user2',
                public_metrics: {},
                created_at: '2024-01-15T14:00:00.000Z',
                conversation_id: '1',
                referenced_tweets: [{ type: 'replied_to', id: '2' }]
              },
              includes: {
                users: [{ id: 'user2', username: 'user2', name: 'User 2' }]
              }
            })
          };
        }

        // Second call: get parent tweet (id: 2)
        if (url.includes('/tweets/2')) {
          return {
            ok: true,
            json: async () => ({
              data: {
                id: '2',
                text: 'Reply to root',
                author_id: 'user1',
                public_metrics: {},
                created_at: '2024-01-15T13:00:00.000Z',
                conversation_id: '1',
                referenced_tweets: [{ type: 'replied_to', id: '1' }]
              },
              includes: {
                users: [{ id: 'user1', username: 'user1', name: 'User 1' }]
              }
            })
          };
        }

        // Third call: get root tweet (id: 1)
        if (url.includes('/tweets/1')) {
          return {
            ok: true,
            json: async () => ({
              data: {
                id: '1',
                text: 'Root tweet',
                author_id: 'user1',
                public_metrics: {},
                created_at: '2024-01-15T12:00:00.000Z',
                conversation_id: '1',
                referenced_tweets: null
              },
              includes: {
                users: [{ id: 'user1', username: 'user1', name: 'User 1' }]
              }
            })
          };
        }

        // Conversation search
        if (url.includes('/tweets/search/recent')) {
          return {
            ok: true,
            json: async () => ({
              data: [],
              meta: {}
            })
          };
        }

        return { ok: true, json: async () => ({}) };
      });

      const result = await provider.getThread('3');

      assert.equal(result.conversationId, '1');
      assert.equal(result.parentTweets.length, 2);
      assert.equal(result.parentTweets[0].id, '1'); // Root tweet first
      assert.equal(result.parentTweets[1].id, '2'); // Parent tweet second
      assert.equal(result.targetTweet.id, '3');

      global.fetch = originalFetch;
    });

    it('should identify child tweets correctly', async () => {
      global.fetch = mock.fn(async (url) => {
        // Target tweet
        if (url.includes('/tweets/1') && !url.includes('search')) {
          return {
            ok: true,
            json: async () => ({
              data: {
                id: '1',
                text: 'Original tweet',
                author_id: 'user1',
                public_metrics: {},
                created_at: '2024-01-15T12:00:00.000Z',
                conversation_id: '1',
                referenced_tweets: null
              },
              includes: {
                users: [{ id: 'user1', username: 'user1', name: 'User 1' }]
              }
            })
          };
        }

        // Conversation search returns replies
        if (url.includes('/tweets/search/recent')) {
          return {
            ok: true,
            json: async () => ({
              data: [
                {
                  id: '2',
                  text: 'Reply to 1',
                  author_id: 'user2',
                  public_metrics: {},
                  created_at: '2024-01-15T13:00:00.000Z',
                  conversation_id: '1',
                  referenced_tweets: [{ type: 'replied_to', id: '1' }]
                },
                {
                  id: '3',
                  text: 'Another reply to 1',
                  author_id: 'user3',
                  public_metrics: {},
                  created_at: '2024-01-15T14:00:00.000Z',
                  conversation_id: '1',
                  referenced_tweets: [{ type: 'replied_to', id: '1' }]
                }
              ],
              includes: {
                users: [
                  { id: 'user2', username: 'user2', name: 'User 2' },
                  { id: 'user3', username: 'user3', name: 'User 3' }
                ]
              },
              meta: {}
            })
          };
        }

        return { ok: true, json: async () => ({}) };
      });

      const result = await provider.getThread('1');

      assert.equal(result.childTweets.length, 2);
      assert.ok(result.childTweets.some(t => t.id === '2'));
      assert.ok(result.childTweets.some(t => t.id === '3'));

      global.fetch = originalFetch;
    });

    it('should skip replies when fetchReplies is false', async () => {
      let searchCalled = false;

      global.fetch = mock.fn(async (url) => {
        if (url.includes('/tweets/search/recent')) {
          searchCalled = true;
        }

        return {
          ok: true,
          json: async () => ({
            data: {
              id: '1',
              text: 'Original tweet',
              author_id: 'user1',
              public_metrics: {},
              created_at: '2024-01-15T12:00:00.000Z',
              conversation_id: '1',
              referenced_tweets: null
            },
            includes: {
              users: [{ id: 'user1', username: 'user1', name: 'User 1' }]
            }
          })
        };
      });

      await provider.getThread('1', { fetchReplies: false });

      assert.equal(searchCalled, false);

      global.fetch = originalFetch;
    });
  })

  describe('getConversationTweets', () => {
    let provider;
    let originalFetch;

    beforeEach(() => {
      provider = new XApiProvider('test-bearer-token');
      originalFetch = global.fetch;
    });

    it('should handle pagination', async () => {
      let pageCount = 0;

      global.fetch = mock.fn(async () => {
        pageCount++;

        if (pageCount === 1) {
          return {
            ok: true,
            json: async () => ({
              data: [
                { id: '1', text: 'Tweet 1', author_id: 'user1', created_at: '2024-01-15T12:00:00.000Z', conversation_id: 'conv1' }
              ],
              includes: { users: [{ id: 'user1', username: 'user1', name: 'User 1' }] },
              meta: { next_token: 'token123' }
            })
          };
        }

        if (pageCount === 2) {
          return {
            ok: true,
            json: async () => ({
              data: [
                { id: '2', text: 'Tweet 2', author_id: 'user2', created_at: '2024-01-15T13:00:00.000Z', conversation_id: 'conv1' }
              ],
              includes: { users: [{ id: 'user2', username: 'user2', name: 'User 2' }] },
              meta: {}
            })
          };
        }

        return { ok: true, json: async () => ({ data: [], meta: {} }) };
      });

      const result = await provider.getConversationTweets('conv1', { maxPages: 5 });

      assert.equal(result.length, 2);
      assert.equal(pageCount, 2);

      global.fetch = originalFetch;
    });

    it('should respect maxPages limit', async () => {
      let pageCount = 0;

      global.fetch = mock.fn(async () => {
        pageCount++;
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: String(pageCount), text: `Tweet ${pageCount}`, author_id: 'user1', created_at: '2024-01-15T12:00:00.000Z', conversation_id: 'conv1' }
            ],
            includes: { users: [{ id: 'user1', username: 'user1', name: 'User 1' }] },
            meta: { next_token: `token${pageCount}` } // Always has next token
          })
        };
      });

      const result = await provider.getConversationTweets('conv1', { maxPages: 3 });

      assert.equal(pageCount, 3);
      assert.equal(result.length, 3);

      global.fetch = originalFetch;
    });

    it('should return partial results on error', async () => {
      let callCount = 0;

      global.fetch = mock.fn(async () => {
        callCount++;

        if (callCount === 1) {
          return {
            ok: true,
            json: async () => ({
              data: [
                { id: '1', text: 'Tweet 1', author_id: 'user1', created_at: '2024-01-15T12:00:00.000Z', conversation_id: 'conv1' }
              ],
              includes: { users: [{ id: 'user1', username: 'user1', name: 'User 1' }] },
              meta: { next_token: 'token123' }
            })
          };
        }

        // Second call fails
        return {
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error'
        };
      });

      const result = await provider.getConversationTweets('conv1');

      // Should return the tweets from the first page
      assert.equal(result.length, 1);
      assert.equal(result[0].id, '1');

      global.fetch = originalFetch;
    });
  });

  describe('normalize', () => {
    let provider;

    beforeEach(() => {
      provider = new XApiProvider('test-bearer-token');
    });

    it('should return empty tweets array when no data', () => {
      const result = provider.normalize({});
      assert.deepEqual(result, { tweets: [] });
    });

    it('should normalize multiple tweets', () => {
      const data = {
        data: [
          {
            id: '1',
            text: 'Tweet 1',
            author_id: 'user1',
            public_metrics: { like_count: 10 },
            created_at: '2024-01-15T12:00:00.000Z',
            conversation_id: 'conv1'
          },
          {
            id: '2',
            text: 'Tweet 2',
            author_id: 'user2',
            public_metrics: { like_count: 20 },
            created_at: '2024-01-15T13:00:00.000Z',
            conversation_id: 'conv2'
          }
        ],
        includes: {
          users: [
            { id: 'user1', username: 'user_one', name: 'User One' },
            { id: 'user2', username: 'user_two', name: 'User Two' }
          ]
        }
      };

      const result = provider.normalize(data);

      assert.equal(result.tweets.length, 2);
      assert.equal(result.tweets[0].author.username, 'user_one');
      assert.equal(result.tweets[1].author.username, 'user_two');
    });

    it('should handle missing user data gracefully', () => {
      const data = {
        data: [{
          id: '1',
          text: 'Tweet 1',
          author_id: 'unknown_user',
          public_metrics: {},
          created_at: '2024-01-15T12:00:00.000Z'
        }],
        includes: { users: [] }
      };

      const result = provider.normalize(data);

      assert.equal(result.tweets[0].author.username, 'unknown');
      assert.equal(result.tweets[0].author.name, 'Unknown');
    });
  });

  describe('buildThread', () => {
    let provider;

    beforeEach(() => {
      provider = new XApiProvider('test-bearer-token');
    });

    it('should deduplicate tweets', () => {
      const tweet1 = { id: '1', text: 'Tweet 1', createdAt: '2024-01-15T12:00:00.000Z' };
      const tweet2 = { id: '2', text: 'Tweet 2', createdAt: '2024-01-15T13:00:00.000Z' };
      const tweet1Duplicate = { id: '1', text: 'Tweet 1 copy', createdAt: '2024-01-15T12:00:00.000Z' };

      const result = provider.buildThread(
        tweet2,
        [tweet1],
        [tweet1Duplicate, tweet2]
      );

      assert.equal(result.length, 2);
      const ids = result.map(t => t.id);
      assert.deepEqual(ids, ['1', '2']);
    });

    it('should sort tweets chronologically', () => {
      const tweet1 = { id: '1', text: 'First', createdAt: '2024-01-15T10:00:00.000Z' };
      const tweet2 = { id: '2', text: 'Second', createdAt: '2024-01-15T11:00:00.000Z' };
      const tweet3 = { id: '3', text: 'Third', createdAt: '2024-01-15T12:00:00.000Z' };

      // Pass in non-chronological order
      const result = provider.buildThread(
        tweet2,
        [tweet3],
        [tweet1]
      );

      assert.equal(result.length, 3);
      assert.equal(result[0].id, '1');
      assert.equal(result[1].id, '2');
      assert.equal(result[2].id, '3');
    });

    it('should filter to direct chain only when option is set', () => {
      const tweet1 = { id: '1', text: 'Root', createdAt: '2024-01-15T10:00:00.000Z' };
      const tweet2 = { id: '2', text: 'Parent', createdAt: '2024-01-15T11:00:00.000Z' };
      const tweet3 = { id: '3', text: 'Target', createdAt: '2024-01-15T12:00:00.000Z' };
      const tweet4 = { id: '4', text: 'Other reply', createdAt: '2024-01-15T13:00:00.000Z' };

      // tweet3 is target, tweet1 and tweet2 are parents, tweet4 is from conversation but not in chain
      const result = provider.buildThread(
        tweet3,
        [tweet1, tweet2],
        [tweet4],
        { directChainOnly: true }
      );

      assert.equal(result.length, 3);
      assert.ok(result.some(t => t.id === '1'));
      assert.ok(result.some(t => t.id === '2'));
      assert.ok(result.some(t => t.id === '3'));
      assert.ok(!result.some(t => t.id === '4'));
    });
  });

  describe('buildReplyTree', () => {
    let provider;

    beforeEach(() => {
      provider = new XApiProvider('test-bearer-token');
    });

    it('should build a tree with nested replies', () => {
      const thread = [
        { id: '1', text: 'Root', createdAt: '2024-01-15T10:00:00.000Z', referencedTweets: null },
        { id: '2', text: 'Reply to root', createdAt: '2024-01-15T11:00:00.000Z', referencedTweets: [{ type: 'replied_to', id: '1' }] },
        { id: '3', text: 'Reply to reply', createdAt: '2024-01-15T12:00:00.000Z', referencedTweets: [{ type: 'replied_to', id: '2' }] },
        { id: '4', text: 'Another reply to root', createdAt: '2024-01-15T13:00:00.000Z', referencedTweets: [{ type: 'replied_to', id: '1' }] }
      ];

      const tree = provider.buildReplyTree(thread);

      assert.equal(tree.roots.length, 1);
      assert.equal(tree.roots[0].id, '1');
      assert.equal(tree.roots[0].replies.length, 2);
      assert.equal(tree.roots[0].replies[0].id, '2');
      assert.equal(tree.roots[0].replies[1].id, '4');
      assert.equal(tree.roots[0].replies[0].replies.length, 1);
      assert.equal(tree.roots[0].replies[0].replies[0].id, '3');
      assert.equal(tree.totalTweets, 4);
    });

    it('should handle multiple roots', () => {
      const thread = [
        { id: '1', text: 'Root 1', createdAt: '2024-01-15T10:00:00.000Z', referencedTweets: null },
        { id: '2', text: 'Root 2', createdAt: '2024-01-15T11:00:00.000Z', referencedTweets: null },
        { id: '3', text: 'Reply to root 1', createdAt: '2024-01-15T12:00:00.000Z', referencedTweets: [{ type: 'replied_to', id: '1' }] }
      ];

      const tree = provider.buildReplyTree(thread);

      assert.equal(tree.roots.length, 2);
      assert.equal(tree.roots[0].id, '1');
      assert.equal(tree.roots[1].id, '2');
    });

    it('should handle orphan tweets (parent not in thread)', () => {
      const thread = [
        { id: '2', text: 'Orphan reply', createdAt: '2024-01-15T11:00:00.000Z', referencedTweets: [{ type: 'replied_to', id: '999' }] }
      ];

      const tree = provider.buildReplyTree(thread);

      // Should be treated as a root since parent is not in thread
      assert.equal(tree.roots.length, 1);
      assert.equal(tree.roots[0].id, '2');
    });

    it('should sort replies chronologically', () => {
      const thread = [
        { id: '1', text: 'Root', createdAt: '2024-01-15T10:00:00.000Z', referencedTweets: null },
        { id: '3', text: 'Late reply', createdAt: '2024-01-15T13:00:00.000Z', referencedTweets: [{ type: 'replied_to', id: '1' }] },
        { id: '2', text: 'Early reply', createdAt: '2024-01-15T11:00:00.000Z', referencedTweets: [{ type: 'replied_to', id: '1' }] }
      ];

      const tree = provider.buildReplyTree(thread);

      assert.equal(tree.roots[0].replies[0].id, '2'); // Earlier reply first
      assert.equal(tree.roots[0].replies[1].id, '3'); // Later reply second
    });
  });
});

describe('XApiError', () => {
  it('should create error with all properties', () => {
    const error = new XApiError('Test error', 404, 'NOT_FOUND', { extra: 'data' });

    assert.equal(error.message, 'Test error');
    assert.equal(error.name, 'XApiError');
    assert.equal(error.statusCode, 404);
    assert.equal(error.errorCode, 'NOT_FOUND');
    assert.deepEqual(error.details, { extra: 'data' });
  });

  it('should be instanceof Error', () => {
    const error = new XApiError('Test', 500);
    assert.ok(error instanceof Error);
    assert.ok(error instanceof XApiError);
  });
});
