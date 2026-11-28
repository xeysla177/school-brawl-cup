document.addEventListener("DOMContentLoaded", () => {
  const { API, $, escapeHTML, setMessage, rosterEntries } = window.SBC;
  const loginPanel = $("#login-panel");
  const dashboard = $("#dashboard");
  const loginForm = $("#login-form");
  const loginMessage = $("#login-message");
  const loginButton = $("#login-button");
  const teamList = $("#admin-team-list");
  const notice = $("#admin-notice");
  const registrationToggle = $("#registration-toggle");
  let accessToken = null;
  let allTeams = [];

  function emitAuth() {
    window.dispatchEvent(new CustomEvent("sbc:admin-auth", { detail: { token: accessToken } }));
  }

  async function getConfig() {
    const response = await fetch(`${API}/config`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Сервер не настроен.");
    return data;
  }

  async function adminCall(body) {
    const response = await fetch(`${API}/admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      logout();
      throw new Error("Сессия завершена. Войдите снова.");
    }
    if (!response.ok) throw new Error(data.error || `Ошибка (${response.status}).`);
    return data;
  }

  function showNotice(text, error = false) {
    notice.textContent = text;
    notice.classList.toggle("error", error);
  }

  function statusLabel(status) {
    return ({ pending: "НА ПРОВЕРКЕ", approved: "ПОДТВЕРЖДЕНА", rejected: "ОТКЛОНЕНА" })[status] || status;
  }

  function renderTeam(team) {
    const entries = rosterEntries(team).map((player) => `<span>${player.reserve ? "Запасной: " : ""}<b>${escapeHTML(player.nick)}</b> · ${escapeHTML(player.klass)}</span>`).join("");
    const actions = [];
    if (team.status !== "approved") actions.push(`<button class="admin-action approve" type="button" data-team-action="approve" data-id="${team.id}">✓ Подтвердить</button>`);
    if (team.status !== "rejected") actions.push(`<button class="admin-action reject" type="button" data-team-action="reject" data-id="${team.id}">Отклонить</button>`);
    if (team.status === "approved") actions.push(`<button class="admin-action publish" type="button" data-team-action="publish" data-id="${team.id}" data-public="${team.is_public}">${team.is_public ? "Скрыть с сайта" : "Опубликовать на сайте"}</button>`);
    actions.push(`<button class="admin-action delete" type="button" data-team-action="delete" data-id="${team.id}">Удалить</button>`);

    const fields = [
      ["team_name", "Название команды"], ["captain_nick", "Ник капитана"], ["captain_class", "Класс капитана"],
      ["player2_nick", "Ник игрока 2"], ["player2_class", "Класс игрока 2"], ["player3_nick", "Ник игрока 3"],
      ["player3_class", "Класс игрока 3"], ["reserve_nick", "Ник запасного"], ["reserve_class", "Класс запасного"]
    ];
    const editFields = fields.map(([key, label]) => `<label>${label}<input name="${key}" maxlength="${key.includes("class") ? 12 : key === "team_name" ? 32 : 24}" value="${escapeHTML(team[key] || "")}"></label>`).join("");
    const date = team.created_at ? new Date(team.created_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "";
    return `<article class="admin-team-card" data-id="${team.id}">
      <div class="admin-team-head"><div class="admin-team-title"><span>№${escapeHTML(team.team_number)}</span><h4>${escapeHTML(team.team_name)}</h4></div><span class="status-pill status-${escapeHTML(team.status)}">${statusLabel(team.status)}</span></div>
      <div class="admin-team-roster">${entries}</div>
      <div class="admin-team-actions">${actions.join("")}</div>
      <details class="admin-edit"><summary>Редактировать данные команды</summary><form class="admin-edit-form" data-id="${team.id}"><div class="admin-edit-grid">${editFields}</div><button class="admin-action admin-edit-save" type="submit">Сохранить изменения</button></form></details>
      <div class="team-meta"><span>${team.is_public ? "ОПУБЛИКОВАНА" : "НЕ ОПУБЛИКОВАНА"}</span><span>${escapeHTML(date)}</span></div>
    </article>`;
  }

  function renderTeams() {
    const query = $("#admin-search").value.trim().toLocaleLowerCase("ru-RU");
    const status = $("#status-filter").value;
    const filtered = allTeams.filter((team) => {
      const matchName = team.team_name.toLocaleLowerCase("ru-RU").includes(query);
      const matchStatus = status === "all" || team.status === status;
      return matchName && matchStatus;
    });
    teamList.innerHTML = filtered.length ? filtered.map(renderTeam).join("") : '<div class="empty-state">По этому фильтру заявок нет.</div>';
    $("#dash-total").textContent = allTeams.length;
    $("#dash-pending").textContent = allTeams.filter((team) => team.status === "pending").length;
    $("#dash-approved").textContent = allTeams.filter((team) => team.status === "approved").length;
    $("#dash-public").textContent = allTeams.filter((team) => team.status === "approved" && team.is_public).length;
  }

  async function refreshTeams() {
    const result = await adminCall({ action: "list" });
    allTeams = result.teams || [];
    renderTeams();
  }

  async function refreshSettings() {
    const result = await adminCall({ action: "settings" });
    const open = Boolean(result.settings?.registration_open);
    registrationToggle.checked = open;
    $("#registration-toggle-label").textContent = open ? "Открыта" : "Закрыта";
    $("#registration-setting-copy").textContent = open ? "Новые команды могут отправлять заявки." : "Приём новых заявок временно остановлен.";
  }

  async function enterDashboard() {
    loginPanel.classList.add("hidden");
    dashboard.classList.remove("hidden");
    emitAuth();
    try {
      await Promise.all([refreshTeams(), refreshSettings()]);
    } catch (error) {
      showNotice(error.message, true);
    }
  }

  function logout() {
    accessToken = null;
    emitAuth();
    dashboard.classList.add("hidden");
    loginPanel.classList.remove("hidden");
    loginForm.reset();
    setMessage(loginMessage, "");
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginButton.disabled = true;
    loginButton.textContent = "ПРОВЕРЯЕМ ДАННЫЕ…";
    setMessage(loginMessage, "Выполняется вход…");
    try {
      const config = await getConfig();
      const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: config.supabaseAnonKey },
        body: JSON.stringify({ email: $("#admin-email").value.trim(), password: $("#admin-password").value })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.access_token) throw new Error(result.msg || result.message || "Неверная почта или пароль.");
      accessToken = result.access_token;
      await enterDashboard();
    } catch (error) {
      setMessage(loginMessage, error.message, "error");
      accessToken = null;
      emitAuth();
    } finally {
      loginButton.disabled = false;
      loginButton.innerHTML = 'Войти в панель <span>↗</span>';
    }
  });

  $("#logout-button").addEventListener("click", logout);
  $("#admin-search").addEventListener("input", renderTeams);
  $("#status-filter").addEventListener("change", renderTeams);

  registrationToggle.addEventListener("change", async () => {
    const desired = registrationToggle.checked;
    registrationToggle.disabled = true;
    try {
      await adminCall({ action: "set_registration", open: desired });
      $("#registration-toggle-label").textContent = desired ? "Открыта" : "Закрыта";
      $("#registration-setting-copy").textContent = desired ? "Новые команды могут отправлять заявки." : "Приём новых заявок временно остановлен.";
      showNotice(desired ? "Регистрация открыта." : "Регистрация закрыта.");
    } catch (error) {
      registrationToggle.checked = !desired;
      showNotice(error.message, true);
    } finally {
      registrationToggle.disabled = false;
    }
  });

  teamList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-team-action]");
    if (!button) return;
    const id = button.dataset.id;
    const action = button.dataset.teamAction;
    try {
      button.disabled = true;
      if (action === "delete") {
        if (!window.confirm("Удалить заявку этой команды без возможности восстановления?")) return;
        await adminCall({ action: "delete", id });
        showNotice("Заявка удалена.");
      } else if (action === "approve") {
        await adminCall({ action: "update", id, patch: { status: "approved", is_public: false } });
        showNotice("Команда подтверждена. Для показа на сайте нажмите «Опубликовать на сайте». ");
      } else if (action === "reject") {
        await adminCall({ action: "update", id, patch: { status: "rejected", is_public: false } });
        showNotice("Заявка отклонена.");
      } else if (action === "publish") {
        const publish = button.dataset.public !== "true";
        await adminCall({ action: "update", id, patch: { is_public: publish } });
        showNotice(publish ? "Команда опубликована на сайте." : "Команда скрыта с сайта.");
      }
      await refreshTeams();
    } catch (error) {
      showNotice(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  teamList.addEventListener("submit", async (event) => {
    const form = event.target.closest(".admin-edit-form");
    if (!form) return;
    event.preventDefault();
    const save = form.querySelector("button[type='submit']");
    const patch = Object.fromEntries(new FormData(form).entries());
    save.disabled = true;
    try {
      await adminCall({ action: "update", id: form.dataset.id, patch });
      showNotice("Данные команды обновлены.");
      await refreshTeams();
    } catch (error) {
      showNotice(error.message, true);
    } finally {
      save.disabled = false;
    }
  });
});
