import type { GenConfig, ParamRange } from '../types';

/** Split a textarea into trimmed non-empty lines. */
export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Active (non-"off") params only. */
function activeParams(config: GenConfig): ParamRange[] {
  return config.params.filter((p) => p.kind !== 'off');
}

/**
 * Strip a single pair of surrounding quotes. Windows Explorer's "Copy as path"
 * wraps paths in double quotes; without this the script would quote them again
 * and infer.py would get a non-existent path.
 */
export function stripQuotes(s: string): string {
  const t = s.trim();
  if (t.length >= 2) {
    const a = t[0];
    const b = t[t.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return t.slice(1, -1);
  }
  return t;
}

/** Remove emoji / pictograph / decorative-symbol characters. */
export function stripEmoji(s: string): string {
  return (
    s
      .replace(
        /[\u{1F000}-\u{1FAFF}\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}]/gu,
        '',
      )
      // Variation selector + ZWJ left behind by removed emojis.
      .replace(/\uFE0F|\u200D/g, '')
  );
}

/** Make a filesystem-safe folder name from a text line (emojis removed). */
export function textFolderName(text: string, fallback: string): string {
  let f = stripEmoji(text);
  f = f.replace(/[\\/:*?"<>|]/g, ''); // Windows-invalid chars
  // eslint-disable-next-line no-control-regex
  f = f.replace(/[\u0000-\u001f]/g, ''); // control chars
  f = f.replace(/\s+/g, '_'); // whitespace -> underscore
  f = f.replace(/^[_.\s]+|[_.\s]+$/g, ''); // no leading/trailing
  f = f.slice(0, 40).replace(/[_.\s]+$/g, '');
  return f || fallback;
}

/** Folder name per text line, de-duplicated with numeric suffixes. */
function computeTextFolders(texts: string[]): string[] {
  const seen = new Map<string, number>();
  return texts.map((t, i) => {
    const name = textFolderName(t, `text${i + 1}`);
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    return n === 0 ? name : `${name}_${n + 1}`;
  });
}

/** Whether any emoji injection is configured. */
function emojiEnabled(config: GenConfig): boolean {
  return config.emojiEntries.length > 0;
}

interface EntryTuple {
  token: string;
  mode: 'fixed' | 'range';
  h: [number, number];
  t: [number, number];
  r: [number, number];
}

/** Normalize entries to [lo,hi] per slot (fixed collapses to [v,v]). */
function entryTuples(config: GenConfig): EntryTuple[] {
  return config.emojiEntries.map((e) => {
    const norm = (mn: number, mx: number): [number, number] => {
      const a = Math.max(0, Math.floor(mn));
      const b = Math.max(0, Math.floor(mx));
      return e.mode === 'fixed' ? [a, a] : [Math.min(a, b), Math.max(a, b)];
    };
    return {
      token: e.token,
      mode: e.mode,
      h: norm(e.headMin, e.headMax),
      t: norm(e.tailMin, e.tailMax),
      r: norm(e.randMin, e.randMax),
    };
  });
}

const caps = (config: GenConfig) => ({
  head: Math.max(0, Math.floor(config.emojiMaxHead)),
  tail: Math.max(0, Math.floor(config.emojiMaxTail)),
  rand: Math.max(0, Math.floor(config.emojiMaxRand)),
});

/** Per-flag PowerShell variable name and sidecar JSON key. */
const FLAG_INFO: Record<string, { psVar: string; jsonKey: string; env: string }> = {
  seed: { psVar: 'Seed', jsonKey: 'seed', env: 'TTS_SEED' },
  'num-steps': { psVar: 'NumSteps', jsonKey: 'numSteps', env: 'TTS_NUMSTEPS' },
  'cfg-scale-text': { psVar: 'CfgText', jsonKey: 'cfgScaleText', env: 'TTS_CFGTEXT' },
  'cfg-scale-caption': { psVar: 'CfgCaption', jsonKey: 'cfgScaleCaption', env: 'TTS_CFGCAPTION' },
  'cfg-scale-speaker': { psVar: 'CfgSpeaker', jsonKey: 'cfgScaleSpeaker', env: 'TTS_CFGSPEAKER' },
  'duration-scale': { psVar: 'DurScale', jsonKey: 'durationScale', env: 'TTS_DURSCALE' },
  'sway-coeff': { psVar: 'SwayCoeff', jsonKey: 'swayCoeff', env: 'TTS_SWAYCOEFF' },
  'truncation-factor': { psVar: 'TruncFactor', jsonKey: 'truncationFactor', env: 'TTS_TRUNCFACTOR' },
};

const ALL_JSON_PARAM_KEYS = Object.values(FLAG_INFO).map((i) => i.jsonKey);

// ---------------------------------------------------------------------------
// PowerShell
// ---------------------------------------------------------------------------

/** Escape a string for a PowerShell single-quoted literal. */
function psLit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** Format a number for embedding as a PowerShell numeric literal (invariant). */
function numLit(p: ParamRange, value: number): string {
  if (p.type === 'int') return String(Math.round(value));
  return value.toFixed(p.decimals);
}

/** PowerShell lines defining $Entries, caps + the Fill-Slot helper (emitted once). */
function psEntriesSetup(config: GenConfig): string[] {
  if (!emojiEnabled(config)) return [];
  const c = caps(config);
  const L: string[] = [];
  L.push(`$MaxHead = ${c.head}; $MaxTail = ${c.tail}; $MaxRand = ${c.rand}`);
  L.push('$Entries = @(');
  L.push(
    entryTuples(config)
      .map(
        (e) =>
          `  [pscustomobject]@{ Token = ${psLit(e.token)}; Mode = ${psLit(e.mode)}; HLo = ${e.h[0]}; HHi = ${e.h[1]}; TLo = ${e.t[0]}; THi = ${e.t[1]}; RLo = ${e.r[0]}; RHi = ${e.r[1]} }`,
      )
      .join(',\n'),
  );
  L.push(')');
  // Allocate up to $cap tokens for a slot: fixed entries first, then range fills the rest.
  L.push('function Get-LoHi($e, $slot) {');
  L.push('  if ($slot -eq "H") { return @($e.HLo, $e.HHi) }');
  L.push('  if ($slot -eq "T") { return @($e.TLo, $e.THi) }');
  L.push('  return @($e.RLo, $e.RHi)');
  L.push('}');
  L.push('function Fill-Slot($slot, $cap) {');
  L.push('  $used = 0; $out = @()');
  L.push('  foreach ($e in $Entries) {');
  L.push('    if ($e.Mode -ne "fixed") { continue }');
  L.push('    $lh = Get-LoHi $e $slot');
  L.push('    $take = [math]::Min([int]$lh[0], $cap - $used)');
  L.push('    for ($k = 0; $k -lt $take; $k++) { $out += $e.Token }');
  L.push('    if ($take -gt 0) { $used += $take }');
  L.push('    if ($used -ge $cap) { return ,$out }');
  L.push('  }');
  L.push('  foreach ($e in $Entries) {');
  L.push('    if ($e.Mode -ne "range") { continue }');
  L.push('    if ($used -ge $cap) { break }');
  L.push('    $rem = $cap - $used');
  L.push('    $lh = Get-LoHi $e $slot');
  L.push('    $lo = [math]::Min([int]$lh[0], $rem)');
  L.push('    $hi = [math]::Min([int]$lh[1], $rem)');
  L.push('    if ($lo -lt 0) { $lo = 0 }');
  L.push('    $take = Get-Random -Minimum $lo -Maximum ($hi + 1)');
  L.push('    for ($k = 0; $k -lt $take; $k++) { $out += $e.Token }');
  L.push('    $used += $take');
  L.push('  }');
  L.push('  return ,$out');
  L.push('}');
  return L;
}

/** PowerShell lines (4-space indented) composing $Text/$Emoji per generation. */
function psEmojiBlock(config: GenConfig): string[] {
  if (!emojiEnabled(config)) {
    return ['    $Emoji = ""', '    $Text = $BaseText'];
  }
  return [
    '    $HeadArr = @(Fill-Slot "H" $MaxHead)',
    '    $TailArr = @(Fill-Slot "T" $MaxTail)',
    '    $RandArr = @(Fill-Slot "R" $MaxRand)',
    '    $Head = -join $HeadArr',
    '    $Tail = -join $TailArr',
    '    $Text = $Head + $BaseText + $Tail',
    '    $Emoji = $Head + $Tail',
    '    foreach ($tok in $RandArr) {',
    '      $pos = Get-Random -Minimum 0 -Maximum ($Text.Length + 1)',
    '      $Text = $Text.Substring(0, $pos) + $tok + $Text.Substring($pos)',
    '      $Emoji += $tok',
    '    }',
  ];
}

export function buildPs1(config: GenConfig): string {
  const active = activeParams(config);
  const texts = splitLines(config.texts);
  const folders = computeTextFolders(texts);
  const checkpointFlag = config.checkpointKind === 'hf' ? '--hf-checkpoint' : '--checkpoint';

  const L: string[] = [];
  L.push('# Auto-generated by Irodori-TTS Tools. Random-parameter batch generation.');
  L.push('$ErrorActionPreference = "Stop"');
  L.push('chcp 65001 > $null');
  L.push('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8');
  L.push('$inv = [System.Globalization.CultureInfo]::InvariantCulture');
  L.push('');
  L.push(`$OutDir = ${psLit(stripQuotes(config.outputDir))}`);
  L.push('New-Item -ItemType Directory -Force -Path $OutDir | Out-Null');
  L.push('');
  L.push('$Texts = @(');
  L.push(texts.map((t) => '  ' + psLit(t)).join(',\n'));
  L.push(')');
  L.push('$TextFolders = @(');
  L.push(folders.map((f) => '  ' + psLit(f)).join(',\n'));
  L.push(')');
  for (const line of psEntriesSetup(config)) L.push(line);
  L.push(`$Model = ${psLit(stripQuotes(config.checkpoint))}`);
  if (config.refMode === 'ref-wav') L.push(`$RefWav = ${psLit(stripQuotes(config.refWav))}`);
  if (config.caption.trim()) L.push(`$Caption = ${psLit(config.caption)}`);
  L.push('$RunId = (Get-Date).ToString("yyyyMMdd_HHmmss")');
  // Each run gets its own folder; each text gets a subfolder under it.
  L.push('$RunDir = Join-Path $OutDir $RunId');
  L.push('New-Item -ItemType Directory -Force -Path $RunDir | Out-Null');
  L.push('$Index = 0');
  L.push('');
  L.push('for ($ti = 0; $ti -lt $Texts.Count; $ti++) {');
  L.push('  $BaseText = $Texts[$ti]');
  L.push('  $TextDir = Join-Path $RunDir $TextFolders[$ti]');
  L.push('  New-Item -ItemType Directory -Force -Path $TextDir | Out-Null');
  L.push(`  for ($i = 0; $i -lt ${Math.max(1, Math.floor(config.count))}; $i++) {`);
  L.push('    $Index++');

  // Parameter draws.
  for (const p of active) {
    const info = FLAG_INFO[p.flag];
    const v = `$${info.psVar}`;
    if (p.kind === 'fixed') {
      L.push(`    ${v} = ${numLit(p, p.fixed)}`);
    } else if (p.type === 'int') {
      // Get-Random -Maximum is exclusive, so +1 to include max.
      L.push(`    ${v} = Get-Random -Minimum ${Math.round(p.min)} -Maximum ${Math.round(p.max) + 1}`);
    } else {
      L.push(
        `    ${v} = [math]::Round((${p.min.toFixed(p.decimals)} + (Get-Random -Maximum 10001)/10000 * (${p.max.toFixed(p.decimals)} - ${p.min.toFixed(p.decimals)})), ${p.decimals})`,
      );
    }
    if (p.type === 'float') {
      L.push(`    $${info.psVar}Str = ${v}.ToString($inv)`);
    }
  }

  // Emoji + composed text.
  for (const line of psEmojiBlock(config)) L.push(line);

  // Output names.
  const hasSeed = active.some((p) => p.flag === 'seed');
  if (hasSeed) {
    L.push('    $Name = ("{0:D4}_{1}" -f $Index, $Seed)');
  } else {
    L.push('    $Name = ("{0:D4}" -f $Index)');
  }
  L.push('    $Wav = Join-Path $TextDir "$Name.wav"');
  L.push('    $Json = Join-Path $TextDir "$Name.json"');
  L.push('');

  // Build args array.
  L.push('    $cmdArgs = @(');
  L.push(`      ${psLit(checkpointFlag)}, $Model,`);
  L.push(`      "--model-precision", ${psLit(config.precision)}, "--codec-precision", ${psLit(config.precision)},`);
  L.push('      "--text", $Text,');
  if (config.refMode === 'no-ref') {
    L.push('      "--no-ref",');
  } else {
    L.push('      "--ref-wav", $RefWav,');
  }
  if (config.caption.trim()) L.push('      "--caption", $Caption,');
  L.push('      "--output-wav", $Wav');
  L.push('    )');
  for (const p of active) {
    const info = FLAG_INFO[p.flag];
    const valExpr = p.type === 'float' ? `$${info.psVar}Str` : `$${info.psVar}`;
    L.push(`    $cmdArgs += @(${psLit('--' + p.flag)}, ${valExpr})`);
  }
  L.push('');
  L.push('    Write-Host "[$Index] $Text"');
  L.push(`    ${config.runPrefix} @cmdArgs`);
  L.push('');

  // Sidecar JSON.
  L.push('    $Meta = [ordered]@{');
  L.push('      schema = "irodori-tts-sidecar/v1"');
  L.push('      wav = "$Name.wav"');
  L.push('      text = $Text');
  L.push('      baseText = $BaseText');
  L.push('      emoji = if ($Emoji -ne "") { $Emoji } else { $null }');
  L.push(`      caption = ${config.caption.trim() ? '$Caption' : '$null'}`);
  L.push('      model = $Model');
  L.push(`      checkpointKind = ${psLit(config.checkpointKind)}`);
  L.push(`      refMode = ${psLit(config.refMode)}`);
  L.push(`      refWav = ${config.refMode === 'ref-wav' ? '$RefWav' : '$null'}`);
  L.push('      index = $Index');
  L.push('      runId = $RunId');
  for (const key of ALL_JSON_PARAM_KEYS) {
    const flag = Object.keys(FLAG_INFO).find((f) => FLAG_INFO[f].jsonKey === key)!;
    const isActive = active.some((p) => p.flag === flag);
    L.push(`      ${key} = ${isActive ? '$' + FLAG_INFO[flag].psVar : '$null'}`);
  }
  L.push('      createdAt = (Get-Date).ToUniversalTime().ToString("o")');
  L.push(`      command = "${config.runPrefix} " + ($cmdArgs -join " ")`);
  L.push('    }');
  L.push('    $Meta | ConvertTo-Json -Depth 5 | Set-Content -Path $Json -Encoding UTF8');
  L.push('  }');
  L.push('}');
  L.push('Write-Host "Done. $Index file(s) written to $RunDir"');
  L.push('');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Batch (.bat)
// ---------------------------------------------------------------------------

/** Escape for a cmd `set "VAR=..."` value. */
function batSet(name: string, value: string): string {
  const safe = value.replace(/"/g, '""');
  return `set "${name}=${safe}"`;
}

/** Single-quoted PS literal for bat-embedded one-liners. */
function psLitInline(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Inline PowerShell (quoted for bat) composing "text|appliedEmoji" from env,
 * using the same fixed-first / range-fills-remainder allocation as the .ps1.
 * Single-quoted strings only (the whole script is wrapped in double quotes).
 */
function batEmojiComposeCmd(config: GenConfig): string {
  const c = caps(config);
  const entriesLit = entryTuples(config)
    .map(
      (e) =>
        `[pscustomobject]@{Token=${psLitInline(e.token)};Mode=${psLitInline(e.mode)};HLo=${e.h[0]};HHi=${e.h[1]};TLo=${e.t[0]};THi=${e.t[1]};RLo=${e.r[0]};RHi=${e.r[1]}}`,
    )
    .join(',');
  const parts: string[] = [
    '$bs=$env:TTS_BASETEXT',
    `$Entries=@(${entriesLit})`,
    "function gl($e,$s){ if($s -eq 'H'){return @($e.HLo,$e.HHi)} if($s -eq 'T'){return @($e.TLo,$e.THi)} return @($e.RLo,$e.RHi) }",
    'function fs($s,$cap){ $u=0;$o=@(); foreach($e in $Entries){ if($e.Mode -ne ' + "'fixed'" + '){continue}; $lh=gl $e $s; $tk=[math]::Min([int]$lh[0],$cap-$u); for($k=0;$k -lt $tk;$k++){$o+=$e.Token}; if($tk -gt 0){$u+=$tk}; if($u -ge $cap){return ,$o} }; foreach($e in $Entries){ if($e.Mode -ne ' + "'range'" + '){continue}; if($u -ge $cap){break}; $rm=$cap-$u; $lh=gl $e $s; $lo=[math]::Min([int]$lh[0],$rm); $hi=[math]::Min([int]$lh[1],$rm); if($lo -lt 0){$lo=0}; $tk=Get-Random -Minimum $lo -Maximum ($hi+1); for($k=0;$k -lt $tk;$k++){$o+=$e.Token}; $u+=$tk }; return ,$o }',
    `$h=@(fs 'H' ${c.head}); $t=@(fs 'T' ${c.tail}); $r=@(fs 'R' ${c.rand})`,
    '$hd=-join $h; $tl=-join $t; $tx=$hd+$bs+$tl; $ap=$hd+$tl',
    'foreach($tok in $r){ $pos=Get-Random -Minimum 0 -Maximum ($tx.Length+1); $tx=$tx.Substring(0,$pos)+$tok+$tx.Substring($pos); $ap+=$tok }',
    "Write-Output ($tx+'|'+$ap)",
  ];
  return '"' + parts.join(';') + '"';
}

/**
 * Build a standalone .bat. Integer params use %RANDOM%; float params, emoji
 * composition, and the JSON sidecar are delegated to inline PowerShell (values
 * passed via env vars to avoid cmd quoting/encoding pitfalls with Japanese
 * text + emoji).
 */
export function buildBat(config: GenConfig): string {
  const active = activeParams(config);
  const texts = splitLines(config.texts);
  const folders = computeTextFolders(texts);
  const checkpointFlag = config.checkpointKind === 'hf' ? '--hf-checkpoint' : '--checkpoint';
  const count = Math.max(1, Math.floor(config.count));
  const useEmoji = emojiEnabled(config);

  const L: string[] = [];
  L.push('@echo off');
  L.push('REM Auto-generated by Irodori-TTS Tools. Random-parameter batch generation.');
  L.push('setlocal enabledelayedexpansion');
  L.push('chcp 65001 > nul');
  L.push('');
  L.push(batSet('OUTDIR', stripQuotes(config.outputDir).replace(/\//g, '\\')));
  L.push('if not exist "%OUTDIR%" mkdir "%OUTDIR%"');
  L.push('');
  texts.forEach((t, i) => L.push(batSet(`TEXT[${i}]`, t)));
  folders.forEach((f, i) => L.push(batSet(`TEXTFOLDER[${i}]`, f)));
  L.push(`set /a TEXTCOUNT=${texts.length}`);
  L.push(batSet('MODEL', stripQuotes(config.checkpoint)));
  if (config.refMode === 'ref-wav') L.push(batSet('REFWAV', stripQuotes(config.refWav)));
  if (config.caption.trim()) L.push(batSet('CAPTION', config.caption));
  L.push(
    'for /f "usebackq delims=" %%r in (`powershell -NoProfile -Command "(Get-Date).ToString(\'yyyyMMdd_HHmmss\')"`) do set "RUNID=%%r"',
  );
  // Each run gets its own folder; each text gets a subfolder under it.
  L.push('set "RUNDIR=%OUTDIR%\\%RUNID%"');
  L.push('if not exist "%RUNDIR%" mkdir "%RUNDIR%"');
  L.push('set /a INDEX=0');
  L.push('');
  L.push('for /L %%T in (0,1,%TEXTCOUNT%) do (');
  L.push('  if %%T lss %TEXTCOUNT% (');
  L.push('    set "BASETEXT=!TEXT[%%T]!"');
  L.push('    set "TEXTDIR=%RUNDIR%\\!TEXTFOLDER[%%T]!"');
  L.push('    if not exist "!TEXTDIR!" mkdir "!TEXTDIR!"');
  L.push(`    for /L %%I in (1,1,${count}) do (`);
  L.push('      set /a INDEX+=1');
  L.push('      set /a IDXPAD=10000+!INDEX!');
  L.push('      set "IDXSTR=!IDXPAD:~1!"');
  L.push('');

  // Integer params via %RANDOM% (RANDOM is 0..32767; combine for wider range).
  for (const p of active) {
    if (p.type !== 'int') continue;
    const info = FLAG_INFO[p.flag];
    const span = Math.round(p.max) - Math.round(p.min) + 1;
    if (p.kind === 'fixed') {
      L.push(`      set /a ${info.psVar}=${Math.round(p.fixed)}`);
    } else if (span > 32768) {
      L.push(`      set /a ${info.psVar}=(!RANDOM!*32768+!RANDOM!) %% ${span} + ${Math.round(p.min)}`);
    } else {
      L.push(`      set /a ${info.psVar}=!RANDOM! %% ${span} + ${Math.round(p.min)}`);
    }
  }

  // Float params via inline PowerShell.
  for (const p of active) {
    if (p.type !== 'float') continue;
    const info = FLAG_INFO[p.flag];
    if (p.kind === 'fixed') {
      L.push(`      set "${info.psVar}=${p.fixed.toFixed(p.decimals)}"`);
    } else {
      const psExpr = `[math]::Round((${p.min.toFixed(p.decimals)} + (Get-Random -Maximum 10001)/10000 * (${p.max.toFixed(p.decimals)} - ${p.min.toFixed(p.decimals)})),${p.decimals}).ToString([Globalization.CultureInfo]::InvariantCulture)`;
      L.push(
        `      for /f "usebackq delims=" %%v in (\`powershell -NoProfile -Command "${psExpr}"\`) do set "${info.psVar}=%%v"`,
      );
    }
  }

  // Emoji composition (text + applied emoji) via PowerShell.
  L.push('      set "EMOJI="');
  L.push('      set "TTS_TEXT=!BASETEXT!"');
  if (useEmoji) {
    L.push('      set "TTS_BASETEXT=!BASETEXT!"');
    L.push(
      `      for /f "usebackq tokens=1,2 delims=|" %%a in (\`powershell -NoProfile -Command ${batEmojiComposeCmd(config)}\`) do (set "TTS_TEXT=%%a" & set "EMOJI=%%b")`,
    );
  }
  L.push('');

  // Names.
  const hasSeed = active.some((p) => p.flag === 'seed');
  L.push(hasSeed ? '      set "NAME=!IDXSTR!_!Seed!"' : '      set "NAME=!IDXSTR!"');
  L.push('      set "WAV=!TEXTDIR!\\!NAME!.wav"');
  L.push('      set "JSON=!TEXTDIR!\\!NAME!.json"');
  L.push('');

  // infer.py invocation.
  const inferParts: string[] = [
    `${config.runPrefix} ${checkpointFlag} "%MODEL%" --model-precision ${config.precision} --codec-precision ${config.precision} --text "!TTS_TEXT!"`,
  ];
  if (config.refMode === 'no-ref') inferParts.push('--no-ref');
  else inferParts.push('--ref-wav "%REFWAV%"');
  if (config.caption.trim()) inferParts.push('--caption "%CAPTION%"');
  inferParts.push('--output-wav "!WAV!"');
  for (const p of active) {
    inferParts.push(`--${p.flag} !${FLAG_INFO[p.flag].psVar}!`);
  }
  L.push('      echo [!INDEX!] !TTS_TEXT!');
  L.push('      ' + inferParts.join(' '));
  L.push('');

  // Sidecar JSON via PowerShell, reading values from env vars.
  L.push('      set "TTS_BASETEXT=!BASETEXT!"');
  L.push('      set "TTS_EMOJI=!EMOJI!"');
  L.push('      set "TTS_NAME=!NAME!"');
  L.push('      set "TTS_JSON=!JSON!"');
  L.push('      set "TTS_MODEL=%MODEL%"');
  L.push('      set "TTS_INDEX=!INDEX!"');
  L.push('      set "TTS_RUNID=%RUNID%"');
  if (config.refMode === 'ref-wav') L.push('      set "TTS_REFWAV=%REFWAV%"');
  if (config.caption.trim()) L.push('      set "TTS_CAPTION=%CAPTION%"');
  for (const p of active) {
    L.push(`      set "${FLAG_INFO[p.flag].env}=!${FLAG_INFO[p.flag].psVar}!"`);
  }
  L.push('      powershell -NoProfile -Command ' + batJsonPsCommand(config, active));
  L.push('    )');
  L.push('  )');
  L.push(')');
  L.push('echo Done. !INDEX! file(s) written to %RUNDIR%');
  L.push('endlocal');
  L.push('');
  return L.join('\n');
}

/** PowerShell one-liner (quoted for bat) that writes the sidecar JSON from env vars. */
function batJsonPsCommand(config: GenConfig, active: ParamRange[]): string {
  const parts: string[] = [];
  parts.push('$m=[ordered]@{}');
  parts.push("$m.schema='irodori-tts-sidecar/v1'");
  parts.push("$m.wav=$env:TTS_NAME+'.wav'");
  parts.push('$m.text=$env:TTS_TEXT');
  parts.push('$m.baseText=$env:TTS_BASETEXT');
  parts.push('$m.emoji=if($env:TTS_EMOJI){$env:TTS_EMOJI}else{$null}');
  parts.push(config.caption.trim() ? '$m.caption=$env:TTS_CAPTION' : '$m.caption=$null');
  parts.push('$m.model=$env:TTS_MODEL');
  parts.push(`$m.checkpointKind='${config.checkpointKind}'`);
  parts.push(`$m.refMode='${config.refMode}'`);
  parts.push(
    config.refMode === 'ref-wav'
      ? '$m.refWav=if($env:TTS_REFWAV){$env:TTS_REFWAV}else{$null}'
      : '$m.refWav=$null',
  );
  parts.push('$m.index=[int]$env:TTS_INDEX');
  parts.push('$m.runId=$env:TTS_RUNID');
  for (const flag of Object.keys(FLAG_INFO)) {
    const info = FLAG_INFO[flag];
    const p = active.find((a) => a.flag === flag);
    if (!p) {
      parts.push(`$m.${info.jsonKey}=$null`);
    } else if (p.type === 'int') {
      parts.push(`$m.${info.jsonKey}=[int]$env:${info.env}`);
    } else {
      parts.push(`$m.${info.jsonKey}=[double]::Parse($env:${info.env},[Globalization.CultureInfo]::InvariantCulture)`);
    }
  }
  parts.push("$m.createdAt=(Get-Date).ToUniversalTime().ToString('o')");
  parts.push("$m.command=''");
  parts.push('($m|ConvertTo-Json -Depth 5)|Set-Content -Path $env:TTS_JSON -Encoding UTF8');
  return '"' + parts.join(';') + '"';
}

// ---------------------------------------------------------------------------
// Python driver (loads the model ONCE, then loops — far faster)
// ---------------------------------------------------------------------------

/**
 * Build a standalone Python driver that imports Irodori-TTS's InferenceRuntime,
 * loads the model a single time, and loops over every text × N generation,
 * drawing random parameters and writing wav + sidecar JSON. This avoids the
 * per-file process/model-reload cost of the .ps1/.bat scripts.
 */
export function buildPy(config: GenConfig): string {
  const texts = splitLines(config.texts);
  const folders = computeTextFolders(texts);
  const c = caps(config);
  const entries = entryTuples(config).map((e) => [
    e.token,
    e.mode,
    e.h[0],
    e.h[1],
    e.t[0],
    e.t[1],
    e.r[0],
    e.r[1],
  ]);
  const params: Record<string, [string, string, number, number, number, number]> = {};
  for (const p of config.params) {
    params[p.flag] = [p.kind, p.type, p.fixed, p.min, p.max, p.decimals];
  }

  const j = (v: unknown) => JSON.stringify(v);
  const L: string[] = [];
  L.push('# Auto-generated by Irodori-TTS Tools. Loads the model ONCE, then loops.');
  L.push('# Run from the Irodori-TTS repo root, e.g.:  uv run --no-sync python generate_tts.py');
  L.push('import json, random, datetime');
  L.push('from pathlib import Path');
  L.push('from huggingface_hub import hf_hub_download');
  L.push('from irodori_tts.inference_runtime import (');
  L.push('    InferenceRuntime, RuntimeKey, SamplingRequest, default_runtime_device, save_wav,');
  L.push(')');
  L.push('');
  L.push(`OUT_DIR = ${j(stripQuotes(config.outputDir))}`);
  L.push(`MODEL = ${j(stripQuotes(config.checkpoint))}`);
  L.push(`CHECKPOINT_KIND = ${j(config.checkpointKind)}`);
  L.push(`REF_MODE = ${j(config.refMode)}`);
  L.push(`REF_WAV = ${config.refMode === 'ref-wav' && stripQuotes(config.refWav) ? j(stripQuotes(config.refWav)) : 'None'}`);
  L.push(`CAPTION = ${config.caption.trim() ? j(config.caption) : 'None'}`);
  L.push(`COUNT = ${Math.max(1, Math.floor(config.count))}`);
  L.push(`TEXTS = ${j(texts)}`);
  L.push(`TEXT_FOLDERS = ${j(folders)}`);
  L.push(`ENTRIES = ${j(entries)}  # [token, mode, hLo, hHi, tLo, tHi, rLo, rHi]`);
  L.push(`MAX_HEAD = ${c.head}; MAX_TAIL = ${c.tail}; MAX_RAND = ${c.rand}`);
  L.push(`PARAMS = ${j(params)}  # flag: [kind, type, fixed, min, max, decimals]`);
  L.push('DEFAULTS = {"num-steps": 40, "duration-scale": 1.0, "sway-coeff": -1.0,');
  L.push('            "cfg-scale-text": 3.0, "cfg-scale-caption": 3.0, "cfg-scale-speaker": 5.0}');
  L.push('');
  L.push('def draw(flag):');
  L.push('    kind, typ, fixed, mn, mx, dec = PARAMS[flag]');
  L.push('    if kind == "off": return None');
  L.push('    if kind == "fixed": return int(fixed) if typ == "int" else round(float(fixed), dec)');
  L.push('    if typ == "int": return random.randint(int(mn), int(mx))');
  L.push('    return round(random.uniform(float(mn), float(mx)), dec)');
  L.push('');
  L.push('def use(flag, raw):');
  L.push('    return DEFAULTS[flag] if raw is None else raw');
  L.push('');
  L.push('def lohi(e, s):');
  L.push('    return (e[2], e[3]) if s == "H" else (e[4], e[5]) if s == "T" else (e[6], e[7])');
  L.push('');
  L.push('def fill(s, cap):');
  L.push('    used = 0; out = []');
  L.push('    for e in ENTRIES:  # fixed entries first (priority)');
  L.push('        if e[1] != "fixed": continue');
  L.push('        lo, _ = lohi(e, s); take = min(int(lo), cap - used)');
  L.push('        out += [e[0]] * take; used += max(0, take)');
  L.push('        if used >= cap: return out');
  L.push('    for e in ENTRIES:  # range entries fill the remaining budget');
  L.push('        if e[1] != "range" or used >= cap: continue');
  L.push('        lo, hi = lohi(e, s); rem = cap - used');
  L.push('        lo = min(int(lo), rem); hi = min(int(hi), rem)');
  L.push('        take = random.randint(max(0, lo), hi)');
  L.push('        out += [e[0]] * take; used += take');
  L.push('    return out');
  L.push('');
  L.push('def compose(base):');
  L.push('    head = "".join(fill("H", MAX_HEAD)); tail = "".join(fill("T", MAX_TAIL))');
  L.push('    text = head + base + tail; applied = head + tail');
  L.push('    for tok in fill("R", MAX_RAND):');
  L.push('        pos = random.randint(0, len(text))');
  L.push('        text = text[:pos] + tok + text[pos:]; applied += tok');
  L.push('    return text, applied');
  L.push('');
  L.push('checkpoint_path = MODEL if CHECKPOINT_KIND == "local" else hf_hub_download(repo_id=MODEL, filename="model.safetensors")');
  L.push('device = str(default_runtime_device())');
  L.push('runtime = InferenceRuntime.from_key(RuntimeKey(');
  L.push('    checkpoint=checkpoint_path,');
  L.push('    model_device=device,');
  L.push('    codec_repo="Aratako/Semantic-DACVAE-Japanese-32dim",');
  L.push(`    model_precision=${j(config.precision)},  # bf16=fast(GPU) / fp32=safe(CPU)`);
  L.push('    codec_device=device,');
  L.push(`    codec_precision=${j(config.precision)},`);
  L.push('    codec_deterministic_encode=True,');
  L.push('    codec_deterministic_decode=True,');
  L.push('    compile_model=False,');
  L.push('    compile_dynamic=False,');
  L.push('))');
  L.push('');
  L.push('run_id = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")');
  L.push('run_dir = Path(OUT_DIR) / run_id');
  L.push('index = 0');
  L.push('for ti, base in enumerate(TEXTS):');
  L.push('    text_dir = run_dir / TEXT_FOLDERS[ti]');
  L.push('    text_dir.mkdir(parents=True, exist_ok=True)');
  L.push('    for _ in range(COUNT):');
  L.push('        index += 1');
  L.push('        r_seed = draw("seed")');
  L.push('        r_steps = draw("num-steps")');
  L.push('        r_dur = draw("duration-scale")');
  L.push('        r_sway = draw("sway-coeff")');
  L.push('        r_ct = draw("cfg-scale-text")');
  L.push('        r_cc = draw("cfg-scale-caption")');
  L.push('        r_cs = draw("cfg-scale-speaker")');
  L.push('        r_tr = draw("truncation-factor")');
  L.push('        text, applied = compose(base)');
  L.push('        name = f"{index:04d}" + (f"_{r_seed}" if r_seed is not None else "")');
  L.push('        result = runtime.synthesize(SamplingRequest(');
  L.push('            text=text, caption=CAPTION, ref_wav=REF_WAV, ref_latent=None, ref_embed=None,');
  L.push('            no_ref=(REF_MODE == "no-ref"), ref_normalize_db=-16.0, ref_ensure_max=True,');
  L.push('            num_candidates=1, decode_mode="sequential", seconds=None,');
  L.push('            duration_scale=float(use("duration-scale", r_dur)), max_ref_seconds=30.0,');
  L.push('            max_text_len=None, max_caption_len=None,');
  L.push('            num_steps=int(use("num-steps", r_steps)),');
  L.push('            cfg_scale_text=float(use("cfg-scale-text", r_ct)),');
  L.push('            cfg_scale_caption=float(use("cfg-scale-caption", r_cc)),');
  L.push('            cfg_scale_speaker=float(use("cfg-scale-speaker", r_cs)),');
  L.push('            cfg_guidance_mode="independent", cfg_scale=None, cfg_min_t=0.5, cfg_max_t=1.0,');
  L.push('            truncation_factor=(None if r_tr is None else float(r_tr)),');
  L.push('            rescale_k=None, rescale_sigma=None, context_kv_cache=True,');
  L.push('            speaker_kv_scale=None, speaker_kv_min_t=None, speaker_kv_max_layers=None,');
  L.push('            speaker_uncond_mode="mask",');
  L.push('            seed=(None if r_seed is None else int(r_seed)),');
  L.push('            t_schedule_mode="linear", sway_coeff=float(use("sway-coeff", r_sway)),');
  L.push('            trim_tail=True, tail_window_size=20, tail_std_threshold=0.05,');
  L.push('            tail_mean_threshold=0.1, lora_adapter=None,');
  L.push('        ), log_fn=None)');
  L.push('        save_wav(str(text_dir / f"{name}.wav"), result.audio, result.sample_rate)');
  L.push('        meta = {');
  L.push('            "schema": "irodori-tts-sidecar/v1", "wav": f"{name}.wav",');
  L.push('            "text": text, "baseText": base, "emoji": (applied or None),');
  L.push('            "caption": CAPTION, "model": MODEL, "checkpointKind": CHECKPOINT_KIND,');
  L.push('            "refMode": REF_MODE, "refWav": REF_WAV, "index": index, "runId": run_id,');
  L.push('            "seed": r_seed, "numSteps": r_steps, "cfgScaleText": r_ct,');
  L.push('            "cfgScaleCaption": r_cc, "cfgScaleSpeaker": r_cs, "durationScale": r_dur,');
  L.push('            "swayCoeff": r_sway, "truncationFactor": r_tr,');
  L.push('            "createdAt": datetime.datetime.utcnow().isoformat() + "Z",');
  L.push('            "command": "generate_tts.py (load-once driver)",');
  L.push('        }');
  L.push('        (text_dir / f"{name}.json").write_text(');
  L.push('            json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")');
  L.push('        print(f"[{index}] {text_dir / name}.wav")');
  L.push('print(f"Done. {index} file(s) written to {run_dir}")');
  L.push('');
  return L.join('\n');
}
