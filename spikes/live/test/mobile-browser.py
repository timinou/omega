#!/usr/bin/env python3
"""Compatibility entry: the Pocket walkthrough now uses a real model harness.
Set LIVE_PROVIDER=claude|deepseek|codex and LIVE_FRONTEND to the remote build.
"""
import runpy
from pathlib import Path
runpy.run_path(str(Path(__file__).with_name('harness-browser.py')),run_name='__main__')
