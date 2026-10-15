import React from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, PieChart, Pie, Cell, Legend, Area, AreaChart
} from 'recharts';

const C = {
  navy: '#1B3A5C', teal: '#2E7D8C', tealLight: '#3A9BAD', gold: '#C9A84C',
  green: '#10B981', red: '#EF4444', amber: '#F59E0B', purple: '#8B5CF6',
  gray: '#64748B', grayLight: '#E2E8F0',
};

export const CHART_COLORS = [
  '#2E7D8C','#1B3A5C','#C9A84C','#10B981','#8B5CF6','#F59E0B','#EF4444',
  '#3A9BAD','#234876','#D4A853','#059669','#7C3AED',
];

// ── Stat Card ──────────────────────────────────────────────────────────────
export function StatCard({ label, value, sub, icon, color = C.teal, trend, small }) {
  return (
    <div style={{
      background: 'white', borderRadius: 14, padding: small ? '16px 20px' : '20px 24px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04)',
      borderTop: `3px solid ${color}`, display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.gray, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </span>
        {icon && <span style={{ fontSize: 18, opacity: 0.7 }}>{icon}</span>}
      </div>
      <div style={{ fontSize: small ? 24 : 30, fontWeight: 700, color: '#1E293B', fontFamily: "'DM Serif Display', serif", lineHeight: 1.1 }}>
        {value}
      </div>
      {(sub || trend != null) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {trend != null && (
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
              background: trend >= 0 ? '#D1FAE5' : '#FEE2E2',
              color: trend >= 0 ? '#059669' : '#DC2626',
            }}>
              {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
            </span>
          )}
          {sub && <span style={{ fontSize: 12, color: C.gray }}>{sub}</span>}
        </div>
      )}
    </div>
  );
}

// ── Section Header ─────────────────────────────────────────────────────────
export function SectionHeader({ title, sub }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 22, color: '#1B3A5C', marginBottom: 2 }}>{title}</h2>
      {sub && <p style={{ fontSize: 13, color: C.gray }}>{sub}</p>}
    </div>
  );
}

// ── Chart Card ────────────────────────────────────────────────────────────
export function ChartCard({ title, children, height = 240, style }) {
  return (
    <div style={{
      background: 'white', borderRadius: 14, padding: '20px 24px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04)',
      ...style
    }}>
      {title && (
        <p style={{ fontSize: 13, fontWeight: 600, color: C.gray, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
          {title}
        </p>
      )}
      <div style={{ height }}>{children}</div>
    </div>
  );
}

// ── Tooltip ───────────────────────────────────────────────────────────────
export function CustomTooltip({ active, payload, label, fmt = (v) => v }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'white', border: '1px solid #E2E8F0', borderRadius: 8,
      padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontSize: 13,
    }}>
      <p style={{ fontWeight: 600, marginBottom: 6, color: '#1E293B' }}>{label}</p>
      {payload.map((entry, i) => (
        <p key={i} style={{ color: entry.color || C.teal, margin: '2px 0' }}>
          {entry.name}: <strong>{fmt(entry.value)}</strong>
        </p>
      ))}
    </div>
  );
}

// ── Bar Chart ─────────────────────────────────────────────────────────────
export function SimpleBarChart({ data, dataKey, nameKey = 'name', color = C.teal, fmt, yFmt, height = 220, horizontal }) {
  const fmtFn = fmt || (v => v);
  const yFmtFn = yFmt || (v => v);
  if (horizontal) {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#F0F4F8" horizontal={false} />
          <XAxis type="number" tickFormatter={yFmtFn} tick={{ fontSize: 11, fill: C.gray }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey={nameKey} tick={{ fontSize: 12, fill: '#1E293B' }} axisLine={false} tickLine={false} width={80} />
          <Tooltip content={<CustomTooltip fmt={fmtFn} />} cursor={{ fill: '#F0F4F8' }} />
          <Bar dataKey={dataKey} fill={color} radius={[0, 4, 4, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F0F4F8" vertical={false} />
        <XAxis dataKey={nameKey} tick={{ fontSize: 11, fill: C.gray }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={yFmtFn} tick={{ fontSize: 11, fill: C.gray }} axisLine={false} tickLine={false} width={48} />
        <Tooltip content={<CustomTooltip fmt={fmtFn} />} cursor={{ fill: '#F0F4F8' }} />
        <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} maxBarSize={40} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Multi Bar Chart ───────────────────────────────────────────────────────
export function MultiBarChart({ data, bars, nameKey = 'name', fmt, height = 220 }) {
  const fmtFn = fmt || (v => v);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F0F4F8" vertical={false} />
        <XAxis dataKey={nameKey} tick={{ fontSize: 11, fill: C.gray }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={fmtFn} tick={{ fontSize: 11, fill: C.gray }} axisLine={false} tickLine={false} width={48} />
        <Tooltip content={<CustomTooltip fmt={fmtFn} />} cursor={{ fill: '#F0F4F8' }} />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        {bars.map((b, i) => (
          <Bar key={b.key} dataKey={b.key} name={b.label} fill={b.color || CHART_COLORS[i]} radius={[3, 3, 0, 0]} maxBarSize={24} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Area Chart ────────────────────────────────────────────────────────────
export function SimpleAreaChart({ data, dataKey, nameKey = 'name', color = C.teal, fmt, height = 220 }) {
  const fmtFn = fmt || (v => v);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
        <defs>
          <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.15} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#F0F4F8" vertical={false} />
        <XAxis dataKey={nameKey} tick={{ fontSize: 11, fill: C.gray }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={fmtFn} tick={{ fontSize: 11, fill: C.gray }} axisLine={false} tickLine={false} width={48} />
        <Tooltip content={<CustomTooltip fmt={fmtFn} />} />
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#grad-${dataKey})`} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Pie Chart ─────────────────────────────────────────────────────────────
export function SimplePieChart({ data, height = 220 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
          outerRadius={80} innerRadius={40} paddingAngle={2}
          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
          labelLine={false}
        >
          {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v) => [v, '']} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Filter Bar ────────────────────────────────────────────────────────────
export function FilterBar({ filters, onChange }) {
  const sel = (key, val) => ({
    padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500,
    border: '1.5px solid',
    cursor: 'pointer', transition: 'all 0.15s', fontFamily: "'DM Sans', sans-serif",
    borderColor: filters[key] === val ? C.teal : '#E2E8F0',
    background: filters[key] === val ? C.teal : 'white',
    color: filters[key] === val ? 'white' : '#475569',
  });

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center', marginBottom: 24 }}>
      {/* Year */}
      <FilterGroup label="Year">
        {['all','2026','2025','2024'].map(y => (
          <button key={y} style={sel('year', y)} onClick={() => onChange({ ...filters, year: y })}>
            {y === 'all' ? 'All Years' : y}
          </button>
        ))}
      </FilterGroup>

      {/* Location */}
      <FilterGroup label="Location">
        {[['all','All'],['SC','Santa Clara'],['F','Fremont'],['WC','Walnut Creek'],['SV','Sunnyvale']].map(([v, l]) => (
          <button key={v} style={sel('loc', v)} onClick={() => onChange({ ...filters, loc: v })}>{l}</button>
        ))}
      </FilterGroup>

      {/* Doctor */}
      <FilterGroup label="Doctor">
        <select
          value={filters.doctor}
          onChange={e => onChange({ ...filters, doctor: e.target.value })}
          style={{
            padding: '6px 28px 6px 12px', borderRadius: 20, fontSize: 13, fontWeight: 500,
            border: `1.5px solid ${filters.doctor !== 'all' ? C.teal : '#E2E8F0'}`,
            background: filters.doctor !== 'all' ? C.teal : 'white',
            color: filters.doctor !== 'all' ? 'white' : '#475569',
            cursor: 'pointer', outline: 'none', appearance: 'none',
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          <option value="all">All Doctors</option>
          {['Kha','Pan','Fan','Ghag','Kaneta','Yang','Luong','Zhang','Burger','Cheng','Miranda','Pham','Duong','So'].map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </FilterGroup>

      {/* Month */}
      <FilterGroup label="Month">
        <select
          value={filters.month}
          onChange={e => onChange({ ...filters, month: e.target.value })}
          style={{
            padding: '6px 28px 6px 12px', borderRadius: 20, fontSize: 13, fontWeight: 500,
            border: `1.5px solid ${filters.month !== 'all' ? C.teal : '#E2E8F0'}`,
            background: filters.month !== 'all' ? C.teal : 'white',
            color: filters.month !== 'all' ? 'white' : '#475569',
            cursor: 'pointer', outline: 'none', appearance: 'none',
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          <option value="all">All Months</option>
          {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => (
            <option key={i+1} value={String(i+1)}>{m}</option>
          ))}
        </select>
      </FilterGroup>
    </div>
  );
}

function FilterGroup({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}

// ── Data Table ────────────────────────────────────────────────────────────
export function DataTable({ columns, rows, maxRows = 20 }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} style={{
                padding: '8px 12px', textAlign: c.right ? 'right' : 'left',
                fontSize: 11, fontWeight: 700, color: '#94A3B8',
                textTransform: 'uppercase', letterSpacing: '0.06em',
                borderBottom: '2px solid #F0F4F8', background: 'white',
                whiteSpace: 'nowrap',
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, maxRows).map((row, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#FAFBFC' }}>
              {columns.map((c, j) => (
                <td key={j} style={{
                  padding: '9px 12px', textAlign: c.right ? 'right' : 'left',
                  borderBottom: '1px solid #F0F4F8', color: j === 0 ? '#1E293B' : '#475569',
                  fontWeight: j === 0 ? 600 : 400, whiteSpace: 'nowrap',
                }}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────
export const fmt$ = (v) => v == null ? '—' : `$${Math.round(v).toLocaleString()}`;
export const fmtPct = (v) => v == null ? '—' : `${(v * 100).toFixed(1)}%`;
export const fmtNum = (v) => v == null ? '—' : Math.round(v).toLocaleString();
export const fmtDec = (v, d = 1) => v == null ? '—' : v.toFixed(d);

export const MONTH_SHORT = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const DAY_ORDER = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export const LOC_NAMES = { SC: 'Santa Clara', F: 'Fremont', WC: 'Walnut Creek', SV: 'Sunnyvale' };
export const LOC_COLORS = { SC: '#2E7D8C', F: '#1B3A5C', WC: '#C9A84C', SV: '#10B981' };
