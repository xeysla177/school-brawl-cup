import {
  json, methodNotAllowed, getEnv, readJson, verifyAdmin,
  supabaseRequest, cleanText, adminError
} from "./_lib.mjs";

const EDITABLE_TEXT = {
  team_name: 32,
  captain_nick: 24, captain_class: 12,
  player2_nick: 24, player2_class: 12,
  player3_nick: 24, player3_class: 12,
  reserve_nick: 24, reserve_class: 12
};

export default async function handler(request) {
  if (request.method !== "POST") return methodNotAllowed("POST");
  try {
    const env = getEnv();
    if (!(await verifyAdmin(request, env))) return json(401, { error: "Доступ запрещён. Войдите под учётной записью организатора." });

    const body = await readJson(request);
    if (!body || typeof body.action !== "string") return json(400, { error: "Некорректная команда панели." });

    if (body.action === "list") {
      const rows = await supabaseRequest("teams?select=*&order=created_at.desc", { env });
      return json(200, { teams: rows || [] });
    }

    if (body.action === "settings") {
      const rows = await supabaseRequest("tournament_settings?select=id,registration_open&id=eq.1&limit=1", { env });
      return json(200, { settings: rows?.[0] || { id: 1, registration_open: true } });
    }

    if (body.action === "set_registration") {
      if (typeof body.open !== "boolean") return json(400, { error: "Укажите статус регистрации." });
      await supabaseRequest("tournament_settings?id=eq.1", {
        method: "PATCH", body: { registration_open: body.open, updated_at: new Date().toISOString() },
        prefer: "return=minimal", env
      });
      return json(200, { ok: true });
    }

    if (body.action === "update") {
      const id = cleanText(body.id, 50);
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "Не найдена выбранная команда." });
      if (!body.patch || typeof body.patch !== "object" || Array.isArray(body.patch)) return json(400, { error: "Нет данных для изменения." });
      const patch = {};
      for (const [key, max] of Object.entries(EDITABLE_TEXT)) {
        if (Object.hasOwn(body.patch, key)) patch[key] = cleanText(body.patch[key], max);
      }
      if (Object.hasOwn(body.patch, "status")) {
        if (!["pending", "approved", "rejected"].includes(body.patch.status)) return json(400, { error: "Недопустимый статус заявки." });
        patch.status = body.patch.status;
      }
      if (Object.hasOwn(body.patch, "is_public")) {
        if (typeof body.patch.is_public !== "boolean") return json(400, { error: "Недопустимое значение публикации." });
        patch.is_public = body.patch.is_public;
      }
      if (Object.keys(patch).length === 0) return json(400, { error: "Нет данных для изменения." });
      const currentRows = await supabaseRequest(
        `teams?select=status,${Object.keys(EDITABLE_TEXT).join(",")}&id=eq.${encodeURIComponent(id)}&limit=1`,
        { env }
      );
      const current = currentRows?.[0];
      if (!current) return json(404, { error: "Эта заявка уже не существует." });
      const merged = { ...current, ...patch };
      const requiredFields = ["team_name", "captain_nick", "captain_class", "player2_nick", "player2_class", "player3_nick", "player3_class"];
      if (requiredFields.some((key) => !String(merged[key] || "").trim())) {
        return json(400, { error: "Название команды, ники и классы трёх основных игроков нельзя оставлять пустыми." });
      }
      if (String(merged.team_name).length < 2) return json(400, { error: "Название команды должно содержать хотя бы 2 символа." });
      if (Boolean(String(merged.reserve_nick || "").trim()) !== Boolean(String(merged.reserve_class || "").trim())) {
        return json(400, { error: "Для запасного игрока укажите и ник, и класс — либо очистите оба поля." });
      }
      if (patch.status && patch.status !== "approved") patch.is_public = false;
      const effectiveStatus = patch.status || current.status;
      if (patch.is_public === true && effectiveStatus !== "approved") {
        return json(400, { error: "Сначала подтвердите заявку, затем публикуйте её." });
      }
      await supabaseRequest(`teams?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH", body: patch, prefer: "return=minimal", env
      });
      return json(200, { ok: true });
    }

    if (body.action === "delete") {
      const id = cleanText(body.id, 50);
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "Не найдена выбранная команда." });
      await supabaseRequest(`teams?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", prefer: "return=minimal", env });
      return json(200, { ok: true });
    }

    return json(400, { error: "Неизвестная команда панели." });
  } catch (error) {
    return adminError(error);
  }
}
