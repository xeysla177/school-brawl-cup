document.addEventListener("DOMContentLoaded", () => {
  const { API, $, escapeHTML } = window.SBC;
  const activeView = $("#active-view");
  const historyView = $("#history-view");
  const activeRoot = $("#active-tournament");
  const historyRoot = $("#history-list");
  let activeLoaded = false;
  let historyLoaded = false;

  const dateText = value => value ? new Date(value).toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short" }) : "Пока не указано";

  function teamName(id, teams) {
    return teams.find(t => t.id === id)?.team_name || "Ожидает соперника";
  }

  function rosterHTML(team) {
    if (!team) return "";
    const roster = Array.isArray(team.roster) ? team.roster : [];
    return `<div class="tournament-roster">${roster.map(p =>
      `<span><b>${escapeHTML(p.nick || "")}</b><small>${escapeHTML(p.klass || "")}</small></span>`
    ).join("")}</div>`;
  }

  function matchHTML(match, teams) {
    const a = teamName(match.team1_id, teams);
    const b = teamName(match.team2_id, teams);
    const winner = match.winner_team_id;
    const state = match.status === "completed" ? "Завершён" : match.status === "bye" ? "Проход без матча" : match.status === "live" ? "Идёт матч" : "Ожидает";
    const score = match.score1 !== null && match.score2 !== null ? `${match.score1} : ${match.score2}` : "—";
    return `<article class="bracket-match ${match.status === "live" ? "is-live" : ""}">
      <div class="bracket-match-top"><span>МАТЧ ${match.match_number}</span><span>${state}</span></div>
      <div class="bracket-side ${winner === match.team1_id && winner ? "is-winner" : ""}"><b>${escapeHTML(a)}</b><strong>${match.score1 ?? "—"}</strong></div>
      <div class="bracket-score">${score}</div>
      <div class="bracket-side ${winner === match.team2_id && winner ? "is-winner" : ""}"><b>${escapeHTML(b)}</b><strong>${match.score2 ?? "—"}</strong></div>
      <div class="bracket-meta">${match.mode ? `<span>${escapeHTML(match.mode)}</span>` : ""}${match.map ? `<span>${escapeHTML(match.map)}</span>` : ""}</div>
    </article>`;
  }

  function tournamentHTML(data, archived = false) {
    const t = data.tournament;
    const teams = data.teams || [];
    const matches = data.matches || [];
    if (!t) return `<div class="empty-state">Сейчас активного турнира нет. Следи за обновлениями!</div>`;
    const rounds = [...new Set(matches.map(m => m.round_number))].sort((a,b) => a-b);
    const champion = teams.find(team => team.id === t.champion_team_id);
    const bracket = rounds.map(round => {
      const roundMatches = matches.filter(m => m.round_number === round);
      const title = rounds.length === 1 ? "Финал" : round === rounds.length ? "Финал" : round === rounds.length - 1 ? "Полуфиналы" : `Раунд ${round}`;
      return `<section class="bracket-round"><h3>${title}</h3><div class="bracket-round-list">${roundMatches.map(m => matchHTML(m, teams)).join("")}</div></section>`;
    }).join("");
    return `<div class="tournament-summary">
      <div><div class="eyebrow">${archived ? "АРХИВ ТУРНИРА" : "АКТИВНЫЙ ТУРНИР"}</div><h2>${escapeHTML(t.name)}</h2>
      <p>${escapeHTML(t.venue || "Место проведения уточняется")}</p><p class="tournament-date">${dateText(t.starts_at)}</p></div>
      ${champion ? `<div class="champion-card"><span>🏆 ЧЕМПИОН</span><b>${escapeHTML(champion.team_name)}</b></div>` : `<div class="tournament-live-state">${archived ? "ЗАВЕРШЁН" : "ТУРНИР ИДЁТ"}</div>`}
    </div>
    <div class="bracket-scroll"><div class="bracket-grid">${bracket}</div></div>
    <section class="tournament-participants"><h3>Участники турнира</h3><div class="tournament-team-grid">${teams.map(team =>
      `<article class="tournament-team-card"><div><span>КОМАНДА №${escapeHTML(team.team_number)}</span><b>${escapeHTML(team.team_name)}</b></div>${rosterHTML(team)}</article>`
    ).join("")}</div></section>`;
  }

  async function loadActive() {
    activeRoot.innerHTML = '<div class="empty-state">Загружаем турнир…</div>';
    try {
      const response = await fetch(`${API}/tournament`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить турнир.");
      activeRoot.innerHTML = tournamentHTML(data);
      activeLoaded = true;
    } catch (error) {
      activeRoot.innerHTML = `<div class="empty-state">${escapeHTML(error.message)}</div>`;
    }
  }

  async function loadHistory() {
    historyRoot.innerHTML = '<div class="empty-state">Загружаем историю…</div>';
    try {
      const response = await fetch(`${API}/tournament?history=1`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить историю.");
      const history = data.history || [];
      historyRoot.innerHTML = history.length
        ? history.map(item => `<details class="history-item"><summary><span><b>${escapeHTML(item.tournament.name)}</b><small>${dateText(item.tournament.completed_at || item.tournament.starts_at)}</small></span><strong>Открыть сетку ↓</strong></summary>${tournamentHTML(item, true)}</details>`).join("")
        : '<div class="empty-state">Завершённых турниров пока нет.</div>';
      historyLoaded = true;
    } catch (error) {
      historyRoot.innerHTML = `<div class="empty-state">${escapeHTML(error.message)}</div>`;
    }
  }

  document.querySelectorAll(".tournament-tab").forEach(button => {
    button.addEventListener("click", async () => {
      document.querySelectorAll(".tournament-tab").forEach(item => item.classList.toggle("active", item === button));
      const history = button.dataset.tab === "history";
      activeView.classList.toggle("hidden", history);
      historyView.classList.toggle("hidden", !history);
      if (history && !historyLoaded) await loadHistory();
      if (!history && !activeLoaded) await loadActive();
    });
  });

  loadActive();
});
