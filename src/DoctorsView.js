import React, { useState, useEffect, useMemo } from 'react';
import { RunPayrollTab, DaysWorkedTab } from './PayrollTools';
import * as XLSX from 'xlsx';
import {
  DEFAULT_ROSTER, DOCTOR_TYPE_LABELS, BONUS_ELIGIBLE,
  GROSS_BONUS, MYOPIA_BONUS, LASIK_BONUS,
  calcDayBonus, computeDoctorStats,
  loadRoster, saveRosterDoctor,
  loadDoctorProfiles, saveDoctorProfile,
  loadPayments, savePayment, deletePayment,
  parseSquarePayrollXLSX, matchSquareName,
} from './doctorData';
import {
  StatCard, ChartCard, SectionHeader, SimpleBarChart, DataTable,
  fmt$, fmtPct, fmtNum, fmtDec, MONTH_SHORT,
} from './components';

const LOC_LABELS = { SC: 'Santa Clara', F: 'Fremont', WC: 'Walnut Creek', SV: 'Sunnyvale' };

function uid() { return Math.random().toString(36).slice(2, 9); }
function today() { return new Date().toISOString().slice(0, 10); }
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const TYPE_COLORS = {
  ft:    { bg: '#DBEAFE', text: '#1D4ED8' },
  ppt:   { bg: '#D1FAE5', text: '#065F46' },
  fill:  { bg: '#FEF3C7', text: '#92400E' },
  owner: { bg: '#F3E8FF', text: '#6B21A8' },
};

function TypeBadge({ type }) {
  const c = TYPE_COLORS[type] || { bg: '#F1F5F9', text: '#475569' };
  return (
    <span style={{ background: c.bg, color: c.text, borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 600 }}>
      {DOCTOR_TYPE_LABELS[type] || type}
    </span>
  );
}

// ── Sub-views ──────────────────────────────────────────────────────────────
const DOCTOR_TABS = ['overview', 'payroll', 'days', 'performance', 'notes'];
const MAIN_TABS = ['runpayroll'];
const TAB_LABELS = { overview: 'Profile', payroll: 'Payroll', days: 'Days Worked', performance: 'Performance', notes: 'Notes' };

// ── Profile / Overview ─────────────────────────────────────────────────────
function ProfileTab({ doctor, profile, onSave }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    startDate: profile.startDate || '',
    perDiem: profile.perDiem || '',
    pct: profile.pct || (doctor.payType === 'perdiem_pct' ? '30' : ''),
    ptoAllowance: profile.ptoAllowance || (doctor.type === 'ft' ? '10' : '0'),
    ptoUsed: profile.ptoUsed || '0',
    healthStipend: profile.healthStipend || '',
    uniformStipend: profile.uniformStipend || '',
    ceStipend: profile.ceStipend || '',
    mileageRate: profile.mileageRate || '',
    otherPerks: profile.otherPerks || '',
    email: profile.email || '',
    phone: profile.phone || '',
    dob: profile.dob || '',
    npi: profile.npi || '',
    licenseNumber: profile.licenseNumber || '',
    licenseExpiry: profile.licenseExpiry || '',
    malpracticeCarrier: profile.malpracticeCarrier || '',
    malpracticeExpiry: profile.malpracticeExpiry || '',
    documents: profile.documents || [
      { label: '', url: '' },
      { label: '', url: '' },
      { label: '', url: '' },
      { label: '', url: '' },
      { label: '', url: '' },
    ],
    // Day-of-week per diem rates (default all to base perDiem)
    perDiemByDay: profile.perDiemByDay || { Mon:'', Tue:'', Wed:'', Thu:'', Fri:'', Sat:'', Sun:'' },
    // Location per day of week (array of locs)
    locationsByDay: profile.locationsByDay || { Mon:[], Tue:[], Wed:[], Thu:[], Fri:[], Sat:[], Sun:[] },
    // Bonus config
    bonusEligible: profile.bonusEligible !== undefined ? profile.bonusEligible : (doctor.payType === 'perdiem_pct'),
    bonusThreshold: profile.bonusThreshold || '1200',
    bonusPct: profile.bonusPct || (doctor.payType === 'perdiem_pct' ? '30' : ''),
  });

  // Age from DOB
  const calcAge = (dob) => {
    if (!dob) return null;
    const birth = new Date(dob + 'T00:00:00'), now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    if (now < new Date(now.getFullYear(), birth.getMonth(), birth.getDate())) age--;
    return age;
  };
  // Days until next birthday
  const daysUntilBirthday = (dob) => {
    if (!dob) return null;
    const birth = new Date(dob + 'T00:00:00'), now = new Date();
    const next = new Date(now.getFullYear(), birth.getMonth(), birth.getDate());
    if (next < now) next.setFullYear(now.getFullYear() + 1);
    return Math.ceil((next - now) / (1000 * 60 * 60 * 24));
  };
  // Days until expiry
  const daysUntil = (dateStr) => {
    if (!dateStr) return null;
    const d = new Date(dateStr + 'T00:00:00'), now = new Date();
    return Math.ceil((d - now) / (1000 * 60 * 60 * 24));
  };
  const lastPaidDate = (type, paymentsArr) => {
    if (!paymentsArr) return null;
    const matching = paymentsArr.filter(p => p.type === type).sort((a,b) => b.date.localeCompare(a.date));
    return matching.length ? matching[0].date : null;
  };

  const projectedYearlyPay = (paymentsArr) => {
    if (!paymentsArr || paymentsArr.length === 0) return null;
    const sorted = [...paymentsArr].sort((a,b) => a.date.localeCompare(b.date));
    const first = new Date(sorted[0].date + 'T00:00:00');
    const last = new Date(sorted[sorted.length-1].date + 'T00:00:00');
    const weeks = Math.max((last - first) / (1000*60*60*24*7), 1);
    const total = paymentsArr.reduce((s,p) => s + p.amount, 0);
    return Math.round(total / weeks * 52);
  };

  const expiryColor = (days) => {
    if (days === null) return null;
    if (days <= 30) return '#DC2626';
    if (days <= 90) return '#D97706';
    return '#10B981';
  };

  const hasPTO = doctor.type === 'ft'; // only Kha and Pan
  const hasBonus = doctor.payType === 'perdiem_pct';
  const ptoBalance = parseFloat(form.ptoAllowance || 0) - parseFloat(form.ptoUsed || 0);

  const save = async () => {
    await onSave(form);
    setEditing(false);
  };

  const inp = (label, key, type = 'text', hint = '') => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <input type={type} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        style={{ padding: '7px 10px', border: '1.5px solid #E2E8F0', borderRadius: 7, fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: 'none' }} />
      {hint && <span style={{ fontSize: 11, color: '#94A3B8' }}>{hint}</span>}
    </label>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px,1fr))', gap: 12 }}>
        <StatCard label="Employment Type" value={DOCTOR_TYPE_LABELS[doctor.type]} color="#2E7D8C" small />
        <StatCard label="Per Diem" value={(() => {
          const rates = profile.perDiemByDay ? Object.values(profile.perDiemByDay).filter(v=>v&&parseFloat(v)>0).map(v=>parseFloat(v)) : [];
          if (rates.length === 0) return profile.perDiem ? fmt$(parseFloat(profile.perDiem)) : '—';
          const min = Math.min(...rates), max = Math.max(...rates);
          return min === max ? fmt$(min) : `${fmt$(min)}–${fmt$(max)}`;
        })()} color="#1B3A5C" small />
        {profile.bonusEligible && <StatCard label="Bonus %" value={`${profile.bonusPct||30}% over $${profile.bonusThreshold||1200}`} color="#C9A84C" small />}
        {hasPTO && <StatCard label="PTO Balance" value={`${ptoBalance} days`} color={ptoBalance < 2 ? '#EF4444' : '#10B981'} small />}
        {projectedYearlyPay(profile._payments) && <StatCard label="Projected Yearly" value={fmt$(projectedYearlyPay(profile._payments))} color="#8B5CF6" small />}
      </div>

      {/* Pay structure card */}
      <div style={{ background: 'white', borderRadius: 12, padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, color: '#1B3A5C' }}>Pay Structure & Details</h3>
          {!editing && <button onClick={() => setEditing(true)} style={{ background: '#F1F5F9', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#475569' }}>Edit</button>}
        </div>

        {!editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Contact & Personal */}
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#CBD5E1', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Contact & Personal</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px 20px', fontSize: 13 }}>
                {[
                  ['Email', profile.email || '—'],
                  ['Phone', profile.phone || '—'],
                  profile.dob ? null : null,
                ].filter(Boolean).map(([label, val]) => (
                  <div key={label}>
                    <span style={{ color: '#94A3B8', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
                    <div style={{ fontWeight: 600, color: '#1E293B', marginTop: 2 }}>{val}</div>
                  </div>
                ))}
                {profile.dob && (() => {
                  const age = calcAge(profile.dob);
                  const bdays = daysUntilBirthday(profile.dob);
                  return (
                    <div>
                      <span style={{ color: '#94A3B8', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date of Birth</span>
                      <div style={{ fontWeight: 600, color: '#1E293B', marginTop: 2 }}>
                        {fmtDate(profile.dob)} · Age {age}
                        {bdays <= 14 && <span style={{ marginLeft: 6, fontSize: 11, color: '#8B5CF6' }}>🎂 {bdays === 0 ? 'Today!' : `in ${bdays}d`}</span>}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
            {/* Pay Structure */}
            <div style={{ borderTop: '1px solid #F0F4F8', paddingTop: 14 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#CBD5E1', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Pay Structure</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px', fontSize: 13 }}>
                {profile.perDiem && <div><span style={{ color: '#94A3B8', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Per Diem Rate</span><div style={{ fontWeight: 700, color: '#1B3A5C', marginTop: 2 }}>{fmt$(parseFloat(profile.perDiem))}</div></div>}
                {hasBonus && <div><span style={{ color: '#94A3B8', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Gross % (over $1,200)</span><div style={{ fontWeight: 700, color: '#C9A84C', marginTop: 2 }}>{profile.pct || 30}%</div></div>}
                {profile.otherPerks && <div style={{ gridColumn: 'span 2' }}><span style={{ color: '#94A3B8', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Other Perks / Promises</span><div style={{ fontWeight: 600, color: '#1E293B', marginTop: 2 }}>{profile.otherPerks}</div></div>}
              </div>
              {hasPTO && (
                <div style={{ marginTop: 10, display: 'flex', gap: 0, background: '#F8FAFC', borderRadius: 8, overflow: 'hidden', border: '1px solid #E2E8F0' }}>
                  {[['PTO Allowance', `${profile.ptoAllowance || 0} days/yr`], ['PTO Used', `${profile.ptoUsed || 0} days`], ['PTO Balance', `${ptoBalance} days`, ptoBalance < 2 ? '#DC2626' : '#10B981']].map(([label, val, color]) => (
                    <div key={label} style={{ flex: 1, padding: '10px 14px', borderRight: '1px solid #E2E8F0' }}>
                      <span style={{ color: '#94A3B8', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
                      <div style={{ fontWeight: 700, color: color || '#1E293B', marginTop: 2, fontSize: 14 }}>{val}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Stipends */}
            {(profile.healthStipend || profile.uniformStipend || profile.ceStipend || profile.mileageRate) && (
              <div style={{ borderTop: '1px solid #F0F4F8', paddingTop: 14 }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: '#CBD5E1', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Stipends & Reimbursements</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px', fontSize: 13 }}>
                  {[
                    profile.healthStipend ? ['Health Stipend', fmt$(parseFloat(profile.healthStipend)), 'health_stipend'] : null,
                    profile.uniformStipend ? ['Uniform Stipend', fmt$(parseFloat(profile.uniformStipend)), 'uniform_stipend'] : null,
                    profile.ceStipend ? ['CE Stipend', fmt$(parseFloat(profile.ceStipend)), 'ce_stipend'] : null,
                    profile.mileageRate ? ['Mileage Rate', `$${profile.mileageRate}/mi`, 'mileage'] : null,
                  ].filter(Boolean).map(([label, val, type]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#F8FAFC', borderRadius: 7, padding: '8px 12px', border: '1px solid #E2E8F0' }}>
                      <div>
                        <span style={{ color: '#94A3B8', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
                        <div style={{ fontWeight: 600, color: '#1E293B', marginTop: 1 }}>{val}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ color: '#94A3B8', fontSize: 10 }}>Last paid</span>
                        <div style={{ fontSize: 12, color: '#64748B', marginTop: 1 }}>{fmtDate(lastPaidDate(type, profile._payments)) || '—'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Compliance */}
            {(profile.licenseNumber || profile.licenseExpiry || profile.malpracticeCarrier || profile.malpracticeExpiry || profile.npi) && (
              <div style={{ borderTop: '1px solid #F0F4F8', paddingTop: 14 }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: '#CBD5E1', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Compliance</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px', fontSize: 13 }}>
                  {(profile.licenseNumber || profile.licenseExpiry) && (
                    <div style={{ background: '#F8FAFC', borderRadius: 7, padding: '8px 12px', border: '1px solid #E2E8F0' }}>
                      <span style={{ color: '#94A3B8', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Optometry License</span>
                      <div style={{ fontWeight: 600, color: '#1E293B', marginTop: 2 }}>{profile.licenseNumber || '—'}</div>
                      {profile.licenseExpiry && (() => { const days = daysUntil(profile.licenseExpiry); return <div style={{ fontSize: 12, color: expiryColor(days), marginTop: 2 }}>Exp: {fmtDate(profile.licenseExpiry)}{days !== null && days <= 90 ? ` (${days}d)` : ''}</div>; })()}
                    </div>
                  )}
                  {(profile.malpracticeCarrier || profile.malpracticeExpiry) && (
                    <div style={{ background: '#F8FAFC', borderRadius: 7, padding: '8px 12px', border: '1px solid #E2E8F0' }}>
                      <span style={{ color: '#94A3B8', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Malpractice</span>
                      <div style={{ fontWeight: 600, color: '#1E293B', marginTop: 2 }}>{profile.malpracticeCarrier || '—'}</div>
                      {profile.malpracticeExpiry && (() => { const days = daysUntil(profile.malpracticeExpiry); return <div style={{ fontSize: 12, color: expiryColor(days), marginTop: 2 }}>Exp: {fmtDate(profile.malpracticeExpiry)}{days !== null && days <= 90 ? ` (${days}d)` : ''}</div>; })()}
                    </div>
                  )}
                  {profile.npi && <div><span style={{ color: '#94A3B8', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>NPI</span><div style={{ fontWeight: 600, color: '#1E293B', marginTop: 2 }}>{profile.npi}</div></div>}
                </div>
              </div>
            )}
            {/* Documents */}
            {(profile.documents || []).some(d => d.url) && (
              <div style={{ borderTop: '1px solid #F0F4F8', paddingTop: 14 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Documents</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(profile.documents || []).filter(d => d.url).map((d, i) => (
                    <a key={i} href={d.url} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#1D4ED8', textDecoration: 'none' }}>
                      <span>📄</span>
                      <span style={{ textDecoration: 'underline' }}>{d.label || `Document ${i + 1}`}</span>
                      <span style={{ fontSize: 11, color: '#94A3B8' }}>↗</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {inp('Per Diem Rate ($)', 'perDiem', 'number')}
              {hasBonus && inp('Gross % over $1,200', 'pct', 'number', 'e.g. 30 for 30%')}
              {inp('Email', 'email', 'email')}
              {inp('Phone', 'phone', 'tel')}
              {hasPTO && inp('PTO Allowance (days/yr)', 'ptoAllowance', 'number')}
              {hasPTO && inp('PTO Used (days)', 'ptoUsed', 'number')}
              {inp('Health Stipend ($)', 'healthStipend', 'number', 'leave blank if none')}
              {inp('Uniform Stipend ($)', 'uniformStipend', 'number', 'annual, leave blank if none')}
              {inp('CE Stipend ($)', 'ceStipend', 'number', 'annual, leave blank if none')}
              {inp('Mileage Rate ($/mi)', 'mileageRate', 'number', 'leave blank if none')}
              {inp('NPI Number', 'npi')}
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Other Perks / Promises</span>
              <textarea value={form.otherPerks} onChange={e => setForm(f => ({ ...f, otherPerks: e.target.value }))} rows={2}
                style={{ padding: '7px 10px', border: '1.5px solid #E2E8F0', borderRadius: 7, fontSize: 13, fontFamily: "'DM Sans', sans-serif", resize: 'vertical' }} />
            </label>
            {/* Personal & compliance fields */}
            <p style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>Personal & Compliance</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {inp('Date of Birth', 'dob', 'date')}
              {inp('License Number', 'licenseNumber')}
              {inp('License Expiry', 'licenseExpiry', 'date')}
              {inp('Malpractice Carrier', 'malpracticeCarrier')}
              {inp('Malpractice Expiry', 'malpracticeExpiry', 'date')}
            </div>
            {/* Bonus config */}
            <p style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>Bonus Configuration</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.bonusEligible} onChange={e => setForm(f => ({...f, bonusEligible: e.target.checked}))} />
                Eligible for gross threshold bonus
              </label>
              {form.bonusEligible && inp('Threshold ($)', 'bonusThreshold', 'number', 'e.g. 1200')}
              {form.bonusEligible && inp('Bonus %', 'bonusPct', 'number', 'e.g. 30')}
            </div>
            {/* Day-of-week per diem + location */}
            <p style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>Per Diem by Day of Week</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
              {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day => (
                <div key={day} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', textAlign: 'center' }}>{day}</span>
                  <input type="number" placeholder={form.perDiem || '—'} value={form.perDiemByDay[day]}
                    onChange={e => setForm(f => ({...f, perDiemByDay: {...f.perDiemByDay, [day]: e.target.value}}))}
                    style={{ padding: '6px 8px', border: '1.5px solid #E2E8F0', borderRadius: 6, fontSize: 12, textAlign: 'center', fontFamily: "'DM Sans', sans-serif" }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {['SC','F','WC','SV'].map(loc => (
                      <label key={loc} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, cursor: 'pointer' }}>
                        <input type="checkbox"
                          checked={(form.locationsByDay[day]||[]).includes(loc)}
                          onChange={e => setForm(f => {
                            const cur = f.locationsByDay[day]||[];
                            return {...f, locationsByDay: {...f.locationsByDay, [day]: e.target.checked ? [...cur,loc] : cur.filter(l=>l!==loc)}};
                          })} />
                        {loc}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {/* Document links */}
            <p style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>Document Links (Google Drive)</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(form.documents || []).map((doc, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
                  <input placeholder={['Optometry License','Malpractice Policy','CV','Drivers License','Other'][i] || `Document ${i+1}`}
                    value={doc.label} onChange={e => setForm(f => ({ ...f, documents: f.documents.map((d,j) => j===i ? {...d,label:e.target.value} : d) }))}
                    style={{ padding: '7px 10px', border: '1.5px solid #E2E8F0', borderRadius: 7, fontSize: 12, fontFamily: "'DM Sans', sans-serif" }} />
                  <input placeholder="Paste Google Drive link…"
                    value={doc.url} onChange={e => setForm(f => ({ ...f, documents: f.documents.map((d,j) => j===i ? {...d,url:e.target.value} : d) }))}
                    style={{ padding: '7px 10px', border: '1.5px solid #E2E8F0', borderRadius: 7, fontSize: 12, fontFamily: "'DM Sans', sans-serif" }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={save} style={{ background: '#1B3A5C', color: 'white', border: 'none', borderRadius: 7, padding: '8px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Save</button>
              <button onClick={() => setEditing(false)} style={{ background: '#F1F5F9', color: '#475569', border: 'none', borderRadius: 7, padding: '8px 16px', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Bonus structure */}
      {hasBonus && (
        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 12, padding: '16px 20px' }}>
          <h3 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 15, color: '#92400E', marginBottom: 12 }}>💰 Bonus Structure</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: 13 }}>
            <div style={{ color: '#78350F' }}>
              <strong>Daily Gross Bonus:</strong> {profile.pct || 30}% of gross over $1,200/day
            </div>
            <div style={{ color: '#78350F' }}>
              <strong>LASIK Bonus:</strong> ${LASIK_BONUS} per case
            </div>
            {Object.entries(MYOPIA_BONUS).map(([therapy, amounts]) => (
              <div key={therapy} style={{ color: '#78350F' }}>
                <strong>{therapy}:</strong> ${amounts.new} new / ${amounts.renewal} renewal
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ── Payroll Tab ────────────────────────────────────────────────────────────
function PayrollTab({ doctor, profile, payments, onAddPayment, onDeletePayment, stats, onSaveProfile }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    date: today(), type: 'perdiem', amount: '', description: '', method: 'Square', notes: ''
  });
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showMLE, setShowMLE] = useState(false);
  const [mleForm, setMleForm] = useState({ date: today(), patientName: '', therapy: 'Ortho-K', amount: '', paid: false, notes: '' });

  const filteredPayments = payments.filter(p => {
    if (dateFrom && p.date < dateFrom) return false;
    if (dateTo && p.date > dateTo) return false;
    return true;
  });

  const PAYMENT_TYPES = [
    { value: 'perdiem', label: 'Per Diem' },
    { value: 'gross_bonus', label: 'Gross Bonus' },
    { value: 'myopia_bonus', label: 'Myopia Bonus' },
    { value: 'lasik_bonus', label: 'LASIK Bonus' },
    { value: 'health_stipend', label: 'Health Stipend' },
    { value: 'uniform_stipend', label: 'Uniform Stipend' },
    { value: 'ce_stipend', label: 'CE Stipend' },
    { value: 'mileage', label: 'Mileage Reimbursement' },
    { value: 'malpractice_reimb', label: 'Malpractice Insurance Reimbursement' },
    { value: 'license_reimb', label: 'License Reimbursement' },
    { value: 'pto', label: 'PTO Payout' },
    { value: 'other', label: 'Other' },
  ];

  const METHODS = ['Square', 'Venmo', 'Zelle', 'QuickPay', 'Check', 'Cash', 'Other'];

  const save = async () => {
    if (!form.amount || !form.date) return;
    await onAddPayment({ ...form, amount: parseFloat(form.amount), id: uid() });
    setForm({ date: today(), type: 'perdiem', amount: '', description: '', method: 'Square', notes: '' });
    setShowForm(false);
  };

  const sorted = [...filteredPayments].sort((a, b) => b.date.localeCompare(a.date));

  // Summary by type (uses filtered range)
  const byType = {};
  for (const p of filteredPayments) {
    if (!byType[p.type]) byType[p.type] = 0;
    byType[p.type] += p.amount;
  }
  const totalPaid = filteredPayments.reduce((s, p) => s + p.amount, 0);
  const THERAPIES_MLE = ['Ortho-K','MiSight','Atropine','Stellest','Monitoring','LASIK'];
  const mleEntries = profile.mleEntries || [];
  const unpaidMLE = mleEntries.filter(e => !e.paid);
  const unpaidMLETotal = unpaidMLE.reduce((s,e) => s + parseFloat(e.amount||0), 0);

  const saveMLE = async () => {
    if (!mleForm.patientName || !mleForm.amount) return;
    const entry = { ...mleForm, id: uid(), amount: parseFloat(mleForm.amount) };
    const updated = [...mleEntries, entry];
    await onSaveProfile({ mleEntries: updated });
    setMleForm({ date: today(), patientName: '', therapy: 'Ortho-K', amount: '', paid: false, notes: '' });
  };

  const toggleMLEPaid = async (id) => {
    const updated = mleEntries.map(e => e.id === id ? {...e, paid: !e.paid} : e);
    await onSaveProfile({ mleEntries: updated });
  };

  const deleteMLE = async (id) => {
    await onSaveProfile({ mleEntries: mleEntries.filter(e => e.id !== id) });
  };

  const sel = { padding: '7px 10px', border: '1.5px solid #E2E8F0', borderRadius: 7, fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: 'white' };
  const inp2 = { padding: '7px 10px', border: '1.5px solid #E2E8F0', borderRadius: 7, fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: 'none' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px,1fr))', gap: 12 }}>
        <StatCard label="Total Paid" value={fmt$(totalPaid)} color="#10B981" small />
        <StatCard label="Per Diem Paid" value={fmt$(byType.perdiem || 0)} color="#1B3A5C" small />
        {doctor.payType === 'perdiem_pct' && <StatCard label="Bonuses Paid" value={fmt$((byType.gross_bonus||0)+(byType.myopia_bonus||0)+(byType.lasik_bonus||0))} color="#C9A84C" small />}
        {(byType.health_stipend || profile.healthStipend) && <StatCard label="Stipends Paid" value={fmt$(byType.health_stipend || 0)} color="#8B5CF6" small />}
        <StatCard label="Payments Logged" value={payments.length} color="#2E7D8C" small />
      </div>

      {/* Date range filter */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'white', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>Filter by date:</span>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '5px 8px', border: '1.5px solid #E2E8F0', borderRadius: 6, fontSize: 12 }} />
        <span style={{ fontSize: 12, color: '#94A3B8' }}>→</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '5px 8px', border: '1.5px solid #E2E8F0', borderRadius: 6, fontSize: 12 }} />
        {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(''); setDateTo(''); }} style={{ background: '#F1F5F9', border: 'none', borderRadius: 5, padding: '4px 10px', cursor: 'pointer', fontSize: 11, color: '#64748B' }}>Clear</button>}
        {(dateFrom || dateTo) && <span style={{ fontSize: 11, color: '#94A3B8' }}>Showing {filteredPayments.length} of {payments.length} entries</span>}
      </div>

      {/* Revenue vs Pay reconciliation */}
      {stats && (
        <div style={{ background: 'white', borderRadius: 12, padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #E2E8F0' }}>
          <h3 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, color: '#1B3A5C', marginBottom: 14 }}>Revenue vs. Pay</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px,1fr))', gap: 12, marginBottom: 14 }}>
            <StatCard label="Revenue Generated" value={fmt$(stats.totalRevenue)} color="#2E7D8C" small />
            <StatCard label="Total Paid Out" value={fmt$(totalPaid)} color="#1B3A5C" small />
            <StatCard label="Pay as % of Revenue" value={stats.totalRevenue > 0 ? fmtPct(totalPaid / stats.totalRevenue) : '—'} color={totalPaid / stats.totalRevenue > 0.5 ? '#EF4444' : '#10B981'} small />
            {(byType.gross_bonus||byType.myopia_bonus||byType.lasik_bonus) ? <StatCard label="Bonus Paid" value={fmt$((byType.gross_bonus||0)+(byType.myopia_bonus||0)+(byType.lasik_bonus||0))} color="#C9A84C" small /> : null}
          </div>
          {totalPaid > 0 && stats.totalRevenue > 0 && (
            <div style={{ background: '#F8FAFC', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div style={{ flex: 1, height: 8, background: '#E2E8F0', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(totalPaid / stats.totalRevenue * 100, 100)}%`, height: '100%', background: totalPaid / stats.totalRevenue > 0.5 ? '#EF4444' : '#2E7D8C', borderRadius: 4, transition: 'width 0.3s' }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#1E293B', whiteSpace: 'nowrap' }}>
                  {fmtPct(totalPaid / stats.totalRevenue)} of revenue paid out
                </span>
              </div>
              <p style={{ fontSize: 11, color: '#94A3B8', margin: 0 }}>
                {fmt$(stats.totalRevenue)} generated · {fmt$(totalPaid)} paid · {fmt$(stats.totalRevenue - totalPaid)} remainder
              </p>
            </div>
          )}
        </div>
      )}

      {/* Add payment */}
      <div style={{ background: 'white', borderRadius: 12, padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showForm ? 16 : 0 }}>
          <h3 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, color: '#1B3A5C' }}>Log Payment</h3>
          <button onClick={() => setShowForm(v => !v)} style={{ background: '#1B3A5C', color: 'white', border: 'none', borderRadius: 7, padding: '7px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            {showForm ? 'Cancel' : '+ Add Payment'}
          </button>
        </div>
        {showForm && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px,1fr))', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#64748B', fontWeight: 600 }}>
              DATE <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={inp2} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#64748B', fontWeight: 600 }}>
              TYPE <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} style={sel}>
                {PAYMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#64748B', fontWeight: 600 }}>
              AMOUNT ($) <input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} style={inp2} placeholder="0.00" />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#64748B', fontWeight: 600 }}>
              METHOD <select value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))} style={sel}>
                {METHODS.map(m => <option key={m}>{m}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#64748B', fontWeight: 600, gridColumn: 'span 2' }}>
              DESCRIPTION <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={{ ...inp2, width: '100%' }} placeholder="e.g. Week of Apr 14, LASIK bonus - 2 cases" />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#64748B', fontWeight: 600, gridColumn: 'span 2' }}>
              NOTES <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ ...inp2, width: '100%' }} />
            </label>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button onClick={save} style={{ background: '#10B981', color: 'white', border: 'none', borderRadius: 7, padding: '8px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Save</button>
            </div>
          </div>
        )}
      </div>

      {/* Myopia / LASIK Bonus Tracker */}
      <div style={{ background: 'white', borderRadius: 12, padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <h3 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, color: '#1B3A5C' }}>Myopia / LASIK Bonuses</h3>
            {unpaidMLETotal > 0 && <span style={{ fontSize: 12, color: '#DC2626', fontWeight: 600 }}>⚠ {fmt$(unpaidMLETotal)} unpaid</span>}
          </div>
          <button onClick={() => setShowMLE(v => !v)} style={{ background: '#1B3A5C', color: 'white', border: 'none', borderRadius: 7, padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            {showMLE ? 'Cancel' : '+ Add Bonus'}
          </button>
        </div>
        {showMLE && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px,1fr))', gap: 10, marginBottom: 14, padding: '14px', background: '#F8FAFC', borderRadius: 8 }}>
            {[['Date','date','date'],['Patient Name','patientName','text'],['Notes','notes','text']].map(([label,key,type]) => (
              <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#64748B', fontWeight: 600 }}>
                {label.toUpperCase()}
                <input type={type} value={mleForm[key]} onChange={e => setMleForm(f => ({...f,[key]:e.target.value}))}
                  style={{ padding: '6px 8px', border: '1.5px solid #E2E8F0', borderRadius: 6, fontSize: 12, fontFamily: "'DM Sans',sans-serif" }} />
              </label>
            ))}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#64748B', fontWeight: 600 }}>
              THERAPY
              <select value={mleForm.therapy} onChange={e => setMleForm(f => ({...f,therapy:e.target.value}))}
                style={{ padding: '6px 8px', border: '1.5px solid #E2E8F0', borderRadius: 6, fontSize: 12, background: 'white' }}>
                {THERAPIES_MLE.map(t => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#64748B', fontWeight: 600 }}>
              AMOUNT ($)
              <input type="number" value={mleForm.amount} onChange={e => setMleForm(f => ({...f,amount:e.target.value}))}
                style={{ padding: '6px 8px', border: '1.5px solid #E2E8F0', borderRadius: 6, fontSize: 12 }} />
            </label>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button onClick={saveMLE} style={{ background: '#10B981', color: 'white', border: 'none', borderRadius: 7, padding: '8px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Save</button>
            </div>
          </div>
        )}
        {mleEntries.length === 0 ? (
          <p style={{ color: '#94A3B8', fontSize: 13 }}>No myopia/LASIK bonuses logged yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #F0F4F8' }}>
                {['Paid','Date','Patient','Therapy','Amount','Notes',''].map(h => (
                  <th key={h} style={{ padding: '7px 10px', textAlign: h==='Amount'?'right':'left', fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...mleEntries].sort((a,b) => b.date.localeCompare(a.date)).map((e, i) => (
                <tr key={e.id} style={{ background: e.paid ? '#F0FDF4' : i%2===0?'white':'#FAFBFC', borderBottom: '1px solid #F0F4F8' }}>
                  <td style={{ padding: '8px 10px' }}>
                    <input type="checkbox" checked={!!e.paid} onChange={() => toggleMLEPaid(e.id)} style={{ cursor: 'pointer', width: 16, height: 16 }} />
                  </td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: '#64748B' }}>{fmtDate(e.date)}</td>
                  <td style={{ padding: '8px 10px', fontWeight: 600 }}>{e.patientName}</td>
                  <td style={{ padding: '8px 10px' }}><span style={{ background: '#EFF6FF', color: '#1D4ED8', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600 }}>{e.therapy}</span></td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: e.paid?'#10B981':'#F59E0B' }}>{fmt$(e.amount)}</td>
                  <td style={{ padding: '8px 10px', color: '#94A3B8', fontSize: 12 }}>{e.notes}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <button onClick={() => deleteMLE(e.id)} style={{ background: '#FEE2E2', border: 'none', borderRadius: 4, padding: '2px 7px', cursor: 'pointer', color: '#DC2626', fontSize: 11 }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Payment history */}
      <div style={{ background: 'white', borderRadius: 12, padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <h3 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, color: '#1B3A5C', marginBottom: 14 }}>Payment History</h3>
        {sorted.length === 0 ? (
          <p style={{ color: '#94A3B8', fontSize: 13 }}>No payments logged yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #F0F4F8' }}>
                  {['Date','Type','Amount','Method','Description','Notes',''].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Amount' ? 'right' : 'left', fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((p, i) => (
                  <tr key={p.id} style={{ background: i % 2 === 0 ? 'white' : '#FAFBFC', borderBottom: '1px solid #F0F4F8' }}>
                    <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>{fmtDate(p.date)}</td>
                    <td style={{ padding: '9px 10px' }}>
                      <span style={{ background: '#F1F5F9', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600, color: '#475569' }}>
                        {PAYMENT_TYPES.find(t => t.value === p.type)?.label || p.type}
                      </span>
                    </td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: '#10B981' }}>{fmt$(p.amount)}</td>
                    <td style={{ padding: '9px 10px', color: '#64748B' }}>{p.method}</td>
                    <td style={{ padding: '9px 10px', color: '#1E293B' }}>{p.description}</td>
                    <td style={{ padding: '9px 10px', color: '#94A3B8', fontSize: 12 }}>{p.notes}</td>
                    <td style={{ padding: '9px 10px' }}>
                      <button onClick={() => onDeletePayment(p.id)} style={{ background: '#FEE2E2', border: 'none', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', color: '#DC2626', fontSize: 11 }}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Performance Tab ────────────────────────────────────────────────────────
function PerformanceTab({ doctor, stats, allStats, patients, year }) {
  if (!stats) return (
    <div style={{ padding: 32, textAlign: 'center', color: '#94A3B8' }}>
      <p>No production data for {doctor.name}. Upload the Excel file on the Production page first.</p>
    </div>
  );

  // Monthly breakdown
  const dp = patients.filter(p =>
    p.doctor === doctor.id && (year === 'all' || String(p.year) === String(year))
  );
  const byMonth = {};
  for (const p of dp) {
    if (!byMonth[p.month]) byMonth[p.month] = { revenue: 0, patients: 0, optos: 0, days: new Set() };
    byMonth[p.month].revenue += p.total;
    byMonth[p.month].patients++;
    if (p.optos) byMonth[p.month].optos++;
    byMonth[p.month].days.add(p.date + p.loc);
  }
  const monthlyData = Object.entries(byMonth).sort(([a],[b]) => a-b).map(([m, d]) => ({
    name: MONTH_SHORT[parseInt(m)],
    revenue: Math.round(d.revenue),
    patients: d.patients,
    avgPerDay: d.days.size ? Math.round(d.revenue / d.days.size) : 0,
    days: d.days.size,
  }));

  // Peer comparison — all doctors with data
  const peerData = Object.entries(allStats)
    .filter(([id, s]) => s && id !== 'Yang')
    .map(([id, s]) => ({
      name: id,
      avgPerDay: Math.round(s.avgPerDay),
      optosRate: parseFloat((s.optosRate * 100).toFixed(1)),
      avgPerPatient: Math.round(s.avgPerPatient),
      bonusDayRate: parseFloat((s.bonusDayRate * 100).toFixed(1)),
    }))
    .sort((a, b) => b.avgPerDay - a.avgPerDay);

  // Bonus estimate
  const hasBonus = BONUS_ELIGIBLE.includes(doctor.id);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px,1fr))', gap: 12 }}>
        <StatCard label="Days Worked" value={fmtNum(stats.daysWorked)} color="#2E7D8C" small />
        <StatCard label="Patients Seen" value={fmtNum(stats.patients)} color="#1B3A5C" small />
        <StatCard label="Total Revenue" value={fmt$(stats.totalRevenue)} color="#C9A84C" small />
        <StatCard label="Avg / Day" value={fmt$(stats.avgPerDay)} color="#8B5CF6" small />
        <StatCard label="Avg / Patient" value={fmt$(stats.avgPerPatient)} color="#2E7D8C" small />
        <StatCard label="Optos Rate" value={fmtPct(stats.optosRate)} color="#10B981" small />
        <StatCard label="OCT" value={`${fmtNum(stats.oct)} (${fmtPct(stats.oct / stats.patients)})`} color="#3A9BAD" small />
        <StatCard label="CL Exams" value={`${fmtNum(stats.cl)} (${fmtPct(stats.cl / stats.patients)})`} color="#F59E0B" small />
        <StatCard label="Myopia Pts" value={fmtNum(stats.myopia)} color="#EF4444" small />
        {hasBonus && <StatCard label="Est. Gross Bonus" value={fmt$(stats.estimatedGrossBonus)} color="#C9A84C" small />}
        {hasBonus && <StatCard label="Bonus Days" value={`${stats.bonusDays} (${fmtPct(stats.bonusDayRate)})`} color="#10B981" small />}
      </div>

      {/* Monthly trend */}
      {monthlyData.length > 0 && (
        <div style={{ background: 'white', borderRadius: 12, padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <h3 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, color: '#1B3A5C', marginBottom: 14 }}>Monthly Revenue</h3>
          <SimpleBarChart data={monthlyData} dataKey="revenue" nameKey="name" color="#2E7D8C" fmt={fmt$} height={180} />
        </div>
      )}

      {/* Monthly table */}
      {monthlyData.length > 0 && (
        <div style={{ background: 'white', borderRadius: 12, padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <h3 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, color: '#1B3A5C', marginBottom: 14 }}>Monthly Breakdown</h3>
          <DataTable
            columns={[
              { key: 'name', label: 'Month' },
              { key: 'days', label: 'Days', right: true },
              { key: 'patients', label: 'Patients', right: true },
              { key: 'revenue', label: 'Revenue', right: true, render: r => fmt$(r.revenue) },
              { key: 'avgPerDay', label: 'Avg/Day', right: true, render: r => fmt$(r.avgPerDay) },
            ]}
            rows={monthlyData}
          />
        </div>
      )}

      {/* Peer comparison */}
      {peerData.length > 1 && (
        <div style={{ background: 'white', borderRadius: 12, padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <h3 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, color: '#1B3A5C', marginBottom: 14 }}>Peer Comparison</h3>
          <DataTable
            columns={[
              { key: 'name', label: 'Doctor', render: r => (
                <span style={{ fontWeight: r.name === doctor.id ? 700 : 400, color: r.name === doctor.id ? '#1B3A5C' : '#475569' }}>
                  {r.name === doctor.id ? `▶ ${r.name}` : r.name}
                </span>
              )},
              { key: 'avgPerDay', label: 'Avg/Day', right: true, render: r => fmt$(r.avgPerDay) },
              { key: 'avgPerPatient', label: 'Avg/Pt', right: true, render: r => fmt$(r.avgPerPatient) },
              { key: 'optosRate', label: 'Optos %', right: true, render: r => `${r.optosRate}%` },
              { key: 'bonusDayRate', label: 'Bonus Day %', right: true, render: r => `${r.bonusDayRate}%` },
            ]}
            rows={peerData}
          />
        </div>
      )}
    </div>
  );
}

// ── Notes Tab ──────────────────────────────────────────────────────────────
function NotesTab({ doctor, profile, onSave }) {
  const [text, setText] = useState(profile.notes || '');
  const [saved, setSaved] = useState(false);

  const save = async () => {
    await onSave({ notes: text });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <p style={{ fontSize: 13, color: '#64748B', marginBottom: 12 }}>
        Internal notes about {doctor.name}'s employment — raises, conversations, performance flags, promises made. Not exported anywhere.
      </p>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={16}
        style={{ width: '100%', padding: '12px 14px', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: 13, fontFamily: "'DM Sans', sans-serif", resize: 'vertical', lineHeight: 1.7, outline: 'none' }}
        placeholder="e.g. Discussed raise on Apr 2025 — agreed to revisit after 6 months. Strong on optos. Reliable at SV." />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
        <button onClick={save} style={{ background: '#1B3A5C', color: 'white', border: 'none', borderRadius: 7, padding: '8px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Save Notes</button>
        {saved && <span style={{ fontSize: 12, color: '#10B981', fontWeight: 600 }}>✓ Saved</span>}
      </div>
    </div>
  );
}



// ── PDF Paystub Import Modal ───────────────────────────────────────────────
function PDFImportModal({ onClose, onImport, roster }) {
  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [selected, setSelected] = useState({});
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const handleFile = async (f) => {
    if (!f) return;
    setFile(f);
    setParsing(true);
    setError('');
    try {
      // Convert PDF to base64
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result.split(',')[1]);
        reader.onerror = rej;
        reader.readAsDataURL(f);
      });

      // Use Claude API to extract paystub data
      const response = await fetch('https://spark-dashboard-proxy.ilikebroccoli.workers.dev/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
              { type: 'text', text: `Extract all paystubs from this PDF. Return ONLY valid JSON array, no markdown:
[{
  "name": "Last, First",
  "payDate": "YYYY-MM-DD",
  "periodStart": "YYYY-MM-DD",
  "periodEnd": "YYYY-MM-DD",
  "gross": 1234.56,
  "net": 987.65,
  "memo": "exact memo text",
  "regularPay": 1000.00,
  "grossBonus": 150.00,
  "myopiaBonus": 84.56,
  "taxes": { "federal": 0, "socialSecurity": 0, "medicare": 0, "caState": 0, "sdi": 0 }
}]
For regularPay/grossBonus/myopiaBonus: parse the memo text carefully.
- Regular pay = base per diem days (dates listed before "bonus" keyword)
- Gross bonus = amounts like "4/3 - $24, 4/4 - $42" after "Bonuses:" that are NOT patient-name bonuses
- Myopia/LASIK bonus = amounts with patient names like "Y.E. MiSight - $100" or "Ortho K G. Rundall - 250"
If unclear, put full gross in regularPay and 0 for bonuses.` }
            ]
          }]
        })
      });
      const data = await response.json();
      const text = data.content?.find(c => c.type === 'text')?.text || '';
      const clean = text.replace(/```json|```/g, '').trim();
      const paystubs = JSON.parse(clean);

      // Match to roster
      const matched = paystubs.map(p => {
        const lastName = p.name.split(',')[0].trim().toLowerCase();
        const doctor = (roster || []).find(d => d.id.toLowerCase() === lastName || d.name.toLowerCase().includes(lastName));
        return { ...p, doctorId: doctor?.id || null, squareName: p.name };
      });

      setParsed(matched);
      const sel = {};
      matched.forEach((p, i) => { if (p.doctorId) sel[i] = true; });
      setSelected(sel);
    } catch (e) {
      console.error(e);
      setError('Could not parse PDF. Make sure it is a Square paystub PDF.');
    }
    setParsing(false);
  };

  const doImport = async () => {
    setImporting(true);
    const toImport = parsed.filter((_, i) => selected[i]);
    await onImport(toImport);
    setImporting(false);
    setDone(true);
  };

  const matched = parsed ? parsed.filter(p => p.doctorId) : [];
  const unmatched = parsed ? parsed.filter(p => !p.doctorId) : [];
  const selectedCount = Object.values(selected).filter(Boolean).length;
  const inp2 = { padding: '5px 8px', border: '1.5px solid #E2E8F0', borderRadius: 6, fontSize: 12 };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'white', borderRadius: 16, maxWidth: 780, width: '100%', maxHeight: '88vh', overflow: 'auto', padding: 28, boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: '#1B3A5C' }}>Import Square Paystub PDF</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94A3B8' }}>✕</button>
        </div>

        {done ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <p style={{ fontSize: 16, color: '#1B3A5C', fontWeight: 600 }}>{selectedCount} paystubs imported.</p>
            <button onClick={onClose} style={{ marginTop: 20, background: '#1B3A5C', color: 'white', border: 'none', borderRadius: 8, padding: '10px 24px', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>Done</button>
          </div>
        ) : !parsed ? (
          <div>
            <p style={{ color: '#64748B', fontSize: 13, marginBottom: 16 }}>Upload the Square Paystubs PDF (all doctors in one file). Claude will extract each paystub and split pay into per diem, gross bonus, and myopia/LASIK bonus.</p>
            {error && <div style={{ background: '#FEE2E2', borderRadius: 8, padding: '10px 14px', color: '#DC2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}
            <label htmlFor="pdf-upload" style={{ border: '2px dashed #CBD5E1', borderRadius: 12, padding: '40px', textAlign: 'center', cursor: 'pointer', background: '#F8FAFC', display: 'block' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
              <p style={{ fontWeight: 600, color: '#1B3A5C', marginBottom: 4 }}>{parsing ? 'Analyzing paystubs...' : 'Click to upload Square Paystubs PDF'}</p>
              <p style={{ fontSize: 12, color: '#94A3B8' }}>All doctors in one file</p>
              <input id="pdf-upload" type="file" accept=".pdf" style={{ display: parsing ? 'none' : 'block', margin: '12px auto 0' }}
                onChange={e => handleFile(e.target.files[0])} />
            </label>
            {parsing && <div style={{ textAlign: 'center', marginTop: 16, color: '#64748B', fontSize: 13 }}>🤖 Claude is reading the paystubs...</div>}
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <div style={{ background: '#D1FAE5', borderRadius: 8, padding: '7px 14px', fontSize: 13, color: '#065F46', fontWeight: 600 }}>✓ {matched.length} matched</div>
              {unmatched.length > 0 && <div style={{ background: '#FEE2E2', borderRadius: 8, padding: '7px 14px', fontSize: 13, color: '#DC2626', fontWeight: 600 }}>✗ {unmatched.length} unmatched: {unmatched.map(p=>p.squareName).join(', ')}</div>}
            </div>
            <div style={{ overflowX: 'auto', marginBottom: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #F0F4F8' }}>
                    <th style={{ padding: '7px 8px' }}><input type="checkbox" checked={selectedCount===matched.length} onChange={e => { const sel={}; matched.forEach(p=>{ sel[parsed.indexOf(p)]=e.target.checked; }); setSelected(sel); }} /></th>
                    {['Doctor','Pay Date','Period','Gross','Regular','Gross Bonus','Myopia/LASIK','Net'].map(h => (
                      <th key={h} style={{ padding: '7px 8px', textAlign: ['Gross','Regular','Gross Bonus','Myopia/LASIK','Net'].includes(h)?'right':'left', fontSize: 10, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matched.map((p, idx) => {
                    const i = parsed.indexOf(p);
                    return (
                      <tr key={i} style={{ background: idx%2===0?'white':'#FAFBFC', borderBottom: '1px solid #F0F4F8' }}>
                        <td style={{ padding: '7px 8px' }}><input type="checkbox" checked={!!selected[i]} onChange={e => setSelected(s=>({...s,[i]:e.target.checked}))} /></td>
                        <td style={{ padding: '7px 8px', fontWeight: 600 }}>{p.doctorId}</td>
                        <td style={{ padding: '7px 8px' }}>{p.payDate}</td>
                        <td style={{ padding: '7px 8px', fontSize: 11, color: '#64748B', whiteSpace: 'nowrap' }}>{p.periodStart} → {p.periodEnd}</td>
                        <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700, color: '#10B981' }}>${p.gross?.toLocaleString()}</td>
                        <td style={{ padding: '7px 8px', textAlign: 'right' }}>${p.regularPay?.toLocaleString()}</td>
                        <td style={{ padding: '7px 8px', textAlign: 'right', color: '#C9A84C' }}>{p.grossBonus>0?`$${p.grossBonus?.toLocaleString()}`:'—'}</td>
                        <td style={{ padding: '7px 8px', textAlign: 'right', color: '#8B5CF6' }}>{p.myopiaBonus>0?`$${p.myopiaBonus?.toLocaleString()}`:'—'}</td>
                        <td style={{ padding: '7px 8px', textAlign: 'right', color: '#64748B' }}>${p.net?.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button onClick={doImport} disabled={importing||selectedCount===0}
                style={{ background: selectedCount===0?'#94A3B8':'#10B981', color: 'white', border: 'none', borderRadius: 8, padding: '10px 22px', cursor: selectedCount===0?'default':'pointer', fontSize: 13, fontWeight: 600 }}>
                {importing?'Importing…':`Import ${selectedCount} Paystubs`}
              </button>
              <button onClick={() => { setParsed(null); setSelected({}); setFile(null); }}
                style={{ background: '#F1F5F9', color: '#475569', border: 'none', borderRadius: 8, padding: '10px 14px', cursor: 'pointer', fontSize: 12 }}>
                Upload Different File
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Square Payroll Import ──────────────────────────────────────────────────
function SquareImportModal({ onClose, onImport, roster }) {
  const [parsed, setParsed] = useState(null);
  const [selected, setSelected] = useState({});
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = React.useRef();

  const handleFile = async (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
        const checks = parseSquarePayrollXLSX(rows, roster);
        setParsed(checks);
        // Select all matched by default
        const sel = {};
        checks.forEach((c, i) => { if (c.doctorId) sel[i] = true; });
        setSelected(sel);
      } catch (err) {
        console.error(err);
        alert('Could not parse file. Make sure it is the Square Payroll XLSX export.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const doImport = async () => {
    setImporting(true);
    const toImport = parsed.filter((_, i) => selected[i]);
    await onImport(toImport);
    setImporting(false);
    setDone(true);
  };

  const matched = parsed ? parsed.filter(c => c.doctorId) : [];
  const unmatched = parsed ? parsed.filter(c => !c.doctorId) : [];
  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'white', borderRadius: 16, maxWidth: 700, width: '100%', maxHeight: '85vh', overflow: 'auto', padding: 28, boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: '#1B3A5C' }}>Import Square Payroll</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94A3B8' }}>✕</button>
        </div>

        {done ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <p style={{ fontSize: 16, color: '#1B3A5C', fontWeight: 600 }}>{selectedCount} paychecks imported successfully.</p>
            <button onClick={onClose} style={{ marginTop: 20, background: '#1B3A5C', color: 'white', border: 'none', borderRadius: 8, padding: '10px 24px', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>Done</button>
          </div>
        ) : !parsed ? (
          <div>
            <p style={{ color: '#64748B', fontSize: 13, marginBottom: 20 }}>Upload your Square Payroll "Paycheck Details" XLSX export. All matched paychecks will be imported as payroll entries.</p>
            <label htmlFor="square-payroll-upload" style={{ border: '2px dashed #CBD5E1', borderRadius: 12, padding: '40px', textAlign: 'center', cursor: 'pointer', background: '#F8FAFC', display: 'block' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📂</div>
              <p style={{ fontWeight: 600, color: '#1B3A5C', marginBottom: 4 }}>Click to upload Square Payroll XLSX</p>
              <p style={{ fontSize: 12, color: '#94A3B8', marginBottom: 12 }}>Paycheck Details report</p>
              <input id="square-payroll-upload" type="file" accept=".xlsx,.xls" style={{ display: 'block', margin: '0 auto', fontSize: 13 }} onChange={e => handleFile(e.target.files[0])} />
            </label>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <div style={{ background: '#D1FAE5', borderRadius: 8, padding: '8px 16px', fontSize: 13, color: '#065F46', fontWeight: 600 }}>
                ✓ {matched.length} matched
              </div>
              {unmatched.length > 0 && (
                <div style={{ background: '#FEE2E2', borderRadius: 8, padding: '8px 16px', fontSize: 13, color: '#DC2626', fontWeight: 600 }}>
                  ✗ {unmatched.length} unmatched
                </div>
              )}
            </div>

            {unmatched.length > 0 && (
              <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#92400E' }}>
                <strong>Unmatched names</strong> (won't be imported): {unmatched.map(c => c.squareName).join(', ')}
              </div>
            )}

            <div style={{ overflowX: 'auto', marginBottom: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #F0F4F8' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, color: '#94A3B8', textTransform: 'uppercase' }}>
                      <input type="checkbox" checked={selectedCount === matched.length}
                        onChange={e => {
                          const sel = {};
                          matched.forEach((c) => {
                            const i = parsed.indexOf(c);
                            sel[i] = e.target.checked;
                          });
                          setSelected(sel);
                        }} />
                    </th>
                    {['Name','Doctor','Pay Date','Period','Gross','Net'].map(h => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Gross' || h === 'Net' ? 'right' : 'left', fontSize: 11, color: '#94A3B8', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matched.map((c, idx) => {
                    const i = parsed.indexOf(c);
                    return (
                      <tr key={i} style={{ background: idx % 2 === 0 ? 'white' : '#FAFBFC', borderBottom: '1px solid #F0F4F8' }}>
                        <td style={{ padding: '8px 10px' }}>
                          <input type="checkbox" checked={!!selected[i]} onChange={e => setSelected(s => ({ ...s, [i]: e.target.checked }))} />
                        </td>
                        <td style={{ padding: '8px 10px', color: '#64748B', fontSize: 12 }}>{c.squareName}</td>
                        <td style={{ padding: '8px 10px', fontWeight: 600, color: '#1B3A5C' }}>{c.doctorId}</td>
                        <td style={{ padding: '8px 10px' }}>{c.payDate}</td>
                        <td style={{ padding: '8px 10px', fontSize: 11, color: '#64748B' }}>
                          {c.periodStart} → {c.periodEnd}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#10B981' }}>${c.gross.toLocaleString()}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#475569' }}>${c.net.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <button onClick={doImport} disabled={importing || selectedCount === 0}
                style={{ background: selectedCount === 0 ? '#94A3B8' : '#10B981', color: 'white', border: 'none', borderRadius: 8, padding: '10px 24px', cursor: selectedCount === 0 ? 'default' : 'pointer', fontSize: 14, fontWeight: 600 }}>
                {importing ? 'Importing…' : `Import ${selectedCount} Paychecks`}
              </button>
              <button onClick={() => { setParsed(null); setSelected({}); setDone(false); }}
                style={{ background: '#F1F5F9', color: '#475569', border: 'none', borderRadius: 8, padding: '10px 16px', cursor: 'pointer', fontSize: 13 }}>
                Upload Different File
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// ── Labeled horizontal bar chart — every bar labeled, value shown ─────────
function LabeledBarChart({ data, color = '#2E7D8C', fmt = v => v }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map(d => d.value), 1);
  const barH = 32;
  const labelW = 72;
  const valW = 64;
  const gap = 6;

  return (
    <div style={{ width: '100%', height: '100%', overflowY: 'auto' }}>
      {data.map((d, i) => (
        <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: gap, marginBottom: 6 }}>
          <div style={{ width: labelW, textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#1E293B', flexShrink: 0 }}>
            {d.name}
          </div>
          <div style={{ flex: 1, background: '#F0F4F8', borderRadius: 4, height: barH - 8, overflow: 'hidden' }}>
            <div style={{
              width: `${(d.value / max) * 100}%`,
              height: '100%',
              background: color,
              borderRadius: 4,
              minWidth: 4,
              transition: 'width 0.3s ease',
            }} />
          </div>
          <div style={{ width: valW, fontSize: 12, fontWeight: 700, color: color, flexShrink: 0 }}>
            {fmt(d.value)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Add Doctor Modal ──────────────────────────────────────────────────────
function AddDoctorModal({ onClose, onAdd }) {
  const LOCS = ['SC','F','WC','SV'];
  const [form, setForm] = useState({
    name: '', id: '', type: 'ppt', payType: 'perdiem', locations: [], archived: false
  });
  const [error, setError] = useState('');

  const submit = () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!form.id.trim())   { setError('Excel name is required'); return; }
    onAdd({ ...form, id: form.id.trim(), name: form.name.trim() });
  };

  const sel = { padding: '7px 10px', border: '1.5px solid #E2E8F0', borderRadius: 7, fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: 'none', background: 'white', width: '100%' };
  const inp = { ...sel };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'white', borderRadius: 16, maxWidth: 440, width: '100%', padding: 28, boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: '#1B3A5C' }}>Add Doctor</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94A3B8' }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, fontWeight: 600, color: '#64748B' }}>
            DISPLAY NAME (e.g. Dr. Smith)
            <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} style={inp} placeholder="Dr. Smith" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, fontWeight: 600, color: '#64748B' }}>
            EXCEL NAME — must match exactly how it appears in your spreadsheet
            <input value={form.id} onChange={e => setForm(f => ({...f, id: e.target.value}))} style={inp} placeholder="Smith" />
            <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 400 }}>e.g. if the Excel shows "Smith" in the Doctor column, enter Smith</span>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, fontWeight: 600, color: '#64748B' }}>
            TYPE
            <select value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))} style={sel}>
              <option value="ft">Full-Time</option>
              <option value="ppt">Part-Time</option>
              <option value="fill">Fill-In</option>
              <option value="owner">Owner</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, fontWeight: 600, color: '#64748B' }}>
            PAY STRUCTURE
            <select value={form.payType} onChange={e => setForm(f => ({...f, payType: e.target.value}))} style={sel}>
              <option value="perdiem">Per Diem Only</option>
              <option value="perdiem_pct">Per Diem + % of Gross</option>
              <option value="none">Owner (no payroll)</option>
            </select>
          </label>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 6 }}>LOCATIONS</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {['SC','F','WC','SV'].map(loc => (
                <label key={loc} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.locations.includes(loc)}
                    onChange={e => setForm(f => ({...f, locations: e.target.checked ? [...f.locations, loc] : f.locations.filter(l => l !== loc)}))} />
                  {loc === 'SC' ? 'Santa Clara' : loc === 'F' ? 'Fremont' : loc === 'WC' ? 'Walnut Creek' : 'Sunnyvale'}
                </label>
              ))}
            </div>
          </div>
          {error && <p style={{ color: '#DC2626', fontSize: 12 }}>{error}</p>}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={submit} style={{ background: '#1B3A5C', color: 'white', border: 'none', borderRadius: 7, padding: '9px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 600, flex: 1 }}>Add Doctor</button>
          <button onClick={onClose} style={{ background: '#F1F5F9', color: '#475569', border: 'none', borderRadius: 7, padding: '9px 16px', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}




// ── Employee Report ────────────────────────────────────────────────────────
export function EmployeeReport({ doctorId, allPatients, allPayments, profiles, onClose }) {
  const { ResponsiveContainer, BarChart, Bar, XAxis, LabelList, Tooltip, Cell } = require('recharts');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [benchmark, setBenchmark] = useState(40);

  const profile = profiles?.[doctorId] || {};
  function fmtD(d) { if(!d) return '—'; return new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
  const periodLabel = dateFrom || dateTo ? `${dateFrom||'Start'} → ${dateTo||'Today'}` : 'All Time';

  const myPatients = (allPatients||[]).filter(p => p.doctor===doctorId && (!dateFrom||p.date>=dateFrom) && (!dateTo||p.date<=dateTo));
  const allInPeriod = (allPatients||[]).filter(p => (!dateFrom||p.date>=dateFrom) && (!dateTo||p.date<=dateTo));

  const myDays = [...new Set(myPatients.map(p=>p.date+p.loc))].length;
  const myRevenue = myPatients.reduce((s,p)=>s+p.total,0);
  const myRoutine = myPatients.filter(p=>p.routine);
  const myMyopia = myPatients.filter(p=>p.hasMyopia||p.myopiaAmt>0).length;
  const myAvgPerDay = myDays ? myRevenue/myDays : 0;
  const myAvgPerRoutine = myRoutine.length ? myRevenue/myRoutine.length : 0;
  const myOptosRate = myPatients.length ? myPatients.filter(p=>p.optos).length/myPatients.length*100 : 0;
  const myOCTRate = myPatients.length ? myPatients.filter(p=>p.oct).length/myPatients.length*100 : 0;
  const myCLRate = myPatients.length ? myPatients.filter(p=>p.cl).length/myPatients.length*100 : 0;

  const peerIds = [...new Set(allInPeriod.map(p=>p.doctor))].filter(id=>id&&id!=='Yang'&&id!==doctorId);
  const peerStats = peerIds.map(id => {
    const pts = allInPeriod.filter(p=>p.doctor===id);
    const days = [...new Set(pts.map(p=>p.date+p.loc))].length;
    const rev = pts.reduce((s,p)=>s+p.total,0);
    const routine = pts.filter(p=>p.routine);
    return { id, days,
      avgPerDay:days?rev/days:0, avgPerRoutine:routine.length?rev/routine.length:0,
      optosRate:pts.length?pts.filter(p=>p.optos).length/pts.length*100:0,
      octRate:pts.length?pts.filter(p=>p.oct).length/pts.length*100:0,
      clRate:pts.length?pts.filter(p=>p.cl).length/pts.length*100:0,
      myopiaCount:pts.filter(p=>p.hasMyopia||p.myopiaAmt>0).length,
    };
  }).filter(p=>p.days>0);

  const buildChart = (myVal, peerKey, fmtFn) => {
    let li=0;
    const data = peerStats.map(p=>({name:String.fromCharCode(65+li++), value:+p[peerKey].toFixed(1), isMe:false, label:fmtFn(+p[peerKey].toFixed(1))}))
      .concat([{name:'You', value:+myVal.toFixed(1), isMe:true, label:fmtFn(+myVal.toFixed(1))}])
      .sort((a,b)=>b.value-a.value);
    return { data, rank: data.findIndex(d=>d.isMe)+1, total: data.length };
  };

  const pays = (allPayments?.[doctorId]||[]).filter(p=>(!dateFrom||p.date>=dateFrom)&&(!dateTo||p.date<=dateTo));
  const byType = {};
  for(const p of pays) { byType[p.type]=(byType[p.type]||0)+p.amount; }
  const perDiem=byType.perdiem||0, grossBonus=byType.gross_bonus||0, myopiaBonus=byType.myopia_bonus||0;
  const lasikBonus=byType.lasik_bonus||0, healthStip=byType.health_stipend||0;
  const uniformStip=byType.uniform_stipend||0, ceStip=byType.ce_stipend||0, mileage=byType.mileage||0;
  const totalComp=perDiem+grossBonus+myopiaBonus+lasikBonus+healthStip+uniformStip+ceStip+mileage;
  const compPct=myRevenue>0?totalComp/myRevenue*100:0;
  const showBenchmark=compPct>=benchmark;

  const ptoAllowance=parseFloat(profile.ptoAllowance||0);
  const ptoUsed=parseFloat(profile.ptoUsed||0);
  const lastPaid=type=>{const m=(allPayments?.[doctorId]||[]).filter(p=>p.type===type).sort((a,b)=>b.date.localeCompare(a.date));return m[0]?.date||null;};

  const inp={padding:'6px 10px',border:'1.5px solid #E2E8F0',borderRadius:6,fontSize:12,fontFamily:"'DM Sans',sans-serif"};

  const charts=[
    {label:'Avg Revenue / Day',myVal:myAvgPerDay,peerKey:'avgPerDay',fmt:v=>fmt$(v)},
    {label:'Avg / Routine Pt',myVal:myAvgPerRoutine,peerKey:'avgPerRoutine',fmt:v=>fmt$(v)},
    {label:'Optomap Rate',myVal:myOptosRate,peerKey:'optosRate',fmt:v=>`${v.toFixed(1)}%`},
    {label:'OCT Rate',myVal:myOCTRate,peerKey:'octRate',fmt:v=>`${v.toFixed(1)}%`},
    {label:'CL Exam Rate',myVal:myCLRate,peerKey:'clRate',fmt:v=>`${v.toFixed(1)}%`},
    {label:'Myopia Control Pts',myVal:myMyopia,peerKey:'myopiaCount',fmt:v=>String(Math.round(v))},
  ];

  const compRows = [
    perDiem>0&&['Per Diem',fmt$(perDiem)],
    grossBonus>0&&['Gross Threshold Bonus',fmt$(grossBonus),'#C9A84C'],
    myopiaBonus>0&&['Myopia Control Bonuses',fmt$(myopiaBonus),'#8B5CF6'],
    lasikBonus>0&&['LASIK Bonuses',fmt$(lasikBonus),'#8B5CF6'],
    healthStip>0&&['Health Stipend',fmt$(healthStip)],
    uniformStip>0&&['Uniform Stipend',fmt$(uniformStip)],
    ceStip>0&&['CE Stipend',fmt$(ceStip)],
    mileage>0&&['Mileage',fmt$(mileage)],
  ].filter(Boolean);

  return (
    <>
      <style>{`
        @media print {
          @page { size: letter portrait; margin: 0.5in; }
          body * { visibility: hidden; }
          #employee-report-print, #employee-report-print * { visibility: visible; }
          #employee-report-print { position: absolute; left: 0; top: 0; width: 100%; background: white; z-index: 9999; padding: 0; }
          #employee-report-print .print-container { box-shadow: none; max-height: none; overflow: visible; border-radius: 0; max-width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div id="employee-report-print" style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
        <div className="print-container" style={{background:'white',borderRadius:16,maxWidth:740,width:'100%',maxHeight:'90vh',overflow:'auto',padding:28,boxShadow:'0 8px 40px rgba(0,0,0,0.2)'}}>

          {/* Print header — visible only when printing */}
          <div style={{marginBottom:16}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              <div>
                <h1 style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:'#1B3A5C',marginBottom:2}}>Dr. {doctorId} — Performance Review</h1>
                <p style={{color:'#94A3B8',fontSize:12}}>{periodLabel} · The Spark Optometry · Peer names are anonymized</p>
              </div>
              <button className="no-print" onClick={onClose} style={{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'#94A3B8'}}>✕</button>
            </div>
          </div>

          {/* Period + benchmark controls */}
          <div className="no-print" style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',marginBottom:16,padding:'10px 14px',background:'#F8FAFC',borderRadius:10,border:'1px solid #E2E8F0'}}>
            <span style={{fontSize:11,fontWeight:700,color:'#64748B',textTransform:'uppercase'}}>Period:</span>
            <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={inp} />
            <span style={{fontSize:11,color:'#94A3B8'}}>→</span>
            <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={inp} />
            {(dateFrom||dateTo)&&<button onClick={()=>{setDateFrom('');setDateTo('');}} style={{background:'none',border:'none',color:'#94A3B8',cursor:'pointer',fontSize:11}}>Clear</button>}
            <span style={{marginLeft:'auto',fontSize:11,fontWeight:700,color:'#64748B',textTransform:'uppercase'}}>Comp Benchmark:</span>
            <input type="number" value={benchmark} onChange={e=>setBenchmark(parseFloat(e.target.value)||40)} style={{...inp,width:55}} />%
          </div>

          {myPatients.length===0 ? <p style={{color:'#94A3B8',textAlign:'center',padding:32}}>No production data for this period.</p> : (<>

            {/* KPI cards */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:8,marginBottom:16}}>
              {[['Days',myDays],['Patients',myPatients.length],['Routine',myRoutine.length],['Avg/Day',fmt$(myAvgPerDay)],['Avg/Routine Pt',fmt$(myAvgPerRoutine)],['Optomap',`${myOptosRate.toFixed(1)}%`]].map(([l,v])=>(
                <div key={l} style={{background:'#F8FAFC',borderRadius:7,padding:'8px 10px',border:'1px solid #E2E8F0',textAlign:'center'}}>
                  <p style={{fontSize:9,color:'#94A3B8',fontWeight:700,textTransform:'uppercase',marginBottom:3}}>{l}</p>
                  <p style={{fontSize:13,fontWeight:700,color:'#1B3A5C'}}>{v}</p>
                </div>
              ))}
            </div>

            {/* Peer comparison charts — 3 col */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:16}}>
              {charts.map(({label,myVal,peerKey,fmt:fmtFn})=>{
                const {data,rank,total}=buildChart(myVal,peerKey,fmtFn);
                return (
                  <div key={label} style={{background:'white',borderRadius:8,padding:'10px 12px',border:'1px solid #E2E8F0'}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                      <span style={{fontSize:9,fontWeight:700,color:'#64748B',textTransform:'uppercase'}}>{label}</span>
                      <span style={{fontSize:10,color:'#94A3B8'}}>#{rank}/{total}</span>
                    </div>
                    <ResponsiveContainer width="100%" height={100}>
                      <BarChart data={data} margin={{left:0,right:0,top:28,bottom:0}} barSize={12}>
                        <XAxis dataKey="name" tick={{fontSize:8,fill:'#94A3B8'}} axisLine={false} tickLine={false} />
                        <Tooltip formatter={v=>[fmtFn(v),'']} contentStyle={{fontSize:10,borderRadius:5}} />
                        <Bar dataKey="value" radius={[2,2,0,0]}>
                          <LabelList dataKey="label" position="top" style={{fontSize:7,fill:'#475569'}} angle={-90} offset={20} />
                          {data.map((d,i)=><Cell key={i} fill={d.isMe?'#1B3A5C':'#BFDBFE'} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <p style={{textAlign:'center',fontSize:11,fontWeight:700,color:'#1B3A5C',marginTop:2}}>{fmtFn(myVal)}</p>
                  </div>
                );
              })}
            </div>

            {/* Compensation — compact */}
            <div style={{background:'#F8FAFC',borderRadius:10,padding:'12px 16px',border:'1px solid #E2E8F0',marginBottom:16}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:compRows.length>0?10:0,flexWrap:'wrap',gap:8}}>
                <span style={{fontSize:11,fontWeight:700,color:'#64748B',textTransform:'uppercase'}}>Compensation</span>
                <div style={{display:'flex',gap:16,alignItems:'center'}}>
                  <span style={{fontSize:13,color:'#475569'}}>Total: <strong style={{color:'#1B3A5C'}}>{fmt$(totalComp)}</strong></span>
                  <span style={{fontSize:14,fontWeight:800,color:compPct>=benchmark?'#10B981':'#1B3A5C'}}>{compPct.toFixed(1)}% of revenue</span>
                  {showBenchmark&&<span style={{fontSize:11,color:'#10B981'}}>✓ Above {benchmark}% benchmark</span>}
                </div>
              </div>
              {compRows.length>0&&(
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  {compRows.map(([l,v,c])=>(
                    <div key={l} style={{background:'white',borderRadius:6,padding:'5px 10px',border:'1px solid #E2E8F0',fontSize:12}}>
                      <span style={{color:'#94A3B8'}}>{l}: </span><span style={{fontWeight:700,color:c||'#1B3A5C'}}>{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Benefits */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:10,marginBottom:16}}>
              {ptoAllowance>0&&(
                <div style={{background:'#F8FAFC',borderRadius:8,padding:'10px 12px',border:'1px solid #E2E8F0'}}>
                  <p style={{fontSize:9,fontWeight:700,color:'#64748B',textTransform:'uppercase',marginBottom:6}}>PTO</p>
                  <div style={{display:'flex',gap:12}}>
                    {[['Allowance',`${ptoAllowance}d`],['Used',`${ptoUsed}d`],['Left',`${ptoAllowance-ptoUsed}d`,ptoAllowance-ptoUsed<1?'#EF4444':'#10B981']].map(([l,v,c])=>(
                      <div key={l}><p style={{fontSize:8,color:'#94A3B8',fontWeight:700,textTransform:'uppercase'}}>{l}</p><p style={{fontSize:13,fontWeight:700,color:c||'#1B3A5C'}}>{v}</p></div>
                    ))}
                  </div>
                </div>
              )}
              {[['CE ($200/yr)','ce_stipend',ceStip],['Uniform ($200/yr)','uniform_stipend',uniformStip]].map(([label,type,paid])=>(
                <div key={label} style={{background:'#F8FAFC',borderRadius:8,padding:'10px 12px',border:'1px solid #E2E8F0'}}>
                  <p style={{fontSize:9,fontWeight:700,color:'#64748B',textTransform:'uppercase',marginBottom:6}}>{label}</p>
                  <div style={{display:'flex',gap:12}}>
                    {[['Used',fmt$(paid)],['Left',fmt$(Math.max(0,200-paid)),200-paid<=0?'#10B981':'#1B3A5C'],['Last Paid',fmtD(lastPaid(type))]].map(([l,v,c])=>(
                      <div key={l}><p style={{fontSize:8,color:'#94A3B8',fontWeight:700,textTransform:'uppercase'}}>{l}</p><p style={{fontSize:11,fontWeight:700,color:c||'#1B3A5C'}}>{v}</p></div>
                    ))}
                  </div>
                </div>
              ))}
              {healthStip>0&&(
                <div style={{background:'#F8FAFC',borderRadius:8,padding:'10px 12px',border:'1px solid #E2E8F0'}}>
                  <p style={{fontSize:9,fontWeight:700,color:'#64748B',textTransform:'uppercase',marginBottom:6}}>Health Stipend</p>
                  <div style={{display:'flex',gap:12}}>
                    {[['Paid',fmt$(healthStip)],['Last',fmtD(lastPaid('health_stipend'))]].map(([l,v])=>(
                      <div key={l}><p style={{fontSize:8,color:'#94A3B8',fontWeight:700,textTransform:'uppercase'}}>{l}</p><p style={{fontSize:11,fontWeight:700,color:'#1B3A5C'}}>{v}</p></div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button className="no-print" onClick={()=>window.print()} style={{background:'#1B3A5C',color:'white',border:'none',borderRadius:8,padding:'9px 20px',cursor:'pointer',fontSize:13,fontWeight:600}}>
              🖨 Print / Save as PDF
            </button>
          </>)}
        </div>
      </div>
    </>
  );
}


// ── Main DoctorsView ───────────────────────────────────────────────────────
export default function DoctorsView({ allPatients, filters, onSquareImported, showEmployeeReportFor, onClearEmployeeReport }) {
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [roster, setRoster] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [payments, setPayments] = useState({});
  const [loading, setLoading] = useState(true);
  const [showSquareImport, setShowSquareImport] = useState(false);
  const [employeeReportDoctor, setEmployeeReportDoctor] = useState(null);

  useEffect(() => {
    if (showEmployeeReportFor && !loading) {
      // Load payments for this doctor if not already loaded
      const doctorId = showEmployeeReportFor;
      if (!payments[doctorId]) {
        loadPayments(doctorId).then(pays => {
          setPayments(prev => ({ ...prev, [doctorId]: pays }));
          setEmployeeReportDoctor(doctorId);
        });
      } else {
        setEmployeeReportDoctor(doctorId);
      }
    }
  }, [showEmployeeReportFor, loading]);
  const [showPDFImport, setShowPDFImport] = useState(false);
  const [mainTab, setMainTab] = useState('list'); // 'list' or 'runpayroll'
  const [sortCol, setSortCol] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };
  const [showAddDoctor, setShowAddDoctor] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const year = filters?.year || '2026';

  useEffect(() => {
    async function load() {
      try {
        const [ros, profs] = await Promise.all([loadRoster(), loadDoctorProfiles()]);
        setRoster(ros);
        setProfiles(profs);
      } catch (e) { console.error(e); }
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    if (!selectedDoctor) return;
    loadPayments(selectedDoctor.id).then(pays => {
      setPayments(prev => ({ ...prev, [selectedDoctor.id]: pays }));
    });
  }, [selectedDoctor]);

  const activeRoster  = roster.filter(d => !d.archived);
  const archivedRoster = roster.filter(d => d.archived);
  const bonusEligibleIds = roster.filter(d => d.payType === 'perdiem_pct').map(d => d.id);

  // Compute stats for all doctors
  const allStats = useMemo(() => {
    const s = {};
    for (const d of roster) {
      s[d.id] = computeDoctorStats(allPatients || [], d.id, year, bonusEligibleIds);
    }
    return s;
  }, [allPatients, year, roster]);

  const handleAddDoctor = async (newDoc) => {
    const updated = [...roster, newDoc];
    setRoster(updated);
    await saveRosterDoctor(newDoc);
    setShowAddDoctor(false);
  };

  const handleArchiveDoctor = async (doctorId) => {
    const updated = roster.map(d => d.id === doctorId ? { ...d, archived: true } : d);
    setRoster(updated);
    const doc = updated.find(d => d.id === doctorId);
    if (doc) await saveRosterDoctor(doc);
  };

  const handleRestoreDoctor = async (doctorId) => {
    const updated = roster.map(d => d.id === doctorId ? { ...d, archived: false } : d);
    setRoster(updated);
    const doc = updated.find(d => d.id === doctorId);
    if (doc) await saveRosterDoctor(doc);
  };

  const handleSaveProfile = async (data) => {
    if (!selectedDoctor) return;
    const updated = { ...(profiles[selectedDoctor.id] || {}), ...data };
    setProfiles(prev => ({ ...prev, [selectedDoctor.id]: updated }));
    await saveDoctorProfile(selectedDoctor.id, updated);
  };


  // Payment types that should auto-log to expenses
  const EXPENSE_AUTO_TYPES = {
    health_stipend: { category: 'Payroll', label: 'Health Stipend' },
    uniform_stipend: { category: 'Payroll', label: 'Uniform Stipend' },
    ce_stipend: { category: 'Payroll', label: 'CE Stipend' },
    mileage: { category: 'Payroll', label: 'Mileage Reimbursement' },
    malpractice_reimb: { category: 'Insurance', label: 'Malpractice Insurance Reimbursement' },
    license_reimb: { category: 'Taxes & Fees', label: 'License Reimbursement' },
    other: { category: 'Miscellaneous', label: 'Other Reimbursement' },
  };

  const handleAddPayment = async (payment) => {
    if (!selectedDoctor) return;
    const id = await savePayment(selectedDoctor.id, payment);
    setPayments(prev => ({
      ...prev,
      [selectedDoctor.id]: [...(prev[selectedDoctor.id] || []), { ...payment, id }]
    }));

    // Auto-log to expenses module for stipends/reimbursements
    const autoType = EXPENSE_AUTO_TYPES[payment.type];
    if (autoType) {
      try {
        const { db } = await import('./firebase');
        const { doc, collection, setDoc } = await import('firebase/firestore');
        const expenseId = Math.random().toString(36).slice(2, 9);
        const expenseEntry = {
          id: expenseId,
          date: payment.date,
          category: autoType.category,
          vendor: selectedDoctor.name,
          amount: payment.amount,
          card: payment.method || 'Business Checking',
          locMode: 'all',
          locations: { SC: payment.amount/4, F: payment.amount/4, WC: payment.amount/4, SV: payment.amount/4 },
          isReal: true,
          isRecurring: false,
          status: 'actual',
          notes: `${autoType.label} — ${selectedDoctor.name}. ${payment.description || ''} ${payment.notes || ''}`.trim(),
          source: 'doctor_payment_auto',
        };
        await setDoc(doc(collection(db, 'expenses', 'data', 'entries')), expenseEntry);
      } catch(e) { console.error('Failed to auto-log expense:', e); }
    }
  };

  const handlePDFImport = async (paystubs) => {
    for (const p of paystubs) {
      if (!p.doctorId) continue;
      const period = `${p.periodStart} → ${p.periodEnd}`;
      // Log per diem entry
      if (p.regularPay > 0) {
        const payment = { id: uid(), date: p.payDate, type: 'perdiem', amount: p.regularPay,
          description: period, method: 'Square',
          notes: `${p.memo?.slice(0,80)||''}. Net: $${p.net?.toLocaleString()}`,
          source: 'pdf_import', periodStart: p.periodStart, periodEnd: p.periodEnd };
        await savePayment(p.doctorId, payment);
        setPayments(prev => ({ ...prev, [p.doctorId]: [...(prev[p.doctorId]||[]), payment] }));
      }
      // Log gross bonus entry
      if (p.grossBonus > 0) {
        const payment = { id: uid(), date: p.payDate, type: 'gross_bonus', amount: p.grossBonus,
          description: period, method: 'Square', notes: '', source: 'pdf_import' };
        await savePayment(p.doctorId, payment);
        setPayments(prev => ({ ...prev, [p.doctorId]: [...(prev[p.doctorId]||[]), payment] }));
      }
      // Log myopia/LASIK bonus entry
      if (p.myopiaBonus > 0) {
        const payment = { id: uid(), date: p.payDate, type: 'myopia_bonus', amount: p.myopiaBonus,
          description: period, method: 'Square', notes: '', source: 'pdf_import' };
        await savePayment(p.doctorId, payment);
        setPayments(prev => ({ ...prev, [p.doctorId]: [...(prev[p.doctorId]||[]), payment] }));
      }
    }
    if (onSquareImported) onSquareImported();
  };

  const handleSquareImport = async (paychecks) => {
    // Load existing payments from Firebase for all affected doctors to deduplicate
    const doctorIds = [...new Set(paychecks.map(p => p.doctorId).filter(Boolean))];
    const existingByDoctor = {};
    await Promise.all(doctorIds.map(async id => {
      const pays = await loadPayments(id);
      existingByDoctor[id] = pays;
      setPayments(prev => ({ ...prev, [id]: pays }));
    }));

    let imported = 0;
    for (const pc of paychecks) {
      const existing = existingByDoctor[pc.doctorId] || [];
      const isDupe = existing.some(p =>
        p.source === 'square_import' && p.date === pc.payDate && p.amount === pc.gross
      );
      if (isDupe) continue;

      const payment = {
        id: Math.random().toString(36).slice(2, 9),
        date: pc.payDate,
        type: 'perdiem',
        amount: pc.gross,
        description: `Square payroll: ${pc.periodStart} → ${pc.periodEnd}`,
        method: 'Square',
        notes: `Net pay: $${pc.net.toLocaleString()}`,
        squareGross: pc.gross,
        squareNet: pc.net,
        periodStart: pc.periodStart,
        periodEnd: pc.periodEnd,
        source: 'square_import',
      };
      await savePayment(pc.doctorId, payment);
      existingByDoctor[pc.doctorId] = [...existing, payment];
      setPayments(prev => ({
        ...prev,
        [pc.doctorId]: [...(prev[pc.doctorId] || []), payment],
      }));
      imported++;
    }
    if (onSquareImported) onSquareImported();
    return imported;
  };

  const handleDeletePayment = async (paymentId) => {
    if (!selectedDoctor) return;
    await deletePayment(selectedDoctor.id, paymentId);
    setPayments(prev => ({
      ...prev,
      [selectedDoctor.id]: (prev[selectedDoctor.id] || []).filter(p => p.id !== paymentId)
    }));
  };

  if (loading) return (
    <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>Loading doctor data…</div>
  );

  // ── Doctor list view ────────────────────────────────────────────────────
  if (!selectedDoctor) {
    const chartDoctors = activeRoster.filter(d => allStats[d.id]?.daysWorked > 0);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Main tab switcher */}
        <div style={{ display: 'flex', gap: 4 }}>
          {[['list','👩‍⚕️ Doctors'],['runpayroll','💰 Run Payroll']].map(([tab,label]) => (
            <button key={tab} onClick={() => setMainTab(tab)} style={{ background: mainTab===tab?'#1B3A5C':'#F1F5F9', color: mainTab===tab?'white':'#64748B', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontSize: 13, fontWeight: mainTab===tab?700:400, fontFamily: "'DM Sans', sans-serif" }}>{label}</button>
          ))}
        </div>

        {mainTab === 'runpayroll' && (
          <RunPayrollTab activeRoster={activeRoster} profiles={profiles} allPatients={allPatients} allPayments={payments} onSaveProfile={async (data) => { if (selectedDoctor) { const updated = {...(profiles[selectedDoctor.id]||{}), ...data}; setProfiles(prev=>({...prev,[selectedDoctor.id]:updated})); await saveDoctorProfile(selectedDoctor.id, updated); } }} onAddPayment={handleAddPayment} />
        )}

        {mainTab === 'list' && <>
        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <SectionHeader title="Doctor Management" sub={`${year} · click a doctor to view their profile`} />
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            <button onClick={() => setShowPDFImport(true)}
              style={{ background: '#8B5CF6', color: 'white', border: 'none', borderRadius: 8, padding: '9px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              📄 Import Paystub PDF
            </button>
            <button onClick={() => setShowAddDoctor(true)}
              style={{ background: '#10B981', color: 'white', border: 'none', borderRadius: 8, padding: '9px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              + Add Doctor
            </button>
          </div>
        </div>

        {/* ── Expiry & birthday reminders ── */}
        {(() => {
          const today = new Date();
          const daysUntil = (d) => { if (!d) return null; const dt = new Date(d+'T00:00:00'); return Math.ceil((dt-today)/(1000*60*60*24)); };
          const daysUntilBday = (d) => { if (!d) return null; const birth = new Date(d+'T00:00:00'), next = new Date(today.getFullYear(), birth.getMonth(), birth.getDate()); if(next<today) next.setFullYear(today.getFullYear()+1); return Math.ceil((next-today)/(1000*60*60*24)); };
          const alerts = [];
          for (const dr of activeRoster) {
            const p = profiles[dr.id] || {};
            const licDays = daysUntil(p.licenseExpiry);
            const malDays = daysUntil(p.malpracticeExpiry);
            const bdayDays = daysUntilBday(p.dob);
            if (licDays !== null && licDays <= 90) alerts.push({ type: licDays <= 30 ? 'red' : 'yellow', msg: `${dr.name}: optometry license expires ${licDays <= 0 ? 'TODAY' : `in ${licDays} day${licDays===1?'':'s'}`} (${p.licenseExpiry})` });
            if (malDays !== null && malDays <= 90) alerts.push({ type: malDays <= 30 ? 'red' : 'yellow', msg: `${dr.name}: malpractice policy expires ${malDays <= 0 ? 'TODAY' : `in ${malDays} day${malDays===1?'':'s'}`} (${p.malpracticeExpiry})` });
            if (bdayDays !== null && bdayDays <= 7) alerts.push({ type: 'purple', msg: `🎂 ${dr.name}'s birthday is ${bdayDays === 0 ? 'today!' : `in ${bdayDays} day${bdayDays===1?'':'s'}`}` });
          }
          if (alerts.length === 0) return null;
          const redAlerts = alerts.filter(a => a.type === 'red');
          const yellowAlerts = alerts.filter(a => a.type === 'yellow');
          const purpleAlerts = alerts.filter(a => a.type === 'purple');
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {redAlerts.length > 0 && (
                <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 16 }}>🚨</span>
                  <div>
                    <p style={{ fontWeight: 700, color: '#DC2626', fontSize: 13, marginBottom: 4 }}>Action Required — Expiring within 30 days</p>
                    {redAlerts.map((a,i) => <p key={i} style={{ fontSize: 12, color: '#B91C1C', margin: '2px 0' }}>• {a.msg}</p>)}
                  </div>
                </div>
              )}
              {yellowAlerts.length > 0 && (
                <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 16 }}>⚠️</span>
                  <div>
                    <p style={{ fontWeight: 700, color: '#92400E', fontSize: 13, marginBottom: 4 }}>Expiring within 90 days</p>
                    {yellowAlerts.map((a,i) => <p key={i} style={{ fontSize: 12, color: '#78350F', margin: '2px 0' }}>• {a.msg}</p>)}
                  </div>
                </div>
              )}
              {purpleAlerts.length > 0 && (
                <div style={{ background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 16 }}>🎉</span>
                  <div>
                    {purpleAlerts.map((a,i) => <p key={i} style={{ fontSize: 13, color: '#6D28D9', margin: '2px 0', fontWeight: 600 }}>{a.msg}</p>)}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Summary table — sortable */}
        <div style={{ background: 'white', borderRadius: 14, padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflowX: 'auto' }}>
          {(() => {
            const COLS = [
              { key: 'name',         label: 'Doctor',         right: false, val: r => r.name },
              { key: 'type',         label: 'Type',           right: false, val: r => r.type },
              { key: 'perDiem',      label: 'Pay',            right: true,  val: r => parseFloat(profiles[r.id]?.perDiem || 0) },
              { key: 'daysWorked',   label: 'Days',           right: true,  val: r => allStats[r.id]?.daysWorked || 0 },
              { key: 'patients',     label: 'Pts',            right: true,  val: r => allStats[r.id]?.patients || 0 },
              { key: 'avgPerDay',    label: 'Avg/Day',        right: true,  val: r => allStats[r.id]?.avgPerDay || 0 },
              { key: 'avgPerRoutine',label: 'Avg/Pt',        right: true,  val: r => allStats[r.id]?.avgPerRoutine || 0 },
              { key: 'optosRate',    label: 'Optos %',        right: true,  val: r => allStats[r.id]?.optosRate || 0 },
              { key: 'bonusPaid',    label: 'Bonus Paid',     right: true,  val: r => ((payments[r.id]||[]).filter(p=>['gross_bonus','myopia_bonus','lasik_bonus'].includes(p.type)).reduce((s,p)=>s+p.amount,0)) },
              { key: 'totalRevenue',  label: 'Revenue',        right: true,  val: r => allStats[r.id]?.totalRevenue || 0 },
              { key: 'totalPaid',     label: 'Paid',           right: true,  val: r => (payments[r.id]||[]).reduce((s,p)=>s+p.amount,0) },
              { key: 'remainder',     label: '% Kept',         right: true,  val: r => { const rev=allStats[r.id]?.totalRevenue||0; const paid=(payments[r.id]||[]).reduce((s,p)=>s+p.amount,0); return rev>0?(rev-paid)/rev*100:0; } },
            ];
            const sorted = [...activeRoster].sort((a, b) => {
              const col = COLS.find(c => c.key === sortCol);
              if (!col) return 0;
              const va = col.val(a), vb = col.val(b);
              const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
              return sortDir === 'asc' ? cmp : -cmp;
            });
            const thS = (key) => ({
              padding: '8px 10px', textAlign: COLS.find(c=>c.key===key)?.right ? 'right' : 'left',
              fontSize: 11, fontWeight: 700, color: sortCol === key ? '#1B3A5C' : '#94A3B8',
              textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer',
              borderBottom: '2px solid #F0F4F8', whiteSpace: 'nowrap',
              userSelect: 'none', background: 'white',
            });
            const arrow = (key) => sortCol === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
            return (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {COLS.map(c => <th key={c.key} style={thS(c.key)} onClick={() => handleSort(c.key)}>{c.label}{arrow(c.key)}</th>)}
                    <th style={{ ...thS('action'), cursor: 'default' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => (
                    <tr key={r.id} style={{ background: i % 2 === 0 ? 'white' : '#FAFBFC', borderBottom: '1px solid #F0F4F8' }}>
                      <td style={{ padding: '9px 10px' }}>
                        <button onClick={() => { setSelectedDoctor(r); setActiveTab('overview'); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1B3A5C', fontWeight: 700, fontSize: 13, textDecoration: 'underline', padding: 0 }}>
                          {r.name}
                        </button>
                      </td>
                      <td style={{ padding: '9px 10px' }}><TypeBadge type={r.type} /></td>
                      <td style={{ padding: '9px 10px', textAlign: 'right' }}>{profiles[r.id]?.perDiem ? fmt$(parseFloat(profiles[r.id].perDiem)) : '—'}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right' }}>{fmtNum(allStats[r.id]?.daysWorked)}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right' }}>{fmtNum(allStats[r.id]?.patients)}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right' }}>{allStats[r.id] ? fmt$(allStats[r.id].avgPerDay) : '—'}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right' }}>{allStats[r.id]?.routineCount > 0 ? fmt$(allStats[r.id].avgPerRoutine) : '—'}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right' }}>{allStats[r.id] ? fmtPct(allStats[r.id].optosRate) : '—'}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right' }}>
                        {(() => { const bp=(payments[r.id]||[]).filter(p=>['gross_bonus','myopia_bonus','lasik_bonus'].includes(p.type)).reduce((s,p)=>s+p.amount,0); return bp>0?<span style={{color:'#C9A84C',fontWeight:700}}>{fmt$(bp)}</span>:'—'; })()}
                      </td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', color: '#2E7D8C', fontWeight: 600 }}>
                        {allStats[r.id] ? fmt$(allStats[r.id].totalRevenue) : '—'}
                      </td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', color: '#1B3A5C' }}>
                        {(() => { const paid=(payments[r.id]||[]).reduce((s,p)=>s+p.amount,0); return paid>0?fmt$(paid):'—'; })()}
                      </td>
                      <td style={{ padding: '9px 10px', textAlign: 'right' }}>
                        {(() => {
                          const rev=allStats[r.id]?.totalRevenue||0;
                          const paid=(payments[r.id]||[]).reduce((s,p)=>s+p.amount,0);
                          if (!rev || !paid) return '—';
                          const kept=(rev-paid)/rev*100;
                          return <span style={{ fontWeight:700, color: kept>=60?'#10B981':kept>=40?'#D97706':'#DC2626' }}>{kept.toFixed(1)}%</span>;
                        })()}
                      </td>
                      <td style={{ padding: '9px 10px' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => { setSelectedDoctor(r); setActiveTab('overview'); }}
                            style={{ background: '#F1F5F9', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11, color: '#475569', fontWeight: 600 }}>
                            View →
                          </button>
                          <button onClick={() => { if(window.confirm('Archive ' + r.name + '?')) handleArchiveDoctor(r.id); }}
                            style={{ background: '#FEE2E2', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 11, color: '#DC2626' }}>
                            Archive
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}
        </div>

        {/* Archived doctors */}
        {archivedRoster.length > 0 && (
          <div>
            <button onClick={() => setShowArchived(v => !v)}
              style={{ background: 'none', border: '1px solid #E2E8F0', borderRadius: 7, padding: '6px 14px', cursor: 'pointer', fontSize: 12, color: '#64748B', marginBottom: 10 }}>
              {showArchived ? '▲' : '▼'} {archivedRoster.length} archived doctor{archivedRoster.length !== 1 ? 's' : ''}
            </button>
            {showArchived && (
              <div style={{ background: 'white', borderRadius: 12, padding: '14px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                {archivedRoster.map(d => (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #F0F4F8' }}>
                    <span style={{ flex: 1, fontSize: 13, color: '#94A3B8' }}>{d.name}</span>
                    <TypeBadge type={d.type} />
                    <button onClick={() => handleRestoreDoctor(d.id)}
                      style={{ background: '#D1FAE5', border: 'none', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12, color: '#065F46', fontWeight: 600 }}>
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Peer comparison charts — labeled bars */}
        {allPatients && allPatients.length > 0 && chartDoctors.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <ChartCard title="Avg Revenue per Day" height={Math.max(260, chartDoctors.length * 38 + 60)}>
              <LabeledBarChart
                data={chartDoctors.map(d => ({ name: d.id, value: Math.round(allStats[d.id]?.avgPerDay || 0) })).sort((a,b) => b.value - a.value)}
                color="#2E7D8C" fmt={fmt$}
              />
            </ChartCard>
            <ChartCard title="Optos Rate by Doctor" height={Math.max(260, chartDoctors.length * 38 + 60)}>
              <LabeledBarChart
                data={chartDoctors.map(d => ({ name: d.id, value: parseFloat(((allStats[d.id]?.optosRate || 0) * 100).toFixed(1)) })).sort((a,b) => b.value - a.value)}
                color="#1B3A5C" fmt={v => `${v}%`}
              />
            </ChartCard>
          </div>
        )}

        {showAddDoctor && <AddDoctorModal onClose={() => setShowAddDoctor(false)} onAdd={handleAddDoctor} />}
        {showSquareImport && (
          <SquareImportModal
            onClose={() => setShowSquareImport(false)}
            onImport={handleSquareImport}
            roster={roster}
          />
        )}
        {showPDFImport && (
          <PDFImportModal
            onClose={() => setShowPDFImport(false)}
            onImport={handlePDFImport}
            roster={activeRoster}
          />
        )}
        </>}
      </div>
    );
  }

  // ── Individual doctor view ───────────────────────────────────────────────
  const profile = profiles[selectedDoctor.id] || {};
  const doctorPayments = payments[selectedDoctor.id] || [];
  const stats = allStats[selectedDoctor.id];
  const isBonusEligible = bonusEligibleIds.includes(selectedDoctor.id);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Back + header */}
      <div style={{ marginBottom: 16 }}>
        <button onClick={() => setSelectedDoctor(null)}
          style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', fontSize: 13, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          ← All Doctors
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#DBEAFE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#1D4ED8', fontSize: 18 }}>
            {selectedDoctor.id[0]}
          </div>
          <div>
            <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 24, color: '#1B3A5C' }}>{selectedDoctor.name}</h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
              <TypeBadge type={selectedDoctor.type} />
              {profile.startDate && <span style={{ fontSize: 12, color: '#94A3B8' }}>Since {fmtDate(profile.startDate)}</span>}
              {selectedDoctor.locations?.length > 0 && (
                <span style={{ fontSize: 12, color: '#64748B' }}>
                  {selectedDoctor.locations.map(l => LOC_LABELS[l] || l).join(', ')}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, background: 'white', padding: '0 4px', borderRadius: '10px 10px 0 0', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: 0 }}>
        {DOCTOR_TABS.map(t => (
          <button key={t} onClick={() => setActiveTab(t)} style={{
            background: activeTab === t ? '#1B3A5C' : 'transparent',
            color: activeTab === t ? 'white' : '#64748B',
            border: 'none', borderRadius: '8px 8px 0 0',
            padding: '10px 18px', cursor: 'pointer', fontSize: 13,
            fontWeight: activeTab === t ? 700 : 400,
            fontFamily: "'DM Sans', sans-serif",
          }}>{TAB_LABELS[t]}</button>
        ))}
      </div>
      <div style={{ background: 'white', borderRadius: '0 0 14px 14px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: 24, minHeight: 400 }}>
        {activeTab === 'overview' && (
          <ProfileTab doctor={selectedDoctor} profile={profile} onSave={handleSaveProfile} />
        )}
        {activeTab === 'payroll' && (
          <PayrollTab doctor={selectedDoctor} profile={profile} payments={doctorPayments}
            onAddPayment={handleAddPayment} onDeletePayment={handleDeletePayment}
            stats={allStats[selectedDoctor.id]}
            onSaveProfile={handleSaveProfile} />
        )}
        {activeTab === 'days' && (
          <DaysWorkedTab doctor={selectedDoctor} patients={allPatients || []} />
        )}
        {activeTab === 'performance' && (
          <PerformanceTab doctor={selectedDoctor} stats={stats} allStats={allStats}
            patients={allPatients || []} year={year} />
        )}
        {activeTab === 'notes' && (
          <NotesTab doctor={selectedDoctor} profile={profile} onSave={handleSaveProfile} />
        )}
      </div>
    </div>
  );
}
