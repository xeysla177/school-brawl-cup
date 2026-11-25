const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export function json(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: { ...JSON_HEADERS, "cache-control": "no-store", ...extraHeaders },
    body: JSON.stringify(payload)
  };
}

export function methodNotAllowed(allowed = "POST") {
  return json(405, { error: "Метод запроса не поддерживается." }, { Allow: allowed });
}

export function getEnv() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, ADMIN_EMAIL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY || !ADMIN_EMAIL) {
    throw new Error("Не заданы обязательные переменные окружения Supabase/администратора.");
  }
  return {
    url: SUPABASE_URL.replace(/\/$/, ""),
    serviceKey: SUPABASE_SERVICE_ROLE_KEY,
    anonKey: SUPABASE_ANON_KEY,
    adminEmail: ADMIN_EMAIL.trim().toLowerCase()
  };
}

export async function readJson(event) {
  try {
    return JSON.parse(event.body || "{}");
  } catch {
    return null;
  }
}

export async function supabaseRequest(path, { method = "GET", body, prefer, env = getEnv() } = {}) {
  const headers = {
    apikey: env.serviceKey,
    Authorization: `Bearer ${env.serviceKey}`,
    Accept: "application/json"
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;

  const response = await fetch(`${env.url}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) {
    const error = new Error(data?.message || data?.hint || `Supabase вернул HTTP ${response.status}.`);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

export function cleanText(value, maxLength = 50) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, maxLength);
}

export function validateTeam(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Проверьте данные формы и попробуйте ещё раз." };
  }
  const team = {
    team_name: cleanText(body.team_name, 32),
    captain_nick: cleanText(body.captain_nick, 24),
    captain_class: cleanText(body.captain_class, 12),
    player2_nick: cleanText(body.player2_nick, 24),
    player2_class: cleanText(body.player2_class, 12),
    player3_nick: cleanText(body.player3_nick, 24),
    player3_class: cleanText(body.player3_class, 12),
    reserve_nick: cleanText(body.reserve_nick, 24),
    reserve_class: cleanText(body.reserve_class, 12),
    submission_token: cleanText(body.submission_token, 50)
  };
  const required = ["team_name", "captain_nick", "captain_class", "player2_nick", "player2_class", "player3_nick", "player3_class"];
  if (required.some((key) => !team[key])) return { error: "Заполните все обязательные поля." };
  if (team.team_name.length < 2) return { error: "Название команды должно содержать хотя бы 2 символа." };
  if (!/^[0-9a-f-]{36}$/i.test(team.submission_token)) {
    return { error: "Не удалось проверить отправку формы. Обновите страницу и попробуйте снова." };
  }
  if (Boolean(team.reserve_nick) !== Boolean(team.reserve_class)) {
    return { error: "Для запасного игрока укажите и ник, и класс — либо оставьте оба поля пустыми." };
  }
  return { team };
}

export async function getRegistrationOpen(env = getEnv()) {
  const rows = await supabaseRequest("tournament_settings?select=registration_open&id=eq.1&limit=1", { env });
  return rows?.[0]?.registration_open ?? true;
}

export async function verifyAdmin(event, env = getEnv()) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;

  const response = await fetch(`${env.url}/auth/v1/user`, {
    headers: { apikey: env.anonKey, Authorization: `Bearer ${match[1]}` }
  });
  if (!response.ok) return false;
  const user = await response.json().catch(() => null);
  return Boolean(user?.email && user.email.trim().toLowerCase() === env.adminEmail);
}

export function adminError(error) {
  console.error("SCHOOL BRAWL CUP function error:", error);
  return json(500, { error: "На сервере произошла ошибка. Проверьте настройки базы данных и попробуйте позже." });
}
