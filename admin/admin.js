/* ============================================================
   DAF CGOC Mentorship — Admin dashboard
   Google sign-in + Firestore reads gated by firestore.rules:
     super-admins           -> everything (and can manage viewers)
     access=both/responses  -> responses, matches, activity log
     access=analytics       -> PII-free dashboardStats/summary only

   Every change to a match or to viewer access is written to an
   append-only auditLog entry naming the account that made it.
   ============================================================ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import {
  getFirestore, collection, getDocs, doc, getDoc, setDoc, addDoc, updateDoc,
  deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore-lite.js";

const app = initializeApp({
  apiKey: "AIzaSyDmvHOK_DGdhnro9XiJd9hozB5VDGtAFso",
  authDomain: "dafcgoc.firebaseapp.com",
  projectId: "dafcgoc",
  storageBucket: "dafcgoc.firebasestorage.app",
  messagingSenderId: "744994373915",
  appId: "1:744994373915:web:9ae778d54b6073847013be"
});
const auth = getAuth(app);
const db = getFirestore(app);

const COLORS = { mentee: "#B08A3E", mentor: "#3E7BD6" };
const LABELS = {
  usafa: "USAFA", afrotc: "AFROTC", ots: "OTS", direct: "Direct commission", other: "Other",
  "afsc-progression": "AFSC career progression", networking: "Networking",
  "lead-enlisted": "Leading enlisted Airmen", transition: "Cadet-to-operational transition",
  "work-life": "Work-life balance & tempo", "future-roles": "Flight/CC & Exec prep",
  "exact-afsc": "Exact AFSC", "broad-field": "Broader career field", "any-leader": "Any strong leader",
  "afsc-tactical": "AFSC tactical knowledge", enlisted: "Enlisted force mgmt",
  staff: "Staff / admin navigation", assignments: "Assignments / deployments"
};
const STATUS_LABEL = {
  unmatched: "Unmatched", in_progress: "Matching in progress",
  matched: "Matched", ended: "Ended"
};
const ACTION_LABEL = {
  match_create: "Match created", match_status: "Status changed",
  match_delete: "Match removed", viewer_add: "Viewer added", viewer_remove: "Viewer removed"
};
const lbl = (v) => LABELS[v] || v || "—";
const $ = (id) => document.getElementById(id);

let me = null;        // { email, access: 'super'|'both'|'responses'|'analytics' }
let responses = [];
let matches = [];
let activity = [];
let stats = null;
let sortKey = "createdAt", sortDir = -1;
let lastTrigger = null;   // element that opened the dialog, for focus return

/* ---------------- auth ---------------- */
$("btn-signin").addEventListener("click", async () => {
  $("signin-error").hidden = true;
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    const el = $("signin-error");
    el.textContent = "Sign-in failed: " + (e.code || e.message);
    el.hidden = false;
  }
});
$("btn-signout").addEventListener("click", () => signOut(auth));
$("btn-signout-2").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  show("loading");
  if (!user) { me = null; return show("view-signedout"); }
  const email = (user.email || "").toLowerCase();
  $("user-email").textContent = email;
  $("user-area").hidden = false;

  // Privileges come from what the rules permit, not from any list in this
  // (public) code: only super-admins may LIST the viewer collection.
  let access = null;
  try { await getDocs(collection(db, "dashboardUsers")); access = "super"; }
  catch (e) { /* not a super-admin */ }
  if (!access) {
    try {
      const snap = await getDoc(doc(db, "dashboardUsers", email));
      if (snap.exists()) access = snap.data().access;
    } catch (e) { /* no access */ }
  }
  if (!access) {
    $("noaccess-email").textContent = email;
    return show("view-noaccess");
  }
  me = { email, access };
  await loadData();
  renderAll();
  show("view-dash");
});

function show(id) {
  ["view-signedout", "view-noaccess", "view-dash", "loading"].forEach((v) => {
    $(v).hidden = v !== id;
  });
  $("user-area").hidden = !auth.currentUser;
}

/* ---------------- data ---------------- */
const canSeeResponses = () =>
  me.access === "super" || me.access === "both" || me.access === "responses";

async function loadData() {
  if (canSeeResponses()) {
    const snap = await getDocs(collection(db, "penpalIntake"));
    responses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    matches = await safeList("matches");
    activity = (await safeList("auditLog"))
      .sort((a, b) => String(tsOf(b.at)).localeCompare(String(tsOf(a.at))));
    stats = computeStats(responses);
    if (me.access === "super") {
      setDoc(doc(db, "dashboardStats", "summary"), { ...stats, updatedAt: serverTimestamp() })
        .catch(() => {});
    }
  } else {
    const snap = await getDoc(doc(db, "dashboardStats", "summary"));
    stats = snap.exists() ? snap.data() : null;
    $("stats-note").textContent = stats
      ? "Aggregated view. Updated " + fmtDate(stats.updatedAt) + "."
      : "No aggregated stats have been published yet — ask an admin to open the dashboard once.";
    $("stats-note").hidden = false;
  }
}
async function safeList(name) {
  try {
    const s = await getDocs(collection(db, name));
    return s.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) { return []; }
}

function computeStats(docs) {
  const s = {
    total: docs.length, mentees: 0, mentors: 0, thisMonth: 0, bases: 0,
    byMonth: {}, sources: {}, afscs: {}, locations: {}, goals: {}, areas: {}, matchPref: {}
  };
  const nowMonth = new Date().toISOString().slice(0, 7);
  const baseSet = new Set();
  const bump = (o, k) => { if (k) o[k] = (o[k] || 0) + 1; };
  docs.forEach((d) => {
    d.role === "mentee" ? s.mentees++ : s.mentors++;
    const month = String(d.createdAt || "").slice(0, 7);
    if (month) {
      s.byMonth[month] = s.byMonth[month] || { mentee: 0, mentor: 0 };
      s.byMonth[month][d.role]++;
      if (month === nowMonth) s.thisMonth++;
    }
    const b = baseOf(d);
    if (b) { baseSet.add(b.toLowerCase()); bump(s.locations, b); }
    if (d.mentee) {
      bump(s.sources, lbl(d.mentee.commissioningSource));
      bump(s.afscs, (d.mentee.afsc || "").toUpperCase().trim());
      (d.mentee.goals || []).forEach((g) => bump(s.goals, lbl(g)));
      bump(s.matchPref, lbl(d.mentee.matchPreference));
    }
    if (d.mentor) {
      bump(s.afscs, (d.mentor.afscTitle || "").split(",")[0].toUpperCase().trim());
      (d.mentor.mentoringAreas || []).forEach((a) => bump(s.areas, lbl(a)));
    }
  });
  s.bases = baseSet.size;
  return s;
}

/* ---------------- audit log ---------------- */
async function logChange(action, targetId, summary, before, after) {
  const entry = {
    at: serverTimestamp(), actor: me.email, action,
    targetId: targetId || "", summary: String(summary).slice(0, 300)
  };
  if (before !== undefined) entry.before = String(before);
  if (after !== undefined) entry.after = String(after);
  try {
    const ref = await addDoc(collection(db, "auditLog"), entry);
    activity.unshift({ id: ref.id, ...entry, at: new Date().toISOString() });
    renderActivity();
  } catch (e) { /* logging must never block the action */ }
}

/* ---------------- matching ----------------
   A mentee has at most one mentor. A mentor may take as many mentees as the
   capacity they signed up for (1, 2, or 3+), so "already matched" must not
   lock a mentor out of their remaining slots. */
const matchesFor = (id) => matches.filter((m) => m.menteeId === id || m.mentorId === id);

function capacityOf(d) {
  if (!d || d.role !== "mentor") return 1;
  const c = String(branchOf(d).menteeCapacity || "1").trim();
  if (c.startsWith("3")) return 3;                 // "3+" on the form
  const n = parseInt(c, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
const openSlots = (d) => Math.max(0, capacityOf(d) - matchesFor(d.id)
  .filter((m) => (m.status || "in_progress") !== "ended").length);

function statusOf(id) {
  const ms = matchesFor(id);
  if (!ms.length) return "unmatched";
  const live = ms.filter((m) => (m.status || "in_progress") !== "ended");
  if (!live.length) return "ended";
  return live.some((m) => m.status === "matched") ? "matched" : "in_progress";
}
function partnersOf(intake) {
  return matchesFor(intake.id).map((m) => {
    const otherId = m.menteeId === intake.id ? m.mentorId : m.menteeId;
    const other = responses.find((r) => r.id === otherId);
    return {
      match: m, id: otherId, doc: other || null,
      name: other ? fullName(other)
        : (m.menteeId === intake.id ? m.mentorName : m.menteeName) || "(removed)"
    };
  });
}
/* A mentee goal and the mentor strength that answers it */
const GOAL_TO_AREA = {
  "afsc-progression": "afsc-tactical",
  networking: "networking",
  "lead-enlisted": "enlisted",
  "work-life": "work-life",
  "future-roles": "staff",
  transition: "assignments"
};
const fullName = (d) => [d.name?.rank, d.name?.first, d.name?.last].filter(Boolean).join(" ");
const branchOf = (d) => (d.role === "mentee" ? d.mentee : d.mentor) || {};
const afscOf = (d) => String(branchOf(d).afsc || branchOf(d).afscTitle || "")
  .split(",")[0].trim().toUpperCase();
const baseOf = (d) => String(branchOf(d).firstDutyLocation || branchOf(d).dutyLocation || "").trim();

function scoreCandidate(person, cand) {
  let score = 0; const why = [];
  const a = afscOf(person), b = afscOf(cand);
  if (a && b && a === b) { score += 3; why.push("same AFSC"); }
  else if (a && b && a.slice(0, 2) === b.slice(0, 2)) { score += 1; why.push("similar field"); }
  const pa = baseOf(person).toLowerCase(), pb = baseOf(cand).toLowerCase();
  if (pa && pb && pa === pb) { score += 2; why.push("same base"); }
  return { score, why: why.join(", ") };
}
function candidatesFor(intake) {
  const wantRole = intake.role === "mentee" ? "mentor" : "mentee";
  const already = new Set(matchesFor(intake.id)
    .map((m) => (m.menteeId === intake.id ? m.mentorId : m.menteeId)));
  return responses.filter((r) => r.role === wantRole && !already.has(r.id))
    .map((r) => {
      const s = scoreCandidate(intake, r);
      const slots = r.role === "mentor" ? openSlots(r) : (matchesFor(r.id).length ? 0 : 1);
      return {
        doc: r, score: s.score, why: s.why, taken: slots === 0,
        note: r.role === "mentor" && slots > 0 && capacityOf(r) > 1
          ? `${slots} of ${capacityOf(r)} slots open` : ""
      };
    })
    .sort((a, b) => (a.taken - b.taken) || (b.score - a.score) ||
      fullName(a.doc).localeCompare(fullName(b.doc)));
}

async function createMatch(intake, partnerId, status, date, notes) {
  const partner = responses.find((r) => r.id === partnerId);
  if (!partner) return;
  const mentee = intake.role === "mentee" ? intake : partner;
  const mentor = intake.role === "mentor" ? intake : partner;
  const payload = {
    menteeId: mentee.id, mentorId: mentor.id,
    menteeName: fullName(mentee), mentorName: fullName(mentor),
    status, matchedAt: date || todayISO(), notes: notes || "",
    updatedBy: me.email, updatedAt: serverTimestamp()
  };
  const ref = await addDoc(collection(db, "matches"), payload);
  matches.push({ id: ref.id, ...payload });
  logChange("match_create", ref.id,
    `${fullName(mentee)} matched with ${fullName(mentor)}`, "", STATUS_LABEL[status]);
  renderMatches(); renderResponses();
  openDetail(intake);
}
async function setStatus(matchId, status) {
  const m = matches.find((x) => x.id === matchId);
  const before = m ? (m.status || "in_progress") : "";
  await updateDoc(doc(db, "matches", matchId),
    { status, updatedBy: me.email, updatedAt: serverTimestamp() });
  if (m) m.status = status;
  logChange("match_status", matchId,
    `${m ? m.menteeName + " / " + m.mentorName : matchId}`,
    STATUS_LABEL[before], STATUS_LABEL[status]);
  renderMatches(); renderResponses();
}
async function removeMatch(matchId, stayOn) {
  const m = matches.find((x) => x.id === matchId);
  await deleteDoc(doc(db, "matches", matchId));
  matches = matches.filter((x) => x.id !== matchId);
  logChange("match_delete", matchId,
    m ? `${m.menteeName} / ${m.mentorName}` : matchId, STATUS_LABEL[m?.status || "in_progress"], "");
  renderMatches(); renderResponses();
  if (!$("detail").open) return;
  if (stayOn) renderMatchBox(stayOn); else closeDetail();
}
const todayISO = () => new Date().toISOString().slice(0, 10);

/* ---------------- render ---------------- */
function renderAll() {
  $("tab-viewers").hidden = me.access !== "super";
  $("tab-responses").hidden = !canSeeResponses();
  $("tab-matches").hidden = !canSeeResponses();
  $("tab-activity").hidden = !canSeeResponses();
  $("btn-report").hidden = false;
  renderOverview($("tiles"), $("charts"), false);
  if (canSeeResponses()) { renderHead(); renderResponses(); renderMatches(); renderActivity(); }
  if (me.access === "super") renderViewers();
}

function renderOverview(tilesEl, chartsEl, print) {
  if (!stats) { tilesEl.innerHTML = ""; chartsEl.innerHTML = ""; return; }
  const tile = (v, l) => `<div class="${print ? "r-tile" : "tile"}"><b>${v}</b><span>${l}</span></div>`;
  tilesEl.innerHTML =
    tile(stats.total, "Total signups") + tile(stats.mentees, "Mentees") +
    tile(stats.mentors, "Mentors") + tile(stats.thisMonth, "This month") +
    tile(stats.bases, "Duty locations");

  const top = (o, n) => Object.entries(o || {}).filter(([k]) => k && k !== "—")
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
  const t = print
    ? { grid: "#e3e6ec", cls: "r-chart" }
    : { grid: "rgba(180,200,255,.10)", cls: "chart" };

  chartsEl.innerHTML =
    monthChart(stats.byMonth, t) +
    hbar("Commissioning source (mentees)", top(stats.sources, 6), COLORS.mentee, t) +
    hbar("Top AFSCs", top(stats.afscs, 7), COLORS.mentee, t) +
    hbar("Top duty locations", top(stats.locations, 7), COLORS.mentee, t) +
    hbar("Mentee goals", top(stats.goals, 6), COLORS.mentee, t) +
    hbar("Mentor strengths", top(stats.areas, 6), COLORS.mentor, t) +
    hbar("Match preference (mentees)", top(stats.matchPref, 3), COLORS.mentee, t);
  if (!print) { hookTooltips(chartsEl); scaleChartText(chartsEl); }
}

/* a rect with only its data end rounded, anchored square to the baseline */
function barPath(x, y, w, h, r, dir) {
  r = Math.max(0, Math.min(r, dir === "right" ? w : h));
  if (dir === "right") {
    return `M${x},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r}
            V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x} Z`;
  }
  return `M${x},${y + h} V${y + r} A${r},${r} 0 0 1 ${x + r},${y}
          H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h} Z`;
}

/* Grouped monthly bars — capped at 8 groups so the pairs stay readable */
function monthChart(byMonth, t) {
  const months = Object.keys(byMonth || {}).sort().slice(-8);
  if (!months.length) return "";
  const W = 420, H = 200, padL = 30, padB = 28, padT = 8;
  const max = Math.max(2, ...months.map((m) => Math.max(byMonth[m].mentee, byMonth[m].mentor)));
  const slot = (W - padL - 8) / months.length;
  const bw = Math.min(18, (slot - 10) / 2);
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  let bars = "", labels = "";
  months.forEach((m, i) => {
    const x0 = padL + i * slot + (slot - bw * 2 - 2) / 2;
    [["mentee", COLORS.mentee, x0], ["mentor", COLORS.mentor, x0 + bw + 2]].forEach(([k, c, x]) => {
      const v = byMonth[m][k];
      const h = v ? Math.max(3, H - padB - y(v)) : 0;
      if (h) bars += `<g class="bar-hit" data-tip="${monthName(m)} — ${v} ${k}${v === 1 ? "" : "s"}">
        <rect x="${x - 3}" y="${padT}" width="${bw + 6}" height="${H - padT - padB}" fill="transparent"/>
        <path class="mark" d="${barPath(x, H - padB - h, bw, h, 4, "up")}" fill="${c}"/></g>`;
    });
    labels += `<text class="t-tick" x="${padL + i * slot + slot / 2}" y="${H - 10}"
      text-anchor="middle">${monthName(m)}</text>`;
  });
  const grid = [0, 0.5, 1].map((f) => {
    const v = Math.round(max * f);
    return `<line x1="${padL}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" stroke="${t.grid}" stroke-width="1"/>
      <text class="t-tick" x="${padL - 7}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }).join("");
  return `<div class="${t.cls}"><h3>Signups by month</h3>
    <div class="legend"><span><i style="background:${COLORS.mentee}"></i>Mentees</span>
    <span><i style="background:${COLORS.mentor}"></i>Mentors</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Signups by month, mentees and mentors">
      ${grid}${bars}${labels}</svg></div>`;
}

/* Horizontal bars — no axis, value labelled directly at the bar end */
function hbar(title, entries, color, t) {
  if (!entries.length) return "";
  const W = 420, rowH = 30, padT = 4;
  const H = padT + entries.length * rowH + 4;
  const max = Math.max(...entries.map((e) => e[1]));
  const labelW = 178, valW = 34;
  let rows = "";
  entries.forEach(([k, v], i) => {
    const yy = padT + i * rowH;
    const bw = Math.max(4, (W - labelW - valW - 10) * (v / max));
    const name = k.length > 24 ? k.slice(0, 23) + "…" : k;
    rows += `<g class="bar-hit" data-tip="${esc(k)} — ${v}">
      <rect x="0" y="${yy}" width="${W}" height="${rowH - 2}" fill="transparent"/>
      <text class="t-cat" x="${labelW - 10}" y="${yy + rowH / 2 + 4}" text-anchor="end">${esc(name)}</text>
      <path class="mark" d="${barPath(labelW, yy + (rowH - 16) / 2, bw, 16, 4, "right")}" fill="${color}"/>
      <text class="t-val" x="${labelW + bw + 8}" y="${yy + rowH / 2 + 4}">${v}</text></g>`;
  });
  return `<div class="${t.cls}"><h3>${esc(title)}</h3>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${rows}</svg></div>`;
}

/* keep SVG label sizes honest regardless of container width */
function scaleChartText(root) {
  const set = () => root.querySelectorAll(".chart").forEach((c) => {
    const svg = c.querySelector("svg");
    if (!svg) return;
    const vb = svg.viewBox.baseVal.width || 420;
    const w = svg.clientWidth || vb;
    c.style.setProperty("--cs", (vb / w).toFixed(3));
  });
  set();
  if (window.ResizeObserver && !scaleChartText._ro) {
    scaleChartText._ro = new ResizeObserver(set);
    scaleChartText._ro.observe(root);
  }
}

function hookTooltips(root) {
  const tip = $("tooltip");
  root.querySelectorAll(".bar-hit").forEach((g) => {
    g.addEventListener("mousemove", (e) => {
      tip.textContent = g.dataset.tip;
      tip.hidden = false;
      tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + "px";
      tip.style.top = (e.clientY - 36) + "px";
    });
    g.addEventListener("mouseleave", () => { tip.hidden = true; });
  });
}

/* ---------------- responses table ---------------- */
const COLUMNS = [
  { key: "createdAt", label: "Submitted", get: (d) => d.createdAt || "" },
  { key: "role", label: "Role", get: (d) => d.role },
  { key: "name", label: "Name", get: (d) => fullName(d) },
  { key: "status", label: "Status", get: (d) => STATUS_LABEL[statusOf(d.id)] },
  { key: "partner", label: "Matched with", get: (d) => partnersOf(d).map((p) => p.name).join(", ") },
  { key: "afsc", label: "AFSC", get: (d) => afscOf(d) },
  { key: "base", label: "Location", get: (d) => baseOf(d) }
];

function renderHead() {
  $("rtable-head").innerHTML = COLUMNS.map((c) => {
    const active = sortKey === c.key;
    const caret = active ? (sortDir === 1 ? "▲" : "▼") : "▾";
    return `<th scope="col"${active ? ` aria-sort="${sortDir === 1 ? "ascending" : "descending"}"` : ""}>
      <button class="th-sort" type="button" data-sort="${c.key}">${esc(c.label)}
        <span class="caret" aria-hidden="true">${caret}</span></button></th>`;
  }).join("");
  $("rtable-head").querySelectorAll("[data-sort]").forEach((b) =>
    b.addEventListener("click", () => {
      const k = b.dataset.sort;
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
      renderHead(); renderResponses();
    }));
}

function filteredResponses() {
  const role = $("f-role").value;
  const st = $("f-status").value;
  const q = $("f-search").value.trim().toLowerCase();
  const col = COLUMNS.find((c) => c.key === sortKey) || COLUMNS[0];
  return responses.filter((d) => {
    if (role && d.role !== role) return false;
    if (st && statusOf(d.id) !== st) return false;
    if (!q) return true;
    return [fullName(d), d.email, afscOf(d), baseOf(d)].join(" ").toLowerCase().includes(q);
  }).sort((a, b) => String(col.get(a)).localeCompare(String(col.get(b)), undefined,
    { numeric: true }) * sortDir);
}

function renderResponses() {
  const rows = filteredResponses();
  $("f-count").textContent = `Showing ${rows.length} of ${responses.length}`;

  const tb = $("rtable").querySelector("tbody");
  tb.innerHTML = rows.map((d) => {
    const st = statusOf(d.id);
    const ps = partnersOf(d);
    const slots = d.role === "mentor" ? openSlots(d) : 0;
    return `<tr>
      <td>${fmtDate(d.createdAt)}</td>
      <td><span class="pill pill--${esc(d.role)}">${esc(d.role)}</span></td>
      <td><button class="rowlink" type="button" data-id="${esc(d.id)}">${esc(fullName(d))}</button></td>
      <td><span class="pill pill--${esc(st)}">${esc(STATUS_LABEL[st])}</span></td>
      <td>${esc(ps.map((p) => p.name).join(", "))}${
        ps.length && slots ? ` <span class="note">+${slots} open</span>` : ""}</td>
      <td>${esc(afscOf(d))}</td>
      <td>${esc(baseOf(d))}</td></tr>`;
  }).join("");

  tb.querySelectorAll(".rowlink").forEach((b) =>
    b.addEventListener("click", () =>
      openDetail(responses.find((r) => r.id === b.dataset.id), b)));
  tb.querySelectorAll("tr").forEach((tr) =>
    tr.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;      // the button handles itself
      tr.querySelector(".rowlink")?.click();
    }));

  const empty = $("responses-empty");
  $("rtable-wrap").hidden = rows.length === 0;
  empty.hidden = rows.length !== 0;
  if (!rows.length) {
    empty.innerHTML = responses.length === 0
      ? `<h3>No sign-ups yet</h3><p>Submissions from
         <a href="https://penpal.dafcgoc.org" target="_blank" rel="noopener">penpal.dafcgoc.org</a>
         appear here within seconds of someone completing the form.</p>`
      : `<h3>No one matches these filters</h3>
         <p>Filters active: ${esc(activeFilterText())}.</p>
         <button class="btn btn--ghost btn--sm" id="clear-filters" type="button">Clear all filters</button>`;
    const c = $("clear-filters");
    if (c) c.addEventListener("click", () => {
      $("f-role").value = ""; $("f-status").value = ""; $("f-search").value = "";
      renderResponses(); $("f-search").focus();
    });
  }
}
function activeFilterText() {
  const bits = [];
  if ($("f-role").value) bits.push($("f-role").value);
  if ($("f-status").value) bits.push(STATUS_LABEL[$("f-status").value]);
  if ($("f-search").value.trim()) bits.push(`search “${$("f-search").value.trim()}”`);
  return bits.join(", ") || "none";
}
$("f-role").addEventListener("change", renderResponses);
$("f-status").addEventListener("change", renderResponses);
let searchTimer;
$("f-search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderResponses, 350);   // debounce so the count announces once
});

/* ---------------- matches tab ---------------- */
function renderMatches() {
  const mentees = responses.filter((r) => r.role === "mentee");
  const mentors = responses.filter((r) => r.role === "mentor");
  const count = (s) => matches.filter((m) => (m.status || "in_progress") === s).length;
  const tile = (v, l) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`;
  $("match-tiles").innerHTML =
    tile(count("matched"), "Matched pairs") + tile(count("in_progress"), "In progress") +
    tile(mentees.filter((r) => statusOf(r.id) === "unmatched").length, "Mentees waiting") +
    tile(mentors.filter((r) => openSlots(r) > 0).length, "Mentors with open slots");

  $("m-count").textContent = matches.length + (matches.length === 1 ? " match" : " matches");
  $("mtable-wrap").hidden = matches.length === 0;
  $("matches-empty").hidden = matches.length !== 0;

  const tb = $("mtable").querySelector("tbody");
  tb.innerHTML = matches.slice()
    .sort((a, b) => String(b.matchedAt || "").localeCompare(String(a.matchedAt || "")))
    .map((m) => {
      const mentee = responses.find((r) => r.id === m.menteeId);
      const mentor = responses.find((r) => r.id === m.mentorId);
      const st = m.status || "in_progress";
      return `<tr>
        <td>${esc(mentee ? fullName(mentee) : m.menteeName || "(removed)")}</td>
        <td>${esc(mentor ? fullName(mentor) : m.mentorName || "(removed)")}</td>
        <td><label class="sr-only" for="st-${esc(m.id)}">Status for
              ${esc(m.menteeName || "")} and ${esc(m.mentorName || "")}</label>
          <select id="st-${esc(m.id)}" data-status-for="${esc(m.id)}">
            ${["in_progress", "matched", "ended"].map((s) =>
              `<option value="${s}"${s === st ? " selected" : ""}>${STATUS_LABEL[s]}</option>`).join("")}
          </select></td>
        <td>${esc(m.matchedAt || "—")}</td>
        <td>${esc(m.notes || "")}</td>
        <td><button class="btn btn--danger btn--sm" data-unmatch="${esc(m.id)}">Remove</button></td>
      </tr>`;
    }).join("");
  tb.querySelectorAll("[data-status-for]").forEach((sel) =>
    sel.addEventListener("change", () => setStatus(sel.dataset.statusFor, sel.value)));
  tb.querySelectorAll("[data-unmatch]").forEach((b) =>
    b.addEventListener("click", () => removeMatch(b.dataset.unmatch)));
}

/* ---------------- activity tab ---------------- */
function renderActivity() {
  const tb = $("atable").querySelector("tbody");
  $("activity-empty").hidden = activity.length !== 0;
  tb.innerHTML = activity.map((a) => {
    const change = a.before || a.after
      ? `${a.before || "—"} → ${a.after || "—"}` : "";
    return `<tr>
      <td>${fmtDateTime(a.at)}</td>
      <td>${esc(a.actor || "")}</td>
      <td>${esc(ACTION_LABEL[a.action] || a.action || "")}</td>
      <td>${esc(a.summary || "")}${change ? ` <span class="note">(${esc(change)})</span>` : ""}</td>
    </tr>`;
  }).join("");
}

/* ---------------- detail dialog ---------------- */
const detail = $("detail");
function openDetail(d, trigger) {
  if (!d) return;
  lastTrigger = trigger || document.activeElement;
  $("detail-title").textContent = fullName(d) + " — " + d.role;
  renderMatchBox(d);
  const rows = [["Submitted", fmtDate(d.createdAt)], ["Email", d.email]];
  if (d.mentee) rows.push(
    ["Commissioning source", lbl(d.mentee.commissioningSource)],
    ["AFROTC detachment", d.mentee.afrotcDetachment || "—"],
    ["Expected commissioning", d.mentee.commissioningDateExpected],
    ["Projected AFSC", d.mentee.afsc],
    ["First duty location", d.mentee.firstDutyLocation],
    ["Goals", (d.mentee.goals || []).map(lbl).join("; ")],
    ["Match preference", lbl(d.mentee.matchPreference)]);
  if (d.mentor) rows.push(
    ["Rank & time in service", d.mentor.rankTimeInService],
    ["AFSC & duty title", d.mentor.afscTitle],
    ["Duty location", d.mentor.dutyLocation],
    ["Commissioned", d.mentor.commissioningDateActual],
    ["Experiences", d.mentor.experiences],
    ["Mentoring areas", (d.mentor.mentoringAreas || []).map(lbl).join("; ")],
    ["Mentee capacity", d.mentor.menteeCapacity]);
  if (d.ask) rows.push(["Anything else", d.ask]);
  $("detail-body").innerHTML = rows
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(String(v ?? "—"))}</dd>`).join("");
  if (!detail.open) detail.showModal();
  $("detail-title").focus();     // land on context, not the first control
}
function closeDetail() {
  if (detail.open) detail.close();
}
detail.addEventListener("close", () => {
  if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
  lastTrigger = null;
});
$("detail-close").addEventListener("click", closeDetail);
detail.addEventListener("click", (e) => {          // click on the backdrop area
  if (e.target === detail) closeDetail();
});

function renderMatchBox(d) {
  const box = $("detail-match");
  const existing = partnersOf(d);
  const counterpart = d.role === "mentee" ? "mentor" : "mentee";
  const slots = openSlots(d);
  const cap = capacityOf(d);

  /* everyone this person is already paired with */
  const existingHtml = existing.map((p, i) => {
    const st = p.match.status || "in_progress";
    return `
      <div class="pairing">
        <div class="matchbox__head">
          <p class="matchbox__who" style="margin:0">${esc(p.name)}
            <span class="matchbox__meta">(${esc(counterpart)})</span></p>
          <span class="pill pill--${esc(st)}">${esc(STATUS_LABEL[st])}</span>
        </div>
        <p class="matchbox__meta">Matched ${esc(p.match.matchedAt || "—")}${
          p.match.notes ? " · " + esc(p.match.notes) : ""}</p>
        <div class="matchbox__row">
          <label class="sr-only" for="mb-status-${i}">Status with ${esc(p.name)}</label>
          <select id="mb-status-${i}" data-mid="${esc(p.match.id)}">
            ${["in_progress", "matched", "ended"].map((s) =>
              `<option value="${s}"${s === st ? " selected" : ""}>${STATUS_LABEL[s]}</option>`).join("")}
          </select>
          <button class="btn btn--danger btn--sm" data-remove="${esc(p.match.id)}" type="button">Remove</button>
        </div>
      </div>`;
  }).join("");

  const headStatus = statusOf(d.id);
  const capNote = d.role === "mentor" && cap > 1
    ? `<span class="matchbox__meta">${existing.length} of ${cap} mentees${
        slots ? ` · ${slots} slot${slots === 1 ? "" : "s"} open` : " · full"}</span>`
    : "";

  if (existing.length && slots === 0) {
    box.innerHTML = `
      <div class="matchbox__head">
        <span class="matchbox__title">Match</span>
        <span class="pill pill--${esc(headStatus)}">${esc(STATUS_LABEL[headStatus])}</span>
      </div>
      ${capNote}${existingHtml}`;
    wirePairings(box, d);
    return;
  }

  const cands = candidatesFor(d);
  const available = cands.filter((c) => !c.taken).length;
  box.innerHTML = `
    <div class="matchbox__head">
      <span class="matchbox__title">Match</span>
      <span class="pill pill--${esc(headStatus)}">${esc(STATUS_LABEL[headStatus])}</span>
    </div>
    ${capNote}${existingHtml}
    ${cands.length ? `
      <p class="matchbox__title" style="margin-top:14px">
        ${existing.length ? `Add another ${counterpart}` : `Pair with a ${counterpart}`}</p>
      <div class="matchbox__grid" role="group" aria-label="Create a match">
        <div><label class="matchbox__meta" for="mb-pick">${esc(counterpart)}</label>
          <select id="mb-pick">
            <option value="">Choose…</option>
            ${cands.map((c) => `<option value="${esc(c.doc.id)}"${c.taken ? " disabled" : ""}>${
              esc(fullName(c.doc))}${c.why ? " — " + esc(c.why) : ""}${
              c.note ? " · " + esc(c.note) : ""}${
              c.taken ? " (no slots left)" : ""}</option>`).join("")}
          </select></div>
        <div><label class="matchbox__meta" for="mb-date">Date of match</label>
          <input id="mb-date" type="date" value="${todayISO()}"></div>
        <div><label class="matchbox__meta" for="mb-newstatus">Status</label>
          <select id="mb-newstatus">
            <option value="in_progress">Matching in progress</option>
            <option value="matched">Matched</option>
          </select></div>
      </div>
      <div id="mb-compare"></div>
      <div class="matchbox__row">
        <label class="sr-only" for="mb-notes">Notes</label>
        <textarea id="mb-notes" placeholder="Notes (optional)"></textarea>
      </div>
      <div class="matchbox__row">
        <button class="btn btn--gold btn--sm" id="mb-create" type="button"${
          available ? "" : " disabled"}>Create match</button>
        <span class="hint">${available
          ? `Suggestions ordered by <span class="cand-why">AFSC and duty location</span>.`
          : `Every ${counterpart} is already at capacity.`}</span>
      </div>`
    : `<p class="matchbox__meta">No ${counterpart}s have signed up yet.</p>`}`;

  wirePairings(box, d);
  const pickEl = $("mb-pick");
  if (pickEl) pickEl.addEventListener("change", () =>
    renderCompare(d, responses.find((r) => r.id === pickEl.value)));
  const create = $("mb-create");
  if (create) create.addEventListener("click", () => {
    const pick = pickEl.value;
    if (!pick) { pickEl.focus(); return; }
    create.disabled = true;
    createMatch(d, pick, $("mb-newstatus").value, $("mb-date").value, $("mb-notes").value);
  });
}

/* Side-by-side comparison of the two people, with every signal spelled out */
function renderCompare(person, cand) {
  const el = $("mb-compare");
  if (!el) return;
  if (!cand) { el.innerHTML = ""; return; }

  const mentee = person.role === "mentee" ? person : cand;
  const mentor = person.role === "mentor" ? person : cand;
  const goals = mentee.mentee?.goals || [];
  const areas = mentor.mentor?.mentoringAreas || [];
  const covered = goals.filter((g) => areas.includes(GOAL_TO_AREA[g]));
  const uncovered = goals.filter((g) => !areas.includes(GOAL_TO_AREA[g]));

  const aAfsc = afscOf(mentee), bAfsc = afscOf(mentor);
  const afscExact = aAfsc && bAfsc && aAfsc === bAfsc;
  const afscNear = !afscExact && aAfsc && bAfsc && aAfsc.slice(0, 2) === bAfsc.slice(0, 2);
  const sameBase = baseOf(mentee) && baseOf(mentee).toLowerCase() === baseOf(mentor).toLowerCase();
  const pref = mentee.mentee?.matchPreference;
  const prefMet = pref === "exact-afsc" ? afscExact
    : pref === "broad-field" ? (afscExact || afscNear) : true;

  const signal = (ok, label, detail) =>
    `<li class="${ok === true ? "sig-yes" : ok === "part" ? "sig-part" : "sig-no"}">
      <span class="sig-mark" aria-hidden="true">${ok === true ? "✓" : ok === "part" ? "~" : "·"}</span>
      <span><b>${esc(label)}</b>${detail ? " — " + detail : ""}</span></li>`;

  const col = (p, roleLabel) => {
    const b = branchOf(p);
    const rows = p.role === "mentee"
      ? [["Commissioning", `${lbl(b.commissioningSource)}${b.afrotcDetachment ? ", " + esc(b.afrotcDetachment) : ""}`],
         ["Commissions", b.commissioningDateExpected || "—"],
         ["Projected AFSC", aAfsc || "—"],
         ["First duty station", b.firstDutyLocation || "—"],
         ["Goals", goals.map(lbl).join(", ") || "—"],
         ["Prefers", lbl(b.matchPreference)]]
      : [["Rank / time in service", b.rankTimeInService || "—"],
         ["AFSC & duty title", b.afscTitle || "—"],
         ["Duty station", b.dutyLocation || "—"],
         ["Commissioned", b.commissioningDateActual || "—"],
         ["Can speak to", b.experiences || "—"],
         ["Strengths", areas.map(lbl).join(", ") || "—"],
         ["Capacity", `${capacityOf(p)} mentee${capacityOf(p) === 1 ? "" : "s"} · ${openSlots(p)} open`]];
    return `<div class="cmp__col">
      <div class="cmp__head">
        <span class="pill pill--${esc(p.role)}">${esc(roleLabel)}</span>
        <b>${esc(fullName(p))}</b>
      </div>
      <dl class="cmp__dl">${rows.map(([k, v]) =>
        `<dt>${esc(k)}</dt><dd>${esc(String(v))}</dd>`).join("")}</dl>
    </div>`;
  };

  el.innerHTML = `
    <div class="cmp">
      ${col(mentee, "Mentee — cadet / new Lt")}
      ${col(mentor, "Mentor — CGO")}
    </div>
    <ul class="cmp__signals">
      ${signal(afscExact ? true : afscNear ? "part" : false, "Career field",
        afscExact ? `both ${esc(aAfsc)}`
          : afscNear ? `${esc(aAfsc)} and ${esc(bAfsc)}, same family`
          : `${esc(aAfsc || "—")} vs ${esc(bAfsc || "—")}`)}
      ${signal(sameBase, "Duty location",
        sameBase ? esc(baseOf(mentee)) : `${esc(baseOf(mentee) || "—")} vs ${esc(baseOf(mentor) || "—")}`)}
      ${signal(covered.length === goals.length && goals.length ? true : covered.length ? "part" : false,
        "Goals covered", covered.length
          ? `${covered.map(lbl).join(", ")}${uncovered.length ? ` · not covered: ${uncovered.map(lbl).join(", ")}` : ""}`
          : "none of the stated goals match this mentor's strengths")}
      ${signal(prefMet, "Mentee's preference", `asked for ${esc(lbl(pref))}`)}
    </ul>`;
}

/* status/remove controls for each existing pairing */
function wirePairings(box, d) {
  box.querySelectorAll("[data-mid]").forEach((sel) =>
    sel.addEventListener("change", () =>
      setStatus(sel.dataset.mid, sel.value).then(() => renderMatchBox(d))));
  box.querySelectorAll("[data-remove]").forEach((b) =>
    b.addEventListener("click", () => removeMatch(b.dataset.remove, d)));
}

/* ---------------- viewers ---------------- */
async function renderViewers() {
  const snap = await getDocs(collection(db, "dashboardUsers"));
  const tb = $("vtable").querySelector("tbody");
  tb.innerHTML = snap.docs.map((d) => {
    const v = d.data();
    return `<tr><td>${esc(d.id)}</td><td>${esc(v.access)}</td>
      <td>${fmtDate(v.addedAt)}</td>
      <td><button class="btn btn--danger btn--sm" data-del="${esc(d.id)}">Remove</button></td></tr>`;
  }).join("") || `<tr><td colspan="4" style="color:var(--text-muted)">No extra viewers yet.</td></tr>`;
  tb.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      await deleteDoc(doc(db, "dashboardUsers", b.dataset.del));
      logChange("viewer_remove", b.dataset.del, b.dataset.del);
      renderViewers();
    }));
}
$("add-viewer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("v-email").value.trim().toLowerCase();
  if (!email) return;
  const access = $("v-access").value;
  await setDoc(doc(db, "dashboardUsers", email),
    { access, addedBy: me.email, addedAt: serverTimestamp() });
  logChange("viewer_add", email, `${email} (${access})`);
  $("v-email").value = "";
  renderViewers();
});

/* ---------------- tabs ---------------- */
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => {
      x.classList.toggle("is-active", x === t);
      x.setAttribute("aria-selected", x === t);
    });
    ["overview", "responses", "matches", "activity", "viewers"].forEach((p) =>
      $("panel-" + p).hidden = p !== t.dataset.tab);
  }));

/* ---------------- PDF report ---------------- */
$("btn-report").addEventListener("click", () => {
  const r = $("report");
  const now = new Date();
  const tiles = document.createElement("div");
  const charts = document.createElement("div");
  renderOverview(tiles, charts, true);

  let tableHtml = "";
  if (canSeeResponses() && matches.length) {
    const st = (s) => matches.filter((m) => (m.status || "in_progress") === s).length;
    tableHtml += `<h2>Matches</h2>
      <p style="margin:0 0 3mm;color:#5a6478;font-family:Helvetica,Arial,sans-serif;font-size:9pt">
        ${st("matched")} matched · ${st("in_progress")} in progress ·
        ${responses.filter((x) => x.role === "mentee" && statusOf(x.id) === "unmatched").length} mentees waiting ·
        ${responses.filter((x) => x.role === "mentor" && statusOf(x.id) === "unmatched").length} mentors available</p>
      <table><thead><tr><th>Mentee</th><th>Mentor</th><th>Status</th>
      <th>Date of match</th><th>Notes</th></tr></thead><tbody>` +
      matches.slice().sort((a, b) => String(b.matchedAt || "").localeCompare(String(a.matchedAt || "")))
        .map((m) => `<tr><td>${esc(m.menteeName || "")}</td><td>${esc(m.mentorName || "")}</td>
          <td>${esc(STATUS_LABEL[m.status || "in_progress"])}</td>
          <td>${esc(m.matchedAt || "")}</td><td>${esc(m.notes || "")}</td></tr>`).join("") +
      "</tbody></table>";
  }
  if (canSeeResponses() && responses.length) {
    tableHtml += `<h2>Responses (${responses.length})</h2>
      <table><thead><tr><th>Submitted</th><th>Role</th><th>Name</th><th>Email</th>
      <th>Status</th><th>Matched with</th><th>AFSC</th><th>Location</th><th>Details</th></tr></thead><tbody>` +
      responses.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .map((d) => {
          const ps = partnersOf(d);
          const b = branchOf(d);
          const det = d.mentee
            ? `${lbl(d.mentee.commissioningSource)} · commissions ${d.mentee.commissioningDateExpected} · goals: ${(d.mentee.goals || []).map(lbl).join(", ")}`
            : `${b.rankTimeInService || ""} · areas: ${(b.mentoringAreas || []).map(lbl).join(", ")} · capacity ${b.menteeCapacity || "—"}`;
          return `<tr><td>${fmtDate(d.createdAt)}</td><td>${esc(d.role)}</td>
            <td>${esc(fullName(d))}</td><td>${esc(d.email || "")}</td>
            <td>${esc(STATUS_LABEL[statusOf(d.id)])}</td>
            <td>${esc(ps.map((p) => p.name).join(", "))}</td>
            <td>${esc(afscOf(d))}</td><td>${esc(baseOf(d))}</td><td>${esc(det)}</td></tr>`;
        }).join("") + "</tbody></table>";
  }

  r.hidden = false;
  r.innerHTML = `
    <div class="r-head">
      <div><div class="r-eyebrow">DAF CGOC · Mentorship Program</div><h1>Program Report</h1></div>
      <div class="r-sub">Generated ${now.toLocaleDateString("en-US",
        { day: "numeric", month: "long", year: "numeric" })} · ${esc(me.email)}</div>
    </div>
    <div class="r-tiles">${tiles.innerHTML}</div>
    <h2>Program analytics</h2>
    <div class="r-charts">${charts.innerHTML}</div>
    ${tableHtml}
    <div class="r-foot">Department of the Air Force Company Grade Officers' Council ·
      Mentorship Program dashboard · For official council use — contains member PII,
      handle accordingly.</div>`;
  window.print();
});

/* ---------------- utils ---------------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function tsOf(ts) {
  if (!ts) return "";
  if (typeof ts === "string") return ts;
  if (ts.toDate) return ts.toDate().toISOString();
  if (ts.seconds) return new Date(ts.seconds * 1000).toISOString();
  return "";
}
function fmtDate(ts) {
  const iso = tsOf(ts);
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleDateString("en-US",
    { day: "numeric", month: "short", year: "numeric" }) : "—";
}
function fmtDateTime(ts) {
  const iso = tsOf(ts);
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleString("en-US",
    { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";
}
function monthName(m) {
  return new Date(m + "-15").toLocaleDateString("en-US", { month: "short" });
}
