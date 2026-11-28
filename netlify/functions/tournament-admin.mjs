import {
  json, methodNotAllowed, getEnv, readJson, verifyAdmin,
  supabaseRequest, cleanText, adminError
} from "./_lib.mjs";

const RANKED_MAPS = {
  "Захват кристаллов": ["Double Swoosh", "Gem Fort", "Hard Rock Mine", "Undermine"],
  "Ограбление": ["Bridge Too Far", "Hot Potato", "Kaboom Canyon", "Safe Zone"],
  "Награда за поимку": ["Dry Season", "Hideout", "Layer Cake", "Shooting Star"],
  "Броулбол": ["Center Stage", "Pinball Dreams", "Sneaky Fields", "Triple Dribble"],
  "Горячая зона": ["Dueling Beetles", "Open Business", "Parallel Plays", "Ring of Fire"],
  "Нокаут": ["Belle's Rock", "Flaring Phoenix", "New Horizons", "Out in the Open"]
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

async function activeTournament(env) {
  const rows = await supabaseRequest(
    "tournaments?select=id,name,status,venue,starts_at,champion_team_id,created_at,completed_at&status=eq.active&limit=1",
    { env }
  );
  return rows?.[0] || null;
}

async function patchById(table, id, patch, env) {
  await supabaseRequest(`${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH", body: patch, prefer: "return=minimal", env
  });
}

async function readMatches(tournamentId, env) {
  return await supabaseRequest(
    `tournament_matches?select=*&tournament_id=eq.${encodeURIComponent(tournamentId)}&order=round_number.asc,match_number.asc`,
    { env }
  ) || [];
}

// Проталкивает победителей и автоматически закрывает матчи, где соперник получил bye.
async function propagateWinners(matches, env) {
  const byId = new Map(matches.map(m => [m.id, { ...m }]));
  const ordered = [...byId.values()].sort((a, b) => a.round_number - b.round_number || a.match_number - b.match_number);

  for (const match of ordered) {
    if (match.status !== "bye" && match.status !== "completed") continue;
    if (!match.winner_team_id || !match.next_match_id || !match.next_slot) continue;
    const target = byId.get(match.next_match_id);
    if (!target) continue;
    const field = match.next_slot === 1 ? "team1_id" : "team2_id";
    if (!target[field]) target[field] = match.winner_team_id;
  }

  const maxRound = Math.max(0, ...ordered.map(m => m.round_number));
  for (let round = 2; round <= maxRound; round++) {
    const current = ordered.filter(m => m.round_number === round);
    for (const match of current) {
      if (match.status !== "pending" || Boolean(match.team1_id) === Boolean(match.team2_id)) continue;
      const feeders = ordered.filter(m => m.next_match_id === match.id);
      if (feeders.length !== 2 || feeders.some(m => !["bye", "completed"].includes(m.status))) continue;
      const winner = match.team1_id || match.team2_id;
      match.winner_team_id = winner;
      match.status = "bye";
      if (match.next_match_id && match.next_slot) {
        const target = byId.get(match.next_match_id);
        if (target) {
          const field = match.next_slot === 1 ? "team1_id" : "team2_id";
          if (!target[field]) target[field] = winner;
        }
      }
    }
  }

  const changed = [...byId.values()].filter(m => {
    const original = matches.find(x => x.id === m.id);
    return original && (
      original.team1_id !== m.team1_id ||
      original.team2_id !== m.team2_id ||
      original.winner_team_id !== m.winner_team_id ||
      original.status !== m.status
    );
  });
  await Promise.all(changed.map(m => patchById("tournament_matches", m.id, {
    team1_id: m.team1_id,
    team2_id: m.team2_id,
    winner_team_id: m.winner_team_id,
    status: m.status,
    updated_at: new Date().toISOString()
  }, env)));
}

async function createTournament(body, env) {
  if (await activeTournament(env)) return json(409, { error: "Активный турнир уже существует." });

  const published = await supabaseRequest(
    "teams?select=id,team_number,team_name,captain_nick,captain_class,player2_nick,player2_class,player3_nick,player3_class,reserve_nick,reserve_class&status=eq.approved&is_public=eq.true&order=team_number.asc",
    { env }
  );
  if (!published || published.length < 2) {
    return json(400, { error: "Для создания сетки нужно минимум две опубликованные команды." });
  }

  const name = cleanText(body.name, 80) || "SCHOOL BRAWL CUP";
  const venue = cleanText(body.venue, 200);
  let startsAt = null;
  if (body.starts_at) {
    const parsed = new Date(body.starts_at);
    if (Number.isNaN(parsed.getTime())) return json(400, { error: "Проверьте дату и время турнира." });
    startsAt = parsed.toISOString();
  }

  const tournamentRows = await supabaseRequest("tournaments", {
    method: "POST",
    body: [{ name, venue, starts_at: startsAt, status: "active" }],
    prefer: "return=representation",
    env
  });
  const tournament = tournamentRows?.[0];
  if (!tournament?.id) throw new Error("Не удалось создать турнир.");

  const shuffled = shuffle(published);
  const tournamentTeams = shuffled.map((team, index) => ({
    id: crypto.randomUUID(),
    tournament_id: tournament.id,
    source_team_id: team.id,
    team_number: team.team_number,
    team_name: team.team_name,
    roster: [
      { role: "Капитан", nick: team.captain_nick, klass: team.captain_class },
      { role: "Игрок 2", nick: team.player2_nick, klass: team.player2_class },
      { role: "Игрок 3", nick: team.player3_nick, klass: team.player3_class },
      ...(team.reserve_nick ? [{ role: "Запасной", nick: team.reserve_nick, klass: team.reserve_class }] : [])
    ],
    seed: index + 1
  }));
  await supabaseRequest("tournament_teams", {
    method: "POST", body: tournamentTeams, prefer: "return=minimal", env
  });

  const bracketSize = 2 ** Math.ceil(Math.log2(tournamentTeams.length));
  const rounds = Math.log2(bracketSize);
  const teamIds = tournamentTeams.map(t => t.id);
  const matches = [];
  for (let round = 1; round <= rounds; round++) {
    const count = bracketSize / (2 ** round);
    for (let index = 0; index < count; index++) {
      const row = {
        id: crypto.randomUUID(),
        tournament_id: tournament.id,
        round_number: round,
        match_number: index + 1,
        team1_id: round === 1 ? (teamIds[index * 2] || null) : null,
        team2_id: round === 1 ? (teamIds[index * 2 + 1] || null) : null,
        winner_team_id: null,
        score1: null,
        score2: null,
        mode: null,
        map: null,
        selection_method: "manual",
        status: "pending",
        next_match_id: null,
        next_slot: null
      };
      if (round < rounds) {
        row.next_match_id = null; // заполним после построения всех раундов
        row.next_slot = (index % 2) + 1;
      }
      if (round === 1 && Boolean(row.team1_id) !== Boolean(row.team2_id)) {
        row.status = "bye";
        row.winner_team_id = row.team1_id || row.team2_id;
      }
      matches.push(row);
    }
  }

  for (const match of matches) {
    if (match.round_number < rounds) {
      const next = matches.find(m => m.round_number === match.round_number + 1 && m.match_number === Math.ceil(match.match_number / 2));
      match.next_match_id = next.id;
    }
  }
  await supabaseRequest("tournament_matches", {
    method: "POST", body: matches, prefer: "return=minimal", env
  });
  await propagateWinners(matches, env);
  return json(201, { ok: true, tournament_id: tournament.id });
}

export default async function handler(request) {
  if (request.method !== "POST") return methodNotAllowed("POST");
  try {
    const env = getEnv();
    if (!(await verifyAdmin(request, env))) {
      return json(401, { error: "Доступ запрещён. Войдите под учётной записью организатора." });
    }
    const body = await readJson(request);
    if (!body || typeof body.action !== "string") return json(400, { error: "Некорректная команда." });

    if (body.action === "create") return await createTournament(body, env);

    const tournament = await activeTournament(env);
    if (!tournament) return json(404, { error: "Активный турнир не найден." });

    if (body.action === "update_info") {
      const patch = {
        name: cleanText(body.name, 80) || "SCHOOL BRAWL CUP",
        venue: cleanText(body.venue, 200),
        updated_at: new Date().toISOString()
      };
      if (body.starts_at) {
        const parsed = new Date(body.starts_at);
        if (Number.isNaN(parsed.getTime())) return json(400, { error: "Проверьте дату и время." });
        patch.starts_at = parsed.toISOString();
      } else {
        patch.starts_at = null;
      }
      await patchById("tournaments", tournament.id, patch, env);
      return json(200, { ok: true });
    }

    if (body.action === "set_match") {
      if (!UUID.test(body.match_id || "")) return json(400, { error: "Некорректный матч." });
      const mode = cleanText(body.mode, 40);
      const map = cleanText(body.map, 80);
      if (!Object.hasOwn(RANKED_MAPS, mode) || !RANKED_MAPS[mode].includes(map)) {
        return json(400, { error: "Выберите режим и карту из текущего списка Ranked." });
      }
      const rows = await supabaseRequest(
        `tournament_matches?select=id,status& id=eq.${encodeURIComponent(body.match_id)}&tournament_id=eq.${encodeURIComponent(tournament.id)}&limit=1`.replace("& id", "&id"),
        { env }
      );
      if (!rows?.[0]) return json(404, { error: "Матч не найден." });
      if (rows[0].status === "completed" || rows[0].status === "bye") {
        return json(409, { error: "Этот матч уже завершён." });
      }
      await patchById("tournament_matches", body.match_id, {
        mode, map, selection_method: body.selection_method === "random" ? "random" : "manual",
        status: "live", updated_at: new Date().toISOString()
      }, env);
      return json(200, { ok: true });
    }

    if (body.action === "set_result") {
      if (!UUID.test(body.match_id || "") || !UUID.test(body.winner_team_id || "")) {
        return json(400, { error: "Выберите матч и победителя." });
      }
      const rows = await supabaseRequest(
        `tournament_matches?select=*&id=eq.${encodeURIComponent(body.match_id)}&tournament_id=eq.${encodeURIComponent(tournament.id)}&limit=1`,
        { env }
      );
      const match = rows?.[0];
      if (!match) return json(404, { error: "Матч не найден." });
      if (match.status === "completed" || match.status === "bye") return json(409, { error: "Этот матч уже завершён." });
      if (![match.team1_id, match.team2_id].includes(body.winner_team_id) || !match.team1_id || !match.team2_id) {
        return json(400, { error: "Победитель должен быть одной из команд этого матча." });
      }
      const score1 = Number(body.score1);
      const score2 = Number(body.score2);
      if (!Number.isInteger(score1) || !Number.isInteger(score2) || score1 < 0 || score2 < 0) {
        return json(400, { error: "Укажите корректный счёт матча." });
      }
      await patchById("tournament_matches", match.id, {
        score1, score2, winner_team_id: body.winner_team_id,
        status: "completed", updated_at: new Date().toISOString()
      }, env);
      const allMatches = await readMatches(tournament.id, env);
      await propagateWinners(allMatches, env);
      return json(200, { ok: true });
    }

    if (body.action === "finish") {
      const matches = await readMatches(tournament.id, env);
      const finalRound = Math.max(0, ...matches.map(m => m.round_number));
      const finalMatch = matches.find(m => m.round_number === finalRound);
      if (!finalMatch || !finalMatch.winner_team_id || !["completed", "bye"].includes(finalMatch.status)) {
        return json(400, { error: "Нельзя завершить турнир: финальный матч ещё не определил победителя." });
      }
      const entries = await supabaseRequest(
        `tournament_teams?select=id,source_team_id&tournament_id=eq.${encodeURIComponent(tournament.id)}`,
        { env }
      );
      await patchById("tournaments", tournament.id, {
        status: "completed",
        champion_team_id: finalMatch.winner_team_id,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, env);
      // Команды остаются в таблице teams; скрываем их только из активного публичного списка.
      await Promise.all((entries || []).filter(t => t.source_team_id).map(t =>
        patchById("teams", t.source_team_id, { is_public: false }, env)
      ));
      return json(200, { ok: true });
    }

    return json(400, { error: "Неизвестная команда управления турниром." });
  } catch (error) {
    return adminError(error);
  }
}
