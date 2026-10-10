#!/bin/bash
# כלי הפקת סרטוני השיווק לכל סשן ענן של Claude Code: Reelkit (הפקה ורינדור),
# והסקיל שלו ל-Claude Code; וגם librosa לכלי הקול האמיתי ב-marketing/videos/tools.
# הסקיל marketing-video-production מסביר למה כל אחד מהם צריך.
#
# רק בענן: במחשב מקומי כל אחד מתקין לבד. אידמפוטנטי - מה שכבר מותקן (המכולה
# נשמרת במטמון אחרי הרצה מוצלחת) אינו מותקן שוב. כשל כאן לעולם אינו מפיל את
# הסשן: אין רשת (reelkit.cc חסום, npm למטה) - ממשיכים, והסקיל יודע מה לעשות.
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# ‏fetch של Node אינו קורא את HTTPS_PROXY בלי זה, ו-reelkit עונה
# "Cannot reach the Reelkit API". לכל פקודה בסשן.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export NODE_USE_ENV_PROXY=1' >> "$CLAUDE_ENV_FILE"
  echo 'export NODE_NO_WARNINGS=1' >> "$CLAUDE_ENV_FILE"
fi

if ! command -v reelkit >/dev/null 2>&1; then
  npm install -g reelkit-cli >/dev/null 2>&1 || echo "session-start: reelkit-cli לא הותקן (npm)" >&2
fi

# הסקיל של Reelkit ל-Claude Code (~/.claude/skills/reelkit). מקומי, בלי רשת.
if command -v reelkit >/dev/null 2>&1 && [ ! -f "$HOME/.claude/skills/reelkit/SKILL.md" ]; then
  reelkit install --agent claude >/dev/null 2>&1 || echo "session-start: reelkit install נכשל" >&2
fi

# כלי הקול האמיתי (align_voice.py, align_lines.py, build_vo.py)
if ! python3 -c "import librosa, soundfile" >/dev/null 2>&1; then
  pip install -q librosa soundfile >/dev/null 2>&1 || echo "session-start: librosa לא הותקנה" >&2
fi

exit 0
