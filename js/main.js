document.addEventListener("DOMContentLoaded", async () => {
  const { request, $, teamCard } = window.SBC;
  const count = $("#team-count");
  const status = $("#registration-status");
  const pulse = $("#status-pulse");
  const recent = $("#recent-teams");

  try {
    const [settings, listing] = await Promise.all([request("status"), request("teams")]);
    const teams = listing.teams || [];
    count.textContent = String(teams.length);
    status.textContent = settings.registrationOpen ? "ОТКРЫТА" : "ЗАКРЫТА";
    status.style.color = settings.registrationOpen ? "var(--green)" : "var(--red)";
    pulse.style.background = settings.registrationOpen ? "var(--green)" : "var(--red)";
    if (recent) {
      recent.innerHTML = teams.length
        ? teams.slice(0, 3).map(teamCard).join("")
        : '<div class="empty-state">Пока нет опубликованных команд. Станьте первыми — отправьте заявку!</div>';
    }
  } catch (error) {
    count.textContent = "—";
    status.textContent = "НЕДОСТУПНА";
    status.style.color = "var(--muted)";
    if (recent) recent.innerHTML = '<div class="empty-state">Не удалось загрузить команды. Попробуйте обновить страницу позже.</div>';
    console.error(error);
  }
});
