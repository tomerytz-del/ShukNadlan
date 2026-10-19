#!/bin/bash
# verify.sh <proj> <file>: transcribe and print segments + scene starts
# Run from the folder that holds the projects; it needs a spare project "voicetest" and a "vt" folder there.
S=${S:-$(pwd)}
cd $S/voicetest; export NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1
before=$(ls refs | sort); cp "$2" $S/vt/verify-$1.mp4; reelkit ref download $S/vt/verify-$1.mp4 >/dev/null 2>&1
id=$(comm -13 <(echo "$before") <(ls refs | sort) | head -1)
for i in 1 2 3 4; do out=$(timeout 300 reelkit ref analyze $id 2>&1 | grep -i "transcript" | head -1); echo "$out" | grep -q "Cannot reach" || break; sleep 10; done
python3 -c "
import json;b=json.load(open('refs/$id/breakdown.json'));t=b['transcript']
[print(round(s['startSec'],1),round(s['endSec'],1),s['text']) for s in t['segments']]
m=json.load(open('$S/$1/manifest.json'));print('SCENES',[(s['id'],round(s['startFrame']/30,1)) for s in m['scenes']])"
