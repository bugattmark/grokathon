/**
 * Simple in-memory cache with TTL support
 * Used to cache repeated requests in the beef generation pipeline
 */
export class Cache {
  constructor(defaultTtlMs = 5 * 60 * 1000) { // 5 minutes default
    this.cache = new Map();
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * Generate a cache key from request parameters
   * @param {string} prefix - Cache key prefix (e.g., 'storyline', 'video')
   * @param {Object} params - Parameters to hash
   * @returns {string} Cache key
   */
  static generateKey(prefix, params) {
    const paramStr = JSON.stringify(params, Object.keys(params).sort());
    // Simple hash for the key
    let hash = 0;
    for (let i = 0; i < paramStr.length; i++) {
      const char = paramStr.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `${prefix}:${hash}`;
  }

  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {*} Cached value or undefined
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Set a value in cache
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} ttlMs - Time to live in milliseconds (optional)
   */
  set(key, value, ttlMs = this.defaultTtlMs) {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
      createdAt: Date.now()
    });
  }

  /**
   * Get or compute a value, caching the result
   * @param {string} key - Cache key
   * @param {Function} computeFn - Async function to compute value if not cached
   * @param {number} ttlMs - Time to live in milliseconds (optional)
   * @returns {Promise<*>} Cached or computed value
   */
  async getOrCompute(key, computeFn, ttlMs = this.defaultTtlMs) {
    const cached = this.get(key);
    if (cached !== undefined) {
      console.log(`[Cache] HIT: ${key}`);
      return cached;
    }

    console.log(`[Cache] MISS: ${key}`);
    const value = await computeFn();
    this.set(key, value, ttlMs);
    return value;
  }

  /**
   * Clear all cached entries
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    let validCount = 0;
    let expiredCount = 0;
    const now = Date.now();

    for (const [, entry] of this.cache) {
      if (now > entry.expiresAt) {
        expiredCount++;
      } else {
        validCount++;
      }
    }

    return {
      total: this.cache.size,
      valid: validCount,
      expired: expiredCount
    };
  }

  /**
   * Clean up expired entries
   */
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

// Singleton instance for shared caching across the application
export const globalCache = new Cache();

export default Cache;
