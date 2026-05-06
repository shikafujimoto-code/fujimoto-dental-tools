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
アクセス：堺東駅西口から徒歩2分、駐輪スペースあり・近隣にタイムズ提携駐車場
Instagram：@fujimotoshika
ホームページ：https://shika-fujimoto.com/

＜院長＞
藤本直志（ふじもと なおゆき）
2015年ふじもと歯科開院。「痛い・怖い」イメージを払拭し「また行きたい」医院づくりを目指す。

＜診療時間＞
月・火・木・金：9:30〜13:30 ／ 15:00〜19:00
土：9:30〜13:30 ／ 14:30〜18:00
休診日：水曜・日曜・祝日
※祝日がある週の水曜は診療あり

＜診療内容＞
一般歯科、歯周病治療、予防・メンテナンス、小児歯科、小児矯正、
セラミック・審美治療、ホワイトニング、入れ歯、成人矯正（マウスピース矯正）、栄養相談

＜料金＞
詳細はホームページ（https://shika-fujimoto.com/）にてご確認ください。
保険診療・自費診療どちらにも対応しています。

＜医院の強みと特徴＞
- スタッフのコミュニケーションと親しみやすさ
- スタッフによる丁寧な説明
- 土曜診療あり（平日来られない方も安心）
- 予防・メンテナンス中心で痛みに配慮した治療
- 半個室・個室診療室でプライバシーに配慮
- クラスB滅菌器による徹底した衛生管理・感染対策
- 託児サービスあり（予約制）
- 管理栄養士による栄養相談あり
- 堺東駅西口から徒歩2分と通院しやすい

【よくある質問と回答】

Q: 初めて行くのですが何を持っていけばいいですか？
A: 初めてのご来院、ありがとうございます😊 マイナンバーカードか資格確認証等・お薬手帳をご持参ください。ご不明な点はお気軽にお電話（050-1808-5701）でご確認ください。

Q: 子供も診てもらえますか？
A: はい、小児歯科にも対応しています！お子さまのペースに合わせて、安心して診療が受けられるよう丁寧に対応しますのでご安心ください🌟

Q: 駐車場はありますか？
A: 近隣のタイムズが提携駐車場になります。お一人1枚200円の補助券をお渡ししています🚗 駐輪スペースもございますので、自転車でのご来院も大丈夫です。

Q: 痛みが怖いのですが大丈夫ですか？
A: 大丈夫ですよ😊 麻酔をしっかり行い、できるだけ痛みのない治療を心がけています。不安な気持ちはぜひお気軽にスタッフにご相談ください。一緒に進めていきましょう！

Q: 保険は使えますか？
A: はい、保険診療・自費診療どちらにも対応しています。料金の詳細はホームページ（https://shika-fujimoto.com/）またはお電話（050-1808-5701）にてご確認ください。

Q: 予約はどうすればいいですか？
A: お電話（050-1808-5701）またはホームページ（https://shika-fujimoto.com/）のWEB予約からご予約いただけます。お気軽にどうぞ😊

Q: 土日は診療していますか？
A: 土曜日は診療しております（9:30〜13:30 ／ 14:30〜18:00）。日曜・祝日は休診となります。平日なかなか来られない方も土曜にぜひどうぞ！`;

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

Deno.serve(app.fetch);
