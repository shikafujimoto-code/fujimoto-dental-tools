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

const CHAT_SYSTEM_PROMPT = `あなたはふじもと歯科（堺市）のAIアシスタントです。
患者さんのご質問に丁寧・簡潔にお答えください。

【診療時間】
月曜〜土曜：9:00〜18:00
休診日：日曜・祝日

【治療メニューと料金目安】
- ホワイトニング（オフィス）：22,000円〜
- マウスピース矯正：330,000円〜
- インプラント：330,000円〜
- 予防クリーニング：3,300円〜
- 定期検診：保険適用

【連絡先】
電話：050-1808-5701

【回答ルール】
1. 予約・詳細な相談は「お電話（050-1808-5701）またはお問い合わせフォーム」へ必ず誘導してください
2. 治療効果・結果の保証は絶対にしないでください
3. 医療広告ガイドラインに配慮し、断定的・誇大な表現は避けてください
4. 料金は目安であり、診察後に変わる場合がある旨を必ず伝えてください
5. 回答は3〜5文程度に簡潔にまとめてください
6. 温かみのある丁寧な言葉遣いを心がけてください
7. 具体的な診断・治療方針の判断は「ぜひ診察にお越しください」と案内してください`;

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
