import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from './firebase';
import { OPTOMAP_COSTS } from './parseExcel';

const LOCATIONS = { SC: 'Santa Clara', F: 'Fremont', WC: 'Walnut Creek', SV: 'Sunnyvale' };

const PAYOR_NORM = {
  'EM': 'EyeMed', 'EYEMED': 'EyeMed', 'AETNA': 'EyeMed', 'CIGNA': 'EyeMed', 'CIG': 'EyeMed',
  'VSP': 'VSP', 'VPS': 'VSP', 'METLIFE': 'VSP', 'GUARDIAN': 'VSP',
  'UHC': 'UHC', 'UNITED': 'UHC', 'SPECTERA': 'UHC', 'SPEC': 'UHC',
  'SUPERIOR': 'Superior', 'SUP': 'Superior', 'SUOERIOR': 'Superior',
  'DAVIS': 'Davis', 'DV': 'Davis',
  'COLONIAL': 'Colonial', 'COL': 'Colonial', 'COLORIAL': 'Colonial',
  'MES': 'Superior', 'FEP': 'FEP', 'NVA': 'NVA', 'VBA': 'VBA',
  'AVESIS': 'Avesis', 'HERITAGE': 'Heritage',
  'SELF': 'Self Pay', 'CASH': 'Self Pay', 'OOP': 'Self Pay',
};

function normalizePayor(p) {
  if (!p) return 'Self Pay';
  const up = String(p).trim().toUpperCase();
  if (!up) return 'Self Pay';
  if (PAYOR_NORM[up]) return PAYOR_NORM[up];
  // partial match
  for (const [k, v] of Object.entries(PAYOR_NORM)) {
    if (up.startsWith(k) || k.startsWith(up)) return v;
  }
  return p;
}

function inferMyopiaType(amount) {
  if (!amount || amount <= 1) return null;
  if (amount >= 1800) return 'Ortho-K (New)';
  if (amount >= 1100) return 'Ortho-K (Return)';
  if (amount >= 550)  return 'MiSight (New)';
  if (amount >= 350)  return 'MiSight (Return)';
  if (amount >= 280)  return 'Atropine/Stellest (New)';
  if (amount >= 150)  return 'Atropine/Stellest (Return)';
  return 'Myopia Control (Other)';
}

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function entryToPatient(e) {
  const dateStr = e.date; // already YYYY-MM-DD
  if (!dateStr || !dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) return null;

  const jsDate = new Date(dateStr + 'T12:00:00');
  if (isNaN(jsDate)) return null;

  const loc = e.location;
  if (!loc || !LOCATIONS[loc]) return null;

  const doctor = e.doctorId;
  if (!doctor || doctor === 'CLOSED') return null;

  const patient = e.patientName?.trim();
  if (!patient) return null;

  const year     = jsDate.getFullYear();
  const month    = jsDate.getMonth() + 1;
  const isoWeek  = getISOWeek(jsDate);
  const dayOfWeek = DAY_NAMES[jsDate.getDay()];

  // Services — in Firestore they're dollar amounts, treat >0 as "rendered"
  const examAmt  = parseFloat(e.exam || e.routine) || 0;
  const clAmt    = parseFloat(e.cl)    || 0;
  const optosAmt = parseFloat(e.optos) || 0;
  const dfeAmt   = parseFloat(e.dfe)   || 0;
  const ovAmt    = parseFloat(e.ov)    || 0;
  const octAmt   = parseFloat(e.oct)   || 0;
  const topoAmt  = parseFloat(e.topo)  || 0;
  const myopiaAmt= parseFloat(e.myopia)|| 0;
  const lasikAmt = parseFloat(e.lasik) || 0;
  const matsAmt  = parseFloat(e.materials) || 0;

  // Other service (new otherType/otherAmt system)
  const otherAmt = (parseFloat(e.otherAmt) || 0) + (parseFloat(e.otherAmt2) || 0);
  const hasOther = otherAmt > 0;

  const paid    = parseFloat(e.ptPaid) || 0;
  const ins     = parseFloat(e.ins)    || 0;
  const insPaid = parseFloat(e.insurancePaid1) || 0;
  const payErr  = parseFloat(e.paymentErrorLoss) || 0;
  const insNon  = parseFloat(e.insuranceNonpaymentLoss) || 0;

  // Determine if payment status is unknown (nothing entered yet)
  const isPaidUnknown = !e.ptPaid && !e.insurancePaid1 && !e.insPaidState;

  return {
    year, loc,
    locationName: LOCATIONS[loc],
    doctor, date: dateStr, month, isoWeek, dayOfWeek,
    patient,
    status: e.attnResolved ? 'done' : e.attn ? 'flagged' : 'pending',
    // Services as booleans (matching Excel shape)
    routine: examAmt > 0,
    cl:      clAmt   > 0,
    optos:   optosAmt> 0,
    dfe:     dfeAmt  > 0,
    ov:      ovAmt   > 0,
    oct:     octAmt  > 0,
    topo:    topoAmt > 0,
    other:   hasOther,
    hasMyopia:   myopiaAmt > 1,
    myopiaAmt,
    myopiaType:  inferMyopiaType(myopiaAmt),
    hasLASIK:    lasikAmt > 0,
    lasikAmt,
    materialsAmt: matsAmt,
    paid, ins,
    total: paid + (insPaid > 0 ? insPaid : ins),
    payor:  normalizePayor(e.payor1),
    payor2: e.payor2 ? normalizePayor(e.payor2) : null,
    cash:   0,
    insPaid,
    payErr, insNon,
    grossForDay: null,
    isPaidUnknown,
    // Keep raw amounts for potential future use
    _examAmt: examAmt, _clAmt: clAmt, _optosAmt: optosAmt,
  };
}

export async function loadFirestorePatients() {
  const snap = await getDocs(
    query(collection(db, 'billingEntries'), orderBy('date', 'desc'))
  );
  const patients = [];
  for (const d of snap.docs) {
    const p = entryToPatient({ id: d.id, ...d.data() });
    if (p) patients.push(p);
  }
  return patients;
}
