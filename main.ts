import { Hono } from "hono";
import { cors } from "jsr:@hono/hono/cors";

const app = new Hono();

app.use("*", cors());

let kv: Deno.Kv | null = null;
try {
  kv = await Deno.openKv();
  console.log("[KV] Deno KV initialized successfully");
} catch (err) {
  console.error("[KV] Failed to initialize Deno KV:", err);
}

app.get("/", async (c) => {
  try {
    const html = await Deno.readTextFile("./static/index.html");
    return c.html(html);
  } catch {
    return c.text("index.html not found", 404);
  }
});

app.get("/demo", async (c) => {
  try {
    const html = await Deno.readTextFile("./static/demo.html");
    return c.html(html);
  } catch {
    return c.text("demo.html not found", 404);
  }
});

app.get("/transcript", async (c) => {
  if (!checkBasicAuth(c.req.raw, "TRANSCRIPT_PASSWORD")) {
    return unauthorizedResponse();
  }
  try {
    const html = await Deno.readTextFile("./static/transcript.html");
    return c.html(html);
  } catch {
    return c.text("transcript.html not found", 404);
  }
});

app.get("/chat-widget.js", async (c) => {
  try {
    const js = await Deno.readTextFile("./static/chat-widget.js");
    return new Response(js, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    return c.text("chat-widget.js not found", 404);
  }
});

interface GenerateRequest {
  treatment: string;
  patient: string;
  style: string;
}

app.post("/api/generate", async (c) => {
  try {
    const body = await c.req.json<GenerateRequest>();
    const { treatment, patient, style } = body;

    if (!treatment || !patient || !style) {
      return c.json(
        { error: "治療メニュー、対象患者、スタイルをすべて選択してください" },
        400,
      );
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return c.json({ error: "APIキーが設定されていません" }, 500);
    }

    const prompt = buildPrompt(treatment, patient, style);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", errText);
      return c.json({ error: "AI APIの呼び出しに失敗しました" }, 500);
    }

    const data = await response.json();
    const text = data.content[0].text;

    return c.json({ result: text });
  } catch (err) {
    console.error("Error:", err);
    return c.json({ error: "サーバーエラーが発生しました" }, 500);
  }
});

const CHAT_SYSTEM_PROMPT = `あなたはふじもと歯科の公式AIアシスタントです。
以下の「掲載情報」と「よくある質問」にある内容だけをもとに、親しみやすく安心感のある言葉で回答してください。

【回答のトーンと絶対ルール】
- 親しみやすく・温かみのある口調で、患者さんが安心できるよう心がけてください
- 以下の掲載情報・よくある質問にある内容のみを使って回答してください
- 掲載情報にない質問には「詳しくはお電話（050-1808-5701）またはホームページ（https://shika-fujimoto.com/）にてご確認ください😊」と案内してください
- 一般的な医療・歯科知識で補足・推測しないでください
- 治療効果・結果の保証は絶対にしないでください
- 医療広告ガイドラインに配慮し、断定的・誇大な表現は避けてください
- 料金の詳細はホームページへ誘導してください
- 回答は簡潔にまとめ、必要に応じて絵文字を添えて親しみやすくしてください

【掲載情報】

＜基本情報＞
医院名：ふじもと歯科
所在地：〒590-0077 大阪府堺市堺区中瓦町2-3-14 パーターさかもと銀座ビル2階
電話：050-1808-5701
アクセス：堺東駅西口から徒歩2分、駐輪スペースあり、近隣タイムズ提携駐車場（200円補助券あり）
Instagram：@fujimotoshika
ホームページ：https://shika-fujimoto.com/

＜院長＞
藤本直志（ふじもと なおゆき）
2015年ふじもと歯科開院。「痛い・怖い」イメージを払拭し「また行きたい」医院づくりを目指す。親しみやすさを大切にしている。

＜診療時間＞
月・火・木・金：9:30〜13:30 ／ 15:00〜19:00
土：9:30〜13:30 ／ 14:30〜18:00
休診日：水曜・日曜・祝日
※祝日がある週の水曜は診療あり（詳細はお電話で確認を）

＜診療内容＞
一般歯科、歯周病治療、予防・メンテナンス、小児歯科（生後4か月〜）、小児矯正、
セラミック・審美治療、ホワイトニング、入れ歯（保険・自費）、成人矯正（マウスピース矯正）、栄養相談

＜料金・支払い＞
保険診療・自費診療どちらも対応。
クレジットカード・PayPay：自費診療のみ利用可。
電子マネー：利用不可。
分割払い：治療内容によっては2回払いまで可。
医療費控除：対象になる場合あり（詳細はHP）。
料金詳細：ホームページ（https://shika-fujimoto.com/）にてご確認ください。

＜医院の特徴・設備＞
- スタッフのコミュニケーションと親しみやすさ、丁寧な説明
- 土曜診療あり（平日来られない方も安心）
- 予防・メンテナンス中心で痛みに配慮した治療
- 半個室・個室診療室でプライバシーに配慮
- クラスB滅菌器による徹底した衛生管理・感染対策
- 託児サービスあり（予約制）
- 管理栄養士による栄養相談あり
- バリアフリーではない（エレベーター詳細は要確認）
- 院内Wi-Fiなし

【よくある質問と回答】

＜アクセス・基本情報＞

Q: 住所・場所を教えてください
A: 堺市堺区中瓦町2-3-14 パーターさかもと銀座ビル2階です。堺東駅西口から徒歩2分で便利ですよ😊

Q: 最寄り駅はどこですか？
A: 南海高野線・堺東駅の西口から徒歩2分です🚉 ぜひご利用ください。

Q: バスで行けますか？
A: 近隣バス停からもお越しいただけます。詳しくはお電話（050-1808-5701）またはホームページでご確認ください😊

Q: 自転車で行けますか？
A: はい、駐輪スペースがございますので自転車でのご来院もOKです🚲

Q: 駐車場はありますか？
A: 近隣のタイムズが提携駐車場になります。お一人1枚200円の補助券をお渡ししています🚗 駐輪スペースもございますよ。

Q: 何階にありますか？
A: 2階です。エレベーターの詳細はお電話（050-1808-5701）でご確認ください😊

＜診療時間・予約＞

Q: 診療時間を教えてください
A: 月・火・木・金は 9:30〜13:30 と 15:00〜19:00、土曜は 9:30〜13:30 と 14:30〜18:00 です。水曜・日曜・祝日は休診です😊

Q: 今日は診療していますか？
A: 診療時間は月・火・木・金が 9:30〜13:30／15:00〜19:00、土曜が 9:30〜13:30／14:30〜18:00 です。水・日・祝は休診です。現在時刻でご確認ください😊

Q: 水曜日は休みですか？
A: はい、通常は休診です。ただし祝日がある週の水曜は診療している場合がありますので、詳しくはお電話（050-1808-5701）でご確認ください。

Q: 祝日は診療していますか？
A: 祝日は原則休診です。祝日がある週の水曜日は診療している場合がありますのでお電話（050-1808-5701）でご確認ください。

Q: 年末年始の診療は？
A: 年末年始の診療日程はWEB予約ページ（https://shika-fujimoto.com/）にてご確認ください😊

Q: 予約なしでも行けますか？
A: 予約の方を優先してご案内しているため、事前のご予約をお勧めします。お電話（050-1808-5701）またはWEB予約をご利用ください😊

Q: 当日予約はできますか？
A: お電話（050-1808-5701）またはホームページ（https://shika-fujimoto.com/）のWEB予約からどうぞ。当日の空き状況はお電話が確実です。

Q: キャンセルや予約の変更はどうすればいいですか？
A: お電話（050-1808-5701）にてご連絡ください。早めのご連絡をお願いします。

Q: 初診はどのくらい時間がかかりますか？
A: 問診・検査・説明を含めて40〜80分程度が目安です。お時間に余裕を持ってお越しください😊

Q: 待ち時間はどのくらいですか？
A: 予約制のため比較的スムーズにご案内できます。状況によってお待たせする場合もございますのでご了承ください。

＜料金・保険・支払い＞

Q: 保険は使えますか？
A: はい、保険診療・自費診療どちらにも対応しています。詳細はホームページ（https://shika-fujimoto.com/）またはお電話（050-1808-5701）でご確認ください😊

Q: クレジットカードは使えますか？
A: 自費診療のみクレジットカードがご利用いただけます。保険診療は現金のみとなります。

Q: 電子マネーは使えますか？
A: 申し訳ありませんが、電子マネーはご利用いただけません。

Q: PayPayは使えますか？
A: 自費診療のみPayPayがご利用いただけます。保険診療は現金のみとなります。

Q: 分割払いはできますか？
A: 治療内容によっては2回払いまで対応可能な場合があります。詳しくはご来院時にスタッフにご相談ください。

Q: 医療費控除は使えますか？
A: 歯科治療は医療費控除の対象になる場合があります。詳細はホームページ（https://shika-fujimoto.com/）またはお電話でご確認ください。

Q: 初診料はいくらですか？
A: 料金の詳細はホームページ（https://shika-fujimoto.com/）またはお電話（050-1808-5701）にてご確認ください😊

＜治療メニュー＞

Q: ホワイトニングはいくらですか？
A: オフィスホワイトニングは初回のみ半額の7,700円でご提供しています！詳しくはホームページ（https://shika-fujimoto.com/）またはお電話（050-1808-5701）でご確認ください😊

Q: ホワイトニングの効果はどのくらい続きますか？
A: 個人差がありますので効果の期間を一概にお伝えするのが難しい状況です。詳しくはご来院時にご説明します😊

Q: ホワイトニングは痛いですか？
A: 知覚過敏が出る場合がありますが、丁寧に対応しています。不安な方はお気軽にご相談ください。

Q: マウスピース矯正とワイヤー矯正の違いは？
A: マウスピース矯正は取り外しができて目立ちにくい特徴があり、ワイヤー矯正はより幅広い症例に対応できる特徴があります。どちらが合っているかは診察でご相談ください😊

Q: インプラントは何回通院が必要ですか？
A: 個人差がありますので、診察でご確認ください。詳しくはお電話（050-1808-5701）またはご来院時にご相談ください。

Q: 歯周病治療はできますか？
A: はい、歯周病治療にも対応しています。気になる症状があればお気軽にご相談ください😊

Q: 入れ歯はどんな種類がありますか？
A: 保険の入れ歯・自費の入れ歯どちらにも対応しています。詳しくはホームページまたはご来院時にご説明します😊

Q: セラミックと保険の被せ物の違いは？
A: セラミックは見た目が天然歯に近く耐久性に優れますが自費となります。保険の被せ物は費用を抑えられますが素材が異なります。詳しくは診察でご説明します。

Q: 神経を抜く治療は痛いですか？
A: 麻酔をしっかり行ってから治療を進めますので、できるだけ痛みのないよう配慮しています😊 不安な方はお気軽にお申し付けください。

Q: 歯を抜いた後はどうなりますか？
A: インプラント・入れ歯・ブリッジなどの選択肢があります。それぞれの特徴は診察時に詳しくご説明しますね😊

＜小児歯科・家族＞

Q: 何歳から通えますか？
A: 生後4か月からご来院いただけます。お子さまの歯の健康のためにも、早めのご相談をおすすめします😊

Q: 子どもが歯医者を怖がっているのですが大丈夫ですか？
A: お子さまのペースに合わせて、無理なく進めていきます。怖がらなくて済むよう丁寧に対応しますのでご安心ください🌟

Q: 子どもの矯正はいつから始めるといいですか？
A: 早めにご相談いただくことをおすすめしています。お子さまの状態に合わせた時期を診察でご確認ください😊

Q: 乳歯の虫歯も治療できますか？
A: はい、乳歯の虫歯治療も対応しています。お早めにご相談ください。

Q: 託児サービスはありますか？
A: はい、予約制で託児サービスをご利用いただけます。ご予約の際にお申し付けください😊

Q: 妊娠中でも診てもらえますか？
A: はい、妊娠中こそ口腔ケアが大切です。妊娠中の方にも安心してご受診いただけますので、ぜひご相談ください😊

＜初めての方・不安な方＞

Q: 歯医者が怖いのですが大丈夫ですか？
A: 大丈夫ですよ😊 痛みに最大限配慮し、丁寧にご説明しながら進めます。不安なことは何でもスタッフにお聞かせください。一緒に進めていきましょう！

Q: 久しぶりに歯医者に行くのですが…
A: どんな状態でもあたたかくお迎えします😊 長い間行けていなかった方も大歓迎ですよ。まずはお気軽にいらしてください。

Q: 初診では何をされますか？
A: まず問診でお悩みや既往歴などをお聞きし、口腔内の検査・レントゲンを行い、結果をわかりやすくご説明します。40〜80分程度が目安です😊

Q: 初めて行くとき何を持っていけばいいですか？
A: マイナンバーカード（または健康保険証・資格確認証等）とお薬手帳をご持参ください😊

Q: 口臭が気になるのですが…
A: クリーニングや歯周病治療で改善できる場合があります。お気軽にご相談ください😊

Q: 歯がしみるのですが…
A: 知覚過敏や虫歯などの可能性があります。悪化する前に診察を受けることをおすすめします。お気軽にご相談ください😊

Q: 歯ぐきから血が出るのですが…
A: 歯周病の可能性があります。早めの受診をおすすめします。お電話（050-1808-5701）またはWEB予約からどうぞ😊

Q: 夜中に歯が痛くなったらどうすればいいですか？
A: 翌日早めにお電話（050-1808-5701）いただき、予約をお取りください。お待ちしております。

Q: セカンドオピニオンもできますか？
A: 詳しくはお電話（050-1808-5701）またはホームページ（https://shika-fujimoto.com/）にてご確認ください😊

＜院の特徴・設備＞

Q: 個室はありますか？
A: はい、半個室・個室の診療室をご用意しています。プライバシーに配慮した環境でご受診いただけます😊

Q: 衛生管理は大丈夫ですか？
A: クラスB滅菌器を使用し、徹底した衛生管理・感染対策を行っています。安心してご来院ください😊

Q: 管理栄養士に相談できますか？
A: はい、管理栄養士による栄養相談を行っています。口腔の健康と食事についてご相談いただけます😊

Q: バリアフリーですか？
A: バリアフリー対応ではございません。お体の不自由な方はご来院前にお電話（050-1808-5701）にてご相談ください。

Q: Wi-Fiはありますか？
A: 申し訳ありませんが、院内Wi-Fiはございません。

Q: 院長はどんな先生ですか？
A: 院長の藤本直志先生は2015年に開院し、「また行きたい」と思っていただける医院づくりを目指しています。親しみやすさを大切にしている先生ですよ😊`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  message: string;
  history?: ChatMessage[];
}

interface ChatLog {
  question: string;
  reply: string;
  timestamp: string;
  sessionId: string;
}

app.post("/api/chat", async (c) => {
  try {
    const body = await c.req.json<ChatRequest>();
    const { message, history = [] } = body;

    if (!message?.trim()) {
      return c.json({ error: "メッセージが空です" }, 400);
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    console.log("[chat] ANTHROPIC_API_KEY:", apiKey ? `set (length=${apiKey.length})` : "NOT SET");
    if (!apiKey) {
      console.error("[chat] ANTHROPIC_API_KEY is not configured");
      return c.json({ error: "APIキーが設定されていません" }, 500);
    }

    const messages: ChatMessage[] = [
      ...history.slice(-8),
      { role: "user", content: message.trim() },
    ];

    console.log("[chat] Calling Anthropic API, message length:", message.trim().length);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        system: CHAT_SYSTEM_PROMPT,
        messages,
      }),
    });

    console.log("[chat] Anthropic API status:", response.status, response.statusText);

    if (!response.ok) {
      const errText = await response.text();
      console.error("[chat] Anthropic API error - status:", response.status, "body:", errText);
      return c.json({ error: "AIの応答に失敗しました" }, 500);
    }

    const data = await response.json();
    console.log("[chat] Anthropic API response received, content length:", data.content?.[0]?.text?.length ?? 0);
    const reply = data.content[0].text;

    if (kv) {
      try {
        const sessionId = crypto.randomUUID();
        const now = new Date();
        const jstTimestamp = new Date(now.getTime() + 9 * 60 * 60 * 1000)
          .toISOString()
          .replace("Z", "+09:00");
        await kv.set(["chat_logs", now.getTime(), sessionId], {
          question: message.trim(),
          reply,
          timestamp: jstTimestamp,
          sessionId,
        } satisfies ChatLog);
      } catch (err) {
        console.error("[KV] Failed to save chat log:", err);
      }
    }

    return c.json({ reply });
  } catch (err) {
    console.error("[chat] Unexpected error:", err);
    console.error("[chat] Error type:", err instanceof Error ? err.constructor.name : typeof err);
    console.error("[chat] Error message:", err instanceof Error ? err.message : String(err));
    return c.json({ error: "エラーが発生しました" }, 500);
  }
});

// ── Admin utilities ──────────────────────────────────────────────────────────

function checkBasicAuth(req: Request, envKey = "ADMIN_PASSWORD"): boolean {
  const adminPassword = Deno.env.get(envKey);
  if (!adminPassword) return false;
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Basic ")) return false;
  const decoded = atob(auth.slice(6));
  const colon = decoded.indexOf(":");
  const password = colon >= 0 ? decoded.slice(colon + 1) : decoded;
  return password === adminPassword;
}

function unauthorizedResponse(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": `Basic realm="Admin"` },
  });
}

async function fetchAllLogs(): Promise<ChatLog[] | null> {
  if (!kv) return null;
  try {
    const logs: ChatLog[] = [];
    const iter = kv.list<ChatLog>({ prefix: ["chat_logs"] });
    for await (const entry of iter) {
      logs.push(entry.value);
    }
    logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return logs;
  } catch (err) {
    console.error("[KV] Failed to fetch logs:", err);
    return null;
  }
}

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildCsv(logs: ChatLog[]): string {
  const rows: string[][] = [["日時", "セッションID", "質問", "回答"]];
  for (const log of logs) {
    rows.push([log.timestamp, log.sessionId, log.question, log.reply]);
  }
  return rows
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
    )
    .join("\r\n");
}

function logsPageHtml(logs: ChatLog[]): string {
  const rowsHtml = logs
    .map(
      (log) => `
      <tr>
        <td class="td-time">${escHtml(log.timestamp)}</td>
        <td class="td-sid">${escHtml(log.sessionId.slice(0, 8))}…</td>
        <td class="td-q">${escHtml(log.question)}</td>
        <td class="td-a">${escHtml(log.reply)}</td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>チャットログ - ふじもと歯科</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Hiragino Sans', 'Meiryo', sans-serif; background: #f0f4f8; color: #2d3748; min-height: 100vh; }
    header { background: #1A73A7; color: white; padding: 0.9rem 1.5rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
    header h1 { font-size: 1.05rem; white-space: nowrap; }
    .hactions { display: flex; gap: 0.6rem; flex-shrink: 0; }
    .btn { padding: 0.45rem 1rem; border-radius: 6px; font-size: 0.82rem; font-weight: 600; cursor: pointer; text-decoration: none; border: none; display: inline-block; }
    .btn-csv { background: #38a169; color: white; }
    .btn-csv:hover { background: #276749; }
    .container { max-width: 1400px; margin: 1.5rem auto; padding: 0 1rem; }
    .meta { background: white; border-radius: 8px; padding: 0.6rem 1.25rem; margin-bottom: 1rem; font-size: 0.83rem; color: #718096; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
    .table-wrap { background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
    th { background: #1A73A7; color: white; padding: 0.7rem 1rem; text-align: left; font-weight: 600; white-space: nowrap; }
    td { padding: 0.65rem 1rem; border-bottom: 1px solid #e8ecf0; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #f7fafc; }
    .td-time { white-space: nowrap; color: #718096; font-size: 0.78rem; min-width: 175px; }
    .td-sid { white-space: nowrap; color: #a0aec0; font-size: 0.75rem; font-family: monospace; min-width: 80px; }
    .td-q { max-width: 260px; word-break: break-word; }
    .td-a { max-width: 500px; word-break: break-word; white-space: pre-wrap; color: #4a5568; }
    .empty { text-align: center; padding: 3rem; color: #a0aec0; font-size: 0.9rem; }
  </style>
</head>
<body>
<header>
  <h1>🦷 ふじもと歯科 チャットログ</h1>
  <div class="hactions">
    <a href="/admin/logs/csv" class="btn btn-csv">⬇ CSVダウンロード</a>
  </div>
</header>
<div class="container">
  <div class="meta">合計 <strong>${logs.length}</strong> 件のログ（新しい順）</div>
  <div class="table-wrap">
    ${
      logs.length === 0
        ? '<div class="empty">まだログがありません</div>'
        : `<table>
        <thead>
          <tr><th>日時（JST）</th><th>セッションID</th><th>質問</th><th>回答</th></tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`
    }
  </div>
</div>
</body>
</html>`;
}

// ── Admin routes ──────────────────────────────────────────────────────────────

app.get("/admin/logs", async (c) => {
  if (!checkBasicAuth(c.req.raw)) return unauthorizedResponse();
  const logs = await fetchAllLogs();
  if (logs === null) {
    return c.html(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<title>エラー - ふじもと歯科</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f0f4f8;}
.box{background:white;padding:2rem;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.1);max-width:480px;text-align:center;}
h1{color:#c53030;margin-bottom:1rem;}p{color:#4a5568;line-height:1.7;}</style></head>
<body><div class="box"><h1>⚠️ KV接続エラー</h1>
<p>KVデータベースに接続できません。<br>Deno Deployの設定を確認してください。</p>
<p style="margin-top:1rem;font-size:.8rem;color:#718096">
Deno Deploy ダッシュボード → プロジェクト設定 → KV を確認してください。</p>
</div></body></html>`, 500);
  }
  return c.html(logsPageHtml(logs));
});

app.get("/admin/logs/csv", async (c) => {
  if (!checkBasicAuth(c.req.raw)) return unauthorizedResponse();
  const logs = await fetchAllLogs();
  if (logs === null) return c.text("KVデータベースに接続できません", 500);
  const csv = buildCsv(logs);
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="chat-logs-${today}.csv"`,
    },
  });
});

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(treatment: string, patient: string, style: string): string {
  return `あなたはふじもと歯科（堺市）の患者説明資料を作成する専門アシスタントです。

以下の条件で患者向けの説明資料を作成してください：

【歯科医院情報】
- 医院名：ふじもと歯科
- 所在地：堺市
- 特徴：地域に根ざした、患者さんに寄り添う丁寧な診療

【治療メニュー】
${treatment}

【対象患者】
${patient}

【文章スタイル】
${style}

【作成要件】
1. 対象患者に合わせた言葉遣いと内容を心がけてください
2. 以下の項目を含めてください：
   - 治療の概要・目的
   - 治療の流れ（ステップ）
   - 治療のメリット
   - 注意事項・よくある質問
   - ふじもと歯科からのメッセージ
3. ふじもと歯科の温かみのある雰囲気と信頼感を表現してください
4. 専門用語は必ず平易な言葉で補足説明してください
5. 見出しや箇条書きを使い、読みやすい構成にしてください

患者説明資料を作成してください。`;
}

// ── Transcript proxies ───────────────────────────────────────────────────────

app.post("/api/transcript/whisper", async (c) => {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return c.json({ error: "OPENAI_API_KEY が設定されていません" }, 500);
  const formData = await c.req.formData();
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}` },
    body: formData,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    return c.json({ error: e.error?.message || `HTTP ${res.status}` }, res.status as 400 | 500);
  }
  return c.text(await res.text());
});

app.post("/api/transcript/summarize", async (c) => {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return c.json({ error: "OPENAI_API_KEY が設定されていません" }, 500);
  const body = await c.req.json();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    return c.json({ error: e.error?.message || `HTTP ${res.status}` }, res.status as 400 | 500);
  }
  return c.json(await res.json());
});

// ── Blog ─────────────────────────────────────────────────────────────────────

interface BlogSettings {
  clinicName: string;
  clinicType: "dental" | "medical";
  websites: Array<{ name: string; url: string }>;
  areas: string[];
}

interface BlogArticle {
  id: string;
  title: string;
  specialty: string;
  keywords: string[];
  status: "draft" | "published";
  phase: number;
  outline: string;
  content: string;
  metaTitle: string;
  metaDescription: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

app.get("/blog", async (c) => {
  if (!checkBasicAuth(c.req.raw, "BLOG_PASSWORD")) return unauthorizedResponse();
  try {
    const html = await Deno.readTextFile("./static/blog.html");
    return c.html(html);
  } catch {
    return c.text("blog.html not found", 404);
  }
});

app.get("/api/blog/settings", async (c) => {
  if (!kv) return c.json({ error: "KV利用不可" }, 500);
  const entry = await kv.get<BlogSettings>(["blog_settings"]);
  return c.json(entry.value ?? { clinicName: "", clinicType: "dental", websites: [], areas: [] });
});

app.put("/api/blog/settings", async (c) => {
  if (!kv) return c.json({ error: "KV利用不可" }, 500);
  const body = await c.req.json<BlogSettings>();
  await kv.set(["blog_settings"], body);
  return c.json({ ok: true });
});

app.get("/api/blog/articles", async (c) => {
  if (!kv) return c.json({ error: "KV利用不可" }, 500);
  const articles: BlogArticle[] = [];
  const iter = kv.list<BlogArticle>({ prefix: ["blog_articles"] });
  for await (const entry of iter) articles.push(entry.value);
  articles.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return c.json(articles);
});

app.post("/api/blog/articles", async (c) => {
  if (!kv) return c.json({ error: "KV利用不可" }, 500);
  const body = await c.req.json<Partial<BlogArticle>>();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const article: BlogArticle = {
    id, title: body.title ?? "", specialty: body.specialty ?? "",
    keywords: body.keywords ?? [], status: "draft", phase: 0,
    outline: "", content: "", metaTitle: "", metaDescription: "", tags: [],
    createdAt: now, updatedAt: now,
  };
  await kv.set(["blog_articles", id], article);
  return c.json(article, 201);
});

app.get("/api/blog/articles/:id", async (c) => {
  if (!kv) return c.json({ error: "KV利用不可" }, 500);
  const id = c.req.param("id");
  const entry = await kv.get<BlogArticle>(["blog_articles", id]);
  if (!entry.value) return c.json({ error: "記事が見つかりません" }, 404);
  return c.json(entry.value);
});

app.put("/api/blog/articles/:id", async (c) => {
  if (!kv) return c.json({ error: "KV利用不可" }, 500);
  const id = c.req.param("id");
  const entry = await kv.get<BlogArticle>(["blog_articles", id]);
  if (!entry.value) return c.json({ error: "記事が見つかりません" }, 404);
  const body = await c.req.json<Partial<BlogArticle>>();
  const updated: BlogArticle = { ...entry.value, ...body, id, updatedAt: new Date().toISOString() };
  await kv.set(["blog_articles", id], updated);
  return c.json(updated);
});

app.delete("/api/blog/articles/:id", async (c) => {
  if (!kv) return c.json({ error: "KV利用不可" }, 500);
  const id = c.req.param("id");
  await kv.delete(["blog_articles", id]);
  return c.json({ ok: true });
});

app.post("/api/blog/generate", async (c) => {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return c.json({ error: "OPENAI_API_KEY が設定されていません" }, 500);

  const body = await c.req.json<{ phase: 1 | 2 | 3; article: Partial<BlogArticle>; settings: BlogSettings }>();
  const { phase, article, settings } = body;

  const clinicInfo = [
    `クリニック名: ${settings.clinicName}`,
    `種別: ${settings.clinicType === "dental" ? "歯科クリニック" : "医科クリニック"}`,
    settings.areas?.length ? `対象エリア: ${settings.areas.join("・")}` : "",
    settings.websites?.length ? `サイト: ${settings.websites.map((w) => `${w.name} ${w.url}`).join(", ")}` : "",
  ].filter(Boolean).join("\n");

  let systemPrompt: string, userPrompt: string, maxTokens: number;

  if (phase === 1) {
    systemPrompt = `あなたは歯科・医科専門のSEOブログライターです。E-E-A-Tを意識した記事構成案を作成します。`;
    userPrompt = `以下の条件でSEOブログ記事の構成案をMarkdownで作成してください。\n\n【クリニック情報】\n${clinicInfo}\n\n【診療科目】${article.specialty}\n【メインキーワード】${article.keywords?.join("、")}\n\n出力形式:\n# タイトル（32〜38文字、キーワードを含む）\n\n## リード文（150字程度）\n\n## 記事構成\n### H2: 見出し\n概要: （1〜2行）\n\n（H2を4〜6個作成）`;
    maxTokens = 1200;
  } else if (phase === 2) {
    systemPrompt = `あなたは歯科・医科専門のSEOブログライターです。「${settings.clinicName}では」「当院では」などの表現を適度に使い、医療広告ガイドラインに従って執筆します。`;
    userPrompt = `以下の構成案をもとに記事本文を執筆してください。\n\n【クリニック情報】\n${clinicInfo}\n\n【構成案】\n${article.outline}\n\n要件: 2500〜3500文字、Markdown形式、読者の不安を解消し来院を自然に促す流れ`;
    maxTokens = 4096;
  } else {
    systemPrompt = `あなたはSEOの専門家です。JSONのみで返答してください。`;
    userPrompt = `以下の記事からSEOメタ情報を生成してください。\n\n【診療科目】${article.specialty}\n【キーワード】${article.keywords?.join("、")}\n\n【本文抜粋】\n${article.content?.slice(0, 3000)}\n\nJSONのみ:\n{"metaTitle":"（35〜40文字）","metaDescription":"（110〜120文字）","tags":["タグ1","タグ2","タグ3","タグ4","タグ5"]}`;
    maxTokens = 600;
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok) return c.json({ error: "OpenAI APIエラー: " + await res.text() }, 500);
    const data = await res.json();
    return c.json({ result: data.choices[0].message.content, phase });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

Deno.serve(app.fetch);
