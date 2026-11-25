(() => {
  const API = "/.netlify/functions";
  const $ = (selector, root = document) => root.querySelector(selector);
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

  async function request(path, options = {}) {
    let response;
    try {
      response = await fetch(`${API}/${path}`, {
        ...options,
        headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }
      });
    } catch {
      throw new Error("Не удалось связаться с сервером. Проверьте подключение к интернету.");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Ошибка сервера (${response.status}).`);
    return payload;
  }

  function setMessage(element, message, type = "") {
    if (!element) return;
    element.textContent = message;
    element.className = `form-message${type ? ` ${type}` : ""}`;
  }

  function rosterEntries(team) {
    const entries = [
      { nick: team.captain_nick, klass: team.captain_class, role: "Капитан" },
      { nick: team.player2_nick, klass: team.player2_class, role: "Игрок 2" },
      { nick: team.player3_nick, klass: team.player3_class, role: "Игрок 3" }
    ];
    if (team.reserve_nick) entries.push({ nick: team.reserve_nick, klass: team.reserve_class, role: "Запасной", reserve: true });
    return entries;
  }

  function teamCard(team) {
    const entries = rosterEntries(team).map((player) => `
      <div class="roster-person${player.reserve ? " reserve-person" : ""}">
        <span class="person-nick">${escapeHTML(player.nick)}${player.role === "Капитан" ? " · капитан" : ""}</span>
        <span class="person-class">${escapeHTML(player.klass)}</span>
      </div>`).join("");
    return `<article class="team-card">
      <div class="team-card-top"><span class="team-number">TEAM №${escapeHTML(team.team_number)}</span><span class="team-badge">ПОДТВЕРЖДЕНА</span></div>
      <h3>${escapeHTML(team.team_name)}</h3>
      <div class="roster-list">${entries}</div>
      <div class="team-meta"><span>${team.reserve_nick ? "3 + 1 ЗАПАСНОЙ" : "3 ОСНОВНЫХ ИГРОКА"}</span><span>SBC · 2026</span></div>
    </article>`;
  }

  function initMenu() {
    const toggle = $(".menu-toggle");
    const nav = $(".main-nav");
    if (!toggle || !nav) return;
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
  }

  function initYear() {
    const year = $("[data-year]");
    if (year) year.textContent = String(new Date().getFullYear());
  }

  window.SBC = { API, $, escapeHTML, request, setMessage, rosterEntries, teamCard };
  document.addEventListener("DOMContentLoaded", () => { initMenu(); initYear(); });
})();
