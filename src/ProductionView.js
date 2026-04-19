import React, { useMemo } from 'react';
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

export default function ProductionView({ allPatients, filters, onFilterChange }) {
  const filtered = useMemo(() => applyFilters(allPatients, filters), [allPatients, filters]);
  const stats = useMemo(() => computeStats(filtered), [filtered]);

  // YoY comparison
  const prev = useMemo(() => {
    const prevYear = filters.year === 'all' ? null : String(parseInt(filters.year) - 1);
    if (!prevYear) return null;
    const prevFiltered = applyFilters(allPatients, { ...filters, year: prevYear });
    return computeStats(prevFiltered);
  }, [allPatients, filters]);

  if (!stats) return (
    <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>
      <p style={{ fontSize: 16 }}>No data for selected filters.</p>
    </div>
  );

  const yoyPct = (curr, p) => {
    if (!p) return null;
    return ((curr - p) / p) * 100;
  };

  // ── Monthly trend data ─────────────────────────────────────────────────
  const monthlyData = Object.entries(stats.byMonth)
    .sort(([a], [b]) => a - b)
    .map(([m, d]) => ({
      name: MONTH_SHORT[parseInt(m)],
      revenue: Math.round(d.revenue),
      patients: d.patients,
      optos: d.optos,
      myopia: d.myopia,
    }));

  // YoY monthly overlay
  const monthlyYoY = monthlyData.map(row => {
    const mNum = MONTH_SHORT.indexOf(row.name);
    const prevMonth = prev?.byMonth?.[mNum];
    return {
      ...row,
      prevRevenue: prevMonth ? Math.round(prevMonth.revenue) : null,
      prevPatients: prevMonth ? prevMonth.patients : null,
    };
  });

  // ── Location comparison ────────────────────────────────────────────────
  const locationData = LOC_LIST
    .filter(loc => stats.byLocation[loc]?.patients > 0)
    .map(loc => ({
      name: LOC_NAMES[loc],
      shortName: loc,
      revenue: Math.round(stats.byLocation[loc].revenue),
      patients: stats.byLocation[loc].patients,
      optos: stats.byLocation[loc].optos,
      cl: stats.byLocation[loc].cl,
      myopia: stats.byLocation[loc].myopia,
      avgPerPatient: stats.byLocation[loc].patients
        ? Math.round(stats.byLocation[loc].revenue / stats.byLocation[loc].patients) : 0,
    }));

  // ── Doctor data ────────────────────────────────────────────────────────
  const doctorData = Object.entries(stats.byDoctor)
    .sort(([,a],[,b]) => b.revenue - a.revenue)
    .map(([doc, d]) => ({
      name: doc,
      revenue: Math.round(d.revenue),
      patients: d.patients,
      optos: d.optos,
      cl: d.cl,
      myopia: d.myopia,
      daysWorked: d.daysWorked,
      avgPerDay: Math.round(d.avgPerDay),
      avgPatientsPerDay: fmtDec(d.avgPatientsPerDay),
      optosRate: fmtPct(d.optosRate),
      myopiaRev: Math.round(d.myopiaRevenue),
    }));

  // ── Day of week ────────────────────────────────────────────────────────
  const dayData = DAY_ORDER
    .filter(d => stats.byDay[d])
    .map(d => ({
      name: d.slice(0, 3),
      fullName: d,
      avgRevenue: Math.round(stats.byDay[d].avgRevenue),
      avgPatients: parseFloat(stats.byDay[d].avgPatients.toFixed(1)),
      occurrences: stats.byDay[d].occurrences,
    }));

  // ── Payor mix ─────────────────────────────────────────────────────────
  const payorData = Object.entries(stats.payorCounts)
    .sort(([,a],[,b]) => b.count - a.count)
    .slice(0, 8)
    .map(([name, d]) => ({ name, value: d.count, revenue: d.revenue }));

  const insVsSelf = [
    { name: 'Insurance', value: Object.entries(stats.payorCounts).filter(([k]) => k !== 'Self Pay').reduce((s,[,v]) => s + v.count, 0) },
    { name: 'Self Pay', value: stats.payorCounts['Self Pay']?.count || 0 },
  ];

  // ── Myopia breakdown ──────────────────────────────────────────────────
  const myopiaData = Object.entries(stats.myopiaByType)
    .sort(([,a],[,b]) => b.count - a.count)
    .map(([name, d]) => ({ name, value: d.count, revenue: d.revenue }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* Filters */}
      <FilterBar filters={filters} onChange={onFilterChange} />

      {/* ── Top KPIs ── */}
      <section>
        <SectionHeader title="Overview" sub={filters.year !== 'all' ? `${filters.year} production data` : 'All available data'} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14 }}>
          <StatCard label="Total Patients" value={fmtNum(stats.total)} icon="👁️"
            trend={prev ? yoyPct(stats.total, prev.total) : null}
            sub={prev ? `vs ${fmtNum(prev.total)} prior year` : null} />
          <StatCard label="Total Revenue" value={fmt$(stats.totalRevenue)} icon="💰" color="#C9A84C"
            trend={prev ? yoyPct(stats.totalRevenue, prev.totalRevenue) : null}
            sub={prev ? `vs ${fmt$(prev.totalRevenue)} prior` : null} />
          <StatCard label="Avg / Patient" value={fmt$(stats.avgRevenuePerPatient)} icon="🧾" color="#1B3A5C"
            trend={prev ? yoyPct(stats.avgRevenuePerPatient, prev.avgRevenuePerPatient) : null} />
          <StatCard label="Avg / Day" value={fmt$(stats.avgRevenuePerDay)} icon="📅" color="#8B5CF6" />
          <StatCard label="Avg Pts / Day" value={fmtDec(stats.avgPatientsPerDay)} icon="🗓️" color="#10B981" />
          <StatCard label="Optos" value={fmtNum(stats.optos)}
            sub={`${fmtPct(stats.optos / stats.total)} of visits`} icon="🔬" color="#2E7D8C" />
          <StatCard label="CL Exams" value={fmtNum(stats.cl)}
            sub={`${fmtPct(stats.cl / stats.total)} of visits`} icon="👓" color="#F59E0B" />
          <StatCard label="Myopia Control" value={fmtNum(stats.myopiaCount)}
            sub={fmt$(stats.myopiaRevenue) + ' revenue'} icon="🎯" color="#EF4444" />
        </div>
      </section>

      {/* ── Monthly Trends ── */}
      <section>
        <SectionHeader title="Monthly Trends" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <ChartCard title="Revenue by Month" height={240}>
            <SimpleAreaChart data={monthlyData} dataKey="revenue" nameKey="name"
              color="#2E7D8C" fmt={fmt$} height={220} />
          </ChartCard>
          <ChartCard title="Patients by Month" height={240}>
            <SimpleAreaChart data={monthlyData} dataKey="patients" nameKey="name"
              color="#1B3A5C" height={220} />
          </ChartCard>
          {prev && (
            <ChartCard title="Revenue: This Year vs Prior Year" height={240} style={{ gridColumn: 'span 2' }}>
              <MultiBarChart
                data={monthlyYoY}
                bars={[
                  { key: 'revenue', label: String(filters.year), color: '#2E7D8C' },
                  { key: 'prevRevenue', label: String(parseInt(filters.year) - 1), color: '#CBD5E1' },
                ]}
                nameKey="name" fmt={fmt$} height={220}
              />
            </ChartCard>
          )}
        </div>
      </section>

      {/* ── By Location ── */}
      <section>
        <SectionHeader title="By Location" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 16 }}>
          {LOC_LIST.filter(loc => stats.byLocation[loc]?.patients > 0).map(loc => (
            <StatCard key={loc} label={LOC_NAMES[loc]} small
              value={fmt$(stats.byLocation[loc].revenue)}
              sub={`${fmtNum(stats.byLocation[loc].patients)} patients`}
              color={LOC_COLORS[loc]} />
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <ChartCard title="Revenue by Location" height={240}>
            <SimpleBarChart data={locationData} dataKey="revenue" nameKey="shortName"
              color="#2E7D8C" fmt={fmt$} height={220} />
          </ChartCard>
          <ChartCard title="Avg Revenue per Patient by Location" height={240}>
            <SimpleBarChart data={locationData} dataKey="avgPerPatient" nameKey="shortName"
              color="#1B3A5C" fmt={fmt$} height={220} />
          </ChartCard>
          <ChartCard title="Optos by Location" height={240}>
            <SimpleBarChart data={locationData} dataKey="optos" nameKey="shortName"
              color="#C9A84C" height={220} />
          </ChartCard>
          <ChartCard title="CL Exams by Location" height={240}>
            <SimpleBarChart data={locationData} dataKey="cl" nameKey="shortName"
              color="#8B5CF6" height={220} />
          </ChartCard>
        </div>
      </section>

      {/* ── Day of Week ── */}
      <section>
        <SectionHeader title="Day of Week Analysis" sub="Average performance per day type" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <ChartCard title="Avg Revenue per Day of Week" height={240}>
            <SimpleBarChart data={dayData} dataKey="avgRevenue" nameKey="name"
              color="#2E7D8C" fmt={fmt$} height={220} />
          </ChartCard>
          <ChartCard title="Avg Patients per Day of Week" height={240}>
            <SimpleBarChart data={dayData} dataKey="avgPatients" nameKey="name"
              color="#1B3A5C" height={220} />
          </ChartCard>
        </div>
      </section>

      {/* ── By Doctor ── */}
      <section>
        <SectionHeader title="Doctor Production" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <ChartCard title="Total Revenue by Doctor" height={300}>
            <SimpleBarChart data={doctorData} dataKey="revenue" nameKey="name"
              color="#2E7D8C" fmt={fmt$} height={280} horizontal />
          </ChartCard>
          <ChartCard title="Avg Revenue per Day by Doctor" height={300}>
            <SimpleBarChart data={doctorData} dataKey="avgPerDay" nameKey="name"
              color="#1B3A5C" fmt={fmt$} height={280} horizontal />
          </ChartCard>
        </div>
        <ChartCard title="Doctor Detail Table">
          <DataTable
            columns={[
              { key: 'name', label: 'Doctor' },
              { key: 'patients', label: 'Patients', right: true },
              { key: 'daysWorked', label: 'Days', right: true },
              { key: 'avgPatientsPerDay', label: 'Pts/Day', right: true },
              { key: 'revenue', label: 'Revenue', right: true, render: r => fmt$(r.revenue) },
              { key: 'avgPerDay', label: 'Avg/Day', right: true, render: r => fmt$(r.avgPerDay) },
              { key: 'optos', label: 'Optos', right: true },
              { key: 'optosRate', label: 'Optos %', right: true },
              { key: 'cl', label: 'CL Exams', right: true },
              { key: 'myopia', label: 'Myopia Pts', right: true },
              { key: 'myopiaRev', label: 'Myopia Rev', right: true, render: r => fmt$(r.myopiaRev) },
            ]}
            rows={doctorData}
          />
        </ChartCard>
      </section>

      {/* ── Myopia Control ── */}
      {stats.myopiaCount > 0 && (
        <section>
          <SectionHeader title="Myopia Control" sub={`${stats.myopiaCount} patients · ${fmt$(stats.myopiaRevenue)} total revenue`} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <ChartCard title="Therapy Type Breakdown" height={240}>
              <SimplePieChart data={myopiaData.map(d => ({ name: d.name.replace(' (New)','').replace(' (Return)',''), value: d.value }))} height={220} />
            </ChartCard>
            <ChartCard title="Revenue by Therapy Type" height={240}>
              <SimpleBarChart
                data={myopiaData}
                dataKey="revenue" nameKey="name"
                color="#EF4444" fmt={fmt$} height={220} horizontal
              />
            </ChartCard>
            <ChartCard title="Myopia Patients by Month" height={240}>
              <SimpleBarChart data={monthlyData.filter(d => d.myopia > 0)} dataKey="myopia" nameKey="name"
                color="#F59E0B" height={220} />
            </ChartCard>
          </div>
        </section>
      )}

      {/* ── Payor Mix ── */}
      <section>
        <SectionHeader title="Payor Mix" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <ChartCard title="Insurance vs Self Pay" height={240}>
            <SimplePieChart data={insVsSelf} height={220} />
          </ChartCard>
          <ChartCard title="Patients by Payor" height={240}>
            <SimpleBarChart data={payorData} dataKey="value" nameKey="name"
              color="#2E7D8C" height={220} horizontal />
          </ChartCard>
          <ChartCard title="Revenue by Payor" height={240}>
            <SimpleBarChart data={payorData} dataKey="revenue" nameKey="name"
              color="#1B3A5C" fmt={fmt$} height={220} horizontal />
          </ChartCard>
        </div>
      </section>

    </div>
  );
}
