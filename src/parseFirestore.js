import { collection, getDocs, query, orderBy, doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';

const LOCATIONS = { SC: 'Santa Clara', F: 'Fremont', WC: 'Walnut Creek', SV: 'Sunnyvale' };

const PAYOR_NORM = {
  'EM':'EyeMed','EYEMED':'EyeMed','AETNA':'EyeMed','CIGNA':'EyeMed','CIG':'EyeMed',
  'VSP':'VSP','VPS':'VSP','METLIFE':'VSP','GUARDIAN':'VSP',
  'UHC':'UHC','UNITED':'UHC','SPECTERA':'UHC','SPEC':'UHC',
  'SUPERIOR':'Superior','SUP':'Superior','SUOERIOR':'Superior','MES':'Superior',
  'DAVIS':'Davis','DV':'Davis',
  'COLONIAL':'Colonial','COL':'Colonial','COLORIAL':'Colonial',
  'FEP':'FEP','NVA':'NVA','VBA':'VBA','AVESIS':'Avesis','HERITAGE':'Heritage',
  'SELF':'Self Pay','CASH':'Self Pay','OOP':'Self Pay','SELF PAY':'Self Pay',
};

function normalizePayor(p) {
  if (!p) return 'Self Pay';
  const up = String(p).trim().toUpperCase();
  if (PAYOR_NORM[up]) return PAYOR_NORM[up];
  for (const [k,v] of Object.entries(PAYOR_NORM)) {
    if (up.startsWith(k) && k.length >= 3) return v;
  }
  return String(p).trim() || 'Self Pay';
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

function getSundayWeek(date) {
  // Sunday-start week number, matching the billing sheet's getFiscalWeekInfo
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayOfWeek = d.getUTCDay(); // 0=Sunday
  // Find the Sunday that starts this week
  const weekSunday = new Date(d);
  weekSunday.setUTCDate(d.getUTCDate() - dayOfWeek);
  // Find the first Sunday of the year
  const jan1 = new Date(Date.UTC(weekSunday.getUTCFullYear(), 0, 1));
  const jan1Day = jan1.getUTCDay();
  const firstSunday = new Date(jan1);
  firstSunday.setUTCDate(1 + (jan1Day === 0 ? 0 : 7 - jan1Day));
  // Week number
  const weekNum = Math.floor((weekSunday - firstSunday) / (7 * 86400000)) + (weekSunday >= firstSunday ? 1 : 0);
  // Imaging income
  const STANDARD_OPTOS = 39, STANDARD_OCT = 35;
  const isNewPricing = dateStr >= '2026-06-01';
  let optosIncome = 0, octIncome = 0;
  if (isNewPricing) {
    if (octAmt >= 70) { optosIncome = 39; octIncome = octAmt - 39; }
    else if (octAmt > 1) { octIncome = octAmt; }
    if (optosAmt > 1) optosIncome = optosAmt;
  } else {
    optosIncome = (optosAmt >= 1 || octAmt >= 1) ? STANDARD_OPTOS : 0;
    octIncome   = octAmt >= 1 ? STANDARD_OCT : 0;
  }

  return { week: weekNum, year: weekSunday.getUTCFullYear() };
}

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function entryToPatient(e) {
  const dateStr = e.date;
  if (!dateStr || !dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) return null;
  const jsDate = new Date(dateStr + 'T12:00:00');
  if (isNaN(jsDate)) return null;
  const loc = e.location;
  if (!loc || !LOCATIONS[loc]) return null;
  const doctor = e.doctorId ? e.doctorId.trim().split(/\s+/).pop() : null;
  if (!doctor || doctor === 'CLOSED') return null;
  const patient = e.patientName?.trim();
  if (!patient) return null;

  const year     = jsDate.getFullYear();
  const month    = jsDate.getMonth() + 1;
  const { week: isoWeek, year: weekYear } = getSundayWeek(jsDate);
  const dayOfWeek = DAY_NAMES[jsDate.getDay()];

  const examAmt   = parseFloat(e.exam || e.routine) || 0;
  const clAmt     = parseFloat(e.cl)     || 0;
  const optosAmt  = parseFloat(e.optos)  || 0;
  const dfeAmt    = parseFloat(e.dfe)    || 0;
  const ovAmt     = parseFloat(e.ov)     || 0;
  const octAmt    = parseFloat(e.oct)    || 0;
  const topoAmt   = parseFloat(e.topo)   || 0;
  const myopiaAmt = parseFloat(e.myopia) || 0;
  const lasikAmt  = parseFloat(e.lasik)  || 0;
  const matsAmt   = parseFloat(e.materials) || 0;
  const EXCLUDE_FROM_BONUS = new Set(['Oasis Materials','Contact Lens Training','No-Show Fee','MNCL Reimbursement','Contact Lens Materials']);

  const oasisAmt  = ((e.otherType==='Oasis Materials'?parseFloat(e.otherAmt)||0:0) + (e.otherType2==='Oasis Materials'?parseFloat(e.otherAmt2)||0:0));
  const otherAmt  = ((e.otherType==='Oasis Materials'?0:parseFloat(e.otherAmt)||0) + (e.otherType2==='Oasis Materials'?0:parseFloat(e.otherAmt2)||0));

  // All amounts that should be excluded from doctor production/bonus
  const excludedAmt = ((EXCLUDE_FROM_BONUS.has(e.otherType) ? parseFloat(e.otherAmt)||0 : 0) +
                       (EXCLUDE_FROM_BONUS.has(e.otherType2) ? parseFloat(e.otherAmt2)||0 : 0));

  // For imported data, exam/cl etc. may be '1' (boolean flag from spreadsheet)
  const svcRendered = (amt) => amt > 0 || amt === 1;

  const paid    = Math.max(0, (parseFloat(e.ptPaid) || 0) - excludedAmt);
  const ins     = (parseFloat(e.ins1Amt)||0) + (parseFloat(e.ins2Amt)||0) + (parseFloat(e.ins3Amt)||0) || parseFloat(e.ins) || 0;
  const insPaid = (parseFloat(e.insurancePaid1)||0) + (parseFloat(e.insurancePaid2)||0) + (parseFloat(e.insurancePaid3)||0);
  const oasisTotal = excludedAmt; // practice revenue — excluded from doctor production

  // Determine actual dollar amounts for imaging fields
  // Pre-June 2026 entries have "1" as indicator — use standard charges
  const STANDARD_OPTOS = 39;
  const STANDARD_OCT = 35;
  const isNewPricing = dateStr >= '2026-06-01';

  let optosIncome = 0, octIncome = 0;
  if (isNewPricing) {
    // If OCT is $70+, it's a combined optos+OCT charge — split into components
    if (octAmt >= 70) {
      optosIncome = 39;
      octIncome   = octAmt - 39;
    } else if (octAmt > 1) {
      octIncome = octAmt;
    }
    // Separately billed optos takes priority
    if (optosAmt > 1) optosIncome = optosAmt;
  } else {
    // Pre-cutoff: use standard charges per indicator flag
    optosIncome = (optosAmt >= 1 || octAmt >= 1) ? STANDARD_OPTOS : 0;
    octIncome   = octAmt >= 1 ? STANDARD_OCT : 0;
  }
  const dfeIncome = isNewPricing && dfeAmt > 1 ? dfeAmt : 0;

  return {
    year, loc, locationName: LOCATIONS[loc],
    doctor, date: dateStr, month, isoWeek, weekYear, dayOfWeek, patient,
    status: e.attnResolved ? 'done' : e.attn ? 'flagged' : 'pending',
    routine:  svcRendered(examAmt),
    cl:       svcRendered(clAmt),
    optos:    svcRendered(optosAmt) || octAmt >= 70,
    dfe:      svcRendered(dfeAmt),
    ov:       svcRendered(ovAmt),
    oct:      svcRendered(octAmt),
    topo:     svcRendered(topoAmt),
    other:    otherAmt > 0 || svcRendered(parseFloat(e.other)||0),
    hasMyopia:   myopiaAmt > 1,
    myopiaAmt,
    myopiaType:  inferMyopiaType(myopiaAmt),
    hasLASIK:    lasikAmt > 0,
    lasikAmt,
    materialsAmt: matsAmt,
    optosIncome, octIncome,
    optosIncome, octIncome, dfeIncome,
    optosAmt: optosAmt > 1 ? optosAmt : 0,
    octAmt:   octAmt   > 1 ? octAmt   : 0,
    paid, ins, insPaid,
    total: paid + (insPaid > 0 ? insPaid : ins),
    oasisAmt: excludedAmt,
    medNecessary: !!e.medNecessary,
    medNecPayment: parseFloat(e.medNecPayment)||0,
    medNecCost: parseFloat(e.medNecCost)||0,
    medNecNet: Math.max(0, (parseFloat(e.medNecPayment)||0) - (parseFloat(e.medNecCost)||0)),
    oasisAmt: oasisTotal,
    medNecessary: !!e.medNecessary,
    medNecPayment: parseFloat(e.medNecPayment)||0,
    medNecCost: parseFloat(e.medNecCost)||0,
    medNecNet: Math.max(0, (parseFloat(e.medNecPayment)||0) - (parseFloat(e.medNecCost)||0)),
    payor:  normalizePayor(e.payor1),
    payor2: e.payor2 ? normalizePayor(e.payor2) : null,
    cash: 0,
    payErr: parseFloat(e.paymentErrorLoss) || 0,
    insNon: parseFloat(e.insuranceNonpaymentLoss) || 0,
    grossForDay: null,
    isPaidUnknown: !e.ptPaid && !e.insurancePaid1 && !e.insPaidState,
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

export async function loadActiveDoctors() {
  try {
    const snap = await getDoc(doc(db, 'billingSettings', 'doctors'));
    if (snap.exists() && snap.data().list) return snap.data().list;
  } catch {}
  return ['Kha','Pan','Fan','Luong','Kaneta','Ghag','Zhang','So','Burger','Cheng','Duong','Yang'];
}
