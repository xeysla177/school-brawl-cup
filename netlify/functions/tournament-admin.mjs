import {
  json, methodNotAllowed, getEnv, readJson, verifyAdmin,
  supabaseRequest, cleanText, adminError
} from "./_lib.mjs";
import { RANKED_MAPS, shuffle, buildBracket, getPlacements } from "./_tournament.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function activeTournament(env) {
  const rows = await supabaseRequest(
    "tournaments?select=id,name,status,venue,details,starts_at,champion_team_id,created_at,completed_at&status=eq.active&limit=1",
    { env }
  );
  return rows?.[0] || null;
}

async function patchById(table, id, patch, env) {
  await supabaseRequest(`${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: patch,
    prefer: "return=minimal",
    env
  });
}

async function readMatches(tournamentId, env) {
  return await supabaseRequest(
    `tournament_matches?select=*&tournament_id=eq.${encodeURIComponent(tournamentId)}&order=round_number.asc,match_number.asc`,
    { env }
  ) || [];
}

async function propagateWinners(matches, env) {
  const byId = new Map(matches.map(match => [match.id, { ...match }]));
  const ordered = [...byId.values()].sort(
    (a, b) => a.round_number - b.round_number || a.match_number - b.match_number
  );

  function sendWinner(match) {
    if (!match.winner_team_id || !match.next_match_id || !match.next_slot) return;
    const target = byId.get(match.next_match_id);
    if (!target) throw new Error("В сетке найдена неверная связь между матчами.");
    const field = match.next_slot === 1 ? "team1_id" : "team2_id";
    if (target[field] && target[field] !== match.winner_team_id) {
      throw new Error("Слот следующего матча уже занят другой командой.");
    }
    target[field] = match.winner_team_id;
  }

  for (const match of ordered) {
    if (match.round_number > 1 && match.status === "pending") {
      const feeders = ordered.filter(item => item.next_match_id === match.id);
      const feedersResolved = feeders.length === 2 && feeders.every(item =>
        ["completed", "bye"].includes(item.status) && Boolean(item.winner_team_id)
      );
      if (feedersResolved && Boolean(match.team1_id) !== Boolean(match.team2_id)) {
        match.winner_team_id = match.team1_id || match.team2_id;
        match.status = "bye";
      }
    }
    if (["completed", "bye"].includes(match.status)) sendWinner(match);
  }

  const originals = new Map(matches.map(match => [match.id, match]));
  const changed = ordered.filter(match => {
    const original = originals.get(match.id);
    return original && (
      original.team1_id !== match.team1_id ||
      original.team2_id !== match.team2_id ||
      original.winner_team_id !== match.winner_team_id ||
      original.status !== match.status
    );
  });

  for (const match of changed) {
    await patchById("tournament_matches", match.id, {
      team1_id: match.team1_id,
      team2_id: match.team2_id,
      winner_team_id: match.winner_team_id,
      status: match.status,
      updated_at: new Date().toISOString()
    }, env);
  }
}

async function deleteTournamentDraft(tournamentId, env) {
  const id = encodeURIComponent(tournamentId);
  await supabaseRequest(`tournament_matches?tournament_id=eq.${id}`, {
    method: "DELETE", prefer: "return=minimal", env
  });
  await supabaseRequest(`tournament_teams?tournament_id=eq.${id}`, {
    method: "DELETE", prefer: "return=minimal", env
  });
  await supabaseRequest(`tournaments?id=eq.${id}&status=eq.active`, {
    method: "DELETE", prefer: "return=minimal", env
  });
}

async function createTournament(body, env) {
  if (await activeTournament(env)) {
    return json(409, { error: "Активный турнир уже существует." });
  }

  const published = await supabaseRequest(
    "teams?select=id,team_number,team_name,captain_nick,captain_class,player2_nick,player2_class,player3_nick,player3_class,reserve_nick,reserve_class&status=eq.approved&is_public=eq.true&order=team_number.asc",
    { env }
  );

  if (!published || published.length < 2) {
    return json(400, { error: "Для создания сетки нужно минимум две опубликованные команды." });
  }

  const name = cleanText(body.name, 80) || "SCHOOL BRAWL CUP";
  const venue = cleanText(body.venue, 200);
  const details = cleanText(body.details, 1000);
  let startsAt = null;

  if (body.starts_at) {
    const parsed = new Date(body.starts_at);
    if (Number.isNaN(parsed.getTime())) return json(400, { error: "Проверьте дату и время турнира." });
    startsAt = parsed.toISOString();
  }

  let tournamentId = null;
  try {
    const rows = await supabaseRequest("tournaments", {
      method: "POST",
      body: [{ name, venue, details, starts_at: startsAt, status: "active" }],
      prefer: "return=representation",
      env
    });
    const tournament = rows?.[0];
    if (!tournament?.id) throw new Error("Не удалось создать турнир.");
    tournamentId = tournament.id;

    const shuffled = shuffle(published);
    const tournamentTeams = shuffled.map((team, index) => ({
      id: crypto.randomUUID(),
      tournament_id: tournamentId,
      source_team_id: team.id,
      team_number: team.team_number,
      team_name: team.team_name,
      roster: [
        { role: "Капитан", nick: team.captain_nick, klass: team.captain_class },
        { role: "Игрок 2", nick: team.player2_nick, klass: team.player2_class },
        { role: "Игрок 3", nick: team.player3_nick, klass: team.player3_class },
        ...(team.reserve_nick
          ? [{ role: "Запасной", nick: team.reserve_nick, klass: team.reserve_class }]
          : [])
      ],
      seed: index + 1
    }));

    await supabaseRequest("tournament_teams", {
      method: "POST", body: tournamentTeams, prefer: "return=minimal", env
    });

    const matches = buildBracket(tournamentId, tournamentTeams);
    await supabaseRequest("tournament_matches", {
      method: "POST", body: matches, prefer: "return=minimal", env
    });
    await propagateWinners(matches, env);
    return json(201, { ok: true, tournament_id: tournamentId, team_count: tournamentTeams.length });
  } catch (error) {
    if (tournamentId) {
      try { await deleteTournamentDraft(tournamentId, env); }
      catch (cleanupError) { console.error("Не удалось очистить незавершённый турнир:", cleanupError); }
    }
    throw error;
  }
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
        details: cleanText(body.details, 1000),
        starts_at: null,
        updated_at: new Date().toISOString()
      };
      if (body.starts_at) {
        const parsed = new Date(body.starts_at);
        if (Number.isNaN(parsed.getTime())) return json(400, { error: "Проверьте дату и время." });
        patch.starts_at = parsed.toISOString();
      }
      await patchById("tournaments", tournament.id, patch, env);
      return json(200, { ok: true });
    }

    if (body.action === "set_match") {
      if (!UUID.test(body.match_id || "")) return json(400, { error: "Некорректный матч." });
      const mode = cleanText(body.mode, 40);
      const map = cleanText(body.map, 80);
      if (!Object.hasOwn(RANKED_MAPS, mode) || !RANKED_MAPS[mode].includes(map)) {
        return json(400, { error: "Выберите режим и карту из актуального списка Ranked." });
      }

      const rows = await supabaseRequest(
        `tournament_matches?select=id,status,team1_id,team2_id&id=eq.${encodeURIComponent(body.match_id)}&tournament_id=eq.${encodeURIComponent(tournament.id)}&limit=1`,
        { env }
      );
      const match = rows?.[0];
      if (!match) return json(404, { error: "Матч не найден." });
      if (["completed", "bye"].includes(match.status)) return json(409, { error: "Этот матч уже завершён." });
      if (!match.team1_id || !match.team2_id) {
        return json(409, { error: "Обе команды ещё не определились. Нельзя назначить карту заранее." });
      }

      await patchById("tournament_matches", body.match_id, {
        mode, map,
        selection_method: body.selection_method === "random" ? "random" : "manual",
        status: "live",
        updated_at: new Date().toISOString()
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
      if (["completed", "bye"].includes(match.status)) return json(409, { error: "Этот матч уже завершён." });
      if (!match.team1_id || !match.team2_id ||
          ![match.team1_id, match.team2_id].includes(body.winner_team_id)) {
        return json(400, { error: "Победитель должен быть одной из команд этого матча." });
      }
      if (!match.mode || !match.map) {
        return json(400, { error: "Сначала назначьте режим и карту матча." });
      }
      if (body.score1 === "" || body.score2 === "" || body.score1 == null || body.score2 == null) {
        return json(400, { error: "Укажите счёт обеих команд." });
      }
      const score1 = Number(body.score1);
      const score2 = Number(body.score2);
      if (!Number.isInteger(score1) || !Number.isInteger(score2) ||
          score1 < 0 || score2 < 0 || score1 > 99 || score2 > 99 || score1 === score2) {
        return json(400, { error: "Укажите корректный счёт от 0 до 99. Ничья не определяет победителя." });
      }
      const scoreWinner = score1 > score2 ? match.team1_id : match.team2_id;
      if (scoreWinner !== body.winner_team_id) {
        return json(400, { error: "Выбранный победитель не совпадает со счётом." });
      }

      await patchById("tournament_matches", match.id, {
        score1, score2, winner_team_id: body.winner_team_id,
        status: "completed", updated_at: new Date().toISOString()
      }, env);
      await propagateWinners(await readMatches(tournament.id, env), env);
      return json(200, { ok: true });
    }

    if (body.action === "finish") {
      const matches = await readMatches(tournament.id, env);
      const placements = getPlacements(matches);
      if (!placements?.first || !placements.second) {
        return json(400, { error: "Нельзя завершить турнир: финальный матч ещё не определил победителя." });
      }

      const entries = await supabaseRequest(
        `tournament_teams?select=id,source_team_id&tournament_id=eq.${encodeURIComponent(tournament.id)}`,
        { env }
      );
      for (const team of (entries || [])) {
        if (team.source_team_id) {
          await patchById("teams", team.source_team_id, { is_public: false }, env);
        }
      }

      await patchById("tournaments", tournament.id, {
        status: "completed",
        champion_team_id: placements.first,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, env);
      return json(200, { ok: true, placements });
    }

    return json(400, { error: "Неизвестная команда управления турниром." });
  } catch (error) {
    return adminError(error);
  }
}
