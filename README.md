# Paru - always-on AI assistant and agent

Desktop (Windows, Linux, macOS): Electron shell + local Python engine (FastAPI). All data stays in `~/.paru`.

## Run (Arch Linux / any desktop)
```bash
# 1. remove the old broken copy so nothing imports from it
mv ~/.config/paru ~/.config/paru.old

# 2. engine dependencies (voice add-ons are optional)
cd paru
python -m venv ~/.paru/venv && ~/.paru/venv/bin/pip install -r requirements.txt
~/.paru/venv/bin/pip install -r requirements-optional.txt     # faster-whisper, edge-tts, pyautogui, resemblyzer

# 3. start
cd electron && npm install && PARU_PYTHON=~/.paru/venv/bin/python npm start
```
Arch extras: `sudo pacman -S xdotool` (X11) or `wtype` (Wayland) for typing into apps.
Windows: use `py -m venv %USERPROFILE%\.paru\venv`, same steps. Installers: `npm run dist`.

If the engine fails, the window shows the real error and `~/.paru/paru.log` has the full trace.

## First run
Login -> permissions -> voice setup. Then in Settings add: Gemini key (free, aistudio.google.com), Mail app password, Calendar iCal link.

## Use
Say "Alexi ..." -> orb appears top-right. Say "shut up" -> orb goes away. Ctrl+Shift+Space = talk without the wake word.
Hold the mic button for a voice note. History groups chats by date; "Summarize this day" reads it aloud.

## Tests
`python -m pytest tests -q` (57 tests)

## Limits (OS rules, not bugs)
Unlock is impossible for any app. Apple sign-in needs a paid Apple developer account. Android is not included in this build.
