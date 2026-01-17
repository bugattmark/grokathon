/**
 * Grok API Client
 * Handles storyline generation and video generation via xAI
 *
 * xAI Video API Reference:
 * - Video generation: POST /v1/videos/generations with model "grok-imagine-video-a2"
 * - Video editing: POST /v1/videos/edits with model "grok-imagine-video-beta"
 * - Image to Video: Use image_url parameter as starting point
 * - Polling: GET /v1/videos/{request_id}
 * - Duration: Use duration parameter to control video length (e.g., 15 seconds)
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
 * Uses 1.5x multiplier for faster polling (5 polls in ~13s vs 60s with 2x)
 * @param {number} attempt - Current attempt number (0-indexed)
 * @param {number} baseDelay - Base delay in milliseconds (default: 1000)
 * @param {number} maxDelay - Maximum delay cap in milliseconds (default: 10000)
 */
function getBackoffDelay(attempt, baseDelay = 1000, maxDelay = 10000) {
  const delay = Math.min(baseDelay * Math.pow(1.5, attempt), maxDelay);
  // Add jitter (up to 10% of delay)
  const jitter = delay * 0.1 * Math.random();
  return Math.floor(delay + jitter);
}

export class GrokClient {
  constructor(apiKey) {
    this.apiKey = apiKey || process.env.XAI_API_KEY;
    this.baseUrl = 'https://api.x.ai/v1';
    // Video API not yet public - use demo mode for hackathon
    this.demoMode = process.env.DEMO_MODE === 'true';

    // Default duration for videos (in seconds)
    this.defaultDuration = 15;
  }

  /**
   * Classify a tweet as "slop" (trash opinions) or "no_slop" (interesting tech content)
   * Used to route tweets to different video generation paths
   *
   * @param {string} tweetText - The tweet content to classify
   * @returns {Object} - { type: 'slop' | 'no_slop' }
   */
  async classifyTweet(tweetText) {
    console.log(`[Classify] Classifying tweet: ${tweetText.substring(0, 80)}...`);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'grok-3-fast',
        messages: [{
          role: 'system',
          content: `Classify this tweet as either "slop" or "no_slop".

SLOP = Trash opinions, hot takes, hustle culture, crypto shilling, motivational nonsense, engagement bait, nothing of substance.

NO_SLOP = Actual tech news, product announcements, AI discoveries, new features, interesting technical content, real information.

Respond with ONLY one word: "slop" or "no_slop"`
        }, {
          role: 'user',
          content: tweetText
        }],
        temperature: 0
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Tweet classification failed: ${error}`);
    }

    const data = await response.json();
    const result = data.choices?.[0]?.message?.content?.toLowerCase().trim();
    const type = result === 'no_slop' ? 'no_slop' : 'slop';
    console.log(`[Classify] Result: ${type}`);
    return { type };
  }

  /**
   * Generate a storyline based on tweet classification
   * Routes to different generation paths:
   * - NO_SLOP: Elon Musk news report style (interesting tech content)
   * - SLOP: Character throws tweet in trash (trash opinions)
   *
   * @param {string} tweetText - The tweet content
   * @param {string} author - Tweet author handle
   * @param {Object} context - Optional additional context
   * @param {string} context.threadContext - Previous tweets in the thread
   * @param {string} context.userBio - Author's bio/description
   * @param {string} context.userFollowers - Follower count for context
   * @param {Array} context.replyingTo - Users being replied to
   * @param {string} classification - 'slop' or 'no_slop' (default: 'slop')
   */
  async generateStoryline(tweetText, author, context = {}, classification = 'slop') {
    console.log(`[Storyline] Input: author=${author}, classification=${classification}`);
    console.log(`[Storyline] Tweet: ${tweetText.substring(0, 100)}`);

    let systemPrompt, userPrompt, narratorName;

    if (classification === 'no_slop') {
      // NO SLOP: Elon Musk news report style
      // Comedy structure: Scene 1 = roast the idea publicly, Scene 2 = silently email team to steal it
      console.log(`[Storyline] Using NO_SLOP path: Elon Musk news report`);
      narratorName = 'Elon Musk';

      systemPrompt = `You are Elon Musk hosting a breaking news segment, ROASTING a tech idea.

STYLE: Deadpan news anchor. Dismissive. Condescending. You think this idea is garbage and X/xAI is already doing better things.

ROAST THE IDEA HARD:
- "Nobody would ever use this"
- "X already does this better"
- "This is what happens when you don't have real engineers"
- Be savage, dismissive, arrogant

DO NOT mention emailing anyone or building anything. Just roast.

CRITICAL CONSTRAINT: The storyline MUST be EXACTLY 10-15 WORDS. It must fit in 5 seconds when spoken.`;

      userPrompt = `ROAST this tweet as Elon Musk news anchor. Be dismissive and arrogant. Say X/xAI does it better.

Tweet from @${author}: "${tweetText}"

Return JSON:
{
  "title": "News headline (3-5 words)",
  "storyline": "MAX 15 WORDS. Elon ROASTS the idea. Dismissive, arrogant. Says X does it better.",
  "narrator": "Elon Musk",
  "videoPrompt": "Elon Musk as news anchor roasting tech idea",
  "scenes": ["Elon at news desk roasting"]
}`;

    } else {
      // SLOP: Character throws tweet in trash
      const characters = ['SpongeBob SquarePants', 'Peter Griffin', 'Patrick Star', 'Eric Cartman', 'Homer Simpson'];
      const character = characters[Math.floor(Math.random() * characters.length)];
      console.log(`[Storyline] Using SLOP path: ${character} throws tweet in trash`);
      narratorName = character;

      systemPrompt = `You are ${character} reacting to a trash tweet.

STYLE: ${character} reads the tweet out loud, makes a disgusted face, then literally throws it in a garbage bin. Says something like "This opinion is garbage" or "Straight to the trash" in character.

CRITICAL CONSTRAINT: The storyline MUST be EXACTLY 10-15 WORDS. It must fit in 7 seconds.`;

      userPrompt = `React to this trash tweet and throw it in the garbage.

Tweet from @${author}: "${tweetText}"

Return JSON:
{
  "title": "Funny title (3-5 words)",
  "storyline": "MAX 15 WORDS. ${character} reads tweet, throws in trash, says it's garbage.",
  "narrator": "${character}",
  "videoPrompt": "${character} holding paper with tweet, disgusted face, throws in trash bin",
  "scenes": ["${character} reading tweet, then throwing in trash..."]
}`;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'grok-3-fast',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
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
        // Add classification to the result for downstream use
        parsed.classification = classification;
        return parsed;
      }
    } catch (e) {
      console.log('Failed to parse storyline JSON, using raw content');
    }

    // Fallback based on classification
    if (classification === 'no_slop') {
      return {
        title: 'Breaking Tech News',
        storyline: content || 'Breaking news. This is interesting. Emailing the team now.',
        narrator: 'Elon Musk',
        videoPrompt: 'Elon Musk as news anchor at professional desk, speaking to camera',
        scenes: ['Elon Musk at news desk speaking'],
        classification: 'no_slop'
      };
    }

    return {
      title: 'Trash Opinion Alert',
      storyline: content || 'This opinion is absolute garbage. Straight to the trash.',
      narrator: narratorName,
      videoPrompt: `${narratorName} holding paper, disgusted, throws in trash bin`,
      scenes: [`${narratorName} throwing paper in garbage`],
      classification: 'slop'
    };
  }

  /**
   * Generate video from prompt using grok-imagine-video-a2
   *
   * @param {string} prompt - Video description
   * @param {number} targetDuration - Duration in seconds (default: 15)
   * @param {Object} context - Optional context for better video generation
   * @param {string} context.author - Tweet author handle
   * @param {string} context.tweetText - Original tweet text
   * @param {string} context.narrator - Character name for speaking (e.g., "Joe Rogan", "SpongeBob")
   * @param {string} context.narration - Script for the character to speak
   * @returns {Object} - { videoUrl, duration }
   */
  async generateVideo(prompt, targetDuration = 15, context = {}) {
    console.log(`[Video] Generating: ${prompt.substring(0, 80)}...`);
    console.log(`[Video] Duration: ${targetDuration}s`);

    // Enhance prompt with context if available
    let enhancedPrompt = prompt;

    // Classification-based video prompt enhancement
    if (context.narrator === 'Elon Musk') {
      // NO SLOP: Two-scene comedy structure
      // Scene 1: Elon roasts the idea on news desk (with dialogue)
      // Scene 2: Silent cut to office, emailing "implement this now" to Nikita/Toby, clicks send
      enhancedPrompt = `TWO SCENES:

SCENE 1 (0-5 seconds): Elon Musk as news anchor at professional news desk, speaking these EXACT words: "${context.narration}"
- Clean news studio, breaking news graphics
- Elon in suit, looking smug and dismissive
- He is ROASTING and mocking the idea

SCENE 2 (5-12 seconds): SILENT. NO DIALOGUE. Cut to Elon at a computer in the xAI office.
- He is typing an email
- Email visible on screen: To: Nikita (or Toby Pohlen), Subject: URGENT, Body: "Implement this now"
- He clicks SEND button
- Smirks at camera
- This is the punchline - he publicly trashed the idea but secretly steals it`;
      console.log(`[Video] Enhanced prompt for NO_SLOP: Elon two-scene comedy`);

    } else if (context.narration && context.narrator) {
      // SLOP: Character throws tweet in trash
      const tweetPreview = context.tweetText?.substring(0, 50) || 'trash opinion';
      enhancedPrompt = `${context.narrator} holding a piece of paper with a tweet on it. Speaking these EXACT words: "${context.narration}"

VISUAL: ${context.narrator} reads the paper with disgust, crumples it up, and throws it into a garbage bin. Exaggerated cartoon disgust. The tweet text "${tweetPreview}..." should be visible on the paper. Comedic timing. Over-the-top reaction.`;
      console.log(`[Video] Enhanced prompt for SLOP: ${context.narrator} throws tweet in trash`);

    } else if (context.narration) {
      // Fallback with narration
      enhancedPrompt = `Create a video with narration: "${context.narration}"

VISUAL: ${prompt}`;
      console.log(`[Video] Enhanced prompt with narration script (fallback)`);
    }

    // Submit video generation request
    const response = await fetch(`${this.baseUrl}/videos/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'grok-imagine-video-a2',
        prompt: enhancedPrompt,
        duration: targetDuration  // Request specific duration (e.g., 15 seconds)
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

    return {
      videoUrl,
      duration: targetDuration
    };
  }

  /**
   * Generate video from an image (Image-to-Video)
   * Uses an image as the starting frame for the video
   *
   * @param {string} prompt - Video description/motion prompt
   * @param {string} imageUrl - URL of the starting image
   * @param {number} duration - Duration in seconds (default: 15)
   * @returns {Object} - { videoUrl, duration }
   */
  async generateVideoFromImage(prompt, imageUrl, duration = 15) {
    console.log(`[Video] Generating from image: ${imageUrl.substring(0, 50)}...`);
    console.log(`[Video] Motion prompt: ${prompt.substring(0, 80)}...`);
    console.log(`[Video] Duration: ${duration}s`);

    const response = await fetch(`${this.baseUrl}/videos/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'grok-imagine-video-a2',
        prompt: prompt,
        image_url: imageUrl,
        duration: duration
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
    return { videoUrl, duration };
  }

  /**
   * Edit/extend an existing video using grok-imagine-video-beta
   * Can be used to extend videos or modify them
   *
   * @param {string} videoUrl - URL of the source video to edit
   * @param {string} prompt - Edit instructions or continuation prompt
   * @param {number} duration - Duration in seconds (default: 15)
   * @returns {Object} - { videoUrl, duration }
   */
  async editVideo(videoUrl, prompt, duration = 15) {
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
        prompt: prompt,
        duration: duration
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
    return { videoUrl: resultUrl, duration };
  }

  /**
   * Generate multiple video clips for different scenes
   * Useful when you want separate videos for each scene
   *
   * @param {Array<string>} scenes - Array of scene prompts
   * @param {number} durationPerClip - Duration per clip in seconds (default: 15)
   * @param {string} baseImageUrl - Optional starting image for first clip
   * @returns {Object} - { clips: Array<{url, duration}>, totalDuration }
   */
  async generateMultipleClips(scenes, durationPerClip = 15, baseImageUrl = null) {
    console.log(`[Video] Generating ${scenes.length} clips (${durationPerClip}s each)`);

    const clips = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      console.log(`[Video] Generating clip ${i + 1}/${scenes.length}: ${scene.substring(0, 50)}...`);

      try {
        let result;
        if (i === 0 && baseImageUrl) {
          // First clip: use image-to-video for consistency
          result = await this.generateVideoFromImage(scene, baseImageUrl, durationPerClip);
        } else {
          result = await this.generateVideo(scene, durationPerClip);
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
      error: clips.length < scenes.length ?
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
      // Exponential backoff: starts at 1s, maxes at 10s (1.5x multiplier)
      // 5 polls: ~1s, 1.5s, 2.25s, 3.4s, 5s = ~13s total
      const delay = getBackoffDelay(attempt, 1000, 10000);
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

}

export default GrokClient;
