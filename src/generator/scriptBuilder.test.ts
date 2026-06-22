import { describe, it, expect } from 'vitest';
import { buildPs1, buildBat, buildPy, splitLines, textFolderName, stripEmoji, stripQuotes } from './scriptBuilder';
import { defaultConfig, makeEntry } from '../lib/defaults';
import type { EmojiEntry, GenConfig } from '../types';

function cfg(overrides: Partial<GenConfig> = {}): GenConfig {
  return { ...defaultConfig(), ...overrides };
}

function entry(token: string, p: Partial<EmojiEntry> = {}): EmojiEntry {
  return makeEntry(token, p);
}

describe('helpers', () => {
  it('splitLines drops blanks and trims', () => {
    expect(splitLines('a\n\n  b  \nc')).toEqual(['a', 'b', 'c']);
  });
  it('stripEmoji removes emojis but keeps text', () => {
    expect(stripEmoji('こんにちは🤭！')).toBe('こんにちは！');
  });
  it('stripQuotes removes a surrounding quote pair (Windows Copy as path)', () => {
    expect(stripQuotes('"C:\\a\\ref.wav"')).toBe('C:\\a\\ref.wav');
    expect(stripQuotes('refs/voice.wav')).toBe('refs/voice.wav');
    expect(stripQuotes('  "x"  ')).toBe('x');
  });
  it('build output strips quotes from pasted paths', () => {
    expect(buildPy(cfg({ refMode: 'ref-wav', refWav: '"C:\\a\\ref.wav"' }))).toContain('REF_WAV = "C:\\\\a\\\\ref.wav"');
    expect(buildPs1(cfg({ outputDir: '"out/run"' }))).toContain("$OutDir = 'out/run'");
  });
  it('textFolderName sanitizes and removes emojis', () => {
    expect(textFolderName('こんにちは🤭、私はAIです。', 'x')).toBe('こんにちは、私はAIです。');
    expect(textFolderName('a/b:c*?', 'x')).toBe('abc');
    expect(textFolderName('   ', 'fallback')).toBe('fallback');
  });
});

describe('output folders', () => {
  it('PS nests run id then per-text folders', () => {
    const s = buildPs1(cfg({ texts: 'やあ\nどうも' }));
    expect(s).toContain('$RunId = (Get-Date).ToString("yyyyMMdd_HHmmss")');
    expect(s).toContain('$RunDir = Join-Path $OutDir $RunId');
    expect(s).toContain('$TextFolders = @(');
    expect(s).toContain("'やあ'");
    expect(s).toContain('$TextDir = Join-Path $RunDir $TextFolders[$ti]');
    expect(s).toContain('$Wav = Join-Path $TextDir "$Name.wav"');
  });
  it('de-duplicates folders that collapse to the same name', () => {
    // both lines strip to "ねえ" -> second becomes ねえ_2
    const s = buildPs1(cfg({ texts: 'ねえ🤭\nねえ😊' }));
    expect(s).toContain("'ねえ'");
    expect(s).toContain("'ねえ_2'");
  });
  it('bat builds run/text dirs', () => {
    const s = buildBat(cfg({ texts: 'やあ' }));
    expect(s).toContain('set "RUNDIR=%OUTDIR%\\%RUNID%"');
    expect(s).toContain('set "TEXTDIR=%RUNDIR%\\!TEXTFOLDER[%%T]!"');
    expect(s).toContain('set "WAV=!TEXTDIR!\\!NAME!.wav"');
  });
});

describe('buildPs1', () => {
  it('includes utf-8 setup and output dir creation', () => {
    const s = buildPs1(cfg());
    expect(s).toContain('chcp 65001');
    expect(s).toContain('New-Item -ItemType Directory -Force -Path $OutDir');
    expect(s).toContain("$OutDir = 'outputs/run'");
  });

  it('omits flags for "off" params and passes fixed values', () => {
    const c = cfg();
    c.params = c.params.map((p) => {
      if (p.flag === 'num-steps') return { ...p, kind: 'fixed', fixed: 32 };
      if (p.flag === 'cfg-scale-text') return { ...p, kind: 'off' };
      return p;
    });
    const s = buildPs1(c);
    expect(s).toContain('$NumSteps = 32');
    expect(s).toContain("@('--num-steps', $NumSteps)");
    // cfg-scale-text is off -> no draw line, json null
    expect(s).not.toContain('$CfgText =');
    expect(s).toContain('cfgScaleText = $null');
  });

  it('emits Get-Random range for int and rounded expr for float', () => {
    const c = cfg();
    c.params = c.params.map((p) => {
      if (p.flag === 'seed') return { ...p, kind: 'range', min: 0, max: 100 };
      if (p.flag === 'cfg-scale-text') return { ...p, kind: 'range', min: 2, max: 4, decimals: 2 };
      return p;
    });
    const s = buildPs1(c);
    // int max is exclusive -> +1
    expect(s).toContain('$Seed = Get-Random -Minimum 0 -Maximum 101');
    expect(s).toContain('$CfgText = [math]::Round((2.00 + (Get-Random -Maximum 10001)/10000 * (4.00 - 2.00)), 2)');
    expect(s).toContain('$CfgTextStr = $CfgText.ToString($inv)');
    // float passed as invariant string
    expect(s).toContain("@('--cfg-scale-text', $CfgTextStr)");
    // seed present -> filename includes seed
    expect(s).toContain('"{0:D4}_{1}" -f $Index, $Seed');
  });

  it('writes a sidecar JSON via ConvertTo-Json', () => {
    const s = buildPs1(cfg());
    expect(s).toContain("schema = \"irodori-tts-sidecar/v1\"");
    expect(s).toContain('$Meta | ConvertTo-Json');
    expect(s).toContain('-Encoding UTF8');
  });

  it('uses --no-ref or --ref-wav per refMode', () => {
    expect(buildPs1(cfg({ refMode: 'no-ref' }))).toContain('"--no-ref"');
    const r = buildPs1(cfg({ refMode: 'ref-wav', refWav: 'C:/a/ref.wav' }));
    expect(r).toContain('"--ref-wav", $RefWav');
    expect(r).toContain("$RefWav = 'C:/a/ref.wav'");
  });

  it('records refWav, index, runId and checkpointKind in the sidecar', () => {
    const r = buildPs1(cfg({ refMode: 'ref-wav', refWav: 'C:/a/ref.wav', checkpointKind: 'local' }));
    expect(r).toContain('$RunId = (Get-Date).ToString("yyyyMMdd_HHmmss")');
    expect(r).toContain('refWav = $RefWav');
    expect(r).toContain('index = $Index');
    expect(r).toContain('runId = $RunId');
    expect(r).toContain("checkpointKind = 'local'");
    // no-ref => refWav null
    expect(buildPs1(cfg({ refMode: 'no-ref' }))).toContain('refWav = $null');
  });

  it('escapes single quotes in text literals', () => {
    const s = buildPs1(cfg({ texts: "it's me" }));
    expect(s).toContain("'it''s me'");
  });

  it('omits emoji setup when no entries', () => {
    const s = buildPs1(cfg({ emojiEntries: [] }));
    expect(s).not.toContain('$Entries = @(');
    expect(s).toContain('    $Emoji = ""');
    expect(s).toContain('    $Text = $BaseText');
  });

  it('emits per-slot caps and a fixed entry (whisper 👂 head3/tail3)', () => {
    const s = buildPs1(
      cfg({
        emojiEntries: [entry('👂', { mode: 'fixed', headMin: 3, headMax: 3, tailMin: 3, tailMax: 3 })],
        emojiMaxHead: 5,
        emojiMaxTail: 8,
        emojiMaxRand: 3,
      }),
    );
    expect(s).toContain('$MaxHead = 5; $MaxTail = 8; $MaxRand = 3');
    expect(s).toContain("Token = '👂'; Mode = 'fixed'; HLo = 3; HHi = 3; TLo = 3; THi = 3");
    expect(s).toContain('function Fill-Slot($slot, $cap)');
    expect(s).toContain('$Text = $Head + $BaseText + $Tail');
  });

  it('emits a range entry preserving min/max (random 0-2)', () => {
    const s = buildPs1(
      cfg({ emojiEntries: [entry('👂', { mode: 'range', tailMin: 0, tailMax: 2, randMin: 0, randMax: 2 })] }),
    );
    expect(s).toContain("Mode = 'range'; HLo = 0; HHi = 0; TLo = 0; THi = 2; RLo = 0; RHi = 2");
  });

  it('supports multiple entries of the same token and custom symbols', () => {
    const s = buildPs1(
      cfg({
        emojiEntries: [
          entry('👂', { mode: 'fixed', headMin: 2, headMax: 2, tailMin: 2, tailMax: 2 }),
          entry('👂', { mode: 'range', randMin: 0, randMax: 2 }),
          entry('♡', { mode: 'fixed', tailMin: 1, tailMax: 1 }),
        ],
      }),
    );
    expect(s.match(/Token = '👂'/g)).toHaveLength(2);
    expect(s).toContain("Token = '♡'");
  });
});

describe('buildPy', () => {
  it('loads the runtime once and loops generations', () => {
    const s = buildPy(cfg({ texts: 'やあ\nどうも' }));
    expect(s).toContain('from irodori_tts.inference_runtime import');
    expect(s).toContain('runtime = InferenceRuntime.from_key(RuntimeKey(');
    expect(s).toContain('for ti, base in enumerate(TEXTS):');
    expect(s).toContain('result = runtime.synthesize(SamplingRequest(');
    expect(s).toContain('save_wav(str(text_dir / f"{name}.wav")');
    // runtime construction must be outside the loops (loaded once)
    expect(s.indexOf('InferenceRuntime.from_key')).toBeLessThan(s.indexOf('for ti, base'));
    expect(s).toContain('model_precision="bf16"');
  });

  it('honors the precision option', () => {
    expect(buildPy(cfg({ precision: 'bf16' }))).toContain('model_precision="bf16"');
    const fp = buildPy(cfg({ precision: 'fp32' }));
    expect(fp).toContain('model_precision="fp32"');
    expect(fp).toContain('codec_precision="fp32"');
    expect(buildPs1(cfg({ precision: 'fp32' }))).toContain('"--model-precision", \'fp32\'');
    expect(buildBat(cfg({ precision: 'fp32' }))).toContain('--model-precision fp32 --codec-precision fp32');
  });

  it('resolves hf vs local checkpoint', () => {
    expect(buildPy(cfg({ checkpointKind: 'hf' }))).toContain('hf_hub_download(repo_id=MODEL, filename="model.safetensors")');
    expect(buildPy(cfg({ checkpointKind: 'local' }))).toContain('MODEL if CHECKPOINT_KIND == "local"');
  });

  it('embeds emoji entries (with mode), caps and params as Python literals', () => {
    const s = buildPy(
      cfg({
        emojiEntries: [entry('👂', { mode: 'fixed', headMin: 3, headMax: 3 })],
        emojiMaxHead: 5,
        emojiMaxTail: 8,
        emojiMaxRand: 3,
      }),
    );
    expect(s).toContain('ENTRIES = [["👂","fixed",3,3,1,1,0,0]]');
    expect(s).toContain('MAX_HEAD = 5; MAX_TAIL = 8; MAX_RAND = 3');
    expect(s).toContain('def fill(s, cap):');
    expect(s).toContain('PARAMS = {');
  });
});

describe('buildBat', () => {
  it('sets up codepage, dir, and text array', () => {
    const s = buildBat(cfg({ texts: 'foo\nbar' }));
    expect(s).toContain('chcp 65001');
    expect(s).toContain('if not exist "%OUTDIR%" mkdir "%OUTDIR%"');
    expect(s).toContain('set "TEXT[0]=foo"');
    expect(s).toContain('set "TEXT[1]=bar"');
    expect(s).toContain('set /a TEXTCOUNT=2');
  });

  it('uses %RANDOM% for int params and powershell for float params', () => {
    const c = cfg();
    c.params = c.params.map((p) => {
      if (p.flag === 'num-steps') return { ...p, kind: 'range', min: 20, max: 40 };
      if (p.flag === 'cfg-scale-text') return { ...p, kind: 'range', min: 2, max: 4, decimals: 2 };
      return p;
    });
    const s = buildBat(c);
    expect(s).toContain('set /a NumSteps=!RANDOM! %% 21 + 20');
    expect(s).toContain('powershell -NoProfile -Command "[math]::Round((2.00');
  });

  it('combines RANDOM draws for wide ranges like seed', () => {
    const c = cfg();
    c.params = c.params.map((p) =>
      p.flag === 'seed' ? { ...p, kind: 'range', min: 0, max: 2147483647 } : p,
    );
    const s = buildBat(c);
    expect(s).toContain('!RANDOM!*32768+!RANDOM!');
  });

  it('delegates emoji composition to powershell when entries exist', () => {
    const s = buildBat(cfg({ emojiEntries: [entry('👂', { headMin: 3, headMax: 3 })] }));
    expect(s).toContain('tokens=1,2 delims=|');
    expect(s).toContain('Token=');
    expect(s).toContain('function fs($s,$cap)');
    const off = buildBat(cfg({ emojiEntries: [] }));
    expect(off).not.toContain('delims=|');
  });

  it('writes JSON via powershell reading env vars', () => {
    const c = cfg();
    c.params = c.params.map((p) =>
      p.flag === 'seed' ? { ...p, kind: 'range' } : p,
    );
    const s = buildBat(c);
    expect(s).toContain('set "TTS_SEED=!Seed!"');
    expect(s).toContain('$m.seed=[int]$env:TTS_SEED');
    expect(s).toContain('ConvertTo-Json');
  });
});
