# Gork

Chrome extension that analyzes tweets and generates satirical AI videos using xAI's Grok APIs.

## What it does

1. **Adds "Analyze with Gork" button** to every tweet on X.com
2. **Classifies tweets** as either:
   - **Slop**: Trash opinions, hot takes, hustle culture, engagement bait
   - **No Slop**: Actual tech news, product announcements, interesting content
3. **Generates satirical videos** based on classification:
   - **Slop → Trash throw**: A cartoon character (SpongeBob, Peter Griffin, etc.) reads the tweet with disgust and throws it in the garbage (5 seconds)
   - **No Slop → Elon two-scene comedy**: Scene 1: Elon roasts the idea on a news desk. Scene 2: Silently emails his team "Implement this now" and smirks (12 seconds)

## Quick Start

### Backend
```bash
cd backend
npm install
npm start  # runs on port 3000
```

### Chrome Extension
1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `/extension` folder
5. Navigate to x.com and click "Analyze with Gork" on any tweet

## Architecture

```
Tweet → Classification (grok-3-fast) → Storyline Generation → Video Generation
                ↓                              ↓                      ↓
         slop / no_slop              Character + Script      grok-imagine-video-a2
```

### Narrators (randomized for slop)
- SpongeBob SquarePants
- Peter Griffin (Family Guy)
- Patrick Star
- Eric Cartman (South Park)
- Homer Simpson

### Tech Stack
- **Classification**: grok-3-fast
- **Storyline**: grok-3-fast with character prompts
- **Video**: grok-imagine-video-a2
- **Frontend**: Chrome Extension (Manifest V3)
- **Backend**: Node.js + Express

## API Endpoints

```
POST /api/beef              - Analyze tweet and generate video
POST /api/beef/storyline    - Generate storyline only (for testing)
POST /api/beef/batch        - Process multiple tweets in parallel
GET  /api/beef/tweet/:id    - Fetch single tweet
GET  /api/beef/thread/:id   - Fetch tweet thread
GET  /api/beef/user/:handle/context - Get user's recent activity summary
GET  /api/beef/cache/stats  - Cache statistics
POST /api/beef/cache/clear  - Clear cache
GET  /health                - Health check
```

## Environment Variables

```bash
XAI_API_KEY=xai-...        # Required: xAI API key
PORT=3000                   # Optional: server port (default 3000)
```

## Project Structure

```
├── backend/
│   ├── routes/beef.js      # API endpoints
│   ├── services/
│   │   ├── grok.js         # xAI API client (classification, storyline, video)
│   │   ├── cache.js        # In-memory caching
│   │   └── tweetFetcher.js # Tweet fetching utilities
│   └── index.js            # Express server
├── extension/
│   ├── manifest.json       # Chrome extension manifest
│   ├── content.js          # Injects "Analyze with Gork" button into X.com
│   ├── styles.css          # X-native button styling
│   ├── player.html         # Video player popup
│   └── popup.html          # Extension popup
└── README.md
```
