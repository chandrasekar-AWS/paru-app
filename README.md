# Paru 3

A voice assistant for Windows, Arch Linux and Android. Say **"Hello Paru"** and the orb appears.

| You say | What happens |
|---|---|
| "Hello Paru" (or hey / hi / okay Paru) | The orb appears and Paru listens. Add a request in the same breath ("Hello Paru, what's the weather") and it answers straight away. |
| "Shut up" / "Stop" / "Be quiet" | Paru stops talking and the orb hides. It keeps listening for "Hello Paru". |
| "Turn off Paru" | Paru stops listening completely and **releases the microphone**. Turn it back on with the switch in the app, the tray icon, or Ctrl+Shift+Space. |

## How it works (why it is fast)
* "Hello Paru", "shut up" and "turn off Paru" are recognised **on your computer** by a small offline model (Whisper tiny.en, ~100 MB, downloaded once). No room audio is uploaded, no Gemini quota is used, and "shut up" takes about half a second.
* Gemini is only asked when you actually make a request. The question is heard and answered in one call, and neural voices are cached so repeated phrases play instantly.
* Words that sound almost like the wake word go to one cheap cloud check. "Teach Paru my voice" (Settings → Voice recognition) also learns how the recogniser writes the name for *your* voice.

## Install
**Windows** – push to GitHub and download `Paru-Windows` from the *Actions* tab (the installer carries its own Python). Or from source: install Node 20 and Python 3.9+, then `npm install && npm start`.
**Arch Linux** – `./scripts/install-arch.sh` (adds Paru to your app menu), or download the `AppImage` from Actions.
**Android** – download `Paru-Android-APK` from Actions and install it. In Paru on the PC: Settings → General → *Let my phone connect*, then type the address it shows and the same VOICE_KEY into the phone app. The phone listens while the app is open (the screen is kept awake); it does not listen with the app closed.

The first start creates Paru's Python environment, generates your VOICE_KEY and downloads the wake-word model. Add your Gemini key in Settings → Keys (free key: aistudio.google.com/apikey).

## Tests (what is actually checked)
`cd test && python -m pytest -q` runs 64 tests: the wake/stop/off matcher, and the agent over real HTTP with real speech clips and a fake Gemini.
`node test/e2e.js` runs the real Electron app + agent with a recorded microphone: hello Paru → question → spoken answer → shut up → hello Paru → turn off Paru.
`node test/phone.js` does the same for the phone UI. Needs `npm install`, a Python with `agent/requirements.txt`, and xvfb on Linux.

## Known limits
* The wake phrase must include a greeting. "Paru" alone is too unreliable to trust.
* The recogniser writes "Paru" as "Peru", so saying "hello Peru" also wakes Paru.
* Wayland: the global Ctrl+Shift+Space key may not work. The tray icon and "Hello Paru" do.
* Phone: no background listening. Opening PC programs by voice is desktop-only.
