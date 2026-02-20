const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

/* =========================
   Helpers
========================= */

function makeStats() {
  const s = {};
  for (let i = 1; i <= 8; i++) s[i] = { right: 0, wrong: 0 };
  return s;
}

function makeEliminated() {
  const e = {};
  for (let i = 1; i <= 8; i++) e[i] = false;
  return e;
}

function makeNames() {
  const n = {};
  for (let i = 1; i <= 8; i++) n[i] = `Spieler ${i}`;
  n[0] = "Moderator";
  return n;
}

function makeVdoLinks() {
  const v = {};
  for (let i = 0; i <= 8; i++) v[i] = "";
  return v;
}

function makeOutImages() {
  const o = {};
  for (let i = 1; i <= 8; i++) o[i] = "";
  return o;
}

function listOutImages() {
  const dir = path.join(__dirname, "public", "out");
  try {
    const files = fs.readdirSync(dir);
    return files
      .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
      .map((f) => "/out/" + f);
  } catch {
    return [];
  }
}

function isValidPlayer(n) {
  return Number.isInteger(n) && n >= 1 && n <= 8;
}
function isValidSlot(n) {
  return Number.isInteger(n) && n >= 0 && n <= 8;
}

function newToken() {
  return crypto.randomBytes(12).toString("hex");
}

function makePlayerTokens() {
  const t = {};
  for (let i = 1; i <= 8; i++) t[i] = newToken();
  return t;
}

function tokenToVoterId(token) {
  if (!token) return null;
  for (let i = 1; i <= 8; i++) {
    if (state.playerTokens[i] === token) return i;
  }
  return null;
}

/* =========================
   State
========================= */

const state = {
  // Turn & Timer
  turn: 1,
  timerMs: 5 * 60 * 1000,
  timerRunning: false,

  // Game data
  stats: makeStats(),
  eliminated: makeEliminated(),
  names: makeNames(),

  // Video + Out images
  vdo: makeVdoLinks(),
  outImg: makeOutImages(),

  // Voting
  voteActive: false,
  protectedPlayer: null,          // Gold
  playerTokens: makePlayerTokens(),// unique links
  votesByToken: {},               // { token: targetPlayer } (secret base)
  revealedVotes: {},              // { voterId: targetPlayer } (ONLY shown in overlay)
};

/* =========================
   Timer
========================= */
let interval = null;
let lastTick = Date.now();

function startTimer() {
  if (state.timerRunning) return;
  if (state.timerMs <= 0) return;

  state.timerRunning = true;
  lastTick = Date.now();

  if (interval) clearInterval(interval);
  interval = setInterval(() => {
    const now = Date.now();
    const delta = now - lastTick;
    lastTick = now;

    state.timerMs = Math.max(0, state.timerMs - delta);

    if (state.timerMs <= 0) {
      state.timerMs = 0;
      state.timerRunning = false;
      clearInterval(interval);
      interval = null;
    }

    io.emit("state", state);
    io.emit("overlayVote", makeOverlayVotePayload());
  }, 200);
}

function pauseTimer() {
  state.timerRunning = false;
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}

function setTimerMs(ms) {
  state.timerMs = Math.max(0, Number(ms) || 0);
}

/* =========================
   Turn / Answer / Eliminated
========================= */

function findNextActive(fromTurn) {
  for (let step = 1; step <= 8; step++) {
    const candidate = ((fromTurn - 1 + step) % 8) + 1;
    if (!state.eliminated[candidate]) return candidate;
  }
  return fromTurn;
}

function setTurn(turn) {
  const t = Number(turn);
  if (!isValidPlayer(t)) return false;
  if (state.eliminated[t]) return false;
  state.turn = t;
  return true;
}

function markAnswer(type) {
  const t = state.turn;
  if (!isValidPlayer(t)) return;

  if (type === "right") state.stats[t].right += 1;
  if (type === "wrong") state.stats[t].wrong += 1;

  state.turn = findNextActive(t);
}

function setEliminated(player, eliminated) {
  const p = Number(player);
  if (!isValidPlayer(p)) return false;

  state.eliminated[p] = !!eliminated;

  if (state.eliminated[state.turn]) {
    state.turn = findNextActive(state.turn);
  }

  if (state.protectedPlayer === p && state.eliminated[p]) {
    state.protectedPlayer = null;
  }

  cleanupVotesAndReveals();
  return true;
}

function setPlayerName(player, name) {
  const p = Number(player);
  if (!isValidSlot(p)) return false;

  let clean = String(name ?? "").trim().replace(/\s+/g, " ");
  if (clean.length === 0) clean = p === 0 ? "Moderator" : `Spieler ${p}`;
  if (clean.length > 24) clean = clean.slice(0, 24);

  state.names[p] = clean;
  return true;
}

function setVdoLink(slot, url) {
  const s = Number(slot);
  if (!isValidSlot(s)) return false;
  let clean = String(url ?? "").trim();
  if (clean.length > 400) clean = clean.slice(0, 400);
  state.vdo[s] = clean;
  return true;
}

function setOutImage(player, pathStr) {
  const p = Number(player);
  if (!isValidPlayer(p)) return false;
  let clean = String(pathStr ?? "").trim();
  if (clean.length > 400) clean = clean.slice(0, 400);
  state.outImg[p] = clean;
  return true;
}

/* =========================
   Voting Logic
========================= */

function getTopScorerActive() {
  let best = null;
  let bestRight = -1;
  for (let i = 1; i <= 8; i++) {
    if (state.eliminated[i]) continue;
    const r = state.stats[i].right || 0;
    if (r > bestRight) {
      bestRight = r;
      best = i;
    }
  }
  return best;
}

function setProtectedPlayer(playerOrNull) {
  if (playerOrNull === null) {
    state.protectedPlayer = null;
    cleanupVotesAndReveals();
    return true;
  }
  const p = Number(playerOrNull);
  if (!isValidPlayer(p)) return false;
  if (state.eliminated[p]) return false;

  state.protectedPlayer = p;
  cleanupVotesAndReveals();
  return true;
}

function startVote() {
  state.voteActive = true;

  if (!state.protectedPlayer || state.eliminated[state.protectedPlayer]) {
    state.protectedPlayer = getTopScorerActive();
  }

  state.votesByToken = {};
  state.revealedVotes = {}; // reset reveals each voting round
}

function endVote() {
  state.voteActive = false;
}

/** Convert votesByToken -> votesByVoterId */
function getVotesByVoter() {
  const map = {};
  for (const [token, target] of Object.entries(state.votesByToken || {})) {
    const voterId = tokenToVoterId(token);
    const t = Number(target);
    if (!voterId) continue;
    if (!isValidPlayer(t)) continue;
    map[voterId] = t;
  }
  return map;
}

function getVoteCounts() {
  const counts = {};
  for (let i = 1; i <= 8; i++) counts[i] = 0;
  for (const t of Object.values(state.votesByToken || {})) {
    const p = Number(t);
    if (isValidPlayer(p)) counts[p] += 1;
  }
  return counts;
}

function cleanupVotesAndReveals() {
  // remove invalid votes
  const cleanedVotes = {};
  for (const [token, target] of Object.entries(state.votesByToken || {})) {
    const voterId = tokenToVoterId(token);
    const t = Number(target);

    if (!voterId) continue;
    if (state.eliminated[voterId]) continue;
    if (!isValidPlayer(t)) continue;
    if (state.eliminated[t]) continue;
    if (t === state.protectedPlayer) continue;

    cleanedVotes[token] = t;
  }
  state.votesByToken = cleanedVotes;

  // remove invalid reveals
  const cleanedReveals = {};
  for (const [voterStr, target] of Object.entries(state.revealedVotes || {})) {
    const voterId = Number(voterStr);
    const t = Number(target);

    if (!isValidPlayer(voterId)) continue;
    if (state.eliminated[voterId]) continue;
    if (!isValidPlayer(t)) continue;
    if (state.eliminated[t]) continue;
    if (t === state.protectedPlayer) continue;

    cleanedReveals[voterId] = t;
  }
  state.revealedVotes = cleanedReveals;
}

function castVoteByToken(token, target) {
  if (!state.voteActive) return { ok: false, reason: "vote_not_active" };

  const voterId = tokenToVoterId(token);
  if (!voterId) return { ok: false, reason: "invalid_link" };
  if (state.eliminated[voterId]) return { ok: false, reason: "voter_out" };

  const t = Number(target);
  if (!isValidPlayer(t)) return { ok: false, reason: "invalid_target" };
  if (state.eliminated[t]) return { ok: false, reason: "target_out" };
  if (t === state.protectedPlayer) return { ok: false, reason: "protected" };

  if (state.votesByToken[token]) {
    return { ok: false, reason: "already_voted", chosen: state.votesByToken[token] };
  }

  state.votesByToken[token] = t;
  cleanupVotesAndReveals();
  return { ok: true, chosen: t };
}

/* =========================
   Reveal Logic
========================= */

function revealVote(voterId) {
  const v = Number(voterId);
  if (!isValidPlayer(v)) return false;

  const votesByVoter = getVotesByVoter();
  const target = votesByVoter[v];
  if (!target) return false; // no vote from this voter

  if (state.eliminated[v]) return false;
  if (state.eliminated[target]) return false;
  if (target === state.protectedPlayer) return false;

  state.revealedVotes[v] = target;
  cleanupVotesAndReveals();
  return true;
}

function hideReveal(voterId) {
  const v = Number(voterId);
  if (!isValidPlayer(v)) return false;
  delete state.revealedVotes[v];
  return true;
}

function clearReveals() {
  state.revealedVotes = {};
}

/* =========================
   Payloads
========================= */

function makeOverlayVotePayload() {
  return {
    voteActive: state.voteActive,
    names: state.names,
    revealedVotes: state.revealedVotes, // ONLY revealed ones
  };
}

function makePlayerState(token) {
  const voterId = tokenToVoterId(token);
  return {
    ok: !!voterId,
    voterId: voterId,
    voteActive: state.voteActive,
    names: state.names,
    eliminated: state.eliminated,
    protectedPlayer: state.protectedPlayer,
    alreadyVoted: !!state.votesByToken[token],
    chosen: state.votesByToken[token] || null,
  };
}

/* =========================
   Socket.IO
========================= */

io.on("connection", (socket) => {
  socket.emit("state", state);
  socket.emit("outImageList", listOutImages());
  socket.emit("voteCounts", getVoteCounts());
  socket.emit("overlayVote", makeOverlayVotePayload());

  // ----- Turn -----
  socket.on("setTurn", (turn) => {
    if (setTurn(turn)) io.emit("state", state);
  });

  // ----- Timer -----
  socket.on("timerPreset", (ms) => {
    pauseTimer();
    setTimerMs(ms);
    io.emit("state", state);
  });
  socket.on("timerStart", () => {
    startTimer();
    io.emit("state", state);
  });
  socket.on("timerPause", () => {
    pauseTimer();
    io.emit("state", state);
  });
  socket.on("timerReset", () => {
    pauseTimer();
    setTimerMs(5 * 60 * 1000);
    io.emit("state", state);
  });

  // ----- Answers -----
  socket.on("markAnswer", (payload) => {
    if (!payload || (payload.type !== "right" && payload.type !== "wrong")) return;
    markAnswer(payload.type);
    io.emit("state", state);
  });

  // ----- Resets -----
  socket.on("resetStats", () => {
    state.stats = makeStats();
    io.emit("state", state);
  });

  socket.on("resetEliminated", () => {
    state.eliminated = makeEliminated();
    state.turn = 1;
    state.protectedPlayer = null;
    cleanupVotesAndReveals();
    io.emit("state", state);
    io.emit("voteCounts", getVoteCounts());
    io.emit("overlayVote", makeOverlayVotePayload());
  });

  // ----- Eliminated -----
  socket.on("setEliminated", (payload) => {
    if (!payload) return;
    if (setEliminated(payload.player, payload.eliminated)) {
      io.emit("state", state);
      io.emit("voteCounts", getVoteCounts());
      io.emit("overlayVote", makeOverlayVotePayload());
    }
  });

  // ----- Names -----
  socket.on("setName", (payload) => {
    if (!payload) return;
    if (setPlayerName(payload.player, payload.name)) {
      io.emit("state", state);
      io.emit("overlayVote", makeOverlayVotePayload());
    }
  });

  // ----- VDO -----
  socket.on("setVdo", (payload) => {
    if (!payload) return;
    if (setVdoLink(payload.slot, payload.url)) io.emit("state", state);
  });

  // ----- Out Images -----
  socket.on("setOutImg", (payload) => {
    if (!payload) return;
    if (setOutImage(payload.player, payload.path)) io.emit("state", state);
  });

  // ----- Voting GM -----
  socket.on("startVote", () => {
    startVote();
    io.emit("state", state);
    io.emit("voteCounts", getVoteCounts());
    io.emit("overlayVote", makeOverlayVotePayload());
  });

  socket.on("endVote", () => {
    endVote();
    io.emit("state", state);
    io.emit("voteCounts", getVoteCounts());
    io.emit("overlayVote", makeOverlayVotePayload());
  });

  socket.on("clearVotes", () => {
    state.votesByToken = {};
    clearReveals();
    io.emit("voteCounts", getVoteCounts());
    io.emit("overlayVote", makeOverlayVotePayload());
  });

  socket.on("setProtected", (playerOrNull) => {
    const val = playerOrNull === null ? null : Number(playerOrNull);
    if (setProtectedPlayer(val)) {
      io.emit("state", state);
      io.emit("voteCounts", getVoteCounts());
      io.emit("overlayVote", makeOverlayVotePayload());
    }
  });

  socket.on("getPlayerLinks", () => {
    socket.emit("playerLinks", state.playerTokens);
  });

  socket.on("getSecretVotes", () => {
    // GM-only in practice (not authenticated yet)
    socket.emit("secretVotes", {
      voteActive: state.voteActive,
      votesByVoter: getVotesByVoter(),
      revealedVotes: state.revealedVotes,
      protectedPlayer: state.protectedPlayer,
      eliminated: state.eliminated,
      names: state.names,
    });
  });

  // Reveal controls (GM)
  socket.on("revealVote", (voterId) => {
    if (revealVote(voterId)) {
      io.emit("overlayVote", makeOverlayVotePayload());
      io.emit("state", state);
      io.emit("secretVotes", {
        voteActive: state.voteActive,
        votesByVoter: getVotesByVoter(),
        revealedVotes: state.revealedVotes,
        protectedPlayer: state.protectedPlayer,
        eliminated: state.eliminated,
        names: state.names,
      });
    }
  });

  socket.on("hideReveal", (voterId) => {
    if (hideReveal(voterId)) {
      io.emit("overlayVote", makeOverlayVotePayload());
      io.emit("state", state);
      io.emit("secretVotes", {
        voteActive: state.voteActive,
        votesByVoter: getVotesByVoter(),
        revealedVotes: state.revealedVotes,
        protectedPlayer: state.protectedPlayer,
        eliminated: state.eliminated,
        names: state.names,
      });
    }
  });

  socket.on("clearReveals", () => {
    clearReveals();
    io.emit("overlayVote", makeOverlayVotePayload());
    io.emit("secretVotes", {
      voteActive: state.voteActive,
      votesByVoter: getVotesByVoter(),
      revealedVotes: state.revealedVotes,
      protectedPlayer: state.protectedPlayer,
      eliminated: state.eliminated,
      names: state.names,
    });
  });

  // ----- Voting Player -----
  socket.on("playerHello", (payload) => {
    const token = payload?.token || "";
    socket.emit("playerState", makePlayerState(token));
  });

  socket.on("castVote", (payload) => {
    const token = payload?.token || "";
    const target = payload?.target;

    const res = castVoteByToken(token, target);

    socket.emit("voteAck", res);
    socket.emit("playerState", makePlayerState(token));

    io.emit("voteCounts", getVoteCounts());
  });
});

server.listen(3000, () => {
  console.log("Overlay: http://localhost:3000/overlay.html");
  console.log("GM:      http://localhost:3000/gm.html");
});