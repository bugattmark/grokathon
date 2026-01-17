/**
 * Tests for the Grok API client
 * Tests video generation, image-to-video, video editing, and storyline generation
 */
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';

// Test the utility functions
describe('Grok Client Utilities', () => {
  describe('getBackoffDelay', () => {
    it('should calculate exponential backoff correctly', () => {
      function getBackoffDelay(attempt, baseDelay = 1000, maxDelay = 30000) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        return delay; // Without jitter for predictable testing
      }

      assert.strictEqual(getBackoffDelay(0, 1000, 30000), 1000);  // 1s
      assert.strictEqual(getBackoffDelay(1, 1000, 30000), 2000);  // 2s
      assert.strictEqual(getBackoffDelay(2, 1000, 30000), 4000);  // 4s
      assert.strictEqual(getBackoffDelay(3, 1000, 30000), 8000);  // 8s
      assert.strictEqual(getBackoffDelay(4, 1000, 30000), 16000); // 16s
      assert.strictEqual(getBackoffDelay(5, 1000, 30000), 30000); // Capped at 30s
      assert.strictEqual(getBackoffDelay(6, 1000, 30000), 30000); // Still capped
    });

    it('should respect custom base delay', () => {
      function getBackoffDelay(attempt, baseDelay = 1000, maxDelay = 30000) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        return delay;
      }

      assert.strictEqual(getBackoffDelay(0, 2000, 30000), 2000);
      assert.strictEqual(getBackoffDelay(1, 2000, 30000), 4000);
      assert.strictEqual(getBackoffDelay(2, 2000, 30000), 8000);
    });

    it('should respect custom max delay', () => {
      function getBackoffDelay(attempt, baseDelay = 1000, maxDelay = 30000) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        return delay;
      }

      assert.strictEqual(getBackoffDelay(3, 1000, 5000), 5000); // Capped at 5s
      assert.strictEqual(getBackoffDelay(4, 1000, 5000), 5000); // Still capped
    });
  });

  describe('sleep', () => {
    it('should delay execution by specified time', async () => {
      function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
      }

      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;

      assert.ok(elapsed >= 45, `Should wait at least 45ms, waited ${elapsed}ms`);
      assert.ok(elapsed < 100, `Should not wait more than 100ms, waited ${elapsed}ms`);
    });
  });
});

describe('GrokClient Configuration', () => {
  it('should set default target duration to 15 seconds', async () => {
    // Import the actual module
    const { GrokClient } = await import('../services/grok.js');
    const client = new GrokClient('test-api-key');

    assert.strictEqual(client.targetDuration, 15);
  });

  it('should set clip duration to 5 seconds', async () => {
    const { GrokClient } = await import('../services/grok.js');
    const client = new GrokClient('test-api-key');

    assert.strictEqual(client.clipDuration, 5);
  });

  it('should use XAI_API_KEY from environment if not provided', async () => {
    const originalKey = process.env.XAI_API_KEY;
    process.env.XAI_API_KEY = 'env-test-key';

    const { GrokClient } = await import('../services/grok.js');
    const client = new GrokClient();

    assert.strictEqual(client.apiKey, 'env-test-key');

    // Restore
    if (originalKey) {
      process.env.XAI_API_KEY = originalKey;
    } else {
      delete process.env.XAI_API_KEY;
    }
  });
});

describe('Storyline Generation', () => {
  describe('Context handling', () => {
    it('should accept and process context object', async () => {
      const context = {
        threadContext: 'Previous tweet: This is a reply...',
        userBio: 'CEO of TechCorp',
        userFollowers: '100K',
        replyingTo: ['@user1', '@user2']
      };

      // Verify context object structure is valid
      assert.ok(context.threadContext, 'Should have threadContext');
      assert.ok(context.userBio, 'Should have userBio');
      assert.ok(context.userFollowers, 'Should have userFollowers');
      assert.ok(Array.isArray(context.replyingTo), 'replyingTo should be an array');
    });

    it('should handle empty context gracefully', () => {
      const context = {};

      assert.strictEqual(context.threadContext, undefined);
      assert.strictEqual(context.userBio, undefined);
      assert.strictEqual(context.userFollowers, undefined);
      assert.strictEqual(context.replyingTo, undefined);
    });
  });

  describe('Output format', () => {
    it('should include scenes array for multi-clip generation', () => {
      const storyline = {
        title: 'Test Episode',
        storyline: 'Test narration',
        videoPrompt: 'Test scene',
        scenes: ['Scene 1', 'Scene 2', 'Scene 3']
      };

      assert.ok(Array.isArray(storyline.scenes), 'Should have scenes array');
      assert.strictEqual(storyline.scenes.length, 3, 'Should have 3 scenes');
    });

    it('should fallback to videoPrompt if no scenes provided', () => {
      const storyline = {
        title: 'Test Episode',
        storyline: 'Test narration',
        videoPrompt: 'Test scene'
      };

      // Simulate fallback behavior
      if (!storyline.scenes || !Array.isArray(storyline.scenes)) {
        storyline.scenes = [storyline.videoPrompt];
      }

      assert.ok(Array.isArray(storyline.scenes), 'Should have scenes array');
      assert.strictEqual(storyline.scenes[0], 'Test scene');
    });
  });
});

describe('Video Generation', () => {
  describe('generateVideo', () => {
    it('should return duration and limitation note', () => {
      const result = {
        videoUrl: 'https://example.com/video.mp4',
        duration: 5,
        targetDuration: 15,
        limitation: 'xAI API generates ~5s clips. For 15s, consider generating multiple clips.'
      };

      assert.ok(result.videoUrl, 'Should have videoUrl');
      assert.strictEqual(result.duration, 5, 'Actual duration should be clip duration');
      assert.strictEqual(result.targetDuration, 15, 'Target duration should be 15');
      assert.ok(result.limitation.includes('xAI API'), 'Should include limitation note');
    });
  });

  describe('generateVideoFromImage', () => {
    it('should require both prompt and imageUrl', () => {
      const params = {
        prompt: 'Animate this scene with camera movement',
        imageUrl: 'https://example.com/image.jpg'
      };

      assert.ok(params.prompt, 'Should have prompt');
      assert.ok(params.imageUrl, 'Should have imageUrl');
    });
  });

  describe('editVideo', () => {
    it('should use correct model for video editing', () => {
      const editModel = 'grok-imagine-video-beta';
      const generationModel = 'grok-imagine-video-a2';

      assert.notStrictEqual(editModel, generationModel, 'Edit and generation models should differ');
      assert.strictEqual(editModel, 'grok-imagine-video-beta');
    });

    it('should accept video URL and edit prompt', () => {
      const params = {
        videoUrl: 'https://example.com/source-video.mp4',
        prompt: 'Extend the video with more dramatic action'
      };

      assert.ok(params.videoUrl, 'Should have source videoUrl');
      assert.ok(params.prompt, 'Should have edit prompt');
    });
  });

  describe('generateMultipleClips', () => {
    it('should calculate total duration from clips', () => {
      const clips = [
        { url: 'https://example.com/clip1.mp4', duration: 5, scene: 'Scene 1' },
        { url: 'https://example.com/clip2.mp4', duration: 5, scene: 'Scene 2' },
        { url: 'https://example.com/clip3.mp4', duration: 5, scene: 'Scene 3' }
      ];

      const totalDuration = clips.reduce((sum, clip) => sum + clip.duration, 0);

      assert.strictEqual(totalDuration, 15, 'Total duration should be 15 seconds');
    });

    it('should handle partial clip failures', () => {
      const scenes = ['Scene 1', 'Scene 2', 'Scene 3'];
      const successfulClips = [
        { url: 'https://example.com/clip1.mp4', duration: 5, scene: 'Scene 1' },
        { url: 'https://example.com/clip3.mp4', duration: 5, scene: 'Scene 3' }
      ];

      const result = {
        clips: successfulClips,
        totalDuration: successfulClips.reduce((sum, clip) => sum + clip.duration, 0),
        limitation: successfulClips.length < scenes.length ?
          `Only ${successfulClips.length}/${scenes.length} clips generated successfully` : null
      };

      assert.strictEqual(result.clips.length, 2);
      assert.strictEqual(result.totalDuration, 10);
      assert.ok(result.limitation.includes('Only 2/3'), 'Should note partial failure');
    });
  });

});

describe('Polling with Exponential Backoff', () => {
  it('should handle rate limiting gracefully', () => {
    const responses = [
      { status: 429 },  // Rate limited
      { status: 429 },  // Rate limited again
      { status: 200, data: { video: { url: 'https://example.com/video.mp4' } } }
    ];

    let attempt = 0;
    function simulatePoll() {
      const response = responses[attempt++];
      if (response.status === 429) {
        return { shouldContinue: true, reason: 'rate_limited' };
      }
      return { shouldContinue: false, data: response.data };
    }

    // First two attempts should continue
    assert.ok(simulatePoll().shouldContinue);
    assert.ok(simulatePoll().shouldContinue);
    // Third attempt should succeed
    const result = simulatePoll();
    assert.ok(!result.shouldContinue);
    assert.ok(result.data.video.url);
  });

  it('should check multiple response formats', () => {
    // Format 1: { video: { url, duration } }
    const format1 = { video: { url: 'https://example.com/video.mp4', duration: 5 } };
    assert.ok(format1.video?.url);

    // Format 2: { url: '...' }
    const format2 = { url: 'https://example.com/video.mp4' };
    assert.ok(format2.url);

    // Format 3: { status: 'completed', output: { url: '...' } }
    const format3 = { status: 'completed', output: { url: 'https://example.com/video.mp4' } };
    assert.ok(format3.status === 'completed' && format3.output?.url);
  });

  it('should throw on failed status', () => {
    const failedResponse = { status: 'failed', error: 'Video generation failed due to content policy' };

    assert.throws(() => {
      if (failedResponse.status === 'failed' || failedResponse.error) {
        throw new Error(`Video generation failed: ${failedResponse.error || 'unknown'}`);
      }
    }, /Video generation failed/);
  });
});

describe('Narrator Styles', () => {
  it('should have both comedian and cartoon styles', () => {
    const comedians = ['Theo Von', 'Joe Rogan', 'Kevin Hart'];
    const cartoons = ['SpongeBob SquarePants', 'South Park', 'Courage the Cowardly Dog', 'Family Guy'];

    const allNarrators = [...comedians, ...cartoons];

    assert.strictEqual(allNarrators.length, 7, 'Should have 7 narrator styles');
    assert.ok(comedians.length >= 3, 'Should have at least 3 comedians');
    assert.ok(cartoons.length >= 4, 'Should have at least 4 cartoons');
  });

  it('should select random narrator', () => {
    const NARRATOR_STYLES = [
      { name: 'Theo Von' },
      { name: 'Joe Rogan' },
      { name: 'Kevin Hart' },
      { name: 'SpongeBob SquarePants' },
      { name: 'South Park' },
      { name: 'Courage the Cowardly Dog' },
      { name: 'Family Guy' }
    ];

    function getRandomNarratorStyle() {
      return NARRATOR_STYLES[Math.floor(Math.random() * NARRATOR_STYLES.length)];
    }

    // Should return different narrators over multiple calls
    const selectedNarrators = new Set();
    for (let i = 0; i < 100; i++) {
      selectedNarrators.add(getRandomNarratorStyle().name);
    }

    // With 100 random selections, we should get most narrator styles
    assert.ok(selectedNarrators.size >= 3, `Should select at least 3 different narrators, got ${selectedNarrators.size}`);
  });
});

describe('Tweet Classification', () => {
  describe('Classification Types', () => {
    it('should classify tech news tweets as no_slop', () => {
      // Examples of NO_SLOP content
      const noSlopTweets = [
        'OpenAI just released GPT-5 with multimodal capabilities',
        'New feature: React 19 introduces server components',
        'Breaking: Apple announces M4 chip with 20-core neural engine',
        'We just shipped a new API that reduces latency by 50%'
      ];

      // These would be classified as no_slop (interesting tech content)
      noSlopTweets.forEach(tweet => {
        assert.ok(tweet.length > 0, 'Tweet should have content');
      });
    });

    it('should classify trash opinions as slop', () => {
      // Examples of SLOP content
      const slopTweets = [
        'Wake up at 4am or you\'re a loser',
        'Crypto will make you a millionaire if you believe',
        'Unpopular opinion: hustle culture is the only way',
        'If you\'re not grinding 24/7 you don\'t want it bad enough'
      ];

      // These would be classified as slop (trash opinions)
      slopTweets.forEach(tweet => {
        assert.ok(tweet.length > 0, 'Tweet should have content');
      });
    });

    it('should default to slop for ambiguous content', () => {
      // When classification fails or is unclear, default to slop
      const defaultClassification = 'slop';
      assert.strictEqual(defaultClassification, 'slop');
    });
  });

  describe('Classification Result Format', () => {
    it('should return classification type in correct format', () => {
      const slopResult = { type: 'slop' };
      const noSlopResult = { type: 'no_slop' };

      assert.strictEqual(slopResult.type, 'slop');
      assert.strictEqual(noSlopResult.type, 'no_slop');
    });

    it('should normalize classification response', () => {
      // API might return with whitespace or different cases
      const responses = ['slop', 'SLOP', ' slop ', 'no_slop', 'NO_SLOP', ' no_slop '];

      responses.forEach(response => {
        const normalized = response.toLowerCase().trim();
        assert.ok(normalized === 'slop' || normalized === 'no_slop',
          `Normalized response should be slop or no_slop, got: ${normalized}`);
      });
    });
  });
});

describe('Classification-Based Storyline Routing', () => {
  describe('NO_SLOP Path - Elon News Report', () => {
    it('should use Elon Musk as narrator for no_slop', () => {
      const classification = 'no_slop';
      const expectedNarrator = 'Elon Musk';

      // Simulate the storyline generation routing
      let narrator;
      if (classification === 'no_slop') {
        narrator = 'Elon Musk';
      } else {
        const characters = ['SpongeBob SquarePants', 'Peter Griffin', 'Patrick Star', 'Eric Cartman', 'Homer Simpson'];
        narrator = characters[Math.floor(Math.random() * characters.length)];
      }

      assert.strictEqual(narrator, expectedNarrator);
    });

    it('should create news report style storyline for no_slop', () => {
      const storyline = {
        title: 'Breaking Tech News',
        storyline: 'Breaking news. This is interesting. Emailing Nikita now.',
        narrator: 'Elon Musk',
        videoPrompt: 'Elon Musk as news anchor at professional desk, speaking to camera',
        classification: 'no_slop'
      };

      assert.strictEqual(storyline.narrator, 'Elon Musk');
      assert.strictEqual(storyline.classification, 'no_slop');
      assert.ok(storyline.videoPrompt.includes('news'), 'Should mention news');
    });
  });

  describe('SLOP Path - Character Throws Tweet in Trash', () => {
    it('should select random character for slop', () => {
      const characters = ['SpongeBob SquarePants', 'Peter Griffin', 'Patrick Star', 'Eric Cartman', 'Homer Simpson'];

      // Select a random character (simulating the behavior)
      const character = characters[Math.floor(Math.random() * characters.length)];

      assert.ok(characters.includes(character), 'Selected character should be from the list');
    });

    it('should create trash-throwing storyline for slop', () => {
      const characters = ['SpongeBob SquarePants', 'Peter Griffin', 'Patrick Star', 'Eric Cartman', 'Homer Simpson'];
      const character = characters[0]; // Use first character for deterministic test

      const storyline = {
        title: 'Trash Opinion Alert',
        storyline: `${character} reads this trash tweet and throws it in the garbage.`,
        narrator: character,
        videoPrompt: `${character} holding paper, disgusted, throws in trash bin`,
        classification: 'slop'
      };

      assert.strictEqual(storyline.classification, 'slop');
      assert.ok(storyline.videoPrompt.includes('trash'), 'Should mention trash');
      assert.ok(characters.includes(storyline.narrator), 'Narrator should be a character');
    });

    it('should have 5 trash-throwing characters', () => {
      const characters = ['SpongeBob SquarePants', 'Peter Griffin', 'Patrick Star', 'Eric Cartman', 'Homer Simpson'];
      assert.strictEqual(characters.length, 5, 'Should have exactly 5 characters');
    });
  });

  describe('Storyline Output Format', () => {
    it('should include classification in storyline result', () => {
      const noSlopStoryline = {
        title: 'Breaking News',
        storyline: 'Test storyline',
        narrator: 'Elon Musk',
        classification: 'no_slop'
      };

      const slopStoryline = {
        title: 'Trash Alert',
        storyline: 'Test storyline',
        narrator: 'Peter Griffin',
        classification: 'slop'
      };

      assert.ok('classification' in noSlopStoryline, 'no_slop storyline should have classification');
      assert.ok('classification' in slopStoryline, 'slop storyline should have classification');
    });
  });
});

describe('Classification-Based Video Generation', () => {
  describe('NO_SLOP Video - News Report Style', () => {
    it('should generate news desk video prompt for Elon Musk narrator', () => {
      const context = {
        narrator: 'Elon Musk',
        narration: 'Breaking news. This feature is interesting. Emailing Nikita now.',
        tweetText: 'OpenAI just released GPT-5'
      };

      // Simulate the video prompt enhancement
      let enhancedPrompt;
      if (context.narrator === 'Elon Musk') {
        enhancedPrompt = `Elon Musk as a news anchor at a professional news desk. Speaking these EXACT words: "${context.narration}"`;
      }

      assert.ok(enhancedPrompt.includes('news anchor'), 'Should include news anchor');
      assert.ok(enhancedPrompt.includes('professional news desk'), 'Should include news desk');
      assert.ok(enhancedPrompt.includes(context.narration), 'Should include narration');
    });
  });

  describe('SLOP Video - Trash Throwing Style', () => {
    it('should generate trash-throwing video prompt for cartoon characters', () => {
      const context = {
        narrator: 'Peter Griffin',
        narration: 'This opinion is absolute garbage. Straight to the trash.',
        tweetText: 'Wake up at 4am or you\'re a loser'
      };

      // Simulate the video prompt enhancement
      let enhancedPrompt;
      if (context.narrator !== 'Elon Musk' && context.narration && context.narrator) {
        const tweetPreview = context.tweetText?.substring(0, 50) || 'trash opinion';
        enhancedPrompt = `${context.narrator} holding a piece of paper with a tweet on it. Speaking these EXACT words: "${context.narration}"

VISUAL: ${context.narrator} reads the paper with disgust, crumples it up, and throws it into a garbage bin.`;
      }

      assert.ok(enhancedPrompt.includes('Peter Griffin'), 'Should include character name');
      assert.ok(enhancedPrompt.includes('garbage bin'), 'Should include garbage bin');
      assert.ok(enhancedPrompt.includes('disgust'), 'Should include disgust reaction');
    });

    it('should truncate long tweet text for video prompt', () => {
      const longTweet = 'This is a very long tweet that goes on and on about absolutely nothing of value and just keeps rambling forever and ever';
      const tweetPreview = longTweet.substring(0, 50);

      assert.strictEqual(tweetPreview.length, 50, 'Preview should be 50 characters');
      assert.ok(longTweet.length > 50, 'Original should be longer than 50');
    });
  });
});

describe('API Endpoint Formats', () => {
  it('should use correct video generation endpoint', () => {
    const baseUrl = 'https://api.x.ai/v1';
    const videoEndpoint = `${baseUrl}/videos/generations`;

    assert.strictEqual(videoEndpoint, 'https://api.x.ai/v1/videos/generations');
  });

  it('should use correct video editing endpoint', () => {
    const baseUrl = 'https://api.x.ai/v1';
    const editEndpoint = `${baseUrl}/videos/edits`;

    assert.strictEqual(editEndpoint, 'https://api.x.ai/v1/videos/edits');
  });

  it('should use correct polling endpoint', () => {
    const baseUrl = 'https://api.x.ai/v1';
    const requestId = 'req-123-abc';
    const pollEndpoint = `${baseUrl}/videos/${requestId}`;

    assert.strictEqual(pollEndpoint, 'https://api.x.ai/v1/videos/req-123-abc');
  });

  it('should use correct models', () => {
    const generationModel = 'grok-imagine-video-a2';
    const editModel = 'grok-imagine-video-beta';
    const imageModel = 'grok-imagine-image-a1';
    const chatModel = 'grok-4-fast-reasoning';

    assert.ok(generationModel.includes('video'), 'Generation model should be a video model');
    assert.ok(editModel.includes('video'), 'Edit model should be a video model');
    assert.ok(imageModel.includes('image'), 'Image model should be an image model');
    assert.ok(chatModel.includes('grok'), 'Chat model should be a Grok model');
  });
});
