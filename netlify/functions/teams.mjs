import { json, getEnv, supabaseRequest, adminError } from "./_lib.mjs";

export default async function handler() {
  try {
    const env = getEnv();
    const columns = "team_number,team_name,captain_nick,captain_class,player2_nick,player2_class,player3_nick,player3_class,reserve_nick,reserve_class,created_at";
    const rows = await supabaseRequest(`teams?select=${columns}&status=eq.approved&is_public=eq.true&order=team_number.asc`, { env });
    return json(200, { teams: rows || [] }, { "cache-control": "public, max-age=30, stale-while-revalidate=60" });
  } catch (error) {
    return adminError(error);
  }
}
