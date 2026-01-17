/**
 * Grok API Client
 * Handles storyline generation and video generation via xAI
 *
 * xAI Video API Reference:
 * - Video generation: POST /v1/videos/generations with model "grok-imagine-video-a2"
 * - Video editing: POST /v1/videos/edits with model "grok-imagine-video-beta"
 * - Image to Video: Use image_url parameter as starting point
 * - Polling: GET /v1/videos/{request_id}
 *
 * LIMITATION: The xAI video API does not currently support a duration parameter.
 * Videos are generated at a fixed duration (typically ~5-6 seconds per clip).
 * To achieve longer videos (15+ seconds), multiple clips must be generated and concatenated.
 */

// Narrator styles for randomized narration (comedians + cartoons)
const NARRATOR_STYLES = [
  // === COMEDIANS ===
  {
    name: 'Theo Von',
    style: `You are Theo Von narrating tech drama with your Louisiana storytelling style.
Use your signature phrases like "gang gang", "that's wild bruh", and rambling southern analogies.
Compare tech beefs to bizarre childhood stories from the bayou.
Be absurd, tangential, and weirdly poetic.`
  },
  {
    name: 'Joe Rogan',
    style: `You are Joe Rogan narrating tech drama like it's a wild podcast moment.
Use phrases like "Jamie, pull that up", "it's entirely possible", "that's CRAZY", and "have you ever tried DMT?".
Connect the tech beef to MMA, chimps, or conspiracy theories.
Be intense, fascinated, and go on tangents about how crazy the situation is.`
  },
  {
    name: 'Kevin Hart',
    style: `You are Kevin Hart narrating tech drama with high energy and physicality.
Use your signature style: yelling, exaggerated reactions, and self-deprecating humor.
React like everything is personally attacking you. Reference being short.
Be loud, animated, and turn the drama into a personal crisis.`
  },
  // === CARTOONS ===
  {
    name: 'SpongeBob SquarePants',
    style: `You are narrating tech drama in the style of SpongeBob SquarePants.
Use the French narrator's dramatic documentary voice: "Ahh, ze tech industry..."
Include SpongeBob's naive optimism, Patrick's dumb hot takes, and Squidward's bitter cynicism.
Reference Bikini Bottom, jellyfishing, and the Krusty Krab. Say "I'm ready!" at inappropriate moments.
Make it absurdly wholesome while completely missing the point of the drama.`
  },
  {
    name: 'South Park',
    style: `You are narrating tech drama in the brutal satirical style of South Park.
Nothing is sacred. Be crude, offensive, and mercilessly mock everyone involved.
Use Cartman's scheming sociopathy, Stan's "dude this is pretty f'd up" reactions, Kyle's moral outrage, and Kenny dying somehow.
Reference "Oh my god!", "You bastards!", and "I learned something today..."
Tear apart the hypocrisy with savage, equal-opportunity offensiveness.`
  },
  {
    name: 'Courage the Cowardly Dog',
    style: `You are narrating tech drama in the style of Courage the Cowardly Dog.
Frame EVERYTHING as existentially terrifying. The tech beef is a nightmarish horror unfolding.
Use Courage's anxious screaming energy: "AAAAAHHH!" and "The things I do for love!"
Include Eustace yelling "STUPID DOG!" at the situation. Muriel remains oblivious and kind.
Make the mundane tech drama feel like cosmic Lovecraftian horror in rural Kansas.`
  },
  {
    name: 'Family Guy',
    style: `You are narrating tech drama in the style of Family Guy.
Use constant cutaway gags: "This is worse than that time I..." followed by absurd scenarios.
Include Peter's confident stupidity, Brian's insufferable pretentiousness, and Stewie's theatrical villainy.
Make random pop culture references that barely connect. Break the fourth wall.
The drama should spiral into increasingly unrelated tangents and flashbacks.`
  }
];

function getRandomNarratorStyle() {
  const narrator = NARRATOR_STYLES[Math.floor(Math.random() * NARRATOR_STYLES.length)];
  console.log(`[Storyline] Using narrator style: ${narrator.name}`);
  return narrator;
}

/**
 * Sleep utility for exponential backoff
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 * @param {number} attempt - Current attempt number (0-indexed)
 * @param {number} baseDelay - Base delay in milliseconds
 * @param {number} maxDelay - Maximum delay cap in milliseconds
 */
function getBackoffDelay(attempt, baseDelay = 1000, maxDelay = 30000) {
  const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  // Add jitter (up to 20% of delay)
  const jitter = delay * 0.2 * Math.random();
  return Math.floor(delay + jitter);
}

export class GrokClient {
  constructor(apiKey) {
    this.apiKey = apiKey || process.env.XAI_API_KEY;
    this.baseUrl = 'https://api.x.ai/v1';
    // Video API not yet public - use demo mode for hackathon
    this.demoMode = process.env.DEMO_MODE === 'true';

    // Target duration for videos (in seconds)
    // NOTE: xAI API does not support duration parameter - each clip is ~5-6 seconds
    // For 15 seconds, we would need to generate ~3 clips and concatenate
    this.targetDuration = 15;
    this.clipDuration = 5; // Approximate duration per generated clip
  }

  /**
   * Generate a meme/satirical storyline for a beef tweet
   * Includes richer context from thread and user information
   *
   * @param {string} tweetText - The tweet content
   * @param {string} author - Tweet author handle
   * @param {Object} context - Optional additional context
   * @param {string} context.threadContext - Previous tweets in the thread
   * @param {string} context.userBio - Author's bio/description
   * @param {string} context.userFollowers - Follower count for context
   * @param {Array} context.replyingTo - Users being replied to
   */
  async generateStoryline(tweetText, author, context = {}) {
    console.log(`[Storyline] Input: author=${author}`);
    console.log(`[Storyline] Tweet: ${tweetText.substring(0, 100)}`);
    if (context.threadContext) {
      console.log(`[Storyline] Thread context provided: ${context.threadContext.substring(0, 100)}...`);
    }

    // Get random narrator style (comedian or cartoon)
    const narrator = getRandomNarratorStyle();

    // Build rich context for better storylines
    let contextBlock = '';
    if (context.threadContext) {
      contextBlock += `\n\nTHREAD CONTEXT (previous tweets in conversation):\n${context.threadContext}`;
    }
    if (context.userBio) {
      contextBlock += `\n\nABOUT @${author}: ${context.userBio}`;
    }
    if (context.userFollowers) {
      contextBlock += ` (${context.userFollowers} followers)`;
    }
    if (context.replyingTo && context.replyingTo.length > 0) {
      contextBlock += `\n\nREPLYING TO: ${context.replyingTo.join(', ')}`;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'grok-4-fast-reasoning',
        messages: [{
          role: 'system',
          content: `${narrator.style}

CRITICAL: Stay completely in character. Use their exact phrases, speech patterns, and comedic style. The output must be immediately recognizable as this character speaking.`
        }, {
          role: 'user',
          content: `Narrate this tweet AS ${narrator.name}. Stay 100% in character.

@${author}: "${tweetText}"${contextBlock}

Return JSON:
{
  "title": "Episode title in ${narrator.name}'s voice",
  "storyline": "2-3 sentences narration with ${narrator.name}'s signature phrases",
  "videoPrompt": "Visual scene description (1 sentence)",
  "scenes": ["Scene 1 description", "Scene 2 description", "Scene 3 description"]
}`
        }],
        temperature: 0.9
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Storyline generation failed: ${error}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    console.log(`[Storyline] Raw response length: ${content.length}`);

    // Parse JSON from response
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // Ensure scenes array exists for multi-clip generation
        if (!parsed.scenes || !Array.isArray(parsed.scenes)) {
          parsed.scenes = [parsed.videoPrompt];
        }
        return parsed;
      }
    } catch (e) {
      console.log('Failed to parse storyline JSON, using raw content');
    }

    // Fallback
    return {
      title: 'Tech Drama Unfolds',
      storyline: content,
      videoPrompt: 'Epic tech rivalry scene with dramatic lighting',
      scenes: ['Epic tech rivalry scene with dramatic lighting']
    };
  }

  /**
   * Generate video from prompt using grok-imagine-video-a2
   *
   * NOTE: xAI API does not support a duration parameter.
   * Each clip is approximately 5-6 seconds. To achieve longer videos,
   * we generate multiple clips that can be concatenated client-side.
   *
   * @param {string} prompt - Video description
   * @param {number} targetDuration - Target duration in seconds (default: 15)
   * @returns {Object} - { videoUrl, duration, clips, limitation }
   */
  async generateVideo(prompt, targetDuration = 15) {
    console.log(`[Video] Generating: ${prompt.substring(0, 80)}...`);
    console.log(`[Video] Target duration: ${targetDuration}s (note: API generates ~5-6s clips)`);

    // Submit video generation request
    const response = await fetch(`${this.baseUrl}/videos/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'grok-imagine-video-a2',
        prompt: prompt
        // NOTE: duration parameter not supported by xAI API as of current docs
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Video generation failed: ${error}`);
    }

    const data = await response.json();
    const requestId = data.request_id || data.id;
    console.log(`[Video] Request ID: ${requestId}`);

    // Poll for completion with exponential backoff
    const videoUrl = await this.pollVideoStatus(requestId);

    // Return with limitation note
    return {
      videoUrl,
      duration: this.clipDuration, // Actual duration per clip
      targetDuration,
      limitation: `xAI API generates ~${this.clipDuration}s clips. For ${targetDuration}s, consider generating multiple clips.`
    };
  }

  /**
   * Generate video from an image (Image-to-Video)
   * Creates more cohesive videos by using a generated thumbnail as the starting frame
   *
   * @param {string} prompt - Video description/motion prompt
   * @param {string} imageUrl - URL of the starting image
   * @returns {Object} - { videoUrl, duration }
   */
  async generateVideoFromImage(prompt, imageUrl) {
    console.log(`[Video] Generating from image: ${imageUrl.substring(0, 50)}...`);
    console.log(`[Video] Motion prompt: ${prompt.substring(0, 80)}...`);

    const response = await fetch(`${this.baseUrl}/videos/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'grok-imagine-video-a2',
        prompt: prompt,
        image_url: imageUrl
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Image-to-video generation failed: ${error}`);
    }

    const data = await response.json();
    const requestId = data.request_id || data.id;
    console.log(`[Video] Request ID: ${requestId}`);

    // Poll for completion with exponential backoff
    const videoUrl = await this.pollVideoStatus(requestId);
    return { videoUrl, duration: this.clipDuration };
  }

  /**
   * Edit/extend an existing video using grok-imagine-video-beta
   * Can be used to extend videos or modify them
   *
   * @param {string} videoUrl - URL of the source video to edit
   * @param {string} prompt - Edit instructions or continuation prompt
   * @returns {Object} - { videoUrl, duration }
   */
  async editVideo(videoUrl, prompt) {
    console.log(`[Video Edit] Source: ${videoUrl.substring(0, 50)}...`);
    console.log(`[Video Edit] Prompt: ${prompt.substring(0, 80)}...`);

    const response = await fetch(`${this.baseUrl}/videos/edits`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'grok-imagine-video-beta',
        video_url: videoUrl,
        prompt: prompt
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Video editing failed: ${error}`);
    }

    const data = await response.json();
    const requestId = data.request_id || data.id;
    console.log(`[Video Edit] Request ID: ${requestId}`);

    // Poll for completion with exponential backoff
    const resultUrl = await this.pollVideoStatus(requestId);
    return { videoUrl: resultUrl, duration: this.clipDuration };
  }

  /**
   * Generate multiple video clips for longer duration
   * Since xAI API doesn't support duration parameter, we generate multiple clips
   *
   * @param {Array<string>} scenes - Array of scene prompts
   * @param {string} baseImageUrl - Optional starting image for consistency
   * @returns {Object} - { clips: Array<{url, duration}>, totalDuration }
   */
  async generateMultipleClips(scenes, baseImageUrl = null) {
    console.log(`[Video] Generating ${scenes.length} clips for longer video`);

    const clips = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      console.log(`[Video] Generating clip ${i + 1}/${scenes.length}: ${scene.substring(0, 50)}...`);

      try {
        let result;
        if (i === 0 && baseImageUrl) {
          // First clip: use image-to-video for consistency
          result = await this.generateVideoFromImage(scene, baseImageUrl);
        } else {
          result = await this.generateVideo(scene, this.clipDuration);
        }

        clips.push({
          url: result.videoUrl,
          duration: result.duration,
          scene: scene
        });
      } catch (error) {
        console.error(`[Video] Clip ${i + 1} failed:`, error.message);
        // Continue with remaining clips
      }
    }

    const totalDuration = clips.reduce((sum, clip) => sum + clip.duration, 0);
    console.log(`[Video] Generated ${clips.length} clips, total duration: ${totalDuration}s`);

    return {
      clips,
      totalDuration,
      limitation: clips.length < scenes.length ?
        `Only ${clips.length}/${scenes.length} clips generated successfully` : null
    };
  }

  /**
   * Poll video generation status until complete
   * Uses exponential backoff to reduce API load and handle rate limits
   *
   * @param {string} requestId - The video generation request ID
   * @param {number} maxAttempts - Maximum polling attempts (default: 60)
   * @returns {string} - The completed video URL
   */
  async pollVideoStatus(requestId, maxAttempts = 60) {
    console.log(`[Video] Polling for request: ${requestId}`);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Exponential backoff: starts at 2s, maxes at 30s
      const delay = getBackoffDelay(attempt, 2000, 30000);
      console.log(`[Video] Poll ${attempt + 1}: waiting ${delay}ms before next check`);
      await sleep(delay);

      try {
        const response = await fetch(`${this.baseUrl}/videos/${requestId}`, {
          headers: { 'Authorization': `Bearer ${this.apiKey}` }
        });

        if (!response.ok) {
          // Handle rate limits gracefully
          if (response.status === 429) {
            console.log(`[Video] Rate limited, backing off...`);
            continue;
          }
          console.log(`[Video] Poll ${attempt + 1}: HTTP ${response.status}`);
          continue;
        }

        const data = await response.json();
        console.log(`[Video] Poll ${attempt + 1}:`, JSON.stringify(data).substring(0, 200));

        // Check for completed video - response format: { video: { url, duration } }
        if (data.video?.url) {
          console.log(`[Video] Complete! URL: ${data.video.url}`);
          return data.video.url;
        }

        // Also check for direct url field
        if (data.url) {
          console.log(`[Video] Complete! URL: ${data.url}`);
          return data.url;
        }

        // Check status field
        if (data.status === 'completed' && data.output?.url) {
          console.log(`[Video] Complete! URL: ${data.output.url}`);
          return data.output.url;
        }

        if (data.status === 'failed' || data.error) {
          throw new Error(`Video generation failed: ${data.error || data.message || 'unknown'}`);
        }

        // Log progress if available
        if (data.progress !== undefined) {
          console.log(`[Video] Progress: ${Math.round(data.progress * 100)}%`);
        }
      } catch (error) {
        if (error.message.includes('Video generation failed')) {
          throw error;
        }
        console.log(`[Video] Poll ${attempt + 1} error:`, error.message);
        // Continue polling on transient errors
      }
    }
    throw new Error('Video generation timeout after maximum polling attempts');
  }

  /**
   * Generate thumbnail image using Grok image model
   * @param {string} prompt - Image description
   */
  async generateThumbnail(prompt) {
    try {
      const response = await fetch(`${this.baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'grok-imagine-image-a1',
          prompt: prompt,
          n: 1,
          response_format: 'url'
        })
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`Thumbnail generation failed: ${error}`);
        // Fallback to placeholder
        return { thumbnailUrl: null, isDemo: true };
      }

      const data = await response.json();
      return {
        thumbnailUrl: data.data?.[0]?.url
      };
    } catch (error) {
      console.error('Thumbnail error:', error);
      return { thumbnailUrl: null, isDemo: true };
    }
  }

  /**
   * Generate cohesive video content using thumbnail-first approach
   * 1. Generate thumbnail image
   * 2. Use thumbnail as starting frame for image-to-video
   * This creates more visually consistent videos
   *
   * @param {string} scenePrompt - Scene description
   * @param {string} thumbnailPrompt - Thumbnail/starting frame description
   * @returns {Object} - { videoUrl, thumbnailUrl, duration }
   */
  async generateCohesiveVideo(scenePrompt, thumbnailPrompt) {
    console.log(`[Video] Generating cohesive video with thumbnail-first approach`);

    // Step 1: Generate thumbnail
    const thumbnail = await this.generateThumbnail(thumbnailPrompt);

    if (!thumbnail.thumbnailUrl) {
      console.log(`[Video] Thumbnail failed, falling back to direct video generation`);
      const video = await this.generateVideo(scenePrompt);
      return {
        videoUrl: video.videoUrl,
        thumbnailUrl: null,
        duration: video.duration
      };
    }

    console.log(`[Video] Thumbnail generated: ${thumbnail.thumbnailUrl.substring(0, 50)}...`);

    // Step 2: Use thumbnail as starting frame for video
    try {
      const video = await this.generateVideoFromImage(scenePrompt, thumbnail.thumbnailUrl);
      return {
        videoUrl: video.videoUrl,
        thumbnailUrl: thumbnail.thumbnailUrl,
        duration: video.duration
      };
    } catch (error) {
      console.log(`[Video] Image-to-video failed, falling back to direct video:`, error.message);
      const video = await this.generateVideo(scenePrompt);
      return {
        videoUrl: video.videoUrl,
        thumbnailUrl: thumbnail.thumbnailUrl,
        duration: video.duration
      };
    }
  }
}

export default GrokClient;
