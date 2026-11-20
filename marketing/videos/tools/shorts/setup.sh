#!/bin/bash
# Dependencies for the long-recording-to-shorts tools. ffmpeg and node are already in the session.
# opencv must be < 5: version 5 no longer ships the face cascade that reframe.py uses (and needs no download).
# faster-whisper needs no torch. Its model comes from huggingface.co, blocked in a cloud session by default.
set -euo pipefail
pip install -q faster-whisper "opencv-python-headless<5" "numpy<2.3"
python3 -c "import faster_whisper, cv2, os; assert os.path.exists(cv2.data.haarcascades + 'haarcascade_frontalface_alt2.xml'); print('shorts tools ready')"
