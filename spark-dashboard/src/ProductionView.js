import React, { useMemo, useState } from 'react';
import { loadPayments } from './doctorData';
import { EmployeeReport } from './DoctorsView';
import {
  StatCard, ChartCard, SectionHeader, SimpleBarChart, MultiBarChart,
  SimpleAreaChart, SimplePieChart, FilterBar, DataTable,
  fmt$, fmtPct, fmtNum, fmtDec,
  MONTH_SHORT, DAY_ORDER, LOC_NAMES, LOC_COLORS, CHART_COLORS,
} from './components';
import { computeStats } from './parseExcel';

const LOC_LIST = ['SC','F','WC','SV'];

function applyFilters(patients, filters) {
  return patients.filter(p => {
    if (filters.year !== 'all' && String(p.year) !== filters.year) return false;
    if (filters.loc !== 'all' && p.loc !== filters.loc) return false;
    if (filters.doctor !== 'all' && p.doctor !== filters.doctor) return false;
    if (filters.month !== 'all' && String(p.month) !== filters.month) return false;
    return true;
  });
}

// KPI card with hover breakdown by location
function KpiCard({ label, value, sub, icon, color, byLocation, fmt: fmtFn = fmt$ }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <StatCard label={label} value={value} sub={sub} icon={icon} color={color} />
      {hovered && byLocation && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 100,
          background: 'white', borderRadius: 10, padding: '12px 16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.15)', border: '1px solid #E2E8F0',
          minWidth: 220, marginTop: 4,
        }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            By Location
          </p>
          {LOC_LIST.map(loc => {
            const val = byLocation[loc];
            if (val == null) return null;
            return (
              <div key={loc} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #F0F4F8' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: LOC_COLORS[loc] }} />
                  <span style={{ fontSize: 13, color: '#475569' }}>{LOC_NAMES[loc]}</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1E293B' }}>{fmtFn(val)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// YoY comparison table (replaces big bar chart)
function YoYTable({ byMonth, prevByMonth, label = 'Revenue' }) {
  const months = Array.from({ length: 12 }, (_, i) => i + 1)
    .filter(m => byMonth[m] || prevByMonth?.[m]);

  const getVal = (obj, m) => {
    if (!obj || !obj[m]) return null;
    return label === 'Revenue' ? obj[m].revenue
      : label === 'Patients'  ? obj[m].patients
      : label === 'Optos'     ? obj[m].optos
      : label === 'OCT'       ? obj[m].oct
      : obj[m].revenue;
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={thStyle}>Month</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>This Year</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Prior Year</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Change</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m, i) => {
            const curr = getVal(byMonth, m);
            const prev = getVal(prevByMonth, m);
            const pct  = curr != null && prev != null && prev > 0 ? ((curr - prev) / prev) * 100 : null;
            return (
              <tr key={m} style={{ background: i % 2 === 0 ? 'white' : '#FAFBFC' }}>
                <td style={tdStyle}>{MONTH_SHORT[m]}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>
                  {curr != null ? (label === 'Revenue' ? fmt$(curr) : fmtNum(curr)) : '—'}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', color: '#94A3B8' }}>
                  {prev != null ? (label === 'Revenue' ? fmt$(prev) : fmtNum(prev)) : '—'}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  {pct != null ? (
                    <span style={{
                      fontSize: 12, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
                      background: pct >= 0 ? '#D1FAE5' : '#FEE2E2',
                      color: pct >= 0 ? '#059669' : '#DC2626',
                    }}>
                      {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                    </span>
                  ) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const thStyle = { padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '2px solid #F0F4F8' };
const tdStyle = { padding: '8px 12px', borderBottom: '1px solid #F0F4F8', color: '#475569' };

// Weekly table
function WeeklyTable({ byWeek, prevByWeek, metric = 'revenue' }) {
  const weeks = Object.values(byWeek)
    .sort((a, b) => a.week.localeCompare(b.week))
    .slice(-16); // last 16 weeks

  const getLocVal = (wkData, loc) => {
    if (!wkData || !wkData.byLoc || !wkData.byLoc[loc]) return 0;
    return metric === 'revenue' ? wkData.byLoc[loc].revenue
      : metric === 'optos'   ? wkData.byLoc[loc].optos
      : metric === 'oct'     ? wkData.byLoc[loc].oct
      : wkData.byLoc[loc].patients;
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={thStyle}>Week</th>
            <th style={{ ...thStyle, textAlign: 'right', color: LOC_COLORS.SC }}>Santa Clara</th>
            <th style={{ ...thStyle, textAlign: 'right', color: LOC_COLORS.F }}>Fremont</th>
            <th style={{ ...thStyle, textAlign: 'right', color: LOC_COLORS.WC }}>Walnut Creek</th>
            <th style={{ ...thStyle, textAlign: 'right', color: LOC_COLORS.SV }}>Sunnyvale</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
            {prevByWeek && <th style={{ ...thStyle, textAlign: 'right' }}>vs Prior</th>}
          </tr>
        </thead>
        <tbody>
          {weeks.map((wk, i) => {
            const total = metric === 'revenue' ? wk.revenue : metric === 'optos' ? wk.optos : metric === 'oct' ? wk.oct : wk.patients;
            // Find matching prior year week
            const priorKey = `${wk.year - 1}-W${String(wk.isoWeek).padStart(2,'0')}`;
            const prior    = prevByWeek?.[priorKey];
            const priorVal = prior ? (metric === 'revenue' ? prior.revenue : metric === 'optos' ? prior.optos : metric === 'oct' ? prior.oct : prior.patients) : null;
            const pct      = total && priorVal ? ((total - priorVal) / priorVal) * 100 : null;
            return (
              <tr key={wk.week} style={{ background: i % 2 === 0 ? 'white' : '#FAFBFC' }}>
                <td style={{ ...tdStyle, fontWeight: 600, color: '#1E293B' }}>{wk.week}</td>
                {LOC_LIST.map(loc => (
                  <td key={loc} style={{ ...tdStyle, textAlign: 'right' }}>
                    {metric === 'revenue' ? fmt$(getLocVal(wk, loc)) : fmtNum(getLocVal(wk, loc))}
                  </td>
                ))}
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>
                  {metric === 'revenue' ? fmt$(total) : fmtNum(total)}
                </td>
                {prevByWeek && (
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {pct != null ? (
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                        background: pct >= 0 ? '#D1FAE5' : '#FEE2E2',
                        color: pct >= 0 ? '#059669' : '#DC2626',
                      }}>{pct >= 0 ? '+' : ''}{pct.toFixed(0)}%</span>
                    ) : '—'}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ProductionView({ allPatients, filters, onFilterChange, onShowEmployeeReport, allPayments, profiles }) {
  const [weekMetric, setWeekMetric] = useState('revenue');
  const [yoyMetric,  setYoYMetric]  = useState('Revenue');
  const [analyzing, setAnalyzing] = useState(false);
  const [insights, setInsights] = useState(null);
  const [savedInsights, setSavedInsights] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sparkInsights') || '[]'); } catch { return []; }
  });
  const [showEmployeeReport, setShowEmployeeReport] = useState(false);
  const [reportDoctor, setReportDoctor] = useState('');
  const [reportPayments, setReportPayments] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);

  const filtered = useMemo(() => applyFilters(allPatients, filters), [allPatients, filters]);

  // Prior year patients for same-period comparison
  const prevFiltered = useMemo(() => {
    if (filters.year === 'all') return null;
    const prevYear = String(parseInt(filters.year) - 1);
    return applyFilters(allPatients, { ...filters, year: prevYear });
  }, [allPatients, filters]);

  const stats = useMemo(() => computeStats(filtered, prevFiltered), [filtered, prevFiltered]);

  const runAnalysis = async (allPayments) => {
    setAnalyzing(true);
    try {
      // Build summary for AI
      const doctorStats = stats.byDoctor ? Object.entries(stats.byDoctor).map(([id, d]) => ({
        doctor: id,
        daysWorked: d.daysWorked,
        totalRevenue: Math.round(d.totalRevenue),
        avgPerDay: Math.round(d.avgPerDay),
        avgPerPatient: Math.round(d.avgPerPatient),
        optosRate: parseFloat((d.optosRate*100).toFixed(1)),
        octCount: d.oct,
        clCount: d.cl,
      })) : [];

      const locStats = stats.byLocation ? Object.entries(stats.byLocation).map(([loc, d]) => ({
        location: loc,
        totalRevenue: Math.round(d.totalRevenue),
        avgPerDay: Math.round(d.avgPerDay),
        patients: d.patients,
        optosRate: parseFloat((d.optosRate*100).toFixed(1)),
      })) : [];

      const summary = {
        period: `${filters.year || 'all years'} ${filters.location ? '— ' + filters.location : '— all locations'}`,
        totalRevenue: Math.round(stats.totalRevenue),
        totalPatients: stats.totalPatients,
        avgPerDay: Math.round(stats.avgPerDay),
        avgPerPatient: Math.round(stats.avgPerPatient),
        optosRate: parseFloat((stats.optosRate*100).toFixed(1)),
        yoyRevenuePct: stats.prevStats ? parseFloat(((stats.totalRevenue - stats.prevStats.totalRevenue)/stats.prevStats.totalRevenue*100).toFixed(1)) : null,
        payorMix: stats.byPayor ? Object.entries(stats.byPayor).slice(0,8).map(([name,d]) => ({ name, patients: d.count, revenue: Math.round(d.revenue) })) : [],
        doctors: doctorStats,
        locations: locStats,
        incompleteDays: stats.incompleteDays?.length || 0,
      };

      const response = await fetch('https://spark-dashboard-proxy.ilikebroccoli.workers.dev/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1500,
          messages: [{
            role: 'user',
            content: `You are analyzing production data for The Spark Optometry, a 4-location optometry practice (SC=Santa Clara, F=Fremont, WC=Walnut Creek, SV=Sunnyvale).

Here is the current production summary:
${JSON.stringify(summary, null, 2)}

Provide a concise, actionable analysis in this exact JSON format:
{
  "flags": ["..."],
  "opportunities": ["..."],
  "trends": ["..."],
  "wins": ["..."]
}

Each array should have 2-4 bullet points max. Be specific with numbers. Flag any doctor whose avg/day is >20% below practice average. Flag if any location's optos rate is significantly lower than others. Note any payor mix shifts. Suggest specific revenue opportunities with estimated dollar impact. Keep each point under 120 characters. Return ONLY valid JSON.`
          }]
        })
      });

      const data = await response.json();
      const text = data.content?.find(c => c.type === 'text')?.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');
      const result = JSON.parse(jsonMatch[0]);
      const entry = { ...result, date: new Date().toISOString(), period: summary.period };
      setInsights(entry);
      const updated = [entry, ...savedInsights].slice(0, 5);
      setSavedInsights(updated);
      localStorage.setItem('sparkInsights', JSON.stringify(updated));
    } catch(e) {
      console.error(e);
      alert('Analysis failed: ' + e.message);
    }
    setAnalyzing(false);
  };

  if (!stats) return (
    <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>
      <p style={{ fontSize: 16 }}>No data for selected filters.</p>
    </div>
  );

  const prev = stats.prevStats;

  const yoyPct = (curr, p) => p ? ((curr - p) / p) * 100 : null;

  // ── Monthly trend data ────────────────────────────────────────────────────
  const monthlyData = Object.entries(stats.byMonth)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([m, d]) => ({
      name: MONTH_SHORT[parseInt(m)],
      revenue: Math.round(d.revenue),
      patients: d.patients,
      optos: d.optos,
      oct: d.oct,
      myopia: d.myopia,
    }));

  // ── Location data ─────────────────────────────────────────────────────────
  const locationData = LOC_LIST
    .filter(loc => stats.byLocation[loc]?.patients > 0)
    .map(loc => ({
      name: LOC_NAMES[loc], shortName: loc,
      revenue:   Math.round(stats.byLocation[loc].revenue),
      patients:  stats.byLocation[loc].patients,
      openDays:  stats.byLocation[loc].openDays,
      revPerDay: Math.round(stats.byLocation[loc].revPerOpenDay),
      ptsPerDay: parseFloat(stats.byLocation[loc].patientsPerOpenDay.toFixed(1)),
      optosRate: parseFloat((stats.byLocation[loc].optosRate * 100).toFixed(1)),
      octRate:   parseFloat((stats.byLocation[loc].octRate * 100).toFixed(1)),
      clRate:    parseFloat((stats.byLocation[loc].clRate * 100).toFixed(1)),
      avgPerPatient: Math.round(stats.byLocation[loc].avgPerPatient),
    }));

  // ── Doctor data ───────────────────────────────────────────────────────────
  const doctorData = Object.entries(stats.byDoctor)
    .sort(([,a],[,b]) => b.revenue - a.revenue)
    .map(([doc, d]) => ({
      name: doc,
      revenue: Math.round(d.revenue),
      patients: d.patients,
      optos: d.optos,
      oct: d.oct,
      cl: d.cl,
      myopia: d.myopia,
      daysWorked: d.daysWorked,
      avgPerDay: Math.round(d.avgPerDay),
      avgPatientsPerDay: fmtDec(d.avgPatientsPerDay),
      avgPerPatient: Math.round(d.avgPerPatient),
      avgPerRoutine: Math.round(d.avgPerRoutine),
      optosRate: fmtPct(d.optosRate),
      octRate: fmtPct(d.octRate),
    }));

  // ── Day of week ────────────────────────────────────────────────────────────
  const dayData = DAY_ORDER
    .filter(d => stats.byDay[d])
    .map(d => ({
      name: d.slice(0,3),
      fullName: d,
      avgRevenue: Math.round(stats.byDay[d].avgRevenue),
      avgPatients: parseFloat(stats.byDay[d].avgPatients.toFixed(1)),
      occurrences: stats.byDay[d].occurrences,
    }));

  // ── Payor mix ──────────────────────────────────────────────────────────────
  const payorData = Object.entries(stats.payorCounts)
    .sort(([,a],[,b]) => b.count - a.count)
    .map(([name, d]) => ({
      name, value: d.count, revenue: Math.round(d.revenue),
      pct: parseFloat((d.pct * 100).toFixed(1)),
    }));

  const insTotal = payorData.filter(p => p.name !== 'Self Pay').reduce((s, p) => s + p.value, 0);
  const selfTotal = stats.payorCounts['Self Pay']?.count || 0;
  const grandTotal = insTotal + selfTotal;

  // ── Optomap ROI ────────────────────────────────────────────────────────────
  const optomapData = LOC_LIST.map(loc => ({
    name: LOC_NAMES[loc], shortName: loc,
    ...stats.optomapROI[loc],
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      <FilterBar filters={filters} onChange={onFilterChange} />

      {/* ── AI Insights + Employee Report ── */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => runAnalysis([])} disabled={analyzing}
          style={{ background: analyzing ? '#94A3B8' : '#1B3A5C', color: 'white', border: 'none', borderRadius: 8, padding: '9px 20px', cursor: analyzing ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          {analyzing ? '🤖 Analyzing...' : '✨ Analyze'}
        </button>
        {savedInsights.length > 0 && (
          <select onChange={e => { if (e.target.value !== '') setInsights(savedInsights[parseInt(e.target.value)]); }}
            defaultValue=""
            style={{ padding: '7px 10px', border: '1.5px solid #E2E8F0', borderRadius: 7, fontSize: 12, background: 'white' }}>
            <option value="">Past analyses...</option>
            {savedInsights.map((s, i) => <option key={i} value={i}>{new Date(s.date).toLocaleDateString()} — {s.period}</option>)}
          </select>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={reportDoctor} onChange={e => setReportDoctor(e.target.value)}
            style={{ padding: '7px 10px', border: '1.5px solid #E2E8F0', borderRadius: 7, fontSize: 12, background: 'white' }}>
            <option value="">Employee report...</option>
            {Object.entries(stats.byDoctor || {}).filter(([, s]) => s.daysWorked > 0).map(([id]) => (
              <option key={id} value={id}>Dr. {id}</option>
            ))}
          </select>
          <button onClick={async () => {
            if (!reportDoctor) return;
            setLoadingReport(true);
            try {
              // Always fetch fresh from Firebase
              const pays = await loadPayments(reportDoctor);
              setReportPayments({ ...(allPayments||{}), [reportDoctor]: pays });
            } catch(e) {
              setReportPayments(allPayments||{});
            }
            setLoadingReport(false);
            setShowEmployeeReport(true);
          }} disabled={!reportDoctor || loadingReport}
            style={{ background: reportDoctor&&!loadingReport ? '#8B5CF6' : '#94A3B8', color: 'white', border: 'none', borderRadius: 7, padding: '8px 14px', cursor: reportDoctor&&!loadingReport ? 'pointer' : 'default', fontSize: 12, fontWeight: 600 }}>
            {loadingReport ? '...' : 'Generate'}
          </button>
        </div>
        {insights && <button onClick={() => setInsights(null)} style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: 12 }}>✕ Close analysis</button>}
      </div>

      {insights && (
        <div style={{ background: 'white', borderRadius: 14, padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #E2E8F0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 18, color: '#1B3A5C' }}>✨ AI Analysis — {insights.period}</h3>
            <span style={{ fontSize: 11, color: '#94A3B8' }}>{new Date(insights.date).toLocaleString()}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {[
              { key: 'flags', label: '🚨 Flags', bg: '#FFF1F2', border: '#FECDD3', color: '#BE123C' },
              { key: 'opportunities', label: '💡 Opportunities', bg: '#FFFBEB', border: '#FDE68A', color: '#92400E' },
              { key: 'trends', label: '📈 Trends', bg: '#EFF6FF', border: '#BFDBFE', color: '#1D4ED8' },
              { key: 'wins', label: "✅ What's Working", bg: '#F0FDF4', border: '#BBF7D0', color: '#15803D' },
            ].map(({ key, label, bg, border, color }) => (
              insights[key]?.length > 0 && (
                <div key={key} style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '14px 16px' }}>
                  <p style={{ fontWeight: 700, color, fontSize: 13, marginBottom: 10 }}>{label}</p>
                  {insights[key].map((item, i) => (
                    <p key={i} style={{ fontSize: 12, color: '#374151', margin: '0 0 6px 0', lineHeight: 1.5 }}>• {item}</p>
                  ))}
                </div>
              )
            ))}
          </div>
        </div>
      )}



      {showEmployeeReport && reportDoctor && (
        <EmployeeReport
          doctorId={reportDoctor}
          allPatients={allPatients}
          allPayments={reportPayments||allPayments||{}}
          profiles={profiles}
          onClose={() => setShowEmployeeReport(false)}
        />
      )}

      {/* ── Incomplete Days Warning ── */}
      {stats.incompleteDays.length > 0 && (
        <div style={{
          background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 10,
          padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <div>
            <p style={{ fontWeight: 600, color: '#92400E', fontSize: 14, marginBottom: 4 }}>
              {stats.incompleteDays.length} day{stats.incompleteDays.length !== 1 ? 's' : ''} with incomplete billing data
            </p>
            <p style={{ fontSize: 13, color: '#78350F' }}>
              {stats.incompleteDays.slice(0, 5).map(d => `${d.loc} ${d.date}`).join(' · ')}
              {stats.incompleteDays.length > 5 ? ` · +${stats.incompleteDays.length - 5} more` : ''}
            </p>
          </div>
        </div>
      )}

      {/* ── KPIs with hover breakdown ── */}
      <section>
        <SectionHeader title="Overview"
          sub={prev ? `Comparing ${filters.year} vs same period in ${parseInt(filters.year) - 1}` : 'All available data'} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: 12 }}>
          <KpiCard label="Total Patients" value={fmtNum(stats.total)} icon="👁️" color="#2E7D8C"
            fmt={fmtNum}
            byLocation={Object.fromEntries(LOC_LIST.map(l => [l, stats.byLocation[l]?.patients]))}
            sub={prev ? `${yoyPct(stats.total, prev.total) >= 0 ? '+' : ''}${yoyPct(stats.total, prev.total)?.toFixed(1)}% vs prior` : null}
          />
          <KpiCard label="Total Revenue" value={fmt$(stats.totalRevenue)} icon="💰" color="#C9A84C"
            fmt={fmt$}
            byLocation={Object.fromEntries(LOC_LIST.map(l => [l, stats.byLocation[l]?.revenue]))}
            sub={prev ? `${yoyPct(stats.totalRevenue, prev.totalRevenue) >= 0 ? '+' : ''}${yoyPct(stats.totalRevenue, prev.totalRevenue)?.toFixed(1)}% vs prior` : null}
          />
          <KpiCard label="Avg / Patient" value={fmt$(stats.avgRevenuePerPatient)} icon="🧾" color="#1B3A5C"
            fmt={fmt$}
            byLocation={Object.fromEntries(LOC_LIST.map(l => [l, stats.byLocation[l]?.avgPerPatient]))}
          />
          <KpiCard label="Avg Rev / Day" value={fmt$(stats.avgRevenuePerDay)} icon="📅" color="#8B5CF6"
            fmt={fmt$}
            byLocation={Object.fromEntries(LOC_LIST.map(l => [l, stats.byLocation[l]?.revPerOpenDay]))}
          />
          <KpiCard label="Avg Pts / Day" value={fmtDec(stats.avgPatientsPerDay)} icon="🗓️" color="#10B981"
            fmt={v => fmtDec(v)}
            byLocation={Object.fromEntries(LOC_LIST.map(l => [l, stats.byLocation[l]?.patientsPerOpenDay]))}
          />
          <KpiCard label="Optos" value={fmtNum(stats.optos)} icon="🔬" color="#2E7D8C"
            fmt={fmtNum}
            byLocation={Object.fromEntries(LOC_LIST.map(l => [l, stats.byLocation[l]?.optos]))}
            sub={fmtPct(stats.optos / stats.total) + ' of visits'}
          />
          <KpiCard label="OCT" value={fmtNum(stats.oct)} icon="🫁" color="#3A9BAD"
            fmt={fmtNum}
            byLocation={Object.fromEntries(LOC_LIST.map(l => [l, stats.byLocation[l]?.oct]))}
            sub={fmtPct(stats.oct / stats.total) + ' of visits'}
          />
          <KpiCard label="CL Exams" value={fmtNum(stats.cl)} icon="👓" color="#F59E0B"
            fmt={fmtNum}
            byLocation={Object.fromEntries(LOC_LIST.map(l => [l, stats.byLocation[l]?.cl]))}
            sub={fmtPct(stats.cl / stats.total) + ' of visits'}
          />
          <KpiCard label="Myopia Control" value={fmtNum(stats.myopiaCount)} icon="🎯" color="#EF4444"
            fmt={fmtNum}
            byLocation={Object.fromEntries(LOC_LIST.map(l => [l, stats.byLocation[l]?.myopia]))}
            sub={fmt$(stats.myopiaRevenue) + ' revenue'}
          />
        </div>
      </section>

      {/* ── Monthly Trends ── */}
      <section>
        <SectionHeader title="Monthly Trends" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <ChartCard title="Revenue by Month" height={200}>
            <SimpleAreaChart data={monthlyData} dataKey="revenue" nameKey="name" color="#2E7D8C" fmt={fmt$} height={180} />
          </ChartCard>
          <ChartCard title="Patients by Month" height={200}>
            <SimpleAreaChart data={monthlyData} dataKey="patients" nameKey="name" color="#1B3A5C" height={180} />
          </ChartCard>
          <ChartCard title="Optos by Month" height={200}>
            <SimpleBarChart data={monthlyData} dataKey="optos" nameKey="name" color="#2E7D8C" height={180} />
          </ChartCard>
          <ChartCard title="OCT by Month" height={200}>
            <SimpleBarChart data={monthlyData} dataKey="oct" nameKey="name" color="#3A9BAD" height={180} />
          </ChartCard>
        </div>
      </section>

      {/* ── YoY Comparison Table ── */}
      {prev && (
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <SectionHeader title={`${filters.year} vs ${parseInt(filters.year) - 1} (same period)`} />
            <div style={{ display: 'flex', gap: 6 }}>
              {['Revenue','Patients','Optos','OCT'].map(m => (
                <button key={m} onClick={() => setYoYMetric(m)} style={{
                  padding: '5px 12px', borderRadius: 16, fontSize: 12, fontWeight: 500,
                  border: '1.5px solid', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                  borderColor: yoyMetric === m ? '#2E7D8C' : '#E2E8F0',
                  background: yoyMetric === m ? '#2E7D8C' : 'white',
                  color: yoyMetric === m ? 'white' : '#475569',
                }}>{m}</button>
              ))}
            </div>
          </div>
          <div style={{ background: 'white', borderRadius: 14, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <YoYTable byMonth={stats.byMonth} prevByMonth={prev.byMonth} label={yoyMetric} />
          </div>
        </section>
      )}

      {/* ── Weekly Table ── */}
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <SectionHeader title="Weekly Breakdown by Location" />
          <div style={{ display: 'flex', gap: 6 }}>
            {['revenue','patients','optos','oct'].map(m => (
              <button key={m} onClick={() => setWeekMetric(m)} style={{
                padding: '5px 12px', borderRadius: 16, fontSize: 12, fontWeight: 500,
                border: '1.5px solid', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                borderColor: weekMetric === m ? '#2E7D8C' : '#E2E8F0',
                background: weekMetric === m ? '#2E7D8C' : 'white',
                color: weekMetric === m ? 'white' : '#475569',
                textTransform: 'capitalize',
              }}>{m}</button>
            ))}
          </div>
        </div>
        <div style={{ background: 'white', borderRadius: 14, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <WeeklyTable
            byWeek={stats.byWeek}
            prevByWeek={prev?.byWeek}
            metric={weekMetric}
          />
        </div>
      </section>

      {/* ── By Location ── */}
      <section>
        <SectionHeader title="By Location" sub="Normalized by open days to account for different schedules" />
        <div style={{ background: 'white', borderRadius: 14, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: 14 }}>
          <DataTable
            columns={[
              { key: 'name', label: 'Location' },
              { key: 'openDays', label: 'Open Days', right: true },
              { key: 'patients', label: 'Patients', right: true },
              { key: 'ptsPerDay', label: 'Pts/Day', right: true },
              { key: 'revenue', label: 'Revenue', right: true, render: r => fmt$(r.revenue) },
              { key: 'revPerDay', label: 'Rev/Day', right: true, render: r => fmt$(r.revPerDay) },
              { key: 'avgPerPatient', label: 'Avg/Pt', right: true, render: r => fmt$(r.avgPerPatient) },
              { key: 'optosRate', label: 'Optos %', right: true, render: r => `${r.optosRate}%` },
              { key: 'octRate', label: 'OCT %', right: true, render: r => `${r.octRate}%` },
              { key: 'clRate', label: 'CL %', right: true, render: r => `${r.clRate}%` },
            ]}
            rows={locationData}
          />
        </div>
      </section>

      {/* ── Day of Week ── */}
      <section>
        <SectionHeader title="Day of Week" sub="Avg per location-day (normalizes for days some locations are closed)" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <ChartCard title="Avg Revenue per Location-Day — hover for location breakdown" height={200}>
            <DayOfWeekLocationChart data={dayData} dataKey="avgRevenue" fmt={fmt$} color="#2E7D8C" height={180} filtered={filtered} />
          </ChartCard>
          <ChartCard title="Avg Patients per Location-Day" height={200}>
            <SimpleBarChart data={dayData} dataKey="avgPatients" nameKey="name" color="#1B3A5C" height={180} />
          </ChartCard>
        </div>
        <div style={{ background: 'white', borderRadius: 14, padding: '12px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginTop: 14 }}>
          <DataTable
            columns={[
              { key: 'fullName', label: 'Day' },
              { key: 'occurrences', label: 'Location-Days', right: true },
              { key: 'avgRevenue', label: 'Avg Revenue', right: true, render: r => fmt$(r.avgRevenue) },
              { key: 'avgPatients', label: 'Avg Patients', right: true },
            ]}
            rows={dayData}
          />
        </div>
      </section>

      {/* ── Doctor Production ── */}
      <section>
        <SectionHeader title="Doctor Production" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <ChartCard title="Total Revenue by Doctor" height={280}>
            <AllLabelBarChart data={doctorData} dataKey="revenue" fmt={fmt$} color="#2E7D8C" />
          </ChartCard>
          <ChartCard title="Avg Revenue per Day" height={280}>
            <AllLabelBarChart data={doctorData} dataKey="avgPerDay" fmt={fmt$} color="#1B3A5C" />
          </ChartCard>
        </div>
        <div style={{ background: 'white', borderRadius: 14, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <DataTable
            columns={[
              { key: 'name', label: 'Doctor' },
              { key: 'patients', label: 'Patients', right: true },
              { key: 'daysWorked', label: 'Days', right: true },
              { key: 'avgPatientsPerDay', label: 'Pts/Day', right: true },
              { key: 'revenue', label: 'Revenue', right: true, render: r => fmt$(r.revenue) },
              { key: 'avgPerDay', label: 'Avg/Day', right: true, render: r => fmt$(r.avgPerDay) },
              { key: 'avgPerPatient', label: 'Avg/Pt', right: true, render: r => fmt$(r.avgPerPatient) },
              { key: 'avgPerRoutine', label: 'Avg/Routine', right: true, render: r => fmt$(r.avgPerRoutine) },
              { key: 'optosRate', label: 'Optos %', right: true },
              { key: 'octRate', label: 'OCT %', right: true },
              { key: 'cl', label: 'CL Exams', right: true },
              { key: 'myopia', label: 'Myopia', right: true },
            ]}
            rows={doctorData}
          />
        </div>
      </section>

      {/* ── Optomap ROI ── */}
      <section>
        <SectionHeader title="Optomap Analysis" sub="Est. revenue based on 15% of avg visit revenue per optos patient" />
        <ChartCard title="Optos by Location — Monthly" height={240} style={{ marginBottom: 14 }}>
          <GroupedLocBarChart filtered={filtered} dataKey="optos" height={220} />
        </ChartCard>
        <OptomapExpandableTable data={optomapData} />
        <ChartCard title="OCT by Location — Monthly" height={240}>
          <GroupedLocBarChart filtered={filtered} dataKey="oct" height={220} />
        </ChartCard>
      </section>

      {/* ── Myopia Control ── */}
      {stats.myopiaCount > 0 && (
        <section>
          <SectionHeader title="Myopia Control" sub={`${stats.myopiaCount} patients · ${fmt$(stats.myopiaRevenue)} total`} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            <ChartCard title="By Therapy Type" height={220}>
              <MyopiaLegendPie
                data={Object.entries(stats.myopiaByType).map(([name, d]) => ({ name: name.replace(' (New)',' (New)').replace(' (Return)',' (Ret)'), value: d.count }))}
              />
            </ChartCard>
            <ChartCard title="Revenue by Type" height={200}>
              <SimpleBarChart
                data={Object.entries(stats.myopiaByType).map(([name, d]) => ({ name: name.replace(' (New)','★').replace(' (Return)','↩'), value: d.revenue }))}
                dataKey="value" nameKey="name" color="#EF4444" fmt={fmt$} height={180} horizontal
              />
            </ChartCard>
            <ChartCard title="Myopia Patients by Month" height={200}>
              <SimpleBarChart data={monthlyData.filter(d => d.myopia > 0)} dataKey="myopia" nameKey="name" color="#F59E0B" height={180} />
            </ChartCard>
          </div>
        </section>
      )}

      {/* ── Payor Mix ── */}
      <section>
        <SectionHeader title="Payor Mix" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14 }}>
          {/* Summary cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ background: 'white', borderRadius: 12, padding: '14px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', borderTop: '3px solid #2E7D8C' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Insurance</p>
              <p style={{ fontSize: 26, fontWeight: 700, color: '#1E293B', fontFamily: "'DM Serif Display', serif" }}>{fmtPct(insTotal / grandTotal)}</p>
              <p style={{ fontSize: 12, color: '#64748B' }}>{fmtNum(insTotal)} patients</p>
            </div>
            <div style={{ background: 'white', borderRadius: 12, padding: '14px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', borderTop: '3px solid #C9A84C' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Self Pay</p>
              <p style={{ fontSize: 26, fontWeight: 700, color: '#1E293B', fontFamily: "'DM Serif Display', serif" }}>{fmtPct(selfTotal / grandTotal)}</p>
              <p style={{ fontSize: 12, color: '#64748B' }}>{fmtNum(selfTotal)} patients</p>
            </div>
          </div>
          <PayorHoverTable payorData={payorData} filtered={filtered} grandTotal={grandTotal} />
        </div>
      </section>

      {/* ── Incomplete Days Detail ── */}
      {stats.incompleteDays.length > 0 && (
        <section>
          <SectionHeader title="Incomplete Billing Days" sub="Days where >50% of patients have no cash or insurance payment recorded" />
          <div style={{ background: 'white', borderRadius: 14, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <DataTable
              columns={[
                { key: 'date', label: 'Date' },
                { key: 'loc', label: 'Location' },
                { key: 'doctor', label: 'Doctor' },
                { key: 'total', label: 'Total Patients', right: true },
                { key: 'unknown', label: 'Missing Billing', right: true },
                { key: 'unknown', label: '% Incomplete', right: true, render: r => fmtPct(r.unknown / r.total) },
              ]}
              rows={stats.incompleteDays}
              maxRows={30}
            />
          </div>
        </section>
      )}

    </div>
  );
}

// Bar chart where every bar is labeled (no skipping)


// ── Grouped bar chart — 4 locations per month ─────────────────────────────
const LOC_CHART_COLORS = { SC: '#2E7D8C', F: '#1B3A5C', WC: '#C9A84C', SV: '#10B981' };
const LOC_FULL_NAMES = { SC: 'Santa Clara', F: 'Fremont', WC: 'Walnut Creek', SV: 'Sunnyvale' };

function GroupedLocBarChart({ filtered, dataKey, height = 240 }) {
  const { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } = require('recharts');

  const data = useMemo(() => {
    const byMonth = {};
    for (const p of (filtered || [])) {
      if (!p.month) continue;
      if (!byMonth[p.month]) byMonth[p.month] = { month: p.month, SC: 0, F: 0, WC: 0, SV: 0 };
      if (p.loc in byMonth[p.month]) byMonth[p.month][p.loc] += (p[dataKey] ? 1 : 0);
    }
    return Object.values(byMonth).sort((a, b) => a.month - b.month).map(d => ({
      ...d, name: MONTH_SHORT[d.month]
    }));
  }, [filtered, dataKey]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 4 }} barGap={2} barCategoryGap="25%">
        <CartesianGrid strokeDasharray="3 3" stroke="#F0F4F8" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12 }}
          formatter={(value, name) => [value, LOC_FULL_NAMES[name] || name]}
        />
        <Legend formatter={(value) => LOC_FULL_NAMES[value] || value} wrapperStyle={{ fontSize: 11 }} />
        {['SC','F','WC','SV'].map(loc => (
          <Bar key={loc} dataKey={loc} fill={LOC_CHART_COLORS[loc]} radius={[3,3,0,0]} maxBarSize={18} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}


// ── Optomap expandable table ───────────────────────────────────────────────
function OptomapExpandableTable({ data }) {
  const [expanded, setExpanded] = useState({});
  const toggle = (name) => setExpanded(e => ({ ...e, [name]: !e[name] }));
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const thS = { padding: '8px 12px', fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '2px solid #F0F4F8', whiteSpace: 'nowrap' };
  const tdS = (right) => ({ padding: '9px 12px', textAlign: right ? 'right' : 'left', borderBottom: '1px solid #F0F4F8', fontSize: 13, color: '#475569' });

  return (
    <div style={{ background: 'white', borderRadius: 14, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: 14, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...thS, textAlign: 'left' }}>Location</th>
            <th style={{ ...thS, textAlign: 'right' }}>Total Optos</th>
            <th style={{ ...thS, textAlign: 'right' }}>Optos/Month</th>
            <th style={{ ...thS, textAlign: 'right' }}>Monthly Cost</th>
            <th style={{ ...thS, textAlign: 'right' }}>Est. Revenue</th>
            <th style={{ ...thS, textAlign: 'right' }}>Est. Net ROI</th>
            <th style={{ ...thS, textAlign: 'right' }}>Break-even/Mo</th>
            <th style={{ ...thS }}></th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <React.Fragment key={r.name}>
              <tr style={{ background: i % 2 === 0 ? 'white' : '#FAFBFC' }}>
                <td style={{ ...tdS(false), fontWeight: 600, color: '#1E293B' }}>{r.name}</td>
                <td style={tdS(true)}>{r.optosCount}</td>
                <td style={tdS(true)}>{r.avgPerMonth}</td>
                <td style={tdS(true)}>{fmt$(r.monthlyCost)}</td>
                <td style={tdS(true)}>{fmt$(r.estOptosRevenue)}</td>
                <td style={tdS(true)}>
                  <span style={{ color: r.netROI >= 0 ? '#059669' : '#DC2626', fontWeight: 600 }}>{fmt$(r.netROI)}</span>
                </td>
                <td style={tdS(true)}>{r.breakEvenPerMonth} optos</td>
                <td style={{ ...tdS(false) }}>
                  {r.monthlyOptosArr?.length > 0 && (
                    <button onClick={() => toggle(r.name)} style={{ background: '#F1F5F9', border: 'none', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', fontSize: 11, color: '#475569', fontWeight: 600 }}>
                      {expanded[r.name] ? '▲ Hide' : '▼ By Month'}
                    </button>
                  )}
                </td>
              </tr>
              {expanded[r.name] && r.monthlyOptosArr?.length > 0 && (
                <tr key={r.name + '_exp'}>
                  <td colSpan={8} style={{ padding: '0 12px 12px 32px', background: '#F8FAFC', borderBottom: '1px solid #F0F4F8' }}>
                    <table style={{ borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
                      <thead>
                        <tr>
                          {['Month','Optos','Est. Revenue','Est. Net ROI'].map(h => (
                            <th key={h} style={{ padding: '5px 12px', textAlign: h === 'Month' ? 'left' : 'right', fontSize: 10, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', borderBottom: '1px solid #E2E8F0' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {r.monthlyOptosArr.map(m => (
                          <tr key={m.month}>
                            <td style={{ padding: '5px 12px', color: '#475569' }}>{MONTH_NAMES[m.month - 1]}</td>
                            <td style={{ padding: '5px 12px', textAlign: 'right' }}>{m.optos}</td>
                            <td style={{ padding: '5px 12px', textAlign: 'right', color: '#059669' }}>{fmt$(m.estRev)}</td>
                            <td style={{ padding: '5px 12px', textAlign: 'right' }}>
                              <span style={{ color: m.netROI >= 0 ? '#059669' : '#DC2626', fontWeight: 600 }}>{fmt$(m.netROI)}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Payor table with per-location hover ────────────────────────────────────
function PayorHoverTable({ payorData, filtered, grandTotal }) {
  const [hoveredRow, setHoveredRow] = useState(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const LOC_FULL = { SC: 'Santa Clara', F: 'Fremont', WC: 'Walnut Creek', SV: 'Sunnyvale' };
  const LOC_COLORS = { SC: '#2E7D8C', F: '#1B3A5C', WC: '#C9A84C', SV: '#10B981' };

  // Pre-compute per-payor per-location breakdown
  const locBreakdown = useMemo(() => {
    const result = {};
    for (const row of payorData) {
      result[row.name] = ['SC','F','WC','SV'].map(loc => {
        const lp = (filtered || []).filter(p => p.payor === row.name && p.loc === loc);
        return { loc, count: lp.length, revenue: lp.reduce((s,p) => s + p.total, 0) };
      }).filter(d => d.count > 0);
    }
    return result;
  }, [payorData, filtered]);

  const thS = { padding: '8px 12px', fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '2px solid #F0F4F8', whiteSpace: 'nowrap' };
  const tdS = (right) => ({ padding: '9px 12px', textAlign: right ? 'right' : 'left', borderBottom: '1px solid #F0F4F8', fontSize: 13, color: '#475569' });

  return (
    <div style={{ background: 'white', borderRadius: 14, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', position: 'relative', overflowX: 'auto' }}
      onMouseLeave={() => setHoveredRow(null)}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...thS, textAlign: 'left' }}>Payor</th>
            <th style={{ ...thS, textAlign: 'right' }}>Patients</th>
            <th style={{ ...thS, textAlign: 'right' }}>% of Total</th>
            <th style={{ ...thS, textAlign: 'right' }}>Revenue</th>
            <th style={{ ...thS, textAlign: 'right' }}>% of Revenue</th>
          </tr>
        </thead>
        <tbody>
          {payorData.map((row, i) => (
            <tr key={row.name}
              style={{ background: hoveredRow === row.name ? '#EFF6FF' : i % 2 === 0 ? 'white' : '#FAFBFC', cursor: 'default', transition: 'background 0.1s' }}
              onMouseEnter={(e) => { setHoveredRow(row.name); setHoverPos({ x: e.clientX, y: e.clientY }); }}
              onMouseMove={(e) => setHoverPos({ x: e.clientX, y: e.clientY })}>
              <td style={{ ...tdS(false), fontWeight: 600, color: '#1E293B' }}>{row.name}</td>
              <td style={tdS(true)}>{row.value}</td>
              <td style={tdS(true)}>{row.pct}%</td>
              <td style={tdS(true)}>{fmt$(row.revenue)}</td>
              <td style={tdS(true)}>{grandTotal > 0 ? fmtPct(row.revenue / payorData.reduce((s,r)=>s+r.revenue,0)) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {hoveredRow && locBreakdown[hoveredRow]?.length > 0 && (
        <div style={{ position: 'fixed', left: hoverPos.x + 14, top: hoverPos.y - 10, background: 'white', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', fontSize: 12, zIndex: 200, pointerEvents: 'none', minWidth: 200 }}>
          <p style={{ fontWeight: 700, color: '#1E293B', marginBottom: 8 }}>{hoveredRow}</p>
          {locBreakdown[hoveredRow].map(d => (
            <div key={d.loc} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 5, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: LOC_COLORS[d.loc] || '#94A3B8', flexShrink: 0 }} />
                <span style={{ color: '#475569' }}>{LOC_FULL[d.loc] || d.loc}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontWeight: 600, color: '#1E293B' }}>{d.count} pts</span>
                <span style={{ color: '#94A3B8', marginLeft: 8 }}>{fmt$(d.revenue)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Myopia pie with legend at bottom ──────────────────────────────────────
function MyopiaLegendPie({ data }) {
  const { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } = require('recharts');
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name"
          cx="50%" cy="42%" outerRadius={65} innerRadius={30} paddingAngle={2}
        >
          {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v, name) => [`${v} patients`, name]} />
        <Legend
          iconSize={8} iconType="circle"
          wrapperStyle={{ fontSize: 11, lineHeight: '20px', paddingTop: 6 }}
          formatter={(value) => <span style={{ color: '#475569' }}>{value}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Day of week bar chart with per-location hover tooltip ─────────────────
function DayOfWeekLocationChart({ data, dataKey, fmt: fmtFn, color, height, filtered }) {
  const { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell } = require('recharts');
  const [tooltip, setTooltip] = useState(null);
  const fmtVal = fmtFn || (v => v);
  const LOC_COLORS_MAP = { SC: '#2E7D8C', F: '#1B3A5C', WC: '#C9A84C', SV: '#10B981' };
  const LOC_FULL = { SC: 'Santa Clara', F: 'Fremont', WC: 'Walnut Creek', SV: 'Sunnyvale' };

  // Build per-location breakdown for each day
  const locByDay = {};
  if (filtered) {
    for (const p of filtered) {
      const day = p.dayOfWeek?.slice(0, 3);
      if (!day) continue;
      if (!locByDay[day]) locByDay[day] = {};
      if (!locByDay[day][p.loc]) locByDay[day][p.loc] = { revenue: 0, count: 0, days: new Set() };
      locByDay[day][p.loc].revenue += p.total;
      locByDay[day][p.loc].count++;
      locByDay[day][p.loc].days.add(p.date);
    }
  }

  return (
    <div style={{ position: 'relative', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}
          onMouseLeave={() => setTooltip(null)}>
          <CartesianGrid strokeDasharray="3 3" stroke="#F0F4F8" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={fmtVal} tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} width={48} />
          <Bar dataKey={dataKey} fill={color} radius={[4,4,0,0]} maxBarSize={40}
            onMouseEnter={(entry, index, e) => {
              const dayName = entry.name;
              const locData = locByDay[dayName] || {};
              setTooltip({ day: data.find(d=>d.name===dayName)?.fullName || dayName, locData, x: e?.clientX, y: e?.clientY });
            }}
          />
        </BarChart>
      </ResponsiveContainer>
      {tooltip && (
        <div style={{ position: 'fixed', left: (tooltip.x || 0) + 12, top: (tooltip.y || 0) - 10, background: 'white', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', fontSize: 12, zIndex: 100, pointerEvents: 'none', minWidth: 180 }}>
          <p style={{ fontWeight: 700, color: '#1E293B', marginBottom: 8 }}>{tooltip.day}</p>
          {Object.entries(tooltip.locData).sort(([,a],[,b]) => b.revenue-a.revenue).map(([loc, d]) => (
            <div key={loc} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: LOC_COLORS_MAP[loc] || '#94A3B8', flexShrink: 0 }} />
                <span style={{ color: '#475569' }}>{LOC_FULL[loc] || loc}</span>
              </div>
              <span style={{ fontWeight: 600, color: '#1E293B' }}>{fmtVal(d.days.size ? Math.round(d.revenue / d.days.size) : 0)}</span>
            </div>
          ))}
          {Object.keys(tooltip.locData).length === 0 && <p style={{ color: '#94A3B8' }}>No data</p>}
        </div>
      )}
    </div>
  );
}

function AllLabelBarChart({ data, dataKey, fmt: fmtFn, color = '#2E7D8C' }) {
  const { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LabelList } = require('recharts');
  const fmtVal = fmtFn || (v => v);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 48, top: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F0F4F8" horizontal={false} />
        <XAxis type="number" tickFormatter={fmtVal} tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#1E293B' }} axisLine={false} tickLine={false} width={60} />
        <Tooltip formatter={(v) => [fmtVal(v), '']} cursor={{ fill: '#F0F4F8' }} />
        <Bar dataKey={dataKey} fill={color} radius={[0, 4, 4, 0]} maxBarSize={22}>
          <LabelList dataKey={dataKey} position="right" formatter={fmtVal} style={{ fontSize: 11, fill: '#475569', fontWeight: 600 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
