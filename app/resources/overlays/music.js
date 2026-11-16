'use strict';
// «Сейчас играет»: обложка (только data:-картинка от Crossember), название, исполнитель, кто заказал, полоса времени.
const stage = document.getElementById('stage');
let cfg = null;
let d = null;
let lastKey = '';
let hideTimer = null;

function hide() {
  if (stage.classList.contains('empty') || stage.classList.contains('hide')) return;
  stage.classList.add('hide');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { stage.className = 'card empty'; stage.replaceChildren(); lastKey = ''; }, 500);
}

function pos(nw) {
  if (!nw || !nw.durMs) return 0;
  const p = nw.playing ? nw.posMs + (Date.now() - nw.at) : nw.posMs;
  return Math.max(0, Math.min(1, p / nw.durMs));
}

function tick() {
  const i = document.getElementById('prog');
  if (i && d && d.now) i.style.width = pos(d.now) * 100 + '%';
}

function draw() {
  if (!cfg || !d) return;
  CB.theme(cfg.theme);
  document.body.style.setProperty('--fs', cfg.fontSize + 'px');
  const nw = d.now;
  if (!nw || !nw.title || (cfg.hideWhenPaused && !nw.playing)) { hide(); return; }
  clearTimeout(hideTimer);
  const wasHidden = stage.classList.contains('empty') || stage.classList.contains('hide');
  stage.className = 'card' + (nw.playing ? '' : ' paused') + (wasHidden ? ' hide' : '');
  if (wasHidden) { void stage.offsetWidth; stage.classList.remove('hide'); }
  const key = nw.title + '|' + nw.artist;
  let art;
  if (typeof nw.image === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(nw.image)) {
    art = CB.el('img', 'art');
    art.src = nw.image;
    art.alt = '';
  } else art = CB.el('div', 'art', '♫');
  const info = CB.el('div', 'info' + (key !== lastKey ? ' swap' : ''));
  const k = CB.el('div', 'kick', 'Сейчас играет');
  if (cfg.showRequester && nw.requester) k.append(CB.el('span', 'who', 'заказал ' + nw.requester));
  info.append(k, CB.el('div', 't', nw.title));
  if (nw.artist) info.append(CB.el('div', 'a', nw.artist));
  if (cfg.showProgress && nw.durMs > 0) {
    const bar = CB.el('div', 'bar');
    const fill = CB.el('i');
    fill.id = 'prog';
    bar.append(fill);
    info.append(bar);
  }
  lastKey = key;
  stage.replaceChildren(art, info);
  tick();
}

CB.on('hello', (m) => { cfg = m.overlays.music; d = m.music; draw(); });
CB.on('config', (m) => { cfg = m.overlays.music; draw(); });
CB.on('music', (m) => { d = m.music; draw(); });
setInterval(tick, 500);
CB.connect();
