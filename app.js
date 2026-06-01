'use strict';

// ─── Palette ─────────────────────────────────────────────────────────────────
const PALETTE_COLORS = [
  '#000000','#ffffff','#7f7f7f','#c3c3c3',
  '#880015','#ed1c24','#ff7f27','#fff200',
  '#22b14c','#b5e61d','#00a2e8','#99d9ea',
  '#3f48cc','#7092be','#a349a4','#c8bfe7',
  '#6b3400','#b97a57','#ffaec9','#ffc90e',
];

// ─── State ────────────────────────────────────────────────────────────────────
const S = {
  tool:      'pencil',
  fg:        '#000000',
  bg:        '#ffffff',
  size:      5,
  drawing:   false,
  startX:    0,
  startY:    0,
  lastX:     0,
  lastY:     0,
  undoStack: [],
  redoStack: [],
};

// ─── Canvas setup ─────────────────────────────────────────────────────────────
const mainCanvas    = document.getElementById('main-canvas');
const overlayCanvas = document.getElementById('overlay-canvas');
const ctx  = mainCanvas.getContext('2d',    { willReadFrequently: true });
const octx = overlayCanvas.getContext('2d', { willReadFrequently: true });

ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
pushUndo();

// ─── Undo / Redo ──────────────────────────────────────────────────────────────
function pushUndo() {
  S.undoStack.push(mainCanvas.toDataURL());
  if (S.undoStack.length > 30) S.undoStack.shift();
  S.redoStack = [];
}

function applyUndo() {
  if (S.undoStack.length < 2) return;
  S.redoStack.push(S.undoStack.pop());
  loadDataURL(S.undoStack[S.undoStack.length - 1]);
}

function applyRedo() {
  if (!S.redoStack.length) return;
  const url = S.redoStack.pop();
  S.undoStack.push(url);
  loadDataURL(url);
}

function loadDataURL(url) {
  const img = new Image();
  img.onload = () => { ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height); ctx.drawImage(img, 0, 0); };
  img.src = url;
}

// ─── Color helpers ────────────────────────────────────────────────────────────
function hexToRGBA(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 255 };
}

function rgbaToHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// ─── Flood fill ───────────────────────────────────────────────────────────────
function floodFill(sx, sy, fillHex) {
  sx = Math.round(sx); sy = Math.round(sy);
  const W = mainCanvas.width, H = mainCanvas.height;
  if (sx < 0 || sx >= W || sy < 0 || sy >= H) return;

  const imageData = ctx.getImageData(0, 0, W, H);
  const d = imageData.data;
  const gi = (x, y) => (y * W + x) * 4;

  const si = gi(sx, sy);
  const [tr, tg, tb, ta] = [d[si], d[si+1], d[si+2], d[si+3]];
  const fc = hexToRGBA(fillHex);

  if (tr === fc.r && tg === fc.g && tb === fc.b && ta === 255) return;

  const match = i => d[i]===tr && d[i+1]===tg && d[i+2]===tb && d[i+3]===ta;
  const paint = i => { d[i]=fc.r; d[i+1]=fc.g; d[i+2]=fc.b; d[i+3]=255; };

  const visited = new Uint8Array(W * H);
  const queue = [sy * W + sx];
  visited[sy * W + sx] = 1;

  while (queue.length) {
    const pos = queue.pop();
    const x = pos % W, y = (pos / W) | 0;
    paint(pos * 4);
    const nbrs = [
      x > 0     ? pos - 1 : -1,
      x < W - 1 ? pos + 1 : -1,
      y > 0     ? pos - W : -1,
      y < H - 1 ? pos + W : -1,
    ];
    for (const n of nbrs) {
      if (n >= 0 && !visited[n] && match(n * 4)) {
        visited[n] = 1;
        queue.push(n);
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

// ─── Drawing primitives ───────────────────────────────────────────────────────
function ctxLine(c, x1, y1, x2, y2, color, size) {
  c.beginPath();
  c.strokeStyle = color;
  c.lineWidth   = size;
  c.lineCap     = 'round';
  c.lineJoin    = 'round';
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.stroke();
}

function ctxRect(c, x1, y1, x2, y2, color, size, filled) {
  const x = Math.min(x1,x2), y = Math.min(y1,y2);
  const w = Math.abs(x2-x1),  h = Math.abs(y2-y1);
  if (filled) { c.fillStyle = color; c.fillRect(x, y, w, h); }
  else        { c.strokeStyle = color; c.lineWidth = size; c.strokeRect(x, y, w, h); }
}

function ctxEllipse(c, x1, y1, x2, y2, color, size, filled) {
  const cx = (x1+x2)/2, cy = (y1+y2)/2;
  const rx = Math.abs(x2-x1)/2, ry = Math.abs(y2-y1)/2;
  c.beginPath();
  c.ellipse(cx, cy, Math.max(rx,1), Math.max(ry,1), 0, 0, Math.PI*2);
  if (filled) { c.fillStyle = color; c.fill(); }
  else        { c.strokeStyle = color; c.lineWidth = size; c.stroke(); }
}

// ─── Pointer position ─────────────────────────────────────────────────────────
function getPos(e) {
  const rect  = mainCanvas.getBoundingClientRect();
  const scaleX = mainCanvas.width  / rect.width;
  const scaleY = mainCanvas.height / rect.height;
  const src    = e.touches ? e.touches[0] : e;
  return {
    x: Math.round((src.clientX - rect.left) * scaleX),
    y: Math.round((src.clientY - rect.top)  * scaleY),
  };
}

function activeColor(e) {
  return (e.button === 2 || (e.buttons & 2)) ? S.bg : S.fg;
}

// ─── Mouse/touch handlers ─────────────────────────────────────────────────────
overlayCanvas.addEventListener('mousedown',  onDown);
overlayCanvas.addEventListener('mousemove',  onMove);
overlayCanvas.addEventListener('mouseup',    onUp);
overlayCanvas.addEventListener('mouseleave', onLeave);
overlayCanvas.addEventListener('contextmenu', e => e.preventDefault());

overlayCanvas.addEventListener('touchstart',  e => { e.preventDefault(); onDown(e); }, { passive: false });
overlayCanvas.addEventListener('touchmove',   e => { e.preventDefault(); onMove(e); }, { passive: false });
overlayCanvas.addEventListener('touchend',    e => { e.preventDefault(); onUp(e);   }, { passive: false });

function onDown(e) {
  e.preventDefault();
  const { x, y } = getPos(e);
  const color     = activeColor(e);

  S.drawing = true;
  S.startX = S.lastX = x;
  S.startY = S.lastY = y;

  switch (S.tool) {
    case 'pencil':
    case 'brush':
      ctx.beginPath();
      ctx.arc(x, y, S.size / 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      break;

    case 'eraser':
      ctx.beginPath();
      ctx.arc(x, y, S.size / 2, 0, Math.PI * 2);
      ctx.fillStyle = S.bg;
      ctx.fill();
      break;

    case 'fill':
      pushUndo();
      floodFill(x, y, color);
      S.drawing = false;
      break;

    case 'eyedropper': {
      const px = ctx.getImageData(x, y, 1, 1).data;
      const hex = rgbaToHex(px[0], px[1], px[2]);
      if (e.button === 2) setColor('bg', hex);
      else                setColor('fg', hex);
      S.drawing = false;
      break;
    }

    case 'line':
    case 'rect':
    case 'rect-fill':
    case 'ellipse':
    case 'ellipse-fill':
      // snapshot for clean preview
      break;
  }
}

function onMove(e) {
  const { x, y } = getPos(e);
  document.getElementById('cursor-coords').textContent = `${x}, ${y}`;
  if (!S.drawing) return;

  const color = activeColor(e);

  switch (S.tool) {
    case 'pencil':
    case 'brush':
      ctxLine(ctx, S.lastX, S.lastY, x, y, color, S.size);
      S.lastX = x; S.lastY = y;
      break;

    case 'eraser':
      ctxLine(ctx, S.lastX, S.lastY, x, y, S.bg, S.size);
      S.lastX = x; S.lastY = y;
      break;

    case 'line':
      octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      ctxLine(octx, S.startX, S.startY, x, y, color, S.size);
      break;

    case 'rect':
      octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      ctxRect(octx, S.startX, S.startY, x, y, color, S.size, false);
      break;

    case 'rect-fill':
      octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      ctxRect(octx, S.startX, S.startY, x, y, color, S.size, true);
      break;

    case 'ellipse':
      octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      ctxEllipse(octx, S.startX, S.startY, x, y, color, S.size, false);
      break;

    case 'ellipse-fill':
      octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      ctxEllipse(octx, S.startX, S.startY, x, y, color, S.size, true);
      break;
  }
}

function onUp(e) {
  if (!S.drawing) return;
  const { x, y } = getPos(e);
  const color     = activeColor(e);

  switch (S.tool) {
    case 'pencil':
    case 'brush':
    case 'eraser':
      pushUndo();
      break;

    case 'line':
      octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      ctxLine(ctx, S.startX, S.startY, x, y, color, S.size);
      pushUndo();
      break;

    case 'rect':
      octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      ctxRect(ctx, S.startX, S.startY, x, y, color, S.size, false);
      pushUndo();
      break;

    case 'rect-fill':
      octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      ctxRect(ctx, S.startX, S.startY, x, y, color, S.size, true);
      pushUndo();
      break;

    case 'ellipse':
      octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      ctxEllipse(ctx, S.startX, S.startY, x, y, color, S.size, false);
      pushUndo();
      break;

    case 'ellipse-fill':
      octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      ctxEllipse(ctx, S.startX, S.startY, x, y, color, S.size, true);
      pushUndo();
      break;
  }

  S.drawing = false;
}

function onLeave(e) {
  if (S.drawing) onUp(e);
  document.getElementById('cursor-coords').textContent = '—, —';
}

// ─── Overlay passthrough ──────────────────────────────────────────────────────
// The overlay sits on top; for non-shape tools it should pass clicks through.
overlayCanvas.style.pointerEvents = 'auto';

// ─── UI: tool buttons ─────────────────────────────────────────────────────────
const toolNames = {
  pencil: 'Pencil', brush: 'Brush', eraser: 'Eraser', fill: 'Fill',
  eyedropper: 'Eyedropper', line: 'Line',
  rect: 'Rectangle', 'rect-fill': 'Filled Rectangle',
  ellipse: 'Ellipse', 'ellipse-fill': 'Filled Ellipse',
};

document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.tool = btn.dataset.tool;
    updateStatusBar();
  });
});

// ─── UI: size buttons ─────────────────────────────────────────────────────────
document.querySelectorAll('.size-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.size = parseInt(btn.dataset.size, 10);
    updateStatusBar();
  });
});

function updateStatusBar() {
  document.getElementById('active-tool-name').textContent =
    `${toolNames[S.tool] || S.tool} · size ${S.size}`;
}

// ─── UI: colors ───────────────────────────────────────────────────────────────
function setColor(which, hex) {
  S[which] = hex;
  document.getElementById(which === 'fg' ? 'fg-chip' : 'bg-chip').style.background = hex;
  if (which === 'fg') document.getElementById('custom-color-input').value = hex;
}

// Build palette
const paletteEl = document.getElementById('palette');
PALETTE_COLORS.forEach(hex => {
  const sw = document.createElement('div');
  sw.className = 'palette-swatch';
  sw.style.background = hex;
  sw.title = hex;
  sw.addEventListener('click', () => setColor('fg', hex));
  sw.addEventListener('contextmenu', e => { e.preventDefault(); setColor('bg', hex); });
  paletteEl.appendChild(sw);
});

setColor('fg', S.fg);
setColor('bg', S.bg);

document.getElementById('custom-color-input').addEventListener('input', e => {
  setColor('fg', e.target.value);
});

document.getElementById('fg-chip').addEventListener('click', () => {
  document.getElementById('custom-color-input').click();
});

document.getElementById('bg-chip').addEventListener('contextmenu', e => e.preventDefault());

document.getElementById('swap-colors').addEventListener('click', () => {
  const tmp = S.fg;
  setColor('fg', S.bg);
  setColor('bg', tmp);
});

// ─── UI: action buttons ───────────────────────────────────────────────────────
document.getElementById('undo-btn').addEventListener('click', applyUndo);
document.getElementById('redo-btn').addEventListener('click', applyRedo);

document.getElementById('clear-btn').addEventListener('click', () => {
  pushUndo();
  ctx.fillStyle = S.bg;
  ctx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
});

document.getElementById('save-btn').addEventListener('click', () => {
  const a = document.createElement('a');
  a.download = 'drawing.png';
  a.href = mainCanvas.toDataURL('image/png');
  a.click();
});

// ── Canvas resize ─────────────────────────────────────────────────────────────
let currentSize = '640x480';

document.getElementById('canvas-size').addEventListener('change', e => {
  if (e.target.value === 'custom') {
    document.getElementById('custom-size-inputs').classList.remove('hidden');
  } else {
    document.getElementById('custom-size-inputs').classList.add('hidden');
    const [w, h] = e.target.value.split('x').map(Number);
    applyResize(w, h, e.target.value);
  }
});

document.getElementById('apply-size').addEventListener('click', () => {
  const w = parseInt(document.getElementById('custom-w').value, 10);
  const h = parseInt(document.getElementById('custom-h').value, 10);
  if (!w || !h || w < 50 || h < 50 || w > 3840 || h > 2160) {
    alert('Please enter a width between 50–3840 and height between 50–2160.');
    return;
  }
  applyResize(w, h, 'custom');
});

function applyResize(w, h, sizeKey) {
  if (S.undoStack.length > 1) {
    if (!confirm(`Resize canvas to ${w} × ${h}?\nThis will clear your current drawing.`)) {
      document.getElementById('canvas-size').value = currentSize;
      return;
    }
  }
  mainCanvas.width     = w;
  mainCanvas.height    = h;
  overlayCanvas.width  = w;
  overlayCanvas.height = h;
  ctx.fillStyle = S.bg;
  ctx.fillRect(0, 0, w, h);
  S.undoStack = [];
  S.redoStack = [];
  pushUndo();
  currentSize = sizeKey;
  document.getElementById('canvas-dims').textContent = `${w} × ${h}`;
}

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.ctrlKey && e.key === 'z') { e.preventDefault(); applyUndo(); }
  if (e.ctrlKey && e.key === 'y') { e.preventDefault(); applyRedo(); }
  if (e.ctrlKey && e.key === 's') { e.preventDefault(); document.getElementById('save-btn').click(); }
});

// ─── Tab switching ────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab + '-tab').classList.add('active');
    if (btn.dataset.tab === 'gallery') loadGallery();
  });
});

// ─── Submit modal ─────────────────────────────────────────────────────────────
document.getElementById('submit-btn').addEventListener('click', () => {
  const tmp = document.createElement('canvas');
  tmp.width = 480; tmp.height = 360;
  tmp.getContext('2d').drawImage(mainCanvas, 0, 0, 480, 360);

  document.getElementById('preview-img').src = tmp.toDataURL('image/jpeg', 0.85);
  document.getElementById('art-title').value    = '';
  document.getElementById('creator-name').value = '';
  setFeedback('', '');
  document.getElementById('submit-modal').classList.remove('hidden');
  document.getElementById('art-title').focus();
});

document.getElementById('cancel-btn').addEventListener('click', () => {
  document.getElementById('submit-modal').classList.add('hidden');
});

document.getElementById('submit-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
});

document.getElementById('confirm-btn').addEventListener('click', async () => {
  const title   = document.getElementById('art-title').value.trim();
  const creator = document.getElementById('creator-name').value.trim();

  if (!title || !creator) {
    setFeedback('err', 'Please fill in both the title and your name.');
    return;
  }

  const tmp = document.createElement('canvas');
  tmp.width = 480; tmp.height = 360;
  tmp.getContext('2d').drawImage(mainCanvas, 0, 0, 480, 360);
  const image = tmp.toDataURL('image/jpeg', 0.75);

  const btn = document.getElementById('confirm-btn');
  btn.disabled = true;
  btn.textContent = 'Submitting…';
  setFeedback('', '');

  try {
    await postSubmission(title, creator, image);
    setFeedback('ok', '✓ Submitted! Your creation is now pending review.');
    setTimeout(() => document.getElementById('submit-modal').classList.add('hidden'), 3200);
  } catch (err) {
    setFeedback('err', `Failed: ${err.message}`);
  }

  btn.disabled = false;
  btn.textContent = 'Submit for Review';
});

function setFeedback(type, msg) {
  const el = document.getElementById('submit-feedback');
  el.className = type ? `submit-feedback ${type}` : 'submit-feedback hidden';
  el.textContent = msg;
}

// ─── GitHub submission (via Cloudflare Worker proxy) ─────────────────────────
async function postSubmission(title, creator, image) {
  if (!CONFIG.workerUrl) {
    throw new Error('Submissions are not configured yet. Contact the site admin.');
  }

  const body = JSON.stringify({ title, creator, image, submitted: new Date().toISOString() });

  const res = await fetch(CONFIG.workerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `[Submission] ${title} — by ${creator}`,
      body,
      labels: ['submission', 'pending'],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Worker error (${res.status})`);
  }
}

// ─── Gallery ──────────────────────────────────────────────────────────────────
let galleryLoaded = false;

async function loadGallery() {
  const grid = document.getElementById('gallery-grid');
  const { owner, repo } = CONFIG.github;

  if (!owner || !repo) {
    grid.innerHTML = '<div class="gallery-message">Gallery is not configured yet.</div>';
    return;
  }

  if (galleryLoaded) return;   // don't re-fetch on every tab switch unless Refresh pressed
  grid.innerHTML = '<div class="gallery-message">Loading…</div>';

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues?labels=approved&state=open&per_page=100&_=${Date.now()}`,
      { headers: { Accept: 'application/vnd.github.v3+json' } }
    );
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const issues = await res.json();

    grid.innerHTML = '';

    if (!issues.length) {
      grid.innerHTML = '<div class="gallery-message">No approved creations yet — be the first to submit!</div>';
      return;
    }

    let count = 0;
    for (const issue of issues) {
      try {
        const data = JSON.parse(issue.body);
        grid.appendChild(makeCard(data, issue.created_at));
        count++;
      } catch { /* skip malformed */ }
    }

    if (!count) {
      grid.innerHTML = '<div class="gallery-message">No creations to display yet.</div>';
    }

    galleryLoaded = true;
  } catch (err) {
    grid.innerHTML = `<div class="gallery-message">Could not load gallery: ${esc(err.message)}</div>`;
  }
}

document.getElementById('refresh-btn').addEventListener('click', () => {
  galleryLoaded = false;
  loadGallery();
});

function makeCard(data, isoDate) {
  const date = new Date(isoDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const meta = `by ${esc(data.creator)} · ${date}`;
  const card  = document.createElement('div');
  card.className = 'gallery-card';
  card.innerHTML = `
    <div class="gallery-card-img">
      <img src="${esc(data.image)}" alt="${esc(data.title)}" loading="lazy">
      <button class="gallery-expand-btn" title="View full size">
        <i class="bi bi-fullscreen"></i>
      </button>
    </div>
    <div class="gallery-card-body">
      <div class="gallery-card-title">${esc(data.title)}</div>
      <div class="gallery-card-meta">${meta}</div>
    </div>
  `;

  const open = () => openLightbox(data.image, data.title, `by ${data.creator} · ${date}`);
  card.querySelector('.gallery-card-img').addEventListener('click', open);

  return card;
}

// ── Lightbox ──────────────────────────────────────────────────────────────────
const lightbox = document.getElementById('lightbox');

const lightboxLabel = document.getElementById('lightbox-zoom-label');
const lightboxImg   = document.getElementById('lightbox-img');
const lightboxInner = document.querySelector('.lightbox-inner');
const BASE_WIDTH    = 645;
const ZOOM_STEP     = 0.25;
const ZOOM_MIN      = 0.25;
const ZOOM_MAX      = 4;
let   zoomLevel     = 1;

document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

document.getElementById('lightbox-zoom-out').addEventListener('click', () => setZoom(zoomLevel - ZOOM_STEP));
document.getElementById('lightbox-zoom-in' ).addEventListener('click', () => setZoom(zoomLevel + ZOOM_STEP));

function setZoom(level) {
  zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
  const w   = Math.min(BASE_WIDTH * zoomLevel, window.innerWidth * 0.98);
  lightboxInner.style.width = w + 'px';
  lightboxLabel.textContent = Math.round(zoomLevel * 100) + '%';
  document.getElementById('lightbox-zoom-out').disabled = zoomLevel <= ZOOM_MIN;
  document.getElementById('lightbox-zoom-in' ).disabled = zoomLevel >= ZOOM_MAX;
}

function openLightbox(src, title, meta) {
  lightboxImg.src = src;
  lightboxImg.alt = title;
  document.getElementById('lightbox-title').textContent = title;
  document.getElementById('lightbox-meta').textContent  = meta;
  zoomLevel = 1;
  lightboxInner.style.width = '';
  lightboxLabel.textContent = '100%';
  document.getElementById('lightbox-zoom-out').disabled = false;
  document.getElementById('lightbox-zoom-in' ).disabled = false;
  lightbox.classList.remove('hidden');
  lightbox.scrollTop = 0;
}

function closeLightbox() {
  lightbox.classList.add('hidden');
  lightboxImg.src = '';
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
