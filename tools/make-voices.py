"""Record the tour narration: one mp3 per caption per language, so Listen speaks Tamil, Hindi, Spanish and English on
every phone and computer, even when the device has no voice for that language.

Input : public/audio/texts.json  (made by: node tools/dump-spoken.js)
Output: public/audio/<lang>/<key>.mp3  and  public/audio/index.json (the keys that have a recording)

Voices: Microsoft neural voices, through the open-source edge-tts tool (it uses the Microsoft Edge "Read aloud" service,
so it needs the internet). Run on a computer that can reach speech.platform.bing.com:
    pip install edge-tts
    python tools/make-voices.py
Re-running skips files that already exist, so it is safe to run again after a network error.
"""
import asyncio, json, os, sys

try:
    import edge_tts
except ImportError:
    sys.exit('edge-tts is not installed. Run:  pip install edge-tts')

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'audio')
VOICES = {   # one clear neural voice per language
    'en': ('en-US-AriaNeural', '+0%'),
    'ta': ('ta-IN-PallaviNeural', '-5%'),
    'hi': ('hi-IN-SwaraNeural', '-5%'),
    'es': ('es-MX-DaliaNeural', '-5%'),
}


async def one(text, voice, rate, path):
    for attempt in range(4):
        try:
            tmp = path + '.part'
            await edge_tts.Communicate(text, voice, rate=rate).save(tmp)
            if os.path.getsize(tmp) < 2000:
                raise RuntimeError('audio too short')
            os.replace(tmp, path)
            return True
        except Exception as e:  # network hiccup: wait and retry
            print(f'   retry {attempt + 1}: {e}')
            await asyncio.sleep(2 + 3 * attempt)
    return False


async def main():
    texts = json.load(open(os.path.join(ROOT, 'texts.json'), encoding='utf-8'))
    index, failed = {}, 0
    for lang, items in texts.items():
        if lang not in VOICES:
            continue
        voice, rate = VOICES[lang]
        os.makedirs(os.path.join(ROOT, lang), exist_ok=True)
        keys = []
        for n, it in enumerate(items, 1):
            path = os.path.join(ROOT, lang, it['key'] + '.mp3')
            if not os.path.exists(path):
                print(f'{lang} {n}/{len(items)} {it["text"][:50]}')
                if not await one(it['text'], voice, rate, path):
                    failed += 1
                    continue
            keys.append(it['key'])
        index[lang] = sorted(set(keys))
        print(f'{lang}: {len(index[lang])}/{len(items)} recorded ({voice})')
    with open(os.path.join(ROOT, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f)
    size = sum(os.path.getsize(os.path.join(dp, x)) for dp, _, fs in os.walk(ROOT) for x in fs if x.endswith('.mp3'))
    print(f'\nDONE. {sum(len(v) for v in index.values())} recordings, {size / 1e6:.1f} MB. Failed: {failed}.')
    if failed:
        print('Run the same command again to retry the failed ones.')


asyncio.run(main())
