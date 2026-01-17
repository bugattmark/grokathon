# 🥩 Tweet Beef Video Generator

we're gonna win this

Chrome extension that surfaces "beef" tweets and generates satirical videos using Grok.

## Quick Start

### 1. Backend
```bash
cd backend
npm install
npm start
```

### 2. Chrome Extension
1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `/extension` folder

### 3. Test
1. Navigate to x.com
2. Find a tweet from @elonmusk mentioning OpenAI
3. Watch the magic happen

## Architecture

- **Tweet Discovery**: X API v2 or xAI Live Search (swappable)
- **Storyline**: grok-4-fast-reasoning
- **Video**: grok-imagine-video-a2
- **Thumbnail**: grok-imagine-image-a1

## API Endpoints

```
POST /api/beef         - Generate beef content for a tweet
GET  /api/beef/search  - Search for beef tweets
GET  /api/beef/categories - Get beef categories
POST /api/beef/storyline  - Generate storyline only
GET  /health           - Health check
```

## Environment Variables

```
TWEET_PROVIDER=xai-live-search  # or 'x-api'
XAI_API_KEY=xai-...
X_BEARER_TOKEN=...  # only if using x-api provider
PORT=3000
```
