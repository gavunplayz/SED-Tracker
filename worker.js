// Small Enclosed Driving Tracker - Cloudflare Worker
// Uses public Roblox endpoints only. No credentials or private account data.

const PLACE_IDS = {
  main: "16382363034",
  testing: "118413215449409"
};

const TEAM_USER_IDS = [
  "5571894841",
  "9891891463",
  "1696051019",
  "2758237932"
];

const GAME_NAMES = {
  main: "Main game",
  testing: "Testing game"
};

const PRESENCE_NAMES = {
  0: "Offline",
  1: "Online",
  2: "In Game",
  3: "In Studio"
};

let cachedPayload = null;
let cachedAt = 0;
let pendingUpdate = null;
const universeIds = Object.create(null);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8"
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, ...extraHeaders }
  });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Accept": "application/json",
      "User-Agent": "SED-Tracker/1.1",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const error = new Error("HTTP " + response.status + " from " + new URL(url).hostname);
    error.status = response.status;
    error.host = new URL(url).hostname;
    error.retryAfter = response.headers.get("Retry-After") || null;
    throw error;
  }

  return response.json();
}

// Try Roblox's official endpoint first, then its compatible public mirror.
// This specifically handles rate limits affecting Cloudflare's outbound IP.
async function requestJsonWithFallback(urls, options = {}) {
  const failures = [];

  for (const url of urls) {
    try {
      return await requestJson(url, options);
    } catch (error) {
      failures.push(error);
      // Only retry another host for rate limits or temporary/server/network errors.
      if (error.status && error.status !== 429 && error.status < 500) break;
    }
  }

  const last = failures[failures.length - 1] || new Error("Request failed");
  const combined = new Error(failures.map((e) => e.message).join("; "));
  combined.status = last.status || null;
  combined.retryAfter = last.retryAfter || null;
  throw combined;
}

async function getUniverseId(placeId) {
  if (universeIds[placeId]) return universeIds[placeId];

  const encoded = encodeURIComponent(placeId);
  const result = await requestJsonWithFallback([
    "https://apis.roblox.com/universes/v1/places/" + encoded + "/universe",
    "https://apis.roproxy.com/universes/v1/places/" + encoded + "/universe"
  ]);

  if (!result.universeId) throw new Error("No Universe ID returned for Place ID " + placeId);
  universeIds[placeId] = String(result.universeId);
  return universeIds[placeId];
}

async function getGame(key, placeId) {
  try {
    const universeId = await getUniverseId(placeId);
    const query = encodeURIComponent(universeId);
    const result = await requestJsonWithFallback([
      "https://games.roblox.com/v1/games?universeIds=" + query,
      "https://games.roproxy.com/v1/games?universeIds=" + query
    ]);

    const game = result.data && result.data[0];
    if (!game) throw new Error("No public game data returned for Universe ID " + universeId);

    return {
      name: GAME_NAMES[key],
      placeId,
      universeId,
      playing: Number(game.playing || 0),
      maxPlayers: Number(game.maxPlayers || 0),
      visits: Number(game.visits || 0),
      status: "ok",
      source: "Roblox game details",
      error: null
    };
  } catch (error) {
    return {
      name: GAME_NAMES[key],
      placeId,
      playing: null,
      status: "error",
      error: error.message,
      httpStatus: error.status || null,
      retryAfter: error.retryAfter || null
    };
  }
}

async function getPresence() {
  try {
    const result = await requestJson(
      "https://presence.roblox.com/v1/presence/users",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: TEAM_USER_IDS.map(Number) })
      }
    );

    const records = {};
    for (const item of (result.userPresences || [])) {
      const type = Number(item.userPresenceType || 0);
      records[String(item.userId)] = {
        type,
        status: PRESENCE_NAMES[type] || "Unavailable",
        lastLocation: type === 2 ? (item.lastLocation || "") : ""
      };
    }

    for (const id of TEAM_USER_IDS) {
      if (!records[id]) records[id] = { type: 0, status: "Offline", lastLocation: "" };
    }

    return { status: "ok", users: records, error: null };
  } catch (error) {
    return {
      status: "error",
      users: {},
      error: error.message,
      httpStatus: error.status || null,
      retryAfter: error.retryAfter || null
    };
  }
}

async function buildPayload() {
  const [main, testing, presence] = await Promise.all([
    getGame("main", PLACE_IDS.main),
    getGame("testing", PLACE_IDS.testing),
    getPresence()
  ]);

  return {
    ok: main.status === "ok" || testing.status === "ok" || presence.status === "ok",
    updatedAt: new Date().toISOString(),
    games: { main, testing },
    presence,
    source: "Roblox public APIs"
  };
}

async function getPayload() {
  const now = Date.now();

  if (cachedPayload && now - cachedAt < 25000) return cachedPayload;
  if (pendingUpdate) return pendingUpdate;

  pendingUpdate = (async () => {
    const fresh = await buildPayload();
    const hasGameData = fresh.games.main.status === "ok" || fresh.games.testing.status === "ok";
    const hasAnyData = hasGameData || fresh.presence.status === "ok";

    if (hasAnyData) {
      cachedPayload = fresh;
      cachedAt = Date.now();
      return fresh;
    }

    if (cachedPayload && Date.now() - cachedAt < 5 * 60 * 1000) {
      return {
        ...cachedPayload,
        stale: true,
        warning: "Roblox temporarily unavailable; showing the last successful update."
      };
    }
    return fresh;
  })();

  try {
    return await pendingUpdate;
  } finally {
    pendingUpdate = null;
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "SED Tracker API",
        message: "Worker is running."
      });
    }

    if (url.pathname !== "/api") {
      return json({ ok: false, error: "Not found. Use /api or /health." }, 404);
    }

    if (request.method !== "GET") {
      return json({ ok: false, error: "Use GET for this endpoint." }, 405);
    }

    try {
      const data = await getPayload();
      return json(data, 200, {
        "Cache-Control": "public, max-age=15",
        "Access-Control-Max-Age": "86400"
      });
    } catch (error) {
      return json({
        ok: false,
        error: error.message || "Unexpected Worker error",
        updatedAt: new Date().toISOString()
      }, 502);
    }
  }
};
