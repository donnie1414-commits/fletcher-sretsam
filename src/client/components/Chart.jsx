/** Hand-rolled SVG line chart (pace: this year vs last year). Palette from the theme tokens. */
import { fmtInt } from '../format.js';
export function LineChart({ series, height = 180, yLabel = '', xLabels = [] }) {
  const w = 640, h = height, pad = { l: 44, r: 12, t: 12, b: 28 };
  const all = series.flatMap((s) => s.values);
  const n = Math.max(...series.map((s) => s.values.length), 2);
  const maxY = Math.max(1, ...all);
  const x = (i) => pad.l + (i / (n - 1)) * (w - pad.l - pad.r);
  const y = (v) => pad.t + (1 - v / maxY) * (h - pad.t - pad.b);
  const ticks = 4;
  const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart" role="img" aria-label={`${yLabel} by week`}>
      {Array.from({ length: ticks + 1 }).map((_, i) => { const v = (maxY / ticks) * i; return <g key={i}><line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="chart-grid" /><text x={pad.l - 6} y={y(v) + 4} textAnchor="end" className="chart-tick">{fmtInt(v)}</text></g>; })}
      {xLabels.map((lab, i) => <text key={i} x={x(lab.i)} y={h - 8} textAnchor="middle" className="chart-tick">{lab.text}</text>)}
      {series.map((s, k) => <g key={k}><path d={path(s.values)} className={`chart-line chart-line-${k}`} fill="none" />{s.values.length ? <circle cx={x(s.values.length - 1)} cy={y(s.values[s.values.length - 1])} r="3.5" className={`chart-end chart-line-${k}`} /> : null}</g>)}
      <g className="chart-legend">{series.map((s, k) => <g key={k} transform={`translate(${pad.l + k * 150}, ${pad.t + 4})`}><line x1="0" x2="18" y1="0" y2="0" className={`chart-line chart-line-${k}`} /><text x="24" y="4" className="chart-tick">{s.name}</text></g>)}</g>
    </svg>
  );
}
