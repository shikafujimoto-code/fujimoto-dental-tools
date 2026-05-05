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
月・火・水・木・金：9:30〜13:30 ／ 15:00〜19:00
土：9:30〜13:30 ／ 14:30〜18:00
休診日：日曜・祝日
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
