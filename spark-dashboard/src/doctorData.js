import { db } from './firebase';
import {
  collection, doc, getDocs, setDoc, deleteDoc
} from 'firebase/firestore';

export const DOCTOR_TYPE_LABELS = {
  ft: 'Full-Time', ppt: 'Part-Time', fill: 'Fill-In', owner: 'Owner'
};

// ── Default roster (seeded to Firebase on first load) ────────────────────────
export const DEFAULT_ROSTER = [
  { id: 'Kha',     name: 'Dr. Kha',     type: 'ft',   payType: 'perdiem_pct', locations: ['SV','SC'], archived: false },
  { id: 'Pan',     name: 'Dr. Pan',     type: 'ft',   payType: 'perdiem_pct', locations: ['SC'],      archived: false },
  { id: 'Fan',     name: 'Dr. Fan',     type: 'ppt',  payType: 'perdiem_pct', locations: ['SC','F'],  archived: false },
  { id: 'Luong',   name: 'Dr. Luong',  type: 'ppt',  payType: 'perdiem_pct', locations: ['SC','F'],  archived: false },
  { id: 'Ghag',    name: 'Dr. Ghag',   type: 'ppt',  payType: 'perdiem',     locations: ['F'],       archived: false },
  { id: 'Kaneta',  name: 'Dr. Kaneta', type: 'ppt',  payType: 'perdiem',     locations: ['WC'],      archived: false },
  { id: 'Zhang',   name: 'Dr. Zhang',  type: 'ppt',  payType: 'perdiem',     locations: ['WC'],      archived: false },
  { id: 'So',      name: 'Dr. So',     type: 'ppt',  payType: 'perdiem',     locations: ['SC'],      archived: false },
  { id: 'Burger',  name: 'Dr. Burger', type: 'fill', payType: 'perdiem',     locations: [],          archived: false },
  { id: 'Cheng',   name: 'Dr. Cheng',  type: 'fill', payType: 'perdiem',     locations: ['SV'],      archived: false },
  { id: 'Duong',   name: 'Dr. Duong',  type: 'fill', payType: 'perdiem',     locations: ['SV','F','SC'], archived: false },
  { id: 'Miranda', name: 'Dr. Miranda',type: 'fill', payType: 'perdiem',     locations: [],          archived: false },
  { id: 'Pham',    name: 'Dr. Pham',   type: 'fill', payType: 'perdiem',     locations: [],          archived: false },
  { id: 'Yang',    name: 'Dr. Yang',   type: 'owner',payType: 'none',        locations: ['SC','F','WC','SV'], archived: false },
];

// ── Bonus structure ────────────────────────────────────────────────────────
export const BONUS_ELIGIBLE = ['Kha','Pan','Fan','Luong'];

export const GROSS_BONUS = { threshold: 1200, pct: 0.30 };

export const MYOPIA_BONUS = {
  'Ortho-K':    { new: 250, renewal: 150 },
  'MiSight':    { new: 100, renewal: 75  },
  'Atropine':   { new: 50,  renewal: 25  },
  'Stellest':   { new: 50,  renewal: 25  },
  'Monitoring': { new: 50,  renewal: 25  },
};

export const LASIK_BONUS = 150;

// ── Bonus calculator ───────────────────────────────────────────────────────
export function calcDayBonus(doctorId, bonusEligibleIds, gross, myopiaEvents = [], lasikCount = 0) {
  const eligible = bonusEligibleIds || BONUS_ELIGIBLE;
  if (!eligible.includes(doctorId)) return { gross: 0, myopia: 0, lasik: 0, total: 0 };
  const grossBonus = gross > GROSS_BONUS.threshold ? (gross - GROSS_BONUS.threshold) * GROSS_BONUS.pct : 0;
  const myopiaBonus = myopiaEvents.reduce((sum, ev) => {
    const tier = MYOPIA_BONUS[ev.therapy];
    return tier ? sum + (ev.isNew ? tier.new : tier.renewal) : sum;
  }, 0);
  const lasikBonus = lasikCount * LASIK_BONUS;
  return {
    gross: Math.round(grossBonus * 100) / 100,
    myopia: myopiaBonus,
    lasik: lasikBonus,
    total: Math.round((grossBonus + myopiaBonus + lasikBonus) * 100) / 100,
  };
}

// ── Firebase roster CRUD ───────────────────────────────────────────────────
export async function loadRoster() {
  const snap = await getDocs(collection(db, 'doctorRoster'));
  if (snap.empty) {
    // First load — seed default roster
    await Promise.all(DEFAULT_ROSTER.map(d =>
      setDoc(doc(db, 'doctorRoster', d.id), d)
    ));
    return [...DEFAULT_ROSTER];
  }
  return snap.docs.map(d => d.data());
}

export async function saveRosterDoctor(doctor) {
  await setDoc(doc(db, 'doctorRoster', doctor.id), doctor);
}

export async function deleteRosterDoctor(doctorId) {
  await deleteDoc(doc(db, 'doctorRoster', doctorId));
}

// ── Firebase profiles CRUD ─────────────────────────────────────────────────
export async function loadDoctorProfiles() {
  const snap = await getDocs(collection(db, 'doctorProfiles'));
  const profiles = {};
  snap.forEach(d => { profiles[d.id] = d.data(); });
  return profiles;
}

export async function saveDoctorProfile(doctorId, data) {
  await setDoc(doc(db, 'doctorProfiles', doctorId), data, { merge: true });
}

export async function loadPayments(doctorId) {
  const snap = await getDocs(collection(db, 'doctorProfiles', doctorId, 'payments'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function savePayment(doctorId, payment) {
  const ref = payment.id
    ? doc(db, 'doctorProfiles', doctorId, 'payments', payment.id)
    : doc(collection(db, 'doctorProfiles', doctorId, 'payments'));
  await setDoc(ref, { ...payment, id: ref.id });
  return ref.id;
}

export async function deletePayment(doctorId, paymentId) {
  await deleteDoc(doc(db, 'doctorProfiles', doctorId, 'payments', paymentId));
}

// ── Compute doctor stats from production data ──────────────────────────────
export function computeDoctorStats(patients, doctorId, year = 'all', bonusEligibleIds) {
  const eligible = bonusEligibleIds || BONUS_ELIGIBLE;
  const dp = patients.filter(p =>
    p.doctor === doctorId &&
    (year === 'all' || String(p.year) === String(year))
  );
  if (dp.length === 0) return null;

  const days = [...new Set(dp.map(p => p.date + p.loc))];
  const totalRevenue = dp.reduce((s, p) => s + p.total, 0);
  const routinePatients = dp.filter(p => p.routine);

  // Gross bonus calculation per day
  let totalGrossBonus = 0;
  const dayGroups = {};
  for (const p of dp) {
    const k = p.date + p.loc;
    if (!dayGroups[k]) dayGroups[k] = { gross: 0, myopia: [], lasik: 0 };
    dayGroups[k].gross += p.total;
    if (p.hasMyopia && p.myopiaAmt > 0) {
      const therapy = inferTherapyFromAmount(p.myopiaAmt);
      const isNew = p.myopiaAmt >= 1200 || p.myopiaAmt === 2100 || p.myopiaAmt === 400 || p.myopiaAmt === 100 || p.myopiaAmt === 50 || p.myopiaAmt === 250;
      dayGroups[k].myopia.push({ therapy, isNew });
    }
    if (p.hasLASIK) dayGroups[k].lasik++;
  }

  for (const day of Object.values(dayGroups)) {
    const bonus = calcDayBonus(doctorId, eligible, day.gross, day.myopia, day.lasik);
    totalGrossBonus += bonus.total;
  }

  const bonusDays = Object.values(dayGroups).filter(d =>
    eligible.includes(doctorId) && d.gross > GROSS_BONUS.threshold
  ).length;

  return {
    patients: dp.length,
    daysWorked: days.length,
    totalRevenue,
    avgPerDay: days.length ? totalRevenue / days.length : 0,
    avgPerPatient: dp.length ? totalRevenue / dp.length : 0,
    avgPerRoutine: routinePatients.length ? totalRevenue / routinePatients.length : 0,
    routineCount: routinePatients.length,
    optos: dp.filter(p => p.optos).length,
    optosRate: dp.length ? dp.filter(p => p.optos).length / dp.length : 0,
    oct: dp.filter(p => p.oct).length,
    cl: dp.filter(p => p.cl).length,
    myopia: dp.filter(p => p.hasMyopia).length,
    myopiaRevenue: dp.reduce((s, p) => s + p.myopiaAmt, 0),
    lasik: dp.filter(p => p.hasLASIK).length,
    estimatedGrossBonus: totalGrossBonus,
    bonusDays,
    bonusDayRate: days.length ? bonusDays / days.length : 0,
  };
}

function inferTherapyFromAmount(amt) {
  if (amt >= 1100) return 'Ortho-K';
  if (amt >= 350)  return 'MiSight';
  if (amt >= 150)  return 'Atropine';
  return 'Monitoring';
}

// ── Square Payroll Parser ───────────────────────────────────────────────────
export function buildSquareNameMap(roster) {
  const map = {};
  for (const d of roster) {
    map[d.id.toLowerCase()] = d.id;
  }
  return map;
}

export function matchSquareName(squareName, roster) {
  if (!squareName) return null;
  const lastName = squareName.split(',')[0].trim().toLowerCase();
  // Try to find roster doctor whose id matches last name
  const found = (roster || []).find(d => d.id.toLowerCase() === lastName);
  return found ? found.id : null;
}

export function parseSquarePayrollXLSX(data, roster) {
  const paychecks = [];
  let currentName = null;
  let currentPayDate = null;
  let currentPeriodStart = null;
  let currentPeriodEnd = null;

  const NAME_SKIP = [
    'Pay date','Period','Work Address','Resident','Paid by','Processed',
    'Paycheck','Commissions','Contractor','Earnings','Tips','FEIN',
    'Business','Generated','Christine','Disclaimer','Regular','Overtime',
    'Double','PTO','Sick','Additional',
  ];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;
    const c0 = row[0] != null ? String(row[0]).trim() : '';
    const c1 = row[1] != null ? String(row[1]).trim() : '';

    const c1Empty = !c1 || c1 === '' || c1 === 'null' || c1 === 'undefined';
    if (c0 && c0 !== 'null' && c0.includes(',') && c0.length < 50 && c1Empty
        && !NAME_SKIP.some(k => c0.startsWith(k))) {
      currentName = c0;
    } else if (c0.startsWith('Pay date:')) {
      currentPayDate = c0.replace('Pay date:', '').trim();
    } else if (c0.startsWith('Period start date:')) {
      currentPeriodStart = c0.replace('Period start date:', '').trim();
    } else if (c0.startsWith('Period end date:')) {
      currentPeriodEnd = c0.replace('Period end date:', '').trim();
    } else if (c1 === 'Total' && currentName && currentPayDate) {
      // col4=gross, col17=net (confirmed from file structure)
      // Also try alternate positions in case XLSX.js shifts columns
      const gross = parseFloat(row[4]) || parseFloat(row[3]) || 0;
      const net = parseFloat(row[17]) || parseFloat(row[16]) || 0;
      const doctorId = matchSquareName(currentName, roster);

      const parseMMDDYY = (s) => {
        if (!s) return s;
        try {
          const p = s.split('/');
          if (p.length === 3) {
            const yr = p[2].length === 2 ? '20' + p[2] : p[2];
            return `${yr}-${p[0].padStart(2,'0')}-${p[1].padStart(2,'0')}`;
          }
        } catch {}
        return s;
      };

      if (gross > 0) {
        paychecks.push({
          squareName: currentName,
          doctorId,
          payDate: parseMMDDYY(currentPayDate),
          periodStart: parseMMDDYY(currentPeriodStart),
          periodEnd: parseMMDDYY(currentPeriodEnd),
          gross,
          net,
        });
      }
    }
  }
  return paychecks;
}
