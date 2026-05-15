# fujimoto-dental-tools

ふじもと歯科向けの院内・広報支援ツール集です。

## ツール

- `/` - 患者説明資料ジェネレーター
- `/instagram` - Instagram投稿作成アプリ
- `/blog` - SEOブログ作成アプリ（Basic認証）
- `/transcript` - 文字起こし・要約ツール（Basic認証）

## Instagram投稿作成アプリ

堺市周辺の患者さんに向けたInstagramキャプションを、医療広告ガイドラインに配慮したプロンプトで生成します。
投稿テーマ、読者ターゲット、トーン、CTA、追加メモを入力すると、以下の形式で投稿案を作成します。

- 投稿本文
- ハッシュタグ（#ふじもと歯科 を含む15〜20個目安）
- Canva向け画像案
- 投稿に関する注意点

生成には `OPENAI_API_KEY` が必要です。

## 開発

```bash
deno task dev
```

## 本番起動

```bash
deno task start
```
