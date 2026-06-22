import { useState } from 'react';
import './App.css';
import { GeneratorPage } from './generator/GeneratorPage';
import { CurationPage } from './curation/CurationPage';

type Tab = 'generator' | 'curation';

function App() {
  const [tab, setTab] = useState<Tab>('generator');

  return (
    <div className="app">
      <header className="app-header">
        <h1>Irodori-TTS Tools</h1>
        <nav className="tabs">
          <button
            className={tab === 'generator' ? 'active' : ''}
            onClick={() => setTab('generator')}
          >
            スクリプト生成
          </button>
          <button
            className={tab === 'curation' ? 'active' : ''}
            onClick={() => setTab('curation')}
          >
            厳選
          </button>
        </nav>
      </header>

      <details className="usage" open>
        <summary>使い方</summary>
        <div className="usage-body">
          <p>
            <a href="https://github.com/Aratako/Irodori-TTS" target="_blank" rel="noreferrer">Irodori-TTS</a>
            で「ランダムなパラメータ・絵文字で大量に音声生成 → 良いものを厳選」するためのツールです。
            すべてブラウザ内で完結し、サーバには何も送信しません。
          </p>

          <h4>① スクリプト生成</h4>
          <ol>
            <li><b>テキスト</b>を入力（1行 = 1テキスト）。テキスト直下のパレットからカーソル位置に絵文字・記号を挿入できます。</li>
            <li><b>絵文字・記号</b>: トークンごとに「文頭 / 文末 / ランダム位置」の個数を <i>固定 or 範囲</i> で設定。各スロットの最大数まで、固定を優先配置→余りを範囲がランダムで埋めます。</li>
            <li><b>パラメータ</b>: seed や cfg-scale 等を「既定 / 固定 / 範囲（生成ごとにランダム）」で設定。説明は各項目に表示。</li>
            <li><b>精度</b>: GPU なら <code>bf16</code>（速い）、CPU や旧GPUなら <code>fp32</code>。</li>
            <li>出力欄でスクリプトを選んで<b>ダウンロード</b>。<b>.py が最速・推奨</b>（モデルを1回だけ読み込んでループ）。.ps1 / .bat も可。</li>
            <li>ダウンロードしたファイルを <b>Irodori-TTS リポジトリ直下（infer.py がある場所）</b>に置いて実行:
              <br /><code>uv run --no-sync python generate_tts.py</code>
              （.ps1 は <code>powershell -ExecutionPolicy Bypass -File .\generate_tts.ps1</code>、.bat はダブルクリック）
            </li>
            <li>出力は <code>出力フォルダ/&lt;実行ID&gt;/&lt;テキスト名&gt;/0001_xxx.wav</code> と同名 <code>.json</code> に整理されます。</li>
          </ol>

          <h4>② 厳選（Chrome / Edge 専用）</h4>
          <ol>
            <li>「フォルダを開く」で①の出力フォルダを選択（サブフォルダも再帰取得）。</li>
            <li>左のフォルダ一覧で絞り込み。自動再生で聴きながら <b>K=キープ / X=リジェクト</b>（Space=再生停止、↑↓=移動）。再生中はメディアキーでも操作可。</li>
            <li>キープしたものを <code>selected/</code> へ<b>コピー / 移動</b>。パラメータは表で一覧できます。</li>
          </ol>

          <p className="usage-note">
            💡 Windows の「パスのコピー」は <code>"…"</code> で囲まれますが、貼り付けても<b>前後の引用符は自動で除去</b>します。
            ref wav やチェックポイントは repo からの相対パス（例 <code>refs/voice.wav</code>）が安全です。
          </p>
        </div>
      </details>

      <main>{tab === 'generator' ? <GeneratorPage /> : <CurationPage />}</main>
    </div>
  );
}

export default App;
