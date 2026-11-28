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

  // Ranked Season 51 map pool, current as of 28 November 2026.
  const MAPS = {
    "Захват кристаллов": ["Double Swoosh", "Gem Fort", "Hard Rock Mine", "Undermine"],
    "Ограбление": ["Bridge Too Far", "Hot Potato", "Kaboom Canyon", "Safe Zone"],
    "Награда за поимку": ["Dry Season", "Hideout", "Layer Cake", "Shooting Star"],
    "Броулбол": ["Center Stage", "Pinball Dreams", "Sneaky Fields", "Triple Dribble"],
    "Горячая зона": ["Dueling Beetles", "Open Business", "Parallel Plays", "Ring of Fire"],
    "Нокаут": ["Belle's Rock", "Flaring Phoenix", "New Horizons", "Out in the Open"]
  };
  const MODES = Object.keys(MAPS);

  const dateText = value => value
    ? new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })
    : "Не указано";

  const toLocalInput = value => {
    if (!value) return "";
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

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
    const response = await fetch(`${API}/tournament`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Не удалось загрузить турнир.");
    snapshot = data.tournament ? data : null;
    render();
  }

  function renderMatch(match, teams) {
    const first = teams.find(team => team.id === match.team1_id);
    const second = teams.find(team => team.id === match.team2_id);
    const finished = ["completed", "bye"].includes(match.status);
    const ready = Boolean(first && second) && !finished;
    const modeOptions = `<option value="">Выбрать режим</option>` + MODES.map(mode =>
      `<option value="${escapeHTML(mode)}" ${match.mode === mode ? "selected" : ""}>${escapeHTML(mode)}</option>`
    ).join("");
    const mapList = MAPS[match.mode] || [];
    const mapOptions = `<option value="">Выбрать карту</option>` + mapList.map(map =>
      `<option value="${escapeHTML(map)}" ${match.map === map ? "selected" : ""}>${escapeHTML(map)}</option>`
    ).join("");
    const winnerOptions = [
      first ? `<option value="${first.id}" ${match.winner_team_id === first.id ? "selected" : ""}>${escapeHTML(first.team_name)}</option>` : "",
      second ? `<option value="${second.id}" ${match.winner_team_id === second.id ? "selected" : ""}>${escapeHTML(second.team_name)}</option>` : ""
    ].join("");
    const status = match.status === "bye" ? "BYE · ПРОШЛА ДАЛЬШЕ"
      : match.status === "completed" ? "ЗАВЕРШЁН"
      : match.status === "live" ? "ИДЁТ МАТЧ" : "ОЖИДАЕТ";
    const finalRound = Math.max(...(snapshot?.matches || []).map(item => Number(item.round_number) || 0));
    const matchTitle = match.round_number === finalRound && match.match_number === 2
      ? "МАТЧ ЗА 3-Е МЕСТО"
      : match.round_number === finalRound ? "ФИНАЛ"
      : `Раунд ${match.round_number} · Матч ${match.match_number}`;

    return `<article class="t-admin-match" data-match="${match.id}">
      <div class="t-admin-match-head"><b>${matchTitle}</b><span>${status}</span></div>
      <div class="t-admin-versus">
        <span>${escapeHTML(first?.team_name || "Ожидает")}</span><i>VS</i>
        <span>${escapeHTML(second?.team_name || "Ожидает")}</span>
      </div>
      ${match.status === "bye"
        ? '<p class="t-admin-bye">Команда автоматически проходит в следующий раунд.</p>'
        : `<div class="t-admin-controls">
            <label>Режим<select class="t-match-mode" ${ready ? "" : "disabled"}>${modeOptions}</select></label>
            <label>Карта<select class="t-match-map" ${ready ? "" : "disabled"}>${mapOptions}</select></label>
            <button class="admin-action t-random-map" type="button" ${ready ? "" : "disabled"}>🎲 Случайно</button>
            <button class="admin-action t-save-map" type="button" ${ready ? "" : "disabled"}>Сохранить карту</button>
          </div>
          <div class="t-admin-result">
            <label>Счёт команды 1<input class="t-score1" type="number" min="0" max="99" value="${match.score1 ?? ""}" ${ready ? "" : "disabled"}></label>
            <label>Счёт команды 2<input class="t-score2" type="number" min="0" max="99" value="${match.score2 ?? ""}" ${ready ? "" : "disabled"}></label>
            <label>Победитель<select class="t-winner" ${ready ? "" : "disabled"}>${winnerOptions}</select></label>
            <button class="admin-action t-save-result" type="button" ${ready ? "" : "disabled"}>Записать результат</button>
          </div>
          ${finished ? `<p class="t-admin-bye">Результат: ${match.score1 ?? "—"} : ${match.score2 ?? "—"}</p>` : ""}`
      }
    </article>`;
  }

  function render() {
    setup.classList.toggle("hidden", Boolean(snapshot));
    activePanel.classList.toggle("hidden", !snapshot);
    if (!snapshot) return;

    const tournament = snapshot.tournament;
    $("#tournament-current-name").textContent = tournament.name;
    $("#tournament-current-info").textContent =
      `${tournament.venue || "Место не указано"} · ${dateText(tournament.starts_at)}`;
    $("#tournament-edit-name").value = tournament.name || "";
    $("#tournament-edit-venue").value = tournament.venue || "";
    $("#tournament-edit-start").value = toLocalInput(tournament.starts_at);
    $("#tournament-edit-details").value = tournament.details || "";

    const teams = snapshot.teams || [];
    const rounds = [...new Set((snapshot.matches || []).map(match => match.round_number))]
      .sort((a, b) => a - b);
    const hasBronzeMatch = (snapshot.matches || []).some(match =>
      match.match_number === 2 && match.round_number === rounds[rounds.length - 1]
    );
    matchesRoot.innerHTML = rounds.map(round =>
      `<section class="t-admin-round">
        <h4>${round === rounds.length && hasBronzeMatch ? "ФИНАЛ И МАТЧ ЗА 3-Е МЕСТО" : round === rounds.length ? "ФИНАЛ" : round === rounds.length - 1 ? "ПОЛУФИНАЛЫ" : `РАУНД ${round}`}</h4>
        ${snapshot.matches.filter(match => match.round_number === round)
          .map(match => renderMatch(match, teams)).join("")}
      </section>`
    ).join("");
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
      const starts = $("#tournament-new-start").value;
      await call({
        action: "create",
        name: $("#tournament-new-name").value,
        venue: $("#tournament-new-venue").value,
        starts_at: starts ? new Date(starts).toISOString() : null,
        details: $("#tournament-new-details").value
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
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const starts = $("#tournament-edit-start").value;
      await call({
        action: "update_info",
        name: $("#tournament-edit-name").value,
        venue: $("#tournament-edit-venue").value,
        starts_at: starts ? new Date(starts).toISOString() : null,
        details: $("#tournament-edit-details").value
      });
      message("Место, время и дополнительная информация сохранены.");
      await refresh();
    } catch (error) {
      message(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  matchesRoot.addEventListener("change", event => {
    const card = event.target.closest(".t-admin-match");
    if (!card || !event.target.matches(".t-match-mode")) return;
    const maps = MAPS[event.target.value] || [];
    card.querySelector(".t-match-map").innerHTML =
      `<option value="">Выбрать карту</option>` +
      maps.map(map => `<option value="${escapeHTML(map)}">${escapeHTML(map)}</option>`).join("");
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
        card.querySelector(".t-match-map").innerHTML = maps.map(item =>
          `<option value="${escapeHTML(item)}" ${item === map ? "selected" : ""}>${escapeHTML(item)}</option>`
        ).join("");
        await call({ action: "set_match", match_id: matchId, mode, map, selection_method: "random" });
        message("Случайные режим и карта назначены.");
        await refresh();
      } else if (event.target.closest(".t-save-map")) {
        const mode = card.querySelector(".t-match-mode").value;
        const map = card.querySelector(".t-match-map").value;
        if (!mode || !map) throw new Error("Выберите режим и карту.");
        await call({ action: "set_match", match_id: matchId, mode, map, selection_method: "manual" });
        message("Карта и режим сохранены.");
        await refresh();
      } else if (event.target.closest(".t-save-result")) {
        const winner = card.querySelector(".t-winner").value;
        await call({
          action: "set_result",
          match_id: matchId,
          winner_team_id: winner,
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
    if (!window.confirm(
      "Завершить турнир? Сетка и составы попадут в историю, опубликованные команды будут скрыты из активного списка. Заявки не удаляются."
    )) return;
    const button = $("#tournament-finish-button");
    button.disabled = true;
    try {
      await call({ action: "finish" });
      message("Турнир завершён и сохранён в истории.");
      await refresh();
    } catch (error) {
      message(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
});
