import React, { useState } from 'react';
import { StatCard, fmt$, fmtPct, fmtNum, MONTH_SHORT } from './components';

function uid() { return Math.random().toString(36).slice(2, 9); }
function today() { return new Date().toISOString().slice(0, 10); }
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Run Payroll Tab ────────────────────────────────────────────────────────
export function RunPayrollTab({ activeRoster, profiles, allPatients, allPayments, onSaveProfile, onAddPayment }) {
  const [scheduleFile, setScheduleFile] = useState(null);
  const [scheduleImg, setScheduleImg] = useState(null);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [parsing, setParsing] = useState(false);
  const [results, setResults] = useState(null);
  const [bonusThreshold, setBonusThreshold] = useState(1200);
  const [copiedId, setCopiedId] = useState(null);
  const LOC_FULL = { SC:'Santa Clara', F:'Fremont', WC:'Walnut Creek', SV:'Sunnyvale' };
  const DAY_NAMES = { 0:'Sun',1:'Mon',2:'Tue',3:'Wed',4:'Thu',5:'Fri',6:'Sat' };
  const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // Auto-set period end 13 days after start
  const handlePeriodStart = (v) => {
    setPeriodStart(v);
    if (v) {
      const end = new Date(v + 'T00:00:00');
      end.setDate(end.getDate() + 13);
      setPeriodEnd(end.toISOString().slice(0,10));
    }
  };

  const handleFile = (f) => {
    if (!f) return;
    setScheduleFile(f);
    const reader = new FileReader();
    reader.onload = e => setScheduleImg(e.target.result);
    reader.readAsDataURL(f);
  };

  const getPerDiemForDay = (profile, dateStr) => {
    const dow = new Date(dateStr + 'T12:00:00').getDay();
    const dayKey = DAY_NAMES[dow];
    const dayRate = profile.perDiemByDay?.[dayKey];
    return dayRate && parseFloat(dayRate) > 0 ? parseFloat(dayRate) : parseFloat(profile.perDiem || 0);
  };

  const runPayroll = async () => {
    if (!scheduleImg || !periodStart || !periodEnd) return;
    setParsing(true);
    setResults(null);
    try {
      const base64 = scheduleImg.split(',')[1];
      const mimeType = scheduleImg.split(';')[0].split(':')[1];

      // Build initials map from roster + profiles
      const initialsMap = {};
      for (const d of activeRoster) {
        const lastName = d.id.toLowerCase();
        const firstInit = (d.name.replace('Dr. ','').trim().split(' ')[0]||'')[0]?.toUpperCase()||'';
        const lastInit = d.id[0]?.toUpperCase()||'';
        initialsMap[`${lastInit}${firstInit}`] = d.id;
        initialsMap[d.id.slice(0,2).toUpperCase()] = d.id;
        // Add known aliases
        if (d.id === 'Kha') { initialsMap['IK'] = 'Kha'; }
        if (d.id === 'Pan') { initialsMap['TP'] = 'Pan'; }
        if (d.id === 'Luong') { initialsMap['ML'] = 'Luong'; initialsMap['MK'] = 'Luong'; }
        if (d.id === 'Ghag') { initialsMap['GG'] = 'Ghag'; }
        if (d.id === 'Kaneta') { initialsMap['RK'] = 'Kaneta'; }
        if (d.id === 'Zhang') { initialsMap['BZ'] = 'Zhang'; }
        if (d.id === 'Fan') { initialsMap['LF'] = 'Fan'; }
        if (d.id === 'Burger') { initialsMap['OB'] = 'Burger'; }
        if (d.id === 'Yang') { initialsMap['CY'] = 'Yang'; }
        if (d.id === 'Cheng') { initialsMap['KC'] = 'Cheng'; }
        if (d.id === 'So') { initialsMap['KS'] = 'So'; }
        if (d.id === 'Duong') { initialsMap['AD'] = 'Duong'; }
        if (d.id === 'Miranda') { initialsMap['CM'] = 'Miranda'; }
      }

      // Use spark-schedule-ocr worker (same as hours tool) - already working
      const response = await fetch('https://spark-schedule-ocr.ilikebroccoli.workers.dev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mediaType: mimeType })
      });

      const schedData = await response.json();
      if (schedData.error) throw new Error(schedData.error);
      if (!schedData.weeks || !schedData.weeks.length) throw new Error('No weeks found in schedule image.');

      // Convert spark-schedule-ocr format to assignments array
      // Filter to only dates within pay period
      const pStart = new Date(periodStart + 'T12:00:00');
      const pEnd = new Date(periodEnd + 'T12:00:00');
      const assignments = [];
      const unmatched = new Set();
      const cleanCell = (raw) => raw
        .replace(/\s*\([\d:.\-]+.*?\)/g, '')            // strip times like (10-3) or (9:30-5:30)
        .replace(/\s+[\d]+[:\-][\d:.\-]+.*$/, '')       // strip trailing bare times
        .trim();
      for (const week of schedData.weeks) {
        for (let di = 0; di < 7; di++) {
          const dateStr = week.dates[di];
          if (!dateStr) continue;
          const d = new Date(dateStr + 'T12:00:00');
          if (d < pStart || d > pEnd) continue;
          for (const loc of ['SC','SV','F','WC']) {
            const cell = cleanCell((week[loc]?.[di] || '').trim());
            if (!cell || cell === '' || cell === 'BLOCKED') continue;
            // Handle split days like "LF/CY" - already separated by spark-schedule-ocr as single initials
            const isSplit = cell.includes('/');
            if (isSplit) {
              const parts = cell.split('/');
              for (const initials of parts) {
                const trimmed = initials.trim();
                if (!trimmed) continue;
                const doctorId = initialsMap[trimmed] || null;
                if (!doctorId) unmatched.add(trimmed);
                assignments.push({ date: dateStr, location: loc, initials: trimmed, doctorId, isSplit: true, splitWith: parts.filter(p=>p.trim()!==trimmed).join('/') });
              }
            } else {
              const doctorId = initialsMap[cell] || null;
              if (doctorId) assignments.push({ date: dateStr, location: loc, initials: cell, doctorId, isSplit: false, splitWith: null });
              else unmatched.add(cell);
            }
          }
        }
      }
      if (unmatched.size > 0) {
        alert('Heads up — these initials on the schedule don\'t match any doctor in your roster and were skipped: ' + [...unmatched].join(', ') + '. Check the doctor\'s initials or add them in Doctor Management.');
      }

      // Group by doctor
      const byDoctor = {};
      for (const a of assignments) {
        if (!a.doctorId || a.doctorId === 'Yang') continue;
        if (!byDoctor[a.doctorId]) byDoctor[a.doctorId] = [];
        byDoctor[a.doctorId].push(a);
      }

      // Calculate per diem and gross bonus per doctor
      const payrollResults = [];
      for (const [doctorId, days] of Object.entries(byDoctor)) {
        const profile = profiles[doctorId] || {};
        const doctor = activeRoster.find(d => d.id === doctorId);
        if (!doctor) continue;

        let regularTotal = 0;
        const dayDetails = [];
        const splits = [];

        // Get gross bonus from Excel for these dates
        const threshold = parseFloat(profile.bonusThreshold || bonusThreshold);
        const bonusPct = parseFloat(profile.bonusPct || 30) / 100;
        const isBonusEligible = profile.bonusEligible !== false && (doctor.payType === 'perdiem_pct' || profile.bonusEligible);

        let grossBonusTotal = 0;
        const bonusDetails = [];

        for (const day of days.sort((a,b) => a.date.localeCompare(b.date))) {
          const dow = new Date(day.date + 'T12:00:00').getDay();
          const dayLabel = DAY_LABELS[dow];
          const dateShort = day.date.slice(5).replace('-','/');

          if (day.isSplit) {
            splits.push({ date: day.date, dateShort, location: day.location, splitWith: day.splitWith });
            continue;
          }

          const rate = getPerDiemForDay(profile, day.date);
          regularTotal += rate;

          // Multi-location label
          const locLabel = day.location && day.location !== '' ? ` (${day.location})` : '';
          dayDetails.push({ date: day.date, dateShort, dayLabel, rate, location: day.location, locLabel });

          // Gross bonus from Excel
          if (isBonusEligible && allPatients) {
            const dayPatients = allPatients.filter(p =>
              p.doctor === doctorId && p.date === day.date && p.loc === day.location
            );
            const dayGross = dayPatients.reduce((s,p) => s + p.total, 0);
            if (dayGross > threshold) {
              const bonus = Math.round((dayGross - threshold) * bonusPct * 100) / 100;
              grossBonusTotal += bonus;
              bonusDetails.push({ dateShort, gross: dayGross, bonus });
            }
          }
        }

        // Check if multiple locations
        const locs = [...new Set(dayDetails.map(d => d.location))];
        const multiLoc = locs.length > 1;

        // Build blurb (max ~250 chars)
        let regularPart = '';
        if (dayDetails.length > 0) {
          // Group consecutive same-rate days
          const grouped = dayDetails.map(d => `${d.dayLabel} ${d.dateShort}${multiLoc ? ` ${d.location}` : ''}`).join(', ');
          regularPart = `${grouped}, Total = ${regularTotal.toLocaleString()}`;
        }

        let bonusPart = '';
        if (grossBonusTotal > 0) {
          const bonusStr = bonusDetails.map(b => `${b.dateShort} - ${b.bonus}`).join(', ');
          bonusPart = `Bonus: ${bonusStr}, Total = ${grossBonusTotal}`;
        }

        let splitPart = splits.length > 0 ? splits.map(s => `${s.dayLabel||''} ${s.dateShort} SPLIT w/${s.splitWith} — enter manually`).join('; ') : '';

        const grandTotal = regularTotal + grossBonusTotal;
        let blurb = [regularPart, bonusPart, splitPart].filter(Boolean).join('. ');
        if (grandTotal !== regularTotal) blurb += `. Grand total = ${grandTotal.toLocaleString()}`;

        // Trim to 250 chars if needed
        if (blurb.length > 250) blurb = blurb.slice(0, 247) + '...';

        payrollResults.push({
          doctorId, doctor,
          days: dayDetails, splits,
          regularTotal, grossBonusTotal, grandTotal,
          blurb, bonusDetails,
          isBonusEligible,
        });
      }

      setResults(payrollResults.sort((a,b) => a.doctorId.localeCompare(b.doctorId)));
    } catch (e) {
      console.error(e);
      alert('Could not read schedule. Please try again.');
    }
    setParsing(false);
  };

  const copyBlurb = (id, text) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ background: 'white', borderRadius: 14, padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <h3 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 18, color: '#1B3A5C', marginBottom: 16 }}>Run Payroll</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: 14, marginBottom: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>
            Pay Period Start (Sunday)
            <input type="date" value={periodStart} onChange={e => handlePeriodStart(e.target.value)}
              style={{ padding: '8px 10px', border: '1.5px solid #E2E8F0', borderRadius: 7, fontSize: 13 }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>
            Pay Period End (Saturday)
            <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)}
              style={{ padding: '8px 10px', border: '1.5px solid #E2E8F0', borderRadius: 7, fontSize: 13 }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>
            Global Gross Bonus Threshold ($)
            <input type="number" value={bonusThreshold} onChange={e => setBonusThreshold(parseFloat(e.target.value)||1200)}
              style={{ padding: '8px 10px', border: '1.5px solid #E2E8F0', borderRadius: 7, fontSize: 13 }} />
          </label>
        </div>
        <label htmlFor="sched-upload" style={{ border: '2px dashed #CBD5E1', borderRadius: 10, padding: '20px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', background: scheduleImg ? '#F0FDF4' : '#F8FAFC', marginBottom: 14 }}>
          <span style={{ fontSize: 28 }}>{scheduleImg ? '✅' : '📅'}</span>
          <div>
            <p style={{ fontWeight: 600, color: '#1B3A5C', fontSize: 13 }}>{scheduleImg ? `Schedule uploaded: ${scheduleFile?.name}` : 'Upload schedule screenshot'}</p>
            <p style={{ fontSize: 11, color: '#94A3B8' }}>Screenshot of Numbers/Excel schedule grid</p>
          </div>
          <input id="sched-upload" type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
        </label>
        <button onClick={runPayroll} disabled={parsing || !scheduleImg || !periodStart}
          style={{ background: parsing||!scheduleImg||!periodStart?'#94A3B8':'#1B3A5C', color: 'white', border: 'none', borderRadius: 8, padding: '10px 24px', cursor: parsing||!scheduleImg||!periodStart?'default':'pointer', fontSize: 14, fontWeight: 600 }}>
          {parsing ? '🤖 Reading schedule...' : 'Generate Payroll'}
        </button>
      </div>

      {results && (
        <div style={{ background: 'white', borderRadius: 14, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #F0F4F8' }}>
                {['Doctor','Days','Regular Pay','Gross Bonus','Grand Total','Memo',''].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: ['Regular Pay','Gross Bonus','Grand Total'].includes(h)?'right':'left', fontSize: 10, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <React.Fragment key={r.doctorId}>
                  <tr style={{ background: i%2===0?'white':'#FAFBFC', borderBottom: '1px solid #F0F4F8' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 700, color: '#1B3A5C' }}>{r.doctor.name}</td>
                    <td style={{ padding: '8px 10px', color: '#64748B', fontSize: 12 }}>
                      {r.days.map(d => `${d.dayLabel} ${d.dateShort}`).join(', ')}
                      {r.splits.length > 0 && <span style={{ color: '#D97706', marginLeft: 4 }}>+{r.splits.length} split</span>}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: '#10B981', fontWeight: 600 }}>{fmt$(r.regularTotal)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: '#C9A84C', fontWeight: 600 }}>{r.grossBonusTotal > 0 ? fmt$(r.grossBonusTotal) : '—'}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#1B3A5C' }}>{fmt$(r.grandTotal)}</td>
                    <td style={{ padding: '8px 10px', maxWidth: 300 }}>
                      <span style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace', wordBreak: 'break-word' }}>{r.blurb.slice(0,80)}{r.blurb.length>80?'…':''}</span>
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <button onClick={() => copyBlurb(r.doctorId, r.blurb)}
                        style={{ background: copiedId===r.doctorId?'#10B981':'#1B3A5C', color: 'white', border: 'none', borderRadius: 5, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {copiedId===r.doctorId ? '✓ Copied' : 'Copy Memo'}
                      </button>
                    </td>
                  </tr>
                  {r.splits.length > 0 && (
                    <tr key={r.doctorId+'_split'} style={{ background: '#FFFBEB', borderBottom: '1px solid #F0F4F8' }}>
                      <td colSpan={7} style={{ padding: '5px 10px 5px 24px', fontSize: 11, color: '#92400E' }}>
                        ⚠ Split days — enter manually: {r.splits.map(s => `${s.dateShort} (${s.location}) w/ ${s.splitWith}`).join(', ')}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid #F0F4F8', background: '#F8FAFC' }}>
                <td style={{ padding: '8px 10px', fontWeight: 700, color: '#1B3A5C' }}>Total</td>
                <td></td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#10B981' }}>{fmt$(results.reduce((s,r)=>s+r.regularTotal,0))}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#C9A84C' }}>{fmt$(results.reduce((s,r)=>s+r.grossBonusTotal,0))}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#1B3A5C' }}>{fmt$(results.reduce((s,r)=>s+r.grandTotal,0))}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Days Worked Tab ────────────────────────────────────────────────────────
export function DaysWorkedTab({ doctor, patients }) {
  const LOC_FULL = { SC: 'Santa Clara', F: 'Fremont', WC: 'Walnut Creek', SV: 'Sunnyvale' };

  // Get all available years from data
  const allDoctorPatients = patients.filter(p => p.doctor === doctor.id);
  const availableYears = [...new Set(allDoctorPatients.map(p => String(p.year)))].filter(Boolean).sort();
  const [selectedYear, setSelectedYear] = useState('all');

  const dp = allDoctorPatients.filter(p =>
    selectedYear === 'all' || String(p.year) === selectedYear
  );

  if (allDoctorPatients.length === 0) return (
    <div style={{ padding: 32, textAlign: 'center', color: '#94A3B8' }}>
      <p>No production data found. Upload the Excel file on the Production page first.</p>
    </div>
  );

  const dayMap = {};
  for (const p of dp) {
    const k = p.date + '|' + p.loc;
    if (!dayMap[k]) dayMap[k] = { date: p.date, loc: p.loc, dayOfWeek: p.dayOfWeek, patients: 0, revenue: 0, optos: 0, cl: 0 };
    dayMap[k].patients++;
    dayMap[k].revenue += p.total;
    if (p.optos) dayMap[k].optos++;
    if (p.cl) dayMap[k].cl++;
  }

  const days = Object.values(dayMap).sort((a, b) => b.date.localeCompare(a.date));
  const totalRev = days.reduce((s, d) => s + d.revenue, 0);

  return (
    <div>
      {/* Year toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', marginRight: 4 }}>Year:</span>
        {['all', ...availableYears].map(y => (
          <button key={y} onClick={() => setSelectedYear(y)}
            style={{ background: selectedYear===y?'#1B3A5C':'#F1F5F9', color: selectedYear===y?'white':'#64748B', border: 'none', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12, fontWeight: selectedYear===y?700:400 }}>
            {y === 'all' ? 'All' : y}
          </button>
        ))}
        <span style={{ fontSize: 12, color: '#94A3B8', marginLeft: 8 }}>{days.length} days · {fmt$(totalRev)} · avg {fmt$(days.length?totalRev/days.length:0)}/day</span>
      </div>

      {days.length === 0 ? <p style={{ color: '#94A3B8', fontSize: 13 }}>No data for {selectedYear}.</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #F0F4F8' }}>
                {['Date','Day','Loc','Pts','Revenue','Optos','CL'].map(h => (
                  <th key={h} style={{ padding: '6px 8px', textAlign: ['Pts','Revenue','Optos','CL'].includes(h)?'right':'left', fontSize: 10, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d, i) => (
                <tr key={d.date+d.loc} style={{ background: i%2===0?'white':'#FAFBFC', borderBottom: '1px solid #F0F4F8' }}>
                  <td style={{ padding: '5px 8px', fontWeight: 600, fontSize: 12 }}>{fmtDate(d.date)}</td>
                  <td style={{ padding: '5px 8px', color: '#64748B', fontSize: 11 }}>{d.dayOfWeek}</td>
                  <td style={{ padding: '5px 8px' }}><span style={{ background: '#EFF6FF', color: '#1D4ED8', borderRadius: 3, padding: '1px 5px', fontSize: 10, fontWeight: 600 }}>{d.loc}</span></td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontSize: 12 }}>{d.patients}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: '#10B981', fontSize: 12 }}>{fmt$(d.revenue)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: '#2E7D8C', fontSize: 12 }}>{d.optos||'—'}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: '#F59E0B', fontSize: 12 }}>{d.cl||'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
