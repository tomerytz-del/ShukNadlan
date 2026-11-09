-- ============================================================================
-- מחיקת חשבון בעל/ת מקצוע (עו"ד, יועץ משכנתאות...)
--
-- סוכנים וחברות יזמיות כבר יכולים למחוק את החשבון (close-account, 20271105160000). לבעל מקצוע לא הייתה דרך, ובמסלול
-- הקיים הוא נחשב "none": close-account מחק את המשתמש ב-Auth בלבד, ו-professional_accounts.user_id הוא
-- `on delete cascade`, כלומר החשבון והארנק נמחקו בשקט, בלי החזר ובלי התראה למנהל/ת, והרשומות שמפנות אליהן נותקו.
--
-- אותו דפוס כמו חברה יזמית (close_developer_account): הפרטים האישיים נמחקים, **השורה נשארת מאונונמת**, כי חיובים (lawyer_lead_orders,
-- lawyer_lead_purchases) ויומן הזיכויים מפנים אליה, והם חובת שמירה לפי פקודת מס הכנסה (docs/account-closure.md).
--   * user_id הופך nullable ומתאפס לפני מחיקת המשתמש ב-Auth, כדי שה-cascade לא יימחק את השורה.
--   * כרטיסיית בעל המקצוע באתר (ad_placements) **נשארת**: היא מוצר נפרד שמנוהל מהקישור האישי שלה. card_id מתאפס כדי שאפשר
--     יהיה לפתוח חשבון חדש לאותה כרטיסייה (card_id ייחודי).
--   * יתרת הארנק: אין לבעל מקצוע טעינה בתשלום (הוא קונה ליד בכרטיס, והארנק נטען ידנית בידי מנהל/ת), ולכן אין "יתרה שנטענה
--     בתשלום". היתרה מאופסת ביומן הזיכויים, ומנהלי הפלטפורמה מקבלים התראה לבדוק אם נטענה בתשלום ולהחזיר ידנית.
--   * הזמנת תשלום פתוחה (pending) חוסמת: התשלום אולי כבר בדרך, ומחיקה באמצע הייתה מאבדת אותו.
-- אידמפוטנטית.
-- ============================================================================

alter table public.professional_accounts add column if not exists erased_at timestamptz;
alter table public.professional_accounts alter column user_id drop not null;

comment on column public.professional_accounts.erased_at is
  'מתי נמחקו הפרטים האישיים והכניסה (close_professional_account). השורה נשארת מאונונמת כי חיובים ויומן זיכויים מפנים אליה.';

create or replace function public.close_professional_account(p_account_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acct    public.professional_accounts%rowtype;
  v_email   text;
  v_balance numeric;
  v_reason  text := left(btrim(coalesce(p_reason, '')), 500);
  v_other   boolean := false;
begin
  select * into v_acct from public.professional_accounts where id = p_account_id for update;
  if not found then
    return jsonb_build_object('error', 'account_not_found');
  end if;
  if v_acct.erased_at is not null then
    return jsonb_build_object('error', 'already_closed');
  end if;

  -- תשלום שעוד בדרך: מחיקה עכשיו הייתה משאירה כסף שנגבה בלי חשבון למסור לו את הליד
  if exists (select 1 from public.lawyer_lead_orders where professional_id = p_account_id and status = 'pending') then
    return jsonb_build_object('error', 'payment_pending');
  end if;

  -- שמירות על לידים משתחררות (הזמנות סגורות, אבל ליד שמור לא אמור להישאר תפוס)
  update public.lawyer_leads
     set reserved_by_professional_id = null, reserved_until = null
   where reserved_by_professional_id = p_account_id;

  v_balance := v_acct.credit_balance;
  if v_balance > 0 then
    insert into public.professional_credit_log (account_id, amount, reason, balance_after)
    values (p_account_id, -v_balance, 'סגירת חשבון: היתרה אופסה', 0);
  end if;

  -- מכשירי הדחיפה וההרשמה לניוזלטר שייכים למשתמש, לא לפרופיל: מי שהוא/היא גם סוכן/ת או חברה יזמית ממשיך/ה לקבל אותם.
  -- אותו כלל כמו מחיקת המשתמש ב-Auth (otherLiveProfile ב-account-erasure.ts).
  if v_acct.user_id is not null then
    v_other := exists (select 1 from public.agency_members where user_id = v_acct.user_id and erased_at is null)
            or exists (select 1 from public.developers where user_id = v_acct.user_id and erased_at is null);
    if not v_other then
      select u.email into v_email from auth.users u where u.id = v_acct.user_id;
      delete from public.app_push_devices where user_id = v_acct.user_id;
    end if;
  end if;
  if v_email is not null and btrim(v_email) <> '' then
    delete from public.newsletter_subscribers where lower(email) = lower(btrim(v_email));
  end if;

  -- display_name הוא not null ובאורך 2 לפחות. user_id מתאפס לפני מחיקת המשתמש ב-Auth (cascade).
  update public.professional_accounts
     set display_name = 'חשבון שנמחק',
         phone = null,
         card_id = null,
         user_id = null,
         active = false,
         shelf_enabled = false,
         credit_balance = 0,
         erased_at = now(),
         updated_at = now()
   where id = p_account_id;

  -- יתרה לא מאופסת בשקט: מנהלי הפלטפורמה בודקים אם נטענה בתשלום. suppress_push = false מפורש:
  -- התראה חיה שצריכה לצאת בוואטסאפ (scripts/check_notification_backfill.py).
  if v_balance > 0 then
    insert into public.notifications (agent_id, type, title, body, suppress_push)
    select m.id, 'system',
           'בעל/ת מקצוע מחק/ה את החשבון ויש יתרה בארנק',
           coalesce(nullif(btrim(v_acct.display_name), ''), 'בעל/ת מקצוע') || ' מחק/ה את החשבון. היתרה שאופסה: '
             || v_balance::text || ' ₪. אם היא נטענה בתשלום, יש להחזיר ידנית דרך חברת הסליקה '
             || '(professional_credit_log, חשבון ' || p_account_id::text || ').',
           false
      from public.agency_members m
     where m.is_platform_admin and m.active;
  end if;

  return jsonb_build_object(
    'success', true,
    'account_id', p_account_id,
    'user_id', v_acct.user_id,
    'balance_cleared', v_balance,
    'reason', nullif(v_reason, '')
  );
end;
$$;

comment on function public.close_professional_account(uuid, text) is
  'מחיקת חשבון בעל/ת מקצוע: הפרטים והכניסה נמחקים, השורה נשארת מאונונמת (חיובים מפנים אליה), היתרה מאופסת ומנהלי הפלטפורמה מתראים. service_role בלבד, דרך close-account.';

revoke all on function public.close_professional_account(uuid, text) from public, anon, authenticated;
grant execute on function public.close_professional_account(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- תשלום שמגיע אחרי שהחשבון נמחק
--
-- close_professional_account משאירה את השורה (מאונונמת), ולכן professional_id כבר אינו null אחרי המחיקה. בלי הבדיקה על
-- erased_at, תשלום שהושלם בדיוק מול המחיקה (או אחריה) היה מוכר את הליד לחשבון שנמחק: הכסף נגבה ואיש אינו רואה את הליד.
-- הגוף זהה ל-20271108120000, והשינוי היחיד הוא תנאי 'account_deleted'. ההזמנה עוברת ל-refund_needed ומנהלי הפלטפורמה מקבלים התראה.
-- ---------------------------------------------------------------------------
create or replace function public.complete_lawyer_lead_order(
  p_order_id           uuid,
  p_verified_amount    numeric,
  p_provider_charge_id text default null,
  p_document_id        text default null,
  p_pdf_url            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.lawyer_lead_orders%rowtype;
  v_lead  public.lawyer_leads%rowtype;
  v_reason text;
begin
  select * into v_order from public.lawyer_lead_orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('error', 'order_not_found');
  end if;
  if v_order.status = 'success' then
    return jsonb_build_object('success', true, 'already_completed', true);
  end if;
  if v_order.status <> 'pending' then
    return jsonb_build_object('error', 'order_not_pending', 'status', v_order.status);
  end if;

  -- הסכום שמורנינג דיווחה אינו הסכום שרשמנו. **הכסף כבר נגבה** (הסכום שונה, לא נעדר), ולכן זה לא
  -- "failed" שקט כמו בשאר הסוגים: ההזמנה refund_needed, השמירה משוחררת, ומנהלי הפלטפורמה מקבלים התראה.
  if p_verified_amount is not null and p_verified_amount <> v_order.amount then
    update public.lawyer_lead_orders
       set status = 'refund_needed', completed_at = now(),
           provider_charge_id   = coalesce(p_provider_charge_id, provider_charge_id),
           provider_document_id = coalesce(p_document_id, provider_document_id),
           provider_pdf_url     = coalesce(p_pdf_url, provider_pdf_url),
           failure_reason = format('amount_mismatch: expected %s, provider reported %s',
                                   v_order.amount, p_verified_amount)
     where id = p_order_id;
    update public.lawyer_leads
       set reserved_by_professional_id = null, reserved_until = null
     where id = v_order.lead_id
       and reserved_by_professional_id is not distinct from v_order.professional_id;
    return jsonb_build_object('error', 'refund_needed', 'reason', 'amount_mismatch',
                              'expected', v_order.amount, 'reported', p_verified_amount);
  end if;

  -- התשלום אומת: מכאן הפרטים של מורנינג נשמרים בכל מקרה, גם אם הליד כבר אינו זמין
  update public.lawyer_lead_orders
     set provider_charge_id   = coalesce(p_provider_charge_id, provider_charge_id),
         provider_document_id = coalesce(p_document_id, provider_document_id),
         provider_pdf_url     = coalesce(p_pdf_url, provider_pdf_url)
   where id = p_order_id;

  select * into v_lead from public.lawyer_leads where id = v_order.lead_id for update;

  v_reason := case
    when v_order.lead_id is null or not found then 'lead_deleted'
    when v_order.professional_id is null
         or exists (select 1 from public.professional_accounts pa
                     where pa.id = v_order.professional_id and pa.erased_at is not null) then 'account_deleted'
    when v_lead.status = 'sold' and v_lead.sold_to_professional_id = v_order.professional_id then 'already_owned'
    when v_lead.status = 'sold' then 'lead_sold_to_other'
    when v_lead.status <> 'new' then 'lead_not_available'
    -- שמור כעת לאחר/ת: השמירה שלנו פגה והאחר/ת הקדים/ה
    when v_lead.reserved_until is not null and v_lead.reserved_until > now()
         and v_lead.reserved_by_professional_id is distinct from v_order.professional_id
      then 'lead_reserved_by_other'
    else null
  end;

  if v_reason is not null then
    update public.lawyer_lead_orders
       set status = 'refund_needed', completed_at = now(), failure_reason = v_reason
     where id = p_order_id;
    return jsonb_build_object('error', 'refund_needed', 'reason', v_reason,
                              'amount', v_order.amount);
  end if;

  update public.lawyer_leads
     set status = 'sold', sold_at = now(), sold_to_professional_id = v_order.professional_id,
         reserved_by_professional_id = null, reserved_until = null
   where id = v_order.lead_id and status = 'new';

  insert into public.lawyer_lead_purchases (lead_id, professional_id, amount, status, payment_method, order_id)
  values (v_order.lead_id, v_order.professional_id, v_order.amount_before_vat, 'success', 'card', p_order_id);

  update public.lawyer_lead_orders
     set status = 'success', completed_at = now()
   where id = p_order_id;

  return jsonb_build_object('success', true, 'lead_id', v_order.lead_id,
                            'professional_id', v_order.professional_id);
end;
$$;

comment on function public.complete_lawyer_lead_order(uuid, numeric, text, text, text) is
  'הפונקציה היחידה שמוכרת ליד עו"ד בתשלום בכרטיס. שולם והליד כבר אינו זמין, או שהחשבון נמחק: refund_needed ולא מכירה. service_role בלבד, מ-wallet-topup-callback.';

revoke all on function public.complete_lawyer_lead_order(uuid, numeric, text, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_lawyer_lead_order(uuid, numeric, text, text, text) to service_role;
