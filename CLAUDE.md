# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A single-page web app that analyzes a user's camera feed to score lighting quality (0–100) and provide actionable improvement suggestions. It uses face detection to find the face region, analyzes pixel brightness across 5 dimensions, and optionally calls a Flask/Gemini backend for AI coaching tips.

## Running the App

**Without AI coaching (no API key needed):**
```bash
python -m http.server 8000
# Open http://localhost:8000
```

**With AI coaching:**
```bash
pip install flask python-dotenv google-generativeai
python server.py
# Open http://localhost:8000
```

Requires `GOOGLE_API_KEY` in `.env` for the AI coaching feature.

## Architecture

The app is split into a pure-frontend analysis pipeline and an optional backend AI enhancement:

**Frontend ([app.js](app.js))** — all core logic, ~814 lines, no framework:
- Face detection via `face-api.js` (loaded from CDN), using `TinyFaceDetector` + 68 facial landmarks
- Pixel brightness analysis on the detected face region using luminance formula (`0.299R + 0.587G + 0.114B`)
- Scoring across 5 categories (20 pts each): exposure, shadow balance, light direction, face evenness, background balance
- Issues flagged when any score < 15/20; each issue has a corresponding canvas overlay visualization
- Global `state` object tracks camera status, loaded models, last analysis results, and detected issues

**Backend ([server.py](server.py))** — Flask, ~75 lines:
- Serves static files
- `POST /api/coaching` — accepts lighting metrics JSON, calls `gemini-2.5-flash` to generate plain-English suggestions (explicitly avoids jargon like "key light", "fill light", "Kelvin")

## Scoring System

| Category | Ideal | Scoring |
|---|---|---|
| Exposure | Brightness 80–200 | Scales down outside range |
| Shadow Balance | Both sides ≥ 80 brightness | 0 if either side ≤ 20 |
| Light Direction | Left/right ratio ≤ 1.3:1 | 0 if ratio ≥ 2.5 |
| Face Evenness | Std dev ≤ 15 across 4 quadrants | 0 if std dev ≥ 50 |
| Background Balance | Face/background diff ≤ 30 | 0 if diff ≥ 100 |

## Key Configuration (app.js)

```js
CONFIG = {
    camera: { width: 640, height: 480, facingMode: 'user' },
    detection: { inputSize: 320, scoreThreshold: 0.5 }
}
THRESHOLD = 15  // score/20 below which an issue is flagged
```

## External Dependencies

- `face-api.js` v0.22.2 — loaded from CDN; `models/` directory is intentionally empty
- `google-generativeai` Python package — only needed for AI coaching endpoint
