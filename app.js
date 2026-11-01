(() => {
  "use strict";

  const GROUPS = ["Management", "Developer", "Tester", "Moderator"];
  const ROBLOX_GET_PROXY = "https://proxy.cors.dev/";
  const PRESENCE_ENDPOINT = "https://presence.roproxy.com/v1/presence/users";
  const PRESENCE_LABELS = {
    0: ["Offline", "offline"],
    1: ["Online", "online"],
    2: ["In Game", "ingame"],
    3: ["In Studio", "instudio"],
    4: ["Online", "online"]
  };

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value;
  }

  async function getRobloxJson(url) {
    const response = await fetch(ROBLOX_GET_PROXY + url, {
      method: "GET",
      headers: { "Accept": "application/json" },
      cache: "no-store"
    });
    if (!response.ok) throw new Error("Roblox request failed (" + response.status + ")");
    return response.json();
  }

  function renderGames() {
    const root = $("game-grid");
    if (!root || !window.SED_CONFIG || !Array.isArray(SED_CONFIG.games)) {
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
            <span class="muted" id="game-detail-${escapeHtml(game.key)}">Connecting to Roblox…</span>
            <span id="game-state-${escapeHtml(game.key)}">CONNECTING</span>
          </div>
        </article>`;
    }).join("");
  }

  function renderTeam() {
    const root = $("team-groups");
    const allAccounts = Array.isArray(window.SED_ACCOUNTS) ? SED_ACCOUNTS : [];
    const people = allAccounts.filter((account) =>
      account &&
      typeof account.username === "string" &&
      account.username.trim() &&
      GROUPS.includes(account.group) &&
      /^\d+$/.test(String(account.robloxId || ""))
    );

    setText("team-total", String(people.length));
    setText("team-online", "—");
    setText("team-ingame", "—");

    if (!root) return;
    if (!people.length) {
      root.innerHTML = '<div class="empty-team">No valid team members found. Check usernames, numeric Roblox IDs, and group names in <code>accounts.js</code>.</div>';
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
                  <div class="presence" id="presence-${escapeHtml(id)}"><i class="presence-dot offline"></i>Checking…</div>
                  <a class="member-profile" href="${profile}" target="_blank" rel="noopener" aria-label="Open ${escapeHtml(person.username)}'s Roblox profile">↗</a>
                </div>`;
            }).join("") : '<div class="empty-group">No members added yet.</div>'}
          </div>
        </section>`;
    }).join("");
  }

  const universeIds = new Map();

  async function updateOneGame(game) {
    const count = $("players-" + game.key);
    const detail = $("game-detail-" + game.key);
    const state = $("game-state-" + game.key);
    if (!count || !detail || !state) return;

    try {
      if (!game.placeId || !/^\d+$/.test(String(game.placeId))) {
        throw new Error("Missing or invalid Place ID");
      }

      let universeId = universeIds.get(game.placeId);
      if (!universeId) {
        const placeData = await getRobloxJson(
          "https://apis.roblox.com/universes/v1/places/" + encodeURIComponent(game.placeId) + "/universe"
        );
        universeId = placeData.universeId;
        if (!universeId) throw new Error("Could not resolve this Place ID");
        universeIds.set(game.placeId, universeId);
      }

      const gameData = await getRobloxJson(
        "https://games.roblox.com/v1/games?universeIds=" + encodeURIComponent(universeId)
      );
      const info = gameData.data && gameData.data[0];
      if (!info) throw new Error("Experience not found or unavailable");

      count.textContent = Number(info.playing ?? 0).toLocaleString();
      detail.textContent = "Live Roblox player count";
      state.textContent = "LIVE";
      state.style.color = "#d8f36a";
      return true;
    } catch (error) {
      count.textContent = "—";
      detail.textContent = error.message || "Could not load player count";
      state.textContent = "UNAVAILABLE";
      state.style.color = "#ffad8f";
      console.warn("SED Tracker game update failed:", game.name, error);
      return false;
    }
  }

  async function updateGames() {
    if (!window.SED_CONFIG || !Array.isArray(SED_CONFIG.games)) return;
    const results = await Promise.all(SED_CONFIG.games.map(updateOneGame));
    const successful = results.filter(Boolean).length;
    const now = new Date();
    setText("game-updated", "Updated " + now.toLocaleDateString() + " at " + now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    setText("overall-status", successful === results.length
      ? "Connected · Roblox game data is live"
      : successful > 0
        ? "Partially connected · Some game data unavailable"
        : "Roblox connection unavailable · Retrying automatically");
  }

  async function updatePresence() {
    const people = (Array.isArray(window.SED_ACCOUNTS) ? SED_ACCOUNTS : [])
      .filter((person) => person && /^\d+$/.test(String(person.robloxId || "")));
    if (!people.length) return;

    try {
      const response = await fetch(PRESENCE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ userIds: people.map((person) => Number(person.robloxId)) }),
        cache: "no-store"
      });
      if (!response.ok) throw new Error("Presence service returned " + response.status);
      const data = await response.json();
      const presences = new Map((data.userPresences || []).map((presence) => [String(presence.userId), presence]));

      let online = 0;
      let inGame = 0;
      for (const person of people) {
        const presence = presences.get(String(person.robloxId));
        const type = presence ? Number(presence.userPresenceType) : 0;
        const [label, className] = PRESENCE_LABELS[type] || ["Unavailable", "offline"];
        if (type !== 0 && presence) online++;
        if (type === 2) inGame++;
        const target = $("presence-" + person.robloxId);
        if (target) target.innerHTML = '<i class="presence-dot ' + className + '"></i>' + label;
      }
      setText("team-online", String(online));
      setText("team-ingame", String(inGame));
    } catch (error) {
      console.warn("SED Tracker presence update unavailable:", error);
      for (const person of people) {
        const target = $("presence-" + person.robloxId);
        if (target) target.innerHTML = '<i class="presence-dot offline"></i>Unavailable';
      }
      setText("team-online", "—");
      setText("team-ingame", "—");
    }
  }

  function start() {
    renderGames();
    renderTeam();
    if (!window.SED_CONFIG) {
      setText("overall-status", "Configuration error · config.js did not load");
      return;
    }

    updateGames();
    updatePresence();

    const refreshMs = Math.max(30000, Number(SED_CONFIG.refreshIntervalMs) || 30000);
    window.setInterval(updateGames, refreshMs);
    window.setInterval(updatePresence, refreshMs);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
