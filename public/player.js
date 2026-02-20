const socket = io();

const targetSelect = document.getElementById("targetSelect");
const btnVote = document.getElementById("btnVote");
const header = document.getElementById("playerHeader");
const info = document.getElementById("playerInfo");

const params = new URLSearchParams(window.location.search);
const token = params.get("token") || "";

let st = null;

function nameOf(i) {
  return st?.names?.[i] || `Spieler ${i}`;
}

function isActive(i) {
  return i >= 1 && i <= 8 && !st?.eliminated?.[i];
}

function setText(el, text) {
  el.textContent = text;
}

function renderTargets() {
  targetSelect.innerHTML = "";

  if (!st?.ok) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Ungültiger Link";
    targetSelect.appendChild(opt);
    return;
  }

  const gold = st.protectedPlayer;

  for (let i = 1; i <= 8; i++) {
    if (!isActive(i)) continue;
    if (i === gold) continue;

    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = nameOf(i);
    targetSelect.appendChild(opt);
  }

  if (!targetSelect.options.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Keine wählbaren Spieler";
    targetSelect.appendChild(opt);
  }
}

function updateUI() {
  if (!st) return;

  if (!st.ok) {
    setText(header, "❌ Ungültiger Voting-Link");
    btnVote.disabled = true;
    setText(info, "Bitte den richtigen Link vom Gamemaster benutzen.");
    return;
  }

  setText(header, `Du bist: ${nameOf(st.voterId)}`);

  renderTargets();

  if (!st.voteActive) {
    btnVote.disabled = true;
    setText(info, "Voting ist aktuell nicht aktiv.");
    return;
  }

  if (st.alreadyVoted) {
    btnVote.disabled = true;
    setText(info, `✅ Du hast gewählt: ${nameOf(st.chosen)}`);
    return;
  }

  btnVote.disabled = !(targetSelect.value);
  setText(info, "Bitte wähle eine Person aus und klicke auf „Vote abschicken“.");
}

btnVote.onclick = () => {
  if (!st?.ok) return;
  if (!st.voteActive) return;
  if (st.alreadyVoted) return;

  const target = Number(targetSelect.value || 0);
  if (!target) return;

  socket.emit("castVote", { token, target });
};

targetSelect.onchange = () => {
  if (!st) return;
  if (!st.voteActive || st.alreadyVoted) return;
  btnVote.disabled = !(targetSelect.value);
};

socket.emit("playerHello", { token });

socket.on("playerState", (playerState) => {
  st = playerState;
  updateUI();
});

socket.on("voteAck", (res) => {
  if (!res) return;

  if (res.ok) {
    setText(info, "✅ Vote gespeichert!");
    socket.emit("playerHello", { token });
    return;
  }

  if (res.reason === "already_voted") {
    setText(info, `✅ Du hast bereits gewählt: ${nameOf(res.chosen)}`);
    socket.emit("playerHello", { token });
    return;
  }

  setText(info, "❌ Vote nicht möglich.");
  socket.emit("playerHello", { token });
});