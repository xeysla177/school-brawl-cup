import { json, getEnv } from "./_lib.mjs";

export default async function handler() {
  try {
    const env = getEnv();
    return json(200, { supabaseUrl: env.url, supabaseAnonKey: env.anonKey });
  } catch (error) {
    console.error("Config function error:", error);
    return json(503, { error: "Сайт ещё не настроен организатором. Попробуйте позже." });
  }
}
