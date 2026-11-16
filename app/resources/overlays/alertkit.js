// Crossember — движок показа алертов из слоёв (конструктор). Один и тот же файл работает
// в оверлее OBS и в редакторе приложения (предпросмотр и перемотка), поэтому в редакторе видно ровно то, что будет в эфире.
// Безопасность: текст — только textContent, ссылки на файлы — только наши /m/ /s/ /t/ по строгому шаблону, цвета — только #RRGGBB.
'use strict';
(function () {
  const W = 1920, H = 1080;
  const ANIMATED_RE = /^\/m\/.+\.(webp|gif)$|\/corner\/hero\/(?![a-z0-9-]*-still\.)[a-z0-9-]+\.webp$/;
  const CSS_EASE = { linear: 'linear', ease: 'ease', in: 'ease-in', out: 'ease-out', inout: 'ease-in-out', back: 'cubic-bezier(.2,.9,.3,1.35)' };
  const EASE_FN = {
    linear: (p) => p,
    ease: (p) => p * p * (3 - 2 * p),
    in: (p) => p * p,
    out: (p) => 1 - (1 - p) * (1 - p),
    inout: (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2),
    back: (p) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); }
  };
  const FONT = { manrope: "'Manrope', sans-serif", unbounded: "'Unbounded', sans-serif", mono: "'JetBrains Mono', monospace" };
  const ICON = { donation: '₽', sub: '★', gift: '🎁', follow: '♥', raid: '↗', bits: '◆', reward: '✦', message: '💬' };
  const SRC_RE = /^\/(m\/[0-9a-f]{32}\.(png|jpg|gif|webp|webm|mp4)|b\/[a-z0-9-]{1,48}\.svg|p\/[0-9]{2}-[a-z0-9-]{1,60}\/([a-z0-9-]+\.webp|corner\/(parts|hero)\/[a-z0-9-]{1,40}\.(webp|png))|s\/[0-9a-f]{32}\.(mp3|wav|ogg)|t\/[0-9a-f]{40}\.wav)$/;
  const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  const WIPE = { right: ['inset(0 100% 0 0)', 'inset(0 0% 0 0)'], down: ['inset(0 0 100% 0)', 'inset(0 0 0% 0)'], circle: ['circle(0% at 50% 50%)', 'circle(75% at 50% 50%)'] };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  };
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  /** Сколько длится слой: duration 0 — до конца алерта. */
  function layerDur(l, total) {
    return l.duration > 0 ? l.duration : Math.max(0, total - l.start);
  }

  /** Состояние слоя (позиция, масштаб, поворот, прозрачность) через t мс от его начала. */
  function sample(l, t) {
    const k = Array.isArray(l.keyframes) ? l.keyframes : [];
    if (!k.length) return { x: l.x, y: l.y, scale: 1, rotate: l.rotate, opacity: l.opacity };
    if (t <= k[0].t) return pick(k[0]);
    const last = k[k.length - 1];
    if (t >= last.t) return pick(last);
    for (let i = 0; i < k.length - 1; i++) {
      const a = k[i], b = k[i + 1];
      if (t >= a.t && t <= b.t) {
        const p = b.t === a.t ? 1 : (EASE_FN[a.ease] || EASE_FN.ease)((t - a.t) / (b.t - a.t));
        const lerp = (x, y) => x + (y - x) * p;
        return { x: lerp(a.x, b.x), y: lerp(a.y, b.y), scale: lerp(a.scale, b.scale), rotate: lerp(a.rotate, b.rotate), opacity: lerp(a.opacity, b.opacity) };
      }
    }
    return pick(last);
  }
  const pick = (f) => ({ x: f.x, y: f.y, scale: f.scale, rotate: f.rotate, opacity: f.opacity });
  const transform = (s) => `translate(${s.x}px, ${s.y}px) rotate(${s.rotate}deg) scale(${s.scale})`;

  /** Пресеты появления: состояние «до» (для исчезновения — «после»). */
  const PRESET = {
    fade: { opacity: 0 },
    up: { opacity: 0, transform: 'translateY(90px)' },
    down: { opacity: 0, transform: 'translateY(-90px)' },
    left: { opacity: 0, transform: 'translateX(140px)' },
    right: { opacity: 0, transform: 'translateX(-140px)' },
    zoom: { opacity: 0, transform: 'scale(.55)' },
    pop: { opacity: 0, transform: 'scale(.8)' },
    spin: { opacity: 0, transform: 'rotate(-180deg) scale(.4)' }
  };
  const IDENT = { opacity: 1, transform: 'none' };

  function presetFrames(name, out) {
    const p = PRESET[name];
    if (!p) return null;
    const from = { opacity: p.opacity, transform: p.transform || 'none' };
    if (name === 'pop' && !out) return [from, { opacity: 1, transform: 'scale(1.06)', offset: 0.7 }, IDENT];
    return out ? [IDENT, from] : [from, IDENT];
  }

  /**
   * Эффекты текста по буквам. Каждая буква — inline-block внутри слова (слова не рвутся посреди),
   * анимации — через Web Animations, поэтому перемотка и пауза в редакторе работают так же, как у слоёв.
   */
  const FX_MAX = 300;
  const FX = {
    type: { frames: [{ opacity: 0 }, { opacity: 0, offset: 0.99 }, { opacity: 1 }], ms: 40, easing: 'linear' },
    drop: { frames: [{ opacity: 0, transform: 'translateY(-1.1em) rotate(-8deg)' }, { opacity: 1, offset: 0.6 }, { opacity: 1, transform: 'none' }], ms: 520, easing: 'cubic-bezier(.2,.9,.3,1.35)' },
    rise: { frames: [{ opacity: 0, transform: 'translateY(.7em)' }, { opacity: 1, transform: 'none' }], ms: 480, easing: 'cubic-bezier(.2,.8,.3,1)' },
    zoom: { frames: [{ opacity: 0, transform: 'scale(0)' }, { opacity: 1, transform: 'scale(1.25)', offset: 0.65 }, { opacity: 1, transform: 'none' }], ms: 420, easing: 'ease-out' },
    flip: { frames: [{ opacity: 0, transform: 'perspective(400px) rotateX(-95deg)' }, { opacity: 1, transform: 'perspective(400px) rotateX(20deg)', offset: 0.7 }, { opacity: 1, transform: 'none' }], ms: 560, easing: 'ease-out' }
  };
  // Повторяемый «случайный» разброс по номеру буквы: одинаковый в эфире и в редакторе.
  const rnd = (i, k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };

  function splitChars(t) {
    const chars = [];
    const walk = (node, grad, color) => {
      for (const ch of [...node.childNodes]) {
        if (ch.nodeType === 1) { walk(ch, grad || ch.classList.contains('ak-grad'), ch.style.color || color); continue; }
        const frag = document.createDocumentFragment();
        for (const part of String(ch.textContent).split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) { frag.append(document.createTextNode(part)); continue; }
          const word = el('span', 'ak-word');
          for (const c of part) {
            const s = el('span', grad ? 'ak-ch ak-grad' : 'ak-ch', c);
            if (color) s.style.color = color;
            word.append(s);
            chars.push(s);
          }
          frag.append(word);
        }
        ch.replaceWith(frag);
      }
    };
    walk(t, false, '');
    // Градиент суммы теперь на каждой букве: на родителе с inline-block детьми он не рисуется.
    for (const g of t.querySelectorAll('.ak-amt.ak-grad')) g.classList.remove('ak-grad');
    return chars;
  }

  /** Анимации букв слоя l, который начинается в start и длится dur. */
  function textFx(chars, l, start, dur, anims) {
    const fx = l.textFx;
    if (!fx || fx === 'none' || !chars.length) return;
    const step = Math.min(300, Math.max(5, num(l.fxStep, 45)));
    chars.forEach((c, i) => {
      const at = start + i * step;
      if (FX[fx]) {
        const f = FX[fx];
        anims.push(c.animate(f.frames, { duration: f.ms, delay: at, fill: 'backwards', easing: f.easing }));
      } else if (fx === 'scatter') {
        const dx = (rnd(i, 1) - 0.5) * 900, dy = (rnd(i, 2) - 0.5) * 500, r = (rnd(i, 3) - 0.5) * 540;
        anims.push(c.animate([{ opacity: 0, transform: `translate(${dx}px, ${dy}px) rotate(${r}deg) scale(1.6)` }, { opacity: 1, transform: 'none' }],
          { duration: 700, delay: start + rnd(i, 4) * step * 8, fill: 'backwards', easing: 'cubic-bezier(.2,.8,.2,1)' }));
      } else if (fx === 'flicker') {
        // Неоновая вывеска: буквы загораются с перебоями в случайном порядке, одна потом ещё раз моргает.
        const d = start + rnd(i, 5) * step * 10;
        anims.push(c.animate([{ opacity: 0.08 }, { opacity: 1, offset: 0.1 }, { opacity: 0.15, offset: 0.2 }, { opacity: 1, offset: 0.32 }, { opacity: 0.3, offset: 0.4 }, { opacity: 1, offset: 0.5 }, { opacity: 1 }],
          { duration: 700, delay: d, fill: 'backwards', easing: 'steps(1, end)' }));
        if (rnd(i, 6) > 0.85 && dur > 2500) anims.push(c.animate([{ opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }], { duration: 160, delay: start + 1800 + rnd(i, 7) * 1500, easing: 'steps(1, end)' }));
      } else if (fx === 'wave') {
        anims.push(c.animate([{ transform: 'none' }, { transform: 'translateY(-.28em)' }, { transform: 'none' }],
          { duration: 1100, delay: start + i * step, iterations: Math.max(1, Math.ceil((dur - i * step) / 1100)), easing: 'ease-in-out' }));
      } else if (fx === 'glitch') {
        // Глитч: вход скачками с цветным сдвигом, потом редкие короткие сбои.
        const jump = (k) => `translate(${Math.round((rnd(i, k) - 0.5) * 24)}px, ${Math.round((rnd(i, k + 1) - 0.5) * 14)}px)`;
        const split = '3px 0 #ff2e63, -3px 0 #2ee6ff';
        anims.push(c.animate([{ opacity: 0, transform: jump(10), textShadow: split }, { opacity: 1, transform: jump(12), textShadow: split, offset: 0.3 }, { opacity: 0.6, transform: jump(14), offset: 0.6 }, { opacity: 1, transform: 'none', textShadow: 'none' }],
          { duration: 360, delay: start + rnd(i, 8) * step * 6, fill: 'backwards', easing: 'steps(1, end)' }));
        for (let b = 0; b < 3; b++) {
          const t = start + 1400 + b * 1700 + rnd(b, 9) * 300;
          if (t + 140 < start + dur && rnd(i, 20 + b) > 0.55) anims.push(c.animate([{ transform: jump(30 + b), textShadow: split }, { transform: 'none', textShadow: 'none' }], { duration: 140, delay: t, easing: 'steps(1, end)' }));
        }
      }
    });
  }

  function textParts(box, parts, l) {
    for (const p of parts || []) {
      if (p.t === 'amount') {
        const s = el('span', l.accent && COLOR_RE.test(l.accent) ? 'ak-amt' : 'ak-amt ak-grad', p.v);
        if (l.accent && COLOR_RE.test(l.accent)) s.style.color = l.accent;
        box.append(s);
      } else box.append(document.createTextNode(String(p.v)));
    }
  }

  /** Содержимое слоя (без позиции и анимаций). */
  function content(l, item, opts) {
    const box = el('div', 'ak-content ak-c-' + l.type);
    box.style.justifyContent = l.align === 'left' ? 'flex-start' : l.align === 'right' ? 'flex-end' : 'center';
    if (l.type === 'card') {
      const card = el('div', 'ak-card k-' + item.kind);
      card.style.setProperty('--s', String(num(l.size, 56) / 56));
      card.append(el('div', 'ak-icon', ICON[item.kind] || '!'));
      const body = el('div', 'ak-body');
      const kicker = el('div', 'ak-kicker', l.kickerText || '');
      if (item.test) kicker.append(el('span', 'ak-test', 'ТЕСТ'));
      const who = el('div', 'ak-who');
      textParts(who, l.parts, l);
      body.append(kicker, who);
      if (l.message) body.append(el('div', 'ak-text', l.message));
      card.append(body);
      box.append(card);
    } else if (l.type === 'text') {
      const t = el('div', 'ak-txt');
      t.style.fontFamily = FONT[l.font] || FONT.manrope;
      t.style.fontSize = num(l.size, 56) + 'px';
      t.style.fontWeight = l.bold ? '800' : '600';
      t.style.textAlign = l.align || 'center';
      if (COLOR_RE.test(l.color)) t.style.color = l.color;
      if (l.shadow) t.style.textShadow = '0 4px 18px rgba(0,0,0,.65), 0 1px 3px rgba(0,0,0,.8)';
      if (l.stroke > 0) t.style.webkitTextStroke = Math.min(20, l.stroke) + 'px #000';
      textParts(t, l.parts, l);
      box.append(t);
    } else if ((l.type === 'image' || l.type === 'video') && typeof l.src === 'string' && SRC_RE.test(l.src)) {
      const m = el(l.type === 'image' ? 'img' : 'video', 'ak-media');
      m.style.objectFit = l.fit === 'cover' || l.fit === 'fill' ? l.fit : 'contain';
      if (l.type === 'video') {
        m.muted = !(l.vol > 0) || !!opts.paused || (opts.canSound ? !opts.canSound() : false);
        m.volume = Math.min(1, Math.max(0, num(l.vol, 0)));
        m.loop = !!l.loop;
        m.playsInline = true;
        m.preload = 'auto';
      } else m.alt = '';
      // Анимированные WebP и GIF браузер не перезапускает при повторном показе того же адреса,
      // а запускает с момента загрузки — адрес ставит mount() в начале слоя (см. later).
      // Неподвижные части (рамки, доски) грузятся сразу, чтобы появиться точно к началу движения.
      if (l.type === 'image' && !opts.paused && ANIMATED_RE.test(l.src)) m.dataset.later = '1';
      else m.src = opts.url(l.src);
      box.append(m);
    } else if (opts.editor && l.type !== 'sound' && l.type !== 'tts' && l.type !== 'obs') {
      box.append(el('div', 'ak-empty', l.type === 'image' ? 'Выберите картинку' : 'Выберите видео'));
    }
    return box;
  }

  /**
   * Показать алерт на сцене. opts: url(src) → полный адрес; theme; paused (для перемотки в редакторе);
   * playBuiltin(id, volume) — встроенные звуки; editor — подсказки в пустых слоях;
   * canSound() — можно ли сейчас играть звук (оверлей: только «главная» видимая копия и не опоздавший алерт).
   * Возвращает { seek(t), pause(), resume(t), stop(), duration }.
   */
  function mount(stage, item, opts) {
    opts = opts || {};
    const total = num(item.durationMs, 6000);
    const theme = item.theme === 'general' || item.theme === 'campfire' ? item.theme : opts.theme === 'campfire' ? 'campfire' : 'general';
    stage.classList.add('ak-stage');
    stage.classList.remove('t-general', 't-campfire');
    stage.classList.add('t-' + theme);
    stage.replaceChildren();
    const anims = [];
    const timers = [];
    const media = [];
    const sounds = [];
    let stopped = false;
    let held = false;
    // Оверлей подключился посреди алерта: таймеры звуков и видео — от этого места, начавшееся раньше не запускается.
    const off = Math.max(0, num(opts.offset, 0));
    const blobs = [];
    // Анимированная картинка: свой адрес на каждый показ, выставленный в момент начала слоя, — тогда
    // вход и уход персонажа идут с первого кадра. Встроенные (/p/) заранее читаются в память (blob),
    // чтобы не было пустого кадра; для своих файлов — адрес с меткой.
    function later(img, src, start) {
      const url = opts.url(src);
      const fresh = () => url + (url.includes('?') ? '&' : '?') + 'r=' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      let blob = null;
      if (start > off && /^\/p\//.test(src) && typeof fetch === 'function') {
        fetch(url).then((r) => (r.ok ? r.blob() : null)).then((b) => { blob = b; }).catch(() => {});
      }
      const show = () => {
        if (stopped) return;
        if (blob) { const u = URL.createObjectURL(blob); blobs.push(u); img.src = u; } else img.src = fresh();
      };
      if (start <= off) show();
      else timers.push(setTimeout(show, start - off));
    }

    for (const l of item.layers || []) {
      const start = num(l.start, 0);
      const dur = layerDur(l, total);
      if (dur <= 0) continue;
      if (l.type === 'sound' || l.type === 'tts') {
        if (opts.paused || start < off) continue;
        timers.push(setTimeout(() => {
          if (stopped || held || (opts.canSound && !opts.canSound())) return;
          const vol = Math.min(1, Math.max(0, num(l.vol, 0)));
          if (!(vol > 0)) return;
          if (l.builtin && opts.playBuiltin) return opts.playBuiltin(l.builtin, vol);
          if (typeof l.src === 'string' && SRC_RE.test(l.src)) {
            const a = new Audio(opts.url(l.src));
            a.volume = vol;
            a.play().catch(() => {});
            sounds.push(a);
          }
        }, start - off));
        continue;
      }
      if (l.type === 'obs') continue;

      const wrap = el('div', 'ak-layer');
      wrap.dataset.id = l.id;
      wrap.style.width = l.w + 'px';
      wrap.style.height = l.h + 'px';
      const inner = el('div', 'ak-inner');
      inner.append(content(l, item, opts));
      wrap.append(inner);
      stage.append(wrap);

      // Видимость — только пока слой «идёт» на таймлайне.
      anims.push(wrap.animate([{ visibility: 'visible' }, { visibility: 'visible' }], { duration: dur, delay: start, fill: 'none' }));
      // Позиция и движение по ключевым кадрам.
      const k = Array.isArray(l.keyframes) ? l.keyframes : [];
      if (k.length) {
        const frames = [];
        const at = (f, offset) => ({ offset, transform: transform(f), opacity: f.opacity, easing: CSS_EASE[f.ease] || 'ease' });
        if (k[0].t > 0) frames.push(at(k[0], 0));
        for (const f of k) frames.push(at(f, Math.min(1, Math.max(0, f.t / dur))));
        if (k[k.length - 1].t < dur) frames.push(at(k[k.length - 1], 1));
        for (let i = 1; i < frames.length; i++) if (frames[i].offset < frames[i - 1].offset) frames[i].offset = frames[i - 1].offset;
        anims.push(wrap.animate(frames, { duration: dur, delay: start, fill: 'both' }));
      } else {
        wrap.style.transform = transform(sample(l, 0));
        wrap.style.opacity = String(l.opacity);
      }
      // Появление и исчезновение.
      const inF = presetFrames(l.animIn, false);
      const inMs = Math.min(num(l.animInMs, 450), dur);
      if (inF && inMs > 0) anims.push(inner.animate(inF, { duration: inMs, delay: start, fill: 'backwards', easing: l.animIn === 'pop' ? 'ease-out' : 'cubic-bezier(.2,.8,.3,1)' }));
      const outF = presetFrames(l.animOut, true);
      const outMs = Math.min(num(l.animOutMs, 450), dur);
      if (outF && outMs > 0) anims.push(inner.animate(outF, { duration: outMs, delay: start + dur - outMs, fill: 'forwards', easing: 'ease-in' }));

      // Проявление картинки (шторка или круг).
      const wipe = WIPE[l.wipe];
      if (wipe && (l.type === 'image' || l.type === 'video')) {
        const wms = Math.max(50, num(l.wipeMs, 600));
        anims.push(inner.animate([{ clipPath: wipe[0] }, { clipPath: wipe[1] }], { duration: wms, delay: start + Math.max(0, num(l.wipeStart, 0)), fill: 'both', easing: 'cubic-bezier(.33,1,.68,1)' }));
      }

      if (l.type === 'text' && l.textFx && l.textFx !== 'none') {
        const txt = inner.querySelector('.ak-txt');
        if (txt && txt.textContent.length <= FX_MAX) textFx(splitChars(txt), l, start, dur, anims);
      }

      const img = inner.querySelector('img[data-later]');
      if (img) later(img, l.src, start);

      const vid = inner.querySelector('video');
      if (vid) {
        media.push({ v: vid, start });
        if (!opts.paused && start >= off) timers.push(setTimeout(() => { if (!stopped && !held) { vid.currentTime = 0; vid.play().catch(() => {}); } }, start - off));
      }
    }

    const handle = {
      duration: total,
      /** Перемотка (редактор): показать кадр в момент t. */
      seek(t) {
        for (const a of anims) { a.pause(); a.currentTime = Math.max(0, t); }
        for (const m of media) {
          m.v.pause();
          const local = Math.max(0, (t - m.start) / 1000);
          if (isFinite(m.v.duration) && m.v.duration > 0) m.v.currentTime = m.v.loop ? local % m.v.duration : Math.min(local, m.v.duration - 0.05);
        }
      },
      /** Пауза (источник скрыт): движение и видео стоят, звук не начинается. */
      pause() {
        held = true;
        for (const a of anims) a.pause();
        for (const m of media) m.v.pause();
        for (const a of sounds) a.pause();
      },
      /** Продолжить с момента t (сколько прошло от начала алерта по часам ядра). */
      resume(t) {
        held = false;
        for (const a of anims) { a.currentTime = Math.max(0, t); a.play(); }
        for (const m of media) {
          if (t < m.start) continue;
          const local = (t - m.start) / 1000;
          if (isFinite(m.v.duration) && m.v.duration > 0) {
            if (!m.v.loop && local >= m.v.duration) continue;
            m.v.currentTime = m.v.loop ? local % m.v.duration : local;
          }
          m.v.play().catch(() => {});
        }
      },
      stop() {
        stopped = true;
        for (const t of timers) clearTimeout(t);
        for (const a of sounds) a.pause();
        for (const m of media) m.v.pause();
        for (const a of anims) a.cancel();
        stage.replaceChildren();
        for (const u of blobs) URL.revokeObjectURL(u);
      }
    };
    if (opts.paused) handle.seek(num(opts.startAt, 0));
    else if (off > 0) handle.resume(off);
    return handle;
  }

  const api = { W, H, mount, sample, layerDur, transform, EASE_FN };
  if (typeof window !== 'undefined') window.AlertKit = api;
})();
