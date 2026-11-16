'use strict';
// Сабатон: большой таймер, пометка «пауза» и «счастливый час», всплывающие «+5:00 подписка».
const stage = document.getElementById('stage');
const clockEl = document.getElementById('clock');
const kickEl = document.getElementById('kick');
const subEl = document.getElementById('sub');
const adds = document.getElementById('adds');
let cfg = null;
let st = null;

const hms = (ms) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};
const plusTime = (sec) => {
  const m = Math.floor(sec / 60), s = sec % 60;
  return '+' + (m ? m + ':' + String(s).padStart(2, '0') : s + ' с');
};

function left() {
  if (!st) return 0;
  if (st.endsAt) return st.endsAt - Date.now();
  return st.pausedLeft || 0;
}

function tick() {
  if (!st || st.startedAt === null) return;
  const ms = left();
  clockEl.textContent = hms(ms);
  clockEl.className = 'clock' + (!st.running ? ' paused' : '') + (st.running && ms < 300000 ? ' low' : '');
}

function draw() {
  if (!cfg || !st) return;
  CB.theme(cfg.theme);
  document.body.style.setProperty('--fs', cfg.fontSize + 'px');
  if (st.startedAt === null) { stage.className = 'card empty'; return; }
  stage.className = 'card';
  kickEl.replaceChildren(document.createTextNode(st.ended ? 'Сабатон окончен' : st.running ? 'Сабатон' : 'Сабатон · пауза'));
  if (st.happy) { kickEl.append(' · '); kickEl.append(CB.el('b', '', 'счастливый час')); }
  subEl.textContent = st.capped ? 'достигнут предел' : '';
  tick();
}

function pop(a) {
  if (!cfg || !cfg.showAdds || !a || !(a.sec > 0)) return;
  const n = CB.el('div', 'add', plusTime(a.sec));
  n.append(CB.el('small', '', (a.user ? a.user + ' · ' : '') + (a.reason || '')));
  adds.append(n);
  setTimeout(() => n.remove(), 3100);
}

CB.on('hello', (m) => { cfg = m.overlays.subathon; st = m.subathon; draw(); });
CB.on('config', (m) => { cfg = m.overlays.subathon; draw(); });
CB.on('subathon', (m) => { st = m.subathon; draw(); });
CB.on('subathon-add', (m) => pop(m.add));
setInterval(tick, 250);
CB.connect();
