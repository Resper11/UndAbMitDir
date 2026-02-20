const socket = io();

function formatMs(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function makeFallbackSvg(text) {
  const safe = String(text || "AUSGESCHIEDEN")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0b2a1f"/>
        <stop offset="1" stop-color="#071b14"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <text x="50%" y="48%" dominant-baseline="middle" text-anchor="middle"
      font-family="Arial" font-weight="900" font-size="72" fill="rgba(255,255,255,0.85)">AUSGESCHIEDEN</text>
    <text x="50%" y="62%" dominant-baseline="middle" text-anchor="middle"
      font-family="Arial" font-weight="700" font-size="54" fill="rgba(255,255,255,0.75)">${safe}</text>
  </svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function setNames(names) {
  for (let i = 0; i <= 8; i++) {
    const el = document.getElementById(`name-${i}`);
    if (el && typeof names?.[i] === "string") el.textContent = names[i];
  }
}

function setTurnLabel(turn, names) {
  const el = document.getElementById("turn");
  if (!el) return;
  const label = names?.[turn] || `Spieler ${turn}`;
  el.textContent = `Dran: ${label}`;
}

function setActiveTurn(turn) {
  document.querySelectorAll(".tile").forEach((t) => t.classList.remove("active"));
  const tile = document.querySelector(`.tile[data-tile="${turn}"]`);
  if (tile) tile.classList.add("active");
}

function setGoldProtected(protectedPlayer) {
  document.querySelectorAll(".tile").forEach((t) => t.classList.remove("gold"));
  if (!protectedPlayer) return;
  const tile = document.querySelector(`.tile[data-tile="${protectedPlayer}"]`);
  if (tile) tile.classList.add("gold");
}

function setTimer(ms, running) {
  const el = document.getElementById("timer");
  if (!el) return;
  el.textContent = formatMs(ms);
  el.classList.toggle("running", !!running);
}

function applyVideoState(state) {
  const names = state.names || {};
  const eliminated = state.eliminated || {};
  const vdo = state.vdo || {};
  const outImg = state.outImg || {};

  for (let slot = 0; slot <= 8; slot++) {
    const iframe = document.getElementById(`vdo-${slot}`);
    const ph = document.getElementById(`ph-${slot}`);
    const img = document.getElementById(`out-${slot}`);
    const isPlayer = slot >= 1 && slot <= 8;

    const url = String(vdo?.[slot] || "").trim();

    if (ph) ph.style.display = url ? "none" : "flex";

    if (iframe) {
      const current = iframe.getAttribute("src") || "";
      if (url && current !== url) iframe.setAttribute("src", url);
      if (!url && current !== "") iframe.setAttribute("src", "");
      iframe.style.display = "block";
    }

    if (isPlayer && img) {
      const out = !!eliminated?.[slot];

      if (out) {
        if (iframe) iframe.style.display = "none";
        if (ph) ph.style.display = "none";

        const chosen = String(outImg?.[slot] || "").trim();
        const fallback = makeFallbackSvg(names?.[slot] || `Spieler ${slot}`);

        img.style.display = "block";
        img.src = chosen || fallback;
      } else {
        img.style.display = "none";
        img.removeAttribute("src");
      }
    }
  }
}

/* =========================
   Vote reveal per tile
========================= */
function clearAllVoteTags() {
  for (let i = 1; i <= 8; i++) {
    const el = document.getElementById(`voteTag-${i}`);
    if (!el) continue;
    el.classList.remove("show");
    el.textContent = "";
  }
}

function renderVoteTags(payload) {
  // payload: { names, revealedVotes }
  const names = payload?.names || {};
  const revealedVotes = payload?.revealedVotes || {};

  clearAllVoteTags();

  for (const [voterStr, target] of Object.entries(revealedVotes)) {
    const voter = Number(voterStr);
    const t = Number(target);
    if (!(voter >= 1 && voter <= 8)) continue;

    const voterName = names?.[voter] || `Spieler ${voter}`;
    const targetName = names?.[t] || `Spieler ${t}`;

    const el = document.getElementById(`voteTag-${voter}`);
    if (!el) continue;

    el.textContent = `VOTE → ${targetName}`;
    el.classList.add("show");
  }
}

/* =========================
   Sockets
========================= */

socket.on("state", (state) => {
  if (!state) return;

  setNames(state.names);

  if (typeof state.turn === "number") {
    setActiveTurn(state.turn);
    setTurnLabel(state.turn, state.names);
  }

  setGoldProtected(state.protectedPlayer);

  if (typeof state.timerMs === "number") {
    setTimer(state.timerMs, state.timerRunning);
  }

  applyVideoState(state);
});

socket.on("overlayVote", (payload) => {
  renderVoteTags(payload);
});