/**
 * Grok API Client
 * Handles storyline generation and video generation via xAI
 */

// Comedian styles for randomized narration
const COMEDIAN_STYLES = [
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
  }
];

function getRandomComedianStyle() {
  const comedian = COMEDIAN_STYLES[Math.floor(Math.random() * COMEDIAN_STYLES.length)];
  console.log(`[Storyline] Using comedian style: ${comedian.name}`);
  return comedian;
}

export class GrokClient {
  constructor(apiKey) {
    this.apiKey = apiKey || process.env.XAI_API_KEY;
    this.baseUrl = 'https://api.x.ai/v1';
    // Video API not yet public - use demo mode for hackathon
    this.demoMode = process.env.DEMO_MODE === 'true';
  }

  /**
   * Generate a meme/satirical storyline for a beef tweet
   * @param {string} tweetText - The tweet content
   * @param {string} author - Tweet author
   * @param {string} category - Beef category (e.g., 'elon-vs-openai')
   */
  async generateStoryline(tweetText, author, category = 'tech-beef') {
    console.log(`[Storyline] Input: author=${author}, category=${category}`);
    console.log(`[Storyline] Tweet: ${tweetText.substring(0, 100)}`);

    // Get random comedian style
    const comedian = getRandomComedianStyle();

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
          content: `${comedian.style}

Create over-the-top dramatic commentary for tech drama.
Be extremely dramatic, funny, and meme-worthy. Use internet humor.
Keep it short (2-3 sentences) but punchy and in character.`
        }, {
          role: 'user',
          content: `Create a dramatic 10-second video script for this beef tweet, narrated in the style of ${comedian.name}:

Author: @${author}
Tweet: "${tweetText}"
Category: ${category}

Return JSON with:
- title: Epic episode title (e.g., "Episode 47: The Great Unbundling")
- storyline: The dramatic narration in ${comedian.name}'s voice (2-3 sentences with their signature phrases)
- videoPrompt: A visual description for video generation (1 sentence describing the scene)`
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
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.log('Failed to parse storyline JSON, using raw content');
    }

    // Fallback
    return {
      title: 'Tech Drama Unfolds',
      storyline: content,
      videoPrompt: 'Epic tech rivalry scene with dramatic lighting'
    };
  }

  /**
   * Generate video from prompt using grok-imagine-video-a2
   * @param {string} prompt - Video description
   * @param {number} duration - Duration in seconds (default: 6)
   */
  async generateVideo(prompt, duration = 6) {
    console.log(`[Video] Generating: ${prompt.substring(0, 80)}...`);

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
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Video generation failed: ${error}`);
    }

    const data = await response.json();
    const requestId = data.request_id || data.id;
    console.log(`[Video] Request ID: ${requestId}`);

    // Poll for completion
    const videoUrl = await this.pollVideoStatus(requestId);
    return { videoUrl, duration };
  }

  /**
   * Poll video generation status until complete
   */
  async pollVideoStatus(requestId, maxAttempts = 60) {
    console.log(`[Video] Polling for request: ${requestId}`);

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 3000)); // Wait 3s between polls

      const response = await fetch(`${this.baseUrl}/videos/${requestId}`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });

      if (!response.ok) {
        console.log(`[Video] Poll ${i+1}: HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();
      console.log(`[Video] Poll ${i+1}:`, JSON.stringify(data).substring(0, 200));

      // Check for completed video - response format: { video: { url, duration } }
      if (data.video?.url) {
        console.log(`[Video] Complete! URL: ${data.video.url}`);
        return data.video.url;
      }

      if (data.status === 'failed' || data.error) {
        throw new Error(`Video generation failed: ${data.error || 'unknown'}`);
      }
    }
    throw new Error('Video generation timeout');
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
}

export default GrokClient;
