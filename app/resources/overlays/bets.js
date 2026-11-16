'use strict';
// Ставки: вопрос, исходы с банком, долей и коэффициентом, таймер приёма, в конце — итог.
// После итога или отмены держится HOLD_MS и прячется.
const stage = document.getElementById('stage');
const COLORS = ['#5ec8ff', '#ff5d8f', '#ffc04d', '#7be38a', '#b48cff', '#ff8a4c', '#4de0d0', '#e0e04d', '#ff6b6b', '#9aa7ff'];
const HOLD_MS = 25000;
let cfg = null;
let d = null;
let hideTimer = null;

const n = (x) => Math.round(Number(x) || 0).toLocaleString('ru-RU');
const mmss = (ms) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(t / 60), s = t % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

function hide() {
  if (stage.classList.contains('empty') || stage.classList.contains('hide')) return;
  stage.classList.add('hide');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { stage.className = 'card empty'; stage.replaceChildren(); }, 500);
}

function tick() {
  const c = document.getElementById('clock');
  const b = d && d.bet;
  if (c && b && b.status === 'open' && b.locksAt) {
    const ms = b.locksAt - Date.now();
    c.textContent = mmss(ms);
    c.className = 'clock' + (ms < 15000 ? ' low' : '');
  }
  if (b && (b.status === 'resolved' || b.status === 'canceled') && b.endedAt && Date.now() - b.endedAt > HOLD_MS) hide();
}

function draw() {
  if (!cfg || !d) return;
  CB.theme(cfg.theme);
  document.body.style.setProperty('--fs', cfg.fontSize + 'px');
  const b = d.bet;
  if (!b || ((b.status === 'resolved' || b.status === 'canceled') && b.endedAt && Date.now() - b.endedAt > HOLD_MS)) { hide(); return; }
  clearTimeout(hideTimer);
  const wasHidden = stage.classList.contains('empty') || stage.classList.contains('hide');
  stage.className = 'card' + (wasHidden ? ' hide' : '');
  if (wasHidden) { void stage.offsetWidth; stage.classList.remove('hide'); }

  const top = CB.el('div', 'top');
  top.append(CB.el('span', 'kick', b.source === 'twitch' ? 'Прогноз Twitch' : 'Ставки'));
  const stateText = { open: '', locked: 'ставки закрыты', resolved: 'итог', canceled: 'отменено' }[b.status] || '';
  top.append(CB.el('span', 'state', stateText));
  if (b.status === 'open' && b.locksAt) { const c = CB.el('span', 'clock'); c.id = 'clock'; top.append(c); }
  const nodes = [top, CB.el('div', 'q', b.title)];

  const total = b.total || 0;
  const split = CB.el('div', 'split');
  b.outcomes.forEach((o, i) => {
    const seg = CB.el('i');
    seg.style.background = COLORS[i % COLORS.length];
    seg.style.flexGrow = String(total ? Math.max(o.pool, total * 0.01) : 1);
    split.append(seg);
  });
  nodes.push(split);

  const outs = CB.el('div', 'outs');
  b.outcomes.forEach((o, i) => {
    const box = CB.el('div', 'out' + (b.winner ? (o.id === b.winner ? ' win' : ' lose') : ''));
    box.style.setProperty('--c', COLORS[i % COLORS.length]);
    const line = CB.el('div', 'on');
    line.append(CB.el('span', 'num', '#' + o.num), CB.el('span', 'nm', o.name));
    box.append(line, CB.el('div', 'pool', n(o.pool)));
    const meta = CB.el('div', 'meta');
    meta.append(CB.el('span', '', total ? Math.round((o.pool / total) * 100) + '%' : '0%'));
    const k = d.bet.coefs && d.bet.coefs[o.id];
    if (k) meta.append(CB.el('span', 'coef', '×' + String(k).replace('.', ',')));
    meta.append(CB.el('span', '', '👤 ' + n(o.users)));
    box.append(meta);
    if (cfg.showTop && o.top && o.top.length) box.append(CB.el('div', 'tops', o.top.slice(0, 2).map((t) => t.name + ' ' + n(t.amount)).join(' · ')));
    outs.append(box);
  });
  nodes.push(outs);

  if (b.status === 'resolved') {
    const w = b.outcomes.find((o) => o.id === b.winner);
    const r = CB.el('div', 'res grad', w ? 'Победил исход: ' + w.name : 'Итог подведён');
    if (b.payouts && b.payouts.length) r.append(CB.el('small', '', 'Выиграли: ' + b.payouts.slice(0, 4).map((p) => p.name + ' +' + n(p.won)).join(', ')));
    else if (b.source === 'own') r.append(CB.el('small', '', 'Никто не угадал'));
    nodes.push(r);
  } else if (b.status === 'canceled') {
    nodes.push(CB.el('div', 'res', 'Ставки отменены — всё вернули'));
  } else {
    const foot = CB.el('div', 'foot');
    foot.append(CB.el('span', '', `Банк: ${n(total)} ${d.currency}`));
    if (b.status === 'open' && b.source === 'own') foot.append(CB.el('span', '', `Ставка: ${d.cmd} номер сумма`));
    nodes.push(foot);
  }
  stage.replaceChildren(...nodes);
  tick();
}

CB.on('hello', (m) => { cfg = m.overlays.bets; d = m.bets; draw(); });
CB.on('config', (m) => { cfg = m.overlays.bets; draw(); });
CB.on('bets', (m) => { d = m.bets; draw(); });
setInterval(tick, 250);
CB.connect();
