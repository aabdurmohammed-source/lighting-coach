import os
import json
import base64
import threading
from flask import Flask, request, jsonify, send_from_directory
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

app = Flask(__name__)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

api_key = os.getenv('GOOGLE_API_KEY')
if not api_key:
    print('WARNING: GOOGLE_API_KEY not set in .env file')

client = genai.Client(api_key=api_key)
MODEL = 'gemini-2.5-flash'

# Load lighting knowledge base if it exists
LIGHTING_KNOWLEDGE = ''
knowledge_path = os.path.join(BASE_DIR, 'lighting_knowledge.md')
if os.path.exists(knowledge_path):
    with open(knowledge_path, 'r') as f:
        LIGHTING_KNOWLEDGE = f.read()


@app.route('/', defaults={'path': 'index.html'})
@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory(BASE_DIR, path)


@app.route('/api/coaching', methods=['POST'])
def coaching():
    data = request.get_json()

    score           = data.get('score') or 0
    brightness      = data.get('brightness') or 0
    left_brightness = data.get('leftBrightness') or 0
    right_brightness = data.get('rightBrightness') or 0
    balance         = data.get('balance') if data.get('balance') is not None else 50
    scores          = data.get('scores', {})
    issues          = data.get('issues', [])
    preset          = data.get('preset', 'Video Call')
    frame_b64       = data.get('frameImage')

    issues_str = ', '.join(issues) if issues else 'none detected'

    if brightness < 90:
        brightness_label = 'too dark'
    elif brightness < 110:
        brightness_label = 'borderline dark'
    elif brightness <= 185:
        brightness_label = 'good'
    else:
        brightness_label = 'too bright'

    balance_label = 'one side is noticeably darker' if abs(balance - 50) > 10 else 'pretty even on both sides'

    if score >= 90:
        score_label = 'excellent'
    elif score >= 75:
        score_label = 'good'
    elif score >= 50:
        score_label = 'needs improvement'
    else:
        score_label = 'poor'

    scores_detail = (
        f"  exposure: {scores.get('exposure', '?')}/20, "
        f"shadow: {scores.get('shadow', '?')}/20, "
        f"light direction: {scores.get('lightDirection', '?')}/20, "
        f"evenness: {scores.get('evenness', '?')}/20, "
        f"background: {scores.get('background', '?')}/20, "
        f"color balance: {scores.get('colorBalance', '?')}/20"
    )

    knowledge_block = f"""--- LIGHTING EXPERTISE ---
{LIGHTING_KNOWLEDGE}
--- END EXPERTISE ---

""" if LIGHTING_KNOWLEDGE else ''

    prompt = f"""{knowledge_block}You are a direct, practical camera lighting coach. The person wants honest feedback.
They are setting up for: {preset}

Lighting analysis:
- Overall score: {score}/100 ({score_label})
- Face brightness: {brightness}/255 — {brightness_label}
- Left side: {left_brightness}/255, Right side: {right_brightness}/255
- Balance: {balance}% from left — {balance_label}
- Per-category scores: {scores_detail}
- Issues detected: {issues_str}

{"Look at the image provided and " if frame_b64 else ""}give 2-3 specific things they should do RIGHT NOW to improve their lighting.

Rules:
- Be honest and direct — if lighting is bad, say what is wrong specifically
{"- Only acknowledge good lighting if the overall score is 85 or above; otherwise always give improvements" if score < 85 else "- Their lighting is genuinely good — acknowledge it briefly, then give one small tip to make it even better"}
- Use plain English: say "your lamp" not "key light", "left side of your face" not "fill side"
- Avoid jargon: no color temperature, Kelvin, fill light, diffusion, exposure
- One sentence per suggestion
- Sound like a knowledgeable friend, not a manual"""

    try:
        parts = [prompt]
        if frame_b64:
            parts.append(types.Part.from_bytes(data=base64.b64decode(frame_b64), mime_type='image/jpeg'))
        response = client.models.generate_content(model=MODEL, contents=parts)
        return jsonify({'suggestion': response.text})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


TEST_RESULTS_PATH = os.path.join(BASE_DIR, 'test-results.json')
TEST_PHOTOS_DIR   = os.path.join(BASE_DIR, 'test-photos')
_results_lock = threading.Lock()


@app.route('/api/test-photos')
def test_photos():
    """Return list of available photo pairs from test-photos/test/ and test-photos/reference/."""
    test_dir = os.path.join(TEST_PHOTOS_DIR, 'test')
    ref_dir  = os.path.join(TEST_PHOTOS_DIR, 'reference')
    pairs = []
    exts = {'.jpg', '.jpeg', '.png', '.webp'}

    if not os.path.isdir(test_dir):
        return jsonify({'pairs': [], 'error': 'test-photos/test/ folder not found'})

    for fname in sorted(os.listdir(test_dir)):
        stem, ext = os.path.splitext(fname)
        if ext.lower() not in exts or fname.startswith('.'):
            continue
        # Find matching reference (same stem, any supported extension)
        ref_file = None
        for rext in [ext] + [e for e in ['.jpg', '.jpeg', '.png', '.webp'] if e != ext]:
            candidate = os.path.join(ref_dir, stem + rext)
            if os.path.exists(candidate):
                ref_file = stem + rext
                break
        pairs.append({
            'id': stem,
            'test': f'test-photos/test/{fname}',
            'reference': f'test-photos/reference/{ref_file}' if ref_file else None,
        })

    return jsonify({'pairs': pairs})


@app.route('/api/submit-test', methods=['POST'])
def submit_test():
    """Append a crowd-source test submission to test-results.json."""
    data = request.get_json()
    if not data or 'name' not in data or 'results' not in data:
        return jsonify({'error': 'Invalid payload'}), 400

    with _results_lock:
        if os.path.exists(TEST_RESULTS_PATH):
            with open(TEST_RESULTS_PATH, 'r') as f:
                all_results = json.load(f)
        else:
            all_results = []

        submission_id = len(all_results) + 1
        data['submissionId'] = submission_id
        all_results.append(data)

        with open(TEST_RESULTS_PATH, 'w') as f:
            json.dump(all_results, f, indent=2)

    return jsonify({'status': 'ok', 'submissionId': submission_id})


@app.route('/api/test-results')
def test_results():
    """Return all submissions from test-results.json."""
    if not os.path.exists(TEST_RESULTS_PATH):
        return jsonify([])
    with _results_lock:
        with open(TEST_RESULTS_PATH, 'r') as f:
            return jsonify(json.load(f))


if __name__ == '__main__':
    print('Lighting Coach server running at http://localhost:8000')
    app.run(host='0.0.0.0', port=8000, debug=False)
