# Irodori-TTS Tools

[Irodori-TTS](https://github.com/Aratako/Irodori-TTS) を使った音声生成の探索ワークフロー
（**範囲内ランダムで大量生成 → 良いものを厳選**）を支援する、ブラウザ完結の
React + TypeScript アプリです。サーバ不要・処理はすべてブラウザ内で完結します。

2 つの機能をタブで切り替えます。

## 1. スクリプト生成

設定（テキスト・パラメータ範囲・絵文字プールなど）から、`infer.py` を
範囲内ランダムパラメータで繰り返し実行しフォルダへ保存する **`.ps1` / `.bat`**
を生成します。生成された各 `wav` の隣に、テキストとパラメータを記録した
**サイドカー JSON**（`同名.json`）を書き出します。これを「厳選」タブが読み込みます。

- 実行プレフィックス（既定 `uv run --no-sync python infer.py`）
- チェックポイント（`--hf-checkpoint` / `--checkpoint`）
- テキスト（1 行 = 1 テキスト）、`--caption`、`--no-ref` / `--ref-wav`
- **絵文字スタイル制御**: 公式 [`EMOJI_ANNOTATIONS.md`](https://huggingface.co/Aratako/Irodori-TTS-500M/blob/main/EMOJI_ANNOTATIONS.md)
  の全絵文字を効果ラベル付きで一覧表示。クリックで選択し、各生成で選択分から
  ランダムに採用。付与位置は **文頭 / 文末 / 文頭＋文末 / ランダム位置に複数（個数指定）**。
  採用された絵文字は JSON に記録。
- テキストごとの生成回数 N、出力フォルダ
- ランダム化パラメータ（各々 **既定 / 固定 / 範囲** を選択）。値は gradio 風の
  **スライダー**（刻み付き・デフォルトに戻すリセット付き）で調整:
  `seed` `num-steps` `cfg-scale-text` `cfg-scale-caption` `cfg-scale-speaker`
  `duration-scale` `sway-coeff` `truncation-factor`

`.ps1` を主軸とし、`.bat` は同等動作のフォールバックです（浮動小数乱数と
JSON 出力は内部で PowerShell に委譲。日本語・絵文字は環境変数経由で渡し
文字化けを回避）。生成したスクリプトは Irodori-TTS のリポジトリ直下に置いて実行してください。

### サイドカー JSON スキーマ (`irodori-tts-sidecar/v1`)

```jsonc
{
  "schema": "irodori-tts-sidecar/v1",
  "wav": "0001_12345.wav",
  "text": "こんにちは🤭", "baseText": "こんにちは", "emoji": "🤭",
  "caption": null, "model": "Aratako/Irodori-TTS-500M-v3", "refMode": "no-ref",
  "seed": 12345, "numSteps": 40,
  "cfgScaleText": 3.2, "cfgScaleCaption": 3.0, "cfgScaleSpeaker": 5.1,
  "durationScale": 1.0, "swayCoeff": -1.0, "truncationFactor": null,
  "createdAt": "2026-06-22T00:00:00Z", "command": "uv run ... infer.py ..."
}
```

## 2. 厳選

出力フォルダを開き、**サブフォルダを含めて再帰的に** `wav` を取得します。
サイドカー JSON があればパラメータを一覧表示します。

- 自動再生＆自動次送り、リストのテキスト/パス絞り込み
- キープ（★）/ リジェクト（✕）でマーキング
- キープした `wav` と対応する `json` を **`selected/` サブフォルダへコピー / 移動**
  （同名衝突時は `_1`, `_2` … にリネーム）
- キーボード: `Space` 再生/停止 · `↑`/`↓` 移動 · `K` キープ · `X` リジェクト · `Enter` 次

> **対応ブラウザ**: 厳選機能は [File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_API)
> を使うため **Chrome / Edge** が必要です（Firefox / Safari 非対応）。スクリプト生成は全ブラウザで動作します。

## 開発

```bash
npm install
npm run dev      # 開発サーバ (http://localhost:5173)
npm run build    # 型チェック + 本番ビルド
npm test         # scriptBuilder のユニットテスト (Vitest)
npm run lint
```

主要ファイル:

- `src/generator/scriptBuilder.ts` — `buildPs1` / `buildBat`（純粋関数・テスト対象）
- `src/generator/GeneratorPage.tsx` — 設定フォーム + プレビュー + ダウンロード
- `src/curation/useDirectoryScan.ts` — フォルダ再帰走査 + サイドカー読込
- `src/curation/fsActions.ts` — `selected/` への移動 / コピー
- `src/curation/CurationPage.tsx` — リスト + プレイヤー + 厳選操作
