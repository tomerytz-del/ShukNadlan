# מקור סרטוני השיווק

כאן יושב **המקור** של סרטונים שהופקו בקוד, כדי שאפשר יהיה לבנות מהם גרסה
חדשה לניסוי A/B: התסריט, קוד האנימציה והכלים. **הקבצים המוגמרים לא כאן** -
הם בספריית הסרטונים (הלשונית "סרטונים" בפאנל "קמפיינים", ‏`docs/marketing-videos.md`).
גם התמונות, ההקלטות והמוזיקה לא כאן: אין קבצים בינאריים בריפו.

| תיקייה | מה |
| --- | --- |
| `call-to-meeting/` | "מהשיחה לפגישה" - גיוס מתווכים, 26.5 שניות, בהקלטה של קול אמיתי. ‏9:16 ו-1:1 |
| `property-intake/` | "גייסת נכס? הקונים כבר בדרך!" - הסבר לסוכנים על קליטת נכס, כ-29 שניות, בהקלטה של קול אמיתי. ‏9:16 ו-1:1 |
| `one-place/` | "מחפשים דירה בעפולה והסביבה?" - לגולשים: הכול במקום אחד, מפה, הדמיות AI ומומחים, על צילומי מסך אמיתיים מהאתר. כ-22 שניות, בהקלטה של קול אמיתי. ‏9:16 ו-1:1 |
| `tools/` | הקלטת קול אמיתי במקום קול סינתטי: חיתוך לשורות ותזמון לכל מילה |

## הכלי: Reelkit

```sh
npm install -g reelkit-cli          # הפקודה reelkit
reelkit install --agent claude      # הסקיל ל-Claude Code
```

בסשן ענן של Claude Code שתי הפקודות האלה (וגם `librosa` לכלי הקול) רצות
מעצמן בתחילת כל סשן - `.claude/hooks/session-start.sh`. ההתחברות נשארת ידנית.

**בסשן ענן של Claude Code** צריך שני דברים, אחרת כל קריאה ל-Reelkit נכשלת:
1. ‏`reelkit.cc` ברשימת ה-Allowed domains של הסביבה (‏Network access ← Custom,
   עם "Also include default list of common package managers").
2. ‏`NODE_USE_ENV_PROXY=1` לפני כל פקודה. ‏`fetch` של Node אינו קורא את
   `HTTPS_PROXY` מעצמו, וההודעה היא "Cannot reach the Reelkit API".

התחברות: `reelkit auth login --start`, לפתוח את הקישור ולאשר, ואז
`reelkit auth login --finish`.

## בנייה מחדש של "מהשיחה לפגישה"

```sh
reelkit init call-to-meeting --aspect 9:16 --private
cp marketing/videos/call-to-meeting/{plan.json,Video.tsx} call-to-meeting/   # Video.tsx ל-src/
```

החומרים שהקוד מצפה להם, תחת `assets/user/` (‏`reelkit assets upload`, ואז
לעדכן את הנתיבים ב-`IMG` בראש `Video.tsx` למזהים החדשים):
- הלוגו - `assets/logo-shuknadlan.png` מהריפו.
- גבריאלה - חיתוך ראש וכתפיים, וחיתוך פנים לעיגול. בלי הטאבלט ובלי תג השם:
  הטקסט עליהם בתמונה המקורית אינו קריא.

מהספרייה של Reelkit: `music-product-film-glide` (‏`--music`), והצלילים
`sfx-ui-soft-whoosh`, `sfx-ui-bubble-pop`, `sfx-ui-glass-tap`,
`sfx-ui-notification-ping`, `sfx-ui-send-swoosh`, `sfx-ui-riser-short`,
`sfx-ui-soft-impact`, `sfx-ui-sparkle-shimmer`, `sfx-ui-success-chime`,
`synths-of-the-past-phone-mobile-phone-ring`.

**גרסה מרובעת:** אותו `Video.tsx`, בפרויקט עם `--aspect 1:1`. הקוד מזהה פריים
מרובע ומקטין את כל הבמה של 9:16 לרצועה שבה יושב התוכן (‏`STAGE`, `WIN_TOP`).
הכתוביות, התג "אוטומטי" והעיגול של גבריאלה עוברים למסגרת המרובעת עצמה. ‏4:5
אינו נתמך ב-Reelkit (רק 9:16, 16:9 ו-1:1).

## קול אמיתי במקום קול סינתטי (`tools/`)

הקול נשמע הכי אמין כשמישהו מהמערכת מקליט אותו. Reelkit מתזמן את האנימציה לפי
זמני המילים, ובהקלטה של אדם אין לו אותם. הדרך:

1. מקליטים את כל השורות ברצף, עם שנייה של שקט בין שורה לשורה. מותר לחזור על
   שורה.
2. מפיקים ב-Reelkit קול סינתטי לאותו תסריט, **בפרויקט נפרד** (לתזמון בלבד).
3. ‏`align_voice.py` מוצא כל שורה בהקלטה (‏MFCC + DTW מול הקול הסינתטי). כשאותה
   שורה הוקלטה כמה פעמים, הוא לוקח את **האחרונה**: השורה הבאה נמצאת קודם, והשורה
   שחזרה נמצאת מיד לפניה.
4. ‏`align_lines.py` מצמיד כל שורה להפסקות האמיתיות ומתזמן כל מילה בתוך השורה.
   כששורה נחתכת (נשימה שנראית כמו תחילת השורה הבאה), מעבירים קובץ חמישי
   `spans.json` - ‏`{"<scene id>": [start_sec, end_sec]}` - שקובע לה גבולות ביד.
5. מנקים רעשים ומאזנים, ואז `build_vo.py` חותך קובץ לכל סצנה, מאיץ (‏`atempo`,
   בלי לשנות את גובה הקול) וכותב `assets/voiceovers.json` בפורמט של Reelkit.

```sh
ffmpeg -i raw.m4a -ac 1 -ar 48000 raw.wav
ffmpeg -i raw.wav -af "highpass=f=80,afftdn=nf=-28:nr=10,acompressor=threshold=-22dB:ratio=3:attack=5:release=90:makeup=2,loudnorm=I=-16:TP=-1.5:LRA=7" clean.wav
python3 -I tools/align_voice.py raw.wav <align-project> coarse.json
python3 -I tools/align_lines.py raw.wav <align-project> coarse.json lines.json
python3 -I tools/build_vo.py <video-project> clean.wav lines.json 1.1
```

**כשהשורות הוקלטו בסדר אחר או כמה פעמים** (‏`align_voice.py` מניח שורה חוזרת אחת):
מחלקים את ההקלטה לגושי דיבור לפי האנרגיה, ו-`match_takes.py` אומר איזה גוש הוא
איזו שורה. לוקחים את הגוש האחרון של כל שורה, וכותבים את הגבולות שלו ל-`spans.json`
(גם כ-`coarse.json`) לפני `align_lines.py`. כך נבנה "מחפשים דירה בעפולה".

**צילומי מסך מהטלפון:** חותכים את פס הסטטוס ופס הניווט (‏`crop=1080:<h>:0:96`
בטלפון של 2340 פיקסלים), ומהדמיית "לפני/אחרי" באתר מוציאים את התמונות עצמן בלי
התגיות והידית, כדי לבנות את המחוון מחדש באנימציה.

**הגבולות:** ‏`align_voice.py` מניח ששורה שחזרה היא `matches` (‏`REPEAT_ID`) -
בתסריט אחר משנים אותו. תזמון המילים מדויק לרמה של כמה פריימים, לא יותר:
אחרי בנייה בודקים ב-`reelkit preview` את פריימי המילים. צריך `pip install librosa soundfile`.

## גרסה חדשה לניסוי

1. שינוי **אחד** (ההוק, האורך, הקול) - ב-`plan.json` וב-`Video.tsx`.
2. בונים ומרנדרים, ומעלים לספרייה עם **אותו רעיון** וגרסה חדשה.
3. קמפיין אחד עם שתי הגרסאות. ‏`docs/marketing-videos.md`, "איך מריצים ניסוי A/B".
