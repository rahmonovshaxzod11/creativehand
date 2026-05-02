// ===== Hand Vision — OPTIMIZED for Performance =====
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
    showParticles: false,
    showTrails: false,
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
function hexToRgba(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
}

// Pre-compute glow images for performance (avoid shadowBlur)
const glowCache = new Map();
function getGlow(color, size) {
    const key = color + size;
    if (glowCache.has(key)) return glowCache.get(key);
    const s = size * 4;
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const gc = c.getContext('2d');
    const grad = gc.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
    grad.addColorStop(0, color);
    grad.addColorStop(0.3, hexToRgba(color.startsWith('#') ? color : '#ffffff', 0.5));
    grad.addColorStop(1, 'transparent');
    gc.fillStyle = grad;
    gc.fillRect(0, 0, s, s);
    glowCache.set(key, c);
    return c;
}

function log(msg) {
    console.log('[HandVision]', msg);
    if (debugEl) debugEl.textContent = msg;
}

// ---- Simple Particle (lightweight) ----
class Particle {
    constructor(x, y, color) {
        this.x = x; this.y = y; this.color = color;
        this.size = Math.random() * 3 + 1;
        this.speedX = (Math.random() - 0.5) * 4;
        this.speedY = (Math.random() - 0.5) * 4;
        this.life = 1;
        this.decay = Math.random() * 0.03 + 0.015;
    }
    update() {
        this.x += this.speedX; this.y += this.speedY;
        this.life -= this.decay;
        this.speedX *= 0.96; this.speedY *= 0.96;
    }
    draw(c) {
        if (this.life <= 0) return;
        c.globalAlpha = this.life * 0.8;
        c.fillStyle = this.color;
        c.beginPath();
        c.arc(this.x, this.y, this.size * this.life, 0, Math.PI * 2);
        c.fill();
    }
}

// ---- Spawn particles — ONLY when hand moves ----
function spawnParticles(landmarks, vel) {
    if (!state.showParticles || vel < 0.004) return;
    const colors = state.modeColors[state.mode];
    const ca = [colors.primary, colors.secondary, colors.tertiary];
    const count = vel > 0.02 ? 2 : 1; // more particles = faster movement
    FINGERTIPS.forEach((tip, i) => {
        const lm = landmarks[tip];
        const x = (1 - lm.x) * canvas.width, y = lm.y * canvas.height;
        for (let j = 0; j < count; j++) {
            state.particles.push(new Particle(x, y, ca[i % 3]));
        }
    });
}

// ---- Trails — ONLY when hand moves ----
function addTrails(landmarks, vel) {
    if (!state.showTrails || vel < 0.004) return;
    const colors = state.modeColors[state.mode];
    const ca = [colors.primary, colors.secondary, colors.tertiary];
    FINGERTIPS.forEach((tip, i) => {
        const lm = landmarks[tip];
        state.trails.push({
            x: (1 - lm.x) * canvas.width,
            y: lm.y * canvas.height,
            color: ca[i % 3],
            life: 1
        });
    });
}

// ---- Draw neon skeleton (NO shadowBlur — uses pre-rendered glows) ----
function drawNeonSkeleton(landmarks) {
    const colors = state.modeColors[state.mode];
    const time = performance.now() * 0.001;
    const W = canvas.width, H = canvas.height;

    // Draw connections — thick colored line + thin white line
    ctx.lineCap = 'round';

    HAND_CONNECTIONS.forEach(([a, b]) => {
        const la = landmarks[a], lb = landmarks[b];
        const x1 = (1 - la.x) * W, y1 = la.y * H;
        const x2 = (1 - lb.x) * W, y2 = lb.y * H;

        // Thick glow line
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        ctx.strokeStyle = hexToRgba(colors.primary, 0.6);
        ctx.lineWidth = 8; ctx.stroke();

        // Main colored line
        const grad = ctx.createLinearGradient(x1, y1, x2, y2);
        grad.addColorStop(0, colors.primary);
        grad.addColorStop(1, colors.secondary);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        ctx.strokeStyle = grad; ctx.lineWidth = 4; ctx.stroke();

        // Inner bright line
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.5; ctx.stroke();
    });

    // Draw joints using pre-rendered glow images
    landmarks.forEach((lm, i) => {
        const x = (1 - lm.x) * W, y = lm.y * H;
        const isTip = FINGERTIPS.includes(i);
        const color = isTip ? colors.tertiary : colors.primary;
        const baseR = isTip ? 10 : 5;
        const r = baseR + (isTip ? Math.sin(time * 5 + i) * 2 : 0);

        // Draw pre-rendered glow
        const glow = getGlow(color, r);
        const gs = r * 4;
        ctx.globalAlpha = isTip ? 0.9 : 0.7;
        ctx.drawImage(glow, x - gs/2, y - gs/2, gs, gs);
        ctx.globalAlpha = 1;

        // White center dot
        ctx.beginPath();
        ctx.arc(x, y, isTip ? 3 : 2, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
    });
}

// ---- Draw geometry (lightweight) ----
function drawGeometry(landmarks) {
    if (!state.showGeometry) return;
    const colors = state.modeColors[state.mode];
    const time = performance.now() * 0.001;
    const W = canvas.width, H = canvas.height;

    const tips = FINGERTIPS.map(idx => ({
        x: (1 - landmarks[idx].x) * W,
        y: landmarks[idx].y * H
    }));

    // Pentagon
    ctx.beginPath();
    tips.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.strokeStyle = hexToRgba(colors.tertiary, 0.3 + Math.sin(time * 2) * 0.1);
    ctx.lineWidth = 1.5; ctx.stroke();

    // Star lines
    ctx.strokeStyle = hexToRgba(colors.secondary, 0.12);
    ctx.lineWidth = 1;
    for (let i = 0; i < tips.length; i++) {
        for (let j = i + 2; j < tips.length; j++) {
            if (i === 0 && j === tips.length - 1) continue;
            ctx.beginPath(); ctx.moveTo(tips[i].x, tips[i].y);
            ctx.lineTo(tips[j].x, tips[j].y); ctx.stroke();
        }
    }

    // Wrist rings (only 2)
    const wx = (1 - landmarks[0].x) * W, wy = landmarks[0].y * H;
    for (let r = 0; r < 2; r++) {
        ctx.beginPath();
        ctx.arc(wx, wy, 20 + r * 15 + Math.sin(time * 3 + r) * 4, 0, Math.PI * 2);
        ctx.strokeStyle = hexToRgba(colors.primary, 0.15);
        ctx.lineWidth = 1; ctx.stroke();
    }
}

// ---- Energy between hands ----
function drawEnergyBetweenHands(allLandmarks) {
    if (allLandmarks.length < 2) return;
    const colors = state.modeColors[state.mode];
    const time = performance.now() * 0.001;
    const W = canvas.width, H = canvas.height;

    FINGERTIPS.forEach((tip, i) => {
        const x1 = (1 - allLandmarks[0][tip].x) * W, y1 = allLandmarks[0][tip].y * H;
        const x2 = (1 - allLandmarks[1][tip].x) * W, y2 = allLandmarks[1][tip].y * H;
        const mx = (x1+x2)/2 + Math.sin(time*6+i)*30;
        const my = (y1+y2)/2 + Math.cos(time*6+i)*30;
        ctx.beginPath(); ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(mx, my, x2, y2);
        ctx.strokeStyle = hexToRgba(colors.tertiary, 0.4);
        ctx.lineWidth = 2; ctx.stroke();
    });
}

// ---- FX layer ----
function drawFxLayer() {
    fxCtx.globalAlpha = 0.06;
    fxCtx.fillStyle = '#0a0a0f';
    fxCtx.fillRect(0, 0, fxCanvas.width, fxCanvas.height);
    fxCtx.globalAlpha = 1;

    // Trails — simple circles, no shadows
    if (state.showTrails) {
        for (let i = state.trails.length - 1; i >= 0; i--) {
            const t = state.trails[i];
            t.life -= 0.015;
            if (t.life <= 0) { state.trails.splice(i, 1); continue; }
            fxCtx.globalAlpha = t.life * 0.5;
            fxCtx.fillStyle = t.color;
            fxCtx.beginPath();
            fxCtx.arc(t.x, t.y, 3 * t.life, 0, Math.PI * 2);
            fxCtx.fill();
        }
    }

    // Particles — simple, no shadows
    if (state.showParticles) {
        for (let i = state.particles.length - 1; i >= 0; i--) {
            const p = state.particles[i]; p.update();
            if (p.life <= 0) { state.particles.splice(i, 1); continue; }
            p.draw(fxCtx);
        }
    }

    fxCtx.globalAlpha = 1;

    // Strict limits
    if (state.particles.length > 200) state.particles.splice(0, state.particles.length - 200);
    if (state.trails.length > 150) state.trails.splice(0, state.trails.length - 150);
}

// ---- Background (minimal) ----
function drawBackground() {
    const colors = state.modeColors[state.mode];
    // Only corner markers, no grid (saves perf)
    const cs = 60;
    ctx.strokeStyle = hexToRgba(colors.primary, 0.15);
    ctx.lineWidth = 1;
    [[0,0,1,1],[canvas.width,0,-1,1],[0,canvas.height,1,-1],[canvas.width,canvas.height,-1,-1]]
        .forEach(([cx,cy,dx,dy]) => {
            ctx.beginPath(); ctx.moveTo(cx, cy+cs*dy); ctx.lineTo(cx, cy); ctx.lineTo(cx+cs*dx, cy);
            ctx.stroke();
        });
}

// ---- Velocity ----
function getVelocity(landmarks) {
    if (state.prevLandmarks.length === 0) return 0;
    let v = 0;
    FINGERTIPS.forEach(idx => {
        const c = landmarks[idx], p = state.prevLandmarks[idx];
        if (!p) return;
        v += Math.sqrt((c.x-p.x)**2 + (c.y-p.y)**2);
    });
    return v / FINGERTIPS.length;
}

function drawVelocityEffects(landmarks, vel) {
    if (vel < 0.008) return;
    const colors = state.modeColors[state.mode];
    // Extra particles on fast movement
    if (vel > 0.015) {
        FINGERTIPS.forEach(tip => {
            const x = (1 - landmarks[tip].x) * canvas.width;
            const y = landmarks[tip].y * canvas.height;
            for (let j = 0; j < 3; j++) {
                const p = new Particle(x, y, colors.tertiary);
                p.speedX *= 2; p.speedY *= 2;
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
        fpsValueEl.textContent = state.fpsFrames;
        state.fpsFrames = 0;
        state.lastFpsTime = now;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(10, 10, 15, 0.45)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawBackground();

    if (allLandmarks && allLandmarks.length > 0) {
        state.handDetected = true;
        allLandmarks.forEach(landmarks => {
            drawNeonSkeleton(landmarks);
            drawGeometry(landmarks);
            state.prevLandmarks = [...landmarks];
        });
        if (allLandmarks.length >= 2) drawEnergyBetweenHands(allLandmarks);
    } else {
        state.handDetected = false;
        ctx.save();
        ctx.font = '300 18px Inter, sans-serif';
        ctx.fillStyle = hexToRgba(state.modeColors[state.mode].primary, 0.5);
        ctx.textAlign = 'center';
        ctx.globalAlpha = Math.sin(now * 0.003) * 0.3 + 0.7;
        ctx.fillText("✋ Qo'lingizni kamera oldiga qo'ying...", canvas.width/2, canvas.height/2);
        ctx.restore();
    }

    drawFxLayer();
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
        log('WASM yuklandi...');
        statusText.textContent = 'Hand model yaratilmoqda...';

        // Try GPU first, fallback to CPU
        let delegate = "GPU";
        try {
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
        } catch {
            log('GPU ishlamadi, CPU ga o\'tilmoqda...');
            statusText.textContent = 'CPU rejimida yuklanmoqda...';
            delegate = "CPU";
            handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                    delegate: "CPU"
                },
                runningMode: "VIDEO",
                numHands: 2,
                minHandDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });
        }

        log(`Model tayyor! (${delegate})`);
        statusText.textContent = `✅ Tayyor! (${delegate}) — "Boshlash" tugmasini bosing`;
        startBtn.style.opacity = '1';
        startBtn.style.pointerEvents = 'auto';

    } catch (err) {
        console.error('Init error:', err);
        log('Xatolik: ' + err.message);
        statusText.textContent = '❌ ' + err.message;
    }
}

async function startCamera() {
    try {
        // Lower resolution = faster
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
        });
        videoEl.srcObject = stream;
        videoEl.classList.add('visible');
        await new Promise(r => { videoEl.onloadedmetadata = () => { videoEl.play(); r(); }; });
        log('Tracking boshlandi');
        detectLoop();
    } catch (err) {
        log('Kamera xatosi: ' + err.message);
    }
}

let lastDetectTime = 0;
function detectLoop() {
    if (!handLandmarker) return;

    const now = performance.now();
    if (videoEl.readyState >= 2 && now > lastDetectTime) {
        const result = handLandmarker.detectForVideo(videoEl, now);
        lastDetectTime = now;
        renderFrame(result.landmarks);
    } else {
        renderFrame(null);
    }

    requestAnimationFrame(detectLoop);
}

// ---- Buttons ----
startBtn.style.opacity = '0.5';
startBtn.style.pointerEvents = 'none';

startBtn.addEventListener('click', async () => {
    if (!handLandmarker) { statusText.textContent = 'Model hali yuklanmoqda...'; return; }
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
    glowCache.clear();
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
