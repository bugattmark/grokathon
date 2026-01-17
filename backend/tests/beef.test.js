/**
 * Tests for the beef generation pipeline
 * Tests parallelization, caching, and timing functionality
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { Cache, globalCache } from '../services/cache.js';

describe('Beef Generation Pipeline', () => {
  describe('Parallelization Logic', () => {
    it('should run independent operations in parallel', async () => {
      const startTimes = [];
      const endTimes = [];

      const operation1 = async () => {
        startTimes.push({ op: 'op1', time: Date.now() });
        await new Promise(r => setTimeout(r, 50));
        endTimes.push({ op: 'op1', time: Date.now() });
        return 'result1';
      };

      const operation2 = async () => {
        startTimes.push({ op: 'op2', time: Date.now() });
        await new Promise(r => setTimeout(r, 50));
        endTimes.push({ op: 'op2', time: Date.now() });
        return 'result2';
      };

      const startTime = Date.now();
      const [result1, result2] = await Promise.all([operation1(), operation2()]);
      const totalTime = Date.now() - startTime;

      assert.strictEqual(result1, 'result1');
      assert.strictEqual(result2, 'result2');

      // Both operations should have started within 10ms of each other
      const op1Start = startTimes.find(s => s.op === 'op1').time;
      const op2Start = startTimes.find(s => s.op === 'op2').time;
      const startDiff = Math.abs(op1Start - op2Start);

      assert.ok(startDiff < 20, `Operations should start in parallel, but started ${startDiff}ms apart`);

      // Total time should be close to 50ms (parallel), not 100ms (sequential)
      assert.ok(totalTime < 100, `Parallel execution should take ~50ms, took ${totalTime}ms`);
    });

    it('should handle partial failures with Promise.allSettled', async () => {
      const successOp = async () => {
        await new Promise(r => setTimeout(r, 10));
        return 'success';
      };

      const failOp = async () => {
        await new Promise(r => setTimeout(r, 10));
        throw new Error('Simulated failure');
      };

      const [successResult, failResult] = await Promise.allSettled([successOp(), failOp()]);

      assert.strictEqual(successResult.status, 'fulfilled');
      assert.strictEqual(successResult.value, 'success');
      assert.strictEqual(failResult.status, 'rejected');
      assert.strictEqual(failResult.reason.message, 'Simulated failure');
    });

    it('should continue processing when optional operations fail', async () => {
      const requiredOp = async () => ({ data: 'required' });
      const optionalOp = async () => { throw new Error('Optional failed'); };

      const [required, optional] = await Promise.allSettled([requiredOp(), optionalOp()]);

      const result = {
        required: required.status === 'fulfilled' ? required.value : null,
        optional: optional.status === 'fulfilled' ? optional.value : null
      };

      assert.deepStrictEqual(result.required, { data: 'required' });
      assert.strictEqual(result.optional, null);
    });
  });

  describe('Timer Utility', () => {
    // Timer class matching our implementation
    class Timer {
      constructor(requestId) {
        this.requestId = requestId;
        this.startTime = Date.now();
        this.marks = new Map();
      }

      start(label) {
        this.marks.set(label, { start: Date.now() });
      }

      end(label) {
        const mark = this.marks.get(label);
        if (mark) {
          mark.end = Date.now();
          mark.duration = mark.end - mark.start;
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
    }

    it('should correctly track sequential operation timings', async () => {
      const timer = new Timer('test-123');

      timer.start('operation1');
      await new Promise(r => setTimeout(r, 50));
      timer.end('operation1');

      timer.start('operation2');
      await new Promise(r => setTimeout(r, 30));
      timer.end('operation2');

      const timings = timer.getTimings();

      assert.ok(timings.operation1 >= 45, `operation1 should be ~50ms, got ${timings.operation1}ms`);
      assert.ok(timings.operation2 >= 25, `operation2 should be ~30ms, got ${timings.operation2}ms`);
      assert.ok(timings.total >= 75, `total should be ~80ms, got ${timings.total}ms`);
    });

    it('should track parallel operations independently', async () => {
      const timer = new Timer('test-456');

      timer.start('parallel_group');

      const op1 = (async () => {
        timer.start('op1');
        await new Promise(r => setTimeout(r, 50));
        timer.end('op1');
      })();

      const op2 = (async () => {
        timer.start('op2');
        await new Promise(r => setTimeout(r, 30));
        timer.end('op2');
      })();

      await Promise.all([op1, op2]);
      timer.end('parallel_group');

      const timings = timer.getTimings();

      // Each individual operation should have its own timing
      assert.ok(timings.op1 >= 45, `op1 should be ~50ms, got ${timings.op1}ms`);
      assert.ok(timings.op2 >= 25, `op2 should be ~30ms, got ${timings.op2}ms`);

      // The parallel group should be close to the longest operation
      assert.ok(timings.parallel_group >= 45, `parallel_group should be ~50ms`);
      assert.ok(timings.parallel_group < 100, `parallel_group should be parallel, not sequential`);
    });

    it('should handle missing end calls gracefully', () => {
      const timer = new Timer('test-789');

      timer.start('operation1');
      // Never call timer.end('operation1')

      const timings = timer.getTimings();

      // operation1 should not appear in timings since it was never ended
      assert.strictEqual(timings.operation1, undefined);
      assert.ok(timings.total >= 0);
    });
  });

  describe('Caching with Parallelization', () => {
    beforeEach(() => {
      globalCache.clear();
    });

    it('should cache results from parallel operations', async () => {
      let op1CallCount = 0;
      let op2CallCount = 0;

      const op1 = async () => {
        op1CallCount++;
        await new Promise(r => setTimeout(r, 10));
        return 'result1';
      };

      const op2 = async () => {
        op2CallCount++;
        await new Promise(r => setTimeout(r, 10));
        return 'result2';
      };

      // First batch - both should be computed
      const [result1a, result2a] = await Promise.all([
        globalCache.getOrCompute('key1', op1, 60000),
        globalCache.getOrCompute('key2', op2, 60000)
      ]);

      assert.strictEqual(result1a, 'result1');
      assert.strictEqual(result2a, 'result2');
      assert.strictEqual(op1CallCount, 1);
      assert.strictEqual(op2CallCount, 1);

      // Second batch - both should be cached
      const [result1b, result2b] = await Promise.all([
        globalCache.getOrCompute('key1', op1, 60000),
        globalCache.getOrCompute('key2', op2, 60000)
      ]);

      assert.strictEqual(result1b, 'result1');
      assert.strictEqual(result2b, 'result2');
      assert.strictEqual(op1CallCount, 1); // Should still be 1
      assert.strictEqual(op2CallCount, 1); // Should still be 1
    });

    it('should handle cache miss during parallel operations', async () => {
      let callCount = 0;

      const compute = async (key) => {
        callCount++;
        return `value-${key}`;
      };

      // Run 3 different operations in parallel
      const results = await Promise.all([
        globalCache.getOrCompute('a', () => compute('a'), 60000),
        globalCache.getOrCompute('b', () => compute('b'), 60000),
        globalCache.getOrCompute('c', () => compute('c'), 60000)
      ]);

      assert.deepStrictEqual(results, ['value-a', 'value-b', 'value-c']);
      assert.strictEqual(callCount, 3);
    });

    it('should isolate failures between cached operations', async () => {
      const successOp = async () => 'success';
      const failOp = async () => { throw new Error('Failed'); };

      // Run success and fail in parallel with caching
      const results = await Promise.allSettled([
        globalCache.getOrCompute('success-key', successOp, 60000),
        globalCache.getOrCompute('fail-key', failOp, 60000)
      ]);

      assert.strictEqual(results[0].status, 'fulfilled');
      assert.strictEqual(results[0].value, 'success');
      assert.strictEqual(results[1].status, 'rejected');

      // Success should be cached
      const cachedSuccess = globalCache.get('success-key');
      assert.strictEqual(cachedSuccess, 'success');

      // Failure should not be cached
      const cachedFail = globalCache.get('fail-key');
      assert.strictEqual(cachedFail, undefined);
    });
  });

  describe('Batch Processing', () => {
    it('should process multiple items in parallel with Promise.all', async () => {
      const items = ['a', 'b', 'c', 'd', 'e'];
      const processedOrder = [];

      const processItem = async (item) => {
        processedOrder.push({ item, start: Date.now() });
        await new Promise(r => setTimeout(r, 20));
        return `processed-${item}`;
      };

      const startTime = Date.now();
      const results = await Promise.all(items.map(processItem));
      const totalTime = Date.now() - startTime;

      assert.strictEqual(results.length, 5);
      assert.deepStrictEqual(results, ['processed-a', 'processed-b', 'processed-c', 'processed-d', 'processed-e']);

      // Should complete in ~20ms (parallel), not ~100ms (sequential)
      assert.ok(totalTime < 80, `Batch should process in parallel, took ${totalTime}ms`);
    });

    it('should handle mixed success/failure in batch with Promise.allSettled', async () => {
      const items = [1, 2, 3, 4, 5];

      const processItem = async (item) => {
        if (item % 2 === 0) {
          throw new Error(`Item ${item} failed`);
        }
        return `success-${item}`;
      };

      const results = await Promise.allSettled(items.map(processItem));

      const successful = results.filter(r => r.status === 'fulfilled');
      const failed = results.filter(r => r.status === 'rejected');

      assert.strictEqual(successful.length, 3); // 1, 3, 5
      assert.strictEqual(failed.length, 2); // 2, 4
    });

    it('should limit batch size for resource protection', () => {
      const MAX_BATCH_SIZE = 5;
      const items = Array.from({ length: 10 }, (_, i) => i);

      const batchSize = items.length;
      const isWithinLimit = batchSize <= MAX_BATCH_SIZE;

      assert.strictEqual(isWithinLimit, false);

      // Simulating batch limiting
      const limitedBatch = items.slice(0, MAX_BATCH_SIZE);
      assert.strictEqual(limitedBatch.length, MAX_BATCH_SIZE);
    });
  });

  describe('Request ID Generation', () => {
    function generateRequestId() {
      return `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    }

    it('should generate unique request IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateRequestId());
      }

      assert.strictEqual(ids.size, 100, 'All generated IDs should be unique');
    });

    it('should follow expected format', () => {
      const id = generateRequestId();
      const pattern = /^req-\d+-[a-z0-9]{6}$/;

      assert.ok(pattern.test(id), `ID "${id}" should match pattern req-{timestamp}-{random}`);
    });
  });

  describe('Pipeline Phase Dependencies', () => {
    it('should correctly sequence dependent phases', async () => {
      const executionOrder = [];

      // Phase 1: Storyline generation (required first)
      const generateStoryline = async () => {
        executionOrder.push('storyline-start');
        await new Promise(r => setTimeout(r, 20));
        executionOrder.push('storyline-end');
        return { videoPrompt: 'test prompt', storyline: 'test storyline' };
      };

      // Phase 2: Video generation (depends on storyline)
      const generateVideo = async (prompt) => {
        executionOrder.push('video-start');
        await new Promise(r => setTimeout(r, 30));
        executionOrder.push('video-end');
        return { videoUrl: 'https://example.com/video.mp4' };
      };

      // Execute pipeline
      const storyline = await generateStoryline();
      await generateVideo(storyline.videoPrompt);

      // Verify storyline completed before video started
      const storylineEndIndex = executionOrder.indexOf('storyline-end');
      const videoStartIndex = executionOrder.indexOf('video-start');

      assert.ok(storylineEndIndex < videoStartIndex, 'Storyline should end before video starts');
    });

    it('should handle storyline failure gracefully', async () => {
      const generateStoryline = async () => {
        throw new Error('Storyline generation failed');
      };

      const generateVideo = async () => ({ videoUrl: 'https://example.com/video.mp4' });

      let storyline = null;
      let videoGenerated = false;

      try {
        storyline = await generateStoryline();
        // Should not reach here
        await generateVideo(storyline.videoPrompt);
        videoGenerated = true;
      } catch (error) {
        // Expected to catch here
        assert.strictEqual(error.message, 'Storyline generation failed');
      }

      assert.strictEqual(storyline, null);
      assert.strictEqual(videoGenerated, false);
    });
  });

  describe('User Context Endpoint Logic', () => {
    it('should clean @ prefix from username', () => {
      const cleanUsername = (username) => username.replace(/^@/, '');

      assert.strictEqual(cleanUsername('@elonmusk'), 'elonmusk');
      assert.strictEqual(cleanUsername('elonmusk'), 'elonmusk');
      assert.strictEqual(cleanUsername('@@double'), '@double'); // Only removes first @
    });

    it('should parse lightweight query param correctly', () => {
      const isLightweight = (param) => param === 'true' || param === true;

      assert.strictEqual(isLightweight('true'), true);
      assert.strictEqual(isLightweight(true), true);
      assert.strictEqual(isLightweight('false'), false);
      assert.strictEqual(isLightweight(false), false);
      assert.strictEqual(isLightweight(undefined), false);
      assert.strictEqual(isLightweight(''), false);
    });

    it('should parse tweetCount with defaults', () => {
      // The endpoint parses tweetCount and passes to service which enforces bounds
      const parseTweetCount = (input) => {
        const count = parseInt(input, 10);
        // NaN from parseInt returns false on truthiness, default to 50
        return isNaN(count) ? 50 : count;
      };

      // Default when invalid
      assert.strictEqual(parseTweetCount(undefined), 50);
      assert.strictEqual(parseTweetCount('invalid'), 50);

      // Normal values
      assert.strictEqual(parseTweetCount('25'), 25);
      assert.strictEqual(parseTweetCount('30'), 30);

      // Service will enforce bounds, not the endpoint parser
      assert.strictEqual(parseTweetCount('1'), 1);
      assert.strictEqual(parseTweetCount('200'), 200);
    });

    it('should validate batch usernames array', () => {
      const validateUsernames = (usernames) => {
        if (!Array.isArray(usernames) || usernames.length === 0) {
          return { valid: false, error: 'usernames array is required' };
        }
        const MAX_BATCH_SIZE = 5;
        if (usernames.length > MAX_BATCH_SIZE) {
          return { valid: false, error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}` };
        }
        return { valid: true };
      };

      // Invalid cases
      assert.deepStrictEqual(
        validateUsernames(null),
        { valid: false, error: 'usernames array is required' }
      );
      assert.deepStrictEqual(
        validateUsernames([]),
        { valid: false, error: 'usernames array is required' }
      );
      assert.deepStrictEqual(
        validateUsernames('notanarray'),
        { valid: false, error: 'usernames array is required' }
      );

      // Exceeds limit
      assert.deepStrictEqual(
        validateUsernames(['a', 'b', 'c', 'd', 'e', 'f']),
        { valid: false, error: 'Batch size exceeds maximum of 5' }
      );

      // Valid cases
      assert.deepStrictEqual(validateUsernames(['user1']), { valid: true });
      assert.deepStrictEqual(validateUsernames(['a', 'b', 'c', 'd', 'e']), { valid: true });
    });

    it('should generate cache keys that vary by parameters', () => {
      // Simulating Cache.generateKey behavior
      const generateKey = (type, params) => {
        const sortedParams = Object.keys(params).sort().map(k => `${k}:${params[k]}`).join('|');
        return `${type}:${sortedParams}`;
      };

      const key1 = generateKey('user_context', { username: 'user1', tweetCount: 50, lightweight: false });
      const key2 = generateKey('user_context', { username: 'user1', tweetCount: 50, lightweight: true });
      const key3 = generateKey('user_context', { username: 'user2', tweetCount: 50, lightweight: false });
      const key4 = generateKey('user_context', { username: 'user1', tweetCount: 25, lightweight: false });

      // All keys should be unique
      const keys = [key1, key2, key3, key4];
      const uniqueKeys = new Set(keys);
      assert.strictEqual(uniqueKeys.size, 4, 'All cache keys should be unique');
    });

    it('should count successes and failures in batch results', () => {
      const contexts = {
        user1: { user: { username: 'user1' }, context: { summary: 'Active user' } },
        user2: { error: 'User not found', errorCode: 'NOT_FOUND', user: { username: 'user2' } },
        user3: { user: { username: 'user3' }, context: { summary: 'Another active user' } },
        user4: { error: 'Rate limited', errorCode: 'RATE_LIMITED', user: { username: 'user4' } }
      };

      const results = Object.entries(contexts);
      const successful = results.filter(([_, ctx]) => !ctx.error).length;
      const failed = results.filter(([_, ctx]) => ctx.error).length;

      assert.strictEqual(successful, 2);
      assert.strictEqual(failed, 2);
    });
  });
});
