/**
 * Tests for the Cache utility
 */
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { Cache } from '../services/cache.js';

describe('Cache', () => {
  let cache;

  beforeEach(() => {
    cache = new Cache(1000); // 1 second TTL for testing
  });

  describe('generateKey', () => {
    it('should generate consistent keys for same parameters', () => {
      const key1 = Cache.generateKey('test', { a: 1, b: 2 });
      const key2 = Cache.generateKey('test', { a: 1, b: 2 });
      assert.strictEqual(key1, key2);
    });

    it('should generate consistent keys regardless of parameter order', () => {
      const key1 = Cache.generateKey('test', { a: 1, b: 2 });
      const key2 = Cache.generateKey('test', { b: 2, a: 1 });
      assert.strictEqual(key1, key2);
    });

    it('should generate different keys for different parameters', () => {
      const key1 = Cache.generateKey('test', { a: 1 });
      const key2 = Cache.generateKey('test', { a: 2 });
      assert.notStrictEqual(key1, key2);
    });

    it('should generate different keys for different prefixes', () => {
      const key1 = Cache.generateKey('test1', { a: 1 });
      const key2 = Cache.generateKey('test2', { a: 1 });
      assert.notStrictEqual(key1, key2);
    });
  });

  describe('get and set', () => {
    it('should return undefined for non-existent keys', () => {
      const result = cache.get('nonexistent');
      assert.strictEqual(result, undefined);
    });

    it('should store and retrieve values', () => {
      cache.set('key1', { data: 'test' });
      const result = cache.get('key1');
      assert.deepStrictEqual(result, { data: 'test' });
    });

    it('should return undefined for expired entries', async () => {
      cache.set('key1', 'value', 50); // 50ms TTL

      // Value should exist immediately
      assert.strictEqual(cache.get('key1'), 'value');

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 100));

      // Value should be expired
      assert.strictEqual(cache.get('key1'), undefined);
    });

    it('should use custom TTL when provided', async () => {
      cache.set('key1', 'value', 200); // 200ms TTL

      // Value should exist after 100ms
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.strictEqual(cache.get('key1'), 'value');

      // Value should be expired after 250ms total
      await new Promise(resolve => setTimeout(resolve, 150));
      assert.strictEqual(cache.get('key1'), undefined);
    });
  });

  describe('getOrCompute', () => {
    it('should compute and cache value on miss', async () => {
      let computeCount = 0;
      const computeFn = async () => {
        computeCount++;
        return 'computed';
      };

      const result = await cache.getOrCompute('key1', computeFn);
      assert.strictEqual(result, 'computed');
      assert.strictEqual(computeCount, 1);
    });

    it('should return cached value on hit', async () => {
      let computeCount = 0;
      const computeFn = async () => {
        computeCount++;
        return 'computed';
      };

      // First call - cache miss
      await cache.getOrCompute('key1', computeFn);
      assert.strictEqual(computeCount, 1);

      // Second call - cache hit
      const result = await cache.getOrCompute('key1', computeFn);
      assert.strictEqual(result, 'computed');
      assert.strictEqual(computeCount, 1); // Should not have called computeFn again
    });

    it('should recompute after TTL expires', async () => {
      let computeCount = 0;
      const computeFn = async () => {
        computeCount++;
        return `computed-${computeCount}`;
      };

      // First call
      const result1 = await cache.getOrCompute('key1', computeFn, 50);
      assert.strictEqual(result1, 'computed-1');

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 100));

      // Second call - should recompute
      const result2 = await cache.getOrCompute('key1', computeFn, 50);
      assert.strictEqual(result2, 'computed-2');
      assert.strictEqual(computeCount, 2);
    });

    it('should propagate errors from computeFn', async () => {
      const computeFn = async () => {
        throw new Error('Compute failed');
      };

      await assert.rejects(
        () => cache.getOrCompute('key1', computeFn),
        { message: 'Compute failed' }
      );
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      cache.clear();

      assert.strictEqual(cache.get('key1'), undefined);
      assert.strictEqual(cache.get('key2'), undefined);
    });
  });

  describe('getStats', () => {
    it('should return correct stats for empty cache', () => {
      const stats = cache.getStats();
      assert.deepStrictEqual(stats, { total: 0, valid: 0, expired: 0 });
    });

    it('should count valid entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      const stats = cache.getStats();
      assert.strictEqual(stats.total, 2);
      assert.strictEqual(stats.valid, 2);
      assert.strictEqual(stats.expired, 0);
    });

    it('should count expired entries', async () => {
      cache.set('key1', 'value1', 50); // expires quickly
      cache.set('key2', 'value2', 10000); // doesn't expire

      await new Promise(resolve => setTimeout(resolve, 100));

      const stats = cache.getStats();
      assert.strictEqual(stats.total, 2);
      assert.strictEqual(stats.valid, 1);
      assert.strictEqual(stats.expired, 1);
    });
  });

  describe('cleanup', () => {
    it('should remove only expired entries', async () => {
      cache.set('key1', 'value1', 50); // expires quickly
      cache.set('key2', 'value2', 10000); // doesn't expire

      await new Promise(resolve => setTimeout(resolve, 100));

      cache.cleanup();

      assert.strictEqual(cache.get('key1'), undefined);
      assert.strictEqual(cache.get('key2'), 'value2');

      const stats = cache.getStats();
      assert.strictEqual(stats.total, 1);
    });
  });
});
