# Lighting Coach - Web App

A web app that analyzes your camera feed and provides lighting suggestions for content creators.

## Quick Start

1. Open terminal in this folder
2. Run: `python -m http.server 8000`
3. Open browser to: `http://localhost:8000`
4. Click "Start Camera" and allow camera access

## Project Structure

```
lighting-coach/
├── index.html          # Main HTML page
├── style.css           # Styling
├── app.js              # Main application logic
├── LEARNING.md         # Learning resources and concepts
├── models/             # face-api.js model files (download separately)
└── README.md           # This file
```

## Setup face-api.js Models

The face detection models need to be downloaded separately:

1. Go to: https://github.com/justadudewhohacks/face-api.js/tree/master/weights
2. Download these folders into `models/`:
   - `tiny_face_detector/`
   - `face_landmark_68/`

Or use the download script (if you have wget):
```bash
# Run from the lighting-coach folder
./download-models.sh
```

## How It Works

1. **Camera Access** - Browser requests camera permission via MediaDevices API
2. **Face Detection** - face-api.js detects face and 68 landmark points
3. **Lighting Analysis** - We analyze pixel brightness in the face region
4. **Suggestions** - Based on brightness distribution, we give actionable tips

## Browser Support

Works best in Chrome, Edge, or Firefox. Requires camera permission.

## Next Steps

1. Read `LEARNING.md` for concepts and tutorials
2. Open `app.js` to understand the code
3. Modify `analyzeLighting()` to improve suggestions