import React, { useState, useCallback, useRef } from 'react';
import { parseExcelFile } from './parseExcel';
import ProductionView from './ProductionView';

const NAV = [
  { id: 'production', label: 'Production', icon: '📊', ready: true },
  { id: 'doctors',    label: 'Doctors',    icon: '👩‍⚕️', ready: false },
  { id: 'expenses',   label: 'Expenses',   icon: '💸', ready: false },
  { id: 'errors',     label: 'Pay Errors', icon: '⚠️', ready: false },
];

const DEFAULT_FILTERS = { year: '2026', loc: 'all', doctor: 'all', month: 'all' };

export default function Dashboard({ user, onSignOut }) {
  const [page, setPage] = useState('production');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const fileRef = useRef();

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
      setData(all);
    } catch (err) {
      setError("Could not parse the file. Make sure it's the correct Excel format.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

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
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {data && (
              <span style={{
                fontSize: 12, padding: '4px 10px', borderRadius: 12,
                background: '#D1FAE5', color: '#059669', fontWeight: 600,
              }}>
                ✓ Data loaded
              </span>
            )}
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
              onChange={e => handleFile(e.target.files[0])} />
            <button onClick={() => fileRef.current.click()} style={{
              padding: '9px 18px', borderRadius: 8, border: 'none',
              background: '#1B3A5C', color: 'white', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>📂</span> {data ? 'Re-upload Excel' : 'Upload Excel'}
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
          {loading && (
            <div style={{ textAlign: 'center', padding: '80px 0', color: '#94A3B8' }}>
              <div style={{
                width: 40, height: 40, margin: '0 auto 16px',
                border: '3px solid #E2E8F0', borderTopColor: '#2E7D8C',
                borderRadius: '50%', animation: 'spin 0.8s linear infinite',
              }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <p>Parsing Excel file…</p>
            </div>
          )}

          {/* No data state */}
          {!loading && !data && (
            <div
              onDrop={handleDrop} onDragOver={handleDragOver}
              onClick={() => fileRef.current.click()}
              style={{
                border: '2px dashed #CBD5E1', borderRadius: 16,
                padding: '80px 40px', textAlign: 'center', cursor: 'pointer',
                background: 'white', transition: 'all 0.2s',
              }}
            >
              <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
              <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 24, color: '#1B3A5C', marginBottom: 8 }}>
                Upload your production data
              </h2>
              <p style={{ color: '#64748B', fontSize: 14, marginBottom: 24 }}>
                Drag & drop your Excel file here, or click to browse.<br />
                Supports the Fun_Stuff format with 2024, 2025, and 2026 sheets.
              </p>
              <button style={{
                padding: '12px 28px', borderRadius: 10, border: 'none',
                background: '#1B3A5C', color: 'white', fontSize: 15, fontWeight: 600,
                cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
              }}>
                Choose File
              </button>
            </div>
          )}

          {/* Production view */}
          {!loading && data && page === 'production' && (
            <ProductionView
              allPatients={data}
              filters={filters}
              onFilterChange={setFilters}
            />
          )}

          {/* Coming soon placeholders */}
          {!loading && page !== 'production' && (
            <ComingSoon page={page} />
          )}
        </div>
      </main>
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
