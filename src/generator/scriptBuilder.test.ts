import { describe, it, expect } from 'vitest';
import { buildPs1, buildBat, splitLines, splitEmojis } from './scriptBuilder';
import { defaultConfig } from '../lib/defaults';
import type { GenConfig } from '../types';

function cfg(overrides: Partial<GenConfig> = {}): GenConfig {
  return { ...defaultConfig(), ...overrides };
}

describe('helpers', () => {
  it('splitLines drops blanks and trims', () => {
    expect(splitLines('a\n\n  b  \nc')).toEqual(['a', 'b', 'c']);
  });
  it('splitEmojis handles commas and newlines', () => {
    expect(splitEmojis('🤭, 😊\n😢')).toEqual(['🤭', '😊', '😢']);
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
    c.params = c.params.map((p) =>
      p.flag === 'num-steps' ? { ...p, kind: 'fixed', fixed: 32 } : p,
    );
    const s = buildPs1(c);
    expect(s).toContain('$NumSteps = 32');
    expect(s).toContain("@('--num-steps', $NumSteps)");
    // cfg-scale-text is still off -> no draw line, json null
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

  it('escapes single quotes in text literals', () => {
    const s = buildPs1(cfg({ texts: "it's me" }));
    expect(s).toContain("'it''s me'");
  });

  it('appends emoji array only when enabled', () => {
    expect(buildPs1(cfg({ appendEmoji: false }))).toContain('$Emojis = @()');
    const s = buildPs1(cfg({ appendEmoji: true, emojiPool: '🤭,😊' }));
    expect(s).toContain("$Emojis = @('🤭', '😊')");
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
