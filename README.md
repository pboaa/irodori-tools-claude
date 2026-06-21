# Irodori-TTS Tools

[Irodori-TTS](https://github.com/Aratako/Irodori-TTS) を使った音声生成の探索ワークフロー
（**範囲内ランダムで大量生成 → 良いものを厳選**）を支援する、ブラウザ完結の
React + TypeScript アプリです。サーバ不要・処理はすべてブラウザ内で完結します。

2 つの機能をタブで切り替えます。

## 1. スクリプト生成

設定（テキスト・パラメータ範囲・絵文字プールなど）から、`infer.py` を
範囲内ランダムパラメータで繰り返し実行しフォルダへ保存する **`.py` / `.ps1` / `.bat`**
を生成します（**`.py` 推奨**: モデルを1回だけ読み込んでループするので `.ps1`/`.bat` より大幅に高速。
`uv run --no-sync python generate_tts.py` で実行）。生成された各 `wav` の隣に、テキストとパラメータを記録した
**サイドカー JSON**（`同名.json`）を書き出します。これを「厳選」タブが読み込みます。

出力は **`出力フォルダ/<実行ID>/<テキスト名(絵文字除く)>/0001_xxx.wav`** の階層に整理されます
（実行ごとにフォルダ分割、テキスト別サブフォルダ）。「厳選」タブはこのサブフォルダ単位でグループ表示します。

- 実行プレフィックス（既定 `uv run --no-sync python infer.py`）
- チェックポイント（`--hf-checkpoint` / `--checkpoint`）
- テキスト（1 行 = 1 テキスト）、`--caption`、`--no-ref` / `--ref-wav`
- **絵文字・記号スタイル制御**: 公式 [`EMOJI_ANNOTATIONS.md`](https://huggingface.co/Aratako/Irodori-TTS-500M/blob/main/EMOJI_ANNOTATIONS.md)
  の全絵文字を効果ラベル付きで一覧表示。**トークン（絵文字／♡ ! ? など任意記号）ごとに
  エントリ**を追加し、各エントリで **文頭・文末・ランダム位置に入れる個数**を
  **固定 or 範囲（生成ごとに変動）** で設定。**同じトークンを複数エントリ**追加でき、
  例えば「👂 を文頭3・文末3（固定）」で囁き声を作りつつ「👂 をランダム位置 0〜2（範囲）」で
  揺らぎを足す、といった組み合わせが可能。採用結果は JSON に記録。
- テキストごとの生成回数 N、出力フォルダ
- ランダム化パラメータ（各々 **既定 / 固定 / 範囲** を選択）。値は gradio 風の
  **スライダー**（刻み付き・デフォルトに戻すリセット付き）で調整:
  `seed` `num-steps` `cfg-scale-text` `cfg-scale-caption` `cfg-scale-speaker`
  `duration-scale` `sway-coeff` `truncation-factor`

画面は2×2構成（左上=実行設定/テキスト、右=パラメータ、左下=絵文字、右下=出力）。
各パラメータには説明文を併記。出力ファイル数（テキスト数 × 回数）を常時表示します。
スクリプトプレビューは出力欄のアコーディオン（デフォルト折りたたみ。コピー/ダウンロードは
ヘッダから直接実行可）。ランダム生成を主目的とするため、`seed` と主要な CFG スケールは
既定で「範囲」が有効になっています。

**`.py`（推奨・最速）** は `irodori_tts.inference_runtime` の `InferenceRuntime` を使い、
モデルを**1回だけロード**して全生成をループします（`bf16` 精度）。1音声ごとに
`python infer.py` を起動し直す `.ps1`/`.bat` に比べ、起動・モデルロードのオーバーヘッドが
無くなるため数倍〜数十倍高速です。`.ps1` は CLI 版の主軸、`.bat` はそのフォールバックです
（浮動小数乱数と JSON 出力は内部で PowerShell に委譲。日本語・絵文字は環境変数経由で渡し
文字化けを回避）。生成したスクリプトは Irodori-TTS のリポジトリ直下に置いて実行してください。

### サイドカー JSON スキーマ (`irodori-tts-sidecar/v1`)

```jsonc
{
  "schema": "irodori-tts-sidecar/v1",
  "wav": "0001_12345.wav",
  "text": "こんにちは🤭", "baseText": "こんにちは", "emoji": "🤭",
  "caption": null, "model": "Aratako/Irodori-TTS-500M-v3", "checkpointKind": "hf",
  "refMode": "ref-wav", "refWav": "refs/voiceA.wav",
  "index": 1, "runId": "20260622_001500",
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
