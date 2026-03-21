/**
 * ============================================
 * LIGHTING COACH - MVP REBUILD
 * Press Analyze → navigate issues one at a time
 * ============================================
 */

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    camera: { width: 640, height: 480, facingMode: 'user' },
    detection: { inputSize: 320, scoreThreshold: 0.5 }
};

// ============================================
// LIGHTING REFERENCES (collapsible guide)
// ============================================
const LIGHTING_REFERENCES = [
    {
        name: 'The Basic Setup',
        emoji: '💡',
        description: 'One lamp — good enough for most calls',
        tips: [
            'Put one lamp in front of you, slightly to the side — not directly behind your screen',
            'Make sure it\'s brighter than any light coming from behind you',
            'Angle it at your face, not the ceiling'
        ],
        colorHint: 'Any white bulb works. Avoid yellow or orange "warm" bulbs'
    },
    {
        name: 'The Two-Light Setup',
        emoji: '✨',
        description: 'Looks great on YouTube, Twitch, TikTok',
        tips: [
            'Main lamp: in front of you, tilted 45° to one side',
            'Second lamp: on the opposite side, dimmer — fills in the shadow',
            'Bonus: a light aimed at the wall behind you makes the background pop'
        ],
        colorHint: 'Daylight or cool-white bulbs (4000K–5500K) look cleanest on camera'
    },
    {
        name: 'Window Lighting',
        emoji: '🪟',
        description: 'Free, natural, works great if done right',
        tips: [
            'Sit facing the window — never have the window behind you',
            'If the light is harsh, hang a white sheet to soften it',
            'Morning and afternoon light is best — midday sun can be too harsh'
        ],
        colorHint: 'Natural light looks very clean on camera — great for daytime content'
    }
];

// ============================================
// STATE
// ============================================
const state = {
    isRunning: false,
    cameraReady: false,
    modelsLoaded: false,
    lastAnalysis: null,
    issues: [],
    currentIssue: 0,
    roll: 0,
    refsVisible: false
};

// ============================================
// DOM ELEMENTS
// ============================================
const elements = {
    video: document.getElementById('video'),
    overlay: document.getElementById('overlay'),
    loading: document.getElementById('loading'),
    startBtn: document.getElementById('startBtn'),
    analyzeBtn: document.getElementById('analyzeBtn'),
    captureBtn: document.getElementById('captureBtn'),
    aiBtn: document.getElementById('aiBtn'),
    aiContent: document.getElementById('ai-content'),
    scoreSummary: document.getElementById('score-summary'),
    scoreValue: document.getElementById('scoreValue'),
    issueCount: document.getElementById('issueCount'),
    issueNav: document.getElementById('issue-nav'),
    issueCounter: document.getElementById('issueCounter'),
    issueCard: document.getElementById('issueCard'),
    prevBtn: document.getElementById('prevBtn'),
    nextBtn: document.getElementById('nextBtn'),
    toggleRefsBtn: document.getElementById('toggleRefsBtn'),
    refsPanel: document.getElementById('refs-panel')
};

const ctx = elements.overlay.getContext('2d');

// ============================================
// MODEL LOADING
// ============================================
async function loadModels() {
    elements.loading.classList.add('active');
    try {
        await faceapi.nets.tinyFaceDetector.loadFromUri('https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model');
        await faceapi.nets.faceLandmark68Net.loadFromUri('https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model');
        state.modelsLoaded = true;
        console.log('Models loaded');
    } catch (error) {
        console.error('Error loading models:', error);
        showStatusMessage('⚠️', 'Could not load face detection', 'Check your internet connection and reload.', 'bad');
        throw error;
    } finally {
        elements.loading.classList.remove('active');
    }
}

// ============================================
// CAMERA
// ============================================
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: CONFIG.camera.width },
                height: { ideal: CONFIG.camera.height },
                facingMode: CONFIG.camera.facingMode
            },
            audio: false
        });

        elements.video.srcObject = stream;
        await new Promise(resolve => {
            elements.video.onloadedmetadata = () => { elements.video.play(); resolve(); };
        });

        elements.overlay.width = elements.video.videoWidth;
        elements.overlay.height = elements.video.videoHeight;

        state.cameraReady = true;
        elements.analyzeBtn.disabled = false;
        elements.captureBtn.disabled = false;
        elements.startBtn.innerHTML = '<span class="btn-icon">⏹</span> Stop Session';
        console.log('Camera ready');
    } catch (error) {
        if (error.name === 'NotAllowedError') {
            showStatusMessage('🔒', 'Camera access blocked', 'Click the camera icon in your browser\'s address bar to allow access.', 'bad');
        } else if (error.name === 'NotFoundError') {
            showStatusMessage('📷', 'No camera found', 'Plug in a webcam and try again.', 'bad');
        } else {
            showStatusMessage('⚠️', 'Camera couldn\'t start', error.message, 'bad');
        }
        throw error;
    }
}

function stopCamera() {
    if (elements.video.srcObject) {
        elements.video.srcObject.getTracks().forEach(t => t.stop());
        elements.video.srcObject = null;
    }
    state.cameraReady = false;
    state.isRunning = false;
    state.lastAnalysis = null;
    state.issues = [];

    elements.analyzeBtn.disabled = true;
    elements.captureBtn.disabled = true;
    elements.aiBtn.disabled = true;
    elements.startBtn.innerHTML = '<span class="btn-icon">🎬</span> Start Session';
    elements.scoreSummary.classList.add('hidden');
    elements.issueNav.classList.add('hidden');
    clearOverlay();
}

// ============================================
// FACE DETECTION
// ============================================
async function detectFace() {
    if (!state.modelsLoaded || !state.cameraReady) return null;
    const options = new faceapi.TinyFaceDetectorOptions({
        inputSize: CONFIG.detection.inputSize,
        scoreThreshold: CONFIG.detection.scoreThreshold
    });
    return faceapi.detectSingleFace(elements.video, options).withFaceLandmarks();
}

// ============================================
// PIXEL ANALYSIS
// ============================================
function analyzeFacePixels(pixels, width, height) {
    let totalLum = 0, leftLum = 0, rightLum = 0;
    let leftCount = 0, rightCount = 0, pixelCount = 0;
    let q_tl = 0, q_tr = 0, q_bl = 0, q_br = 0;
    let tl_n = 0, tr_n = 0, bl_n = 0, br_n = 0;
    const halfW = width / 2, halfH = height / 2;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const lum = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
            totalLum += lum;
            pixelCount++;
            if (x < halfW) { leftLum += lum; leftCount++; } else { rightLum += lum; rightCount++; }
            if (x < halfW && y < halfH)        { q_tl += lum; tl_n++; }
            else if (x >= halfW && y < halfH)  { q_tr += lum; tr_n++; }
            else if (x < halfW && y >= halfH)  { q_bl += lum; bl_n++; }
            else                               { q_br += lum; br_n++; }
        }
    }

    return {
        brightness: totalLum / pixelCount,
        leftBrightness: leftLum / leftCount,
        rightBrightness: rightLum / rightCount,
        quadrants: {
            tl: q_tl / tl_n, tr: q_tr / tr_n,
            bl: q_bl / bl_n, br: q_br / br_n
        }
    };
}

function getBackgroundBrightness(tempCtx, canvasW, canvasH, box) {
    const regions = [];
    if (box.x > 20) regions.push({ x: 0, y: 0, w: box.x, h: canvasH });
    if (box.x + box.width < canvasW - 20) regions.push({ x: box.x + box.width, y: 0, w: canvasW - box.x - box.width, h: canvasH });
    if (box.y > 20) regions.push({ x: box.x, y: 0, w: box.width, h: box.y });

    let total = 0, count = 0;
    for (const r of regions) {
        if (r.w <= 0 || r.h <= 0) continue;
        const d = tempCtx.getImageData(r.x, r.y, r.w, r.h).data;
        for (let i = 0; i < d.length; i += 16) {
            total += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            count++;
        }
    }
    return count > 0 ? total / count : 128;
}

function calculateBalance(left, right) {
    const total = left + right;
    if (total === 0) return 50;
    return Math.round((left / total) * 100);
}

// ============================================
// SCORING (5 categories × 20 pts each)
// ============================================
function scoreExposure(brightness) {
    if (brightness >= 80 && brightness <= 200) return 20;
    if (brightness < 80) return Math.round(Math.max(0, (brightness / 80) * 20));
    return Math.round(Math.max(0, ((255 - brightness) / 55) * 20));
}

function scoreShadowBalance(left, right) {
    // Is one side actually in shadow (too dark)?
    const minB = Math.min(left, right);
    if (minB >= 80) return 20;
    if (minB <= 20) return 0;
    return Math.round(((minB - 20) / 60) * 20);
}

function scoreLightDirection(left, right) {
    // Is light coming too strongly from one side?
    const minB = Math.min(left, right);
    if (minB < 1) return 0;
    const ratio = Math.max(left, right) / minB;
    if (ratio <= 1.3) return 20;
    if (ratio >= 2.5) return 0;
    return Math.round(20 - ((ratio - 1.3) / 1.2) * 20);
}

function scoreFaceEvenness(quads) {
    const vals = [quads.tl, quads.tr, quads.bl, quads.br];
    const avg = vals.reduce((a, b) => a + b, 0) / 4;
    const stddev = Math.sqrt(vals.reduce((s, v) => s + (v - avg) ** 2, 0) / 4);
    if (stddev <= 15) return 20;
    if (stddev >= 50) return 0;
    return Math.round(20 - ((stddev - 15) / 35) * 20);
}

function scoreBackgroundBalance(faceBrightness, bgBrightness) {
    const diff = Math.abs(faceBrightness - bgBrightness);
    if (diff <= 30) return 20;
    if (diff >= 100) return 0;
    return Math.round(20 - ((diff - 30) / 70) * 20);
}

// ============================================
// ISSUE BUILDING
// ============================================
function buildIssues(scores, faceData, box) {
    const issues = [];
    const THRESHOLD = 15;

    if (scores.exposure < THRESHOLD) {
        const tooDark = faceData.brightness < 80;
        issues.push({
            id: 'exposure',
            icon: tooDark ? '🔆' : '☀️',
            title: tooDark ? 'Your face looks too dark' : 'Too much light on your face',
            description: tooDark
                ? 'Point a lamp toward your face. It should be in front of you — not behind you or far to the side.'
                : 'Dim your lamp slightly, or move it back a bit. If you\'re near a bright window, try angling away from it.',
            score: scores.exposure,
            severity: scores.exposure < 8 ? 'bad' : 'warning',
            overlayType: 'exposure',
            overlayData: { brightness: faceData.brightness, tooDark, box }
        });
    }

    if (scores.shadow < THRESHOLD) {
        // left/right convention: leftBrightness = left side of captured image
        // existing code: leftBrightness > rightBrightness → "right side shadowy"
        const leftShadowy = faceData.leftBrightness > faceData.rightBrightness;
        issues.push({
            id: 'shadow',
            icon: '🌑',
            title: leftShadowy ? 'Right side of your face is in shadow' : 'Left side of your face is in shadow',
            description: `Move your lamp slightly ${leftShadowy ? 'to the right' : 'to the left'} so the light reaches both sides of your face more evenly.`,
            score: scores.shadow,
            severity: scores.shadow < 8 ? 'bad' : 'warning',
            overlayType: 'shadow',
            overlayData: { leftShadowy, box }
        });
    }

    if (scores.lightDirection < THRESHOLD) {
        const lightFromLeft = faceData.leftBrightness > faceData.rightBrightness;
        issues.push({
            id: 'light_direction',
            icon: '💡',
            title: `Light coming too strongly from the ${lightFromLeft ? 'left' : 'right'}`,
            description: `Add a second lamp on the ${lightFromLeft ? 'right' : 'left'} side, or move your main lamp more directly in front of you.`,
            score: scores.lightDirection,
            severity: scores.lightDirection < 8 ? 'bad' : 'warning',
            overlayType: 'light_direction',
            overlayData: { lightFromLeft, left: faceData.leftBrightness, right: faceData.rightBrightness, box }
        });
    }

    if (scores.evenness < THRESHOLD) {
        issues.push({
            id: 'evenness',
            icon: '⚖️',
            title: 'Uneven lighting across your face',
            description: 'Some parts of your face are noticeably brighter or darker than others. Try moving your lamp more directly in front of you.',
            score: scores.evenness,
            severity: scores.evenness < 8 ? 'bad' : 'warning',
            overlayType: 'evenness',
            overlayData: { quadrants: faceData.quadrants, box }
        });
    }

    if (scores.background < THRESHOLD) {
        const faceBrighter = faceData.brightness > faceData.bgBrightness;
        issues.push({
            id: 'background',
            icon: '🖼️',
            title: faceBrighter ? 'Background looks too dark' : 'Background is too bright',
            description: faceBrighter
                ? 'Your background is much darker than your face. Add a lamp aimed at your wall to balance it out.'
                : 'Your background is brighter than your face — this can make you look dim. Make sure your main light is pointed at your face, not behind you.',
            score: scores.background,
            severity: scores.background < 8 ? 'bad' : 'warning',
            overlayType: 'background',
            overlayData: { faceBrightness: faceData.brightness, bgBrightness: faceData.bgBrightness, box }
        });
    }

    // Frame level (mobile gyroscope)
    if (Math.abs(state.roll) > 10) {
        const degrees = Math.abs(Math.round(state.roll));
        issues.push({
            id: 'frame_level',
            icon: '📐',
            title: `Camera is tilted ${degrees}°`,
            description: `Your camera is tilted to the ${state.roll > 0 ? 'right' : 'left'}. Straighten it to keep your frame level.`,
            score: Math.max(0, 20 - degrees),
            severity: degrees > 20 ? 'bad' : 'warning',
            overlayType: 'frame_level',
            overlayData: { roll: state.roll }
        });
    }

    return issues;
}

// ============================================
// MAIN ANALYSIS (called on button press)
// ============================================
async function runAnalysis() {
    elements.analyzeBtn.disabled = true;
    elements.analyzeBtn.innerHTML = '<span class="btn-icon">⏳</span> Analyzing...';

    try {
        const detection = await detectFace();
        if (!detection) {
            showStatusMessage('🔍', 'Can\'t see your face', 'Move into frame and make sure you\'re facing the camera directly.', 'warning');
            elements.scoreSummary.classList.add('hidden');
            return;
        }

        const box = detection.detection.box;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = elements.video.videoWidth;
        tempCanvas.height = elements.video.videoHeight;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(elements.video, 0, 0);

        const padding = 20;
        const faceX = Math.max(0, box.x - padding);
        const faceY = Math.max(0, box.y - padding);
        const faceW = Math.min(tempCanvas.width - faceX, box.width + padding * 2);
        const faceH = Math.min(tempCanvas.height - faceY, box.height + padding * 2);

        const imageData = tempCtx.getImageData(faceX, faceY, faceW, faceH);
        const faceData = analyzeFacePixels(imageData.data, faceW, faceH);
        faceData.bgBrightness = getBackgroundBrightness(tempCtx, tempCanvas.width, tempCanvas.height, box);

        const scores = {
            exposure:       scoreExposure(faceData.brightness),
            shadow:         scoreShadowBalance(faceData.leftBrightness, faceData.rightBrightness),
            lightDirection: scoreLightDirection(faceData.leftBrightness, faceData.rightBrightness),
            evenness:       scoreFaceEvenness(faceData.quadrants),
            background:     scoreBackgroundBalance(faceData.brightness, faceData.bgBrightness)
        };

        const totalScore = scores.exposure + scores.shadow + scores.lightDirection + scores.evenness + scores.background;
        const issues = buildIssues(scores, faceData, box);

        state.issues = issues;
        state.currentIssue = 0;
        state.lastAnalysis = { scores, faceData, box, totalScore };

        // Update score summary
        elements.scoreSummary.classList.remove('hidden');
        elements.scoreValue.textContent = totalScore;
        elements.scoreValue.className = 'score-number ' + (totalScore >= 80 ? 'score-good' : totalScore >= 50 ? 'score-ok' : 'score-bad');
        elements.issueCount.textContent = issues.length;

        if (issues.length > 0) {
            showIssueCard(0);
        } else {
            showAllGoodCard();
        }

        elements.aiBtn.disabled = false;

    } catch (error) {
        console.error('Analysis error:', error);
    } finally {
        elements.analyzeBtn.disabled = false;
        elements.analyzeBtn.innerHTML = '<span class="btn-icon">🔍</span> Analyze';
    }
}

// ============================================
// ISSUE CARD DISPLAY
// ============================================
function showIssueCard(index) {
    const issue = state.issues[index];
    const total = state.issues.length;

    elements.issueNav.classList.remove('hidden');
    elements.issueCounter.textContent = `Issue ${index + 1} of ${total}`;
    elements.issueCard.className = `issue-card severity-${issue.severity}`;
    elements.issueCard.innerHTML = `
        <div class="issue-header">
            <span class="issue-icon">${issue.icon}</span>
            <span class="issue-title">${issue.title}</span>
            <span class="issue-score-badge">${issue.score}/20</span>
        </div>
        <div class="issue-body">${issue.description}</div>
    `;

    elements.prevBtn.disabled = index === 0;
    elements.nextBtn.disabled = index === total - 1;

    drawOverlayForIssue(issue);
}

function showAllGoodCard() {
    elements.issueNav.classList.remove('hidden');
    elements.issueCounter.textContent = 'All clear!';
    elements.issueCard.className = 'issue-card severity-good';
    elements.issueCard.innerHTML = `
        <div class="issue-header">
            <span class="issue-icon">✅</span>
            <span class="issue-title">Lighting looks great!</span>
        </div>
        <div class="issue-body">You're well-lit, balanced, and ready to record. Nice work.</div>
    `;
    elements.prevBtn.disabled = true;
    elements.nextBtn.disabled = true;
    clearOverlay();
}

function showStatusMessage(icon, title, body, severity) {
    elements.issueNav.classList.remove('hidden');
    elements.issueCounter.textContent = '';
    elements.issueCard.className = `issue-card severity-${severity}`;
    elements.issueCard.innerHTML = `
        <div class="issue-header">
            <span class="issue-icon">${icon}</span>
            <span class="issue-title">${title}</span>
        </div>
        <div class="issue-body">${body}</div>
    `;
    elements.prevBtn.disabled = true;
    elements.nextBtn.disabled = true;
}

// ============================================
// OVERLAYS
// ============================================
function clearOverlay() {
    ctx.clearRect(0, 0, elements.overlay.width, elements.overlay.height);
}

function mirrorX(x, width) {
    return elements.overlay.width - x - width;
}

function drawFaceOutline(box) {
    const mx = mirrorX(box.x, box.width);
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(mx, box.y, box.width, box.height);
}

function drawLabel(text, cx, y, color) {
    ctx.save();
    ctx.font = 'bold 12px sans-serif';
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(cx - w / 2 - 5, y - 15, w + 10, 20);
    ctx.fillStyle = color || 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, y - 5);
    ctx.restore();
}

function drawOverlayForIssue(issue) {
    clearOverlay();
    switch (issue.overlayType) {
        case 'exposure':       drawExposureOverlay(issue.overlayData); break;
        case 'shadow':         drawShadowOverlay(issue.overlayData); break;
        case 'light_direction':drawLightDirectionOverlay(issue.overlayData); break;
        case 'evenness':       drawEvennessOverlay(issue.overlayData); break;
        case 'background':     drawBackgroundOverlay(issue.overlayData); break;
        case 'frame_level':    drawFrameLevelOverlay(issue.overlayData); break;
    }
}

function drawExposureOverlay({ box, tooDark }) {
    const mx = mirrorX(box.x, box.width);
    ctx.fillStyle = tooDark ? 'rgba(30, 64, 175, 0.4)' : 'rgba(251, 191, 36, 0.35)';
    ctx.fillRect(mx, box.y, box.width, box.height);
    drawFaceOutline(box);
    drawLabel(tooDark ? 'Too dark' : 'Too bright', mx + box.width / 2, box.y - 2, tooDark ? '#93c5fd' : '#fcd34d');
}

function drawShadowOverlay({ box, leftShadowy }) {
    const mx = mirrorX(box.x, box.width);
    const halfW = box.width / 2;
    // leftShadowy = true → right half of face is in shadow
    // right half of face in camera = left canvas half (mirrorX) after CSS flip
    ctx.fillStyle = 'rgba(251, 146, 60, 0.4)';
    if (leftShadowy) {
        ctx.fillRect(mx + halfW, box.y, halfW, box.height);
    } else {
        ctx.fillRect(mx, box.y, halfW, box.height);
    }
    drawFaceOutline(box);
    drawLabel('Shadow', mx + box.width / 2, box.y - 2, '#fb923c');
}

function drawLightDirectionOverlay({ box, lightFromLeft, left, right }) {
    const mx = mirrorX(box.x, box.width);
    drawFaceOutline(box);

    // Brightness values on each side
    ctx.save();
    ctx.font = '11px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.textAlign = 'center';
    // left canvas half = camera left brightness
    ctx.fillText(Math.round(left), mx + box.width * 0.25, box.y + box.height / 2);
    ctx.fillText(Math.round(right), mx + box.width * 0.75, box.y + box.height / 2);
    ctx.restore();

    // Arrow + label below face
    const arrowCX = mx + box.width / 2;
    const arrowY = box.y + box.height + 30;
    ctx.save();
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = '#fbbf24';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // If light from left, suggest moving it more to center/right
    ctx.fillText(lightFromLeft ? '→ 💡' : '💡 ←', arrowCX, arrowY);
    ctx.restore();
    drawLabel('Move light here', arrowCX, arrowY + 22, '#fbbf24');
}

function drawEvennessOverlay({ box, quadrants }) {
    const mx = mirrorX(box.x, box.width);
    const halfW = box.width / 2, halfH = box.height / 2;

    const ranked = [
        { id: 'tl', val: quadrants.tl },
        { id: 'tr', val: quadrants.tr },
        { id: 'bl', val: quadrants.bl },
        { id: 'br', val: quadrants.br }
    ].sort((a, b) => a.val - b.val);

    ctx.fillStyle = 'rgba(239, 68, 68, 0.4)';
    const darkest = ranked[0].id;
    if      (darkest === 'tl') ctx.fillRect(mx,         box.y,         halfW, halfH);
    else if (darkest === 'tr') ctx.fillRect(mx + halfW, box.y,         halfW, halfH);
    else if (darkest === 'bl') ctx.fillRect(mx,         box.y + halfH, halfW, halfH);
    else                       ctx.fillRect(mx + halfW, box.y + halfH, halfW, halfH);

    drawFaceOutline(box);
    drawLabel('Uneven lighting', mx + box.width / 2, box.y - 2, '#fca5a5');
}

function drawBackgroundOverlay({ box, faceBrightness, bgBrightness }) {
    const mx = mirrorX(box.x, box.width);
    drawFaceOutline(box);
    drawLabel(`Face: ${Math.round(faceBrightness)}`, mx + box.width / 2, box.y + box.height + 18, '#c4b5fd');
    drawLabel(`Background: ${Math.round(bgBrightness)}`, 80, 22, '#94a3b8');
}

function drawFrameLevelOverlay({ roll }) {
    const w = elements.overlay.width;
    const h = elements.overlay.height;
    const cy = h / 2;
    const offset = Math.tan(roll * Math.PI / 180) * (w / 2);

    // Reference line (ideal)
    ctx.save();
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.6)';
    ctx.lineWidth = 1;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Actual tilt line
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, cy + offset);
    ctx.lineTo(w, cy - offset);
    ctx.stroke();
    ctx.restore();

    drawLabel(`Tilt: ${Math.abs(Math.round(roll))}°`, w / 2, cy - 14, '#fca5a5');
}

// ============================================
// CAPTURE
// ============================================
function captureFrame() {
    const canvas = document.createElement('canvas');
    canvas.width = elements.video.videoWidth;
    canvas.height = elements.video.videoHeight;
    const captureCtx = canvas.getContext('2d');

    captureCtx.translate(canvas.width, 0);
    captureCtx.scale(-1, 1);
    captureCtx.drawImage(elements.video, 0, 0);

    if (state.lastAnalysis) {
        captureCtx.setTransform(1, 0, 0, 1, 0, 0);
        captureCtx.drawImage(elements.overlay, 0, 0);
    }

    const link = document.createElement('a');
    link.download = `lighting-coach-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

// ============================================
// AI COACHING
// ============================================
async function getAICoaching() {
    if (!state.lastAnalysis) {
        elements.aiContent.innerHTML = '<span class="ai-error">Run an analysis first.</span>';
        return;
    }

    elements.aiBtn.disabled = true;
    elements.aiBtn.innerHTML = '<span class="btn-icon">⏳</span> Thinking...';
    elements.aiContent.innerHTML = '<span class="ai-placeholder">Looking at your setup...</span>';

    const { totalScore, faceData, scores } = state.lastAnalysis;
    const issues = state.issues.map(i => i.title);

    const payload = {
        score: totalScore,
        brightness: Math.round(faceData.brightness),
        leftBrightness: Math.round(faceData.leftBrightness),
        rightBrightness: Math.round(faceData.rightBrightness),
        balance: calculateBalance(faceData.leftBrightness, faceData.rightBrightness),
        colorTemp: '--',
        preset: 'Video Call',
        issues
    };

    try {
        const response = await fetch('/api/coaching', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (data.error) {
            elements.aiContent.innerHTML = `<span class="ai-error">⚠️ ${data.error}</span>`;
        } else {
            elements.aiContent.innerHTML = `<span class="ai-text">${data.suggestion}</span>`;
        }
    } catch (err) {
        elements.aiContent.innerHTML = '<span class="ai-error">⚠️ Couldn\'t reach the server. Make sure server.py is running.</span>';
    } finally {
        elements.aiBtn.disabled = false;
        elements.aiBtn.innerHTML = '<span class="btn-icon">🤖</span> Get AI Coaching';
    }
}

// ============================================
// REFERENCE CARDS
// ============================================
function renderReferences() {
    elements.refsPanel.innerHTML = '';
    LIGHTING_REFERENCES.forEach(ref => {
        const card = document.createElement('div');
        card.className = 'ref-card';
        card.innerHTML = `
            <div class="ref-card-header">
                <span class="ref-emoji">${ref.emoji}</span>
                <div>
                    <div class="ref-name">${ref.name}</div>
                    <div class="ref-desc">${ref.description}</div>
                </div>
            </div>
            <ul class="ref-tips">
                ${ref.tips.map(tip => `<li>${tip}</li>`).join('')}
            </ul>
            <div class="ref-color-hint">💡 ${ref.colorHint}</div>
        `;
        elements.refsPanel.appendChild(card);
    });
}

// ============================================
// EVENT LISTENERS
// ============================================
elements.startBtn.addEventListener('click', async () => {
    if (state.isRunning) {
        stopCamera();
        state.isRunning = false;
    } else {
        try {
            if (!state.modelsLoaded) await loadModels();
            await startCamera();
            state.isRunning = true;
        } catch (error) {
            console.error('Failed to start:', error);
        }
    }
});

elements.analyzeBtn.addEventListener('click', runAnalysis);

elements.prevBtn.addEventListener('click', () => {
    if (state.currentIssue > 0) {
        state.currentIssue--;
        showIssueCard(state.currentIssue);
    }
});

elements.nextBtn.addEventListener('click', () => {
    if (state.currentIssue < state.issues.length - 1) {
        state.currentIssue++;
        showIssueCard(state.currentIssue);
    }
});

elements.captureBtn.addEventListener('click', captureFrame);
elements.aiBtn.addEventListener('click', getAICoaching);

elements.toggleRefsBtn.addEventListener('click', () => {
    state.refsVisible = !state.refsVisible;
    elements.refsPanel.classList.toggle('visible', state.refsVisible);
    elements.toggleRefsBtn.textContent = state.refsVisible
        ? 'Hide lighting setups ▲'
        : 'Show lighting setups ▾';
});

// Gyroscope (mobile)
window.addEventListener('deviceorientation', (e) => {
    if (e.gamma !== null) state.roll = e.gamma;
});

// ============================================
// INITIALIZATION
// ============================================
renderReferences();
console.log('Lighting Coach loaded. Click "Start Session" to begin.');
