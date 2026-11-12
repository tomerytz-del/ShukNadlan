-- ============================================================================
-- אינדקס לחיפוש של גבריאלה במלאי הלוחות
--
-- גבריאלה, כשהיא מחפשת נכס לסוכן/ת או מתאימה ללקוח/ה, קוראת גם את
-- listing_inventory: מודעות חיות מיד2 וממדלן. הסינון הוא עיר (כולל
-- קבוצה כמו חבל תענך, רשימת city_id) וסוג עסקה, ורק שורות באוויר.
-- האינדקס הקיים הוא (source, city). כאן (city_id, deal_type) על
-- removed_at is null, כדי שהשאילתה מה-Edge Function לא תסרוק את כל
-- המלאי. אין כאן RPC: הקריאה היא service_role, ו-RLS נשאר סגור
-- ל-anon ול-authenticated. אין טלפון ואין שם בטבלה.
-- docs/listing-inventory.md
-- ============================================================================

create index if not exists listing_inventory_active_city_deal_idx
  on public.listing_inventory (city_id, deal_type)
  where removed_at is null;
