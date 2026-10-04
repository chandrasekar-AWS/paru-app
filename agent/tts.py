"""Natural neural voices through edge-tts (optional). Without it the UI falls back to the OS/browser voices."""
import asyncio, time

_voices = {"ts": 0, "list": []}
FALLBACK = [("en-US-AriaNeural", "English (US) - Aria"), ("en-US-GuyNeural", "English (US) - Guy"),
            ("en-GB-SoniaNeural", "English (UK) - Sonia"), ("en-IN-NeerjaNeural", "English (India) - Neerja"),
            ("en-IN-PrabhatNeural", "English (India) - Prabhat"), ("ta-IN-PallaviNeural", "Tamil - Pallavi"),
            ("ta-IN-ValluvarNeural", "Tamil - Valluvar"), ("hi-IN-SwaraNeural", "Hindi - Swara"),
            ("hi-IN-MadhurNeural", "Hindi - Madhur"), ("te-IN-ShrutiNeural", "Telugu - Shruti"),
            ("ml-IN-SobhanaNeural", "Malayalam - Sobhana"), ("kn-IN-SapnaNeural", "Kannada - Sapna"),
            ("es-ES-ElviraNeural", "Spanish - Elvira"), ("fr-FR-DeniseNeural", "French - Denise"),
            ("de-DE-KatjaNeural", "German - Katja"), ("ja-JP-NanamiNeural", "Japanese - Nanami"),
            ("ko-KR-SunHiNeural", "Korean - SunHi"), ("zh-CN-XiaoxiaoNeural", "Chinese - Xiaoxiao"),
            ("ar-SA-ZariyahNeural", "Arabic - Zariyah"), ("pt-BR-FranciscaNeural", "Portuguese - Francisca"),
            ("ru-RU-SvetlanaNeural", "Russian - Svetlana"), ("it-IT-ElsaNeural", "Italian - Elsa")]


def available():
    try:
        import edge_tts  # noqa
        return True
    except Exception:
        return False


async def _synth(text, voice):
    import edge_tts
    chunks = []
    async for c in edge_tts.Communicate(text, voice).stream():
        if c["type"] == "audio":
            chunks.append(c["data"])
    return b"".join(chunks)


async def synth(text, voice):
    if not available():
        raise RuntimeError("edge-tts not installed")
    return await asyncio.wait_for(_synth(text[:1500], voice), 20)


async def voices():
    if time.time() - _voices["ts"] < 3600 and _voices["list"]:
        return _voices["list"]
    if available():
        try:
            import edge_tts
            vs = await asyncio.wait_for(edge_tts.list_voices(), 10)
            _voices.update(ts=time.time(), list=[(v["ShortName"], f'{v["Locale"]} - {v["ShortName"].split("-", 2)[-1].replace("Neural", "")} ({v["Gender"]})') for v in vs])
            return _voices["list"]
        except Exception:
            pass
    return FALLBACK
