import { createHash } from "node:crypto";
import {
  json, methodNotAllowed, getEnv, readJson, validateTeam,
  getRegistrationOpen, supabaseRequest, adminError
} from "./_lib.mjs";

export default async function handler(request, context) {
  if (request.method !== "POST") return methodNotAllowed("POST");
  try {
    const body = await readJson(request);
    if (!body) return json(400, { error: "Не удалось прочитать форму. Проверьте данные." });

    // Honeypot: отвечаем нейтрально, но не сохраняем заявку.
    if (typeof body.website === "string" && body.website.trim()) {
      return json(200, { ok: true, message: "Заявка отправлена организатору на проверку." });
    }

    const validation = validateTeam(body);
    if (validation.error) return json(400, { error: validation.error });

    const env = getEnv();
    if (!(await getRegistrationOpen(env))) {
      return json(403, { error: "Регистрация команд уже закрыта." });
    }

    const ip = context?.ip || request.headers.get("x-nf-client-connection-ip") || "unknown-client";
    const ipHash = createHash("sha256").update(String(ip)).digest("hex");
    const limit = await supabaseRequest("rpc/consume_registration_rate_limit", {
      method: "POST", body: { p_ip_hash: ipHash }, env
    });
    if (limit !== true) {
      return json(429, { error: "С этого подключения отправлено слишком много заявок. Попробуйте позже." });
    }

    const record = { ...validation.team, status: "pending", is_public: false };
    await supabaseRequest("teams?on_conflict=submission_token", {
      method: "POST",
      body: record,
      prefer: "resolution=ignore-duplicates,return=minimal",
      env
    });
    return json(200, { ok: true, message: "Заявка отправлена организатору на проверку!" });
  } catch (error) {
    if (error?.status === 409) {
      return json(200, { ok: true, message: "Эта заявка уже была отправлена организатору." });
    }
    return adminError(error);
  }
}
