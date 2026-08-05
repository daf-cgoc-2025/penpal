/* ============================================================
   DAF CGOC Mentorship — Admin dashboard
   Google sign-in + Firestore reads gated by firestore.rules:
     super-admins  -> everything (and can manage viewers)
     access=both/responses -> raw responses + computed analytics
     access=analytics      -> PII-free dashboardStats/summary only
   ============================================================ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import {
  getFirestore, collection, getDocs, doc, getDoc, setDoc, deleteDoc, serverTimestamp
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
const lbl = (v) => LABELS[v] || v || "—";
const $ = (id) => document.getElementById(id);

let me = null;          // { email, access: 'super'|'both'|'responses'|'analytics' }
let responses = [];     // raw docs (when permitted)
let stats = null;       // aggregates

/* ---------------- auth flow ---------------- */
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

  // Privileges are determined by what the security rules permit, not by any
  // list in this (public) code: only super-admins may LIST the viewer
  // collection, and any signed-in user may read their own viewer entry.
  let access = null;
  try {
    await getDocs(collection(db, "dashboardUsers"));
    access = "super";
  } catch (e) { /* not a super-admin */ }
  if (!access) {
    try {
      const snap = await getDoc(doc(db, "dashboardUsers", email));
      if (snap.exists()) access = snap.data().access;
    } catch (e) { /* not permitted -> no access */ }
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
const canSeeResponses = () => me.access === "super" || me.access === "both" || me.access === "responses";

async function loadData() {
  if (canSeeResponses()) {
    const snap = await getDocs(collection(db, "penpalIntake"));
    responses = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.createdAt) > String(a.createdAt) ? 1 : -1);
    stats = computeStats(responses);
    if (me.access === "super") {  // keep PII-free aggregates fresh for analytics-only viewers
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

function computeStats(docs) {
  const s = {
    total: docs.length, mentees: 0, mentors: 0, thisMonth: 0, bases: 0,
    byMonth: {}, sources: {}, afscs: {}, locations: {}, goals: {}, areas: {}, matchPref: {}
  };
  const nowMonth = new Date().toISOString().slice(0, 7);
  const baseSet = new Set();
  const bump = (o, k) => { if (k) o[k] = (o[k] || 0) + 1; };
  docs.forEach((d) => {
    const role = d.role;
    role === "mentee" ? s.mentees++ : s.mentors++;
    const month = String(d.createdAt || "").slice(0, 7);
    if (month) {
      s.byMonth[month] = s.byMonth[month] || { mentee: 0, mentor: 0 };
      s.byMonth[month][role]++;
      if (month === nowMonth) s.thisMonth++;
    }
    const b = d.mentee ? d.mentee.firstDutyLocation : (d.mentor || {}).dutyLocation;
    if (b) { baseSet.add(b.trim().toLowerCase()); bump(s.locations, b.trim()); }
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

/* ---------------- rendering ---------------- */
function renderAll() {
  $("tab-viewers").hidden = me.access !== "super";
  $("tab-responses").hidden = !canSeeResponses();
  $("btn-report").hidden = false;
  renderOverview($("tiles"), $("charts"), false);
  if (canSeeResponses()) renderResponses();
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
    .sort((a, b) => b[1] - a[1]).slice(0, n);
  const theme = print
    ? { ink: "#1a2233", muted: "#5a6478", grid: "#e3e6ec", cls: "r-chart" }
    : { ink: "#EEF2FB", muted: "#8592AC", grid: "rgba(180,200,255,.10)", cls: "chart" };

  chartsEl.innerHTML =
    monthChart(stats.byMonth, theme) +
    hbar("Commissioning source (mentees)", top(stats.sources, 6), COLORS.mentee, theme) +
    hbar("Top AFSCs", top(stats.afscs, 7), COLORS.mentee, theme) +
    hbar("Top duty locations", top(stats.locations, 7), COLORS.mentee, theme) +
    hbar("Mentee goals", top(stats.goals, 6), COLORS.mentee, theme) +
    hbar("Mentor strengths", top(stats.areas, 6), COLORS.mentor, theme) +
    hbar("Match preference (mentees)", top(stats.matchPref, 3), COLORS.mentee, theme);
  if (!print) hookTooltips(chartsEl);
}

/* Grouped monthly bars — 2 series, legend + direct hover */
function monthChart(byMonth, t) {
  const months = Object.keys(byMonth || {}).sort().slice(-12);
  if (!months.length) return "";
  const W = 420, H = 190, padL = 26, padB = 26, padT = 10;
  const max = Math.max(2, ...months.map((m) => Math.max(byMonth[m].mentee, byMonth[m].mentor)));
  const slot = (W - padL - 6) / months.length;
  const bw = Math.min(16, (slot - 8) / 2);
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  let bars = "", labels = "";
  months.forEach((m, i) => {
    const x0 = padL + i * slot + (slot - bw * 2 - 2) / 2;
    [["mentee", COLORS.mentee, x0], ["mentor", COLORS.mentor, x0 + bw + 2]].forEach(([k, c, x]) => {
      const v = byMonth[m][k];
      const h = Math.max(v ? 3 : 0, H - padB - y(v));
      bars += `<g class="bar-hit" data-tip="${monthName(m)} — ${v} ${k}${v === 1 ? "" : "s"}">
        <rect x="${x - 2}" y="${padT}" width="${bw + 4}" height="${H - padT - padB}" fill="transparent"/>
        <rect class="mark" x="${x}" y="${H - padB - h}" width="${bw}" height="${h}" rx="3" fill="${c}"/></g>`;
    });
    labels += `<text x="${padL + i * slot + slot / 2}" y="${H - 8}" text-anchor="middle"
      font-size="9.5" fill="${t.muted}">${monthName(m)}</text>`;
  });
  const grid = [0, 0.5, 1].map((f) => {
    const v = Math.round(max * f);
    return `<line x1="${padL}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" stroke="${t.grid}" stroke-width="1"/>
      <text x="${padL - 5}" y="${y(v) + 3}" text-anchor="end" font-size="9" fill="${t.muted}">${v}</text>`;
  }).join("");
  return `<div class="${t.cls}"><h3>Signups by month</h3>
    <div class="legend"><span><i style="background:${COLORS.mentee}"></i>Mentees</span>
    <span><i style="background:${COLORS.mentor}"></i>Mentors</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Signups by month">${grid}${bars}${labels}</svg></div>`;
}

/* Horizontal bars — magnitude, single hue, value labels */
function hbar(title, entries, color, t) {
  if (!entries.length) return "";
  const W = 420, rowH = 26, padT = 4;
  const H = padT + entries.length * rowH + 4;
  const max = Math.max(...entries.map((e) => e[1]));
  const labelW = 172, valW = 30;
  let rows = "";
  entries.forEach(([k, v], i) => {
    const yy = padT + i * rowH;
    const bw = Math.max(3, (W - labelW - valW - 10) * (v / max));
    const name = k.length > 26 ? k.slice(0, 25) + "…" : k;
    rows += `<g class="bar-hit" data-tip="${esc(k)} — ${v}">
      <rect x="0" y="${yy}" width="${W}" height="${rowH - 2}" fill="transparent"/>
      <text x="${labelW - 8}" y="${yy + rowH / 2 + 3}" text-anchor="end" font-size="11" fill="${t.ink}">${esc(name)}</text>
      <rect class="mark" x="${labelW}" y="${yy + (rowH - 14) / 2}" width="${bw}" height="14" rx="3" fill="${color}"/>
      <text x="${labelW + bw + 7}" y="${yy + rowH / 2 + 3.5}" font-size="11" fill="${t.muted}">${v}</text></g>`;
  });
  return `<div class="${t.cls}"><h3>${esc(title)}</h3>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${rows}</svg></div>`;
}

function hookTooltips(root) {
  const tip = $("tooltip");
  root.querySelectorAll(".bar-hit").forEach((g) => {
    g.addEventListener("mousemove", (e) => {
      tip.textContent = g.dataset.tip;
      tip.hidden = false;
      tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + "px";
      tip.style.top = (e.clientY - 34) + "px";
    });
    g.addEventListener("mouseleave", () => { tip.hidden = true; });
  });
}

/* ---------------- responses table ---------------- */
function renderResponses() {
  const role = $("f-role").value;
  const q = $("f-search").value.trim().toLowerCase();
  const rows = responses.filter((d) => {
    if (role && d.role !== role) return false;
    if (!q) return true;
    const branch = d.mentee || d.mentor || {};
    return [d.name?.first, d.name?.last, d.email, branch.afsc, branch.afscTitle,
      branch.firstDutyLocation, branch.dutyLocation].join(" ").toLowerCase().includes(q);
  });
  $("f-count").textContent = rows.length + " of " + responses.length;
  $("responses-empty").hidden = responses.length > 0;
  const tb = $("rtable").querySelector("tbody");
  tb.innerHTML = rows.map((d) => {
    const b = d.mentee || d.mentor || {};
    return `<tr data-i="${responses.indexOf(d)}">
      <td>${fmtDate(d.createdAt)}</td>
      <td><span class="pill pill--${esc(d.role)}">${esc(d.role)}</span></td>
      <td>${esc([d.name?.rank, d.name?.first, d.name?.last].filter(Boolean).join(" "))}</td>
      <td>${esc(d.email || "")}</td>
      <td>${esc(b.afsc || b.afscTitle || "")}</td>
      <td>${esc(b.firstDutyLocation || b.dutyLocation || "")}</td></tr>`;
  }).join("");
  tb.querySelectorAll("tr").forEach((tr) =>
    tr.addEventListener("click", () => openDetail(responses[+tr.dataset.i])));
}
$("f-role").addEventListener("change", renderResponses);
$("f-search").addEventListener("input", renderResponses);

function openDetail(d) {
  $("detail-title").textContent =
    [d.name?.rank, d.name?.first, d.name?.last].filter(Boolean).join(" ") + " — " + d.role;
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
  $("detail").hidden = false;
}
$("detail-close").addEventListener("click", () => { $("detail").hidden = true; });
$("detail").addEventListener("click", (e) => { if (e.target === $("detail")) $("detail").hidden = true; });

/* ---------------- viewers (super only) ---------------- */
async function renderViewers() {
  const snap = await getDocs(collection(db, "dashboardUsers"));
  const tb = $("vtable").querySelector("tbody");
  tb.innerHTML = snap.docs.map((d) => {
    const v = d.data();
    return `<tr><td>${esc(d.id)}</td><td>${esc(v.access)}</td>
      <td>${fmtDate(v.addedAt)}</td>
      <td><button class="btn btn--danger btn--sm" data-del="${esc(d.id)}">Remove</button></td></tr>`;
  }).join("") || `<tr><td colspan="4" style="color:var(--muted)">No extra viewers yet.</td></tr>`;
  tb.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      await deleteDoc(doc(db, "dashboardUsers", b.dataset.del));
      renderViewers();
    }));
}
$("add-viewer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("v-email").value.trim().toLowerCase();
  if (!email) return;
  await setDoc(doc(db, "dashboardUsers", email), {
    access: $("v-access").value, addedBy: me.email, addedAt: serverTimestamp()
  });
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
    ["overview", "responses", "viewers"].forEach((p) =>
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
  if (canSeeResponses() && responses.length) {
    tableHtml = `<h2>Responses (${responses.length})</h2>
      <table><thead><tr><th>Submitted</th><th>Role</th><th>Name</th><th>Email</th>
      <th>AFSC</th><th>Location</th><th>Details</th></tr></thead><tbody>` +
      responses.map((d) => {
        const b = d.mentee || d.mentor || {};
        const det = d.mentee
          ? `${lbl(d.mentee.commissioningSource)} · commissions ${d.mentee.commissioningDateExpected} · goals: ${(d.mentee.goals || []).map(lbl).join(", ")}`
          : `${b.rankTimeInService || ""} · areas: ${(b.mentoringAreas || []).map(lbl).join(", ")} · capacity ${b.menteeCapacity || "—"}`;
        return `<tr><td>${fmtDate(d.createdAt)}</td><td>${esc(d.role)}</td>
          <td>${esc([d.name?.rank, d.name?.first, d.name?.last].filter(Boolean).join(" "))}</td>
          <td>${esc(d.email || "")}</td><td>${esc(b.afsc || b.afscTitle || "")}</td>
          <td>${esc(b.firstDutyLocation || b.dutyLocation || "")}</td><td>${esc(det)}</td></tr>`;
      }).join("") + "</tbody></table>";
  }
  r.innerHTML = `
    <div class="r-head">
      <div><div class="r-eyebrow">DAF CGOC · Mentorship Program</div>
        <h1>Program Report</h1></div>
      <div class="r-sub">Generated ${now.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })}
        · ${esc(me.email)}</div>
    </div>
    <div class="r-tiles">${tiles.innerHTML}</div>
    <h2>Program analytics</h2>
    <div class="r-charts">${charts.innerHTML}</div>
    ${tableHtml}
    <div class="r-foot">Department of the Air Force Company Grade Officers' Council ·
      Mentorship Program dashboard · For official council use — contains member PII, handle accordingly.</div>`;
  window.print();
});

/* ---------------- utils ---------------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtDate(ts) {
  if (!ts) return "—";
  const d = typeof ts === "string" ? new Date(ts) : (ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000));
  return isNaN(d) ? "—" : d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}
function monthName(m) {
  return new Date(m + "-15").toLocaleDateString("en-US", { month: "short" });
}
