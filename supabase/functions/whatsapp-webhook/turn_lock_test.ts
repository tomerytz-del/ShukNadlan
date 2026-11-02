// נעילת תור ושמירת היסטוריה.
//   deno test supabase/functions/whatsapp-webhook/turn_lock_test.ts

import { peelShownMatches, stampShownMatches } from "./lookup_turn.ts";
import {
  entriesAddedSince,
  memoryTurnStore,
  nextSavedHistory,
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
