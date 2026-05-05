import { Hono } from "hono";
import { cors } from "jsr:@hono/hono/cors";

const app = new Hono();

app.use("*", cors());

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

const CHAT_SYSTEM_PROMPT = `あなたはふじもと歯科のホームページ（https://shika-fujimoto.com/）に掲載された情報だけをもとに回答するAIアシスタントです。

【絶対ルール】
- 以下の「掲載情報」にある内容のみを使って回答してください
- 掲載情報にない質問・料金の詳細には「詳しくはホームページ（https://shika-fujimoto.com/）またはお電話（050-1808-5701）にてご確認ください」と案内してください
- 自身の一般的な医療・歯科知識で補足・推測しないでください
- 治療効果・結果の保証は絶対にしないでください
- 医療広告ガイドラインに配慮し、断定的・誇大な表現は避けてください
- 回答は3〜5文程度に簡潔にまとめてください
- 温かみのある丁寧な言葉遣いを心がけてください

【掲載情報】

＜医院情報＞
医院名：ふじもと歯科
住所：〒590-0077 大阪府堺市堺区中瓦町2-3-14 パーターさかもと銀座ビル2階
電話：050-1808-5701
アクセス：堺東駅西口から徒歩2分、駐輪スペース・提携駐車場あり
Instagram：@fujimotoshika

＜診療時間＞
月・火・木・金・水：9:30〜13:30 / 15:00〜19:00
土：9:30〜13:30 / 14:30〜18:00
休診日：日曜・祝日
※祝日がある週の水曜は診療あり、土曜診療あり

＜診療内容＞
一般歯科、歯周病治療、予防・メンテナンス、小児歯科、小児矯正、
セラミック・審美治療、ホワイトニング、入れ歯、成人矯正（マウスピース矯正）、栄養相談

＜料金＞
料金はホームページ（https://shika-fujimoto.com/）にてご確認ください。
定期検診・保険診療は保険適用あり。

＜医院の特徴＞
- 幅広い診療に対応する総合歯科医院
- 予防・メンテナンス中心で痛みに配慮した治療
- 半個室・個室診療室でプライバシーに配慮
- クラスB滅菌器による徹底した衛生管理・感染対策
- 託児サービスあり（予約制）
- 管理栄養士による栄養相談あり
- 堺東駅から近く、土曜診療で通院しやすい

＜院長＞
藤本直志（ふじもと なおゆき）
2015年ふじもと歯科開院。「痛い・怖い」イメージを払拭し「また行きたい」医院づくりを目指す。

＜予約・問い合わせ＞
電話：050-1808-5701
WEB予約：ホームページ（https://shika-fujimoto.com/）から予約可能`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  message: string;
  history?: ChatMessage[];
}

app.post("/api/chat", async (c) => {
  try {
    const body = await c.req.json<ChatRequest>();
    const { message, history = [] } = body;

    if (!message?.trim()) {
      return c.json({ error: "メッセージが空です" }, 400);
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return c.json({ error: "APIキーが設定されていません" }, 500);
    }

    const messages: ChatMessage[] = [
      ...history.slice(-8),
      { role: "user", content: message.trim() },
    ];

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

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", errText);
      return c.json({ error: "AIの応答に失敗しました" }, 500);
    }

    const data = await response.json();
    const reply = data.content[0].text;

    return c.json({ reply });
  } catch (err) {
    console.error("Chat error:", err);
    return c.json({ error: "エラーが発生しました" }, 500);
  }
});

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
