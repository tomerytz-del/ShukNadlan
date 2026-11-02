// נעילת תור ושמירת היסטוריה.
//   deno test supabase/functions/whatsapp-webhook/turn_lock_test.ts

import { peelShownMatches, stampShownMatches } from "./lookup_turn.ts";
import {
  entriesAddedSince,
  HISTORY_KEEP,
  memoryTurnStore,
  mergeHistoryAppend,
  nextSavedHistory,
  releaseDrainsTextsOnly,
  runTurnUntilQuiet,
  runWithTurnLock,
  type HistMsg,
} from "./turn-lock.ts";

function fail(message: string): never {
  throw new Error(message);
}

const MARK = "[[shown-matches-v1]]";

function textOf(history: readonly HistMsg[]): string {
  return history.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
}

function markerCount(history: readonly HistMsg[]): number {
  return history.filter((m) => typeof m.content === "string" && m.content.startsWith(MARK) && m.role === "assistant").length;
}

Deno.test("שני תורים לא רצים יחד, והשני רואה את ההיסטוריה של הראשון", async () => {
  const store = memoryTurnStore();
  let releaseHold: () => void = () => {};
  const hold = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });
  let started = false;
  let secondSawFirst = false;
  const seen: string[] = [];

  store.pending.push("השם הוא דני");
  const first = runWithTurnLock({
    agentId: "a",
    store,
    runTurn: async () => {
      const text = store.pending.shift();
      if (!text) return "idle";
      seen.push(text);
      if (!started) {
        started = true;
        await hold;
        store.pending.push("השם הוא דנה");
      } else if (!seen.includes("השם הוא דני") || text !== "השם הוא דנה") {
        fail(`הריקון לא ראה את התור הראשון: ${seen.join(" | ")} / ${text}`);
      } else {
        secondSawFirst = true;
      }
      return "work";
    },
  });
  const startedAt = Date.now();
  while (!started && Date.now() - startedAt < 1000) {
    await new Promise((r) => setTimeout(r, 5));
  }
  if (!started) fail("התור הראשון לא תפס את הנעילה");

  const second = await runWithTurnLock({
    agentId: "a",
    store,
    runTurn: async () => {
      fail("התור השני רץ בזמן שהראשון החזיק בנעילה");
      return "work";
    },
  });
  if (!second.skippedBusy) fail("התור השני לא ויתר על הנעילה");
  if (store.holdToken() == null) fail("הנעילה שוחררה לפני סוף התור הראשון");

  releaseHold();
  const done = await first;
  if (done.ran !== 2) fail(`המחזיק רוקן ${done.ran} תורים, ציפיתי ל-2`);
  if (!secondSawFirst) fail("התור השני לא ראה את ההיסטוריה של הראשון");
  if (done.leftPending) fail("נשאר טקסט אחרי הריקון");
  if (store.holdToken() != null) fail("הנעילה נשארה תפוסה");
});

Deno.test("נעילה שהתיישנה לא חוסמת, ושחרור של טוקן ישן לא מוחק את החדש", async () => {
  let clock = 0;
  const store = memoryTurnStore({ now: () => clock, staleMs: 120_000 });
  const first = await store.acquire("a", "old");
  if (first !== true) fail("תפיסה ראשונה");
  clock = 119_000;
  if (await store.acquire("a", "new") !== false) fail("נעילה טרייה שוחררה מוקדם");
  clock = 120_000;
  if (await store.acquire("a", "new") !== true) fail("נעילה שהתיישנה לא הוחלפה");
  if (await store.release("a", "old") !== false) fail("טוקן ישן ניקה את הנעילה החדשה");
  if (store.holdToken() !== "new") fail("הטוקן החדש נמחק");
  store.pending.push("עוד");
  if (await store.release("a", "new") !== true) fail("השחרור לא דיווח על טקסט ממתין");
});

Deno.test("שמירה לא מוחקת רשומות של תור אחר, וסמן אחד בסוף", () => {
  const shown = { c1: { ids: ["p1"], limit: 5, waive: [] } };
  const stored = stampShownMatches(
    [
      { role: "user", content: "השם הוא דני" },
      { role: "assistant", content: "לאשר את דני?" },
    ],
    shown,
  );
  const loaded: HistMsg[] = [
    { role: "user", content: "השם הוא דני" },
    { role: "assistant", content: "לאשר את דני?" },
  ];
  const staleNext: HistMsg[] = [
    { role: "user", content: "השם הוא דנה" },
    { role: "assistant", content: "שמרתי את דנה" },
  ];
  const merged = nextSavedHistory({
    expectedVersion: 1,
    storedVersion: 2,
    storedHistory: stored,
    loadedHistory: [],
    nextHistory: staleNext,
    shown,
    storedShown: shown,
  });
  const body = textOf(merged);
  if (!body.includes("השם הוא דני")) fail("הודעת התור הראשון נמחקה");
  if (!body.includes("לאשר את דני?")) fail("תשובת התור הראשון נמחקה");
  if (!body.includes("השם הוא דנה")) fail("התור השני לא נוסף");
  if (!body.includes("שמרתי את דנה")) fail("תשובת התור השני לא נוספה");
  if (markerCount(merged) !== 1) fail(`סמנים: ${markerCount(merged)}`);
  const last = merged[merged.length - 1];
  if (last?.role !== "assistant" || typeof last.content !== "string" || !last.content.startsWith(MARK)) {
    fail("הסמן אינו הודעת assistant אחרונה");
  }
  const peeled = peelShownMatches(merged);
  if (peeled.history.some((m) => typeof m.content === "string" && m.content.startsWith(MARK))) {
    fail("הסמן נשאר גלוי אחרי קילוף");
  }
  if (!peeled.shown.c1?.ids.includes("p1")) fail("מצב ההתאמות נפל");

  const sameVersion = nextSavedHistory({
    expectedVersion: 2,
    storedVersion: 2,
    storedHistory: stored,
    loadedHistory: loaded,
    nextHistory: [
      ...loaded,
      { role: "user", content: "דנה" },
      { role: "assistant", content: "עודכן" },
    ],
    shown,
  });
  if (!textOf(sameVersion).includes("השם הוא דני") || !textOf(sameVersion).includes("דנה")) {
    fail("שמירה בלי התנגשות איבדה רשומה");
  }
  if (markerCount(sameVersion) !== 1) fail("שני סמנים בלי התנגשות");
});

Deno.test("גזימה לא נספרת כרשומות חדשות", () => {
  const base = Array.from({ length: 20 }, (_, i) => ({ role: "user", content: `ישן ${i}` }));
  const trimmed = [...base.slice(10), { role: "assistant", content: "חדש" }];
  const added = entriesAddedSince(base, trimmed);
  if (added.length !== 1 || added[0]?.content !== "חדש") fail(JSON.stringify(added));
});

Deno.test("לולאת הריקון נעצרת לפני קיר הזמן ומשאירה טקסט", async () => {
  const store = memoryTurnStore();
  store.pending.push("א", "ב", "ג", "ד", "ה");
  let ticks = 0;
  const result = await runWithTurnLock({
    agentId: "a",
    store,
    maxTurns: 2,
    budgetMs: 10_000,
    now: () => {
      ticks += 1;
      return ticks;
    },
    runTurn: async () => {
      const text = store.pending.shift();
      return text ? "work" : "idle";
    },
  });
  if (result.ran !== 2) fail(`רצו ${result.ran}`);
  if (!result.leftPending) fail("הלולאה לא דיווחה שנשאר טקסט");
  if (store.pending.length !== 3) fail(`נשארו ${store.pending.length}`);
});

Deno.test("תמונות ממתינות לא פותחות ריקון ולא שולחות", async () => {
  if (releaseDrainsTextsOnly(0, 2)) fail("תמונות בלי טקסט פתחו ריקון");
  if (!releaseDrainsTextsOnly(1, 2)) fail("טקסט לא פתח ריקון");
  const store = memoryTurnStore();
  store.images.push("from-oct-22", "from-oct-28");
  let calls = 0;
  let flushes = 0;
  const result = await runWithTurnLock({
    agentId: "a",
    store,
    runTurn: async (ctx) => {
      calls++;
      if (ctx.pass > 0) flushes++;
      return "idle";
    },
  });
  if (calls !== 1) fail(`נקרא ${calls} פעמים`);
  if (flushes !== 0) fail("תור המשך רץ בגלל תמונות");
  if (result.leftPending) fail("תמונות נראו כמו טקסט ממתין");
  if (store.images.length !== 2) fail("תמונות ישנות נגענו בהן");

  const sql = await Deno.readTextFile(
    new URL("../../migrations/20271102090000_whatsapp_turn_lock.sql", import.meta.url),
  );
  const start = sql.indexOf("function public.whatsapp_turn_release");
  const end = sql.indexOf("comment on function public.whatsapp_turn_release");
  const body = sql.slice(start, end);
  if (body.includes("pending_images")) fail("השחרור במסד עדיין מסתכל על תמונות");
  if (!body.includes("pending_texts")) fail("השחרור לא מסתכל על טקסט");
});

Deno.test("מי שלא תפס ממתין, ומי שנשאר לו טקסט בועט המשך - כל טקסט נענה פעם אחת", async () => {
  let clock = 0;
  const store = memoryTurnStore({ now: () => clock, staleMs: 120_000 });
  store.pending.push("ראשון", "שני", "שלישי");
  const answered: string[] = [];
  let releaseHold: () => void = () => {};
  const hold = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });
  const sleep = (ms: number) => {
    clock += ms;
    return Promise.resolve();
  };

  const take = () => {
    const text = store.pending.shift();
    if (text) answered.push(text);
    return text;
  };

  const holder = runTurnUntilQuiet({
    agentId: "a",
    store,
    maxTurns: 1,
    now: () => clock,
    sleep,
    kicksLeft: 1,
    kick: () => {
      answered.push("kick");
    },
    runTurn: async () => {
      take();
      await hold;
      return "work";
    },
  });

  const started = Date.now();
  while (store.holdToken() == null && Date.now() - started < 1000) {
    await new Promise((r) => setTimeout(r, 5));
  }
  if (store.holdToken() == null) fail("המחזיק לא תפס");

  const waiter = runTurnUntilQuiet({
    agentId: "a",
    store,
    now: () => clock,
    sleep,
    retryBusy: true,
    waitForLockMs: 120_000,
    kicksLeft: 0,
    runTurn: async () => {
      const text = take();
      return text ? "work" : "idle";
    },
  });

  releaseHold();
  const held = await holder;
  const waited = await waiter;
  if (!held.leftPending) fail("המחזיק לא דיווח שנשאר טקסט");
  if (!answered.includes("kick")) fail("לא תוזמן המשך");
  if (answered.filter((t) => t === "ראשון").length !== 1) fail(answered.join(","));
  if (answered.filter((t) => t === "שני").length !== 1) fail("השני נענה " + answered.join(","));
  if (answered.includes("שלישי") && answered.filter((t) => t === "שלישי").length !== 1) {
    fail("השלישי נענה פעמיים");
  }
  if (waited.skippedBusy && !waited.ran) {
    // ההמתנה נגמרה בלי תפיסה רק אם המחזיק לא שחרר. הוא שחרר.
    fail("הממתין לא תפס אחרי השחרור");
  }
});

Deno.test("הוספה להיסטוריה נגזרת ל-12 ומשאירה סמן אחד בסוף", () => {
  const shown = { c1: { ids: ["p1"], limit: 5, waive: [] } };
  const history: HistMsg[] = stampShownMatches(
    Array.from({ length: 10 }, (_, i) => ({ role: "user", content: `ישן ${i}` })),
    shown,
  );
  const entries: HistMsg[] = Array.from({ length: 5 }, (_, i) => ({ role: "assistant", content: `חדש ${i}` }));
  const merged = mergeHistoryAppend(history, entries, HISTORY_KEEP);
  const body = peelShownMatches(merged);
  if (body.history.length !== 12) fail(`אורך ${body.history.length}`);
  if (markerCount(merged) !== 1) fail("סמן");
  const last = merged[merged.length - 1];
  if (typeof last?.content !== "string" || !last.content.startsWith(MARK)) fail("הסמן לא בסוף");
  if (!body.history.some((m) => m.content === "חדש 4")) fail("החדש האחרון נחתך");
  if (body.history.some((m) => m.content === "ישן 0")) fail("הישן הראשון נשאר מעבר לחלון");
  if (!body.shown.c1) fail("הסמן איבד את המצב");

  const sql = Deno.readTextFileSync(
    new URL("../../migrations/20271102090000_whatsapp_turn_lock.sql", import.meta.url),
  );
  const fn = sql.slice(
    sql.indexOf("function public.whatsapp_history_merge_append"),
    sql.indexOf("comment on function public.whatsapp_history_merge_append"),
  );
  if (!fn.includes("limit 12")) fail("המיגרציה לא גוזרת ל-12");
});
