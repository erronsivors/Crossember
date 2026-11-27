'use strict';
// Чат-оверлей. Режим по data-mode на <body>:
//   v — вертикальный, h — горизонтальный (новые слева), f — окно «чат поверх игры».
// Оформление (CSS) собирает ядро из настроек — тот же CSS, что в предпросмотре Crossember.
// Безопасность: текст только через textContent, картинки — только из кэша Crossember (/e/<hash>).
const list = document.getElementById('list');
const mode = document.body.dataset.mode;
const horizontal = mode === 'h';
const styleEl = document.createElement('style');
document.head.append(styleEl);
let opts = null;
let own = [];

const TAG = { twitch: 'Tw', youtube: 'YT', vk: 'VK', kick: 'K', goodgame: 'GG', donationalerts: 'DA', donatepay: 'DP', donatex: 'DX', boosty: 'B', hub: '₽' };
const CHAT_SOURCES = ['twitch', 'youtube', 'vk', 'kick', 'goodgame'];
const hexOk = (c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
// Как isLight в core/chatstyle.ts.
const isLight = (c) => hexOk(c) && (0.299 * parseInt(c.slice(1, 3), 16) + 0.587 * parseInt(c.slice(3, 5), 16) + 0.114 * parseInt(c.slice(5, 7), 16)) / 255 > 0.6;

function apply(overlays) {
  opts = mode === 'h' ? overlays.chatH : mode === 'f' ? overlays.float : overlays.chat;
  CB.theme(opts.theme);
  document.body.style.setProperty('--fs', opts.fontSize + 'px');
  list.classList.toggle('top', mode !== 'h' && !!opts.look.newestTop);
  trim();
}

function applyStyle(cs) {
  if (!cs) return;
  own = Array.isArray(cs.own) ? cs.own : [];
  const key = mode === 'h' ? 'chatH' : mode === 'f' ? 'float' : 'chat';
  styleEl.textContent = (cs.css && cs.css[key]) || '';
}

const newestFirst = () => horizontal || (opts && opts.look.newestTop);

function trim() {
  if (!opts) return;
  while (list.children.length > opts.maxMessages) {
    if (newestFirst()) list.lastElementChild.remove();
    else list.firstElementChild.remove();
  }
}

function mention(text) {
  const t = String(text || '').toLowerCase().replace(/ё/g, 'е');
  return own.some((o) => {
    const n = String(o).toLowerCase().replace(/ё/g, 'е').replace(/^@/, '');
    if (n.length < 2) return false;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^\\p{L}\\p{N}_])@?' + esc + '($|[^\\p{L}\\p{N}_])', 'u').test(t);
  });
}

// Фильтры — как chatHidden/maskLinks в core/chatstyle.ts (держать одинаковыми).
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
const profileNorm = (s) => norm(String(s || '').normalize('NFKC').trim().replace(/^@+/, ''));
const wordList = (s) => norm(s).split(/[\s,;]+/).map((w) => w.replace(/^@/, '')).filter(Boolean);
const LINK_SRC = String.raw`(?:https?:\/\/|www\.)\S+|[\p{L}\p{N}-]+\.(?:ru|com|net|org|tv|gg|io|me|рф|su|xyz|info|ly|be|link|app|dev)(?:\/\S*)?`;
const hasLink = (t) => new RegExp(LINK_SRC, 'iu').test(t);
const maskLinks = (t) => String(t).replace(new RegExp(LINK_SRC, 'giu'), '[ссылка]');

function hidden(m) {
  const f = opts.look.filter;
  if (wordList(f.bots).includes(norm(m.user))) return true;
  if (f.botProfiles && Array.isArray(f.botProfiles[m.platform]) && f.botProfiles[m.platform].some((name) => profileNorm(name) === profileNorm(m.user))) return true;
  const text = m.text || '';
  if (f.commands && /^\s*!/.test(text)) return true;
  if (f.links === 'hide' && hasLink(text)) return true;
  const words = wordList(f.words);
  if (words.length) { const t = norm(text); if (words.some((w) => t.includes(w))) return true; }
  return false;
}

function emoteOnly(m) {
  const p = Array.isArray(m.parts) ? m.parts : [];
  return p.some((x) => x.t === 'emote') && p.every((x) => x.t === 'emote' || !String(x.v).trim());
}

const hhmm = (ts) => { const d = new Date(ts || Date.now()); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

function platOk(p) {
  const pl = opts.look.platforms;
  return !CHAT_SOURCES.includes(p) || !pl.length || pl.includes(p);
}

function visible(m, view) {
  if (m.type === 'message') return platOk(m.platform) && !hidden(m);
  if (m.type === 'system') return opts.showStatus;
  return !!view && !!opts.look.events[view.kind] && platOk(m.platform);
}

function platSpan(p) {
  const s = CB.el('span', 'plat', opts.look.plat === 'tag' ? (TAG[p] || '') : '');
  const c = opts.look.colors[p];
  if (hexOk(c)) {
    s.style.setProperty('--pc', c);
    if (opts.look.plat === 'tag' && isLight(c)) s.style.color = '#16161c';
  }
  return s;
}

function textNode(m) {
  const mask = opts.look.filter.links === 'mask';
  if (opts.look.showEmotes) {
    if (!mask || !Array.isArray(m.parts)) return CB.parts(mask ? { text: maskLinks(m.text || '') } : m);
    return CB.parts({ parts: m.parts.map((p) => (p.t === 'text' ? { t: 'text', v: maskLinks(p.v) } : p)) });
  }
  return document.createTextNode(mask ? maskLinks(m.text || '') : (m.text || ''));
}

function messageRow(m) {
  const look = opts.look;
  const row = CB.el('div', 'msg');
  row.dataset.id = m.id;
  if (m.userId) row.dataset.user = m.platform + ':' + m.userId;
  row.dataset.platform = m.platform;
  if (look.events.mention && mention(m.text)) row.classList.add('mention');
  if (m.role && look.roles[m.role]) row.classList.add('role-' + m.role);
  if (look.bigEmotes && look.showEmotes && emoteOnly(m)) row.classList.add('emo-only');
  if (look.time) row.append(CB.el('span', 'time', hhmm(m.ts)));
  if (opts.showPlatform) row.append(platSpan(m.platform));
  if (opts.showBadges && Array.isArray(m.badges)) for (const b of m.badges) row.append(CB.img(b.url, 'badge', b.title));
  if (look.showName) {
    const name = CB.el('span', 'name', m.user);
    if (look.textMode === 'split' && look.name.color) name.classList.add('fixed');
    else if (hexOk(m.color)) name.style.color = m.color;
    if (!look.sep) name.classList.add('nosep');
    row.append(name);
    if (look.sep) row.append(CB.el('span', 'sep', look.sep));
  }
  const text = CB.el('span', 'text');
  text.append(textNode(m));
  row.append(text);
  return row;
}

function eventRow(m, view) {
  const look = opts.look;
  const row = CB.el('div', 'msg ev ev-' + view.kind);
  row.dataset.id = m.id;
  row.dataset.platform = m.platform;
  const c = look.colors[view.color];
  if (hexOk(c)) { row.style.setProperty('--ec', c); row.style.setProperty('--ecf', c + '4d'); }
  const head = CB.el('div', 'ev-head');
  if (look.time) head.append(CB.el('span', 'time', hhmm(m.ts)));
  if (opts.showPlatform) head.append(platSpan(m.platform));
  head.append(CB.el('span', 'name', m.user), CB.el('span', 'ev-label', view.icon + ' ' + view.label));
  if (view.detail) head.append(CB.el('span', 'ev-detail', view.detail));
  row.append(head);
  if (view.body) {
    const body = CB.el('div', 'ev-body');
    body.append(CB.el('span', 'text', view.body));
    row.append(body);
  }
  return row;
}

function add(m, view, animate) {
  let row;
  if (m.type === 'system') {
    row = CB.el('div', 'msg system', m.text);
    row.dataset.platform = m.platform;
  } else if (m.type === 'message') row = messageRow(m);
  else row = eventRow(m, view);
  if (!animate) row.classList.add('still');
  if (newestFirst()) list.prepend(row);
  else list.append(row);
  trim();
  if (opts.hideAfterSec > 0) {
    setTimeout(() => {
      row.classList.remove('still');
      row.classList.add('gone');
      setTimeout(() => row.remove(), (opts.look.animMs || 300) + 80);
    }, opts.hideAfterSec * 1000);
  }
}

CB.on('hello', (d) => {
  apply(d.overlays);
  applyStyle(d.chatStyle);
  list.replaceChildren();
  // Последние сообщения и события при перезапуске источника — только те, что ещё не должны были исчезнуть.
  const now = Date.now();
  const all = [...(d.chat || []).map((m) => ({ m, view: null })), ...(d.events || []).filter((e) => e.type !== 'message' && e.type !== 'system').map((e) => ({ m: e, view: e.view || null }))]
    .filter((x) => visible(x.m, x.view) && (opts.hideAfterSec === 0 || now - x.m.ts < opts.hideAfterSec * 1000))
    .sort((a, b) => b.m.ts - a.m.ts)
    .slice(0, opts.maxMessages)
    .reverse();
  for (const x of all) add(x.m, x.view, false);
});
CB.on('config', (d) => { apply(d.overlays); applyStyle(d.chatStyle); });
CB.on('event', (d) => { if (opts && d.event && visible(d.event, d.view)) add(d.event, d.view, true); });
CB.on('chattest', (d) => { if (opts && d.event && visible(d.event, d.view)) add(d.event, d.view, true); });
CB.on('delete', (d) => {
  for (const row of [...list.children]) {
    const byId = d.id && row.dataset.id === d.id;
    const byUser = d.userId && row.dataset.user === d.platform + ':' + d.userId;
    const byPlatform = !d.id && !d.userId && d.platform && row.dataset.platform === d.platform && !row.classList.contains('system');
    if (byId || byUser || byPlatform) row.remove();
  }
});
CB.connect();
