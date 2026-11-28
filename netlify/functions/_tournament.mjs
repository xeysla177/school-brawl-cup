import { randomUUID } from "node:crypto";

export const RANKED_MAPS = Object.freeze({
  "Захват кристаллов": ["Double Swoosh", "Gem Fort", "Hard Rock Mine", "Undermine"],
  "Ограбление": ["Bridge Too Far", "Hot Potato", "Kaboom Canyon", "Safe Zone"],
  "Награда за поимку": ["Dry Season", "Hideout", "Layer Cake", "Shooting Star"],
  "Броулбол": ["Center Stage", "Pinball Dreams", "Sneaky Fields", "Triple Dribble"],
  "Горячая зона": ["Dueling Beetles", "Open Business", "Parallel Plays", "Ring of Fire"],
  "Нокаут": ["Belle's Rock", "Flaring Phoenix", "New Horizons", "Out in the Open"]
});

export function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function buildBracket(tournamentId, tournamentTeams) {
  if (!Array.isArray(tournamentTeams) || tournamentTeams.length < 2) {
    throw new Error("Для сетки нужны минимум две команды.");
  }

  const teamIds = tournamentTeams.map(team => team.id);
  if (new Set(teamIds).size !== teamIds.length || teamIds.some(id => !id)) {
    throw new Error("В списке команд обнаружены повторяющиеся или пустые ID.");
  }

  const bracketSize = 2 ** Math.ceil(Math.log2(teamIds.length));
  const roundCount = Math.log2(bracketSize);
  const firstRoundMatchCount = bracketSize / 2;
  const byeCount = bracketSize - teamIds.length;
  const matches = [];
  let teamIndex = 0;

  // BYE получают случайные команды из уже перемешанного списка.
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
      id: randomUUID(),
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
        id: randomUUID(),
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

export function getPlacements(matches) {
  if (!Array.isArray(matches) || !matches.length) return null;
  const finalRound = Math.max(...matches.map(match => Number(match.round_number) || 0));
  const finalMatch = matches.find(match =>
    match.round_number === finalRound &&
    ["completed", "bye"].includes(match.status) &&
    match.winner_team_id
  );
  if (!finalMatch) return null;

  const first = finalMatch.winner_team_id;
  const second = [finalMatch.team1_id, finalMatch.team2_id]
    .find(id => id && id !== first) || null;

  // Без отдельного матча за третье место оба проигравших полуфиналиста делят 3-е место.
  const semifinalRound = finalRound - 1;
  const third = semifinalRound < 1 ? [] : matches
    .filter(match =>
      match.round_number === semifinalRound &&
      match.status === "completed" &&
      match.winner_team_id &&
      match.team1_id &&
      match.team2_id
    )
    .map(match => [match.team1_id, match.team2_id].find(id => id !== match.winner_team_id))
    .filter(Boolean);

  return { first, second, third: [...new Set(third)] };
}
