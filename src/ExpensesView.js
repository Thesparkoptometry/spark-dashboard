import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from './firebase';
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { fmt$, fmtPct, StatCard, SectionHeader, ChartCard } from './components';

// ── Utilities ─────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 9); }
function today() { return new Date().toISOString().slice(0, 10); }
function fmtDate(d) { if (!d) return '—'; return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function fmtMonth(d) { if (!d) return '—'; const dt = new Date(d + 'T00:00:00'); return dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); }

const LOC_LIST = ['SC', 'F', 'WC', 'SV'];
const LOC_FULL = { SC: 'Santa Clara', F: 'Fremont', WC: 'Walnut Creek', SV: 'Sunnyvale' };
const LOC_COLORS = { SC: '#2E7D8C', F: '#1B3A5C', WC: '#C9A84C', SV: '#10B981' };

// ── Default settings ───────────────────────────────────────────────────────
const DEFAULT_CATEGORIES = [
  'Payroll', 'Payroll Taxes', 'Rent', 'Equipment & Leases',
  'Insurance', 'Software & Services', 'Accountant', 'AI Services',
  'Cost of Goods', 'Marketing', 'Taxes & Fees',
  'Staff Gatherings & Perks', 'Miscellaneous'
];

const DEFAULT_CARDS = [
  'Target Red Card', 'Amex 1', 'Amex 2', 'Citi Costco',
  'Business Checking', 'Personal Checking', 'Sapphire Reserve',
  'Business Ink', 'Venmo', 'Cash', 'Zelle'
];

const DEFAULT_VENDORS = [
  'Square', 'Optos', 'IRS', 'EDD', 'Grasshopper', 'Wix',
  'Amazon', 'Amcon', 'ABB Concise', 'Paragon', 'Oasis',
  'FIGS', 'Canva', 'Anthropic', 'Topographer'
];

const RECURRING_FREQUENCIES = ['Monthly', 'Quarterly', 'Semi-Annual', 'Annual'];

// ── Firebase helpers ───────────────────────────────────────────────────────
async function loadExpenseSettings() {
  const snap = await getDoc(doc(db, 'expenses', 'settings'));
  if (!snap.exists()) return null;
  return snap.data();
}
async function saveExpenseSettings(data) {
  await setDoc(doc(db, 'expenses', 'settings'), data, { merge: true });
}
async function loadExpenses() {
  const snap = await getDocs(collection(db, 'expenses', 'data', 'entries'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function saveExpense(expense) {
  const ref = expense.id
    ? doc(db, 'expenses', 'data', 'entries', expense.id)
    : doc(collection(db, 'expenses', 'data', 'entries'));
  await setDoc(ref, { ...expense, id: ref.id });
  return ref.id;
}
async function deleteExpense(id) {
  await deleteDoc(doc(db, 'expenses', 'data', 'entries', id));
}
async function loadMiscIncome() {
  const snap = await getDocs(collection(db, 'expenses', 'data', 'miscIncome'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function saveMiscIncome(entry) {
  const ref = entry.id
    ? doc(db, 'expenses', 'data', 'miscIncome', entry.id)
    : doc(collection(db, 'expenses', 'data', 'miscIncome'));
  await setDoc(ref, { ...entry, id: ref.id });
  return ref.id;
}
async function deleteMiscIncome(id) {
  await deleteDoc(doc(db, 'expenses', 'data', 'miscIncome', id));
}

// ── Parse Square payroll CSV ───────────────────────────────────────────────
export function parsePayrollCSV(csvText) {
  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
  // Header info
  let periodStart = '', periodEnd = '', payDate = '';
  const doctors = [];
  let totalEmployerTaxes = 0;
  let totalGross = 0;

  // Location employer tax breakdown from Withdrawal Summary
  const locEmployerTaxes = { SC: 0, F: 0, WC: 0, SV: 0 };
  const LOC_ADDR = {
    '2004 El Camino Real Santa Clara': 'SC',
    '39201 Fremont': 'F',
    '1871 N Main St Walnut Creek': 'WC',
  };

  let inWithdrawal = false;
  let headers = [];

  for (const line of lines) {
    const cells = parseCSVLine(line);
    if (cells[0] === 'Pay Period Start') { periodStart = formatDate(cells[1]); continue; }
    if (cells[0] === 'Pay Period End') { periodEnd = formatDate(cells[1]); continue; }
    if (cells[0] === 'Pay Date') { payDate = formatDate(cells[1]); continue; }
    if (cells[0] === 'Withdrawal Summary') { inWithdrawal = true; continue; }
    if (cells[0] === 'First Name' && cells[1] === 'Last Name') { headers = cells; continue; }
    if (cells[0] === 'Total') {
      totalGross = parseFloat(cells[headers.indexOf('Gross Pay')]) || 0;
      totalEmployerTaxes = parseFloat(cells[cells.length - 2]) || parseFloat(cells[headers.indexOf('ER Taxes')]) || 0;
      continue;
    }

    if (inWithdrawal) {
      // Parse per-location employer taxes
      if (cells[0] === 'ER Soc. Security' || cells[0] === 'ER Medicare' ||
          cells[0] === 'ER Fed. Unemployment' || cells[0] === 'ER CA State Employment Training' ||
          cells[0] === 'ER CA State Unemployment') {
        // cells[1]=all, cells[2]=SC addr, cells[3]=WC addr, cells[4]=F addr
        // We'll just use the total from the Total row
      }
      continue;
    }

    if (headers.length > 0 && cells[0] && cells[0] !== 'Total' && cells[1]) {
      const firstName = cells[0], lastName = cells[1];
      const gross = parseFloat(cells[headers.indexOf('Gross Pay')]) || 0;
      const net = parseFloat(cells[headers.indexOf('Net Pay')]) || 0;
      const erTaxes = parseFloat(cells[headers.indexOf('ER Taxes')]) || 0;
      const addr = cells[headers.indexOf('Work Address')] || '';

      if (gross > 0) {
        const loc = Object.entries(LOC_ADDR).find(([k]) => addr.includes(k))?.[1] || 'SC';
        doctors.push({ firstName, lastName, gross, net, erTaxes, payDate, periodStart, periodEnd, loc });
      }
    }
  }

  // Sum employer taxes by location from doctor entries
  for (const d of doctors) {
    if (LOC_LIST.includes(d.loc)) locEmployerTaxes[d.loc] += d.erTaxes;
  }

  return { periodStart, periodEnd, payDate, doctors, totalGross, totalEmployerTaxes, locEmployerTaxes };
}

function parseCSVLine(line) {
  const result = []; let cur = ''; let inQuote = false;
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === ',' && !inQuote) { result.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur.trim());
  return result;
}

function formatDate(d) {
  if (!d) return '';
  const parts = d.split('/');
  if (parts.length === 3) return `${parts[2].length === 2 ? '20' + parts[2] : parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`;
  return d;
}

// ── Editable dropdown component ────────────────────────────────────────────
function EditableDropdown({ value, onChange, options, placeholder, onAddOption, style }) {
  const [open, setOpen] = useState(false);
  const [newVal, setNewVal] = useState('');
  const ref = useRef();

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const sel = { padding: '7px 10px', border: '1.5px solid #E2E8F0', borderRadius: 7, fontSize: 13, background: 'white', cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: "'DM Sans', sans-serif", ...style };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(v => !v)} style={sel}>
        {value || <span style={{ color: '#94A3B8' }}>{placeholder}</span>}
        <span style={{ float: 'right', color: '#94A3B8' }}>▾</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #E2E8F0', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', zIndex: 100, maxHeight: 220, overflow: 'auto' }}>
          {options.map(opt => (
            <div key={opt} onClick={() => { onChange(opt); setOpen(false); }}
              style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, background: value === opt ? '#EFF6FF' : 'white', fontWeight: value === opt ? 600 : 400 }}
              onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
              onMouseLeave={e => e.currentTarget.style.background = value === opt ? '#EFF6FF' : 'white'}>
              {opt}
            </div>
          ))}
          {onAddOption && (
            <div style={{ borderTop: '1px solid #F0F4F8', padding: '8px 10px', display: 'flex', gap: 6 }}>
              <input value={newVal} onChange={e => setNewVal(e.target.value)} placeholder="Add new..." onKeyDown={e => { if (e.key === 'Enter' && newVal.trim()) { onAddOption(newVal.trim()); setNewVal(''); setOpen(false); } }}
                style={{ flex: 1, padding: '4px 8px', border: '1px solid #E2E8F0', borderRadius: 5, fontSize: 12 }} />
              <button onClick={() => { if (newVal.trim()) { onAddOption(newVal.trim()); setNewVal(''); setOpen(false); } }}
                style={{ background: '#1B3A5C', color: 'white', border: 'none', borderRadius: 5, padding: '4px 8px', cursor: 'pointer', fontSize: 11 }}>+</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Add/Edit Expense Modal ─────────────────────────────────────────────────
function ExpenseModal({ expense, onSave, onClose, categories, vendors, cards }) {
  const isNew = !expense?.id;
  const [form, setForm] = useState({
    date: expense?.date || today(),
    category: expense?.category || '',
    vendor: expense?.vendor || '',
    amount: expense?.amount || '',
    card: expense?.card || '',
    locations: expense?.locations || { SC: 0, F: 0, WC: 0, SV: 0 },
    locMode: expense?.locMode || 'all', // 'all' | 'split' | 'single'
    singleLoc: expense?.singleLoc || '',
    isReal: expense?.isReal !== false,
    isRecurring: expense?.isRecurring || false,
    recurringFreq: expense?.recurringFreq || 'Monthly',
    status: expense?.status || 'actual', // 'actual' | 'projected'
    notes: expense?.notes || '',
  });

  const inp = { padding: '7px 10px', border: '1.5px solid #E2E8F0', borderRadius: 7, fontSize: 13, fontFamily: "'DM Sans',sans-serif", outline: 'none', width: '100%' };
  const lbl = (label, children) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      {children}
    </label>
  );

  const totalAmount = parseFloat(form.amount) || 0;
  const splitTotal = Object.values(form.locations).reduce((s, v) => s + (parseFloat(v) || 0), 0);

  const save = () => {
    if (!form.date || !form.category || !form.amount) return;
    const locData = form.locMode === 'all'
      ? { SC: totalAmount / 4, F: totalAmount / 4, WC: totalAmount / 4, SV: totalAmount / 4 }
      : form.locMode === 'single'
      ? Object.fromEntries(LOC_LIST.map(l => [l, l === form.singleLoc ? totalAmount : 0]))
      : form.locations;
    onSave({ ...form, amount: totalAmount, locations: locData, id: expense?.id });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'white', borderRadius: 16, maxWidth: 580, width: '100%', maxHeight: '90vh', overflow: 'auto', padding: 28, boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 20, color: '#1B3A5C' }}>{isNew ? 'Add Expense' : 'Edit Expense'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94A3B8' }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {lbl('Date', <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={inp} />)}
          {lbl('Amount ($)', <input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} style={inp} placeholder="0.00" />)}
          {lbl('Category',
            <EditableDropdown value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} options={categories} placeholder="Select category..." />
          )}
          {lbl('Vendor',
            <EditableDropdown value={form.vendor} onChange={v => setForm(f => ({ ...f, vendor: v }))} options={vendors} placeholder="Select vendor..." onAddOption={v => setForm(f => ({ ...f, vendor: v }))} />
          )}
          {lbl('Card',
            <EditableDropdown value={form.card} onChange={v => setForm(f => ({ ...f, card: v }))} options={cards} placeholder="Select card..." />
          )}
          {lbl('Status',
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} style={{ ...inp, cursor: 'pointer' }}>
              <option value="actual">Actual</option>
              <option value="projected">Projected</option>
            </select>
          )}
        </div>

        {/* Location — 5 buttons */}
        <div style={{ marginTop: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Location</span>
          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            {[...LOC_LIST.map(l => [l, l]), ['split', 'Split']].map(([v, label]) => (
              <button key={v} onClick={() => setForm(f => ({ ...f, locMode: LOC_LIST.includes(v) ? 'single' : 'split', singleLoc: LOC_LIST.includes(v) ? v : f.singleLoc }))}
                style={{ background: (form.locMode === 'single' && form.singleLoc === v) || (form.locMode === 'split' && v === 'split') ? (LOC_COLORS[v] || '#1B3A5C') : '#F1F5F9', color: (form.locMode === 'single' && form.singleLoc === v) || (form.locMode === 'split' && v === 'split') ? 'white' : '#64748B', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                {label}
              </button>
            ))}
          </div>
          {form.locMode === 'split' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
              {LOC_LIST.map(l => (
                <label key={l} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: LOC_COLORS[l], textTransform: 'uppercase' }}>{LOC_FULL[l]}</span>
                  <input type="number" step="0.01" value={form.locations[l] || ''} onChange={e => setForm(f => ({ ...f, locations: { ...f.locations, [l]: parseFloat(e.target.value) || 0 } }))}
                    style={{ ...inp, fontSize: 12, textAlign: 'right' }} placeholder="0.00" />
                </label>
              ))}
            </div>
          )}
          {form.locMode === 'split' && Math.abs(splitTotal - totalAmount) > 0.01 && (
            <p style={{ fontSize: 11, color: '#EF4444', marginTop: 4 }}>Split total ${splitTotal.toFixed(2)} ≠ amount ${totalAmount.toFixed(2)}</p>
          )}
        </div>

        {/* Toggles */}
        <div style={{ display: 'flex', gap: 20, marginTop: 14, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={form.isReal} onChange={e => setForm(f => ({ ...f, isReal: e.target.checked }))} />
            <span>Real expense</span>
            <span style={{ fontSize: 11, color: '#94A3B8' }}>(vs. reported)</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={form.isRecurring} onChange={e => setForm(f => ({ ...f, isRecurring: e.target.checked }))} />
            <span>Recurring</span>
          </label>
          {form.isRecurring && (
            <select value={form.recurringFreq} onChange={e => setForm(f => ({ ...f, recurringFreq: e.target.value }))}
              style={{ padding: '5px 10px', border: '1.5px solid #E2E8F0', borderRadius: 6, fontSize: 12, background: 'white' }}>
              {RECURRING_FREQUENCIES.map(f => <option key={f}>{f}</option>)}
            </select>
          )}
        </div>

        {/* Notes */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Notes</span>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
            style={{ ...inp, resize: 'vertical' }} placeholder="Optional notes..." />
        </label>

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={save} style={{ background: '#1B3A5C', color: 'white', border: 'none', borderRadius: 8, padding: '10px 24px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            {isNew ? 'Add Expense' : 'Save Changes'}
          </button>
          <button onClick={onClose} style={{ background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: 8, padding: '10px 16px', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── AI Chat Widget ─────────────────────────────────────────────────────────
function AIChatWidget({ expenseData, revenueData }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const bottomRef = useRef();

  useEffect(() => { if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, open]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: 'user', content: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      // Build context summary
      const totalExpenses = expenseData.reduce((s, e) => s + e.amount, 0);
      const byCategory = {};
      for (const e of expenseData) { byCategory[e.category] = (byCategory[e.category] || 0) + e.amount; }
      const context = `Practice expense data summary:
Total expenses: $${totalExpenses.toLocaleString()}
By category: ${Object.entries(byCategory).map(([k,v]) => `${k}: $${v.toLocaleString()}`).join(', ')}
Total revenue: $${(revenueData?.totalRevenue || 0).toLocaleString()}
Net profit: $${((revenueData?.totalRevenue || 0) - totalExpenses).toLocaleString()}`;

      const response = await fetch('https://spark-dashboard-proxy.ilikebroccoli.workers.dev/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 800,
          system: `You are a financial analyst for The Spark Optometry, a 4-location optometry practice in the Bay Area. Answer questions about their practice finances concisely and helpfully. ${context}`,
          messages: newMessages,
        })
      });
      const data = await response.json();
      const reply = data.content?.find(c => c.type === 'text')?.text || 'Sorry, I could not process that.';
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error connecting to AI. Please try again.' }]);
    }
    setLoading(false);
  };

  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 500 }}>
      {open && (
        <div style={{ position: 'absolute', bottom: 56, right: 0, width: 360, background: 'white', borderRadius: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.15)', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
          <div style={{ background: '#1B3A5C', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'white', fontWeight: 600, fontSize: 13 }}>✨ Ask about your finances</span>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 16 }}>✕</button>
          </div>
          <div style={{ height: 300, overflow: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.length === 0 && (
              <div style={{ color: '#94A3B8', fontSize: 12, textAlign: 'center', paddingTop: 20 }}>
                <p style={{ marginBottom: 8 }}>Ask anything about your expenses and P&L.</p>
                <p style={{ fontSize: 11 }}>e.g. "Which category grew the most this year?" or "What's my profit margin?"</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{ background: m.role === 'user' ? '#1B3A5C' : '#F1F5F9', color: m.role === 'user' ? 'white' : '#1E293B', borderRadius: 10, padding: '8px 12px', fontSize: 12, maxWidth: '85%', lineHeight: 1.5 }}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && <div style={{ color: '#94A3B8', fontSize: 12 }}>🤖 thinking...</div>}
            <div ref={bottomRef} />
          </div>
          <div style={{ padding: '10px 12px', borderTop: '1px solid #F0F4F8', display: 'flex', gap: 8 }}>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="Ask a question..." style={{ flex: 1, padding: '7px 10px', border: '1px solid #E2E8F0', borderRadius: 7, fontSize: 12, outline: 'none' }} />
            <button onClick={send} disabled={loading} style={{ background: '#1B3A5C', color: 'white', border: 'none', borderRadius: 7, padding: '7px 12px', cursor: 'pointer', fontSize: 12 }}>→</button>
          </div>
        </div>
      )}
      <button onClick={() => setOpen(v => !v)} style={{ background: '#1B3A5C', color: 'white', border: 'none', borderRadius: '50%', width: 48, height: 48, cursor: 'pointer', fontSize: 20, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        💬
      </button>
    </div>
  );
}

// ── Printable P&L ──────────────────────────────────────────────────────────
function PrintablePL({ expenses, miscIncome, revenueStats, period, showReported, onClose }) {
  const totalRevenue = revenueStats?.totalRevenue || 0;
  const totalMisc = miscIncome.reduce((s, m) => s + m.amount, 0);
  const filteredExpenses = showReported ? expenses : expenses.filter(e => e.isReal !== false);
  const totalExpenses = filteredExpenses.reduce((s, e) => s + e.amount, 0);
  const netProfit = totalRevenue + totalMisc - totalExpenses;

  const byCategory = {};
  for (const e of filteredExpenses) {
    if (!byCategory[e.category]) byCategory[e.category] = 0;
    byCategory[e.category] += e.amount;
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <style>{`
        @media print {
          @page { size: letter portrait; margin: 0.75in; }
          body * { visibility: hidden; }
          #pl-print, #pl-print * { visibility: visible; }
          #pl-print { position: absolute; left: 0; top: 0; width: 100%; background: white; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div id="pl-print" style={{ background: 'white', borderRadius: 16, maxWidth: 680, width: '100%', maxHeight: '90vh', overflow: 'auto', padding: 32, boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}>
        <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12, gap: 10 }}>
          <button onClick={() => window.print()} style={{ background: '#1B3A5C', color: 'white', border: 'none', borderRadius: 7, padding: '8px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>🖨 Print / PDF</button>
          <button onClick={onClose} style={{ background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: 7, padding: '8px 14px', cursor: 'pointer', fontSize: 13 }}>Close</button>
        </div>

        {/* Header */}
        <div style={{ borderBottom: '2px solid #1B3A5C', paddingBottom: 14, marginBottom: 20 }}>
          <h1 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 22, color: '#1B3A5C' }}>The Spark Optometry</h1>
          <p style={{ fontSize: 14, color: '#64748B' }}>Profit & Loss Statement · {period} · {showReported ? 'Reported expenses' : 'Real expenses only'}</p>
          <p style={{ fontSize: 11, color: '#94A3B8' }}>Generated {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>

        {/* Revenue */}
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1B3A5C', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Revenue</h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, borderBottom: '1px solid #F0F4F8' }}>
            <span>Gross Revenue (production)</span><span style={{ fontWeight: 600 }}>{fmt$(totalRevenue)}</span>
          </div>
          {totalMisc > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, borderBottom: '1px solid #F0F4F8' }}>
            <span>Miscellaneous Income</span><span style={{ fontWeight: 600 }}>{fmt$(totalMisc)}</span>
          </div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: 14, fontWeight: 700, borderTop: '2px solid #1B3A5C', marginTop: 4 }}>
            <span>Total Revenue</span><span>{fmt$(totalRevenue + totalMisc)}</span>
          </div>
        </div>

        {/* Expenses */}
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1B3A5C', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Expenses</h3>
          {Object.entries(byCategory).sort(([,a],[,b]) => b - a).map(([cat, amt]) => (
            <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, borderBottom: '1px solid #F0F4F8' }}>
              <span>{cat}</span><span style={{ fontWeight: 600 }}>{fmt$(amt)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: 14, fontWeight: 700, borderTop: '2px solid #1B3A5C', marginTop: 4 }}>
            <span>Total Expenses</span><span>{fmt$(totalExpenses)}</span>
          </div>
        </div>

        {/* Net */}
        <div style={{ background: netProfit >= 0 ? '#F0FDF4' : '#FFF1F2', border: `2px solid ${netProfit >= 0 ? '#10B981' : '#EF4444'}`, borderRadius: 10, padding: '14px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 800, color: netProfit >= 0 ? '#065F46' : '#991B1B' }}>
            <span>Net {netProfit >= 0 ? 'Profit' : 'Loss'}</span>
            <span>{fmt$(Math.abs(netProfit))}</span>
          </div>
          <p style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>
            Margin: {totalRevenue > 0 ? `${(netProfit / (totalRevenue + totalMisc) * 100).toFixed(1)}%` : '—'}
          </p>
        </div>
      </div>
    </div>
  );
}


// ── Per-Location P&L Print Modal ──────────────────────────────────────────
function LocationPLPrint({ locationPL, filteredExpenses, miscIncome, period, onClose }) {
  const generated = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <style>{`
        @media print {
          @page { size: letter portrait; margin: 0.6in; }
          body * { visibility: hidden; }
          #loc-pl-print, #loc-pl-print * { visibility: visible; }
          #loc-pl-print { position: absolute; left: 0; top: 0; width: 100%; background: white; }
          .no-print { display: none !important; }
          .page-break { page-break-before: always; }
        }
      `}</style>
      <div id="loc-pl-print" style={{ background: 'white', borderRadius: 16, maxWidth: 680, width: '100%', maxHeight: '90vh', overflow: 'auto', padding: 32, boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}>
        <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginBottom: 16 }}>
          <button onClick={() => window.print()} style={{ background: '#1B3A5C', color: 'white', border: 'none', borderRadius: 7, padding: '8px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>🖨 Print / PDF</button>
          <button onClick={onClose} style={{ background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: 7, padding: '8px 14px', cursor: 'pointer', fontSize: 13 }}>Close</button>
        </div>

        {locationPL.map(({ loc, revenue }, locIdx) => {
          // Expenses allocated to this location
          const locExpenses = filteredExpenses.reduce((s, e) => s + (e.locations?.[loc] || 0), 0);
          const byCategory = {};
          for (const e of filteredExpenses) {
            const amt = e.locations?.[loc] || 0;
            if (amt > 0) byCategory[e.category] = (byCategory[e.category] || 0) + amt;
          }
          const locMisc = miscIncome.reduce((s, m) => s + (m.amount / 4), 0); // evenly split misc
          const netProfit = revenue + locMisc - locExpenses;

          return (
            <div key={loc} className={locIdx > 0 ? 'page-break' : ''} style={{ marginBottom: 40 }}>
              {/* Header */}
              <div style={{ borderBottom: '2px solid ' + LOC_COLORS[loc], paddingBottom: 10, marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: LOC_COLORS[loc] }} />
                  <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 20, color: '#1B3A5C' }}>
                    The Spark Optometry — {LOC_FULL[loc]}
                  </h2>
                </div>
                <p style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>Profit & Loss · {period} · Generated {generated}</p>
              </div>

              {/* Revenue */}
              <div style={{ marginBottom: 16 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Revenue</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #F0F4F8', fontSize: 13 }}>
                  <span>Gross Revenue (production)</span><span style={{ fontWeight: 600 }}>{fmt$(revenue)}</span>
                </div>
                {locMisc > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #F0F4F8', fontSize: 13 }}>
                  <span>Misc Income (allocated)</span><span style={{ fontWeight: 600 }}>{fmt$(locMisc)}</span>
                </div>}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', fontSize: 14, fontWeight: 700, borderTop: '2px solid #1B3A5C', marginTop: 2 }}>
                  <span>Total Revenue</span><span>{fmt$(revenue + locMisc)}</span>
                </div>
              </div>

              {/* Expenses */}
              <div style={{ marginBottom: 16 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Expenses</p>
                {Object.entries(byCategory).sort(([,a],[,b]) => b - a).map(([cat, amt]) => (
                  <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #F0F4F8', fontSize: 13 }}>
                    <span style={{ color: '#475569' }}>{cat}</span><span style={{ fontWeight: 600 }}>{fmt$(amt)}</span>
                  </div>
                ))}
                {Object.keys(byCategory).length === 0 && <p style={{ fontSize: 12, color: '#94A3B8' }}>No expenses allocated to this location.</p>}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', fontSize: 14, fontWeight: 700, borderTop: '2px solid #1B3A5C', marginTop: 2 }}>
                  <span>Total Expenses</span><span>{fmt$(locExpenses)}</span>
                </div>
              </div>

              {/* Net */}
              <div style={{ background: netProfit >= 0 ? '#F0FDF4' : '#FFF1F2', border: `2px solid ${netProfit >= 0 ? '#10B981' : '#EF4444'}`, borderRadius: 8, padding: '12px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 800, color: netProfit >= 0 ? '#065F46' : '#991B1B' }}>
                  <span>Net {netProfit >= 0 ? 'Profit' : 'Loss'}</span><span>{fmt$(Math.abs(netProfit))}</span>
                </div>
                <p style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>
                  Margin: {(revenue + locMisc) > 0 ? `${(netProfit / (revenue + locMisc) * 100).toFixed(1)}%` : '—'}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Expense Settings Modal ─────────────────────────────────────────────────
function ExpenseSettings({ settings, onSave, onClose }) {
  const [cats, setCats] = useState([...(settings?.categories || DEFAULT_CATEGORIES)]);
  const [cards, setCards] = useState([...(settings?.cards || DEFAULT_CARDS)]);
  const [vendors, setVendors] = useState([...(settings?.vendors || DEFAULT_VENDORS)]);
  const [newCat, setNewCat] = useState('');
  const [newCard, setNewCard] = useState('');
  const [newVendor, setNewVendor] = useState('');
  const [activeTab, setActiveTab] = useState('categories');

  const addItem = (list, setList, val, setVal) => {
    if (!val.trim() || list.includes(val.trim())) return;
    setList(prev => [...prev, val.trim()]);
    setVal('');
  };
  const removeItem = (list, setList, item) => setList(prev => prev.filter(x => x !== item));

  const save = () => onSave({ ...settings, categories: cats, cards, vendors });

  const inp = { padding: '7px 10px', border: '1.5px solid #E2E8F0', borderRadius: 7, fontSize: 13, fontFamily: "'DM Sans',sans-serif", outline: 'none' };

  const listSection = (label, list, setList, newVal, setNewVal) => (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input value={newVal} onChange={e => setNewVal(e.target.value)} placeholder={`Add ${label.toLowerCase()}...`} style={{ ...inp, flex: 1 }}
          onKeyDown={e => e.key === 'Enter' && addItem(list, setList, newVal, setNewVal)} />
        <button onClick={() => addItem(list, setList, newVal, setNewVal)}
          style={{ background: '#1B3A5C', color: 'white', border: 'none', borderRadius: 7, padding: '7px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>+ Add</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300, overflow: 'auto' }}>
        {list.map(item => (
          <div key={item} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 12px', background: '#F8FAFC', borderRadius: 7, border: '1px solid #E2E8F0' }}>
            <span style={{ fontSize: 13 }}>{item}</span>
            <button onClick={() => removeItem(list, setList, item)}
              style={{ background: '#FEE2E2', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', color: '#DC2626', fontSize: 11 }}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'white', borderRadius: 16, maxWidth: 520, width: '100%', maxHeight: '88vh', overflow: 'auto', padding: 28, boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 20, color: '#1B3A5C' }}>⚙ Expense Settings</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94A3B8' }}>✕</button>
        </div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          {[['categories','Categories'],['cards','Cards'],['vendors','Vendors']].map(([tab,label]) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{ background: activeTab===tab?'#1B3A5C':'#F1F5F9', color: activeTab===tab?'white':'#64748B', border: 'none', borderRadius: 7, padding: '7px 16px', cursor: 'pointer', fontSize: 12, fontWeight: activeTab===tab?700:400 }}>
              {label}
            </button>
          ))}
        </div>
        {activeTab === 'categories' && listSection('Category', cats, setCats, newCat, setNewCat)}
        {activeTab === 'cards' && listSection('Card', cards, setCards, newCard, setNewCard)}
        {activeTab === 'vendors' && listSection('Vendor', vendors, setVendors, newVendor, setNewVendor)}
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={save} style={{ background: '#10B981', color: 'white', border: 'none', borderRadius: 8, padding: '10px 24px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Save Settings</button>
          <button onClick={onClose} style={{ background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: 8, padding: '10px 16px', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Main ExpensesView ──────────────────────────────────────────────────────
export default function ExpensesView({ allPatients, allPayments, onPayrollUploaded }) {
  const [loading, setLoading] = useState(true);
  const [expenses, setExpenses] = useState([]);
  const [miscIncome, setMiscIncome] = useState([]);
  const [settings, setSettings] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editExpense, setEditExpense] = useState(null);
  const [showPL, setShowPL] = useState(false);
  const [showLocPL, setShowLocPL] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showReported, setShowReported] = useState(false);
  const [periodFilter, setPeriodFilter] = useState('annual');
  const [yearFilter, setYearFilter] = useState('2026');
  const [monthFilter, setMonthFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showMiscForm, setShowMiscForm] = useState(false);
  const [miscForm, setMiscForm] = useState({ date: today(), description: '', amount: '' });
  const [payrollUploading, setPayrollUploading] = useState(false);
  const [payrollResult, setPayrollResult] = useState(null);
  const [aiInsight, setAiInsight] = useState(null);
  const [analyzingAI, setAnalyzingAI] = useState(false);
  const csvRef = useRef();

  const cats = settings?.categories || DEFAULT_CATEGORIES;
  const cards = settings?.cards || DEFAULT_CARDS;
  const vendors = settings?.vendors || DEFAULT_VENDORS;

  useEffect(() => {
    async function load() {
      try {
        const [s, e, m] = await Promise.all([loadExpenseSettings(), loadExpenses(), loadMiscIncome()]);
        setSettings(s || { categories: DEFAULT_CATEGORIES, cards: DEFAULT_CARDS, vendors: DEFAULT_VENDORS });
        setExpenses(e);
        setMiscIncome(m);
      } catch (err) { console.error(err); }
      setLoading(false);
    }
    load();
  }, []);

  // Revenue stats from production data
  const revenueStats = useMemo(() => {
    if (!allPatients?.length) return null;
    const filtered = allPatients.filter(p => {
      if (yearFilter !== 'all' && String(p.year) !== yearFilter) return false;
      if (monthFilter && p.month !== parseInt(monthFilter)) return false;
      return true;
    });
    const yangDays = new Set(filtered.filter(p => p.doctor === 'Yang').map(p => p.date + p.loc));
    const withoutYang = filtered.filter(p => !yangDays.has(p.date + p.loc));
    const byLoc = {};
    for (const loc of LOC_LIST) {
      const lp = filtered.filter(p => p.loc === loc);
      byLoc[loc] = lp.reduce((s, p) => s + p.total, 0);
    }
    return {
      totalRevenue: filtered.reduce((s, p) => s + p.total, 0),
      revenueExYang: withoutYang.reduce((s, p) => s + p.total, 0),
      byLocation: byLoc,
    };
  }, [allPatients, yearFilter, monthFilter]);

  // Filter expenses
  const filteredExpenses = useMemo(() => {
    return expenses.filter(e => {
      if (!showReported && e.isReal === false) return false;
      if (e.status === 'projected') return false; // separate
      const year = e.date?.slice(0, 4);
      const month = e.date?.slice(5, 7);
      if (yearFilter !== 'all' && year !== yearFilter) return false;
      if (monthFilter && month !== monthFilter.padStart(2, '0')) return false;
      if (categoryFilter && e.category !== categoryFilter) return false;
      return true;
    });
  }, [expenses, showReported, yearFilter, monthFilter, categoryFilter]);

  const totalExpenses = filteredExpenses.reduce((s, e) => s + e.amount, 0);
  const totalMiscIncome = miscIncome.filter(m => {
    const year = m.date?.slice(0, 4);
    return yearFilter === 'all' || year === yearFilter;
  }).reduce((s, m) => s + m.amount, 0);
  const netProfit = (revenueStats?.totalRevenue || 0) + totalMiscIncome - totalExpenses;

  // Category breakdown
  const byCategory = useMemo(() => {
    const map = {};
    for (const e of filteredExpenses) {
      if (!map[e.category]) map[e.category] = 0;
      map[e.category] += e.amount;
    }
    return Object.entries(map).sort(([, a], [, b]) => b - a);
  }, [filteredExpenses]);

  // Per-location P&L
  const locationPL = useMemo(() => {
    return LOC_LIST.map(loc => {
      const revenue = revenueStats?.byLocation[loc] || 0;
      const expTotal = filteredExpenses.reduce((s, e) => s + (e.locations?.[loc] || 0), 0);
      return { loc, revenue, expenses: expTotal, profit: revenue - expTotal };
    });
  }, [filteredExpenses, revenueStats]);

  const handleSaveExpense = async (expense) => {
    const id = await saveExpense({ ...expense, id: expense.id || uid() });
    if (expense.id) {
      setExpenses(prev => prev.map(e => e.id === expense.id ? { ...expense, id } : e));
    } else {
      setExpenses(prev => [...prev, { ...expense, id }]);
    }

    // If recurring, generate future projected entries
    if (expense.isRecurring && !expense.id) {
      const freqMonths = { Monthly: 1, Quarterly: 3, 'Semi-Annual': 6, Annual: 12 }[expense.recurringFreq] || 1;
      const baseDate = new Date(expense.date + 'T00:00:00');
      const projections = [];
      for (let i = 1; i <= 12; i++) {
        const nextDate = new Date(baseDate);
        nextDate.setMonth(nextDate.getMonth() + freqMonths * i);
        if (nextDate.getFullYear() > parseInt(yearFilter) + 1) break;
        const proj = { ...expense, id: uid(), date: nextDate.toISOString().slice(0, 10), status: 'projected' };
        projections.push(proj);
        await saveExpense(proj);
      }
      setExpenses(prev => [...prev, ...projections]);
    }

    setShowModal(false);
    setEditExpense(null);
  };

  const handleDeleteExpense = async (id) => {
    if (!window.confirm('Delete this expense?')) return;
    await deleteExpense(id);
    setExpenses(prev => prev.filter(e => e.id !== id));
  };

  const handleSaveMisc = async () => {
    if (!miscForm.date || !miscForm.amount) return;
    const entry = { ...miscForm, amount: parseFloat(miscForm.amount), id: uid() };
    const id = await saveMiscIncome(entry);
    setMiscIncome(prev => [...prev, { ...entry, id }]);
    setMiscForm({ date: today(), description: '', amount: '' });
    setShowMiscForm(false);
  };

  const handlePayrollCSV = async (file) => {
    if (!file) return;
    setPayrollUploading(true);
    try {
      const text = await file.text();
      const result = parsePayrollCSV(text);
      setPayrollResult(result);

      // Save payroll expense entries
      const payrollEntry = {
        id: uid(), date: result.payDate,
        category: 'Payroll', vendor: 'Square Payroll',
        amount: result.totalGross, card: 'Business Checking',
        locations: result.locEmployerTaxes, // use as proxy for now
        locMode: 'split', isReal: true, isRecurring: false,
        status: 'actual', notes: `Pay period: ${result.periodStart} → ${result.periodEnd}. ${result.doctors.length} employees.`,
      };
      const taxEntry = {
        id: uid(), date: result.payDate,
        category: 'Payroll Taxes', vendor: 'IRS / EDD',
        amount: result.totalEmployerTaxes, card: 'Business Checking',
        locations: result.locEmployerTaxes, locMode: 'split',
        isReal: true, isRecurring: false, status: 'actual',
        notes: `Employer taxes for ${result.periodStart} → ${result.periodEnd}`,
      };

      await Promise.all([saveExpense(payrollEntry), saveExpense(taxEntry)]);
      setExpenses(prev => [...prev, payrollEntry, taxEntry]);

      if (onPayrollUploaded) onPayrollUploaded(result);
    } catch (e) {
      console.error(e);
      alert('Could not parse payroll CSV. Make sure it is the Square Payroll Summary CSV.');
    }
    setPayrollUploading(false);
  };

  const runAIAnalysis = async () => {
    setAnalyzingAI(true);
    try {
      const summary = {
        totalRevenue: revenueStats?.totalRevenue || 0,
        totalExpenses,
        netProfit,
        margin: revenueStats?.totalRevenue ? (netProfit / revenueStats.totalRevenue * 100).toFixed(1) : 0,
        byCategory: Object.fromEntries(byCategory),
        locationPL: locationPL.map(l => ({ loc: l.loc, revenue: Math.round(l.revenue), expenses: Math.round(l.expenses), profit: Math.round(l.profit) })),
      };

      const response = await fetch('https://spark-dashboard-proxy.ilikebroccoli.workers.dev/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: `Analyze this optometry practice P&L data and return ONLY valid JSON:
${JSON.stringify(summary)}
{"flags":["..."],"opportunities":["..."],"locationNotes":["..."],"wins":["..."]}
2-3 items per array. Be specific with numbers. Flag any location with negative P&L. Flag if payroll >50% of revenue. Identify highest-spending category vs revenue. Keep each point under 100 chars.`
          }]
        })
      });
      const data = await response.json();
      const text = data.content?.find(c => c.type === 'text')?.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) setAiInsight(JSON.parse(jsonMatch[0]));
    } catch (e) { console.error(e); }
    setAnalyzingAI(false);
  };

  if (loading) return <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>Loading expenses…</div>;

  const inp = { padding: '7px 10px', border: '1.5px solid #E2E8F0', borderRadius: 7, fontSize: 12, fontFamily: "'DM Sans',sans-serif", outline: 'none', background: 'white' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Top controls ── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={yearFilter} onChange={e => setYearFilter(e.target.value)} style={inp}>
          <option value="all">All Years</option>
          <option value="2024">2024</option>
          <option value="2025">2025</option>
          <option value="2026">2026</option>
        </select>
        <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)} style={inp}>
          <option value="">All Months</option>
          {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
            <option key={i+1} value={String(i+1)}>{m}</option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={showReported} onChange={e => setShowReported(e.target.checked)} />
          Include reported (non-real) expenses
        </label>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={runAIAnalysis} disabled={analyzingAI}
            style={{ background: analyzingAI ? '#94A3B8' : '#1B3A5C', color: 'white', border: 'none', borderRadius: 7, padding: '8px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            {analyzingAI ? '🤖 Analyzing...' : '✨ AI Analysis'}
          </button>
          <button onClick={() => setShowPL(true)}
            style={{ background: '#2E7D8C', color: 'white', border: 'none', borderRadius: 7, padding: '8px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            🖨 P&L Report
          </button>
          <input ref={csvRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => handlePayrollCSV(e.target.files[0])} />
          <button onClick={() => csvRef.current.click()} disabled={payrollUploading}
            style={{ background: '#10B981', color: 'white', border: 'none', borderRadius: 7, padding: '8px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            {payrollUploading ? 'Importing...' : '📂 Upload Payroll CSV'}
          </button>
          <button onClick={() => setShowSettings(true)}
            style={{ background: '#64748B', color: 'white', border: 'none', borderRadius: 7, padding: '8px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            ⚙ Settings
          </button>
          <button onClick={() => { setEditExpense(null); setShowModal(true); }}
            style={{ background: '#C9A84C', color: 'white', border: 'none', borderRadius: 7, padding: '8px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            + Add Expense
          </button>
        </div>
      </div>

      {/* Payroll import result */}
      {payrollResult && (
        <div style={{ background: '#D1FAE5', border: '1px solid #6EE7B7', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#065F46' }}>
          ✓ Payroll imported: {payrollResult.periodStart} → {payrollResult.periodEnd} · Gross {fmt$(payrollResult.totalGross)} · Employer taxes {fmt$(payrollResult.totalEmployerTaxes)} · {payrollResult.doctors.length} employees
          <button onClick={() => setPayrollResult(null)} style={{ marginLeft: 12, background: 'none', border: 'none', color: '#065F46', cursor: 'pointer', fontSize: 12 }}>✕</button>
        </div>
      )}

      {/* AI Insights */}
      {aiInsight && (
        <div style={{ background: 'white', borderRadius: 14, padding: '18px 22px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #E2E8F0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 16, color: '#1B3A5C' }}>✨ AI Analysis</h3>
            <button onClick={() => setAiInsight(null)} style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer' }}>✕</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {[
              { key: 'flags', label: '🚨 Flags', bg: '#FFF1F2', border: '#FECDD3', color: '#BE123C' },
              { key: 'opportunities', label: '💡 Opportunities', bg: '#FFFBEB', border: '#FDE68A', color: '#92400E' },
              { key: 'locationNotes', label: '📍 Location Notes', bg: '#EFF6FF', border: '#BFDBFE', color: '#1D4ED8' },
              { key: 'wins', label: "✅ What's Working", bg: '#F0FDF4', border: '#BBF7D0', color: '#15803D' },
            ].map(({ key, label, bg, border, color }) => (
              aiInsight[key]?.length > 0 && (
                <div key={key} style={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: '12px 14px' }}>
                  <p style={{ fontWeight: 700, color, fontSize: 12, marginBottom: 8 }}>{label}</p>
                  {aiInsight[key].map((item, i) => <p key={i} style={{ fontSize: 11, color: '#374151', margin: '0 0 5px 0', lineHeight: 1.5 }}>• {item}</p>)}
                </div>
              )
            ))}
          </div>
        </div>
      )}

      {/* ── P&L Summary ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px,1fr))', gap: 12 }}>
        <StatCard label="Gross Revenue" value={fmt$(revenueStats?.totalRevenue || 0)} color="#2E7D8C" small />
        <StatCard label="Revenue ex-Yang" value={fmt$(revenueStats?.revenueExYang || 0)} color="#1B3A5C" small />
        <StatCard label="Misc Income" value={fmt$(totalMiscIncome)} color="#10B981" small />
        <StatCard label="Total Expenses" value={fmt$(totalExpenses)} color="#EF4444" small />
        <StatCard label="Net Profit" value={fmt$(netProfit)} color={netProfit >= 0 ? '#10B981' : '#EF4444'} small />
        <StatCard label="Margin" value={revenueStats?.totalRevenue ? fmtPct(netProfit / revenueStats.totalRevenue) : '—'} color={netProfit >= 0 ? '#10B981' : '#EF4444'} small />
      </div>

      {/* ── Per-location P&L ── */}
      <div style={{ background: 'white', borderRadius: 14, padding: '18px 22px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 16, color: '#1B3A5C' }}>Per-Location P&L</h3>
          <button onClick={() => setShowLocPL(true)} style={{ background: '#2E7D8C', color: 'white', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>🖨 Print</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
          {locationPL.map(({ loc, revenue, expenses: exp, profit }) => (
            <div key={loc} style={{ background: '#F8FAFC', borderRadius: 10, padding: '14px 16px', border: `2px solid ${profit >= 0 ? '#E2E8F0' : '#FECDD3'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: LOC_COLORS[loc] }} />
                <span style={{ fontWeight: 700, fontSize: 13, color: '#1B3A5C' }}>{LOC_FULL[loc]}</span>
              </div>
              {[['Revenue', revenue, '#2E7D8C'], ['Expenses', exp, '#EF4444'], ['Profit', profit, profit >= 0 ? '#10B981' : '#EF4444']].map(([l, v, c]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: '#64748B' }}>{l}</span>
                  <span style={{ fontWeight: 600, color: c }}>{fmt$(v)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── Category breakdown ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: 'white', borderRadius: 14, padding: '18px 22px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <h3 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 16, color: '#1B3A5C', marginBottom: 14 }}>Spending by Category</h3>
          {byCategory.map(([cat, amt]) => (
            <div key={cat} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                <span style={{ color: '#475569', cursor: 'pointer', textDecoration: categoryFilter === cat ? 'underline' : 'none' }}
                  onClick={() => setCategoryFilter(categoryFilter === cat ? '' : cat)}>{cat}</span>
                <span style={{ fontWeight: 600 }}>{fmt$(amt)} <span style={{ color: '#94A3B8', fontWeight: 400 }}>({(amt / totalExpenses * 100).toFixed(1)}%)</span></span>
              </div>
              <div style={{ height: 5, background: '#F0F4F8', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${amt / totalExpenses * 100}%`, background: '#2E7D8C', borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </div>

        {/* Misc Income */}
        <div style={{ background: 'white', borderRadius: 14, padding: '18px 22px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 16, color: '#1B3A5C' }}>Misc Income</h3>
            <button onClick={() => setShowMiscForm(v => !v)} style={{ background: '#10B981', color: 'white', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>+ Add</button>
          </div>
          {showMiscForm && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12, padding: '12px', background: '#F8FAFC', borderRadius: 8 }}>
              <input type="date" value={miscForm.date} onChange={e => setMiscForm(f => ({ ...f, date: e.target.value }))} style={{ ...inp, fontSize: 12 }} />
              <input type="number" step="0.01" value={miscForm.amount} onChange={e => setMiscForm(f => ({ ...f, amount: e.target.value }))} placeholder="Amount" style={{ ...inp, fontSize: 12 }} />
              <input value={miscForm.description} onChange={e => setMiscForm(f => ({ ...f, description: e.target.value }))} placeholder="Description (e.g. No-show fee)" style={{ ...inp, fontSize: 12, gridColumn: 'span 2' }} />
              <button onClick={handleSaveMisc} style={{ background: '#10B981', color: 'white', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Save</button>
              <button onClick={() => setShowMiscForm(false)} style={{ background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
            </div>
          )}
          <div style={{ maxHeight: 220, overflow: 'auto' }}>
            {miscIncome.length === 0 ? <p style={{ color: '#94A3B8', fontSize: 12 }}>No misc income logged yet.</p> : (
              miscIncome.sort((a, b) => b.date.localeCompare(a.date)).map((m, i) => (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #F0F4F8', fontSize: 12 }}>
                  <div>
                    <span style={{ color: '#475569' }}>{m.description || '—'}</span>
                    <span style={{ color: '#94A3B8', marginLeft: 8, fontSize: 11 }}>{fmtDate(m.date)}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600, color: '#10B981' }}>{fmt$(m.amount)}</span>
                    <button onClick={async () => { await deleteMiscIncome(m.id); setMiscIncome(prev => prev.filter(x => x.id !== m.id)); }}
                      style={{ background: '#FEE2E2', border: 'none', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', color: '#DC2626', fontSize: 10 }}>✕</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Expense ledger ── */}
      <div style={{ background: 'white', borderRadius: 14, padding: '18px 22px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 16, color: '#1B3A5C' }}>
            Expense Ledger {categoryFilter && <span style={{ fontSize: 13, color: '#2E7D8C', fontWeight: 400 }}>— {categoryFilter} <button onClick={() => setCategoryFilter('')} style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: 11 }}>✕</button></span>}
          </h3>
          <span style={{ fontSize: 12, color: '#94A3B8' }}>{filteredExpenses.length} entries · {fmt$(totalExpenses)}</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #F0F4F8' }}>
                {['Date', 'Category', 'Vendor', 'Amount', 'Card', 'Location', 'Type', ''].map(h => (
                  <th key={h} style={{ padding: '7px 10px', textAlign: h === 'Amount' ? 'right' : 'left', fontSize: 10, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredExpenses.sort((a, b) => b.date.localeCompare(a.date)).map((e, i) => (
                <tr key={e.id} style={{ background: i % 2 === 0 ? 'white' : '#FAFBFC', borderBottom: '1px solid #F0F4F8' }}>
                  <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{fmtDate(e.date)}</td>
                  <td style={{ padding: '7px 10px' }}>
                    <span style={{ background: '#F1F5F9', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600, color: '#475569' }}>{e.category}</span>
                  </td>
                  <td style={{ padding: '7px 10px', color: '#64748B' }}>{e.vendor || '—'}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: '#EF4444' }}>{fmt$(e.amount)}</td>
                  <td style={{ padding: '7px 10px', color: '#94A3B8', fontSize: 11 }}>{e.card || '—'}</td>
                  <td style={{ padding: '7px 10px', fontSize: 11 }}>
                    {e.locMode === 'all' ? 'All' : e.locMode === 'single' ? e.singleLoc : 'Split'}
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {e.isReal === false && <span style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 3, padding: '1px 5px', fontSize: 9, fontWeight: 700 }}>RPT</span>}
                      {e.isRecurring && <span style={{ background: '#EFF6FF', color: '#1D4ED8', borderRadius: 3, padding: '1px 5px', fontSize: 9, fontWeight: 700 }}>REC</span>}
                    </div>
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => { setEditExpense(e); setShowModal(true); }} style={{ background: '#EFF6FF', border: 'none', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', color: '#1D4ED8', fontSize: 10 }}>Edit</button>
                      <button onClick={() => handleDeleteExpense(e.id)} style={{ background: '#FEE2E2', border: 'none', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', color: '#DC2626', fontSize: 10 }}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredExpenses.length === 0 && (
                <tr><td colSpan={8} style={{ padding: '24px', textAlign: 'center', color: '#94A3B8' }}>No expenses logged for this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {showModal && (
        <ExpenseModal
          expense={editExpense}
          onSave={handleSaveExpense}
          onClose={() => { setShowModal(false); setEditExpense(null); }}
          categories={cats}
          vendors={vendors}
          cards={cards}
        />
      )}
      {showPL && (
        <PrintablePL
          expenses={filteredExpenses}
          miscIncome={miscIncome}
          revenueStats={revenueStats}
          period={`${yearFilter}${monthFilter ? ' — ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(monthFilter)-1] : ''}`}
          showReported={showReported}
          onClose={() => setShowPL(false)}
        />
      )}

      {showLocPL && (
        <LocationPLPrint locationPL={locationPL} filteredExpenses={filteredExpenses} miscIncome={miscIncome} period={`${yearFilter}${monthFilter ? ' — ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(monthFilter)-1] : ''}`} onClose={() => setShowLocPL(false)} />
      )}

      {showSettings && (
        <ExpenseSettings settings={settings} onSave={async (newSettings) => { await saveExpenseSettings(newSettings); setSettings(newSettings); setShowSettings(false); }} onClose={() => setShowSettings(false)} />
      )}

      <AIChatWidget expenseData={filteredExpenses} revenueData={revenueStats} />
    </div>
  );
}
