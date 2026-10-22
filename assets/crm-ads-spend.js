/* ==========================================================================
   פרסום מכל הערוצים - הסכום, ופירוט בלחיצה לכל ערוץ ולכל קמפיין
   --------------------------------------------------------------------------
   תומר, 22.10.2026: "סך כל הפרסומים מכל הערוצים, עם פירוט בלחיצה של כל
   קמפיין - מטא, גוגל ומי שעוד נכניס". מקור אחד, admin_ads_spend (מיגרציה
   20270726090000): מטא מ-ads_insights_daily, וכל ערוץ אחר מ-ads_channel_daily.
   ערוץ חדש שכותב לשם מופיע כאן מעצמו; השם היפה שלו - שורה ב-ADS_CHANNELS.

   מוצג בשני מקומות, באותו רינדור: כרטיס "פרסום החודש" במרכז הפיקוד, והשורה
   "פרסום" בבלוק התקציב של "עלויות תפעול ו-AI" (assets/crm-budget.js).
   נטען לפני assets/crm.js ומשתמש ב-esc שלו רק בזמן קריאה.
   ========================================================================== */

const ADS_CHANNELS = {
  meta:   { label: 'מטא · פייסבוק ואינסטגרם', leads: 'לידים' },
  google: { label: 'גוגל', leads: 'המרות' },
};

function adsMoney(n){ return '₪' + Math.round(Number(n) || 0).toLocaleString('he-IL'); }
function adsInt(n){ return (Math.round(Number(n) || 0)).toLocaleString('he-IL'); }

/* ‏data - admin_ads_spend. ‏null - המיגרציה טרם רצה. ‏label - מה הסכום מכסה */
function adsSpendHtml(data, label){
  if (!data) return '<div class="empty-state">ההוצאה על פרסום עוד לא זמינה במסד - המיגרציה 20270726090000 טרם רצה.</div>';
  const chans = Array.isArray(data.channels) ? data.channels : [];
  const ncamp = chans.reduce((s, c) => s + ((c.campaigns || []).length), 0);
  let html = '<div class="ads-total"><b>' + esc(adsMoney(data.total)) + '</b><span>'
    + esc((label || 'החודש') + ', בכל הערוצים' + (ncamp ? ' · ' + ncamp + (ncamp === 1 ? ' קמפיין' : ' קמפיינים') : '')) + '</span></div>';
  if (!chans.length) return html + '<div class="empty-state">אין הוצאה על פרסום בתקופה הזו.</div>';
  html += chans.map(c => {
    const def = ADS_CHANNELS[c.channel] || { label: c.channel, leads: 'המרות' };
    const leads = Number(c.leads) || 0;
    const sub = adsInt(c.clicks) + ' קליקים · ' + adsInt(leads) + ' ' + def.leads
      + (leads ? ' · ' + adsMoney(Number(c.spend) / leads) + ' ל' + (def.leads === 'לידים' ? 'ליד' : 'המרה') : '');
    return '<details class="ads-ch"><summary><span class="nm">' + esc(def.label) + '<small>' + esc(sub) + '</small></span>'
      + '<b>' + esc(adsMoney(c.spend)) + '</b></summary>'
      + (c.campaigns || []).map(k => {
          const kl = Number(k.leads) || 0;
          return '<div class="ads-camp"><span class="nm">' + esc(k.name || k.id) + '<small>'
            + esc(adsInt(k.clicks) + ' קליקים · ' + adsInt(kl) + ' ' + def.leads
              + (kl ? ' · ' + adsMoney(Number(k.spend) / kl) + ' ל' + (def.leads === 'לידים' ? 'ליד' : 'המרה') : ''))
            + '</small></span><b>' + esc(adsMoney(k.spend)) + '</b></div>';
        }).join('')
      + '</details>';
  }).join('');
  const synced = data.synced || {};
  const stamps = Object.keys(ADS_CHANNELS).filter(k => synced[k])
    .map(k => ADS_CHANNELS[k].label.split(' ')[0] + ' ' + new Date(synced[k]).toLocaleDateString('he-IL'));
  if (stamps.length) html += '<p class="ads-sync">' + esc('עודכן: ' + stamps.join(' · ') + '. הסנכרון לילי.') + '</p>';
  return html;
}
