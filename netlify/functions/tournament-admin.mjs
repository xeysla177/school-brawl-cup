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

/*
 * Проходит сетку сверху вниз:
 * 1. Передаёт победителей в нужные слоты следующего раунда.
 * 2. Если оба матча-предшественника уже завершены, а в текущем матче
 *    оказалась только одна команда, автоматически назначает ей BYE.
 * 3. Сохраняет все изменения в Supabase.
 */
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
      throw new Error("Нельзя обновить сетку: слот следующего матча уже занят другой командой.");
    }
    target[field] = match.winner_team_id;
  }

  for (const match of ordered) {
    // К этому моменту все матчи предыдущего раунда уже обработаны.
    if (match.round_number > 1 && match.status === "pending") {
      const feeders = ordered.filter(item => item.next_match_id === match.id);
      const feedersResolved =
        feeders.length === 2 &&
        feeders.every(item =>
          ["completed", "bye"].includes(item.status) && Boolean(item.winner_team_id)
        );

      if (feedersResolved) {
        const hasTeam1 = Boolean(match.team1_id);
        const hasTeam2 = Boolean(match.team2_id);

        if (hasTeam1 !== hasTeam2) {
          match.winner_team_id = match.team1_id || match.team2_id;
          match.status = "bye";
        }
      }
    }

    if (["completed", "bye"].includes(match.status)) {
      sendWinner(match);
    }
  }

  const changed = ordered.filter(match => {
    const original = matches.find(item => item.id === match.id);
    return original && (
      original.team1_id !== match.team1_id ||
      original.team2_id !== match.team2_id ||
      original.winner_team_id !== match.winner_team_id ||
      original.status !== match.status
    );
  });

  await Promise.all(changed.map(match => patchById("tournament_matches", match.id, {
    team1_id: match.team1_id,
    team2_id: match.team2_id,
    winner_team_id: match.winner_team_id,
    status: match.status,
    updated_at: new Date().toISOString()
  }, env)));
}

async function deleteTournamentDraft(tournamentId, env) {
  const id = encodeURIComponent(tournamentId);
  // Удаляем только незавершённую заготовку, если создание оборвалось на середине.
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

function buildBracket(tournamentId, tournamentTeams) {
  const teamIds = tournamentTeams.map(team => team.id);
  const bracketSize = 2 ** Math.ceil(Math.log2(teamIds.length));
  const roundCount = Math.log2(bracketSize);
  const firstRoundMatchCount = bracketSize / 2;
  const byeCount = bracketSize - teamIds.length;
  const matches = [];
  let teamIndex = 0;

  // BYE-места распределяются первыми. Оставшиеся команды образуют пары.
  // Так для 6 команд будет 2 BYE и 2 полноценных матча, а не пустой матч.
  for (let index = 0; index < firstRoundMatchCount; index++) {
    let team1Id = null;
    let team2Id = null;
    let status = "pending";
    let winnerTeamId = null;

    if (index < byeCount) {
      team1Id = teamIds[teamIndex++];
      status = "bye";
      winnerTeamId = team1Id;
    } else {
      team1Id = teamIds[teamIndex++];
      team2Id = teamIds[teamIndex++];
    }

    matches.push({
      id: crypto.randomUUID(),
      tournament_id: tournamentId,
      round_number: 1,
      match_number: index + 1,
      team1_id: team1Id,
      team2_id: team2Id,
      winner_team_id: winnerTeamId,
      score1: null,
      score2: null,
      mode: null,
      map: null,
      selection_method: "manual",
      status,
      next_match_id: null,
      next_slot: null
    });
  }

  for (let round = 2; round <= roundCount; round++) {
    const count = bracketSize / (2 ** round);
    for (let index = 0; index < count; index++) {
      matches.push({
        id: crypto.randomUUID(),
        tournament_id: tournamentId,
        round_number: round,
        match_number: index + 1,
        team1_id: null,
        team2_id: null,
        winner_team_id: null,
        score1: null,
        score2: null,
        mode: null,
        map: null,
        selection_method: "manual",
        status: "pending",
        next_match_id: null,
        next_slot: null
      });
    }
  }

  const matchesByRound = new Map();
  for (const match of matches) {
    if (!matchesByRound.has(match.round_number)) matchesByRound.set(match.round_number, []);
    matchesByRound.get(match.round_number).push(match);
  }

  for (const match of matches) {
    if (match.round_number >= roundCount) continue;
    const nextRound = matchesByRound.get(match.round_number + 1);
    const nextMatch = nextRound[Math.floor((match.match_number - 1) / 2)];
    match.next_match_id = nextMatch.id;
    match.next_slot = match.match_number % 2 === 1 ? 1 : 2;
  }

  if (teamIndex !== teamIds.length) {
    throw new Error("Не удалось распределить все команды по турнирной сетке.");
  }

  return matches;
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
  let startsAt = null;

  if (body.starts_at) {
    const parsed = new Date(body.starts_at);
    if (Number.isNaN(parsed.getTime())) {
      return json(400, { error: "Проверьте дату и время турнира." });
    }
    startsAt = parsed.toISOString();
  }

  let tournamentId = null;

  try {
    const tournamentRows = await supabaseRequest("tournaments", {
      method: "POST",
      body: [{ name, venue, starts_at: startsAt, status: "active" }],
      prefer: "return=representation",
      env
    });

    const tournament = tournamentRows?.[0];
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
      method: "POST",
      body: tournamentTeams,
      prefer: "return=minimal",
      env
    });

    const matches = buildBracket(tournamentId, tournamentTeams);
    await supabaseRequest("tournament_matches", {
      method: "POST",
      body: matches,
      prefer: "return=minimal",
      env
    });

    await propagateWinners(matches, env);
    return json(201, { ok: true, tournament_id: tournamentId });
  } catch (error) {
    if (tournamentId) {
      try {
        await deleteTournamentDraft(tournamentId, env);
      } catch (cleanupError) {
        console.error("Не удалось очистить незавершённую заготовку турнира:", cleanupError);
      }
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
    if (!body || typeof body.action !== "string") {
      return json(400, { error: "Некорректная команда." });
    }

    if (body.action === "create") return await createTournament(body, env);

    const tournament = await activeTournament(env);
    if (!tournament) return json(404, { error: "Активный турнир не найден." });

    if (body.action === "update_info") {
      const patch = {
        name: cleanText(body.name, 80) || "SCHOOL BRAWL CUP",
        venue: cleanText(body.venue, 200),
        starts_at: null,
        updated_at: new Date().toISOString()
      };

      if (body.starts_at) {
        const parsed = new Date(body.starts_at);
        if (Number.isNaN(parsed.getTime())) {
          return json(400, { error: "Проверьте дату и время." });
        }
        patch.starts_at = parsed.toISOString();
      }

      await patchById("tournaments", tournament.id, patch, env);
      return json(200, { ok: true });
    }

    if (body.action === "set_match") {
      if (!UUID.test(body.match_id || "")) {
        return json(400, { error: "Некорректный матч." });
      }

      const mode = cleanText(body.mode, 40);
      const map = cleanText(body.map, 80);
      if (!Object.hasOwn(RANKED_MAPS, mode) || !RANKED_MAPS[mode].includes(map)) {
        return json(400, { error: "Выберите режим и карту из списка Ranked." });
      }

      const rows = await supabaseRequest(
        `tournament_matches?select=id,status,team1_id,team2_id&id=eq.${encodeURIComponent(body.match_id)}&tournament_id=eq.${encodeURIComponent(tournament.id)}&limit=1`,
        { env }
      );
      const match = rows?.[0];
      if (!match) return json(404, { error: "Матч не найден." });
      if (["completed", "bye"].includes(match.status)) {
        return json(409, { error: "Этот матч уже завершён." });
      }
      if (!match.team1_id || !match.team2_id) {
        return json(409, { error: "Обе команды ещё не определились. Нельзя назначить карту заранее." });
      }

      await patchById("tournament_matches", body.match_id, {
        mode,
        map,
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
      if (["completed", "bye"].includes(match.status)) {
        return json(409, { error: "Этот матч уже завершён." });
      }
      if (!match.team1_id || !match.team2_id ||
          ![match.team1_id, match.team2_id].includes(body.winner_team_id)) {
        return json(400, { error: "Победитель должен быть одной из команд этого матча." });
      }

      const score1 = Number(body.score1);
      const score2 = Number(body.score2);
      if (!Number.isInteger(score1) || !Number.isInteger(score2) ||
          score1 < 0 || score2 < 0 || score1 === score2) {
        return json(400, { error: "Укажите корректный счёт: ничья не определяет победителя." });
      }
      const scoreWinner = score1 > score2 ? match.team1_id : match.team2_id;
      if (scoreWinner !== body.winner_team_id) {
        return json(400, { error: "Выбранный победитель не совпадает со счётом." });
      }

      await patchById("tournament_matches", match.id, {
        score1,
        score2,
        winner_team_id: body.winner_team_id,
        status: "completed",
        updated_at: new Date().toISOString()
      }, env);

      const allMatches = await readMatches(tournament.id, env);
      await propagateWinners(allMatches, env);
      return json(200, { ok: true });
    }

    if (body.action === "finish") {
      const matches = await readMatches(tournament.id, env);
      const finalRound = Math.max(0, ...matches.map(match => match.round_number));
      const finalMatch = matches.find(match => match.round_number === finalRound);

      if (!finalMatch || !finalMatch.winner_team_id ||
          !["completed", "bye"].includes(finalMatch.status)) {
        return json(400, {
          error: "Нельзя завершить турнир: финальный матч ещё не определил победителя."
        });
      }

      const entries = await supabaseRequest(
        `tournament_teams?select=id,source_team_id&tournament_id=eq.${encodeURIComponent(tournament.id)}`,
        { env }
      );

      await Promise.all((entries || [])
        .filter(team => team.source_team_id)
        .map(team => patchById("teams", team.source_team_id, { is_public: false }, env)));

      await patchById("tournaments", tournament.id, {
        status: "completed",
        champion_team_id: finalMatch.winner_team_id,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, env);

      return json(200, { ok: true });
    }

    return json(400, { error: "Неизвестная команда управления турниром." });
  } catch (error) {
    return adminError(error);
  }
}
