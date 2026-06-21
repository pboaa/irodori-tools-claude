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
      <main>{tab === 'generator' ? <GeneratorPage /> : <CurationPage />}</main>
    </div>
  );
}

export default App;
