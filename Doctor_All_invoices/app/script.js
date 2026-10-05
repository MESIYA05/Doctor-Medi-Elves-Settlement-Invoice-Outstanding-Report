let ALL_INVOICES = [];
let FILTERED_DATA = [];
let ALL_DOCTORS_LIST = [];
let LOGO_DATA_URL = null;

let CURRENT_USER_EMAIL = "";
let CURRENT_DOCTOR_ID = null;
let CURRENT_DOCTOR_NAME = null;
let LOGGED_IN_DOCTOR_RECORD = null;

const DOCTOR_ID_TO_NAME = new Map();
const DOCTOR_NAME_TO_IDS = new Map();



function loadLogoAsDataURL() {
  if (typeof MEDI_ELVES_LOGO_BASE64 !== "undefined") {
    LOGO_DATA_URL = MEDI_ELVES_LOGO_BASE64;
  }
  return Promise.resolve(LOGO_DATA_URL);
}

/* ===================================================
   UTILITY & FORMATTING HELPERS
   =================================================== */

function toLabel(v) {
  if (v === null || v === undefined || v === "") return "";
  if (Array.isArray(v)) return v.map(toLabel).filter(Boolean).join(", ");
  if (typeof v === "object") return v.zc_display_value || v.display_value || v.Doctor_Name || v.ID || "";
  return String(v);
}

function getLookupId(val) {
  if (!val) return "";
  if (Array.isArray(val)) {
    if (val.length === 0) return "";
    return getLookupId(val[0]);
  }
  if (typeof val === "object") return val.ID || val.id || "";
  return String(val);
}

function getLookupLabel(val) {
  if (!val) return "";
  if (Array.isArray(val)) {
    if (val.length === 0) return "";
    return val.map(getLookupLabel).filter(Boolean).join(", ");
  }
  if (typeof val === "object") {
    return val.zc_display_value || val.display_value || val.Doctor_Name || val.name || "";
  }
  const s = String(val).trim();
  if (/^\d{10,}$/.test(s)) return "";
  return s;
}


function parseAmount(val) {
  if (val === null || val === undefined || val === "") return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  const cleaned = String(val).replace(/[^0-9.-]+/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function fmtMoney(val) {
  const num = parseAmount(val);
  return "$ " + num.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseZohoDate(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return isNaN(dateStr.getTime()) ? null : dateStr;
  const str = String(dateStr).trim();
  if (!str) return null;

  // Handle DD/MM/YYYY or DD-MM-YYYY (Australian standard format)
  const dmyMatch = str.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    const d = new Date(year, month, day);
    return isNaN(d.getTime()) ? null : d;
  }

  // Handle YYYY-MM-DD (ISO format from HTML date inputs)
  const ymdMatch = str.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    const d = new Date(year, month, day);
    return isNaN(d.getTime()) ? null : d;
  }

  // Handle "28 Sept 2026" or "28-Sept-2026" -> normalize "Sept" to "Sep"
  const clean = str.replace(/-/g, " ").replace(/\bSept\b/gi, "Sep");
  const d = new Date(clean);
  if (!isNaN(d.getTime())) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  return null;
}

function formatDateRange(from, to) {
  if (!from && !to) return "All Available Dates";
  const f = parseZohoDate(from);
  const t = parseZohoDate(to);
  const fmt = d => d ? d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" }) : "-";
  if (f && t) return `${fmt(f)} to ${fmt(t)}`;
  if (f) return `From ${fmt(f)}`;
  if (t) return `Up to ${fmt(t)}`;
  return "All Available Dates";
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* ===================================================
   INVOICE FIELD EXTRACTORS
   =================================================== */

function getInvoiceDoctor(inv) {
  if (!inv) return "-";
  let name = getLookupLabel(inv.Doctor)
    || inv.Doctor_Name
    || inv["Doctor.Doctor_Name"]
    || inv["Doctor.zc_display_value"]
    || inv["Doctor.display_value"]
    || (typeof inv.Doctor === "string" && isNaN(inv.Doctor) ? inv.Doctor : "");

  const docId = getInvoiceDoctorId(inv);
  if ((!name || name === "-" || /^\d{10,}$/.test(name)) && docId && DOCTOR_ID_TO_NAME.has(String(docId))) {
    name = DOCTOR_ID_TO_NAME.get(String(docId));
  }

  if (name && name !== "-" && !/^\d{10,}$/.test(name)) return name;
  if (CURRENT_DOCTOR_NAME && isInvoiceForDoctor(inv)) return CURRENT_DOCTOR_NAME;
  return toLabel(inv.Doctor) || "-";
}

function getInvoiceAmount(inv) {
  if (!inv) return 0;
  const val = inv.Total_AUD ?? inv["Total AUD"] ?? inv.Subtotal ?? inv.subtotal ?? inv.Invoice_Amount ?? inv["Invoice Amount"] ?? inv.Total ?? inv.Amount ?? 0;
  return parseAmount(val);
}

function getInvoicePaid(inv) {
  if (!inv) return 0;
  const val = inv.Less_Amount_Paid ?? inv["Less Amount Paid"] ?? inv.Amount_Paid ?? inv["Amount Paid"] ?? inv.Paid_Amount ?? inv.Paid ?? inv.paid ?? 0;
  return parseAmount(val);
}

function getInvoiceBalance(inv) {
  if (!inv) return 0;
  const b = inv.Amount_Due_AUD ?? inv["Amount Due AUD"] ?? inv.Amount_Due ?? inv["Amount Due"] ?? inv.Outstanding_Balance ?? inv["Outstanding Balance"] ?? inv.Balance ?? inv.balance;
  if (b !== undefined && b !== null && b !== "") {
    return parseAmount(b);
  }
  return Math.max(0, getInvoiceAmount(inv) - getInvoicePaid(inv));
}

function getInvoiceDoctorId(inv) {
  if (!inv) return "";
  return getLookupId(inv.Doctor) || inv["Doctor.ID"] || inv.Doctor_ID || "";
}

function getInvoiceNo(inv) {
  if (!inv) return "-";
  return toLabel(inv.Invoice_No) || toLabel(inv["Invoice No"]) || inv.Invoice_Number || inv["Invoice Number"] || inv.Invoice_ID || "-";
}

function getInvoiceDate(inv) {
  if (!inv) return null;
  return parseZohoDate(inv.Invoice_Date || inv["Invoice Date"] || inv.Date || inv.Added_Time || inv["Added Time"]);
}

function getInvoiceDisplayDate(inv) {
  const rawDate = inv ? (inv.Invoice_Date || inv["Invoice Date"] || inv.Date || inv.Added_Time || inv["Added Time"]) : null;
  if (!rawDate) return "-";
  const d = parseZohoDate(rawDate);
  if (d) {
    return d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
  }
  return toLabel(rawDate) || "-";
}

function getInvoiceStatus(inv) {
  if (!inv) return "-";
  return toLabel(inv.Status) || inv.Payment_Status || inv["Payment Status"] || inv.Status || "-";
}

function isVoidInvoice(inv) {
  if (!inv) return false;
  const s = String(getInvoiceStatus(inv) || "").trim().toLowerCase();
  if (s === "void" || s.includes("void")) return true;
  const rawStatus = String(toLabel(inv.Status) || inv.Payment_Status || inv["Payment Status"] || inv.Status || "").trim().toLowerCase();
  if (rawStatus === "void" || rawStatus.includes("void")) return true;
  return false;
}

function getStatusClass(status) {
  return String(status || "").toLowerCase().replace(/\s+/g, "-");
}

/* ===================================================
   LOADING OVERLAY
   =================================================== */

function showLoading() {
  const el = document.getElementById("fxLoader");
  if (!el) return;
  setLoadingProgress(10, "Initializing connection...");
  el.classList.add("is-active");
}

function setLoadingProgress(pct, text) {
  const fill = document.getElementById("fxBarFill");
  const pctEl = document.getElementById("fxPct");
  const status = document.getElementById("fxStatus");
  if (fill) fill.style.width = pct + "%";
  if (pctEl) pctEl.textContent = Math.round(pct) + "%";
  if (status && text) status.textContent = text;
}

function hideLoading() {
  const el = document.getElementById("fxLoader");
  if (!el) return;
  setLoadingProgress(100, "Ready");
  setTimeout(() => el.classList.remove("is-active"), 400);
}

/* ===================================================
   ZOHO CREATOR DATA API (WITH RETRIES ON 429)
   =================================================== */

function isRateLimited(err) {
  const s = JSON.stringify(err || "") + (err && err.responseText || "");
  return (err && err.status === 429) || s.includes("2955") || s.includes("Too Many");
}

function isNoRecords(err) {
  const s = JSON.stringify(err || "") + (err && err.responseText || "");
  return s.includes("3100") || /no records/i.test(s);
}

async function zohoGetRecords(config, retries = 4) {
  let delay = 800;
  for (let attempt = 0; ; attempt++) {
    try {
      return await ZOHO.CREATOR.DATA.getRecords(config);
    } catch (err) {
      if (isRateLimited(err) && attempt < retries) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      throw err;
    }
  }
}

async function fetchAllRecords(reportName, extraConfig = {}) {
  let all = [];
  let cursor = null;

  do {
    const config = {
      report_name: reportName,
      field_config: "all",
      max_records: 200,
      ...extraConfig
    };
    if (cursor) config.record_cursor = cursor;

    let resp;
    try {
      resp = await zohoGetRecords(config);
    } catch (err) {
      if (isNoRecords(err)) {
        console.log(`fetchAllRecords(${reportName}): no records found`);
      } else {
        console.warn(`fetchAllRecords(${reportName}) stopped:`, err);
      }
      break;
    }

    all = all.concat(resp.data || []);
    cursor = resp.record_cursor || null;
  } while (cursor);

  console.log(`${reportName}: fetched ${all.length} records`);
  return all;
}

// Generic fetch with fallback report names (supports Portal & Admin reports)
async function fetchRecordsWithFallback(...args) {
  let extraConfig = {};
  const reports = [];
  for (const arg of args) {
    if (typeof arg === "string") {
      reports.push(arg);
    } else if (Array.isArray(arg)) {
      reports.push(...arg);
    } else if (typeof arg === "object" && arg !== null) {
      extraConfig = arg;
    }
  }

  for (const rep of reports) {
    if (!rep) continue;
    try {
      console.log(`Fetching records from report: ${rep}...`);
      const records = await fetchAllRecords(rep, extraConfig);
      if (records && records.length > 0) {
        console.log(`Successfully fetched ${records.length} records from ${rep}`);
        return records;
      }
    } catch (err) {
      console.warn(`Fetch ${rep} error:`, err);
    }
  }
  return [];
}

// Extract doctor email from record supporting various Zoho Creator field names & object structures
function getDoctorEmail(d) {
  if (!d) return "";
  const val = d.Email ?? d.Email_field ?? d.Email_Address ?? d.Doctor_Email ?? d.email ?? d.Email1 ?? d.Portal_Email ?? d.User_Email ?? "";
  if (typeof val === "object" && val !== null) {
    return String(val.value || val.email || val.zc_display_value || "").trim().toLowerCase();
  }
  return String(val).trim().toLowerCase();
}

// Extract doctor display name from record
function getDoctorDisplayName(d) {
  if (!d) return "";
  if (d.Doctor_Name) return String(d.Doctor_Name).trim();
  if (typeof d.Name === "object" && d.Name !== null) {
    if (d.Name.zc_display_value) return String(d.Name.zc_display_value).trim();
    const full = `${d.Name.prefix || ""} ${d.Name.first_name || ""} ${d.Name.last_name || ""}`.trim();
    if (full) return full;
  } else if (d.Name) {
    return String(d.Name).trim();
  }
  return getLookupLabel(d.Doctor) || toLabel(d.Doctor) || toLabel(d.zc_display_value) || toLabel(d.display_value) || "";
}

// Register doctor IDs and Names into two-way lookup maps
function registerDoctorMapping(doc) {
  if (!doc) return;
  const name = getDoctorDisplayName(doc) || getLookupLabel(doc.Doctor) || doc.Doctor_Name || "";
  if (!name || name === "-" || /^\d{10,}$/.test(name)) return;

  const normName = name.trim().toLowerCase();
  const strippedName = normName.replace(/^(?:dr|doctor)\.?\s+/i, "").trim();

  const ids = [];
  if (doc.ID) ids.push(String(doc.ID).trim());
  const lookupId = getLookupId(doc.Doctor);
  if (lookupId) ids.push(String(lookupId).trim());
  if (typeof doc.Doctor === "object" && doc.Doctor && doc.Doctor.ID) ids.push(String(doc.Doctor.ID).trim());
  if (doc.Doctor_ID) ids.push(String(doc.Doctor_ID).trim());
  if (typeof doc.Doctor === "string" && /^\d{10,}$/.test(doc.Doctor.trim())) ids.push(doc.Doctor.trim());

  ids.forEach(id => {
    DOCTOR_ID_TO_NAME.set(id, name);
  });

  if (!DOCTOR_NAME_TO_IDS.has(normName)) DOCTOR_NAME_TO_IDS.set(normName, new Set());
  ids.forEach(id => DOCTOR_NAME_TO_IDS.get(normName).add(id));

  if (strippedName && strippedName !== normName) {
    if (!DOCTOR_NAME_TO_IDS.has(strippedName)) DOCTOR_NAME_TO_IDS.set(strippedName, new Set());
    ids.forEach(id => DOCTOR_NAME_TO_IDS.get(strippedName).add(id));
  }
}

// Match #Report:Portal_Doctors1 = #Report:All_Invoices Doctor
function isInvoiceForDoctor(inv, doctorId, doctorName, doctorEmail) {
  if (!inv) return false;
  const myDoctor = LOGGED_IN_DOCTOR_RECORD;
  const targetDoctorId = doctorId || CURRENT_DOCTOR_ID;
  const targetDoctorName = doctorName || CURRENT_DOCTOR_NAME;
  const targetEmail = doctorEmail || CURRENT_USER_EMAIL;

  if (!myDoctor && !targetDoctorId && !targetDoctorName && !targetEmail) return true;

  // 1) Direct comparison with myDoctor if available
  if (myDoctor) {
    // Compare myDoctor.Doctor with inv.Doctor
    const myDocField = myDoctor.Doctor;
    if (myDocField !== undefined && myDocField !== null && myDocField !== "") {
      const myDocFieldId = getLookupId(myDocField);
      const invDocId = getLookupId(inv.Doctor);
      if (myDocFieldId && invDocId && String(myDocFieldId).trim().toLowerCase() === String(invDocId).trim().toLowerCase()) {
        return true;
      }

      const rawMy = String(typeof myDocField === "object" ? (myDocField.ID || myDocField.id || "") : myDocField).trim().toLowerCase();
      const rawInv = String(typeof inv.Doctor === "object" ? (inv.Doctor.ID || inv.Doctor.id || "") : inv.Doctor).trim().toLowerCase();
      if (rawMy && rawInv && rawMy === rawInv) {
        return true;
      }

      const myDocLabel = getLookupLabel(myDocField);
      const invDocLabel = getLookupLabel(inv.Doctor);
      if (myDocLabel && invDocLabel && myDocLabel.trim().toLowerCase() === invDocLabel.trim().toLowerCase()) {
        return true;
      }
    }

    // Compare myDoctor.ID with inv.Doctor
    if (myDoctor.ID) {
      const myId = String(myDoctor.ID).trim().toLowerCase();
      const invDocId = String(getLookupId(inv.Doctor) || (inv.Doctor && inv.Doctor.ID) || inv.Doctor_ID || inv.Doctor || "").trim().toLowerCase();
      if (myId && invDocId && myId === invDocId) {
        return true;
      }
    }
  }

  // 2) Collect all target Doctor Names
  const targetNames = new Set();
  function addTargetName(n) {
    if (!n) return;
    const s = String(n).trim().toLowerCase();
    if (!s || s === "-" || /^\d{10,}$/.test(s)) return;
    targetNames.add(s);
    const norm = s.replace(/^(?:dr|doctor)\.?\s+/i, "").trim();
    if (norm) targetNames.add(norm);
  }

  addTargetName(targetDoctorName);
  if (myDoctor) {
    addTargetName(myDoctor.Doctor_Name);
    addTargetName(getDoctorDisplayName(myDoctor));
    addTargetName(getLookupLabel(myDoctor.Doctor));
    if (typeof myDoctor.Doctor === "object" && myDoctor.Doctor !== null) {
      addTargetName(myDoctor.Doctor.zc_display_value);
      addTargetName(myDoctor.Doctor.display_value);
      addTargetName(myDoctor.Doctor.Doctor_Name);
    }
    if (typeof myDoctor.Doctor === "string") {
      addTargetName(myDoctor.Doctor);
    }
  }

  // 3) Collect all target Doctor IDs from myDoctor, targetDoctorId, and name mappings
  const targetIds = new Set();
  if (targetDoctorId) targetIds.add(String(targetDoctorId).trim().toLowerCase());
  if (myDoctor) {
    if (myDoctor.ID) targetIds.add(String(myDoctor.ID).trim().toLowerCase());
    const dId = getLookupId(myDoctor.Doctor);
    if (dId) targetIds.add(String(dId).trim().toLowerCase());
    if (typeof myDoctor.Doctor === "object" && myDoctor.Doctor !== null && myDoctor.Doctor.ID) {
      targetIds.add(String(myDoctor.Doctor.ID).trim().toLowerCase());
    }
    if (myDoctor.Doctor_ID) targetIds.add(String(myDoctor.Doctor_ID).trim().toLowerCase());
    if (myDoctor["Doctor.ID"]) targetIds.add(String(myDoctor["Doctor.ID"]).trim().toLowerCase());
    if (typeof myDoctor.Doctor === "string" && myDoctor.Doctor.trim()) {
      targetIds.add(myDoctor.Doctor.trim().toLowerCase());
    }
    if (typeof myDoctor.Doctor === "number") {
      targetIds.add(String(myDoctor.Doctor).trim().toLowerCase());
    }
  }

  // Add IDs mapped from target doctor names
  targetNames.forEach(tName => {
    if (DOCTOR_NAME_TO_IDS.has(tName)) {
      DOCTOR_NAME_TO_IDS.get(tName).forEach(id => targetIds.add(id.toLowerCase()));
    }
  });

  // Extract invoice doctor IDs
  const invIds = new Set();
  const iId = getLookupId(inv.Doctor);
  if (iId) invIds.add(String(iId).trim().toLowerCase());
  if (typeof inv.Doctor === "object" && inv.Doctor !== null && inv.Doctor.ID) {
    invIds.add(String(inv.Doctor.ID).trim().toLowerCase());
  }
  if (inv.Doctor_ID) invIds.add(String(inv.Doctor_ID).trim().toLowerCase());
  if (inv["Doctor.ID"]) invIds.add(String(inv["Doctor.ID"]).trim().toLowerCase());
  if (typeof inv.Doctor === "string" && inv.Doctor.trim()) {
    invIds.add(inv.Doctor.trim().toLowerCase());
  }
  if (typeof inv.Doctor === "number") {
    invIds.add(String(inv.Doctor).trim().toLowerCase());
  }

  for (const id of invIds) {
    if (id && targetIds.has(id)) {
      return true;
    }
  }

  // 4) Extract invoice doctor names
  const invNames = new Set();
  function addInvName(n) {
    if (!n) return;
    const s = String(n).trim().toLowerCase();
    if (!s || s === "-" || /^\d{10,}$/.test(s)) return;
    invNames.add(s);
    const norm = s.replace(/^(?:dr|doctor)\.?\s+/i, "").trim();
    if (norm) invNames.add(norm);
  }

  addInvName(inv.Doctor_Name);
  addInvName(inv["Doctor.Doctor_Name"]);
  addInvName(inv["Doctor.zc_display_value"]);
  addInvName(inv["Doctor.display_value"]);
  addInvName(getLookupLabel(inv.Doctor));
  if (typeof inv.Doctor === "object" && inv.Doctor !== null) {
    addInvName(inv.Doctor.zc_display_value);
    addInvName(inv.Doctor.display_value);
    addInvName(inv.Doctor.Doctor_Name);
    addInvName(inv.Doctor.name);
  }
  if (typeof inv.Doctor === "string") {
    addInvName(inv.Doctor);
  }

  // Also check if any invId resolves to a known doctor name
  invIds.forEach(id => {
    if (DOCTOR_ID_TO_NAME.has(id)) {
      addInvName(DOCTOR_ID_TO_NAME.get(id));
    }
  });

  for (const name of invNames) {
    if (targetNames.has(name)) return true;
    for (const target of targetNames) {
      if (name.includes(target) || target.includes(name)) return true;
    }
  }

  // 5) Compare emails
  const targetEmails = new Set();
  if (targetEmail) targetEmails.add(targetEmail.toLowerCase());
  if (myDoctor) {
    const e1 = getDoctorEmail(myDoctor);
    if (e1) targetEmails.add(e1.toLowerCase());
    if (myDoctor.Email) targetEmails.add(String(myDoctor.Email).trim().toLowerCase());
    if (myDoctor.Doctor_Email) targetEmails.add(String(myDoctor.Doctor_Email).trim().toLowerCase());
    if (myDoctor["Doctor.Email"]) targetEmails.add(String(myDoctor["Doctor.Email"]).trim().toLowerCase());
  }

  const invEmails = new Set();
  if (inv.Doctor_Email) invEmails.add(String(inv.Doctor_Email).trim().toLowerCase());
  if (inv["Doctor.Email"]) invEmails.add(String(inv["Doctor.Email"]).trim().toLowerCase());
  if (inv["Doctor.Doctor_Email"]) invEmails.add(String(inv["Doctor.Doctor_Email"]).trim().toLowerCase());
  if (inv.Email) invEmails.add(String(inv.Email).trim().toLowerCase());

  for (const em of invEmails) {
    if (targetEmails.has(em)) return true;
  }

  return false;
}



/* ===================================================
   SEARCHABLE DROPDOWN (COMBOBOX)
   =================================================== */

function initSearchableSelect(id, allLabel) {
  const wrapper = document.getElementById(id);
  if (!wrapper) return;

  wrapper.classList.add("searchable-select");
  wrapper.dataset.value = "";
  wrapper.dataset.allLabel = allLabel;

  wrapper.innerHTML = `
    <div class="ss-control" tabindex="0">
      <span class="ss-value">${allLabel}</span>
      <span class="ss-arrow">&#9662;</span>
    </div>
    <div class="ss-dropdown">
      <input type="text" class="ss-search" placeholder="Search..." autocomplete="off" />
      <ul class="ss-options"></ul>
    </div>
  `;

  const control = wrapper.querySelector(".ss-control");
  const search  = wrapper.querySelector(".ss-search");

  control.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = !wrapper.classList.contains("open");
    closeAllSearchableSelects();
    if (willOpen) {
      wrapper.classList.add("open");
      search.value = "";
      filterOptions(wrapper, "");
      setTimeout(() => search.focus(), 0);
    }
  });

  search.addEventListener("click", (e) => e.stopPropagation());
  search.addEventListener("input", () => filterOptions(wrapper, search.value));
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") wrapper.classList.remove("open");
    if (e.key === "Enter") {
      e.preventDefault();
      const firstOpt = wrapper.querySelector(".ss-option:not(.ss-option-all):not([style*='display: none'])") ||
                       wrapper.querySelector(".ss-option-all:not([style*='display: none'])");
      if (firstOpt) {
        selectOption(wrapper, firstOpt.dataset.value, firstOpt.textContent);
      }
    }
  });
}

function setSearchableOptions(id, items, allLabel) {
  const wrapper = document.getElementById(id);
  if (!wrapper) return;

  const list = wrapper.querySelector(".ss-options");
  list.innerHTML = "";

  const allLi = document.createElement("li");
  allLi.textContent = allLabel;
  allLi.dataset.value = "";
  allLi.classList.add("ss-option", "ss-option-all");
  list.appendChild(allLi);

  items.forEach(item => {
    const li = document.createElement("li");
    li.textContent   = item.label;
    li.dataset.value = item.value;
    li.classList.add("ss-option");
    list.appendChild(li);
  });

  const noResultsLi = document.createElement("li");
  noResultsLi.textContent = "No matches found";
  noResultsLi.classList.add("ss-no-results");
  list.appendChild(noResultsLi);

  list.querySelectorAll(".ss-option").forEach(li => {
    li.addEventListener("click", () => {
      selectOption(wrapper, li.dataset.value, li.textContent);
    });
  });
}

function selectOption(wrapper, value, label) {
  wrapper.dataset.value = value;
  wrapper.querySelector(".ss-value").textContent = label;
  wrapper.classList.remove("open");
}

function lockDoctorSelect(id, doctorId, doctorName) {
  const wrapper = document.getElementById(id);
  if (!wrapper) return;

  wrapper.classList.add("searchable-select", "is-locked");
  wrapper.dataset.value = String(doctorId || "");
  wrapper.dataset.allLabel = doctorName;

  wrapper.innerHTML = `
    <div class="ss-control ss-control-locked" tabindex="-1">
      <span class="ss-value">${escapeHtml(doctorName)}</span>
      <span class="ss-locked-badge" title="Logged in Doctor Profile">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
      </span>
    </div>
  `;
}


function filterOptions(wrapper, query) {
  const q = query.trim().toLowerCase();
  let anyVisible = false;

  wrapper.querySelectorAll(".ss-option:not(.ss-option-all)").forEach(li => {
    const match = li.textContent.toLowerCase().includes(q);
    li.style.display = match ? "" : "none";
    if (match) anyVisible = true;
  });

  const noResults = wrapper.querySelector(".ss-no-results");
  if (noResults) {
    noResults.style.display = (q && !anyVisible) ? "" : "none";
  }
}

function closeAllSearchableSelects() {
  document.querySelectorAll(".searchable-select.open").forEach(el => {
    el.classList.remove("open");
  });
}

function getSearchableValue(id) {
  const wrapper = document.getElementById(id);
  return wrapper ? (wrapper.dataset.value || "") : "";
}

function getSearchableLabel(id) {
  const wrapper = document.getElementById(id);
  if (!wrapper) return "";
  const valEl = wrapper.querySelector(".ss-value");
  return valEl ? valEl.textContent.trim() : "";
}

document.addEventListener("click", () => {
  closeAllSearchableSelects();
  const exportMenu = document.getElementById("export-menu");
  if (exportMenu) exportMenu.classList.remove("open");
});

/* ===================================================
   POPULATE FILTER OPTIONS
   =================================================== */

function populateDoctors(doctors, invoices = []) {
  const map = new Map();

  if (Array.isArray(doctors)) {
    doctors.forEach(doc => {
      const id = getLookupId(doc);
      const label = doc.Doctor_Name || getLookupLabel(doc);
      if (id && label) map.set(String(id), label);
    });
  }

  if (Array.isArray(invoices)) {
    invoices.forEach(inv => {
      if (inv.Doctor) {
        const id = getLookupId(inv.Doctor);
        const label = getLookupLabel(inv.Doctor);
        if (id && label && !map.has(String(id))) {
          map.set(String(id), label);
        }
      }
    });
  }

  const items = Array.from(map.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  ALL_DOCTORS_LIST = items;
  setSearchableOptions("f-doctor", items, "All Doctors");
}

function populateStatuses(invoices = []) {
  const standardStatuses = ["Pending", "Partially Paid", "Paid"];
  const set = new Set(standardStatuses);

  invoices.forEach(inv => {
    if (isVoidInvoice(inv)) return;
    const s = getInvoiceStatus(inv);
    if (s && s !== "-" && s.toLowerCase() !== "void") {
      const exists = Array.from(set).some(item => item.toLowerCase() === s.toLowerCase());
      if (!exists && (s.toLowerCase() === "pending" || s.toLowerCase() === "partially paid" || s.toLowerCase() === "paid")) {
        set.add(s);
      }
    }
  });

  const items = Array.from(set)
    .filter(s => s && s.toLowerCase() !== "void")
    .map(s => ({
      value: s,
      label: s
    }));

  setSearchableOptions("f-status", items, "All Status");
}

/* ===================================================
   REPORT / COMBINED FILTERING LOGIC
   =================================================== */

function matchesDoctor(inv, selectedDocValue, selectedDocLabel) {
  if (CURRENT_DOCTOR_ID || CURRENT_DOCTOR_NAME) {
    return isInvoiceForDoctor(inv, CURRENT_DOCTOR_ID, CURRENT_DOCTOR_NAME, CURRENT_USER_EMAIL);
  }
  if (!selectedDocValue) return true;
  const invDocId = String(getInvoiceDoctorId(inv) || "").trim().toLowerCase();
  const invDocName = String(getInvoiceDoctor(inv) || "").trim().toLowerCase();
  const selVal = String(selectedDocValue || "").trim().toLowerCase();
  const selLabel = String(selectedDocLabel || "").trim().toLowerCase();

  // If matched by ID
  if (invDocId && (invDocId === selVal || invDocId === selLabel)) return true;

  // If matched by Name / Label
  if (invDocName && invDocName !== "-") {
    if (selLabel && (invDocName === selLabel || invDocName.includes(selLabel) || selLabel.includes(invDocName))) {
      return true;
    }
    if (selVal && (invDocName === selVal || invDocName.includes(selVal) || selVal.includes(invDocName))) {
      return true;
    }
  }

  // Also check raw inv.Doctor if string
  if (typeof inv.Doctor === "string") {
    const raw = inv.Doctor.trim().toLowerCase();
    if (raw === selVal || raw === selLabel || (selLabel && raw.includes(selLabel))) return true;
  }

  return false;
}

function matchesStatus(inv, selectedStatus) {
  if (isVoidInvoice(inv)) return false;
  if (!selectedStatus) return true;
  const invStatus = String(getInvoiceStatus(inv) || "").trim().toLowerCase();
  const sel = String(selectedStatus || "").trim().toLowerCase();
  if (!sel || sel === "all status") return true;
  return invStatus === sel;
}

function matchesDateRange(inv, fromDateStr, toDateStr) {
  if (!fromDateStr && !toDateStr) return true;
  const invDate = getInvoiceDate(inv);
  if (!invDate) return false;

  if (fromDateStr) {
    const from = parseZohoDate(fromDateStr);
    if (from) {
      from.setHours(0, 0, 0, 0);
      if (invDate < from) return false;
    }
  }

  if (toDateStr) {
    const to = parseZohoDate(toDateStr);
    if (to) {
      to.setHours(23, 59, 59, 999);
      if (invDate > to) return false;
    }
  }

  return true;
}

function runReport() {
  let doctorId    = getSearchableValue("f-doctor");
  let doctorLabel = getSearchableLabel("f-doctor");

  if (CURRENT_DOCTOR_ID || CURRENT_DOCTOR_NAME) {
    doctorId = CURRENT_DOCTOR_ID || doctorId;
    doctorLabel = CURRENT_DOCTOR_NAME || doctorLabel;
  }

  const status      = getSearchableValue("f-status");
  const fromEl      = document.getElementById("f-from");
  const toEl        = document.getElementById("f-to");
  const fromDate    = fromEl ? fromEl.value : "";
  const toDate      = toEl ? toEl.value : "";

  FILTERED_DATA = ALL_INVOICES.filter(inv => {
    return (
      !isVoidInvoice(inv) &&
      matchesDoctor(inv, doctorId, doctorLabel) &&
      matchesStatus(inv, status) &&
      matchesDateRange(inv, fromDate, toDate)
    );
  });

  renderTable(FILTERED_DATA);
}

function resetFilters() {
  const docWrapper = document.getElementById("f-doctor");
  if (docWrapper) {
    if (CURRENT_DOCTOR_NAME) {
      docWrapper.dataset.value = String(CURRENT_DOCTOR_ID || "");
      const valEl = docWrapper.querySelector(".ss-value");
      if (valEl) valEl.textContent = CURRENT_DOCTOR_NAME;
    } else {
      docWrapper.dataset.value = "";
      const valEl = docWrapper.querySelector(".ss-value");
      if (valEl) valEl.textContent = "All Doctors";
    }
  }

  const statusWrapper = document.getElementById("f-status");
  if (statusWrapper) {
    statusWrapper.dataset.value = "";
    const valEl = statusWrapper.querySelector(".ss-value");
    if (valEl) valEl.textContent = "All Status";
  }


  const fromEl = document.getElementById("f-from");
  const toEl   = document.getElementById("f-to");
  if (fromEl) fromEl.value = "";
  if (toEl) toEl.value = "";

  FILTERED_DATA = ALL_INVOICES.filter(inv => !isVoidInvoice(inv));
  renderTable(FILTERED_DATA);
}

window.runReport = runReport;
window.resetFilters = resetFilters;

/* ===================================================
   GRAND SUMMARY CALCULATION & RENDERING
   =================================================== */

function computeSummary(data) {
  const list = data || [];
  let totalAmount = 0;
  let totalPaid = 0;
  let totalBalance = 0;

  list.forEach(inv => {
    totalAmount += getInvoiceAmount(inv);
    totalPaid += getInvoicePaid(inv);
    totalBalance += getInvoiceBalance(inv);
  });

  return {
    count: list.length,
    totalAmount,
    totalPaid,
    totalBalance
  };
}

function renderSummary(data) {
  const summary = computeSummary(data);

  const elInv = document.getElementById("sum-invoices");
  const elAmt = document.getElementById("sum-amount");
  const elPaid = document.getElementById("sum-paid");
  const elBal = document.getElementById("sum-balance");

  const formattedAmount = fmtMoney(summary.totalAmount);
  const formattedPaid = fmtMoney(summary.totalPaid);
  const formattedBalance = fmtMoney(summary.totalBalance);

  if (elInv) elInv.textContent = summary.count.toLocaleString("en-AU");
  if (elAmt) elAmt.textContent = formattedAmount;
  if (elPaid) elPaid.textContent = formattedPaid;
  if (elBal) elBal.textContent = formattedBalance;
}

/* ===================================================
   TABLE RENDERING
   =================================================== */

function renderTable(data) {
  renderSummary(data);

  const tbody = document.getElementById("report-body");
  if (!tbody) return;

  tbody.classList.remove("fade-in");
  void tbody.offsetWidth;

  if (!data || !data.length) {
    tbody.innerHTML = `<tr><td colspan="7">No data</td></tr>`;
    return;
  }

  let html = "";
  data.forEach((inv, idx) => {
    const doctor = getInvoiceDoctor(inv);
    const invoiceNo = getInvoiceNo(inv);
    const invoiceDate = getInvoiceDisplayDate(inv);
    const invoiceAmount = fmtMoney(getInvoiceAmount(inv));
    const amountPaid = fmtMoney(getInvoicePaid(inv));
    const outstanding = fmtMoney(getInvoiceBalance(inv));
    const status = getInvoiceStatus(inv);
    const statusClass = getStatusClass(status);
    const rowClass = idx % 2 === 0 ? "grp-a" : "grp-b";

    html += `
      <tr class="${rowClass}">
        <td>${escapeHtml(doctor)}</td>
        <td>${escapeHtml(invoiceNo)}</td>
        <td class="col-center">${escapeHtml(invoiceDate)}</td>
        <td class="col-money">${escapeHtml(invoiceAmount)}</td>
        <td class="col-money">${escapeHtml(amountPaid)}</td>
        <td class="col-money">${escapeHtml(outstanding)}</td>
        <td class="col-center">
          <span class="status-badge status-${statusClass}">${escapeHtml(status)}</span>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
  tbody.classList.add("fade-in");
}

/* ===================================================
   EXPORT HELPERS & BRAND STYLING
   =================================================== */

const XLSX_BRAND = {
  navy: "1E2D5A",
  navyText: "2D374F",
  green: "1F7A5C",
  white: "FFFFFF",
  lightGrey: "E5E7EB",
  rowAlt: "F6F7F9"
};

const BRAND = {
  navy: [30, 45, 90],
  navyText: [45, 55, 79],
  green: [31, 122, 92],
  white: [255, 255, 255],
  lightGrey: [229, 231, 235],
  grey: [114, 111, 135]
};
const ICON_COLOR = [30, 130, 76];

function getActiveFilterInfo() {
  let docVal = getSearchableValue("f-doctor");
  let docLabel = getSearchableLabel("f-doctor");

  if (CURRENT_DOCTOR_NAME) {
    docLabel = CURRENT_DOCTOR_NAME;
    docVal = CURRENT_DOCTOR_ID || CURRENT_DOCTOR_NAME;
  }

  const statusVal = getSearchableValue("f-status");
  const statusLabel = getSearchableLabel("f-status");
  const fromEl = document.getElementById("f-from");
  const toEl = document.getElementById("f-to");

  return {
    doctor: docVal ? docLabel : (CURRENT_DOCTOR_NAME || "All Doctors"),
    status: statusVal ? statusLabel : "All Status",
    dateFrom: fromEl ? fromEl.value : "",
    dateTo: toEl ? toEl.value : ""
  };
}


/* ===================================================
   EXPORT TO EXCEL
   =================================================== */

function exportExcel() {
  if (!FILTERED_DATA || !FILTERED_DATA.length) {
    alert("No data to export.");
    return;
  }

  const info = getActiveFilterInfo();
  const aoa = [];

  aoa.push(["Medi Elves Settlement Invoice Outstanding Report"]);
  aoa.push([`Doctor: ${info.doctor}`]);
  aoa.push([`Status: ${info.status}`]);
  aoa.push([`Date Range: ${formatDateRange(info.dateFrom, info.dateTo)}`]);
  aoa.push([`Generated On: ${new Date().toLocaleString("en-AU", {
    timeZone: "Australia/Sydney",
    day: "2-digit", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true
  })}`]);
  aoa.push([]);

  const HEADER_ROW = aoa.length;
  aoa.push([
    "Doctor",
    "Invoice No",
    "Invoice Date",
    "Invoice Amount",
    "Amount Paid",
    "Outstanding Balance",
    "Payment Status"
  ]);

  const DATA_START_ROW = aoa.length;
  FILTERED_DATA.forEach(inv => {
    aoa.push([
      getInvoiceDoctor(inv),
      getInvoiceNo(inv),
      getInvoiceDisplayDate(inv),
      getInvoiceAmount(inv),
      getInvoicePaid(inv),
      getInvoiceBalance(inv),
      getInvoiceStatus(inv)
    ]);
  });
  const DATA_END_ROW = aoa.length - 1;

  // Append Grand Summary Section
  const summary = computeSummary(FILTERED_DATA);
  aoa.push([]); // blank row

  const SUMMARY_TITLE_ROW = aoa.length;
  aoa.push(["GRAND SUMMARY"]);

  const SUMMARY_HEADER_ROW = aoa.length;
  aoa.push([
    "Total Invoices",
    "Total Invoice Amount",
    "Total Amount Paid",
    "Total Outstanding Balance"
  ]);

  const SUMMARY_DATA_ROW = aoa.length;
  aoa.push([
    summary.count,
    summary.totalAmount,
    summary.totalPaid,
    summary.totalBalance
  ]);

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
    { s: { r: SUMMARY_TITLE_ROW, c: 0 }, e: { r: SUMMARY_TITLE_ROW, c: 3 } }
  ];
  worksheet["!cols"] = [
    { wch: 25 }, // Doctor
    { wch: 20 }, // Invoice No / Total Invoice Amount
    { wch: 20 }, // Invoice Date / Total Amount Paid
    { wch: 24 }, // Invoice Amount / Total Outstanding Balance
    { wch: 18 }, // Amount Paid
    { wch: 20 }, // Outstanding Balance
    { wch: 18 }  // Payment Status
  ];

  function setStyle(row, col, style) {
    const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
    if (!worksheet[cellRef]) worksheet[cellRef] = { v: "" };
    worksheet[cellRef].s = style;
  }

  const headerStyle = {
    font: { bold: true, sz: 10, color: { rgb: XLSX_BRAND.white } },
    fill: { fgColor: { rgb: XLSX_BRAND.green } },
    alignment: { horizontal: "center", vertical: "center" },
    border: {
      top: { style: "thin", color: { rgb: XLSX_BRAND.lightGrey } },
      bottom: { style: "thin", color: { rgb: XLSX_BRAND.lightGrey } },
      left: { style: "thin", color: { rgb: XLSX_BRAND.lightGrey } },
      right: { style: "thin", color: { rgb: XLSX_BRAND.lightGrey } }
    }
  };

  const borderAll = {
    top: { style: "thin", color: { rgb: XLSX_BRAND.lightGrey } },
    bottom: { style: "thin", color: { rgb: XLSX_BRAND.lightGrey } },
    left: { style: "thin", color: { rgb: XLSX_BRAND.lightGrey } },
    right: { style: "thin", color: { rgb: XLSX_BRAND.lightGrey } }
  };

  setStyle(0, 0, {
    font: { bold: true, sz: 14, color: { rgb: XLSX_BRAND.navy } },
    alignment: { horizontal: "center" }
  });
  for (let r = 1; r <= 4; r++) {
    setStyle(r, 0, { font: { sz: 9, italic: true, color: { rgb: XLSX_BRAND.navyText } } });
  }

  for (let c = 0; c <= 6; c++) {
    setStyle(HEADER_ROW, c, headerStyle);
  }

  for (let r = DATA_START_ROW; r <= DATA_END_ROW; r++) {
    const isAlt = (r - DATA_START_ROW) % 2 === 1;
    const bgFill = isAlt ? { fgColor: { rgb: XLSX_BRAND.rowAlt } } : undefined;

    for (let c = 0; c <= 6; c++) {
      let cellStyle = {
        font: { sz: 9, color: { rgb: XLSX_BRAND.navyText } },
        border: borderAll,
        fill: bgFill
      };

      if (c === 0 || c === 1) {
        cellStyle.alignment = { horizontal: "left", vertical: "center" };
      } else if (c === 2) {
        cellStyle.alignment = { horizontal: "center", vertical: "center" };
      } else if (c === 3 || c === 4 || c === 5) {
        cellStyle.alignment = { horizontal: "right", vertical: "center" };
        cellStyle.numFmt = "$#,##0.00";
      } else if (c === 6) {
        cellStyle.alignment = { horizontal: "center", vertical: "center" };
      }

      setStyle(r, c, cellStyle);
    }
  }

  // Style Grand Summary Section
  setStyle(SUMMARY_TITLE_ROW, 0, {
    font: { bold: true, sz: 11, color: { rgb: XLSX_BRAND.navy } },
    alignment: { horizontal: "left", vertical: "center" }
  });

  const summaryHeaderStyle = {
    font: { bold: true, sz: 9.5, color: { rgb: XLSX_BRAND.white } },
    fill: { fgColor: { rgb: XLSX_BRAND.navy } },
    alignment: { horizontal: "center", vertical: "center" },
    border: borderAll
  };

  for (let c = 0; c <= 3; c++) {
    setStyle(SUMMARY_HEADER_ROW, c, summaryHeaderStyle);
  }

  setStyle(SUMMARY_DATA_ROW, 0, {
    font: { bold: true, sz: 10, color: { rgb: XLSX_BRAND.navyText } },
    alignment: { horizontal: "center", vertical: "center" },
    border: borderAll
  });

  for (let c = 1; c <= 3; c++) {
    setStyle(SUMMARY_DATA_ROW, c, {
      font: { bold: true, sz: 10, color: { rgb: XLSX_BRAND.navyText } },
      alignment: { horizontal: "right", vertical: "center" },
      numFmt: "$#,##0.00",
      border: borderAll
    });
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Settlement Invoices");
  XLSX.writeFile(workbook, "Medi Elves Settlement Invoice Outstanding Report.xlsx");
}

/* ===================================================
   EXPORT TO PDF
   =================================================== */

async function exportPDF() {
  if (!FILTERED_DATA || !FILTERED_DATA.length) {
    alert("No data to export.");
    return;
  }

  await loadLogoAsDataURL();
  const info = getActiveFilterInfo();
  const { jsPDF } = window.jspdf;

  const doc = new jsPDF({
    orientation: "l",
    unit: "pt",
    format: "a4"
  });

  const pageW = doc.internal.pageSize.getWidth();   // ~841.89 pt
  const pageH = doc.internal.pageSize.getHeight();  // ~595.28 pt
  const margin = 40;

  const headerInfo = {
    doctor: info.doctor,
    status: info.status,
    date: formatDateRange(info.dateFrom, info.dateTo),
    generatedOn: new Date().toLocaleString("en-AU", {
      timeZone: "Australia/Sydney",
      day: "2-digit", month: "short", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true
    })
  };

  const HEADER_HEIGHT = 168;
  const FOOTER_RESERVED = 110;

  const bodyData = FILTERED_DATA.map(inv => [
    getInvoiceDoctor(inv),
    getInvoiceNo(inv),
    getInvoiceDisplayDate(inv),
    fmtMoney(getInvoiceAmount(inv)),
    fmtMoney(getInvoicePaid(inv)),
    fmtMoney(getInvoiceBalance(inv)),
    getInvoiceStatus(inv)
  ]);

  doc.autoTable({
    startY: HEADER_HEIGHT,
    margin: { top: HEADER_HEIGHT, left: margin, right: margin, bottom: FOOTER_RESERVED },
    theme: "grid",
    head: [[
      "Doctor", "Invoice No", "Invoice Date", "Invoice Amount",
      "Amount Paid", "Outstanding Balance", "Payment Status"
    ]],
    body: bodyData,
    styles: {
      fontSize: 8,
      textColor: [0, 0, 0],
      fillColor: BRAND.white,
      lineColor: BRAND.lightGrey,
      lineWidth: 0.5,
      cellPadding: 5,
      overflow: "linebreak",
      valign: "middle"
    },
    headStyles: {
      fillColor: BRAND.navy,
      textColor: BRAND.white,
      fontStyle: "bold",
      fontSize: 8,
      cellPadding: 6,
      valign: "middle"
    },
    tableWidth: pageW - margin * 2,
    columnStyles: {
      0: { cellWidth: 145, halign: "left" },
      1: { cellWidth: 95, halign: "left" },
      2: { cellWidth: 85, halign: "center" },
      3: { cellWidth: 110, halign: "right" },
      4: { cellWidth: 110, halign: "right" },
      5: { cellWidth: 115, halign: "right" },
      6: { cellWidth: 101.89, halign: "center" }
    },
    didDrawPage: () => {
      drawHeader(doc, pageW, margin, headerInfo);
      drawFooter(doc, pageW, margin);
    }
  });

  // Render Grand Summary in PDF
  const summary = computeSummary(FILTERED_DATA);
  const summaryBody = [[
    summary.count.toLocaleString("en-AU"),
    fmtMoney(summary.totalAmount),
    fmtMoney(summary.totalPaid),
    fmtMoney(summary.totalBalance)
  ]];

  let finalY = (doc.lastAutoTable ? doc.lastAutoTable.finalY : HEADER_HEIGHT) + 24;
  if (finalY + 80 > pageH - FOOTER_RESERVED) {
    doc.addPage();
    drawHeader(doc, pageW, margin, headerInfo);
    drawFooter(doc, pageW, margin);
    finalY = HEADER_HEIGHT;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...BRAND.navy);
  doc.text("Grand Summary", margin, finalY);

  doc.autoTable({
    startY: finalY + 8,
    margin: { left: margin, right: margin, bottom: FOOTER_RESERVED },
    theme: "grid",
    head: [[
      "Total Invoices", "Total Invoice Amount", "Total Amount Paid", "Total Outstanding Balance"
    ]],
    body: summaryBody,
    styles: {
      fontSize: 8.5,
      fontStyle: "bold",
      textColor: BRAND.navyText,
      fillColor: BRAND.white,
      lineColor: BRAND.lightGrey,
      lineWidth: 0.5,
      cellPadding: 6,
      valign: "middle"
    },
    headStyles: {
      fillColor: BRAND.green,
      textColor: BRAND.white,
      fontStyle: "bold",
      fontSize: 8.5,
      cellPadding: 6,
      halign: "center",
      valign: "middle"
    },
    tableWidth: pageW - margin * 2,
    columnStyles: {
      0: { halign: "center", cellWidth: (pageW - margin * 2) * 0.22 },
      1: { halign: "right", cellWidth: (pageW - margin * 2) * 0.26 },
      2: { halign: "right", cellWidth: (pageW - margin * 2) * 0.26 },
      3: { halign: "right", cellWidth: (pageW - margin * 2) * 0.26 }
    },
    didDrawPage: () => {
      drawHeader(doc, pageW, margin, headerInfo);
      drawFooter(doc, pageW, margin);
    }
  });

  doc.save("Medi Elves Settlement Invoice Outstanding Report.pdf");
}

function drawHeader(doc, pageW, margin, info) {
  const logoW = 150, logoH = 55.5;
  if (LOGO_DATA_URL) {
    doc.addImage(LOGO_DATA_URL, "PNG", margin, 24, logoW, logoH);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...BRAND.navy);
  doc.text("Medi Elves Settlement Invoice Outstanding Report", pageW - margin, 52, { align: "right" });

  const sepY = 96;
  doc.setFillColor(...ICON_COLOR);
  doc.circle(margin + 3, sepY, 2.2, "F");
  doc.setDrawColor(...BRAND.lightGrey);
  doc.setLineWidth(1);
  doc.line(margin + 12, sepY, pageW - margin, sepY);

  const items = [
    { icon: "person",   label: "DOCTOR",        value: info.doctor },
    { icon: "status",   label: "STATUS",        value: info.status },
    { icon: "calendar", label: "REPORT PERIOD", value: info.date },
    { icon: "clock",    label: "GENERATED ON",  value: info.generatedOn }
  ];

  const labelY   = sepY + 30;
  const iconSize = 15;
  const textGap  = 8;
  const colGap   = 14;
  const colW     = (pageW - margin * 2) / items.length;
  const valueLineHeight = 11;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const wrapped = items.map((item, i) => {
    const textX = margin + colW * i + iconSize + textGap;
    const availableWidth = colW - iconSize - textGap - colGap;
    const lines = doc.splitTextToSize(String(item.value), Math.max(availableWidth, 40)).slice(0, 2);
    return { ...item, textX, lines };
  });

  wrapped.forEach((item) => {
    const valueBlockHeight = item.lines.length * valueLineHeight;
    const iconCenterY = labelY - 4 + valueBlockHeight / 2 - (valueLineHeight / 2);
    const iconX = item.textX - textGap - iconSize / 2;

    drawIcon(doc, item.icon, iconX, iconCenterY, ICON_COLOR);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...BRAND.grey);
    doc.text(item.label, item.textX, labelY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...BRAND.navyText);
    item.lines.forEach((line, li) => {
      doc.text(line, item.textX, labelY + 14 + li * valueLineHeight);
    });
  });
}

function drawFooter(doc, pageW, margin) {
  const pageH = doc.internal.pageSize.getHeight();
  const lineY = pageH - 100;

  doc.setDrawColor(...BRAND.lightGrey);
  doc.setLineWidth(1);
  doc.line(margin, lineY, pageW - margin, lineY);

  const textX  = margin + 18;
  const titleY = lineY + 16;

  drawIcon(doc, "lock", margin + 6, titleY - 4, ICON_COLOR);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...BRAND.navyText);
  doc.text("CONFIDENTIAL - SETTLEMENT INVOICE REPORT", textX, titleY);

  const pageCount = doc.internal.getNumberOfPages();
  const current   = doc.internal.getCurrentPageInfo().pageNumber;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...BRAND.grey);
  doc.text(`Page ${current} of ${pageCount}`, pageW - margin, titleY, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...BRAND.grey);
  const notice =
    "This document contains confidential settlement and invoice information and is intended only for the named recipient and authorised " +
    "personnel. Unauthorised access, use, copying, forwarding or disclosure is prohibited. If you received this document in error, please " +
    "notify Medi Elves immediately, delete all electronic copies and securely destroy any printed copies.";
  const noticeLines = doc.splitTextToSize(notice, pageW - margin - textX);
  doc.text(noticeLines, textX, titleY + 12);

  const contactY    = titleY + 12 + noticeLines.length * 9 + 14;
  const contactColW = (pageW - margin * 2) / 3;

  drawIcon(doc, "phone", margin + 6, contactY, ICON_COLOR);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...BRAND.navyText);
  doc.text("1800 956 692", margin + 18, contactY + 3);

  const emailX = margin + contactColW;
  drawIcon(doc, "mail", emailX + 6, contactY, ICON_COLOR);
  doc.text("admin@medielves.com.au", emailX + 18, contactY + 3);

  const webX = margin + contactColW * 2;
  drawIcon(doc, "globe", webX + 6, contactY, ICON_COLOR);
  doc.text("www.medielves.com.au", webX + 18, contactY + 3);
}

function drawIcon(doc, type, cx, cy, color) {
  doc.setDrawColor(...color);
  doc.setFillColor(...color);
  doc.setLineWidth(1);

  switch (type) {
    case "person":
      doc.circle(cx, cy - 4, 3, "S");
      doc.ellipse(cx, cy + 3, 5, 4, "S");
      break;
    case "status":
      doc.roundedRect(cx - 5, cy - 5, 10, 10, 2, 2, "S");
      doc.line(cx - 3, cy, cx - 1, cy + 2);
      doc.line(cx - 1, cy + 2, cx + 3, cy - 2);
      break;
    case "calendar":
      doc.roundedRect(cx - 6, cy - 5, 12, 10, 1.5, 1.5, "S");
      doc.line(cx - 6, cy - 2, cx + 6, cy - 2);
      doc.line(cx - 3, cy - 6.5, cx - 3, cy - 4);
      doc.line(cx + 3, cy - 6.5, cx + 3, cy - 4);
      break;
    case "clock":
      doc.circle(cx, cy, 6, "S");
      doc.line(cx, cy, cx, cy - 3.5);
      doc.line(cx, cy, cx + 3, cy);
      break;
    case "lock":
      doc.roundedRect(cx - 5, cy - 2, 10, 8, 1.5, 1.5, "S");
      doc.circle(cx, cy - 4, 3.5, "S");
      break;
    case "phone":
      doc.roundedRect(cx - 3, cy - 6, 6, 12, 1.5, 1.5, "S");
      break;
    case "mail":
      doc.rect(cx - 6, cy - 4, 12, 8, "S");
      doc.line(cx - 6, cy - 4, cx, cy);
      doc.line(cx + 6, cy - 4, cx, cy);
      break;
    case "globe":
      doc.circle(cx, cy, 6, "S");
      doc.ellipse(cx, cy, 3, 6, "S");
      doc.line(cx - 6, cy, cx + 6, cy);
      break;
    default:
      doc.circle(cx, cy, 4, "S");
  }
}

/* ===================================================
   INITIALIZATION
   =================================================== */

document.addEventListener("DOMContentLoaded", async function () {
  showLoading();
  initSearchableSelect("f-doctor", "All Doctors");
  initSearchableSelect("f-status", "All Status");

  // Export menu trigger setup
  const menu = document.getElementById("export-menu");
  const trigger = document.getElementById("export-icon-btn");
  const pdfOption = document.getElementById("export-pdf-opt");
  const excelOption = document.getElementById("export-excel-opt");

  if (trigger && menu) {
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = !menu.classList.contains("open");
      closeAllSearchableSelects();
      menu.classList.toggle("open", willOpen);
    });

    const dropdown = menu.querySelector(".export-dropdown");
    if (dropdown) dropdown.addEventListener("click", (e) => e.stopPropagation());

    if (pdfOption) {
      pdfOption.addEventListener("click", async () => {
        menu.classList.remove("open");
        pdfOption.classList.add("loading");
        try {
          await exportPDF();
        } finally {
          pdfOption.classList.remove("loading");
        }
      });
    }

    if (excelOption) {
      excelOption.addEventListener("click", () => {
        menu.classList.remove("open");
        excelOption.classList.add("loading");
        try {
          exportExcel();
        } finally {
          excelOption.classList.remove("loading");
        }
      });
    }
  }

  try {
    /* 0) Initialize ZOHO Creator and extract portal logged-in user */
    let initParams = null;
    if (typeof ZOHO !== "undefined" && ZOHO.CREATOR) {
      try {
        const initData = await ZOHO.CREATOR.init();
        if (initData && initData.loginUser) {
          CURRENT_USER_EMAIL = String(initData.loginUser).trim();
        }
      } catch (err) {
        console.warn("ZOHO.CREATOR.init warning:", err);
      }

      try {
        if (ZOHO.CREATOR.UTIL && typeof ZOHO.CREATOR.UTIL.getInitParams === "function") {
          initParams = await ZOHO.CREATOR.UTIL.getInitParams();
          if (!CURRENT_USER_EMAIL && initParams) {
            CURRENT_USER_EMAIL = String(initParams.loginUser || initParams.user || initParams.email || initParams.loginUserId || "").trim();
          }
        }
      } catch (paramErr) {
        console.warn("Could not retrieve initParams / loginUser:", paramErr);
      }
    }

    // Support URL search parameters for development testing (?loginUser=... or ?email=...)
    if (!CURRENT_USER_EMAIL) {
      const urlParams = new URLSearchParams(window.location.search);
      CURRENT_USER_EMAIL = (urlParams.get("loginUser") || urlParams.get("user") || urlParams.get("email") || urlParams.get("loginUserId") || urlParams.get("doctorId") || "").trim();
    }

    if (CURRENT_USER_EMAIL) {
      console.log("Logged-in portal user:", CURRENT_USER_EMAIL);
    }

    setLoadingProgress(20, "Identifying doctor profile...");

    /* 1) Fetch doctors: Primary #Report:Portal_Doctors1 with fallbacks */
    /* 2) Fetch invoices: Primary #Report:All_Invoices with fallbacks */
    const [allDoctors, allInvoices] = await Promise.all([
      fetchRecordsWithFallback("Portal_Doctors1", "Doctors1", "All_Doctors", "Portal_Doctors", "Doctors"),
      fetchRecordsWithFallback("All_Invoices", "My_Invoices", "Portal_Invoices", "Doctor_Invoices", "Doctors_Invoices", "Settlement_Invoices", "Invoices", "Settlement_Invoice_Outstanding_Report")
    ]);

    // Populate DOCTOR mapping lookup table
    allDoctors.forEach(registerDoctorMapping);

    /* 3) Match doctor by loginUser: login user id = #Report:Portal_Doctors1 Email */
    let myDoctor = null;
    if (CURRENT_USER_EMAIL) {
      const emailLower = CURRENT_USER_EMAIL.toLowerCase();
      myDoctor = allDoctors.find(d => {
        const docEmail = getDoctorEmail(d);
        if (docEmail && (docEmail === emailLower || docEmail.includes(emailLower) || emailLower.includes(docEmail))) return true;
        if (d.ID && String(d.ID).trim() === CURRENT_USER_EMAIL) return true;
        const docName = (d.Doctor_Name || getDoctorDisplayName(d) || "").trim().toLowerCase();
        if (docName && docName === emailLower) return true;
        return false;
      });
    }

    LOGGED_IN_DOCTOR_RECORD = myDoctor;

    if (myDoctor) {
      registerDoctorMapping(myDoctor);
      CURRENT_DOCTOR_ID = getLookupId(myDoctor.Doctor)
        || (myDoctor.Doctor && myDoctor.Doctor.ID)
        || myDoctor.Doctor_ID
        || myDoctor.ID;
      CURRENT_DOCTOR_NAME = myDoctor.Doctor_Name
        || getDoctorDisplayName(myDoctor)
        || getLookupLabel(myDoctor.Doctor)
        || (myDoctor.Name && (myDoctor.Name.first_name || myDoctor.Name.last_name)
            ? `${myDoctor.Name.prefix || ""} ${myDoctor.Name.first_name || ""} ${myDoctor.Name.last_name || ""}`.trim()
            : "")
        || myDoctor.zc_display_value
        || CURRENT_USER_EMAIL;
      console.log("Matched doctor profile:", CURRENT_DOCTOR_NAME, "(ID:", CURRENT_DOCTOR_ID, ")");
    } else {
      CURRENT_DOCTOR_ID = null;
      CURRENT_DOCTOR_NAME = null;
    }

    setLoadingProgress(55, "Filtering invoices for doctor...");

    /* 4) Filter invoices: #Report:Portal_Doctors1 = #Report:All_Invoices Doctor (excluding Void records) */
    const activeInvoices = (allInvoices || []).filter(inv => !isVoidInvoice(inv));
    let invoices = activeInvoices;
    if (CURRENT_DOCTOR_ID || CURRENT_DOCTOR_NAME) {
      invoices = activeInvoices.filter(inv => isInvoiceForDoctor(inv, CURRENT_DOCTOR_ID, CURRENT_DOCTOR_NAME, CURRENT_USER_EMAIL));
      console.log(`Filtered ${allInvoices.length} invoices down to ${invoices.length} active invoices (excluding void) for ${CURRENT_DOCTOR_NAME}`);
      if (allInvoices.length > 0 && invoices.length === 0) {
        console.warn("Sample invoice structure:", JSON.stringify(allInvoices[0]));
      }
    } else if (CURRENT_USER_EMAIL) {
      // Portal user logged in but no doctor profile matched
      console.warn("No doctor matched for portal user email:", CURRENT_USER_EMAIL);
      invoices = [];
    }

    ALL_INVOICES = invoices;
    FILTERED_DATA = invoices;

    setLoadingProgress(75, "Setting up filters...");

    /* 5) Configure Doctor filter in UI */
    if (CURRENT_DOCTOR_NAME) {
      lockDoctorSelect("f-doctor", CURRENT_DOCTOR_ID, CURRENT_DOCTOR_NAME);
    } else if (CURRENT_USER_EMAIL) {
      lockDoctorSelect("f-doctor", "", "Doctor Profile Not Found");
    } else {
      populateDoctors(allDoctors, activeInvoices);
    }

    /* 6) Configure Status filter strictly based on doctor invoices */
    populateStatuses(invoices);

    setLoadingProgress(90, "Rendering doctor invoice report...");
    renderTable(FILTERED_DATA);
  } catch (error) {
    console.error("Error loading invoices report:", error);
    renderSummary([]);
    const tbody = document.getElementById("report-body");
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7">No data</td></tr>`;
    }
  } finally {
    hideLoading();
  }
});


