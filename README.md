# Paru 4

A voice assistant for Windows, Arch Linux and Android. You choose the wake word; the orb appears when you say it.

## First launch
1. **Sign in** with Google or email (Supabase). Only the sign-in uses the internet service; chats, keys, settings and your voice stay on this device.
2. **Voice**: Paru speaks a phrase, you repeat it, it shows what it heard and learns your voice.
3. **AI key**: Gemini, ChatGPT/OpenAI, Claude, OpenRouter, Groq, DeepSeek, Mistral, xAI, Together, Ollama, LM Studio, or any OpenAI-compatible address. "Check key" makes a real call, so a fake key is rejected. The key is stored encrypted by your operating system.
4. **Wake word and off word**: type any phrases, say each three times, test them.
5. **Permissions**: the first time you ask for a new kind of task Paru asks (out loud and on screen). "Always allow" is remembered, "Allow once" asks again, "No" is respected. Change any of it later in Settings.

| You say | What happens |
|---|---|
| your wake word | The orb appears and Paru listens. Add a request in the same breath and it answers straight away. |
| "shut up" / "stop" / "be quiet" | Paru stops talking and the orb hides. It keeps listening for the wake word. |
| your off word | Paru stops listening completely and releases the microphone. Turn it on again with the switch in the app, the tray icon, or Ctrl+Shift+Space. |

## Set up sign-in once (the app owner)
See `config/README.md`: create a free Supabase project, enable Google and Email, add the redirect `http://127.0.0.1:53682/callback`, and put the project URL and anon key in `config/supabase.json` (or paste them into the "Connect sign-in" form the first time Paru starts).

## Install
**Arch Linux**: `./scripts/install-arch.sh`, then open Paru from your app menu (or `npm start`).
**Windows**: push to GitHub and download `Paru-Windows` from the *Actions* tab (the installer carries its own Python).
**Android**: download `Paru-Android-APK` from Actions. In Paru on the PC: Settings, General, *Let my phone connect*; type the address and key it shows into the phone app. The phone listens while the app is open.

## How it works
Wake word, "shut up" and the off word are recognised **on your computer** by a small offline model (about 100 MB, downloaded once), so no room audio is uploaded and wake costs no AI quota. The AI service is only called for your actual request. Gemini hears your voice directly (best for other languages); other services read text that the offline English listener writes down.

## Tests
`cd test && python -m pytest -q` (83 tests: matcher, custom phrases, providers, agent over HTTP with real speech clips)
`node --test test/auth.test.js` (sign-in against a stand-in Supabase)
`node test/setup_e2e.js` (the real app: whole setup wizard, custom wake/off words, the first-time permission flow)
`node test/e2e.js`, `node test/phone.js` (default "hey Paru" flow on desktop and phone UI)
These need `npm install`, a Python with `agent/requirements.txt`, and xvfb on Linux.

## Known limits
* Near-identical sounds ("hello body" for "hello buddy") cannot be told apart. Short or common wake words work worse than two distinctive words.
* The phone signs in with email and password (no Google yet) and cannot run programs on the PC for you.
* Wayland: the global Ctrl+Shift+Space key may not work. The tray icon and your wake word do.
