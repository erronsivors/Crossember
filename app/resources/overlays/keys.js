'use strict';
// Клавиатура и мышь: раскладку присылает ядро, нажатия — только для нарисованных клавиш.
const stage = document.getElementById('stage');
let cfg = null;
let layout = [];
const nodes = new Map(); // id → элементы, которые подсвечиваются
const down = new Set();

function add(id, n) {
  if (!nodes.has(id)) nodes.set(id, []);
  nodes.get(id).push(n);
}

function mouse() {
  const m = CB.el('div', 'mouse');
  const parts = [['M1', 'mb l'], ['M2', 'mb r'], ['M3', 'mw'], ['M4', 'ms m4'], ['M5', 'ms m5']];
  for (const [id, cls] of parts) { const n = CB.el('div', cls); m.append(n); add(id, n); }
  m.append(CB.el('div', 'mline'));
  const up = CB.el('div', 'wheel-dir up', '▲');
  const dn = CB.el('div', 'wheel-dir down', '▼');
  m.append(up, dn);
  add('WU', up); add('WD', dn);
  for (const id of ['M1', 'M2', 'M3', 'M4', 'M5', 'WU', 'WD']) add(id, m);
  return m;
}

function draw() {
  if (!cfg) return;
  CB.theme(cfg.theme);
  document.body.style.setProperty('--u', cfg.size + 'px');
  document.body.style.setProperty('--idle', String(cfg.idle / 100));
  nodes.clear();
  const items = [];
  if (layout.length) {
    const kb = CB.el('div', 'kb');
    for (const r of layout) {
      const row = CB.el('div', 'row');
      for (const k of r) {
        const w = 'calc(var(--u) * ' + Number(k.w) + ' + var(--gap) * ' + (Number(k.w) - 1) + ')';
        if (!k.id) { const g = CB.el('div', 'gap'); g.style.width = w; row.append(g); continue; }
        const n = CB.el('div', 'key' + (String(k.label).length > 2 ? ' wide' : ''), k.label);
        n.style.width = w;
        row.append(n);
        add(k.id, n);
      }
      kb.append(row);
    }
    items.push(kb);
  }
  if (cfg.mouse) items.push(mouse());
  stage.replaceChildren(...items);
  paint();
}

function paint() {
  for (const [id, list] of nodes) {
    for (const n of list) {
      if (n.classList.contains('mouse')) continue;
      n.classList.toggle('on', down.has(id));
    }
  }
  const m = stage.querySelector('.mouse');
  if (m) m.classList.toggle('active', ['M1', 'M2', 'M3', 'M4', 'M5', 'WU', 'WD'].some((id) => down.has(id)));
}

CB.on('hello', (d) => {
  cfg = d.overlays.keys;
  layout = Array.isArray(d.keysLayout) ? d.keysLayout : [];
  down.clear();
  for (const id of Array.isArray(d.pressed) ? d.pressed : []) down.add(id);
  draw();
});
CB.on('config', (d) => { cfg = d.overlays.keys; layout = Array.isArray(d.keysLayout) ? d.keysLayout : []; draw(); });
CB.on('key', (d) => {
  if (typeof d.id !== 'string') return;
  if (d.down) down.add(d.id); else down.delete(d.id);
  paint();
});
// Связь пропала — ничего не держим нажатым.
CB.on('closed', () => { down.clear(); paint(); });
CB.connect();
