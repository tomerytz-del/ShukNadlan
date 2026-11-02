// נעילת תור ושמירת היסטוריה.
//   deno test supabase/functions/whatsapp-webhook/turn_lock_test.ts

import { peelShownMatches, stampShownMatches } from "./lookup_turn.ts";
import {
  abortedTurnNote,
  abortedTurnPlan,
  CAS_ATTEMPTS,
  emailFailureNotice,
  emailLockPlan,
  entriesAddedSince,
  HEARTBEAT_MS,
  historyPersistPlan,
  HISTORY_KEEP,
  memoryTurnStore,
  prependPending,
  RENEW_TIMEOUT_MS,
  renewOrTimeout,
  mergeHistoryAppend,
  nextSavedHistory,
  raceTurnWithLease,
  releaseDrainsTextsOnly,
  releaseWithRetry,
  runTurnUntilQuiet,
  runWithTurnLock,
  shouldFlushPendingImages,
  TURN_DEADLINE_MS,
  TURN_STALE_MS,
  type HistMsg,
  type RenewBeat,
  type TurnLockStore,
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
  const append = sql.slice(
    sql.indexOf("function public.whatsapp_history_append"),
    sql.indexOf("comment on function public.whatsapp_history_append"),
  );
  if (!append.includes("whatsapp_history_merge_append")) fail("ההוספה לא גוזרת דרך המיזוג");
});

function scriptedClock() {
  let clock = 0;
  type Waiter = { due: number; resolve: () => void };
  let waiters: Waiter[] = [];
  let pumping = false;
  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      for (let spin = 0; spin < 30; spin++) {
        const due = waiters.filter((w) => w.due <= clock).sort((a, b) => a.due - b.due);
        if (!due.length) break;
        const w = due[0];
        waiters = waiters.filter((x) => x !== w);
        w.resolve();
        await Promise.resolve();
      }
    } finally {
      pumping = false;
    }
  };
  return {
    now: () => clock,
    sleep(ms: number) {
      return new Promise<void>((resolve) => {
        waiters.push({ due: clock + ms, resolve });
        queueMicrotask(() => void pump());
      });
    },
    async advance(ms: number) {
      clock += ms;
      for (let i = 0; i < 12; i++) {
        await Promise.resolve();
        await pump();
      }
    },
    get clock() {
      return clock;
    },
  };
}

Deno.test("שטיפת תמונות רק באלבום בלי טקסט, לא אחרי מייל ולא ליד טקסט", async () => {
  if (shouldFlushPendingImages({ flushImages: false, hasText: false, pendingImages: 3, imageAgeMs: 0 })) {
    fail("מייל או ריקון המשך שטפו תמונות");
  }
  if (shouldFlushPendingImages({ flushImages: true, hasText: true, pendingImages: 2, imageAgeMs: 0 })) {
    fail("טקסט עם תמונה ממתינה שטף");
  }
  if (!shouldFlushPendingImages({ flushImages: true, hasText: false, pendingImages: 1, imageAgeMs: 0 })) {
    fail("אלבום בלי טקסט לא נשטף פעם אחת");
  }
  if (shouldFlushPendingImages({ flushImages: true, hasText: false, pendingImages: 1, imageAgeMs: 11 * 60 * 1000 })) {
    fail("תמונה ישנה מ-10 דקות נשאלה");
  }
  if (shouldFlushPendingImages({ flushImages: true, hasText: false, pendingImages: 1, imageAgeMs: null })) {
    fail("תמונה בלי גיל נשאלה");
  }
  if (shouldFlushPendingImages({ flushImages: true, hasText: false, pendingImages: 1, imageAgeMs: 0, followUp: true })) {
    fail("מי שחיכה לנעילה שטף תמונות");
  }
  if (shouldFlushPendingImages({ flushImages: true, hasText: false, pendingImages: 0, imageAgeMs: 0 })) {
    fail("אין תמונות ובכל זאת שטיפה");
  }

  const store = memoryTurnStore();
  store.images.push("old-a", "old-b");
  let flushes = 0;
  await runWithTurnLock({
    agentId: "a",
    store,
    runTurn: async (ctx) => {
      const queued = store.pending.shift();
      const flush = shouldFlushPendingImages({
        flushImages: ctx.pass === 0 && !queued,
        hasText: !!queued,
        pendingImages: store.images.length,
        imageAgeMs: 0,
        followUp: ctx.followUp === true,
      });
      if (flush) flushes++;
      return queued || flush ? "work" : "idle";
    },
  });
  if (flushes !== 1) fail(`אלבום בלי טקסט נשטף ${flushes} פעמים`);

  store.pending.push("טקסט");
  flushes = 0;
  let passes = 0;
  await runWithTurnLock({
    agentId: "a",
    store,
    runTurn: async (ctx) => {
      passes++;
      const queued = store.pending.shift();
      if (shouldFlushPendingImages({
        flushImages: ctx.pass === 0,
        hasText: !!queued,
        pendingImages: store.images.length,
        imageAgeMs: 0,
        followUp: ctx.followUp === true,
      })) flushes++;
      return queued ? "work" : "idle";
    },
  });
  if (passes !== 1 || flushes !== 0) fail(`טקסט + תמונה: passes=${passes} flushes=${flushes}`);

  const index = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
  const resume = index.slice(index.indexOf("async function resumePendingTurns"), index.indexOf("function kickPendingDrain"));
  if (!resume.includes("flushImages: false")) fail("ריקון אחרי מייל עדיין שוטף תמונות");
  if (!index.includes("activeDrains")) fail("כל הודעה פותחת שרשרת ריקון");
  const play = index.slice(index.indexOf("async function playQueuedTurn"), index.indexOf("async function resumePendingTurns"));
  if (!play.includes("shouldFlushPendingImages")) fail("התור לא שואל אם מותר לשטוף");
});

Deno.test("אחרי תקרת התורים הטקסט שנשאר נאסף בהמשך", async () => {
  let clock = 0;
  const sleep = (ms: number) => {
    clock += ms;
    return Promise.resolve();
  };
  const store = memoryTurnStore({ now: () => clock, staleMs: TURN_STALE_MS });
  store.pending.push("1", "2", "3", "4", "5");
  const answered: string[] = [];
  const take = () => {
    const text = store.pending.shift();
    if (text) answered.push(text);
    return text ? "work" as const : "idle" as const;
  };
  let followups = 0;
  const first = await runTurnUntilQuiet({
    agentId: "a",
    store,
    maxTurns: 2,
    now: () => clock,
    sleep,
    kicksLeft: 8,
    kick: () => {
      followups++;
    },
    runTurn: async () => take(),
  });
  if (first.ran !== 2 || !first.leftPending) fail(JSON.stringify(first));
  if (followups !== 1) fail(`kick ${followups}`);
  const second = await runTurnUntilQuiet({
    agentId: "a",
    store,
    maxTurns: 4,
    now: () => clock,
    sleep,
    kicksLeft: 7,
    kick: () => {
      followups++;
    },
    runTurn: async () => take(),
  });
  if (second.leftPending) fail("ההמשך לא רוקן");
  if (answered.join(",") !== "1,2,3,4,5") fail(answered.join(","));
  if (followups !== 1) fail("ההמשך בעט שוב בלי טקסט");
});

Deno.test("דופק שנלקח או שותק עוצר לפני 45 שניות, ושחרור כושל חוזר", async () => {
  const stolen = scriptedClock();
  let released = 0;
  const stolenStore: TurnLockStore = {
    acquire: async () => true,
    renew: async () => false,
    release: async () => {
      released++;
      return false;
    },
  };
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  let sawAbort = false;
  const stolenRun = runWithTurnLock({
    agentId: "a",
    store: stolenStore,
    now: stolen.now,
    sleep: stolen.sleep,
    runTurn: (ctx) => new Promise((resolve) => {
      const done = () => {
        sawAbort = ctx.signal.aborted;
        resolve("work");
      };
      if (ctx.signal.aborted) done();
      else ctx.signal.addEventListener("abort", done, { once: true });
    }),
  });
  await flush();
  await stolen.advance(HEARTBEAT_MS);
  await flush();
  await stolen.advance(3_000);
  const stolenResult = await stolenRun;
  if (!sawAbort) fail("התור החי לא נעצר");
  if (stolen.clock >= TURN_STALE_MS) fail(`נעצר ב-${stolen.clock}, אחרי החלון`);
  if (released !== 1) fail(`שחרור ${released} פעמים`);
  if (stolenResult.ran !== 0) fail("תור שנעצר נספר כהצלחה");

  const quiet = scriptedClock();
  let renews = 0;
  const quietStore: TurnLockStore = {
    acquire: async () => true,
    renew: async (): Promise<RenewBeat> => {
      renews++;
      return "error";
    },
    release: async () => false,
  };
  await flush();
  const quietRun = runWithTurnLock({
    agentId: "a",
    store: quietStore,
    now: quiet.now,
    sleep: quiet.sleep,
    runTurn: (ctx) => new Promise((resolve) => {
      ctx.signal.addEventListener("abort", () => resolve("idle"), { once: true });
    }),
  });
  await flush();
  await quiet.advance(HEARTBEAT_MS);
  await flush();
  await quiet.advance(HEARTBEAT_MS);
  await flush();
  await quiet.advance(10_000);
  await flush();
  await quietRun;
  if (quiet.clock >= TURN_STALE_MS) fail(`דדליין ב-${quiet.clock}`);
  if (renews < 1) fail("לא היה דופק");

  const held = scriptedClock();
  let beats = 0;
  let finished = false;
  const heldStore: TurnLockStore = {
    acquire: async () => true,
    renew: async () => {
      beats++;
      return true;
    },
    release: async () => false,
  };
  await flush();
  const heldRun = runWithTurnLock({
    agentId: "a",
    store: heldStore,
    now: held.now,
    sleep: held.sleep,
    runTurn: async () => {
      await held.sleep(50_000);
      finished = true;
      return "work";
    },
  });
  await flush();
  for (let step = 0; step < 4; step++) {
    await held.advance(HEARTBEAT_MS);
    await flush();
  }
  const heldResult = await heldRun;
  if (!finished || heldResult.ran !== 1) fail("דופק תקין קטע תור חי");
  if (beats < 3) fail(`דופקים ${beats}`);
  if (held.clock < TURN_STALE_MS) fail("התור לא עבר את חלון הבסיס");

  let mismatchTries = 0;
  const mismatch = await releaseWithRetry(async () => {
    mismatchTries++;
    return false;
  }, 3, async () => {});
  if (mismatch !== false || mismatchTries !== 1) fail("false יציב חזר על עצמו");
  let throwsLeft = 2;
  let throwTries = 0;
  const retried = await releaseWithRetry(async () => {
    throwTries++;
    if (throwsLeft > 0) {
      throwsLeft--;
      throw new Error("rpc");
    }
    return true;
  }, 3, async () => {});
  if (retried !== true || throwTries !== 3) fail(`ניסיונות שחרור ${throwTries}`);

  const lost = raceTurnWithLease({
    now: () => 0,
    sleep: () => Promise.resolve(),
    renew: async () => "unavailable",
    run: async () => "ok" as const,
  });
  if (await lost !== "ok") fail("RPC חסר הפיל תור");
});

Deno.test("היסטוריה וגרסה נשמרות יחד, והוספה אחרי התנגשות לא דורסת", () => {
  if (historyPersistPlan({ versionKnown: false, append: "missing", casConflicts: 0, casMissing: false }) !== "legacy") {
    fail("בלי RPC מותר upsert");
  }
  if (historyPersistPlan({ versionKnown: false, append: "failed", casConflicts: 0, casMissing: false }) !== "stop") {
    fail("כשל קריאה דורס");
  }
  if (historyPersistPlan({ versionKnown: false, append: "ok", casConflicts: 0, casMissing: false }) !== "append") {
    fail("הוספה כשהגרסה לא ידועה");
  }
  if (historyPersistPlan({
    versionKnown: true,
    append: "pending",
    casConflicts: CAS_ATTEMPTS,
    casMissing: false,
  }) !== "append") fail("אחרי 4 התנגשויות אין הוספה");
  if (historyPersistPlan({
    versionKnown: true,
    append: "missing",
    casConflicts: CAS_ATTEMPTS,
    casMissing: false,
  }) !== "stop") fail("אחרי התנגשות upsert מלא");
  if (historyPersistPlan({ versionKnown: true, append: "pending", casConflicts: 1, casMissing: false }) !== "cas") {
    fail("התנגשות אחת ויתרה");
  }

  const index = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
  const load = index.slice(index.indexOf("async function loadConversation"), index.indexOf("async function legacySaveConversation"));
  if (!load.includes("history, pending_images, last_property_id, last_client_id")) fail("השדות לא נקראים יחד");
  if (!load.includes("history_version")) fail("הגרסה לא באותה שאילתה");
  const selects = load.match(/\.select\(/g) || [];
  if (selects.length !== 2) fail(`שאילתות טעינה: ${selects.length}`);
  if (load.indexOf("historyVersionMissing") > load.indexOf(".select(")) {
    // הגיבוי רק אחרי כשל העמודה
  } else fail("הגיבוי קודם לשאילתה המלאה");
  const save = index.slice(index.indexOf("async function saveConversation"), index.indexOf("async function appendTurnEntries"));
  if (!save.includes("historyPersistPlan") || !save.includes("appendTurnEntries")) {
    fail("אחרי התנגשויות אין הוספה אטומית");
  }
  const handle = index.slice(index.indexOf("burst add failed"), index.indexOf("const typed = QUICK_BURST"));
  if (!handle.includes("runTurnUntilQuiet")) fail("כשל רצף עונה בלי נעילה");
  const hold = index.slice(index.indexOf("async function holdAgentTurn"), index.indexOf("async function profileNudge"));
  if (!hold.includes("runTurnUntilQuiet")) fail("תור מייל בלי נעילה");

  const sql = Deno.readTextFileSync(
    new URL("../../migrations/20271102090000_whatsapp_turn_lock.sql", import.meta.url),
  );
  const trigger = sql.slice(
    sql.indexOf("function public.whatsapp_history_touch_version"),
    sql.indexOf("drop trigger if exists whatsapp_conversations_history_version"),
  );
  if (!trigger.includes("new.history is distinct from old.history")) fail("הטריגר לא רואה history");
  if (!trigger.includes("new.last_client_id is distinct from old.last_client_id")) {
    fail("סימון לקוח/ה משיחה לא מקדם גרסה");
  }
  if (!trigger.includes("new.history_version is not distinct from old.history_version")) {
    fail("הטריגר מקדם גם כתיבה שכבר קידםה");
  }
  if (!sql.includes("interval '45 seconds'")) fail("חלון ההתיישנות לא קוצר");
  if (!sql.includes("function public.whatsapp_turn_renew")) fail("אין דופק במסד");

  const csm = Deno.readTextFileSync(new URL("./csm-chat.ts", import.meta.url));
  if (csm.includes("appendHistoryKeepingShown") || csm.includes(".update({ history")) {
    fail("צ'אט ההטמעה עדיין כותב היסטוריה בלי גרסה");
  }
  const twilio = Deno.readTextFileSync(new URL("../twilio-voice/index.ts", import.meta.url));
  const remember = twilio.slice(twilio.indexOf("async function rememberForBot"), twilio.indexOf("async function onIncoming"));
  if (remember.includes(".update(") || remember.includes("appendHistoryKeepingShown")) {
    fail("שיחה עדיין דורסת היסטוריה או last_client_id בנתיב הגיבוי");
  }
  if (!remember.includes("whatsapp_history_append")) fail("שיחה לא מוסיפה אטומית");

  const crm = Deno.readTextFileSync(new URL("../../../assets/crm.js", import.meta.url));
  const ownerForm = crm.slice(crm.indexOf("function openPropertyForOwner"), crm.indexOf("function clientMatchPeek"));
  if (!ownerForm.includes("c.deal_type === 'rent' || c.deal_type === 'sale' ? c.deal_type : ''")) {
    fail("פתיחת נכס לבעלים ממלאת מכירה");
  }
  const office = Deno.readTextFileSync(new URL("../../../assets/crm-office.js", import.meta.url));
  if (!office.includes("if (!p.deal_type && p.client_kind !== 'owner')")) {
    fail("ייבוא חוזר של בעל/ת נכס הופך null למכירה");
  }
  const showcase = Deno.readTextFileSync(new URL("../../../assets/crm-showcase.js", import.meta.url));
  const signAt = showcase.indexOf("if (client.deal_type === 'rent') opts.kind = owner ? 'landlord' : 'tenant';");
  const sign = showcase.slice(signAt, signAt + 280);
  if (signAt < 0 || sign.includes("|| 'buy'") || sign.includes("kind: 'buy'")) fail("הסכם ממלא קנייה");
  if (!sign.includes("client.deal_type === 'sale'")) fail("הסכם לא שואל לפי הצד שנשמר");
  const html = Deno.readTextFileSync(new URL("../../../crm.html", import.meta.url));
  if (!html.includes('<option value="">בחרו מכירה או השכרה</option>')) fail("סוג העסקה בטופס מתחיל במכירה");
  if (crm.includes("let clientFormDeal = 'sale'") || crm.includes("clientFormDeal || 'sale'")) {
    fail("טופס הלקוח/ה ממלא קנייה");
  }
  if (!crm.includes("בחרו קנייה או שכירות")) fail("טופס מחפש/ת לא דורש צד");
  const saleBtn = html.slice(html.indexOf('data-client-deal="sale"') - 40, html.indexOf('data-client-deal="sale"') + 40);
  if (saleBtn.includes('class="active"')) fail("כפתור הקנייה מסומן מראש");
  if (!index.includes("whatsapp_pending_texts_prepend")) fail("טקסט שנקטע לא חוזר לתור");
  const email = Deno.readTextFileSync(new URL("./email-intake.ts", import.meta.url));
  if (!email.includes("notifyEmailFailed") || !email.includes('type: "email_intake"')) {
    fail("כישלון מייל לא מודיע");
  }
  if (!email.includes("lock_wait:")) fail("מייל תפוס לא חוזר לניסיון");
  const note = emailFailureNotice("חוזה https://example.com/x");
  if (/https?:\/\//.test(note.body) || /https?:\/\//.test(note.title)) fail("ההתראה מכילה כתובת");
  if (emailLockPlan(1) !== "retry" || emailLockPlan(3) !== "fail") fail("מכסת ניסיונות המייל");
  if (abortedTurnPlan([]) !== "requeue" || abortedTurnPlan(["create_property"]) !== "save") {
    fail("תור שנקטע לא מחזיר טקסט או לא שומר כלי");
  }
  if (!abortedTurnNote(["create_property"]).includes("create_property")) fail("ההיסטוריה לא מזכירה את הכלי");
  const queued = prependPending(["אחר כך"], ["  ראשון  ", ""]);
  if (queued.join("|") !== "ראשון|אחר כך") fail(queued.join("|"));
  const prepend = sql.slice(
    sql.indexOf("function public.whatsapp_pending_texts_prepend"),
    sql.indexOf("comment on function public.whatsapp_pending_texts_prepend"),
  );
  if (!prepend.includes("excluded.pending_texts || coalesce(c.pending_texts")) {
    fail("ההחזרה אינה לראש התור");
  }
  if (!sql.includes("notification_types_add(array['email_intake'])")) fail("אין סוג התראה למייל");
});

Deno.test("דופק שנתקע לא חוסם את הדדליין, והכלי נגמר לפני השחרור", async () => {
  const hungClock = scriptedClock();
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  const hung = renewOrTimeout(() => new Promise(() => "error"), hungClock.sleep, RENEW_TIMEOUT_MS);
  await flush();
  await hungClock.advance(RENEW_TIMEOUT_MS);
  if (await hung !== "error") fail("דופק תקוע נחשב הצלחה");
  if (hungClock.clock > RENEW_TIMEOUT_MS) fail(`התקרה ${hungClock.clock}`);

  const clock = scriptedClock();
  const released = { n: 0 };
  let keepRenews = 0;
  let phase: "watch" | "keep" = "watch";
  let openTool: () => void = () => {};
  const tool = new Promise<void>((resolve) => {
    openTool = resolve;
  });
  const store: TurnLockStore = {
    acquire: async () => true,
    renew: async () => {
      if (phase === "keep") {
        keepRenews++;
        return true;
      }
      return "error";
    },
    release: async () => {
      released.n++;
      return false;
    },
  };
  const runP = runWithTurnLock({
    agentId: "a",
    store,
    now: clock.now,
    sleep: clock.sleep,
    runTurn: (ctx) => new Promise((resolve) => {
      ctx.signal.addEventListener("abort", () => {
        phase = "keep";
        tool.then(() => resolve("idle"));
      }, { once: true });
    }),
  });
  await flush();
  await clock.advance(HEARTBEAT_MS);
  await flush();
  await clock.advance(HEARTBEAT_MS);
  await flush();
  await clock.advance(10_000);
  await flush();
  const releases = () => released.n;
  if (releases() !== 0) fail("הנעילה שוחררה לפני שהכלי נגמר");
  openTool();
  await flush();
  await clock.advance(1_000);
  await runP;
  if (releases() !== 1) fail(`שחרורים ${releases()}`);
  if (keepRenews < 1) fail("אין דופק בזמן שהכלי רץ");
  if (clock.clock >= 45_000 && keepRenews < 1) fail("הכלי רץ אחרי שהחכירה פגה");
});
