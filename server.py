import os
from flask import Flask, request, jsonify, send_from_directory
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv()

app = Flask(__name__)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

api_key = os.getenv('GOOGLE_API_KEY')
if not api_key:
    print('WARNING: GOOGLE_API_KEY not set in .env file')

genai.configure(api_key=api_key)
gemini = genai.GenerativeModel('models/gemini-2.5-flash')


@app.route('/', defaults={'path': 'index.html'})
@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory(BASE_DIR, path)


@app.route('/api/coaching', methods=['POST'])
def coaching():
    data = request.get_json()

    score = data.get('score') or 0
    brightness = data.get('brightness') or 0
    left_brightness = data.get('leftBrightness') or 0
    right_brightness = data.get('rightBrightness') or 0
    balance = data.get('balance') if data.get('balance') is not None else 50
    color_temp = data.get('colorTemp') or '--'
    issues = data.get('issues', [])

    issues_str = ', '.join(issues) if issues else 'none detected'

    preset = data.get('preset', 'Video Call')
    brightness_label = 'too dark' if brightness < 90 else ('too bright' if brightness > 185 else 'good')
    balance_label = 'one side is noticeably darker' if abs(balance - 50) > 10 else 'pretty even on both sides'
    score_label = 'pretty good!' if score >= 75 else 'needs some work'

    prompt = f"""You are a friendly, plain-speaking camera coach helping someone look better on camera.
They are setting up for: {preset}

Here's what the camera sees right now:
- Lighting score: {score}/100 ({score_label})
- Face brightness: {brightness_label} (value: {brightness}/255)
- Light evenness: {balance_label} ({balance}% coming from the left side)
- Light color: {color_temp}
- Issues the app found: {issues_str}

Give 2-3 short, specific things they can do RIGHT NOW to improve.

Rules you must follow:
- Use plain, simple English — no photography or lighting jargon
- Say "your lamp" or "your light" instead of "light source" or "key light"
- Say "the left side of your face" instead of "fill side"
- Don't use the words: color temperature, Kelvin, fill light, key light, diffusion, exposure
- If their lighting is already good, say so warmly and give one small tip to make it even better
- Keep each suggestion to one sentence
- Sound like a helpful friend, not a manual"""

    try:
        response = gemini.generate_content(prompt)
        return jsonify({'suggestion': response.text})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    print('Lighting Coach server running at http://localhost:8000')
    app.run(host='0.0.0.0', port=8000, debug=False)
