import os, sys, tempfile
os.environ["PARU_HOME"] = tempfile.mkdtemp(prefix="paru-test-")
os.environ["PARU_TOKEN"] = "testtoken"
os.environ["PARU_UI"] = os.path.join(os.path.dirname(__file__), "..", "ui")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest


@pytest.fixture(autouse=True)
def clean():
    from agent import config, db, llm
    db.reset_for_tests()
    db.conn().executescript("DELETE FROM messages; DELETE FROM timers;")
    if config.SETTINGS_FILE.exists():
        config.SETTINGS_FILE.unlink()
    config.save({"permissions": {k: True for k in config.DEFAULTS["permissions"]}})
    llm._pending.clear()
    llm._transport = None
    yield
