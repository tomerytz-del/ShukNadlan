-- ============================================================================
-- קריאת פריט מקטלוג וואטסאפ דרך pg_net - הגיבוי של whatsapp-webhook
--
-- מה שבור: #583 קורא את הדף wa.me/p/<product>/<phone> מתוך ה-Edge Function.
-- בניסיון האמיתי הראשון (4.10.2026, 17:45) wa.me ענה 400 לבקשה מהפונקציה -
-- ובאותה דקה אותו קישור בדיוק, עם אותן כותרות, החזיר 200 ואת כל הפריט
-- כשנקרא מהמסד דרך pg_net. כלומר הקישור תקין, וההבדל הוא מאיפה הבקשה יוצאת.
-- גבריאלה ענתה כמו שצריך ("לא הצלחתי לקרוא, אל תנחשי"), אבל היכולת לא עבדה.
--
-- מה נכנס: שתי פונקציות שהפונקציה קוראת להן רק כשהניסיון הישיר נכשל.
--
--   whatsapp_catalog_fetch_start(product, phone)  -> מזהה הבקשה ב-pg_net
--   whatsapp_catalog_fetch_result(id)             -> סטטוס ותוכן, או כלום
--
-- pg_net אסינכרוני: הבקשה יוצאת רק אחרי שהטרנזקציה של start נסגרת, והתשובה
-- נכתבת ל-net._http_response תוך שנייה-שתיים. הפונקציה ממתינה ושואלת שוב.
--
-- למה זה בטוח:
--   - הכתובת נבנית כאן מספרות בלבד (בדיקת regex), ולא מתקבלת כטקסט. אין דרך
--     לגרום למסד לפנות לכתובת אחרת דרך הפונקציה הזו.
--   - שתיהן ל-service_role בלבד, בשלושת התפקידים במפורש (CLAUDE.md, כלל 5).
-- ============================================================================

create or replace function public.whatsapp_catalog_fetch_start(
  p_product text,
  p_phone   text default null
)
returns bigint
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_product is null or p_product !~ '^[0-9]{5,25}$' then
    raise exception 'whatsapp_catalog_fetch_start: invalid product id';
  end if;
  if p_phone is not null and p_phone !~ '^[0-9]{6,15}$' then
    raise exception 'whatsapp_catalog_fetch_start: invalid phone';
  end if;

  -- בלי Accept-Language: כך הדף חוזר בנוסח האנגלי ("<פריט> from <עסק> on
  -- WhatsApp."), שנבדק מהמסד ב-4.10.2026.
  return net.http_get(
    url := 'https://wa.me/p/' || p_product || coalesce('/' || p_phone, ''),
    headers := jsonb_build_object(
      'User-Agent', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
    ),
    timeout_milliseconds := 10000
  );
end;
$$;

revoke all on function public.whatsapp_catalog_fetch_start(text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_catalog_fetch_start(text, text) to service_role;

-- שורה ריקה = עוד לא חזרה תשובה, והקורא/ת שואל/ת שוב.
create or replace function public.whatsapp_catalog_fetch_result(p_id bigint)
returns table (status_code integer, content text, error_msg text, timed_out boolean)
language sql
stable
security definer
set search_path to ''
as $$
  select r.status_code, r.content, r.error_msg, r.timed_out
    from net._http_response r
   where r.id = p_id;
$$;

revoke all on function public.whatsapp_catalog_fetch_result(bigint) from public, anon, authenticated;
grant execute on function public.whatsapp_catalog_fetch_result(bigint) to service_role;
