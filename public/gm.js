const socket = io();

let latestState = null;
let outImageList = [];
let latestVoteCounts = null;
let playerLinks = null;

let secret = null; // { votesByVoter, revealedVotes, ... }

function formatMs(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function nameOf(slot) {
  const n = latestState?.names?.[slot];
  return typeof n === "string" ? n : (slot === 0 ? "Moderator" : `Spieler ${slot}`);
}

/* =========================
   Render: Names
========================= */
function renderNameInputs(names) {
  const grid = document.getElementById("nameGrid");
  grid.innerHTML = "";

  for (let i = 0; i <= 8; i++) {
    const row = document.createElement("div");
    row.className = "gmNameRow";

    const label = i === 0 ? "Moderator" : `Slot ${i}`;
    const val = (names?.[i] ?? (i === 0 ? "Moderator" : `Spieler ${i}`)).replace(/"/g, "&quot;");

    row.innerHTML = `
      <label>${label}</label>
      <input type="text" maxlength="24" value="${val}" data-player="${i}" />
      <button class="gmCtl gmMini" data-save="${i}">Speichern</button>
    `;
    grid.appendChild(row);
  }

  grid.querySelectorAll("button[data-save]").forEach((btn) => {
    btn.onclick = () => {
      const p = Number(btn.dataset.save);
      const inp = grid.querySelector(`input[data-player="${p}"]`);
      socket.emit("setName", { player: p, name: inp ? inp.value : "" });
    };
  });

  grid.querySelectorAll("input").forEach((inp) => {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const p = Number(inp.dataset.player);
        socket.emit("setName", { player: p, name: inp.value });
      }
    });
  });
}

/* =========================
   Render: VDO
========================= */
function renderVdoInputs(vdo) {
  const grid = document.getElementById("vdoGrid");
  grid.innerHTML = "";

  const slots = [0,1,2,3,4,5,6,7,8];
  for (const s of slots) {
    const row = document.createElement("div");
    row.className = "gmLinkRow";

    const label = s === 0 ? "Moderator" : nameOf(s);
    const val = (vdo?.[s] ?? "").replace(/"/g, "&quot;");

    row.innerHTML = `
      <label>${label}</label>
      <input type="text" value="${val}" placeholder="https://vdo.ninja/?view=..." data-slot="${s}" />
      <button class="gmCtl gmMini" data-savevdo="${s}">Speichern</button>
    `;
    grid.appendChild(row);
  }

  grid.querySelectorAll("button[data-savevdo]").forEach((btn) => {
    btn.onclick = () => {
      const s = Number(btn.dataset.savevdo);
      const inp = grid.querySelector(`input[data-slot="${s}"]`);
      socket.emit("setVdo", { slot: s, url: inp ? inp.value : "" });
    };
  });

  grid.querySelectorAll("input[data-slot]").forEach((inp) => {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const s = Number(inp.dataset.slot);
        socket.emit("setVdo", { slot: s, url: inp.value });
      }
    });
  });
}

/* =========================
   Render: Turn + Timer
========================= */
function renderTurnButtons(eliminated) {
  document.querySelectorAll(".gmBtn").forEach((btn) => {
    const t = Number(btn.dataset.turn);
    const out = !!eliminated?.[t];
    btn.disabled = out;
    btn.classList.toggle("isOut", out);
    btn.textContent = nameOf(t);
  });
}

function renderTurnLabel(turn) {
  document.getElementById("gmTurnText").textContent = nameOf(turn);
  document.getElementById("gmLastAction").textContent =
    `Bewertung zählt für: ${nameOf(turn)} (danach auto-next)`;
}

function renderTimer(ms, running) {
  document.getElementById("gmTimerText").textContent = formatMs(ms);
  document.getElementById("gmTimerStatus").textContent = running ? "läuft" : "pausiert";
}

/* =========================
   Render: Stats Table
========================= */
function renderStatsTable(stats, eliminated, outImg, turn) {
  const body = document.getElementById("statsBody");
  body.innerHTML = "";

  for (let i = 1; i <= 8; i++) {
    const right = stats?.[i]?.right ?? 0;
    const wrong = stats?.[i]?.wrong ?? 0;
    const total = right + wrong;
    const isOut = !!eliminated?.[i];

    const tr = document.createElement("tr");
    if (i === turn) tr.classList.add("isTurn");
    if (isOut) tr.classList.add("isOutRow");

    const options = outImageList
      .map((p) => `<option value="${p}" ${outImg?.[i] === p ? "selected" : ""}>${p}</option>`)
      .join("");

    tr.innerHTML = `
      <td>${nameOf(i)}</td>
      <td>${right}</td>
      <td>${wrong}</td>
      <td>${total}</td>
      <td>
        <button class="gmSmallBtn ${isOut ? "out" : "in"}" data-toggleout="${i}">
          ${isOut ? "Ausgeschieden" : "Aktiv"}
        </button>
      </td>
      <td>
        <select class="gmSelect" data-outimg="${i}">
          <option value="">-- kein Bild --</option>
          ${options}
        </select>
      </td>
    `;
    body.appendChild(tr);
  }

  body.querySelectorAll("button[data-toggleout]").forEach((btn) => {
    btn.onclick = () => {
      const p = Number(btn.dataset.toggleout);
      socket.emit("setEliminated", { player: p, eliminated: !latestState.eliminated[p] });
    };
  });

  body.querySelectorAll("select[data-outimg]").forEach((sel) => {
    sel.onchange = () => {
      const p = Number(sel.dataset.outimg);
      socket.emit("setOutImg", { player: p, path: sel.value });
    };
  });
}

/* =========================
   Voting UI
========================= */
function renderGoldButtons(state) {
  const wrap = document.getElementById("goldButtons");
  wrap.innerHTML = "";

  for (let i = 1; i <= 8; i++) {
    if (state.eliminated[i]) continue;

    const b = document.createElement("button");
    b.className = "gmGoldBtn";
    b.textContent = nameOf(i);
    if (state.protectedPlayer === i) b.classList.add("isGold");

    b.onclick = () => socket.emit("setProtected", i);
    wrap.appendChild(b);
  }
}

function renderVoteInfo(state) {
  const el = document.getElementById("voteInfo");
  el.textContent = `Voting: ${state.voteActive ? "AKTIV" : "aus"} | Gold: ${state.protectedPlayer ? nameOf(state.protectedPlayer) : "-"}`;
}

function renderVoteCounts(counts) {
  const box = document.getElementById("voteCounts");
  if (!latestState) return;
  if (!counts) counts = {};

  const lines = [];
  for (let i = 1; i <= 8; i++) {
    if (latestState.eliminated[i]) continue;
    if (latestState.protectedPlayer === i) continue;
    lines.push(`${nameOf(i)}: ${counts[i] || 0}`);
  }

  box.textContent = lines.length ? ("Stimmen (Counts): " + lines.join(" | ")) : "Stimmen: -";
}

/* =========================
   Player Links
========================= */
function renderPlayerLinks() {
  const box = document.getElementById("playerLinks");
  box.innerHTML = "";

  if (!playerLinks) {
    box.textContent = "Lade Links…";
    return;
  }

  const origin = window.location.origin;

  for (let i = 1; i <= 8; i++) {
    const token = playerLinks[i];
    const url = `${origin}/player.html?token=${token}`;

    const row = document.createElement("div");
    row.className = "gmLinkLine";
    row.innerHTML = `
      <div class="gmLinkLabel">${nameOf(i)}</div>
      <input class="gmLinkInput" readonly value="${url}" />
    `;
    box.appendChild(row);
  }
}

/* =========================
   Secret Votes + Reveal UI
========================= */
function renderSecretVotes() {
  const box = document.getElementById("secretVotesBox");
  if (!box) return;

  if (!secret || !latestState) {
    box.textContent = "Lade…";
    return;
  }

  const votesByVoter = secret.votesByVoter || {};
  const revealedVotes = secret.revealedVotes || {};
  const eliminated = secret.eliminated || {};

  const rows = [];

  for (let voter = 1; voter <= 8; voter++) {
    if (eliminated[voter]) continue;

    const target = votesByVoter[voter] || null;
    const revealed = !!revealedVotes[voter];

    if (!target) {
      rows.push(`
        <div class="gmSecretRow">
          <div class="gmSecretLeft">${nameOf(voter)}</div>
          <div class="gmSecretMid">hat noch nicht gevotet</div>
          <div class="gmSecretRight"></div>
        </div>
      `);
      continue;
    }

    const targetName = nameOf(target);

    rows.push(`
      <div class="gmSecretRow">
        <div class="gmSecretLeft">${nameOf(voter)}</div>
        <div class="gmSecretMid">→ <strong>${targetName}</strong></div>
        <div class="gmSecretRight">
          ${revealed
            ? `<button class="gmCtl gmMini gmDanger" data-hide="${voter}">Hide</button>`
            : `<button class="gmCtl gmMini" data-reveal="${voter}">Reveal</button>`
          }
        </div>
      </div>
    `);
  }

  box.innerHTML = rows.join("") || "Keine Daten.";

  box.querySelectorAll("button[data-reveal]").forEach((b) => {
    b.onclick = () => socket.emit("revealVote", Number(b.dataset.reveal));
  });
  box.querySelectorAll("button[data-hide]").forEach((b) => {
    b.onclick = () => socket.emit("hideReveal", Number(b.dataset.hide));
  });
}

/* =========================
   Events
========================= */
// Turn buttons
document.querySelectorAll(".gmBtn").forEach((btn) => {
  btn.onclick = () => socket.emit("setTurn", Number(btn.dataset.turn));
});

// Answers
document.getElementById("btnRight").onclick = () => socket.emit("markAnswer", { type: "right" });
document.getElementById("btnWrong").onclick = () => socket.emit("markAnswer", { type: "wrong" });

// Timer
document.querySelectorAll(".gmPreset").forEach((b) => {
  b.onclick = () => socket.emit("timerPreset", Number(b.dataset.ms));
});
document.getElementById("btnStart").onclick = () => socket.emit("timerStart");
document.getElementById("btnPause").onclick = () => socket.emit("timerPause");
document.getElementById("btnReset").onclick = () => socket.emit("timerReset");

// Resets
document.getElementById("btnResetStats").onclick = () => socket.emit("resetStats");
document.getElementById("btnResetEliminated").onclick = () => socket.emit("resetEliminated");

// Voting
document.getElementById("btnStartVote").onclick = () => {
  socket.emit("startVote");
  socket.emit("getSecretVotes");
};
document.getElementById("btnEndVote").onclick = () => {
  socket.emit("endVote");
  socket.emit("getSecretVotes");
};
document.getElementById("btnClearVotes").onclick = () => {
  socket.emit("clearVotes");
  socket.emit("getSecretVotes");
};
document.getElementById("btnClearGold").onclick = () => {
  socket.emit("setProtected", null);
  socket.emit("getSecretVotes");
};

// Reveal controls
document.getElementById("btnRefreshSecret").onclick = () => socket.emit("getSecretVotes");
document.getElementById("btnClearReveals").onclick = () => socket.emit("clearReveals");

/* =========================
   Socket receives
========================= */

socket.on("outImageList", (list) => {
  outImageList = Array.isArray(list) ? list : [];
  if (latestState) renderStatsTable(latestState.stats, latestState.eliminated, latestState.outImg, latestState.turn);
});

socket.on("playerLinks", (tokens) => {
  playerLinks = tokens || null;
  renderPlayerLinks();
});

socket.on("voteCounts", (counts) => {
  latestVoteCounts = counts || null;
  renderVoteCounts(latestVoteCounts);
});

socket.on("secretVotes", (payload) => {
  secret = payload || null;
  renderSecretVotes();
});

socket.on("state", (state) => {
  latestState = state;

  renderTurnButtons(state.eliminated);
  renderTurnLabel(state.turn);
  renderTimer(state.timerMs, state.timerRunning);

  renderNameInputs(state.names);
  renderVdoInputs(state.vdo);
  renderStatsTable(state.stats, state.eliminated, state.outImg, state.turn);

  renderGoldButtons(state);
  renderVoteInfo(state);
  renderVoteCounts(latestVoteCounts);

  renderPlayerLinks();
  socket.emit("getSecretVotes"); // keep secret view fresh
});

// Ask server for tokens once
socket.emit("getPlayerLinks");
socket.emit("getSecretVotes");