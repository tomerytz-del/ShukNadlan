-- אינדקס על agent_clients.agency_id.
--
-- מה חסר: המפתח הזר agent_clients_agency_id_fkey (on delete set null) הוא
-- היחיד בטבלה שאין אינדקס על העמודה שלו. מחיקה או איחוד של משרד
-- (הסקיל office-team) סורקים בגללו את כל קובץ הלקוחות כדי למצוא את השורות
-- של המשרד. הסוכן התפעולי פתח על זה ממצא ב-24.11.2026
-- (performance:unindexed_fk:agent_clients.agency_id), כשהטבלה חצתה 200KB.
--
-- כמה זה שווה היום: מעט. 309 שורות ב-22 משרדים, והסריקה המלאה היא 26
-- עמודים. האינדקס נכנס עכשיו כי הוא זול כשהטבלה קטנה, והטבלה רק גדלה.
-- אין שינוי בהרשאות, ב-RLS או בהתנהגות.
--
-- אידמפוטנטי: if not exists.

create index if not exists agent_clients_agency_id_idx
  on public.agent_clients (agency_id);
