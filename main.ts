﻿import { Hono } from "hono";
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

app.get("/instagram", async (c) => {
  try {
    const html = await Deno.readTextFile("./static/instagram.html");
    return c.html(html);
  } catch {
    return c.text("instagram.html not found", 404);
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
        max_tokens: 8000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", errText);
      return c.json({ error: "AI APIの呼び出しに失敗しました" }, 500);
    }

    const data = await response.json();
    const bodyContent = data.content[0].text;
    const result = wrapInTemplate(bodyContent, treatment);

    return c.json({ result });
  } catch (err) {
    console.error("Error:", err);
    return c.json({ error: "サーバーエラーが発生しました" }, 500);
  }
});

interface InstagramGenerateRequest {
  theme: string;
  audience?: string;
  count?: number;
  tone?: string;
  cta?: string;
  notes?: string;
}

app.post("/api/instagram/generate", async (c) => {
  try {
    const body = await c.req.json<InstagramGenerateRequest>();
    const theme = body.theme?.trim();
    const requestedCount = Number(body.count ?? 1);
    const count = Number.isFinite(requestedCount)
      ? Math.min(Math.max(requestedCount, 1), 5)
      : 1;

    if (!theme) {
      return c.json({ error: "投稿テーマを入力してください" }, 400);
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return c.json({ error: "OPENAI_API_KEY が設定されていません" }, 500);
    }

    const prompt = buildInstagramPrompt({ ...body, theme, count });

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "あなたは医療広告ガイドラインに配慮できる歯科医院のSNS担当ライターです。日本語で、指定形式だけを返してください。",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 2200,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("OpenAI Instagram API error:", errText);
      return c.json({ error: "AI APIの呼び出しに失敗しました" }, 500);
    }

    const data = await res.json();
    const result = String(data.choices?.[0]?.message?.content ?? "").trim();
    const warnings = inspectInstagramPost(result);
    return c.json({ result, warnings });
  } catch (err) {
    console.error("[instagram] Error:", err);
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
2002年朝日大学歯学部卒業後、岐阜県の歯科医院にて勤務。2015年、大阪府堺市に「ふじもと歯科」を開院。「痛い・怖い」イメージを払拭し「また行きたい」と思っていただける医院づくりを目指す。親しみやすさと丁寧な説明を大切にしている。

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
クレジットカード・PayPay・d払い：自費診療のみ利用可。
電子マネー：利用不可。
分割払い：治療内容によっては2回払いまで可。
デンタルローン：取り扱いあり（詳細はご来院時にご相談ください）。
医療費控除：対象になる場合あり（詳細はHP）。
料金詳細：ホームページ（https://shika-fujimoto.com/）にてご確認ください。

＜医院の特徴・設備＞
- スタッフのコミュニケーションと親しみやすさ、丁寧な説明
- 土曜診療あり（平日来られない方も安心）
- 予防・メンテナンス中心で痛みに配慮した治療
- 半個室・個室診療室でプライバシーに配慮
- クラスB滅菌器・DACユニバーサルによる徹底した衛生管理・感染対策
- オゾンウイルス除去機・空気清浄機設置
- 血糖値測定器あり（全身疾患への配慮）
- 託児サービスあり（予約制）
- 管理栄養士による栄養相談あり
- バリアフリーではない（エレベーター詳細は要確認）
- 院内Wi-Fiなし

＜ホワイトニング料金＞
オフィスホワイトニング（ボーテ式）：15,400円（初回のみ半額7,700円）
ホームホワイトニング：39,600円
デュアルホワイトニング（オフィス+ホーム）：料金はホームページまたはお電話でご確認ください
※ホワイトニングは自費診療です

＜セラミック・審美治療料金＞
素材：ジルコニア
セラミック詰め物（インレー）：39,800〜89,800円
セラミック被せ物（クラウン）：49,800〜120,000円
5年保証あり
※保険の被せ物と比べ、見た目が天然歯に近く耐久性が高い

＜入れ歯の種類と料金（自費）＞
金属床入れ歯：165,000円
チタン床入れ歯：257,400円
シリコン義歯：132,000円
ノンクラスプデンチャー：101,200〜127,600円
マグネット義歯（磁石式）：33,000円（磁石のみ）
ナチュラルフィット：246,400〜330,000円
※保険の入れ歯も対応しています

＜小児矯正の種類＞
インビザライン（マウスピース矯正）、プレオルソ、床矯正
成人矯正（マウスピース）も対応
矯正の開始時期・費用は診察でご確認ください

＜予防・メンテナンス＞
PMTC（プロによるクリーニング）、スケーリング（歯石除去）、シーラント（溝の虫歯予防）
定期検診は1〜3ヶ月ごとを推奨
フッ素塗布あり

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
A: 予約の方を優先してご案内しているため、事前のご予約をお勧めします。お電話（050-1808-5701）またはWEB予約（https://reservation.stransa.co.jp/eb9670d9bd448af1cd591abf8e9d63d7）をご利用ください😊

Q: 当日予約はできますか？
A: お電話（050-1808-5701）またはWEB予約（https://reservation.stransa.co.jp/eb9670d9bd448af1cd591abf8e9d63d7）からどうぞ。当日の空き状況はお電話が確実です。

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
A: 治療内容によっては2回払いまで対応可能な場合があります。またデンタルローンもご利用いただけます。詳しくはご来院時にスタッフにご相談ください。

Q: 医療費控除は使えますか？
A: 歯科治療は医療費控除の対象になる場合があります。詳細はホームページ（https://shika-fujimoto.com/）またはお電話でご確認ください。

Q: 初診料はいくらですか？
A: 料金の詳細はホームページ（https://shika-fujimoto.com/）またはお電話（050-1808-5701）にてご確認ください😊

＜治療メニュー＞

Q: ホワイトニングはいくらですか？
A: オフィスホワイトニング（ボーテ式）は15,400円で、初回のみ半額の7,700円でご体験いただけます！ホームホワイトニングは39,600円です。詳しくはホームページ（https://shika-fujimoto.com/）またはお電話（050-1808-5701）でご確認ください😊

Q: ホワイトニングの効果はどのくらい続きますか？
A: 個人差がありますので効果の期間を一概にお伝えするのが難しい状況です。詳しくはご来院時にご説明します😊

Q: ホワイトニングは痛いですか？
A: 知覚過敏が出る場合がありますが、丁寧に対応しています。不安な方はお気軽にご相談ください。

Q: マウスピース矯正とワイヤー矯正の違いは？
A: マウスピース矯正は取り外しができて目立ちにくい特徴があります。当院ではインビザライン・プレオルソ・床矯正にも対応しています。どちらが合っているかは診察でご相談ください😊

Q: インプラントは何回通院が必要ですか？
A: 個人差がありますので、診察でご確認ください。詳しくはお電話（050-1808-5701）またはご来院時にご相談ください。

Q: 歯周病治療はできますか？
A: はい、歯周病治療にも対応しています。気になる症状があればお気軽にご相談ください😊

Q: 入れ歯はどんな種類がありますか？
A: 保険の入れ歯のほか、自費では金属床（165,000円）・チタン床（257,400円）・シリコン義歯（132,000円）・ノンクラスプデンチャー（101,200〜127,600円）・マグネット義歯・ナチュラルフィット（246,400〜330,000円）など多種ご用意しています。詳しくはホームページまたはご来院時にご説明します😊

Q: セラミックと保険の被せ物の違いは？
A: セラミック（ジルコニア）は見た目が天然歯に近く耐久性に優れ5年保証付きですが自費（49,800〜120,000円）となります。保険の被せ物は費用を抑えられますが素材が異なります。詳しくは診察でご説明します。

Q: 定期検診・クリーニングはできますか？
A: はい、PMTC（プロのクリーニング）・スケーリング（歯石除去）・フッ素塗布などの予防メンテナンスに力を入れています。1〜3ヶ月ごとの定期検診をおすすめしています😊

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
A: クラスB滅菌器とDACユニバーサルを使用し徹底した衛生管理・感染対策を行っています。また、オゾンウイルス除去機・空気清浄機も設置しています。安心してご来院ください😊

Q: 管理栄養士に相談できますか？
A: はい、管理栄養士による栄養相談を行っています。口腔の健康と食事についてご相談いただけます😊

Q: バリアフリーですか？
A: バリアフリー対応ではございません。お体の不自由な方はご来院前にお電話（050-1808-5701）にてご相談ください。

Q: Wi-Fiはありますか？
A: 申し訳ありませんが、院内Wi-Fiはございません。

Q: 院長はどんな先生ですか？
A: 院長の藤本直志先生は2002年朝日大学歯学部を卒業後、岐阜で経験を積み2015年に開院されました。「痛い・怖い」イメージを払拭し「また行きたい」と思っていただける医院づくりを目指しています。親しみやすさと丁寧な説明を大切にしている先生ですよ😊

Q: WEB予約のURLを教えてください
A: WEB予約はこちらからどうぞ → https://reservation.stransa.co.jp/eb9670d9bd448af1cd591abf8e9d63d7 😊 お電話（050-1808-5701）でも承っています。

Q: クレジットカード・PayPay・d払いは使えますか？
A: 自費診療のみクレジットカード・PayPay・d払いがご利用いただけます。保険診療は現金のみとなります。デンタルローンも取り扱っています。

Q: 予防・定期検診について教えてください
A: PMTC（プロによる専門的クリーニング）・スケーリング（歯石除去）・シーラント（溝の虫歯予防）・フッ素塗布などに対応しています。健康な歯を長く保つために1〜3ヶ月ごとの定期検診をおすすめしています😊`;

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

const INSTAGRAM_BANNED_TERMS = [
  "日本一",
  "世界一",
  "最高",
  "最先端",
  "絶対",
  "必ず治る",
  "100%",
  "痛くない",
  "絶対安全",
  "副作用なし",
  "他院ではできない",
  "口コミ",
  "体験談",
  "Before",
  "After",
  "ビフォー",
  "アフター",
];

function buildInstagramPrompt(req: InstagramGenerateRequest): string {
  const requestedCount = Number(req.count ?? 1);
  const count = Number.isFinite(requestedCount)
    ? Math.min(Math.max(requestedCount, 1), 5)
    : 1;
  return `# 役割
あなたは、大阪府堺市にある「医療法人ふじもと歯科」のSNS担当ライターです。
歯科医療の知識と、医療広告ガイドラインへの深い理解を持ち、患者さんに優しく語りかける文章を書きます。

# 投稿条件
- 投稿テーマ：${req.theme}
- 作成数：${count}投稿
- 読者ターゲット：${req.audience || "30〜60代の地域住民（堺市周辺）"}
- トーン：${req.tone || "親しみやすく、丁寧で、専門家としての信頼感がある"}
- 最後の行動喚起：${req.cta || "お気軽にご相談ください"}
- 追加メモ：${req.notes || "特になし"}

# 医院情報
- 医院名：ふじもと歯科
- 所在地：大阪府堺市堺区中瓦町2-3-14 パーターさかもと銀座ビル2階
- アクセス：堺東駅西口から徒歩2分
- 電話：050-1808-5701
- Instagram：@fujimotoshika
- ホームページ：https://shika-fujimoto.com/

# 必ず守るルール（医療広告ガイドライン対応）
以下の表現は絶対に使わないでください：
- 「日本一」「世界一」「最高」「最先端」「絶対」「必ず治る」「100%」など最上級・断定的表現
- 「痛くない」「絶対安全」「副作用なし」など効果やリスクの断定
- 患者さんの体験談・口コミ・Before/After的な描写
- 他院との比較（「他院ではできない」など）
- 公的医療保険外の自由診療を推奨する際の、効果の断定的表現
- 芸能人・有名人の利用に関する記述

# 書き方の原則
- 1投稿は日本語で250〜400文字を目安にする
- 冒頭1行で読者の関心を引く（質問形・気づき・季節の話題など）
- 専門用語を使うときは必ず一般用語で言い換える
  例：SPTではなく「歯周病が落ち着いた後の定期的なメンテナンス」
- 数字や根拠を入れて説得力を高める。ただし誇張しない
- 最後に行動を促す一文を入れる
- 絵文字は1投稿につき3〜5個まで。多用しない
- 自由診療に触れる場合は、効果には個人差があること、診査・相談が必要なことを自然に補足する
- 不安をあおる表現ではなく、早めの相談・確認を促す表現にする

# ハッシュタグのルール
- 合計15〜20個
- 内訳：地域系（堺市・大阪）5個、歯科一般5個、テーマ固有5〜10個
- #ふじもと歯科 を必ず含める

# 出力形式
${count > 1 ? "各投稿の前に『--- 投稿1 ---』のような区切りを入れてください。" : ""}
【投稿本文】
（ここに本文）

【ハッシュタグ】
（ここにハッシュタグをスペース区切りで）

【画像案】
（このテーマに合うCanvaテンプレート案を1〜2行で）

【投稿に関する注意点】
（医療広告ガイドライン上、特に確認してほしい点があれば）`;
}

function inspectInstagramPost(result: string): string[] {
  const warnings: string[] = [];
  const foundTerms = INSTAGRAM_BANNED_TERMS.filter((term) =>
    result.includes(term)
  );
  if (foundTerms.length) {
    warnings.push(`使用注意表現の可能性: ${foundTerms.join("、")}`);
  }

  const hashtagCount = (result.match(/#[^\s#]+/g) ?? []).length;
  if (hashtagCount > 0 && (hashtagCount < 15 || hashtagCount > 100)) {
    warnings.push(
      `ハッシュタグ数が目安外の可能性があります（検出: ${hashtagCount}個）`,
    );
  }
  if (!result.includes("#ふじもと歯科")) {
    warnings.push("#ふじもと歯科 が含まれていません");
  }
  return warnings;
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(treatment: string, patient: string, style: string): string {
  return `あなたはふじもと歯科（堺市）の患者説明資料を作成する専門アシスタントです。

以下の条件で患者説明資料の「本文コンテンツ」をHTMLで作成してください。

【歯科医院情報】
- 医院名：ふじもと歯科
- 所在地：〒590-0077 大阪府堺市堺区中瓦町2-3-14 パーターさかもと銀座ビル2階
- 電話：050-1808-5701
- 診療時間：月火木金 9:30〜13:30／15:00〜19:00　土 9:30〜13:30／14:30〜18:00　休診：水・日・祝
- HP：https://shika-fujimoto.com/
- 院長：藤本直志

【治療メニュー】${treatment}
【対象患者】${patient}
【文章スタイル】${style}

【出力するHTMLの構成（この順番で）】
以下のdivブロックをすべて出力してください。CSSクラスは既に定義済みのものを使用：

1. <div class="sec blue">  ← 治療の概要（絵文字＋説明文）
2. <div class="sec">チェックリスト  ← 治療の流れ（<div class="check">□ ステップ</div> 形式で4〜6項目）
3. <div class="sec green">  ← 治療のメリット（✅絵文字付きリスト）
4. <div class="sec pink">  ← 注意事項（⚠️付き箇条書き）
5. <div class="bubble">  ← 吹き出しポイント（💡よくある質問と答え）
6. <div class="sec yellow">  ← ふじもと歯科からのメッセージ（😊温かいメッセージ）

【重要ルール】
- CSSは一切書かないこと（すでにテンプレートに含まれている）
- HTMLタグとテキストのみを出力すること
- マークダウン（\`\`\`）は使わないこと
- 上記6つのdivブロックをすべて含めること
- 印刷時にA4用紙1枚（297mm）に収まるよう内容をコンパクトにまとめること
- 各セクションは3〜4行以内、チェックリストは最大4項目、メリット・注意事項は各3項目以内
- 一文は50文字以内を目安に簡潔に記述すること

対象患者に合わせた言葉遣いで、絵文字を積極的に使い、読みやすく温かみのある内容にしてください。`;
}

function wrapInTemplate(bodyContent: string, treatment: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${treatment} | ふじもと歯科</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Noto Sans JP', sans-serif; background: #f0f4f8; color: #333; font-size: 14px; line-height: 1.8; }
.page { width: 210mm; min-height: 297mm; margin: 20px auto; background: #fff; box-shadow: 0 4px 30px rgba(0,0,0,0.15); overflow: hidden; }
.header { background: linear-gradient(135deg, #1D9E75 0%, #0f5e45 100%); padding: 28px 30px; color: #fff; }
.header h1 { font-size: 26px; font-weight: 900; letter-spacing: 2px; margin-bottom: 6px; }
.header .subtitle { font-size: 13px; opacity: 0.85; }
.header .clinic { text-align: right; margin-top: 12px; font-size: 18px; font-weight: 700; letter-spacing: 2px; }
.accent { height: 6px; background: linear-gradient(90deg, #1D9E75, #45c49a, #f9d342, #f78e3d, #e85d8a); }
.content { padding: 20px 28px; }
.sec { border-radius: 12px; padding: 16px 20px; margin-bottom: 16px; }
.sec h2 { font-size: 16px; font-weight: 700; color: #1D9E75; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
.sec p, .sec li { font-size: 13px; color: #444; line-height: 1.8; }
.sec ul { padding-left: 20px; }
.blue { background: #E8F4FD; border-left: 4px solid #5BA3D9; }
.blue h2 { color: #2A72A8; }
.green { background: #E8F6F1; border-left: 4px solid #1D9E75; }
.pink { background: #FDE8F0; border-left: 4px solid #e85d8a; }
.pink h2 { color: #c44070; }
.yellow { background: #FDF8E8; border-left: 4px solid #e8c84a; }
.yellow h2 { color: #8a6d00; }
.check { display: flex; align-items: flex-start; gap: 10px; padding: 8px 0; border-bottom: 1px dashed #ccc; font-size: 13px; color: #444; }
.check:last-child { border-bottom: none; }
.cb { width: 18px; height: 18px; border: 2px solid #1D9E75; border-radius: 3px; flex-shrink: 0; margin-top: 2px; background: #fff; }
.bubble { background: #FDF8E8; border: 2px solid #e8c84a; border-radius: 14px; padding: 16px 20px; margin-bottom: 16px; position: relative; }
.bubble::before { content: '💡'; font-size: 22px; position: absolute; top: -14px; left: 18px; background: #fff; padding: 0 6px; }
.bubble h2 { font-size: 15px; font-weight: 700; color: #8a6d00; margin-bottom: 10px; }
.bubble p { font-size: 13px; color: #555; line-height: 1.8; }
.footer { background: #2D3748; color: #CBD5E0; padding: 18px 28px; font-size: 11px; line-height: 2; }
.footer strong { color: #fff; font-size: 14px; display: block; margin-bottom: 4px; }
@media print {
  @page { size: A4; margin: 0; }
  body { background: #fff; }
  .page { margin: 0; box-shadow: none; width: 100%; }
}
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div>
        <div style="font-size:11px;opacity:0.7;letter-spacing:1px;margin-bottom:6px;">患者説明資料</div>
        <h1>🦷 ${treatment}</h1>
        <div class="subtitle">ふじもと歯科より</div>
      </div>
      <div class="clinic">ふじもと歯科</div>
    </div>
  </div>
  <div class="accent"></div>
  <div class="content">
    ${bodyContent}
  </div>
  <div class="footer">
    <strong>ふじもと歯科</strong>
    〒590-0077 大阪府堺市堺区中瓦町2-3-14 パーターさかもと銀座ビル2階　TEL: 050-1808-5701<br>
    診療時間：月火木金 9:30〜13:30／15:00〜19:00　土 9:30〜13:30／14:30〜18:00　休診：水・日・祝<br>
    HP: https://shika-fujimoto.com/　院長：藤本直志
  </div>
</div>
</body>
</html>`;
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

