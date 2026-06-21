import type { ParamRange, ParamKind } from '../types';

interface Props {
  param: ParamRange;
  /** Factory default for the reset button. */
  factory: ParamRange;
  onChange: (next: ParamRange) => void;
}

/** A labelled slider + number box, gradio-style. */
function Slider({
  value,
  min,
  max,
  step,
  decimals,
  onChange,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  decimals: number;
  onChange: (v: number) => void;
  ariaLabel: string;
}) {
  return (
    <div className="slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <input
        className="slider-num"
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isInteger(value) ? value : Number(value.toFixed(decimals))}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function ParamRangeInput({ param, factory, onChange }: Props) {
  const set = (patch: Partial<ParamRange>) => onChange({ ...param, ...patch });
  const numStep = param.type === 'int' ? 1 : Math.pow(10, -param.decimals);
  const useSlider = param.slider;

  return (
    <div className="param-block">
      <div className="param-head">
        <label className="param-label">{param.label}</label>
        <select
          value={param.kind}
          onChange={(e) => set({ kind: e.target.value as ParamKind })}
        >
          <option value="off">既定 (off)</option>
          <option value="fixed">固定</option>
          <option value="range">範囲</option>
        </select>
        <span className="grow" />
        <button
          type="button"
          className="reset"
          title="デフォルトに戻す"
          onClick={() => onChange({ ...factory })}
        >
          ⟲ リセット
        </button>
      </div>

      <div className="param-desc">{param.desc}</div>

      {param.kind === 'off' && (
        <div className="param-hint">infer.py の既定値（{factory.default}）を使用</div>
      )}

      {param.kind === 'fixed' &&
        (useSlider ? (
          <Slider
            value={param.fixed}
            min={param.sliderMin}
            max={param.sliderMax}
            step={param.step}
            decimals={param.decimals}
            ariaLabel={`${param.label} value`}
            onChange={(v) => set({ fixed: v })}
          />
        ) : (
          <input
            type="number"
            step={numStep}
            value={param.fixed}
            onChange={(e) => set({ fixed: Number(e.target.value) })}
          />
        ))}

      {param.kind === 'range' &&
        (useSlider ? (
          <div className="param-range-sliders">
            <div className="range-row">
              <span className="range-tag">min</span>
              <Slider
                value={param.min}
                min={param.sliderMin}
                max={param.sliderMax}
                step={param.step}
                decimals={param.decimals}
                ariaLabel={`${param.label} min`}
                onChange={(v) => set({ min: Math.min(v, param.max) })}
              />
            </div>
            <div className="range-row">
              <span className="range-tag">max</span>
              <Slider
                value={param.max}
                min={param.sliderMin}
                max={param.sliderMax}
                step={param.step}
                decimals={param.decimals}
                ariaLabel={`${param.label} max`}
                onChange={(v) => set({ max: Math.max(v, param.min) })}
              />
            </div>
          </div>
        ) : (
          <span className="param-range">
            <input
              type="number"
              step={numStep}
              value={param.min}
              onChange={(e) => set({ min: Number(e.target.value) })}
              aria-label={`${param.label} min`}
            />
            <span>〜</span>
            <input
              type="number"
              step={numStep}
              value={param.max}
              onChange={(e) => set({ max: Number(e.target.value) })}
              aria-label={`${param.label} max`}
            />
          </span>
        ))}
    </div>
  );
}
