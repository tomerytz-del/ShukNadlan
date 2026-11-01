#!/usr/bin/env python3
"""דפדפן: גיליון העדפות במובייל נשאר פתוח, וקובץ עצלן שחוזר 502
או נתקע לא מפיל דשבורד של סוכן/ת מחובר/ת.

שרת מקומי (העץ הזה):  http://127.0.0.1:8742/crm
    python3 scripts/crm_lazy_browser.py

לא רץ ב-CI: אין שם דפדפן.
"""
import asyncio, json, os, re, sys
from playwright.async_api import async_playwright

BASE = os.environ.get('CRM_BASE', 'http://127.0.0.1:8742')
AGENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
AGENT = {
    'id': 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'agency_id': 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'user_id': AGENT_ID, 'slug': 'test', 'display_name': 'בדיקה',
    'role': 'manager', 'tier': 'premium', 'credit_balance': 0,
    'is_platform_admin': False, 'is_mortgage_advisor': False,
    'phone': '0500000000', 'email': 'a@example.com',
    'ethics_code_accepted_at': '2026-01-01T00:00:00Z',
    'tier_selected_at': '2026-01-01T00:00:00Z', 'tier_source': 'chosen',
    'released_at': None, 'closed_at': None, 'page_bg': None,
}
SESSION = {
    'access_token': 'test-access-token', 'refresh_token': 'test-refresh-token',
    'expires_at': 1893456000, 'expires_in': 3600, 'token_type': 'bearer',
    'user': {'id': AGENT_ID, 'aud': 'authenticated', 'role': 'authenticated',
             'email': 'a@example.com'},
}
CONTACTS = (
    'window.ContactImport={pickerSupported:function(){return true},'
    'pick:function(){return Promise.resolve([])},'
    'normPhone:function(p){return p},'
    'phoneKey:function(p){return String(p||"").replace(/\\D/g,"").slice(-9)},'
    'fetchGoogle:function(){return Promise.resolve([])},'
    'parseFile:function(){return Promise.resolve([])},'
    'takeShared:function(){return Promise.resolve([])}};'
)
HARD = re.compile(r'ReferenceError|is not defined|officePreloadNames|leadsTab|clientsKind')
FAILS = []


def fail(msg):
    FAILS.append(msg)
    print('FAIL', msg, flush=True)


async def supabase(route):
    url = route.request.url
    accept = route.request.headers.get('accept') or ''
    one = 'application/vnd.pgrst.object+json' in accept
    body = 'null' if one else '[]'
    if 'agency_members' in url:
        body = json.dumps(AGENT if one else [AGENT])
    elif '/rpc/' in url or '/auth/' in url:
        body = 'null'
    await route.fulfill(status=200, content_type='application/json', body=body)


async def boot(browser, width, height):
    ctx = await browser.new_context(viewport={'width': width, 'height': height})
    page = await ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    await page.add_init_script(
        "localStorage.setItem('sb-obookujgolazrwycsiyn-auth-token', %s);"
        % json.dumps(json.dumps(SESSION)))
    await page.route('**://obookujgolazrwycsiyn.supabase.co/**', supabase)
    return ctx, page, errs


def hard_errors(errs):
    return [e for e in errs if HARD.search(e)]


async def manager_ready(page, timeout):
    await page.wait_for_function(
        """() => {
          const el = document.getElementById('managerSection');
          return !!(el && el.style.display === 'block');
        }""",
        timeout=timeout)


async def sheet_stays(page):
    await page.wait_for_function(
        """() => {
          const sheet = document.getElementById('leadPrefsSheet');
          return !!(sheet && !sheet.hidden);
        }""",
        timeout=10000)
    await page.wait_for_timeout(600)
    return await page.evaluate(
        """() => {
          const sheet = document.getElementById('leadPrefsSheet');
          return !!(sheet && !sheet.hidden && document.body.classList.contains('lp-sheet-open'));
        }""")


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            executable_path='/opt/google/chrome/chrome',
            args=['--proxy-server=127.0.0.1:1', '--proxy-bypass-list=127.0.0.1;<local>'])

        ctx, page, errs = await boot(browser, 390, 844)
        await page.goto(BASE + '/crm?goto=accLeads', wait_until='commit', timeout=60000)
        await manager_ready(page, 30000)
        await page.locator('#leadsPrefEdit').click(timeout=15000)
        if not await sheet_stays(page):
            fail('גיליון העדפות נסגר אחרי הפתיחה')
        else:
            print('prefs-sheet click stays open', flush=True)
        await page.evaluate("""() => {
          if (typeof closeLeadPrefsSheet === 'function') closeLeadPrefsSheet();
          gotoSection('accPrefs', null, { scrollTo: '#setLeadPrefs' });
        }""")
        if not await sheet_stays(page):
            fail('גיליון העדפות נסגר אחרי goto אל #setLeadPrefs')
        else:
            print('prefs-sheet goto stays open', flush=True)
        bad = hard_errors(errs)
        if bad:
            fail('שגיאות בגיליון: ' + ' | '.join(bad[:4]))
        await ctx.close()

        ctx, page, errs = await boot(browser, 1280, 800)
        await page.route('**/assets/crm-office.js', lambda route: route.fulfill(status=502, body='no'))
        await page.route('**/assets/crm-leads.js', lambda route: route.fulfill(status=502, body='no'))
        t0 = asyncio.get_event_loop().time()
        await page.goto(BASE + '/crm', wait_until='commit', timeout=60000)
        await manager_ready(page, 20000)
        ms = int((asyncio.get_event_loop().time() - t0) * 1000)
        leads = await page.locator('#leadsList').inner_text()
        if 'לא נטענה' not in leads:
            fail('רשימת הלידים לא הציגה שגיאה: ' + leads[:120])
        else:
            print('502 dashboard', ms, 'ms, leads error shown', flush=True)
        bad = hard_errors(errs)
        if bad:
            fail('שגיאות אחרי 502: ' + ' | '.join(bad[:4]))
        if ms > 15000:
            fail('502 עיכב את הדשבורד %dms' % ms)
        await ctx.close()

        ctx, page, errs = await boot(browser, 1280, 800)

        async def hang(route):
            await asyncio.sleep(45)
            try:
                await route.abort()
            except Exception:
                pass

        await page.route('**/assets/crm-office.js', hang)
        t0 = asyncio.get_event_loop().time()
        await page.goto(BASE + '/crm', wait_until='commit', timeout=60000)
        await manager_ready(page, 24000)
        ms = int((asyncio.get_event_loop().time() - t0) * 1000)
        print('hang dashboard', ms, 'ms', flush=True)
        if ms < 12000:
            fail('קובץ תקוע לא חיכה ל-timeout: %dms' % ms)
        if ms > 22000:
            fail('timeout ארוך מדי: %dms' % ms)
        bad = hard_errors(errs)
        if bad:
            fail('שגיאות אחרי תקיעה: ' + ' | '.join(bad[:4]))
        await ctx.close()

        ctx, page, errs = await boot(browser, 390, 844)
        await page.route(
            '**/assets/contact-import.js',
            lambda route: route.fulfill(status=200, content_type='application/javascript', body=CONTACTS))
        await page.goto(BASE + '/crm?goto=accClients', wait_until='commit', timeout=60000)
        await manager_ready(page, 30000)
        await page.evaluate("() => { if (typeof openClientForm === 'function') openClientForm(); }")
        await page.wait_for_function(
            """() => {
              const btn = document.getElementById('clPickContact');
              return !!(btn && btn.dataset.bound === '1' && btn.style.display !== 'none');
            }""",
            timeout=10000)
        print('contact pick button shown', flush=True)
        bad = hard_errors(errs)
        if bad:
            fail('שגיאות בכפתור אנשי הקשר: ' + ' | '.join(bad[:4]))
        await ctx.close()
        await browser.close()

    if FAILS:
        sys.exit(1)
    print('browser ok', flush=True)


if __name__ == '__main__':
    asyncio.run(main())
