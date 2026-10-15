import React, { useState, useCallback, useRef, useEffect } from 'react';
import { parseExcelFile } from './parseExcel';
import { loadFirestorePatients } from './parseFirestore';
import ProductionView from './ProductionView';
import DoctorsView from './DoctorsView';
import ExpensesView from './ExpensesView';
import ImagingView from './ImagingView';
import { db } from './firebase';
import { loadDoctorProfiles, loadPayments, DEFAULT_ROSTER } from './doctorData';
import { doc, getDoc, setDoc } from 'firebase/firestore';

// ── Firebase persistence helpers ───────────────────────────────────────────
async function saveProductionData(patients) {
  const meta = { updatedAt: new Date().toISOString(), count: patients.length };
  // Store in chunks to avoid Firestore 1MB doc limit
  const CHUNK = 500;
  const chunks = [];
  for (let i = 0; i < patients.length; i += CHUNK) chunks.push(patients.slice(i, i + CHUNK));
  await Promise.all([
    setDoc(doc(db, 'appData', 'productionMeta'), meta),
    ...chunks.map((ch, i) => setDoc(doc(db, 'appData', `productionChunk_${i}`), { patients: ch, index: i })),
    setDoc(doc(db, 'appData', 'productionChunkCount'), { count: chunks.length }),
  ]);
}

async function loadProductionData() {
  const metaSnap = await getDoc(doc(db, 'appData', 'productionMeta'));
  if (!metaSnap.exists()) return null;
  const meta = metaSnap.data();
  const countSnap = await getDoc(doc(db, 'appData', 'productionChunkCount'));
  if (!countSnap.exists()) return null;
  const chunkCount = countSnap.data().count;
  const chunks = await Promise.all(
    Array.from({ length: chunkCount }, (_, i) => getDoc(doc(db, 'appData', `productionChunk_${i}`)))
  );
  const patients = chunks.flatMap(s => s.exists() ? s.data().patients : []);
  return { patients, updatedAt: meta.updatedAt, count: meta.count };
}

async function saveSquarePayrollMeta(updatedAt) {
  await setDoc(doc(db, 'appData', 'squarePayrollMeta'), { updatedAt });
}

async function loadSquarePayrollMeta() {
  const snap = await getDoc(doc(db, 'appData', 'squarePayrollMeta'));
  return snap.exists() ? snap.data() : null;
}

function fmtTs(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const NAV = [
  { id: 'production', label: 'Production', icon: '📊', ready: true },
  { id: 'imaging',    label: 'Imaging',    icon: '🔬', ready: true },
  { id: 'doctors',    label: 'Doctors',    icon: '👩‍⚕️', ready: true },
  { id: 'expenses',   label: 'Expenses',   icon: '💸', ready: true },
  { id: 'errors',     label: 'Pay Errors', icon: '⚠️', ready: false },
];

const DEFAULT_FILTERS = { year: '2026', loc: 'all', doctor: 'all', month: 'all' };

export default function Dashboard({ user, onSignOut }) {
  const [page, setPage] = useState('production');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [excelUpdatedAt, setExcelUpdatedAt] = useState(null);
  const [squareUpdatedAt, setSquareUpdatedAt] = useState(null);
  const [employeeReportFor, setEmployeeReportFor] = useState(null);
  const [sharedProfiles, setSharedProfiles] = useState({});
  const [sharedPayments, setSharedPayments] = useState({});
  const [dataSource, setDataSource] = useState('live'); // 'live' | 'excel'
  const [liveUpdatedAt, setLiveUpdatedAt] = useState(null);
  const [liveData, setLiveData] = useState(null);
  const [excelData, setExcelData] = useState(null);
  const fileRef = useRef();

  // Load live data on mount
  useEffect(() => {
    async function init() {
      try {
        const sqMeta = await loadSquarePayrollMeta();
        if (sqMeta) setSquareUpdatedAt(sqMeta.updatedAt);
      } catch (e) { console.error('Failed to load Square meta:', e); }

      // Load live Firestore billing data
      try {
        const patients = await loadFirestorePatients();
        setLiveData(patients);
        setLiveUpdatedAt(new Date().toISOString());
        setDataSource('live');
        setData(patients);
      } catch (e) { console.error('Failed to load live data:', e); }

      // Load doctor profiles and payments
      try {
        const profs = await loadDoctorProfiles();
        setSharedProfiles(profs);
        const payMap = {};
        await Promise.all(DEFAULT_ROSTER.map(async d => {
          try { const pays = await loadPayments(d.id); payMap[d.id] = pays; } catch {}
        }));
        setSharedPayments(payMap);
      } catch (e) { console.error('Failed to load doctor data:', e); }
      setInitialLoading(false);
    }
    init();
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const result = await parseExcelFile(file);
      const all = [
        ...result.patients2026,
        ...result.patients2025,
        ...result.patients2024,
      ];
      setExcelData(all);
      if (dataSource === 'excel') setData(all);
      const ts = new Date().toISOString();
      setExcelUpdatedAt(ts);
      saveProductionData(all).catch(e => console.error('Failed to save production data:', e));
    } catch (err) {
      setError("Could not parse the file. Make sure it's the correct Excel format.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [dataSource]);

  const handleRefreshLive = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const patients = await loadFirestorePatients();
      setLiveData(patients);
      setLiveUpdatedAt(new Date().toISOString());
      if (dataSource === 'live') setData(patients);
    } catch (err) {
      setError('Could not load live data from billing app.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [dataSource]);

  const handleSourceToggle = useCallback((src) => {
    setDataSource(src);
    if (src === 'live' && liveData) setData(liveData);
    if (src === 'excel' && excelData) setData(excelData);
  }, [liveData, excelData]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = (e) => e.preventDefault();

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F7F9FB' }}>

      {/* ── Sidebar ── */}
      <aside style={{
        width: sidebarOpen ? 220 : 64, flexShrink: 0,
        background: 'linear-gradient(180deg, #112640 0%, #1B3A5C 100%)',
        display: 'flex', flexDirection: 'column',
        transition: 'width 0.2s ease', overflow: 'hidden',
        boxShadow: '2px 0 12px rgba(0,0,0,0.15)',
      }}>
        {/* Logo */}
        <div style={{
          padding: sidebarOpen ? '28px 20px 20px' : '28px 12px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <SparkLogo size={32} />
          {sidebarOpen && (
            <div>
              <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, color: 'white', lineHeight: 1.1 }}>
                The Spark
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Dashboard
              </div>
            </div>
          )}
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, padding: '16px 0' }}>
          {NAV.map(item => (
            <button key={item.id}
              onClick={() => item.ready && setPage(item.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                width: '100%', padding: sidebarOpen ? '11px 20px' : '11px 16px',
                border: 'none', background: page === item.id
                  ? 'rgba(46,125,140,0.3)' : 'transparent',
                borderLeft: `3px solid ${page === item.id ? '#2E7D8C' : 'transparent'}`,
                color: page === item.id ? 'white' : item.ready ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.25)',
                cursor: item.ready ? 'pointer' : 'default',
                textAlign: 'left', transition: 'all 0.15s',
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
              {sidebarOpen && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: page === item.id ? 600 : 400 }}>
                    {item.label}
                  </div>
                  {!item.ready && <div style={{ fontSize: 10, opacity: 0.5 }}>Coming soon</div>}
                </div>
              )}
            </button>
          ))}
        </nav>

        {/* User + sign out */}
        <div style={{
          padding: sidebarOpen ? '16px 20px' : '16px 12px',
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}>
          {sidebarOpen && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.email}
            </div>
          )}
          <button onClick={onSignOut} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            width: '100%', padding: '8px 0', border: 'none', background: 'transparent',
            color: 'rgba(255,255,255,0.4)', fontSize: 12, cursor: 'pointer',
            fontFamily: "'DM Sans', sans-serif",
          }}>
            <span>↩</span>
            {sidebarOpen && <span>Sign out</span>}
          </button>
        </div>

        {/* Collapse toggle */}
        <button onClick={() => setSidebarOpen(o => !o)} style={{
          position: 'absolute', top: 32, left: sidebarOpen ? 208 : 52,
          width: 24, height: 24, borderRadius: '50%',
          background: '#2E7D8C', border: '2px solid #112640',
          color: 'white', fontSize: 10, cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center', transition: 'left 0.2s',
          zIndex: 10,
        }}>
          {sidebarOpen ? '‹' : '›'}
        </button>
      </aside>

      {/* ── Main content ── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Top bar */}
        <header style={{
          background: 'white', borderBottom: '1px solid #E2E8F0',
          padding: '16px 32px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', flexShrink: 0,
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}>
          <div>
            <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 24, color: '#1B3A5C' }}>
              {NAV.find(n => n.id === page)?.label}
            </h1>
            {data && (
              <p style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
                {data.length.toLocaleString()} patient records loaded
              </p>
            )}
          </div>

          {/* Upload button */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>

            {/* Status indicator */}
            {liveUpdatedAt && (
              <span style={{ fontSize: 12, color: '#94A3B8' }}>
                Live: <strong style={{ color: '#059669' }}>✓</strong> {fmtTs(liveUpdatedAt)}
                {' · '}{liveData?.length?.toLocaleString()} records
              </span>
            )}
            {squareUpdatedAt && (
              <span style={{ fontSize: 12, color: '#94A3B8' }}>
                Square: <strong style={{ color: '#059669' }}>✓</strong> {fmtTs(squareUpdatedAt)}
              </span>
            )}

            {/* Refresh */}
            <button onClick={handleRefreshLive} style={{
              padding: '9px 18px', borderRadius: 8, border: 'none',
              background: '#1B3A5C', color: 'white', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>🔄</span> Refresh
            </button>

            {/* AI Chat button */}
            <button onClick={() => setAiChatOpen(o => !o)} style={{
              padding: '9px 18px', borderRadius: 8, border: 'none',
              background: aiChatOpen ? '#2E7D8C' : '#F1F5F9',
              color: aiChatOpen ? 'white' : '#1B3A5C',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              fontFamily: "'DM Sans', sans-serif",
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>✨</span> Ask AI
            </button>
          </div>
        </header>

        {/* Page content */}
        <div style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>

          {/* Error */}
          {error && (
            <div style={{
              background: '#FEE2E2', color: '#DC2626', borderRadius: 10,
              padding: '12px 16px', marginBottom: 24, fontSize: 14,
            }}>{error}</div>
          )}

          {/* Loading */}
          {(loading || initialLoading) && (
            <div style={{ textAlign: 'center', padding: '80px 0', color: '#94A3B8' }}>
              <div style={{
                width: 40, height: 40, margin: '0 auto 16px',
                border: '3px solid #E2E8F0', borderTopColor: '#2E7D8C',
                borderRadius: '50%', animation: 'spin 0.8s linear infinite',
              }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <p>Loading live data…</p>
            </div>
          )}

          {/* No data state */}
          {!loading && !initialLoading && !data && (
            <div style={{ border: '2px dashed #CBD5E1', borderRadius: 16, padding: '80px 40px', textAlign: 'center', background: 'white' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>⚡</div>
              <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 24, color: '#1B3A5C', marginBottom: 8 }}>
                No data loaded
              </h2>
              <p style={{ color: '#64748B', fontSize: 14, marginBottom: 24 }}>
                Click Refresh to load live data from the billing app.
              </p>
              <button onClick={handleRefreshLive} style={{
                padding: '12px 28px', borderRadius: 10, border: 'none',
                background: '#1B3A5C', color: 'white', fontSize: 15, fontWeight: 600,
                cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
              }}>
                🔄 Load Live Data
              </button>
            </div>
          )}

          {/* Production view */}
          {!loading && !initialLoading && data && page === 'production' && (
            <ProductionView
              allPatients={data}
              filters={filters}
              onFilterChange={setFilters}
              onShowEmployeeReport={(doctorId) => setEmployeeReportFor(doctorId)}
              allPayments={sharedPayments}
              profiles={sharedProfiles}
            />
          )}

          {/* Imaging view */}
          {!loading && !initialLoading && data && page === 'imaging' && (
            <ImagingView allPatients={data}/>
          )}

          {/* Doctors view */}
          {!loading && !initialLoading && page === 'doctors' && (
            <DoctorsView
              allPatients={data || []}
              filters={filters}
              showEmployeeReportFor={null}
              onClearEmployeeReport={() => {}}
              onSquareImported={() => {
                const ts = new Date().toISOString();
                setSquareUpdatedAt(ts);
                saveSquarePayrollMeta(ts).catch(console.error);
              }}
            />
          )}

          {/* Expenses view */}
          {!loading && !initialLoading && page === 'expenses' && (
            <ExpensesView
              allPatients={data || []}
              allPayments={sharedPayments}
              onPayrollUploaded={(result) => {
                const ts = new Date().toISOString();
                setSquareUpdatedAt(ts);
                saveSquarePayrollMeta(ts).catch(console.error);
              }}
            />
          )}

          {/* Coming soon placeholders */}
          {!loading && page !== 'production' && page !== 'doctors' && page !== 'expenses' && (
            <ComingSoon page={page} />
          )}
        </div>
      </main>

      {/* AI Chat sidebar */}
      <AIChatPanel
        open={aiChatOpen}
        onClose={() => setAiChatOpen(false)}
        data={data}
        sharedPayments={sharedPayments}
        sharedProfiles={sharedProfiles}
      />
    </div>
  );
}

function ComingSoon({ page }) {
  const msgs = {
    doctors: { icon: '👩‍⚕️', title: 'Doctor Management', desc: 'Payroll tracking, pay structures, PTO balances, performance benchmarks, and employment notes — coming in Module 2.' },
    expenses: { icon: '💸', title: 'Expense Tracker', desc: 'Log expenses by category, location, and card. Projected vs. actual P&L, real vs. reported views — coming in Module 3.' },
    errors: { icon: '⚠️', title: 'Payment Error Log', desc: 'Track billing errors by date, doctor, and patient. Generate sanitized location-level reports — coming in Module 4.' },
  };
  const m = msgs[page] || {};
  return (
    <div style={{ textAlign: 'center', padding: '80px 40px' }}>
      <div style={{ fontSize: 56, marginBottom: 20 }}>{m.icon}</div>
      <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 28, color: '#1B3A5C', marginBottom: 12 }}>{m.title}</h2>
      <p style={{ color: '#64748B', fontSize: 15, maxWidth: 480, margin: '0 auto', lineHeight: 1.7 }}>{m.desc}</p>
    </div>
  );
}

function SparkLogo({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="24" cy="24" r="24" fill="rgba(46,125,140,0.2)" />
      <path d="M12 24c0-6.627 5.373-12 12-12s12 5.373 12 12" stroke="#2E7D8C" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="24" cy="24" r="5" fill="#2E7D8C" />
      <circle cx="24" cy="24" r="2" fill="white" />
    </svg>
  );
}

// ── AI Chat Panel ──────────────────────────────────────────────────────────
function AIChatPanel({ open, onClose, data, sharedPayments, sharedProfiles, expenses }) {
  const [messages, setMessages] = React.useState([
    { role: 'assistant', content: "Hi! I can answer questions about your practice data — revenue, doctor performance, expenses, trends. What would you like to know?" }
  ]);
  const [input, setInput] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const bottomRef = React.useRef(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const buildSnapshot = () => {
    const byLoc = {};
    const byDoctor = {};
    const byMonth = {};
    const patientsByDoctor = {};
    const patientsByLoc = {};

    (data || []).forEach(p => {
      const loc = p.loc || p.location || 'Unknown';
      const locName = p.locationName || loc;
      const doc = p.doctor || p.doctorName || 'Unknown';
      const month = (p.date || '').slice(0, 7);
      const rev = parseFloat(p.total) || parseFloat(p.paid) || 0;

      byLoc[locName] = (byLoc[locName] || 0) + rev;
      byDoctor[doc] = (byDoctor[doc] || 0) + rev;
      if (month) byMonth[month] = (byMonth[month] || 0) + rev;
      patientsByDoctor[doc] = (patientsByDoctor[doc] || 0) + 1;
      patientsByLoc[locName] = (patientsByLoc[locName] || 0) + 1;
    });

    // Payment totals by doctor
    const paymentTotals = {};
    Object.entries(sharedPayments || {}).forEach(([id, pays]) => {
      paymentTotals[id] = (pays || []).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
    });

    return {
      totalPatients: data?.length || 0,
      totalRevenue: Object.values(byLoc).reduce((s, v) => s + v, 0),
      revenueByLocation: byLoc,
      patientsByLocation: patientsByLoc,
      revenueByDoctor: byDoctor,
      patientsByDoctor,
      revenueByMonth: byMonth,
      paymentsByDoctor: paymentTotals,
      locations: ['Santa Clara', 'Fremont', 'Walnut Creek', 'Sunnyvale'],
      expenseSummary: null,
    };
  };

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const snapshot = buildSnapshot();
      const systemPrompt = `You are an AI assistant for The Spark Optometry, a multi-location optometry practice. You help the owner (Christine) analyze practice performance data.

Current data snapshot:
${JSON.stringify(snapshot, null, 2)}

When answering questions:
- Be concise and specific with numbers
- Format dollar amounts with $ and commas
- If the user asks for a chart or visualization, include a JSON block at the END of your response in this exact format:
\`\`\`chart
{"type":"bar","title":"Chart Title","data":[{"name":"Label","value":123}],"color":"#2E7D8C"}
\`\`\`
- Supported chart types: bar, line, pie
- For bar/line charts, data items need "name" and "value" fields
- For pie charts, data items need "name" and "value" fields
- Keep chart data to the most relevant items (max 10)
- Always answer in plain text first, then add the chart block if requested`;

      const response = await fetch('https://spark-dashboard-proxy.ilikebroccoli.workers.dev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          system: systemPrompt,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        })
      });

      const result = await response.json();
      const text = result.content?.[0]?.text || 'Sorry, I could not get a response.';

      // Parse chart block if present
      const chartMatch = text.match(/```chart\n([\s\S]*?)\n```/);
      let chartData = null;
      let cleanText = text;
      if (chartMatch) {
        try {
          chartData = JSON.parse(chartMatch[1]);
          cleanText = text.replace(/```chart\n[\s\S]*?\n```/, '').trim();
        } catch {}
      }

      setMessages(prev => [...prev, { role: 'assistant', content: cleanText, chart: chartData }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + e.message }]);
    }
    setLoading(false);
  };

  if (!open) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 400,
      background: 'white', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
      display: 'flex', flexDirection: 'column', zIndex: 100,
      fontFamily: "'DM Sans', sans-serif",
    }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(90deg,#112640,#1B3A5C)', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>✨</span>
          <div>
            <div style={{ color: 'white', fontWeight: 700, fontSize: 15 }}>AI Assistant</div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>Ask about your practice data</div>
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 18 }}>✕</button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', gap: 6 }}>
            <div style={{
              maxWidth: '85%', padding: '10px 14px', borderRadius: m.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
              background: m.role === 'user' ? '#1B3A5C' : '#F8FAFC',
              color: m.role === 'user' ? 'white' : '#1E293B',
              fontSize: 13, lineHeight: 1.5,
              border: m.role === 'assistant' ? '1px solid #E2E8F0' : 'none',
            }}>
              {m.content}
            </div>
            {m.chart && <ChartBlock chart={m.chart} />}
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '14px 14px 14px 4px', padding: '10px 16px', color: '#94A3B8', fontSize: 13 }}>
              Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #E2E8F0', display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder="Ask about revenue, doctors, trends…"
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 10,
            border: '1.5px solid #E2E8F0', fontSize: 13,
            fontFamily: "'DM Sans', sans-serif", outline: 'none',
          }}
        />
        <button onClick={send} disabled={loading || !input.trim()} style={{
          background: '#1B3A5C', color: 'white', border: 'none',
          borderRadius: 10, padding: '10px 16px', cursor: 'pointer',
          fontSize: 13, fontWeight: 600, opacity: loading || !input.trim() ? 0.5 : 1,
        }}>↑</button>
      </div>

      {/* Quick prompts */}
      <div style={{ padding: '0 16px 12px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {['Top doctor this month', 'WC vs SV revenue', 'Show expense breakdown', 'Revenue trend 2026'].map(q => (
          <button key={q} onClick={() => { setInput(q); }} style={{
            background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 20,
            padding: '4px 10px', fontSize: 10, color: '#475569', cursor: 'pointer',
            fontFamily: "'DM Sans', sans-serif",
          }}>{q}</button>
        ))}
      </div>
    </div>
  );
}

function ChartBlock({ chart }) {
  const { type, title, data, color = '#2E7D8C' } = chart;
  const { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } = require('recharts');

  const fmt = (v) => typeof v === 'number' ? (v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v}`) : v;

  return (
    <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: '12px', width: '100%', maxWidth: 340 }}>
      {title && <div style={{ fontSize: 12, fontWeight: 700, color: '#1B3A5C', marginBottom: 8 }}>{title}</div>}
      <ResponsiveContainer width="100%" height={180}>
        {type === 'pie' ? (
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`} labelLine={false} fontSize={9}>
              {data.map((_, i) => <Cell key={i} fill={['#2E7D8C','#1B3A5C','#C9A84C','#10B981','#8B5CF6','#F59E0B','#EF4444','#06B6D4'][i%8]} />)}
            </Pie>
            <Tooltip formatter={(v) => fmt(v)} />
          </PieChart>
        ) : type === 'line' ? (
          <LineChart data={data} margin={{top:4,right:8,bottom:4,left:0}}>
            <XAxis dataKey="name" tick={{fontSize:9}} />
            <YAxis tick={{fontSize:9}} tickFormatter={fmt} />
            <Tooltip formatter={(v) => fmt(v)} />
            <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} />
          </LineChart>
        ) : (
          <BarChart data={data} margin={{top:4,right:8,bottom:4,left:0}}>
            <XAxis dataKey="name" tick={{fontSize:9}} />
            <YAxis tick={{fontSize:9}} tickFormatter={fmt} />
            <Tooltip formatter={(v) => fmt(v)} />
            <Bar dataKey="value" fill={color} radius={[3,3,0,0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
