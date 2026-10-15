import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const LOCATIONS = ['SC', 'F', 'WC', 'SV'];
const LOC_FULL = { SC: 'Santa Clara', F: 'Fremont', WC: 'Walnut Creek', SV: 'Sunnyvale' };
const LOC_COLORS = { SC: '#2E7D8C', F: '#6D28D9', WC: '#B45309', SV: '#065F46' };

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmt$(n) { return '$' + (n||0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function fmtPct(n) { return (n*100).toFixed(1) + '%'; }

// Default cost config — user can edit in the Settings panel
const DEFAULT_COSTS = {
  SC: [{ from: '2000-01', amount: 1854.60, label: 'Lease + Cloud ($1,801.65 + $52.95)' }],
  F:  [{ from: '2000-01', amount: 1820.23, label: 'Lease' },
       { from: '2026-04', amount: 2956.91, label: 'Lease (new rate Apr 2026)' }],
  WC: [{ from: '2000-01', amount: 1628.92, label: 'Lease' }],
  SV: [{ from: '2000-01', amount: 1641.24, label: 'Lease' }],
};

function getCostForMonth(costs, monthKey) {
  // monthKey = 'YYYY-MM'
  const applicable = costs.filter(c => c.from <= monthKey).sort((a,b) => b.from.localeCompare(a.from));
  return applicable[0]?.amount || 0;
}

function CostSettings({ costs, setCosts }) {
  const [editing, setEditing] = useState(null); // {loc, idx}
  const [newEntry, setNewEntry] = useState({ from: '', amount: '', label: '' });

  return (
    <div style={{ background: 'white', borderRadius: 12, padding: 20, border: '1px solid #E2E8F0', marginBottom: 24 }}>
      <h3 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 16, color: '#1B3A5C', marginBottom: 16 }}>
        ⚙️ Monthly Equipment Costs
      </h3>
      <p style={{ fontSize: 11, color: '#94A3B8', marginBottom: 16 }}>
        Costs apply from the "From" month onward until the next entry. OCT has no monthly cost (paid off).
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 16 }}>
        {LOCATIONS.map(loc => (
          <div key={loc} style={{ border: '1px solid #E2E8F0', borderRadius: 8, padding: 12 }}>
            <div style={{ fontWeight: 700, color: LOC_COLORS[loc], fontSize: 13, marginBottom: 8 }}>
              {LOC_FULL[loc]}
            </div>
            {costs[loc].map((entry, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12 }}>
                <span style={{ color: '#94A3B8', minWidth: 55 }}>From {entry.from}</span>
                <span style={{ fontWeight: 700, color: '#1B3A5C' }}>{fmt$(entry.amount)}/mo</span>
                <span style={{ color: '#94A3B8', flex: 1, fontSize: 10 }}>{entry.label}</span>
                <button onClick={() => {
                  setCosts(prev => ({ ...prev, [loc]: prev[loc].filter((_,j)=>j!==i) }));
                }} style={{ background: '#FEE2E2', border: 'none', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', color: '#DC2626', fontSize: 10 }}>✕</button>
              </div>
            ))}
            {/* Add new entry */}
            <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
              <input type="month" placeholder="From" value={editing?.loc===loc?newEntry.from:''} onChange={e=>{ setEditing({loc,idx:-1}); setNewEntry(p=>({...p,from:e.target.value})); }}
                style={{ fontSize: 10, padding: '3px 4px', border: '1px solid #E2E8F0', borderRadius: 4, width: 100 }}/>
              <input type="number" placeholder="$/mo" value={editing?.loc===loc?newEntry.amount:''} onChange={e=>{ setEditing({loc,idx:-1}); setNewEntry(p=>({...p,amount:e.target.value})); }}
                style={{ fontSize: 10, padding: '3px 4px', border: '1px solid #E2E8F0', borderRadius: 4, width: 70 }}/>
              <button onClick={() => {
                if (!newEntry.from || !newEntry.amount) return;
                setCosts(prev => ({
                  ...prev,
                  [loc]: [...prev[loc], { from: newEntry.from, amount: parseFloat(newEntry.amount), label: 'Updated rate' }].sort((a,b)=>a.from.localeCompare(b.from))
                }));
                setNewEntry({ from: '', amount: '', label: '' });
                setEditing(null);
              }} style={{ background: '#1B3A5C', color: 'white', border: 'none', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontSize: 10 }}>+ Add</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color='#1B3A5C', highlight }) {
  return (
    <div style={{ background: highlight||'white', borderRadius: 10, padding: '14px 16px', border: '1px solid #E2E8F0', textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color, marginBottom: 2 }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: sub?2:0 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: '#94A3B8' }}>{sub}</div>}
    </div>
  );
}

export default function ImagingView({ allPatients }) {
  const [costs, setCosts] = useState(DEFAULT_COSTS);
  const [showSettings, setShowSettings] = useState(false);
  const [filterLoc, setFilterLoc] = useState('');
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [tab, setTab] = useState('summary');
  // Invoice counts: { 'SC_2026-06': 42, 'F_2026-06': 38, ... }
  const [invoiceCounts, setInvoiceCounts] = useState({});

  // Load invoice counts from Firebase
  useEffect(() => {
    getDoc(doc(db, 'appData', 'optosInvoiceCounts'))
      .then(s => { if (s.exists()) setInvoiceCounts(s.data().counts || {}); })
      .catch(() => {});
  }, []);

  const saveInvoiceCount = useCallback(async (loc, monthKey, value) => {
    const key = `${loc}_${monthKey}`;
    const updated = { ...invoiceCounts, [key]: value === '' ? null : parseInt(value) || 0 };
    setInvoiceCounts(updated);
    try {
      await setDoc(doc(db, 'appData', 'optosInvoiceCounts'), { counts: updated });
    } catch(e) { console.error('Failed to save invoice count:', e); }
  }, [invoiceCounts]); // 'summary' | 'monthly' | 'doctors'

  const years = useMemo(() => {
    const s = new Set(allPatients.map(p => p.year).filter(Boolean));
    return [...s].sort((a,b)=>b-a);
  }, [allPatients]);

  // Filter to selected year
  const filtered = useMemo(() => allPatients.filter(p =>
    p.year === filterYear && (!filterLoc || p.loc === filterLoc)
  ), [allPatients, filterYear, filterLoc]);

  // Monthly data by location
  const monthlyByLoc = useMemo(() => {
    const data = {};
    for (let m = 1; m <= 12; m++) {
      const key = `${filterYear}-${String(m).padStart(2,'0')}`;
      data[key] = {};
      const locs = filterLoc ? [filterLoc] : LOCATIONS;
      for (const loc of locs) {
        const pts = filtered.filter(p => p.month === m && p.loc === loc);
        const total = pts.length;
        const optosPts = pts.filter(p => p.optos);
        const octPts = pts.filter(p => p.oct);
        const optosIncome = pts.reduce((s,p) => s+(p.optosIncome||0), 0);
        const octIncome = pts.reduce((s,p) => s+(p.octIncome||0), 0);
        const cost = getCostForMonth(costs[loc]||[], key);
        data[key][loc] = {
          total, optos: optosPts.length, oct: octPts.length,
          optosIncome, octIncome, totalIncome: optosIncome+octIncome,
          cost, net: optosIncome+octIncome-cost,
          optosPct: total>0?optosPts.length/total:0,
          octPct: optosPts.length>0?octPts.length/optosPts.length:0,
        };
      }
    }
    return data;
  }, [filtered, costs, filterYear, filterLoc]);

  // Doctor stats
  const doctorStats = useMemo(() => {
    const docs = {};
    for (const p of filtered) {
      if (!p.doctor) continue;
      if (!docs[p.doctor]) docs[p.doctor] = { total: 0, optos: 0, oct: 0, optosIncome: 0, octIncome: 0 };
      docs[p.doctor].total++;
      if (p.optos) { docs[p.doctor].optos++; docs[p.doctor].optosIncome += p.optosIncome||0; }
      if (p.oct) { docs[p.doctor].oct++; docs[p.doctor].octIncome += p.octIncome||0; }
    }
    return Object.entries(docs).map(([doc, s]) => ({
      doc, ...s,
      optosPct: s.total>0?s.optos/s.total:0,
      octPct: s.optos>0?s.oct/s.optos:0,
    })).sort((a,b)=>b.optosPct-a.optosPct);
  }, [filtered]);

  // YTD totals
  const ytd = useMemo(() => {
    const locs = filterLoc ? [filterLoc] : LOCATIONS;
    const result = {};
    for (const loc of locs) {
      const months = Object.keys(monthlyByLoc);
      const locData = months.map(m => monthlyByLoc[m][loc]).filter(Boolean);
      result[loc] = {
        totalPts: locData.reduce((s,d)=>s+d.total,0),
        optos: locData.reduce((s,d)=>s+d.optos,0),
        oct: locData.reduce((s,d)=>s+d.oct,0),
        optosIncome: locData.reduce((s,d)=>s+d.optosIncome,0),
        octIncome: locData.reduce((s,d)=>s+d.octIncome,0),
        totalIncome: locData.reduce((s,d)=>s+d.totalIncome,0),
        totalCost: locData.reduce((s,d)=>s+d.cost,0),
        net: locData.reduce((s,d)=>s+d.net,0),
      };
    }
    return result;
  }, [monthlyByLoc, filterLoc]);

  const inp = { padding: '6px 10px', border: '1px solid #E2E8F0', borderRadius: 7, fontSize: 12, background: 'white', cursor: 'pointer' };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px 40px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingTop: 8 }}>
        <h1 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 26, color: '#1B3A5C', margin: 0 }}>
          🔬 Imaging Analytics
        </h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={filterYear} onChange={e=>setFilterYear(Number(e.target.value))} style={inp}>
            {years.map(y=><option key={y} value={y}>{y}</option>)}
          </select>
          <select value={filterLoc} onChange={e=>setFilterLoc(e.target.value)} style={inp}>
            <option value="">All Locations</option>
            {LOCATIONS.map(l=><option key={l} value={l}>{l} — {LOC_FULL[l]}</option>)}
          </select>
          <button onClick={()=>setShowSettings(v=>!v)}
            style={{ ...inp, background: showSettings?'#1B3A5C':'white', color: showSettings?'white':'#64748B', border: '1px solid #E2E8F0' }}>
            ⚙️ Costs
          </button>
        </div>
      </div>

      {showSettings && <CostSettings costs={costs} setCosts={setCosts}/>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, background: '#F1F5F9', borderRadius: 8, padding: 3, marginBottom: 20, width: 'fit-content' }}>
        {[['summary','📍 Summary'],['monthly','📅 Monthly'],['doctors','👩‍⚕️ By Doctor']].map(([t,l])=>(
          <button key={t} onClick={()=>setTab(t)}
            style={{ padding: '6px 14px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: tab===t?700:400,
              background: tab===t?'#1B3A5C':'transparent', color: tab===t?'white':'#64748B', cursor: 'pointer' }}>
            {l}
          </button>
        ))}
      </div>

      {/* Summary tab */}
      {tab==='summary' && (
        <div>
          {(filterLoc ? [filterLoc] : LOCATIONS).map(loc => {
            const s = ytd[loc] || {};
            const netColor = s.net >= 0 ? '#065F46' : '#DC2626';
            const netBg = s.net >= 0 ? '#F0FDF4' : '#FEF2F2';
            return (
              <div key={loc} style={{ marginBottom: 20, background: 'white', borderRadius: 12, padding: 20, border: '1px solid #E2E8F0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: LOC_COLORS[loc], margin: 0 }}>
                    {LOC_FULL[loc]}
                  </h2>
                  <div style={{ fontSize: 13, fontWeight: 700, color: netColor, background: netBg, borderRadius: 8, padding: '4px 12px' }}>
                    YTD Net: {fmt$(s.net)}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10 }}>
                  <StatCard label="Total Patients" value={(s.totalPts||0).toLocaleString()}/>
                  <StatCard label="Optos Count" value={(s.optos||0).toLocaleString()} sub={s.totalPts>0?fmtPct(s.optos/s.totalPts)+' of pts':''} color='#0891B2'/>
                  <StatCard label="OCT Count" value={(s.oct||0).toLocaleString()} sub={s.optos>0?fmtPct(s.oct/s.optos)+' of optos':''} color='#6D28D9'/>
                  <StatCard label="Optos Income" value={fmt$(s.optosIncome)} color='#059669'/>
                  <StatCard label="OCT Income" value={fmt$(s.octIncome)} color='#059669'/>
                  <StatCard label="Equipment Cost" value={fmt$(s.totalCost)} color='#DC2626'/>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Monthly tab */}
      {tab==='monthly' && (
        <div>
          {(filterLoc ? [filterLoc] : LOCATIONS).map(loc => (
            <div key={loc} style={{ marginBottom: 24, background: 'white', borderRadius: 12, padding: 16, border: '1px solid #E2E8F0' }}>
              <h3 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 16, color: LOC_COLORS[loc], marginBottom: 12 }}>{LOC_FULL[loc]}</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #E2E8F0' }}>
                    {['Month','Patients','Optos','Optos %','OCT','OCT % of Optos','Optos $','OCT $','Combined $','Cost','Net','Invoice #','Diff'].map(h=>(
                      <th key={h} style={{ padding: '6px 8px', textAlign: h==='Month'?'left':'right', color: h==='Invoice #'||h==='Diff'?'#0891B2':'#64748B', fontWeight: 700, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(monthlyByLoc).map(([monthKey, locData]) => {
                    const d = locData[loc] || {};
                    if (!d.total && !d.cost) return null;
                    const mo = parseInt(monthKey.split('-')[1]);
                    const netColor = (d.net||0) >= 0 ? '#065F46' : '#DC2626';
                    const invoiceKey = `${loc}_${monthKey}`;
                    const invoiceCount = invoiceCounts[invoiceKey];
                    const diff = invoiceCount != null ? (d.optos||0) - invoiceCount : null;
                    return (
                      <tr key={monthKey} style={{ borderBottom: '1px solid #F0F4F8' }}>
                        <td style={{ padding: '5px 8px', fontWeight: 600, color: '#1B3A5C' }}>{MONTH_NAMES[mo-1]}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right' }}>{d.total||0}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: '#0891B2' }}>{d.optos||0}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: '#0891B2' }}>{d.total>0?fmtPct(d.optosPct):'—'}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: '#6D28D9' }}>{d.oct||0}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: '#6D28D9' }}>{d.optos>0?fmtPct(d.octPct):'—'}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: '#059669' }}>{d.optosIncome>0?fmt$(d.optosIncome):'—'}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: '#059669' }}>{d.octIncome>0?fmt$(d.octIncome):'—'}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: '#059669' }}>{d.totalIncome>0?fmt$(d.totalIncome):'—'}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: '#DC2626' }}>{fmt$(d.cost)}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 700, color: netColor }}>{fmt$(d.net||0)}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                          <input type="number" min="0" value={invoiceCount ?? ''}
                            onChange={e => saveInvoiceCount(loc, monthKey, e.target.value)}
                            style={{ width: 50, padding: '2px 4px', border: '1px solid #BAE6FD', borderRadius: 4, fontSize: 11, textAlign: 'right', fontFamily: 'inherit' }}
                            placeholder="—"/>
                        </td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 700,
                          color: diff === null ? '#94A3B8' : diff === 0 ? '#059669' : diff > 0 ? '#DC2626' : '#F59E0B' }}>
                          {diff === null ? '—' : diff === 0 ? '✓' : diff > 0 ? `+${diff} uncharged` : `${diff}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid #E2E8F0', background: '#F8FAFC' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 700, color: '#1B3A5C' }}>YTD</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>{ytd[loc]?.totalPts||0}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: '#0891B2' }}>{ytd[loc]?.optos||0}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: '#0891B2' }}>{ytd[loc]?.totalPts>0?fmtPct(ytd[loc].optos/ytd[loc].totalPts):'—'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: '#6D28D9' }}>{ytd[loc]?.oct||0}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: '#6D28D9' }}>{ytd[loc]?.optos>0?fmtPct(ytd[loc].oct/ytd[loc].optos):'—'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: '#059669' }}>{fmt$(ytd[loc]?.optosIncome)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: '#059669' }}>{fmt$(ytd[loc]?.octIncome)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: '#059669' }}>{fmt$(ytd[loc]?.totalIncome)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: '#DC2626' }}>{fmt$(ytd[loc]?.totalCost)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: (ytd[loc]?.net||0)>=0?'#065F46':'#DC2626' }}>{fmt$(ytd[loc]?.net)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* By Doctor tab */}
      {tab==='doctors' && (
        <div style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #E2E8F0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #E2E8F0' }}>
                {['Doctor','Patients','Optos','Optos %','OCT','OCT % of Optos','Optos $','OCT $','Total $'].map(h=>(
                  <th key={h} style={{ padding: '8px 10px', textAlign: h==='Doctor'?'left':'right', color: '#64748B', fontWeight: 700, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {doctorStats.map((d,i) => (
                <tr key={d.doc} style={{ borderBottom: '1px solid #F0F4F8', background: i%2===0?'white':'#FAFBFC' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 600, color: '#1B3A5C' }}>{d.doc}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>{d.total}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: '#0891B2' }}>{d.optos}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                    <span style={{ background: d.optosPct>=0.5?'#ECFDF5':d.optosPct>=0.3?'#FFFBEB':'#FEF2F2', color: d.optosPct>=0.5?'#065F46':d.optosPct>=0.3?'#92400E':'#DC2626', borderRadius: 4, padding: '1px 6px', fontWeight: 700 }}>
                      {fmtPct(d.optosPct)}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: '#6D28D9' }}>{d.oct}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: '#6D28D9' }}>{d.optos>0?fmtPct(d.octPct):'—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: '#059669' }}>{d.optosIncome>0?fmt$(d.optosIncome):'—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: '#059669' }}>{d.octIncome>0?fmt$(d.octIncome):'—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#059669' }}>{(d.optosIncome+d.octIncome)>0?fmt$(d.optosIncome+d.octIncome):'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
