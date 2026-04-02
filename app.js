// ─── Config ──────────────────────────────────────────────────────────────────
const CONFIG = {
  camera:    { width: 640, height: 480, facingMode: 'user' },
  detection: { inputSize: 320, scoreThreshold: 0.5 },
  targets: {
    brightness: { min: 110, max: 180 },
    lrDiff:     { max: 20 },
    rbDelta:    { min: -15, max: 15 },
    qStdDev:    { max: 25 },
    clipPct:    { max: 5 }
  }
};

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  running:      false,
  modelsLoaded: false,
  analyzing:    false,
  intervalId:   null,
  stream:       null,
};

// ─── Elements ────────────────────────────────────────────────────────────────
const video      = document.getElementById('video');
const overlay    = document.getElementById('overlay');
const ctx        = overlay.getContext('2d');
const scoreBadge = document.getElementById('scoreBadge');
const cameraStatus = document.getElementById('cameraStatus');
const tagsRow    = document.getElementById('tagsRow');
const startBtn   = document.getElementById('startBtn');

// ─── Boot ─────────────────────────────────────────────────────────────────────
startBtn.addEventListener('click', () => {
  state.running ? stopCamera() : startCamera();
});

// ─── Camera ───────────────────────────────────────────────────────────────────
async function startCamera() {
  startBtn.disabled = true;
  setStatus('Loading models…');

  try {
    if (!state.modelsLoaded) {
      await faceapi.nets.tinyFaceDetector.loadFromUri(
        'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model'
      );
      state.modelsLoaded = true;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: CONFIG.camera.width, height: CONFIG.camera.height, facingMode: CONFIG.camera.facingMode }
    });

    state.stream = stream;
    video.srcObject = stream;
    await new Promise(r => { video.onloadedmetadata = r; });

    state.running = true;
    startBtn.textContent = 'Stop';
    startBtn.disabled = false;
    setStatus('');

    state.intervalId = setInterval(analyze, 500);
  } catch (err) {
    setStatus(err.name === 'NotAllowedError' ? 'Camera permission denied' : `Error: ${err.message}`);
    startBtn.disabled = false;
  }
}

function stopCamera() {
  clearInterval(state.intervalId);
  state.intervalId = null;

  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
  }

  video.srcObject = null;
  state.running = false;
  state.analyzing = false;

  ctx.clearRect(0, 0, overlay.width, overlay.height);
  scoreBadge.textContent = '--';
  scoreBadge.className = 'score-badge';
  tagsRow.innerHTML = '';
  setStatus('Ready');
  startBtn.textContent = 'Start';
}

// ─── Analysis loop ────────────────────────────────────────────────────────────
async function analyze() {
  if (state.analyzing || !video.videoWidth) return;
  state.analyzing = true;

  try {
    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: CONFIG.detection.inputSize,
      scoreThreshold: CONFIG.detection.scoreThreshold
    });

    const detection = await faceapi.detectSingleFace(video, options);

    if (!detection) {
      setStatus('No face detected');
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      scoreBadge.textContent = '--';
      scoreBadge.className = 'score-badge';
      tagsRow.innerHTML = '';
      return;
    }

    setStatus('');

    // Sync overlay canvas to video dimensions
    overlay.width  = video.videoWidth;
    overlay.height = video.videoHeight;

    const metrics = extractMetrics(detection.box);
    const score   = computeScore(metrics);
    const tags    = generateTags(metrics);

    drawOverlays(detection.box, metrics, score);
    updateUI(score, tags);
  } catch (e) {
    // silently skip frames on error
  } finally {
    state.analyzing = false;
  }
}

// ─── Pixel analysis ───────────────────────────────────────────────────────────
const analysisCanvas = document.createElement('canvas');
const analysisCtx    = analysisCanvas.getContext('2d');

function extractMetrics(box) {
  analysisCanvas.width  = video.videoWidth;
  analysisCanvas.height = video.videoHeight;
  analysisCtx.drawImage(video, 0, 0);

  const pad  = 20;
  const fx   = Math.max(0, Math.round(box.x - pad));
  const fy   = Math.max(0, Math.round(box.y - pad));
  const fw   = Math.min(video.videoWidth  - fx, Math.round(box.width  + pad * 2));
  const fh   = Math.min(video.videoHeight - fy, Math.round(box.height + pad * 2));
  const hw   = fw / 2;
  const hhalf = fh / 2;

  const pixels = analysisCtx.getImageData(fx, fy, fw, fh).data;

  let tLum = 0, lLum = 0, rLum = 0;
  let tR = 0, tB = 0;
  let lCount = 0, rCount = 0, count = 0, clipCount = 0;
  let qTL = 0, qTR = 0, qBL = 0, qBR = 0;
  let qTLc = 0, qTRc = 0, qBLc = 0, qBRc = 0;

  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const i = (y * fw + x) * 4;
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      tLum += lum; tR += r; tB += b; count++;
      if (lum > 240) clipCount++;

      if (x < hw) { lLum += lum; lCount++; } else { rLum += lum; rCount++; }

      if      (x < hw   && y < hhalf) { qTL += lum; qTLc++; }
      else if (x >= hw  && y < hhalf) { qTR += lum; qTRc++; }
      else if (x < hw)                { qBL += lum; qBLc++; }
      else                            { qBR += lum; qBRc++; }
    }
  }

  const brightness = tLum / count;
  const leftB      = lLum / (lCount || 1);
  const rightB     = rLum / (rCount || 1);
  const quads      = [qTL / qTLc, qTR / qTRc, qBL / qBLc, qBR / qBRc];
  const qAvg       = quads.reduce((a, b) => a + b, 0) / 4;
  const qStdDev    = Math.sqrt(quads.reduce((s, v) => s + (v - qAvg) ** 2, 0) / 4);

  return {
    brightness: brightness,
    leftB:      leftB,
    rightB:     rightB,
    lrDiff:     Math.abs(leftB - rightB),
    rbDelta:    tR / count - tB / count,
    qStdDev:    qStdDev,
    clipPct:    (clipCount / count) * 100,
    // pass through face box data for overlays
    fx, fy, fw, fh, hw,
  };
}

// ─── Scoring ──────────────────────────────────────────────────────────────────
function computeScore(m) {
  let penalty = 0;
  const { brightness: bT, lrDiff: lrT, qStdDev: qT, clipPct: cT } = CONFIG.targets;

  // Brightness: up to 30pts
  if (m.brightness < bT.min)
    penalty += ((bT.min - m.brightness) / bT.min) * 30;
  else if (m.brightness > bT.max)
    penalty += ((m.brightness - bT.max) / (255 - bT.max)) * 30;

  // L/R imbalance: up to 20pts
  if (m.lrDiff > lrT.max)
    penalty += Math.min((m.lrDiff - lrT.max) / 80, 1) * 20;

  // Color cast: up to 15pts
  const absDelta = Math.abs(m.rbDelta);
  if (absDelta > 15)
    penalty += Math.min((absDelta - 15) / 45, 1) * 15;

  // Uniformity: up to 20pts
  if (m.qStdDev > qT.max)
    penalty += Math.min((m.qStdDev - qT.max) / 75, 1) * 20;

  // Clipping: up to 15pts
  if (m.clipPct > cT.max)
    penalty += Math.min((m.clipPct - cT.max) / 20, 1) * 15;

  return Math.max(0, Math.round(100 - penalty));
}

// ─── Tags ─────────────────────────────────────────────────────────────────────
function generateTags(m) {
  const tags = [];
  if (m.brightness < 110)  tags.push({ label: 'Too dark',             severity: 'bad' });
  if (m.brightness > 180)  tags.push({ label: 'Too bright',           severity: 'bad' });
  if (m.lrDiff > 50)       tags.push({ label: 'Harsh shadows',        severity: 'bad' });
  else if (m.lrDiff > 20)  tags.push({ label: 'Light from one side',  severity: 'warn' });
  if (m.qStdDev > 25)      tags.push({ label: 'Uneven lighting',      severity: 'warn' });
  if (m.clipPct > 5)       tags.push({ label: 'Highlights blown',     severity: 'bad' });
  if (m.rbDelta > 15)      tags.push({ label: 'Too warm',             severity: 'warn' });
  if (m.rbDelta < -15)     tags.push({ label: 'Too cool',             severity: 'warn' });
  return tags.slice(0, 4);
}

// ─── Overlays ─────────────────────────────────────────────────────────────────
function drawOverlays(box, metrics, score) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  // Because the video is CSS-flipped (scaleX(-1)), canvas coords are mirrored.
  // We draw in raw video space (unflipped) — the canvas transform handles it.
  ctx.save();
  ctx.scale(-1, 1);
  ctx.translate(-overlay.width, 0);

  const { x, y, width, height } = box;
  const scoreColor = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';

  // 1. Shadow-side overlay (lrDiff > 20)
  if (metrics.lrDiff > 20) {
    // In video pixel space, leftB is the LEFT side of the unflipped frame.
    // "Darker side" = left if leftB < rightB, else right.
    const darkerOnLeft = metrics.leftB < metrics.rightB;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    if (darkerOnLeft) {
      ctx.fillRect(x, y, width / 2, height);
    } else {
      ctx.fillRect(x + width / 2, y, width / 2, height);
    }
  }

  // 2. Blown-highlight overlay (clipPct > 5)
  if (metrics.clipPct > 5) {
    const imageData = analysisCtx.getImageData(metrics.fx, metrics.fy, metrics.fw, metrics.fh);
    const pixels = imageData.data;
    // Create a highlight mask
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width  = metrics.fw;
    maskCanvas.height = metrics.fh;
    const maskCtx = maskCanvas.getContext('2d');
    const maskData = maskCtx.createImageData(metrics.fw, metrics.fh);
    for (let i = 0; i < pixels.length; i += 4) {
      const lum = 0.299 * pixels[i] + 0.587 * pixels[i+1] + 0.114 * pixels[i+2];
      if (lum > 240) {
        maskData.data[i]   = 251;  // amber r
        maskData.data[i+1] = 146;  // amber g
        maskData.data[i+2] = 60;   // amber b
        maskData.data[i+3] = 180;
      }
    }
    maskCtx.putImageData(maskData, 0, 0);
    ctx.drawImage(maskCanvas, metrics.fx, metrics.fy);
  }

  // 3. Face bounding box
  ctx.strokeStyle = scoreColor;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(x, y, width, height);

  ctx.restore();
}

// ─── UI updates ───────────────────────────────────────────────────────────────
function updateUI(score, tags) {
  // Score badge
  scoreBadge.textContent = score;
  scoreBadge.className = 'score-badge ' + (score >= 80 ? 'green' : score >= 60 ? 'amber' : 'red');

  // Tags
  tagsRow.innerHTML = '';
  if (tags.length === 0 && score >= 85) {
    const chip = document.createElement('span');
    chip.className = 'tag good';
    chip.textContent = 'Lighting looks good';
    tagsRow.appendChild(chip);
  } else {
    tags.forEach(t => {
      const chip = document.createElement('span');
      chip.className = `tag ${t.severity}`;
      chip.textContent = t.label;
      tagsRow.appendChild(chip);
    });
  }
}

function setStatus(msg) {
  cameraStatus.textContent = msg;
  cameraStatus.style.display = msg ? 'flex' : 'none';
}
