import { json, methodNotAllowed, getEnv, supabaseRequest, adminError } from "./_lib.mjs";
import { getPlacements } from "./_tournament.mjs";

const TEAM_COLUMNS = "id,tournament_id,source_team_id,team_number,team_name,roster,seed";
const MATCH_COLUMNS = "id,tournament_id,round_number,match_number,team1_id,team2_id,winner_team_id,score1,score2,mode,map,selection_method,status,next_match_id,next_slot";

async function tournamentDetails(tournament, env) {
  const id = encodeURIComponent(tournament.id);
  const [teams, matches] = await Promise.all([
    supabaseRequest(`tournament_teams?select=${TEAM_COLUMNS}&tournament_id=eq.${id}&order=seed.asc`, { env }),
    supabaseRequest(`tournament_matches?select=${MATCH_COLUMNS}&tournament_id=eq.${id}&order=round_number.asc,match_number.asc`, { env })
  ]);
  const safeTeams = teams || [];
  const safeMatches = matches || [];
  return {
    tournament,
    teams: safeTeams,
    matches: safeMatches,
    placements: getPlacements(safeMatches)
  };
}

export default async function handler(request) {
  if (request.method !== "GET") return methodNotAllowed("GET");
  try {
    const env = getEnv();
    const url = new URL(request.url);

    if (url.searchParams.get("history") === "1") {
      const completed = await supabaseRequest(
        "tournaments?select=id,name,status,venue,details,starts_at,champion_team_id,created_at,completed_at&status=eq.completed&order=completed_at.desc",
        { env }
      );
      const history = [];
      for (const tournament of (completed || [])) {
        history.push(await tournamentDetails(tournament, env));
      }
      return json(200, { history }, { "cache-control": "no-store" });
    }

    const active = await supabaseRequest(
      "tournaments?select=id,name,status,venue,details,starts_at,champion_team_id,created_at,completed_at&status=eq.active&order=created_at.desc&limit=1",
      { env }
    );
    if (!active?.[0]) return json(200, { tournament: null, teams: [], matches: [], placements: null });
    return json(200, await tournamentDetails(active[0], env), {
      "cache-control": "public, max-age=5, stale-while-revalidate=10"
    });
  } catch (error) {
    return adminError(error);
  }
}
