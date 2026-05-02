// ===== Hand Vision — Creative Hand Tracking =====
// Uses MediaPipe Tasks Vision (HandLandmarker) — newer, faster API

import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs";

// ---- State ----
const state = {
    mode: 0,
    modes: ['NEON SKELETON', 'GALAXY FLOW', 'FIRE SPIRIT', 'AURORA WAVE'],
    modeColors: [
        { primary: '#00f0ff', secondary: '#bf00ff', tertiary: '#ff2d95' },
        { primary: '#7b68ee', secondary: '#00bfff', tertiary: '#ffd700' },
        { primary: '#ff4500', secondary: '#ff8c00', tertiary: '#ffd700' },
        { primary: '#00ff88', secondary: '#00f0ff', tertiary: '#bf00ff' }
    ],
    showParticles: true,
    showTrails: true,
    showGeometry: true,
    showWebcam: true,
    particles: [],
    trails: [],
    prevLandmarks: [],
    fpsFrames: 0,
    fps: 0,
    lastFpsTime: performance.now(),
    handDetected: false
};

// ---- DOM ----
const startScreen = document.getElementById('start-screen');
const startBtn = document.getElementById('start-btn');
const statusText = document.getElementById('status-text');
const appContainer = document.getElementById('app-container');
const videoEl = document.getElementById('webcam');
const canvas = document.getElementById('output-canvas');
const fxCanvas = document.getElementById('fx-canvas');
const ctx = canvas.getContext('2d');
const fxCtx = fxCanvas.getContext('2d');
const modeNameEl = document.getElementById('mode-name');
const fpsValueEl = document.getElementById('fps-value');
const debugEl = document.getElementById('debug-info');

// ---- Constants ----
const HAND_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],
    [0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20],
    [5,9],[9,13],[13,17]
];
const FINGERTIPS = [4, 8, 12, 16, 20];

// ---- Resize ----
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    fxCanvas.width = window.innerWidth;
    fxCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// ---- Utility ----
function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function log(msg) {
    console.log('[HandVision]', msg);
    if (debugEl) debugEl.textContent = msg;
}

// ---- Particle ----
class Particle {
    constructor(x, y, color) {
        this.x = x; this.y = y; this.color = color;
        this.size = Math.random() * 3.5 + 1.5;
        this.speedX = (Math.random() - 0.5) * 5;
        this.speedY = (Math.random() - 0.5) * 5;
        this.life = 1;
        this.decay = Math.random() * 0.02 + 0.01;
        this.angle = Math.random() * Math.PI * 2;
        this.spin = (Math.random() - 0.5) * 0.15;
    }
    update() {
        this.x += this.speedX; this.y += this.speedY;
        this.angle += this.spin; this.life -= this.decay;
        this.speedX *= 0.97; this.speedY *= 0.97;
    }
    draw(c) {
        if (this.life <= 0) return;
        c.save();
        c.globalAlpha = this.life * 0.9;
        c.translate(this.x, this.y);
        c.rotate(this.angle);
        c.beginPath();
        const r = this.size * this.life;
        for (let i = 0; i < 8; i++) {
            const rad = i % 2 === 0 ? r : r * 0.4;
            const a = (Math.PI * i) / 4;
            if (i === 0) c.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
            else c.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
        }
        c.closePath();
        c.fillStyle = this.color;
        c.shadowColor = this.color;
        c.shadowBlur = 12;
        c.fill();
        c.restore();
    }
}

class TrailPoint {
    constructor(x, y, color) {
        this.x = x; this.y = y; this.color = color;
        this.life = 1; this.decay = 0.012;
    }
    update() { this.life -= this.decay; }
}

// ---- Spawn particles ----
function spawnParticles(landmarks) {
    if (!state.showParticles) return;
    const colors = state.modeColors[state.mode];
    const ca = [colors.primary, colors.secondary, colors.tertiary];
    FINGERTIPS.forEach((tip, i) => {
        const lm = landmarks[tip];
        const x = (1 - lm.x) * canvas.width;
        const y = lm.y * canvas.height;
        for (let j = 0; j < 3; j++) state.particles.push(new Particle(x, y, ca[i % 3]));
    });
    const palm = landmarks[9];
    state.particles.push(new Particle((1 - palm.x) * canvas.width, palm.y * canvas.height, colors.secondary));
}

// ---- Add trails ----
function addTrails(landmarks) {
    if (!state.showTrails) return;
    const colors = state.modeColors[state.mode];
    const ca = [colors.primary, colors.secondary, colors.tertiary];
    FINGERTIPS.forEach((tip, i) => {
        const lm = landmarks[tip];
        state.trails.push(new TrailPoint((1 - lm.x) * canvas.width, lm.y * canvas.height, ca[i % 3]));
    });
}

// ---- Draw neon skeleton ----
function drawNeonSkeleton(landmarks) {
    const colors = state.modeColors[state.mode];
    const time = performance.now() * 0.001;

    HAND_CONNECTIONS.forEach(([a, b]) => {
        const la = landmarks[a], lb = landmarks[b];
        const x1 = (1 - la.x) * canvas.width, y1 = la.y * canvas.height;
        const x2 = (1 - lb.x) * canvas.width, y2 = lb.y * canvas.height;

        const grad = ctx.createLinearGradient(x1, y1, x2, y2);
        grad.addColorStop(0, colors.primary);
        grad.addColorStop(1, colors.secondary);

        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        ctx.strokeStyle = grad; ctx.lineWidth = 6;
        ctx.shadowColor = colors.primary; ctx.shadowBlur = 25;
        ctx.lineCap = 'round'; ctx.stroke();

        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 2; ctx.shadowBlur = 0; ctx.stroke();
    });

    landmarks.forEach((lm, i) => {
        const x = (1 - lm.x) * canvas.width;
        const y = lm.y * canvas.height;
        const isTip = FINGERTIPS.includes(i);
        const baseR = isTip ? 10 : 6;
        const r = baseR + (isTip ? Math.sin(time * 5 + i) * 3 : 0);

        if (isTip) {
            ctx.beginPath();
            ctx.arc(x, y, r + 18, 0, Math.PI * 2);
            ctx.fillStyle = hexToRgba(colors.tertiary, 0.12 + Math.sin(time * 3 + i) * 0.05);
            ctx.shadowColor = colors.tertiary; ctx.shadowBlur = 35;
            ctx.fill();
        }

        const jGrad = ctx.createRadialGradient(x, y, 0, x, y, r);
        jGrad.addColorStop(0, '#ffffff');
        jGrad.addColorStop(0.4, isTip ? colors.tertiary : colors.primary);
        jGrad.addColorStop(1, 'transparent');
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = jGrad;
        ctx.shadowColor = isTip ? colors.tertiary : colors.primary;
        ctx.shadowBlur = 20; ctx.fill();
    });
    ctx.shadowBlur = 0;
}

// ---- Draw geometry ----
function drawGeometry(landmarks) {
    if (!state.showGeometry) return;
    const colors = state.modeColors[state.mode];
    const time = performance.now() * 0.001;

    const tips = FINGERTIPS.map(idx => ({
        x: (1 - landmarks[idx].x) * canvas.width,
        y: landmarks[idx].y * canvas.height
    }));

    ctx.beginPath();
    tips.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.strokeStyle = hexToRgba(colors.tertiary, 0.35 + Math.sin(time * 2) * 0.15);
    ctx.lineWidth = 2; ctx.shadowColor = colors.tertiary; ctx.shadowBlur = 18;
    ctx.stroke();

    for (let i = 0; i < tips.length; i++) {
        for (let j = i + 2; j < tips.length; j++) {
            if (i === 0 && j === tips.length - 1) continue;
            ctx.beginPath(); ctx.moveTo(tips[i].x, tips[i].y); ctx.lineTo(tips[j].x, tips[j].y);
            ctx.strokeStyle = hexToRgba(colors.secondary, 0.15);
            ctx.lineWidth = 1; ctx.shadowBlur = 10; ctx.stroke();
        }
    }

    const wx = (1 - landmarks[0].x) * canvas.width, wy = landmarks[0].y * canvas.height;
    for (let r = 0; r < 3; r++) {
        ctx.beginPath();
        ctx.arc(wx, wy, 25 + r * 18 + Math.sin(time * 3 + r * 2) * 6, 0, Math.PI * 2);
        ctx.strokeStyle = hexToRgba(colors.primary, 0.2 - r * 0.05);
        ctx.lineWidth = 1.5; ctx.shadowColor = colors.primary; ctx.shadowBlur = 12;
        ctx.stroke();
    }
    ctx.shadowBlur = 0;
}

// ---- Energy between hands ----
function drawEnergyBetweenHands(allLandmarks) {
    if (allLandmarks.length < 2) return;
    const colors = state.modeColors[state.mode];
    const time = performance.now() * 0.001;
    const h1 = allLandmarks[0], h2 = allLandmarks[1];

    FINGERTIPS.forEach((tip, i) => {
        const x1 = (1 - h1[tip].x) * canvas.width, y1 = h1[tip].y * canvas.height;
        const x2 = (1 - h2[tip].x) * canvas.width, y2 = h2[tip].y * canvas.height;
        const mx = (x1 + x2) / 2 + Math.sin(time * 6 + i) * 40;
        const my = (y1 + y2) / 2 + Math.cos(time * 6 + i) * 40;

        ctx.beginPath(); ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(mx, my, x2, y2);
        ctx.strokeStyle = hexToRgba(colors.tertiary, 0.5);
        ctx.lineWidth = 2.5; ctx.shadowColor = colors.tertiary;
        ctx.shadowBlur = 25; ctx.stroke(); ctx.shadowBlur = 0;
    });
}

// ---- FX layer ----
function drawFxLayer() {
    fxCtx.fillStyle = 'rgba(10, 10, 15, 0.04)';
    fxCtx.fillRect(0, 0, fxCanvas.width, fxCanvas.height);

    if (state.showTrails) {
        for (let i = state.trails.length - 1; i >= 0; i--) {
            const t = state.trails[i]; t.update();
            if (t.life <= 0) { state.trails.splice(i, 1); continue; }
            fxCtx.beginPath(); fxCtx.arc(t.x, t.y, 4 * t.life, 0, Math.PI * 2);
            fxCtx.fillStyle = hexToRgba(t.color, t.life * 0.6);
            fxCtx.shadowColor = t.color; fxCtx.shadowBlur = 12; fxCtx.fill();
        }
    }
    if (state.showParticles) {
        for (let i = state.particles.length - 1; i >= 0; i--) {
            const p = state.particles[i]; p.update();
            if (p.life <= 0) { state.particles.splice(i, 1); continue; }
            p.draw(fxCtx);
        }
    }
    fxCtx.shadowBlur = 0;
    if (state.particles.length > 600) state.particles.splice(0, state.particles.length - 600);
    if (state.trails.length > 400) state.trails.splice(0, state.trails.length - 400);
}

// ---- Background ----
function drawBackground() {
    const colors = state.modeColors[state.mode];
    ctx.strokeStyle = 'rgba(255,255,255,0.025)'; ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 60) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 60) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
    const cs = 70;
    [[0,0,1,1],[canvas.width,0,-1,1],[0,canvas.height,1,-1],[canvas.width,canvas.height,-1,-1]]
        .forEach(([cx,cy,dx,dy]) => {
            ctx.beginPath(); ctx.moveTo(cx, cy + cs * dy); ctx.lineTo(cx, cy); ctx.lineTo(cx + cs * dx, cy);
            ctx.strokeStyle = hexToRgba(colors.primary, 0.2); ctx.lineWidth = 1; ctx.stroke();
        });
}

// ---- Velocity ----
function getVelocity(landmarks) {
    if (state.prevLandmarks.length === 0) return 0;
    let v = 0;
    FINGERTIPS.forEach(idx => {
        const c = landmarks[idx], p = state.prevLandmarks[idx];
        if (!p) return;
        v += Math.sqrt((c.x - p.x) ** 2 + (c.y - p.y) ** 2);
    });
    return v / FINGERTIPS.length;
}

function drawVelocityEffects(landmarks, vel) {
    if (vel < 0.005) return;
    const colors = state.modeColors[state.mode];
    const px = (1 - landmarks[9].x) * canvas.width, py = landmarks[9].y * canvas.height;
    const intensity = Math.min(vel * 25, 1);
    ctx.beginPath(); ctx.arc(px, py, 50 + intensity * 50, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(colors.primary, intensity * 0.1);
    ctx.shadowColor = colors.primary; ctx.shadowBlur = 35; ctx.fill(); ctx.shadowBlur = 0;

    if (vel > 0.01) {
        FINGERTIPS.forEach(tip => {
            const x = (1 - landmarks[tip].x) * canvas.width, y = landmarks[tip].y * canvas.height;
            for (let j = 0; j < 5; j++) {
                const p = new Particle(x, y, colors.tertiary);
                p.speedX *= 2.5; p.speedY *= 2.5; p.size *= 1.8;
                state.particles.push(p);
            }
        });
    }
}

// ---- Render frame ----
function renderFrame(allLandmarks) {
    state.fpsFrames++;
    const now = performance.now();
    if (now - state.lastFpsTime >= 1000) {
        state.fps = state.fpsFrames; state.fpsFrames = 0;
        state.lastFpsTime = now; fpsValueEl.textContent = state.fps;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(10, 10, 15, 0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawBackground();

    if (allLandmarks && allLandmarks.length > 0) {
        state.handDetected = true;
        allLandmarks.forEach(landmarks => {
            const vel = getVelocity(landmarks);
            drawNeonSkeleton(landmarks);
            drawGeometry(landmarks);
            spawnParticles(landmarks);
            addTrails(landmarks);
            drawVelocityEffects(landmarks, vel);
            state.prevLandmarks = [...landmarks];
        });
        if (allLandmarks.length >= 2) drawEnergyBetweenHands(allLandmarks);
    } else {
        state.handDetected = false;
        ctx.save();
        ctx.font = '300 18px Inter, sans-serif';
        ctx.fillStyle = hexToRgba(state.modeColors[state.mode].primary, 0.5);
        ctx.textAlign = 'center';
        ctx.globalAlpha = Math.sin(performance.now() * 0.003) * 0.3 + 0.7;
        ctx.fillText("✋ Qo'lingizni kamera oldiga qo'ying...", canvas.width / 2, canvas.height / 2);
        ctx.restore();
    }

    drawFxLayer();
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
}

// ========== INITIALIZATION ==========
let handLandmarker = null;

async function init() {
    statusText.textContent = 'AI model yuklanmoqda...';
    log('Model yuklanmoqda...');

    try {
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm"
        );
        log('WASM yuklandi, model yaratilmoqda...');
        statusText.textContent = 'Model yaratilmoqda...';

        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numHands: 2,
            minHandDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        log('Model tayyor!');
        statusText.textContent = '✅ Tayyor! "Boshlash" tugmasini bosing';
        startBtn.style.opacity = '1';
        startBtn.style.pointerEvents = 'auto';

    } catch (err) {
        console.error('Init error:', err);
        log('Xatolik: ' + err.message);
        statusText.textContent = '❌ ' + err.message;

        // Try CPU fallback
        try {
            log('CPU rejimida qayta urinish...');
            statusText.textContent = 'CPU rejimida yuklanmoqda...';
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm"
            );
            handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                    delegate: "CPU"
                },
                runningMode: "VIDEO",
                numHands: 2
            });
            log('CPU model tayyor!');
            statusText.textContent = '✅ Tayyor! "Boshlash" tugmasini bosing';
            startBtn.style.opacity = '1';
            startBtn.style.pointerEvents = 'auto';
        } catch (err2) {
            log('Xatolik: ' + err2.message);
            statusText.textContent = '❌ Model yuklanmadi: ' + err2.message;
        }
    }
}

async function startCamera() {
    log('Kamera ochilmoqda...');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
        });
        videoEl.srcObject = stream;
        videoEl.classList.add('visible');
        await new Promise(r => { videoEl.onloadedmetadata = () => { videoEl.play(); r(); }; });
        log('Kamera tayyor! Tracking boshlandi.');
        detectLoop();
    } catch (err) {
        log('Kamera xatosi: ' + err.message);
        statusText.textContent = '❌ Kamera: ' + err.message;
    }
}

function detectLoop() {
    if (!handLandmarker) return;

    if (videoEl.readyState >= 2) {
        const result = handLandmarker.detectForVideo(videoEl, performance.now());
        renderFrame(result.landmarks);
    } else {
        renderFrame(null);
    }

    requestAnimationFrame(detectLoop);
}

// ---- Button handlers ----
startBtn.style.opacity = '0.5';
startBtn.style.pointerEvents = 'none';

startBtn.addEventListener('click', async () => {
    if (!handLandmarker) {
        statusText.textContent = 'Model hali yuklanmoqda...';
        return;
    }
    startScreen.classList.add('hidden');
    appContainer.classList.remove('hidden');
    resize();
    await startCamera();
});

document.getElementById('toggle-mode').addEventListener('click', () => {
    state.mode = (state.mode + 1) % state.modes.length;
    modeNameEl.textContent = state.modes[state.mode];
    state.trails = [];
    fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
});

document.getElementById('toggle-particles').addEventListener('click', function() {
    state.showParticles = !state.showParticles; this.classList.toggle('active');
});
document.getElementById('toggle-trails').addEventListener('click', function() {
    state.showTrails = !state.showTrails; this.classList.toggle('active');
    if (!state.showTrails) state.trails = [];
});
document.getElementById('toggle-geometry').addEventListener('click', function() {
    state.showGeometry = !state.showGeometry; this.classList.toggle('active');
});
document.getElementById('toggle-webcam-view').addEventListener('click', function() {
    state.showWebcam = !state.showWebcam; this.classList.toggle('active');
    videoEl.classList.toggle('visible');
});

// ---- Start ----
init();
