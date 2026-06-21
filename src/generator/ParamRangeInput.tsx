import type { ParamRange, ParamKind } from '../types';

interface Props {
  param: ParamRange;
  onChange: (next: ParamRange) => void;
}

export function ParamRangeInput({ param, onChange }: Props) {
  const set = (patch: Partial<ParamRange>) => onChange({ ...param, ...patch });
  const step = param.type === 'int' ? 1 : Math.pow(10, -param.decimals);

  return (
    <div className="param-row">
      <label className="param-label">{param.label}</label>
      <select
        value={param.kind}
        onChange={(e) => set({ kind: e.target.value as ParamKind })}
      >
        <option value="off">既定 (off)</option>
        <option value="fixed">固定</option>
        <option value="range">範囲</option>
      </select>

      {param.kind === 'fixed' && (
        <input
          type="number"
          step={step}
          value={param.fixed}
          onChange={(e) => set({ fixed: Number(e.target.value) })}
        />
      )}

      {param.kind === 'range' && (
        <span className="param-range">
          <input
            type="number"
            step={step}
            value={param.min}
            onChange={(e) => set({ min: Number(e.target.value) })}
            aria-label={`${param.label} min`}
          />
          <span>〜</span>
          <input
            type="number"
            step={step}
            value={param.max}
            onChange={(e) => set({ max: Number(e.target.value) })}
            aria-label={`${param.label} max`}
          />
        </span>
      )}

      {param.kind === 'range' && param.type === 'float' && (
        <label className="param-decimals">
          小数桁
          <input
            type="number"
            min={0}
            max={6}
            value={param.decimals}
            onChange={(e) => set({ decimals: Number(e.target.value) })}
          />
        </label>
      )}
    </div>
  );
}
