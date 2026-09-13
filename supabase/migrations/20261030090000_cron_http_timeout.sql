-- ============================================================================
-- ‏pg_net מוותר אחרי 5 שניות — וזה קצר מדי לכל אחת מהמשימות שלנו
--
-- ‏`agent-reminders` נראתה נכשלת בפרודקשן ב-40% מהקריאות: ‏500
-- ‏`EDGE_FUNCTION_ERROR`, בלי שורת `console.error`, בלי שגיאה במסד, וה-worker
-- עולה תקין ב-26ms. שום דבר לא נכשל — **מי שניתק הוא הצד שקורא**:
--
--   ‏Timeout of 5000 ms reached. Total time: 5001.9 ms
--   ‏(DNS 157ms, handshake 70ms, HTTP Request/Response 4772ms)
--
-- זו ברירת המחדל של `net.http_post`, ואף אחד משמונת ה-cron-ים לא הגדיר
-- ‏`timeout_milliseconds`. ה-500 בלוג הוא ה-gateway שמדווח שהלקוח סגר את
-- החיבור באמצע — לא תוצאה של הפונקציה.
--
-- ההפרדה במדידות הייתה מושלמת, בלי חפיפה:
--
--   הצליחו   3735 · 3789 · 4000 · 4508 · 4912 · 5264 · 5274 ms
--   "נכשלו"  5749 · 6255 · 6543 · 7282 · 7545 ms
--
-- ## למה 30 שניות ולא 10
--
-- המסד אינו הצוואר — `agent_reminder_findings` רצה ב-27ms ו-
-- ‏`video_uplift_ratio` ב-23ms. הזמן הולך לשליחה עצמה: ~1.5 שניות למייל דרך
-- ‏SMTP, בטור. שלושה סוכנים = ~5 שניות, כלומר בדיוק על הגבול, ורביעי היה
-- עובר אותו תמיד. ‏30 שניות נותנות מרווח גם כשמספר הסוכנים גדל פי כמה, וגם
-- כשספק המייל איטי באותו רגע.
--
-- השליחה במקביל (‏`_shared/pool.ts`) נכנסת באותו PR ומקצרת את זה מאוד —
-- אבל **תקרת זמן אינה תחליף לתיקון והתיקון אינו תחליף לתקרה**: כל משימה כאן
-- יכולה לגדול, וברירת מחדל של 5 שניות תחזור ותכיש במשימה הבאה שתתארך.
--
-- ## למה זה לא רק רעש בלוג
--
-- ‏`agent_reminders_claim` כותבת את שורת היומן **לפני** השליחה. ריצה שנחתכת
-- אחרי ה-claim ולפני המייל האחרון משאירה שורה שחוסמת את התזכורת לשבוע — בלי
-- שההודעה יצאה. עד היום זה לא קרה (נבדק: אף ריצה שנחתכה לא יצרה שורת יומן),
-- אבל ההסתברות עולה עם כל סוכן/ת שמצטרף/ת.
--
-- ## למה הזרקה ולא כתיבה מחדש של שמונה הפקודות
--
-- לכל משימה יש תנאי `where` משלה, וחלקן ארוכות (‏`saved-search-notify`
-- מצליבה שלוש טבלאות). העתקתן לכאן הייתה מכפילה אותן, וכפילות היא בדיוק מה
-- שמתפצל בעדכון הבא. במקום זה: קוראים את הפקודה הקיימת, מזריקים ארגומנט
-- אחד, ומחזירים אותה כמו שהיא — כך שהתנאי, הלוח והכתובת נשארים מקור אמת
-- אחד במיגרציה שיצרה אותם.
--
-- אידמפוטנטי פעמיים: הלולאה מדלגת על משימה שכבר יש בה `timeout_milliseconds`,
-- ואם העוגן לא נמצא היא **נופלת ברעש** ולא מדלגת בשקט.
-- ============================================================================

do $$
declare
  j        record;
  v_new    text;
  v_done   int := 0;
  v_skip   int := 0;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן — אין מה לעדכן';
    return;
  end if;

  for j in
    select jobid, jobname, schedule, command
      from cron.job
     where command like '%net.http_post%'
     order by jobname
  loop
    if j.command like '%timeout_milliseconds%' then
      v_skip := v_skip + 1;
      continue;
    end if;

    -- העוגן הוא סוף בלוק הכותרות, שזהה בכל שמונה המשימות:
    --   ‏'x-alert-cron-secret', (select ... limit 1)))
    --   )
    -- ההזרקה נכנסת בין הסוגר של `jsonb_strip_nulls` לסוגר של `http_post`.
    v_new := regexp_replace(
      j.command,
      '(limit 1\)\)\))(\s*)\)',
      '\1,' || chr(10) || '      timeout_milliseconds := 30000' || chr(10) || '    )'
    );

    if v_new = j.command then
      raise exception
        'cron job %: לא נמצאה נקודת ההזרקה ל-timeout_milliseconds. הפקודה שונתה ידנית? יש לעדכן אותה במיגרציה משלה.',
        j.jobname;
    end if;

    perform cron.unschedule(j.jobname);
    perform cron.schedule(j.jobname, j.schedule, v_new);
    v_done := v_done + 1;
  end loop;

  raise notice 'timeout של 30 שניות נוסף ל-% משימות (% כבר היו מעודכנות)', v_done, v_skip;
end;
$$;
