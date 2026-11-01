(() => {
  "use strict";

  const GROUPS = ["Management", "Developer", "Tester", "Moderator"];
  const PRESENCE_LABELS = {
    0: ["Offline", "offline"],
    1: ["Online", "online"],
    2: ["In Game", "ingame"],
    3: ["In Studio", "instudio"],
    4: ["Online", "online"]
  };

  const $ = (id) => document.getElementById(id);
  let refreshInProgress = false;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value;
  }

  function renderGames() {
    const root = $("game-grid");
    if (!root || typeof SED_CONFIG === "undefined" || !Array.isArray(SED_CONFIG.games)) {
      setText("overall-status", "Configuration error · Check config.js");
      return;
    }

    root.innerHTML = SED_CONFIG.games.map((game) => {
      const testing = game.key === "testing";
      return `
        <article class="game-card ${testing ? "testing-card" : ""}">
          <div class="game-card-top">
            <span class="game-tag ${testing ? "testing-tag" : ""}">${escapeHtml(game.label || "EXPERIENCE")}</span>
            <span class="game-pulse"></span>
          </div>
          <h3>${escapeHtml(game.name)}</h3>
          <p class="game-subtitle">${escapeHtml(game.subtitle || "")}</p>
          <div class="player-count"><strong id="players-${escapeHtml(game.key)}">—</strong><span>PLAYERS</span></div>
          <div class="game-footer">
            <span class="muted" id="game-detail-${escapeHtml(game.key)}">Connecting to tracker…</span>
            <span id="game-state-${escapeHtml(game.key)}">CONNECTING</span>
          </div>
        </article>`;
    }).join("");
  }

  function renderTeam() {
    const root = $("team-groups");
    const accounts = typeof SED_ACCOUNTS !== "undefined" && Array.isArray(SED_ACCOUNTS) ? SED_ACCOUNTS : [];
    const people = accounts.filter((person) =>
      person &&
      typeof person.username === "string" &&
      person.username.trim() &&
      GROUPS.includes(person.group) &&
      /^\d+$/.test(String(person.robloxId || ""))
    );

    setText("team-total", String(people.length));
    setText("team-online", "—");
    setText("team-ingame", "—");

    if (!root) return;
    if (!people.length) {
      root.innerHTML = '<div class="empty-team">No valid team members found. Check accounts.js.</div>';
      return;
    }

    root.innerHTML = GROUPS.map((group) => {
      const members = people.filter((person) => person.group === group);
      return `
        <section class="team-group">
          <div class="group-heading">
            <h3>${group.toUpperCase()}</h3>
            <span class="group-count">${members.length} MEMBER${members.length === 1 ? "" : "S"}</span>
          </div>
          <div class="member-list">
            ${members.length ? members.map((person) => {
              const id = String(person.robloxId);
              const profile = "https://www.roblox.com/users/" + encodeURIComponent(id) + "/profile";
              const avatar = "https://www.roblox.com/headshot-thumbnail/image?userId=" + encodeURIComponent(id) + "&width=150&height=150&format=png";
              const displayName = person.displayName || person.username;
              return `
                <div class="member" data-user-id="${escapeHtml(id)}">
                  <img class="avatar" src="${avatar}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
                  <div class="member-info">
                    <div class="member-name">${escapeHtml(displayName)}</div>
                    <div class="member-handle">@${escapeHtml(person.username)}</div>
                  </div>
                  <div class="presence" id="presence-${escapeHtml(id)}"><i class="presence-dot offline"></i>Connecting…</div>
                  <a class="member-profile" href="${profile}" target="_blank" rel="noopener" aria-label="Open ${escapeHtml(person.username)}'s Roblox profile">↗</a>
                </div>`;
            }).join("") : '<div class="empty-group">No members added yet.</div>'}
          </div>
        </section>`;
    }).join("");
  }

  async function fetchTrackerData() {
    const dataUrl = typeof SED_CONFIG !== "undefined" && SED_CONFIG.dataUrl;
    if (!dataUrl) throw new Error("Tracker data URL is missing from config.js");

    const response = await fetch(dataUrl, {
      method: "GET",
      headers: { "Accept": "application/json" },
      cache: "no-store"
    });

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("Tracker data file returned an invalid response");
    }

    if (!response.ok) {
      throw new Error(data && data.error ? data.error : "Tracker data request failed (" + response.status + ")");
    }
    if (!data || typeof data !== "object") throw new Error("Tracker data file returned no data");
    return data;
  }

  function updateGameCard(game, record) {
    const count = $("players-" + game.key);
    const detail = $("game-detail-" + game.key);
    const state = $("game-state-" + game.key);
    if (!count || !detail || !state) return record && record.status === "ok";

    if (record && record.status === "ok" && Number.isFinite(Number(record.playing))) {
      count.textContent = Number(record.playing).toLocaleString();
      detail.textContent = record.stale ? "Last successful player count · " + (record.error || "refresh pending") : "Live Roblox player count";
      state.textContent = record.stale ? "STALE" : "LIVE";
      state.style.color = record.stale ? "#ffcf70" : "#d8f36a";
      return true;
    }

    count.textContent = "—";
    detail.textContent = record && record.error ? record.error : "Player count unavailable";
    state.textContent = "UNAVAILABLE";
    state.style.color = "#ffad8f";
    return false;
  }

  function updateTeamPresence(presenceData) {
    const accounts = typeof SED_ACCOUNTS !== "undefined" && Array.isArray(SED_ACCOUNTS) ? SED_ACCOUNTS : [];
    const people = accounts.filter((person) => person && /^\d+$/.test(String(person.robloxId || "")));
    const users = presenceData && presenceData.users ? presenceData.users : {};
    let online = 0;
    let inGame = 0;

    for (const person of people) {
      const id = String(person.robloxId);
      const record = users[id];
      const type = record && Number.isFinite(Number(record.type)) ? Number(record.type) : null;
      const [label, className] = type === null
        ? ["Unavailable", "offline"]
        : (PRESENCE_LABELS[type] || ["Unavailable", "offline"]);

      if (type !== null && type !== 0) online++;
      if (type === 2) inGame++;

      const target = $("presence-" + id);
      if (target) {
        target.innerHTML = '<i class="presence-dot ' + className + '"></i>' + label;
      }
    }

    if (presenceData && presenceData.status === "ok") {
      setText("team-online", String(online));
      setText("team-ingame", String(inGame));
    } else {
      setText("team-online", "—");
      setText("team-ingame", "—");
    }
  }

  function formatUpdatedAt(value) {
    if (!value) return "Update time unavailable";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Update time unavailable";
    return "Updated " + date.toLocaleDateString() + " at " +
      date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  async function refresh() {
    if (refreshInProgress) return;
    refreshInProgress = true;

    try {
      const data = await fetchTrackerData();
      let successfulGames = 0;
      const games = typeof SED_CONFIG !== "undefined" && Array.isArray(SED_CONFIG.games) ? SED_CONFIG.games : [];

      for (const game of games) {
        if (updateGameCard(game, data.games && data.games[game.key])) successfulGames++;
      }

      updateTeamPresence(data.presence);
      setText("game-updated", formatUpdatedAt(data.updatedAt));

      const presenceOk = data.presence && data.presence.status === "ok";
      const allGamesOk = successfulGames === games.length;
      const anyOk = successfulGames > 0 || presenceOk;

      if (data.stale) {
        setText("overall-status", "Connected · Showing last successful Roblox update");
      } else if (allGamesOk && presenceOk) {
        setText("overall-status", "Connected · Roblox game and team data is live");
      } else if (anyOk) {
        setText("overall-status", "Partially connected · Some Roblox data is unavailable");
      } else {
        setText("overall-status", "Tracker connected · Roblox data temporarily unavailable");
      }

      if (data.warning) console.warn("SED Tracker API:", data.warning);
      if (data.presence && data.presence.error) console.warn("Presence:", data.presence.error);
      for (const key of ["main", "testing"]) {
        const record = data.games && data.games[key];
        if (record && record.error) console.warn("Game data (" + key + "):", record.error);
      }
    } catch (error) {
      console.error("SED Tracker data connection failed:", error);
      setText("overall-status", "Tracker data connection failed · " + (error.message || "Retrying"));
      setText("game-updated", "Unable to retrieve tracker data");

      const games = typeof SED_CONFIG !== "undefined" && Array.isArray(SED_CONFIG.games) ? SED_CONFIG.games : [];
      for (const game of games) updateGameCard(game, null);

      const accounts = typeof SED_ACCOUNTS !== "undefined" && Array.isArray(SED_ACCOUNTS) ? SED_ACCOUNTS : [];
      for (const person of accounts) {
        const target = $("presence-" + person.robloxId);
        if (target) target.innerHTML = '<i class="presence-dot offline"></i>Unavailable';
      }
      setText("team-online", "—");
      setText("team-ingame", "—");
    } finally {
      refreshInProgress = false;
    }
  }

  function start() {
    renderGames();
    renderTeam();

    if (typeof SED_CONFIG === "undefined" || !SED_CONFIG.dataUrl) {
      setText("overall-status", "Configuration error · Tracker data URL missing");
      return;
    }

    refresh();
    const refreshMs = Math.max(30000, Number(SED_CONFIG.refreshIntervalMs) || 30000);
    window.setInterval(refresh, refreshMs);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();