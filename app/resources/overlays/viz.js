'use strict';
// Визуализатор звука: ядро присылает уровни полос 0–100 (~30 раз в секунду), рисуем плавно на canvas.
const canvas = document.getElementById('c');
const g = canvas.getContext('2d');
let cfg = null;
let target = [];
let shown = [];
let color = '#ffffff';

function resize() {
  const r = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * r);
  canvas.height = Math.round(canvas.clientHeight * r);
}
window.addEventListener('resize', resize);
resize();

function apply(c) {
  cfg = c;
  CB.theme(cfg.theme);
  color = cfg.color || getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#ffffff';
  if (shown.length !== cfg.bars) { shown = new Array(cfg.bars).fill(0); target = new Array(cfg.bars).fill(0); }
}

function roundRect(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.fill();
}

function draw() {
  requestAnimationFrame(draw);
  if (!cfg || !shown.length) return;
  // Подъём быстрый, спад — по «плавности».
  const fall = 1 - Math.min(0.95, cfg.smooth / 100) * 0.92;
  for (let i = 0; i < shown.length; i++) {
    const t = target[i] || 0;
    shown[i] += (t - shown[i]) * (t > shown[i] ? 0.6 : fall * 0.35);
  }
  const W = canvas.width, H = canvas.height, n = shown.length;
  g.clearRect(0, 0, W, H);
  g.fillStyle = color;
  g.strokeStyle = color;
  const min = Math.max(2, H * 0.015);
  if (cfg.style === 'bars' || cfg.style === 'mirror') {
    const step = W / n, w = Math.max(1, step * 0.68);
    for (let i = 0; i < n; i++) {
      const h = Math.max(min, (shown[i] / 100) * H);
      const x = i * step + (step - w) / 2;
      if (cfg.style === 'bars') roundRect(x, H - h, w, h, w / 2);
      else roundRect(x, (H - h) / 2, w, h, w / 2);
    }
  } else if (cfg.style === 'wave') {
    const base = H - min;
    const pts = shown.map((v, i) => [(i / (n - 1)) * W, base - (v / 100) * (H - min * 2)]);
    const curve = () => {
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 0; i < n - 1; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
        g.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      }
      g.lineTo(pts[n - 1][0], pts[n - 1][1]);
    };
    g.beginPath(); curve(); g.lineTo(W, H); g.lineTo(0, H); g.closePath();
    g.globalAlpha = 0.35; g.fill(); g.globalAlpha = 1;
    g.beginPath(); curve();
    g.lineWidth = Math.max(2, H * 0.02); g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke();
  } else {
    // Круг: полосы наружу от окружности.
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.24, len = Math.min(W, H) * 0.24;
    g.lineWidth = Math.max(2, (2 * Math.PI * R / n) * 0.55); g.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const l = Math.max(min, (shown[i] / 100) * len);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      g.lineTo(cx + Math.cos(a) * (R + l), cy + Math.sin(a) * (R + l));
      g.stroke();
    }
  }
}
requestAnimationFrame(draw);

CB.on('hello', (d) => apply(d.overlays.viz));
CB.on('config', (d) => apply(d.overlays.viz));
CB.on('viz', (d) => {
  quiet = Date.now();
  if (!Array.isArray(d.v) || !cfg) return;
  target = d.v.slice(0, cfg.bars).map((x) => (typeof x === 'number' ? x : 0));
});
// Кадры перестали приходить (визуализатор выключен) или связь оборвалась — столбики опадают.
let quiet = null;
CB.on('closed', () => { target = target.map(() => 0); });
setInterval(() => { if (quiet && Date.now() - quiet > 500) target = target.map(() => 0); }, 250);
CB.connect();
