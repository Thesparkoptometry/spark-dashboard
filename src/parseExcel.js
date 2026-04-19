import * as XLSX from 'xlsx';

const LOCATIONS = { SC: 'Santa Clara', F: 'Fremont', WC: 'Walnut Creek', SV: 'Sunnyvale' };

// Fuzzy string similarity (Levenshtein distance)
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

// Exact and alias matches (checked first, case-insensitive)
const PAYOR_EXACT = {
  // EyeMed — EM, Aetna, Cigna all route here
  'EM': 'EyeMed', 'EYEMED': 'EyeMed',
  'AETNA': 'EyeMed', 'AETNA DISC': 'EyeMed',
  'CIGNA': 'EyeMed', 'CIG': 'EyeMed',
  // VSP — VSP, MetLife, Guardian all route here
  'VSP': 'VSP', 'VPS': 'VSP',
  'METLIFE': 'VSP', 'MET LIFE': 'VSP', 'METLIFE VISION': 'VSP',
  'GUARDIAN': 'VSP', 'GUARDIAN VISION': 'VSP',
  // UHC — UHC and Spectera both route here
  'UHC': 'UHC', 'UNITED': 'UHC', 'UNITED HEALTHCARE': 'UHC',
  'SPECTERA': 'UHC',
  // Superior
  'SUPERIOR': 'Superior', 'SUP': 'Superior',
  'SUOERIOR': 'Superior', 'SUPERIO': 'Superior', 'SUPERIOE': 'Superior',
  // Davis
  'DAVIS': 'Davis', 'DAVIS VISION': 'Davis',
  // Colonial (incl. typo COLORIAL)
  'COLONIAL': 'Colonial', 'COLORIAL': 'Colonial', 'COLONAIL': 'Colonial',
  // Standalone
  'FEP': 'FEP', 'NVA': 'NVA', 'VBA': 'VBA',
  'AVESIS': 'Avesis', 'HERITAGE': 'Heritage',
  // Self pay
  'SELF': 'Self Pay', 'CASH': 'Self Pay', 'OOP': 'Self Pay',
};

// Fuzzy targets: [canonical name, target string, max distance]
const FUZZY_RULES = [
  ['Superior', 'SUPERIOR', 2],
  ['Colonial', 'COLONIAL', 2],
  ['EyeMed',   'EYEMED',   2],
  ['VSP',      'METLIFE',  2],
  ['Davis',    'DAVIS',    2],
];

function normalizePayor(p) {
  if (!p) return 'Self Pay';
  const up = String(p).trim().toUpperCase();
  if (!up) return 'Self Pay';

  // Exact match first
  if (PAYOR_EXACT[up]) return PAYOR_EXACT[up];

  // Fuzzy match
  for (const [canonical, target, maxDist] of FUZZY_RULES) {
    if (Math.abs(up.length - target.length) <= maxDist && levenshtein(up, target) <= maxDist) {
      return canonical;
    }
  }

  return p; // keep original if no match
}

export function getPayorCategory(payor) {
  if (payor === 'Self Pay') return 'Self Pay';
  return 'Insurance';
}

function inferMyopiaType(amount) {
  if (!amount || amount <= 0) return null;
  if (amount === 1) return null; // data entry artifact
  if (amount >= 1800) return 'Ortho-K (New)';
  if (amount >= 1100) return 'Ortho-K (Return)';
  if (amount >= 550) return 'MiSight (New)';
  if (amount >= 350) return 'MiSight (Return)';
  if (amount >= 280) return 'Atropine/Stellest (New)';
  if (amount >= 150) return 'Atropine/Stellest (Return)';
  return 'Myopia Control (Other)';
}

function parseSheet(ws, year) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  
  // Find header row
  let headerIdx = rows.findIndex(r => r && r[0] === 'Location' && r[6] === 'Doctor');
  if (headerIdx === -1) headerIdx = 0;
  
  const headers = rows[headerIdx].map(h => h ? String(h).trim() : '');
  const col = (name) => headers.indexOf(name);
  
  const iLocation = col('Location');
  const iDay = col('Day');
  const iMonth = col('Month');
  const iWeek = col('Week');
  const iDate = col('Date');
  const iStatus = col('Status');
  const iDoctor = col('Doctor');
  const iGross = col('Gross');
  const iPatient = col('Patient Name');
  const iRoutine = col('Routine');
  const iCL = col('CL');
  const iOptos = col('Optos');
  const iDFE = col('DFE');
  const iOV = col('OV');
  const iOCT = col('OCT');
  const iTopo = col('Topo');
  const iOther = col('Other');
  const iMyopia = col('Myopia');
  const iLASIK = col('LASIK');
  const iMaterials = col('Materials');
  const iPaid = col('Paid');
  const iIns = col('Ins');
  const iPayor = col('Payor');
  const iPayor2 = col('Payor 2');
  const iCash = col('Cash');
  const iInsPaid = col('Insurance Paid');
  const iPayErr = col('Payment Error Loss');
  const iInsNon = col('Insurance Nonpayment Loss');

  const patients = [];
  const doctorDays = []; // one per doctor-day combo

  let currentDate = null;
  let currentDoctorDayKey = null;
  let currentGross = null;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;

    const loc = r[iLocation] ? String(r[iLocation]).trim() : null;
    const doctor = r[iDoctor] ? String(r[iDoctor]).trim() : null;
    const patient = r[iPatient] ? String(r[iPatient]).trim() : null;

    // Skip non-patient rows (section headers, CLOSED)
    if (!loc || !LOCATIONS[loc]) continue;
    if (doctor === 'CLOSED' || !doctor) continue;
    if (!patient || patient === 'Patient Name') continue;
    // Skip week/month header rows
    if (patient.includes('/') || patient.toUpperCase() === patient && patient.length < 10) continue;

    // Parse date - could be Excel serial or already a date
    let dateVal = r[iDate];
    let jsDate = null;
    if (dateVal instanceof Date) {
      jsDate = dateVal;
    } else if (typeof dateVal === 'number') {
      // Excel serial date
      jsDate = XLSX.SSF.parse_date_code(dateVal);
      if (jsDate) jsDate = new Date(jsDate.y, jsDate.m - 1, jsDate.d);
    } else if (typeof dateVal === 'string' && dateVal) {
      jsDate = new Date(dateVal);
    }

    if (!jsDate || isNaN(jsDate)) continue;

    const dateStr = jsDate.toISOString().split('T')[0];
    const month = jsDate.getMonth() + 1;
    const dayOfWeek = r[iDay] ? String(r[iDay]).trim() : ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][jsDate.getDay()];
    const week = r[iWeek] || null;

    // Track doctor-day for gross
    const key = `${loc}-${doctor}-${dateStr}`;
    if (r[iGross] != null && r[iGross] !== '') {
      currentGross = parseFloat(r[iGross]) || 0;
      currentDoctorDayKey = key;
    }
    const grossForDay = currentDoctorDayKey === key ? currentGross : null;

    const paid = parseFloat(r[iPaid]) || 0;
    const ins = parseFloat(r[iIns]) || 0;
    const myopiaAmt = parseFloat(r[iMyopia]) || 0;
    const lasikAmt = parseFloat(r[iLASIK]) || 0;
    const materialsAmt = parseFloat(r[iMaterials]) || 0;

    const patient_record = {
      year,
      loc,
      locationName: LOCATIONS[loc],
      doctor,
      date: dateStr,
      month,
      week: parseInt(week) || null,
      dayOfWeek,
      patient,
      status: r[iStatus] ? String(r[iStatus]).trim() : null,
      // Services
      routine: !!r[iRoutine],
      cl: !!r[iCL],
      optos: !!r[iOptos],
      dfe: !!r[iDFE],
      ov: !!r[iOV],
      oct: !!r[iOCT],
      topo: !!r[iTopo],
      other: !!r[iOther],
      hasMyopia: myopiaAmt > 1,
      myopiaAmt,
      myopiaType: inferMyopiaType(myopiaAmt),
      hasLASIK: lasikAmt > 0,
      lasikAmt,
      materialsAmt,
      // Revenue
      paid,
      ins,
      total: paid + ins,
      payor: normalizePayor(r[iPayor]),
      payor2: r[iPayor2] ? normalizePayor(r[iPayor2]) : null,
      cash: parseFloat(r[iCash]) || 0,
      insPaid: parseFloat(r[iInsPaid]) || 0,
      payErr: parseFloat(r[iPayErr]) || 0,
      insNon: parseFloat(r[iInsNon]) || 0,
      grossForDay,
    };

    patients.push(patient_record);
  }

  return patients;
}

export function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const results = { patients2025: [], patients2026: [], patients2024: [] };

        if (wb.SheetNames.includes('2026')) {
          results.patients2026 = parseSheet(wb.Sheets['2026'], 2026);
        }
        if (wb.SheetNames.includes('2025')) {
          results.patients2025 = parseSheet(wb.Sheets['2025'], 2025);
        }
        if (wb.SheetNames.includes('2024')) {
          results.patients2024 = parseSheet(wb.Sheets['2024'], 2024);
        }

        resolve(results);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export function computeStats(patients) {
  if (!patients || patients.length === 0) return null;

  const total = patients.length;
  const totalRevenue = patients.reduce((s, p) => s + p.total, 0);
  const totalPaid = patients.reduce((s, p) => s + p.paid, 0);
  const totalIns = patients.reduce((s, p) => s + p.ins, 0);

  // By location
  const byLocation = {};
  for (const loc of Object.keys(LOCATIONS)) {
    const lp = patients.filter(p => p.loc === loc);
    byLocation[loc] = {
      name: LOCATIONS[loc],
      patients: lp.length,
      revenue: lp.reduce((s, p) => s + p.total, 0),
      paid: lp.reduce((s, p) => s + p.paid, 0),
      ins: lp.reduce((s, p) => s + p.ins, 0),
      optos: lp.filter(p => p.optos).length,
      cl: lp.filter(p => p.cl).length,
      myopia: lp.filter(p => p.hasMyopia).length,
      myopiaRevenue: lp.reduce((s, p) => s + p.myopiaAmt, 0),
      lasik: lp.filter(p => p.hasLASIK).length,
      lasikRevenue: lp.reduce((s, p) => s + p.lasikAmt, 0),
    };
  }

  // By doctor
  const doctorNames = [...new Set(patients.map(p => p.doctor))].filter(d => d && d !== 'CLOSED');
  const byDoctor = {};
  for (const doc of doctorNames) {
    const dp = patients.filter(p => p.doctor === doc);
    const days = [...new Set(dp.map(p => p.date + p.loc))];
    byDoctor[doc] = {
      patients: dp.length,
      revenue: dp.reduce((s, p) => s + p.total, 0),
      optos: dp.filter(p => p.optos).length,
      cl: dp.filter(p => p.cl).length,
      myopia: dp.filter(p => p.hasMyopia).length,
      myopiaRevenue: dp.reduce((s, p) => s + p.myopiaAmt, 0),
      daysWorked: days.length,
      avgPerDay: days.length ? dp.reduce((s, p) => s + p.total, 0) / days.length : 0,
      avgPatientsPerDay: days.length ? dp.length / days.length : 0,
      optosRate: dp.length ? dp.filter(p => p.optos).length / dp.length : 0,
    };
  }

  // By month
  const byMonth = {};
  for (let m = 1; m <= 12; m++) {
    const mp = patients.filter(p => p.month === m);
    if (mp.length === 0) continue;
    const days = [...new Set(mp.map(p => p.date + p.loc + p.doctor))];
    byMonth[m] = {
      patients: mp.length,
      revenue: mp.reduce((s, p) => s + p.total, 0),
      optos: mp.filter(p => p.optos).length,
      cl: mp.filter(p => p.cl).length,
      myopia: mp.filter(p => p.hasMyopia).length,
      myopiaRevenue: mp.reduce((s, p) => s + p.myopiaAmt, 0),
    };
  }

  // By day of week
  const byDay = {};
  const dayOrder = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  for (const day of dayOrder) {
    const dp = patients.filter(p => p.dayOfWeek === day);
    if (dp.length === 0) continue;
    const uniqueDays = [...new Set(dp.map(p => p.date + p.loc))];
    byDay[day] = {
      patients: dp.length,
      revenue: dp.reduce((s, p) => s + p.total, 0),
      occurrences: uniqueDays.length,
      avgPatients: uniqueDays.length ? dp.length / uniqueDays.length : 0,
      avgRevenue: uniqueDays.length ? dp.reduce((s, p) => s + p.total, 0) / uniqueDays.length : 0,
    };
  }

  // Myopia breakdown
  const myopiaPatients = patients.filter(p => p.hasMyopia);
  const myopiaByType = {};
  for (const mp of myopiaPatients) {
    const t = mp.myopiaType || 'Unknown';
    if (!myopiaByType[t]) myopiaByType[t] = { count: 0, revenue: 0 };
    myopiaByType[t].count++;
    myopiaByType[t].revenue += mp.myopiaAmt;
  }

  // Payor mix
  const payorCounts = {};
  for (const p of patients) {
    const pay = p.payor || 'Unknown';
    if (!payorCounts[pay]) payorCounts[pay] = { count: 0, revenue: 0 };
    payorCounts[pay].count++;
    payorCounts[pay].revenue += p.total;
  }

  // Unique working days
  const uniqueDays = [...new Set(patients.map(p => p.date + p.loc))];
  const avgRevenuePerDay = uniqueDays.length ? totalRevenue / uniqueDays.length : 0;
  const avgPatientsPerDay = uniqueDays.length ? total / uniqueDays.length : 0;
  const avgRevenuePerPatient = total ? totalRevenue / total : 0;

  return {
    total, totalRevenue, totalPaid, totalIns,
    uniqueDays: uniqueDays.length,
    avgRevenuePerDay, avgPatientsPerDay, avgRevenuePerPatient,
    byLocation, byDoctor, byMonth, byDay,
    myopiaCount: myopiaPatients.length,
    myopiaRevenue: myopiaPatients.reduce((s, p) => s + p.myopiaAmt, 0),
    myopiaByType, payorCounts,
    optos: patients.filter(p => p.optos).length,
    cl: patients.filter(p => p.cl).length,
    lasik: patients.filter(p => p.hasLASIK).length,
    lasikRevenue: patients.reduce((s, p) => s + p.lasikAmt, 0),
  };
}

export const LOCATION_NAMES = LOCATIONS;
export const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const DOCTOR_LIST = ['Kha','Pan','Fan','Ghag','Kaneta','Yang','Luong','Zhang','Burger','Cheng','Miranda','Pham','Duong','So'];
