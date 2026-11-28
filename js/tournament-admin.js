document.addEventListener("DOMContentLoaded", () => {
  const { API, $, escapeHTML } = window.SBC;
  const section = $("#tournament-admin");
  if (!section) return;

  const notice = $("#tournament-admin-notice");
  const setup = $("#tournament-create-form");
  const activePanel = $("#tournament-active-admin");
  const matchesRoot = $("#tournament-admin-matches");
  let token = null;
  let snapshot = null;

  const MAPS = {
    "Захват кристаллов": ["Double Swoosh", "Gem Fort", "Hard Rock Mine", "Undermine"],
    "Ограбление": ["Bridge Too Far", "Hot Potato", "Kaboom Canyon", "Safe Zone"],
    "Награда за поимку": ["Dry Season", "Hideout", "Layer Cake", "Shooting Star"],
    "Броулбол": ["Center Stage", "Pinball Dreams", "Sneaky Fields", "Triple Dribble"],
    "Горячая зона": ["Dueling Beetles", "Open Business", "Parallel Plays", "Ring of Fire"],
    "Нокаут": ["Belle's Rock", "Flaring Phoenix", "New Horizons", "Out in the Open"]
  };
  const MODES = Object.keys(MAPS);
  const dateValue = value => value ? new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "Не указано";

  function message(text, error = false) {
    notice.textContent = text;
    notice.classList.toggle("error", error);
  }

  async function call(body) {
    const response = await fetch(`${API}/tournament-admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error("Сессия истекла. Войдите в панель заново.");
    if (!response.ok) throw new Error(data.error || `Ошибка сервера (${response.status}).`);
    return data;
  }

  async function getSnapshot() {
    const response = await fetch(`${API}/tournament`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Не удалось загрузить турнир.");
    snapshot = data.tournament ? data : null;
    render();
  }

  function renderMatch(match, teams) {
    const first = teams.find(t => t.id === match.team1_id);
    const second = teams.find(t => t.id === match.team2_id);
    const finished = ["completed", "bye"].includes(match.status);
    const modeOptions = MODES.map(mode => `<option value="${escapeHTML(mode)}" ${match.mode === mode ? "selected" : ""}>${escapeHTML(mode)}</option>`).join("");
    const mapList = MAPS[match.mode] || MAPS[MODES[0]];
    const mapOptions = mapList.map(map => `<option value="${escapeHTML(map)}" ${match.map === map ? "selected" : ""}>${escapeHTML(map)}</option>`).join("");
    const winnerOptions = [
      first ? `<option value="${first.id}" ${match.winner_team_id === first.id ? "selected" : ""}>${escapeHTML(first.team_name)}</option>` : "",
      second ? `<option value="${second.id}" ${match.winner_team_id === second.id ? "selected" : ""}>${escapeHTML(second.team_name)}</option>` : ""
    ].join("");
    const status = match.status === "bye" ? "BYE · ПРОШЛА ДАЛЬШЕ" : match.status === "completed" ? "ЗАВЕРШЁН" : match.status === "live" ? "ИДЁТ МАТЧ" : "ОЖИДАЕТ";
    return `<article class="t-admin-match" data-match="${match.id}">
      <div class="t-admin-match-head"><b>Раунд ${match.round_number} · Матч ${match.match_number}</b><span>${status}</span></div>
      <div class="t-admin-versus"><span>${escapeHTML(first?.team_name || "Ожидает")}</span><i>VS</i><span>${escapeHTML(second?.team_name || "Ожидает")}</span></div>
      ${match.status === "bye" ? '<p class="t-admin-bye">Команда автоматически проходит в следующий раунд.</p>' : `
      <div class="t-admin-controls">
        <label>Режим<select class="t-match-mode" ${finished ? "disabled" : ""}>${modeOptions}</select></label>
        <label>Карта<select class="t-match-map" ${finished ? "disabled" : ""}>${mapOptions}</select></label>
        <button class="admin-action t-random-map" type="button" ${finished ? "disabled" : ""}>🎲 Случайно</button>
        <button class="admin-action t-save-map" type="button" ${finished ? "disabled" : ""}>Сохранить карту</button>
      </div>
      <div class="t-admin-result">
        <label>Счёт команды 1<input class="t-score1" type="number" min="0" max="99" value="${match.score1 ?? ""}" ${finished || !second ? "disabled" : ""}></label>
        <label>Счёт команды 2<input class="t-score2" type="number" min="0" max="99" value="${match.score2 ?? ""}" ${finished || !second ? "disabled" : ""}></label>
        <label>Победитель<select class="t-winner" ${finished || !second ? "disabled" : ""}>${winnerOptions}</select></label>
        <button class="admin-action t-save-result" type="button" ${finished || !second ? "disabled" : ""}>Записать результат</button>
      </div>`}
    </article>`;
  }

  function render() {
    setup.classList.toggle("hidden", Boolean(snapshot));
    activePanel.classList.toggle("hidden", !snapshot);
    if (!snapshot) return;
    const t = snapshot.tournament;
    $("#tournament-current-name").textContent = t.name;
    $("#tournament-current-info").textContent = `${t.venue || "Место не указано"} · ${dateValue(t.starts_at)}`;
    $("#tournament-edit-name").value = t.name || "";
    $("#tournament-edit-venue").value = t.venue || "";
    $("#tournament-edit-start").value = t.starts_at ? new Date(t.starts_at).toISOString().slice(0,16) : "";
    const teams = snapshot.teams || [];
    const rounds = [...new Set((snapshot.matches || []).map(m => m.round_number))].sort((a,b) => a-b);
    matchesRoot.innerHTML = rounds.map(round => `<section class="t-admin-round"><h4>${round === rounds.length ? "ФИНАЛ" : round === rounds.length - 1 ? "ПОЛУФИНАЛЫ" : `РАУНД ${round}`}</h4>${snapshot.matches.filter(m => m.round_number === round).map(m => renderMatch(m, teams)).join("")}</section>`).join("");
  }

  async function refresh() {
    if (!token) return;
    try {
      await getSnapshot();
    } catch (error) {
      message(error.message, true);
    }
  }

  window.addEventListener("sbc:admin-auth", event => {
    token = event.detail?.token || null;
    if (token) refresh();
    else {
      snapshot = null;
      setup.classList.remove("hidden");
      activePanel.classList.add("hidden");
    }
  });

  setup.addEventListener("submit", async event => {
    event.preventDefault();
    if (!token) return;
    const button = setup.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await call({
        action: "create",
        name: $("#tournament-new-name").value,
        venue: $("#tournament-new-venue").value,
        starts_at: $("#tournament-new-start").value ? new Date($("#tournament-new-start").value).toISOString() : null
      });
      message("Турнир создан, сетка сформирована случайным образом.");
      await refresh();
    } catch (error) {
      message(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  $("#tournament-info-form").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await call({
        action: "update_info",
        name: $("#tournament-edit-name").value,
        venue: $("#tournament-edit-venue").value,
        starts_at: $("#tournament-edit-start").value ? new Date($("#tournament-edit-start").value).toISOString() : null
      });
      message("Информация о турнире сохранена.");
      await refresh();
    } catch (error) {
      message(error.message, true);
    }
  });

  matchesRoot.addEventListener("change", event => {
    const card = event.target.closest(".t-admin-match");
    if (!card || !event.target.matches(".t-match-mode")) return;
    const maps = MAPS[event.target.value] || [];
    card.querySelector(".t-match-map").innerHTML = maps.map(m => `<option value="${escapeHTML(m)}">${escapeHTML(m)}</option>`).join("");
  });

  matchesRoot.addEventListener("click", async event => {
    const card = event.target.closest(".t-admin-match");
    if (!card) return;
    const matchId = card.dataset.match;
    try {
      if (event.target.closest(".t-random-map")) {
        const mode = MODES[Math.floor(Math.random() * MODES.length)];
        const maps = MAPS[mode];
        const map = maps[Math.floor(Math.random() * maps.length)];
        card.querySelector(".t-match-mode").value = mode;
        card.querySelector(".t-match-map").innerHTML = maps.map(m => `<option value="${escapeHTML(m)}" ${m === map ? "selected" : ""}>${escapeHTML(m)}</option>`).join("");
        await call({ action: "set_match", match_id: matchId, mode, map, selection_method: "random" });
        message("Случайные режим и карта назначены.");
        await refresh();
      } else if (event.target.closest(".t-save-map")) {
        await call({
          action: "set_match", match_id: matchId,
          mode: card.querySelector(".t-match-mode").value,
          map: card.querySelector(".t-match-map").value,
          selection_method: "manual"
        });
        message("Карта и режим сохранены.");
        await refresh();
      } else if (event.target.closest(".t-save-result")) {
        const winner = card.querySelector(".t-winner").value;
        await call({
          action: "set_result", match_id: matchId, winner_team_id: winner,
          score1: card.querySelector(".t-score1").value,
          score2: card.querySelector(".t-score2").value
        });
        message("Результат записан, победитель продвинут дальше.");
        await refresh();
      }
    } catch (error) {
      message(error.message, true);
    }
  });

  $("#tournament-finish-button").addEventListener("click", async () => {
    if (!window.confirm("Завершить турнир? Сетка попадёт в историю, а опубликованные команды будут скрыты из активного списка. Заявки не удаляются.")) return;
    try {
      await call({ action: "finish" });
      message("Турнир завершён и сохранён в истории.");
      await refresh();
    } catch (error) {
      message(error.message, true);
    }
  });
});
