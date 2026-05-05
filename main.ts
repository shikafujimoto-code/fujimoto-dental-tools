import { Hono } from "hono";
import { cors } from "hono/cors";

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
