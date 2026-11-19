# Озвучка Silero для Crossember: фоновый процесс, команды построчно JSON в stdin, ответ JSON-строкой в stdout.
# Модель грузится один раз при первой фразе. Текст зрителя приходит только через stdin.
import json
import re
import sys
import wave

import torch

SPEAKERS = ('aidar', 'baya', 'kseniya', 'xenia', 'eugene')
# Дополнительная модель v5_cis_base: ударения не ставит сама, их расставляет silero-stress.
EXTRA = ('ru_roman', 'ru_oksana', 'ru_dmitriy')
THREADS = max(1, min(8, torch.get_num_threads()))
RATES = ('x-slow', 'slow', 'medium', 'fast', 'x-fast')
SR = 48000
model = None
extra = None
accentor = None


def load(path):
    global model
    if model is None:
        torch.set_num_threads(THREADS)
        model = torch.package.PackageImporter(path).load_pickle('tts_models', 'model')
        model.to(torch.device('cpu'))
    return model


def load_extra(path):
    global extra, accentor
    if extra is None:
        from silero_stress import load_accentor
        torch.set_num_threads(THREADS)  # silero_stress при импорте оставляет один поток
        accentor = load_accentor()
        extra = torch.package.PackageImporter(path).load_pickle('tts_models', 'model')
        extra.to(torch.device('cpu'))
    return extra


def chunks(text, limit=800):
    # Длинный текст — по предложениям: у модели есть предел длины одной фразы.
    parts, cur = [], ''
    for s in re.split(r'(?<=[.!?…])\s+', text):
        while len(s) > limit:
            parts.append(s[:limit])
            s = s[limit:]
        if len(cur) + len(s) + 1 > limit and cur:
            parts.append(cur)
            cur = s
        else:
            cur = (cur + ' ' + s).strip()
    if cur:
        parts.append(cur)
    return parts


def esc(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def speak(j):
    if j['speaker'] in EXTRA:
        m, speaker, opts = load_extra(j['extra']), j['speaker'], {}
    else:
        m, speaker, opts = load(j['model']), (j['speaker'] if j['speaker'] in SPEAKERS else 'xenia'), {'put_accent': True, 'put_yo': True}
    rate = RATES[max(0, min(4, int(j.get('rate', 2))))]
    pause = torch.zeros(int(SR * 0.15))
    pieces = []
    for part in chunks(str(j['text'])):
        if accentor is not None and speaker in EXTRA:
            part = accentor(part)
        if rate == 'medium':
            audio = m.apply_tts(text=part, speaker=speaker, sample_rate=SR, **opts)
        else:
            ssml = f'<speak><prosody rate="{rate}">{esc(part)}</prosody></speak>'
            audio = m.apply_tts(ssml_text=ssml, speaker=speaker, sample_rate=SR, **opts)
        pieces += [audio, pause]
    data = torch.cat(pieces[:-1]) if pieces else torch.zeros(1)
    # numpy в комплекте нет: int16 берём из байтового хранилища тензора.
    pcm = bytes((data.clamp(-1, 1) * 32767).to(torch.int16).contiguous().untyped_storage())
    with wave.open(j['path'], 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm)


def main():
    out = sys.stdout
    for line in sys.stdin.buffer:
        try:
            j = json.loads(line.decode('utf-8'))
            if j.get('cmd') == 'load':
                load(j['model'])
            else:
                speak(j)
            r = {'ok': True}
        except Exception as e:  # ответить ошибкой и ждать следующую команду
            r = {'ok': False, 'error': f'{type(e).__name__}: {e}'[:300]}
        out.write(json.dumps(r, ensure_ascii=True) + '\n')
        out.flush()


if __name__ == '__main__':
    main()
