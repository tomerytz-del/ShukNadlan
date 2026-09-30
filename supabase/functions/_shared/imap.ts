// ============================================================================
// ‏לקוח IMAP מינימלי — קריאה בלבד, לתיבת הקליטה של המייל (docs/email-intake.md).
//
// אותו הגיון של ה-SMTP ב-`platform-mail`: הפרוטוקול קצר, וספרייה של Node
// (‏imapflow) נשענת על net/tls ועל אירועים שאינם מובטחים בסביבת ה-Edge. כאן
// כל בית שיוצא בחוט נכתב במפורש, ויש רק ארבע פקודות: LOGIN, ‏EXAMINE,
// ‏UID SEARCH, ‏UID FETCH.
//
// ‏**EXAMINE ולא SELECT.** התיבה היא תיבת הפלטפורמה, ויש בה גם מייל שאינו
// שלנו. ‏EXAMINE פותח אותה לקריאה בלבד, ולכן אי אפשר לסמן בה "נקרא" גם
// בטעות — וגם ‏BODY.PEEK נשאר כהגנה שנייה.
//
// ‏**ליטרלים.** שרת IMAP מחזיר תוכן ארוך כ-`{N}\r\n` ואחריו N **בתים**
// בדיוק. לכן הקורא עובד על בתים ולא על מחרוזת: מייל בעברית ב-UTF-8 הוא יותר
// בתים מתווים, וספירה בתווים הייתה חותכת אותו באמצע.
// ============================================================================

const CRLF = "\r\n";
const utf8 = new TextEncoder();
const latin = new TextDecoder("latin1");

export interface ImapResponse {
  /** השורות, כשכל ליטרל מוחלף ב-`{#n}` — המיקום שלו ב-`literals`. */
  text: string;
  literals: Uint8Array[];
}

export class ImapError extends Error {}

export class ImapClient {
  private buf = new Uint8Array(0);
  private tagN = 0;
  private deadline: ReturnType<typeof setTimeout> | undefined;

  private constructor(private conn: Deno.TlsConn) {}

  static async connect(host: string, port = 993, timeoutMs = 60_000): Promise<ImapClient> {
    const conn = await Deno.connectTls({ hostname: host, port });
    const c = new ImapClient(conn);
    // שרת ששותק אינו מחזיר שגיאה. סגירה כפויה הופכת את השתיקה לכישלון.
    c.deadline = setTimeout(() => c.close(), timeoutMs);
    const greeting = await c.readLine();
    if (!/^\* (OK|PREAUTH)/i.test(greeting)) {
      c.close();
      throw new ImapError(`imap greeting: ${greeting.slice(0, 120)}`);
    }
    return c;
  }

  close(): void {
    if (this.deadline !== undefined) clearTimeout(this.deadline);
    try { this.conn.close(); } catch { /* כבר נסגר */ }
  }

  // ---------------------------------------------------------------------------
  // קריאה מהשקע
  // ---------------------------------------------------------------------------
  private async fill(): Promise<void> {
    const chunk = new Uint8Array(16384);
    const n = await this.conn.read(chunk);
    if (n === null) throw new ImapError("imap: השרת סגר את החיבור");
    const next = new Uint8Array(this.buf.length + n);
    next.set(this.buf);
    next.set(chunk.subarray(0, n), this.buf.length);
    this.buf = next;
  }

  private async readLine(): Promise<string> {
    for (;;) {
      for (let i = 0; i + 1 < this.buf.length; i++) {
        if (this.buf[i] === 13 && this.buf[i + 1] === 10) {
          const line = latin.decode(this.buf.subarray(0, i));
          this.buf = this.buf.subarray(i + 2);
          return line;
        }
      }
      await this.fill();
    }
  }

  private async readBytes(n: number): Promise<Uint8Array> {
    while (this.buf.length < n) await this.fill();
    const out = this.buf.slice(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }

  /** תגובה אחת שלמה — שורה, ואם היא נגמרת בליטרל, גם הליטרל וההמשך. */
  private async readResponse(): Promise<ImapResponse> {
    let text = "";
    const literals: Uint8Array[] = [];
    for (;;) {
      const line = await this.readLine();
      const m = line.match(/\{(\d+)\}$/);
      if (!m) {
        text += line;
        return { text, literals };
      }
      text += line.slice(0, line.length - m[0].length) + `{#${literals.length}}`;
      literals.push(await this.readBytes(Number(m[1])));
    }
  }

  /** פקודה → כל התגובות הלא-מתויגות שלה. זורקת על NO/BAD. */
  async command(cmd: string): Promise<ImapResponse[]> {
    const tag = `a${++this.tagN}`;
    const data = utf8.encode(`${tag} ${cmd}${CRLF}`);
    let off = 0;
    while (off < data.length) off += await this.conn.write(data.subarray(off));

    const untagged: ImapResponse[] = [];
    for (;;) {
      const r = await this.readResponse();
      if (r.text.startsWith(`${tag} `)) {
        if (!/^\S+ OK/i.test(r.text)) {
          // ‏הפקודה עצמה לא נכנסת להודעה — אחת מהן היא הסיסמה.
          throw new ImapError(`imap: ${r.text.slice(tag.length + 1, tag.length + 160)}`);
        }
        return untagged;
      }
      untagged.push(r);
    }
  }

  // ---------------------------------------------------------------------------
  // הפקודות
  // ---------------------------------------------------------------------------
  async login(user: string, pass: string): Promise<void> {
    await this.command(`LOGIN ${quote(user)} ${quote(pass)}`);
  }

  async examine(mailbox: string): Promise<{ uidvalidity: number; uidnext: number | null }> {
    const res = await this.command(`EXAMINE ${quote(mailbox)}`);
    let uidvalidity = 0;
    let uidnext: number | null = null;
    for (const r of res) {
      const v = r.text.match(/\[UIDVALIDITY (\d+)\]/i);
      if (v) uidvalidity = Number(v[1]);
      const n = r.text.match(/\[UIDNEXT (\d+)\]/i);
      if (n) uidnext = Number(n[1]);
    }
    if (!uidvalidity) throw new ImapError("imap: אין UIDVALIDITY בתשובת EXAMINE");
    return { uidvalidity, uidnext };
  }

  /** ‏`criteria` בתחביר IMAP, למשל `UID 120:*` או `SINCE 29-Sep-2026`. */
  async uidSearch(criteria: string): Promise<number[]> {
    const res = await this.command(`UID SEARCH ${criteria}`);
    const out: number[] = [];
    for (const r of res) {
      const m = r.text.match(/^\* SEARCH\b(.*)$/i);
      if (!m) continue;
      for (const s of m[1].trim().split(/\s+/)) if (/^\d+$/.test(s)) out.push(Number(s));
    }
    return out.sort((a, b) => a - b);
  }

  /**
   * ‏UID FETCH עם פריט אחד של BODY.PEEK. מחזירה לכל UID את הבתים של הפריט
   * (או מערך ריק כשהשרת החזיר NIL / מחרוזת ריקה), ואת RFC822.SIZE אם התבקש.
   */
  async uidFetch(
    uids: number[],
    item: string,
  ): Promise<Map<number, { bytes: Uint8Array; size: number | null }>> {
    const out = new Map<number, { bytes: Uint8Array; size: number | null }>();
    if (!uids.length) return out;
    const res = await this.command(`UID FETCH ${uids.join(",")} (UID RFC822.SIZE ${item})`);
    for (const r of res) {
      if (!/^\* \d+ FETCH/i.test(r.text)) continue;
      const uid = r.text.match(/\bUID (\d+)/i);
      if (!uid) continue;
      const size = r.text.match(/\bRFC822\.SIZE (\d+)/i);
      const lit = r.text.match(/\{#(\d+)\}/);
      let bytes: Uint8Array = lit ? r.literals[Number(lit[1])] : new Uint8Array(0);
      if (!lit) {
        // תוכן קצר יכול לחזור כמחרוזת במירכאות ולא כליטרל
        const q = r.text.match(/BODY\[[^\]]*\](?:<\d+>)?\s+"((?:[^"\\]|\\.)*)"/i);
        if (q) bytes = utf8.encode(q[1].replace(/\\(.)/g, "$1"));
      }
      out.set(Number(uid[1]), { bytes, size: size ? Number(size[1]) : null });
    }
    return out;
  }

  async logout(): Promise<void> {
    try { await this.command("LOGOUT"); } catch { /* הפרידה אינה חלק מהעבודה */ }
    this.close();
  }
}

/** מחרוזת מצוטטת של IMAP. סיסמת אפליקציה של Google היא אותיות בלבד, אבל שם תיבה אינו. */
function quote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** תאריך בתחביר SEARCH של IMAP: ‏`29-Sep-2026`. */
export function imapDate(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getUTCDate()}-${months[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}
