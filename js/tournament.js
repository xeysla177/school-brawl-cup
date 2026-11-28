document.addEventListener("DOMContentLoaded", () => {
  const { API, $, escapeHTML } = window.SBC;
  const activeView = $("#active-view");
  const placeView = $("#place-view");
  const historyView = $("#history-view");
  const activeRoot = $("#active-tournament");
  const placeRoot = $("#place-time-info");
  const historyRoot = $("#history-list");
  let activeLoaded = false;
  let historyLoaded = false;
  let activeData = null;

  const dateText = value => value
    ? new Date(value).toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short" })
    : "Пока не указано";

  function teamName(id, teams) {
    return teams.find(team => team.id === id)?.team_name || "Ожидает соперника";
  }

  function rosterHTML(team) {
    if (!team) return "";
    const roster = Array.isArray(team.roster) ? team.roster : [];
    return `<div class="tournament-roster">${roster.map(player =>
      `<span><b>${escapeHTML(player.nick || "")}</b><small>${escapeHTML(player.klass || "")}</small></span>`
    ).join("")}</div>`;
  }

  function matchHTML(match, teams, finalRound) {
    const first = teamName(match.team1_id, teams);
    const second = teamName(match.team2_id, teams);
    const winner = match.winner_team_id;
    const state = match.status === "completed" ? "Завершён"
      : match.status === "bye" ? "Проход без матча"
      : match.status === "live" ? "Идёт матч" : "Ожидает";
    const score = match.score1 !== null && match.score2 !== null
      ? `${match.score1} : ${match.score2}` : "—";
    const label = match.round_number === finalRound && match.match_number === 2
      ? "МАТЧ ЗА 3-Е МЕСТО"
      : match.round_number === finalRound ? "ФИНАЛ" : `МАТЧ ${match.match_number}`;
    return `<article class="bracket-match ${match.status === "live" ? "is-live" : ""}">
      <div class="bracket-match-top"><span>${label}</span><span>${state}</span></div>
      <div class="bracket-side ${winner === match.team1_id && winner ? "is-winner" : ""}">
        <b>${escapeHTML(first)}</b><strong>${match.score1 ?? "—"}</strong>
      </div>
      <div class="bracket-score">${score}</div>
      <div class="bracket-side ${winner === match.team2_id && winner ? "is-winner" : ""}">
        <b>${escapeHTML(second)}</b><strong>${match.score2 ?? "—"}</strong>
      </div>
      <div class="bracket-meta">
        ${match.mode ? `<span>${escapeHTML(match.mode)}</span>` : ""}
        ${match.map ? `<span>${escapeHTML(match.map)}</span>` : ""}
      </div>
    </article>`;
  }

  function podiumHTML(data) {
    const placements = data.placements;
    if (!placements) return "";
    const teams = data.teams || [];
    const card = (label, id, medal) => {
      const team = teams.find(item => item.id === id);
      return team ? `<div class="podium-place"><span>${medal} ${label}</span><b>${escapeHTML(team.team_name)}</b></div>` : "";
    };
    const third = (placements.third || []).map(id => {
      const team = teams.find(item => item.id === id);
      return team ? `<div class="podium-place"><span>🥉 3 МЕСТО</span><b>${escapeHTML(team.team_name)}</b></div>` : "";
    }).join("");
    const hasBronzeMatch = (data.matches || []).some(match =>
      match.match_number === 2 &&
      match.round_number === Math.max(...(data.matches || []).map(item => Number(item.round_number) || 0))
    );
    const thirdText = hasBronzeMatch
      ? (placements.third || []).length ? "Бронзовый призёр определён в матче за 3-е место." : "Матч за 3-е место ещё не завершён."
      : "Третье место разделили команды, проигравшие в полуфиналах.";
    return `<section class="tournament-podium">
      <h3>ИТОГИ ТУРНИРА</h3>
      <div class="podium-grid">
        ${card("1 МЕСТО", placements.first, "🥇")}
        ${card("2 МЕСТО", placements.second, "🥈")}
        ${third}
      </div>
      <p>${thirdText}</p>
    </section>`;
  }

  function placeTimeHTML(data) {
    const tournament = data?.tournament;
    if (!tournament) {
      return '<div class="empty-state">Информация о месте и времени появится после создания турнира.</div>';
    }
    return `<section class="tournament-info-panel">
      <div class="eyebrow">ИНФОРМАЦИЯ ДЛЯ УЧАСТНИКОВ</div>
      <h2>${escapeHTML(tournament.name)}</h2>
      <div class="info-row"><span>МЕСТО ПРОВЕДЕНИЯ</span><b>${escapeHTML(tournament.venue || "Пока не указано")}</b></div>
      <div class="info-row"><span>ДАТА И ВРЕМЯ</span><b>${escapeHTML(dateText(tournament.starts_at))}</b></div>
      <div class="info-extra"><span>ДОПОЛНИТЕЛЬНАЯ ИНФОРМАЦИЯ</span>
        <p>${escapeHTML(tournament.details || "Дополнительной информации пока нет.")}</p>
      </div>
    </section>`;
  }

  function currentMatchHTML(data) {
    const teams = data.teams || [];
    const matches = data.matches || [];
    const match = matches.find(item => item.status === "live") ||
      matches.find(item => item.status === "pending" && item.team1_id && item.team2_id);
    if (!match) {
      return '<div class="tournament-current-match"><span>ТЕКУЩИЙ МАТЧ</span><b>Сейчас матч не проводится</b></div>';
    }
    const finalRound = Math.max(...matches.map(item => Number(item.round_number) || 0));
    const label = match.round_number === finalRound && match.match_number === 2
      ? "МАТЧ ЗА 3-Е МЕСТО"
      : match.round_number === finalRound ? "ФИНАЛ" : "СЛЕДУЮЩИЙ МАТЧ";
    return `<div class="tournament-current-match">
      <span>${match.status === "live" ? "СЕЙЧАС ИДЁТ МАТЧ" : label}</span>
      <b>${escapeHTML(teamName(match.team1_id, teams))} <i>VS</i> ${escapeHTML(teamName(match.team2_id, teams))}</b>
      <small>${match.mode ? escapeHTML(match.mode) : "Режим ещё не выбран"}${match.map ? ` · ${escapeHTML(match.map)}` : ""}</small>
    </div>`;
  }

  function tournamentHTML(data, archived = false) {
    const tournament = data.tournament;
    const teams = data.teams || [];
    const matches = data.matches || [];
    if (!tournament) return '<div class="empty-state">Сейчас активного турнира нет. Следи за обновлениями!</div>';

    const rounds = [...new Set(matches.map(match => match.round_number))].sort((a, b) => a - b);
    const finalRound = Math.max(...matches.map(item => Number(item.round_number) || 0));
    const hasBronzeMatch = matches.some(match => match.round_number === finalRound && match.match_number === 2);
    const champion = teams.find(team => team.id === tournament.champion_team_id);
    const bracket = rounds.map(round => {
      const roundMatches = matches.filter(match => match.round_number === round);
      const title = rounds.length === 1 ? "Финал"
        : round === finalRound && hasBronzeMatch ? "ФИНАЛ И МАТЧ ЗА 3-Е МЕСТО"
        : round === finalRound ? "Финал"
        : round === finalRound - 1 ? "Полуфиналы" : `Раунд ${round}`;
      return `<section class="bracket-round"><h3>${title}</h3>
        <div class="bracket-round-list">${roundMatches.map(match => matchHTML(match, teams, finalRound)).join("")}</div>
      </section>`;
    }).join("");

    return `<div class="tournament-summary">
      <div>
        <div class="eyebrow">${archived ? "АРХИВ ТУРНИРА" : "АКТИВНЫЙ ТУРНИР"}</div>
        <h2>${escapeHTML(tournament.name)}</h2>
        <p>${escapeHTML(tournament.venue || "Место проведения уточняется")}</p>
        <p class="tournament-date">${escapeHTML(dateText(tournament.starts_at))}</p>
      </div>
      ${champion
        ? `<div class="champion-card"><span>🏆 ЧЕМПИОН</span><b>${escapeHTML(champion.team_name)}</b></div>`
        : `<div class="tournament-live-state">${archived ? "ЗАВЕРШЁН" : "ТУРНИР ИДЁТ"}</div>`}
    </div>
    ${!archived ? currentMatchHTML(data) : podiumHTML(data)}
    ${archived ? placeTimeHTML(data) : ""}
    <div class="bracket-scroll"><div class="bracket-grid">${bracket}</div></div>
    <section class="tournament-participants">
      <h3>УЧАСТНИКИ ТУРНИРА</h3>
      <div class="tournament-team-grid">${teams.map(team =>
        `<article class="tournament-team-card">
          <div><span>КОМАНДА №${escapeHTML(team.team_number)}</span><b>${escapeHTML(team.team_name)}</b></div>
          ${rosterHTML(team)}
        </article>`
      ).join("")}</div>
    </section>`;
  }

  async function loadActive() {
    activeRoot.innerHTML = '<div class="empty-state">Загружаем турнир…</div>';
    try {
      const response = await fetch(`${API}/tournament`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить турнир.");
      activeData = data.tournament ? data : null;
      activeRoot.innerHTML = tournamentHTML(data);
      placeRoot.innerHTML = placeTimeHTML(activeData);
      activeLoaded = true;
    } catch (error) {
      activeRoot.innerHTML = `<div class="empty-state">${escapeHTML(error.message)}</div>`;
      placeRoot.innerHTML = `<div class="empty-state">${escapeHTML(error.message)}</div>`;
    }
  }

  async function loadHistory() {
    historyRoot.innerHTML = '<div class="empty-state">Загружаем историю…</div>';
    try {
      const response = await fetch(`${API}/tournament?history=1`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить историю.");
      const history = data.history || [];
      historyRoot.innerHTML = history.length
        ? history.map(item =>
          `<details class="history-item">
            <summary>
              <span><b>${escapeHTML(item.tournament.name)}</b>
              <small>${escapeHTML(dateText(item.tournament.completed_at || item.tournament.starts_at))}</small></span>
              <strong>Открыть архив ↓</strong>
            </summary>
            ${tournamentHTML(item, true)}
          </details>`
        ).join("")
        : '<div class="empty-state">Завершённых турниров пока нет.</div>';
      historyLoaded = true;
    } catch (error) {
      historyRoot.innerHTML = `<div class="empty-state">${escapeHTML(error.message)}</div>`;
    }
  }

  document.querySelectorAll(".tournament-tab").forEach(button => {
    button.addEventListener("click", async () => {
      document.querySelectorAll(".tournament-tab").forEach(item =>
        item.classList.toggle("active", item === button)
      );
      const tab = button.dataset.tab;
      activeView.classList.toggle("hidden", tab !== "active");
      placeView.classList.toggle("hidden", tab !== "place");
      historyView.classList.toggle("hidden", tab !== "history");
      if (tab === "history" && !historyLoaded) await loadHistory();
      if ((tab === "active" || tab === "place") && !activeLoaded) await loadActive();
    });
  });

  loadActive();
});
