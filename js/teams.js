document.addEventListener("DOMContentLoaded", async () => {
  const { request, $, teamCard, rosterEntries } = window.SBC;
  const list = $("#teams-list");
  const search = $("#team-search");
  const filter = $("#class-filter");
  const count = $("#visible-count");
  const empty = $("#no-teams");
  let allTeams = [];

  function render() {
    const query = (search.value || "").trim().toLocaleLowerCase("ru-RU");
    const chosenClass = filter.value;
    const visible = allTeams.filter((team) => {
      const matchName = team.team_name.toLocaleLowerCase("ru-RU").includes(query);
      const matchClass = !chosenClass || rosterEntries(team).some((player) => player.klass === chosenClass);
      return matchName && matchClass;
    });
    count.textContent = String(visible.length);
    list.innerHTML = visible.length ? visible.map(teamCard).join("") : "";
    empty.classList.toggle("hidden", visible.length !== 0);
    if (!allTeams.length) empty.textContent = "Пока нет опубликованных команд. Список появится после подтверждения заявок.";
    else if (!visible.length) empty.textContent = "По вашему запросу ничего не найдено. Измените поиск или фильтр.";
  }

  try {
    const result = await request("teams");
    allTeams = result.teams || [];
    const classes = [...new Set(allTeams.flatMap((team) => rosterEntries(team).map((player) => player.klass)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
    for (const klass of classes) {
      const option = document.createElement("option");
      option.value = klass;
      option.textContent = klass;
      filter.append(option);
    }
    render();
  } catch (error) {
    list.innerHTML = '<div class="empty-state">Не удалось загрузить команды. Попробуйте обновить страницу позже.</div>';
    empty.classList.add("hidden");
    count.textContent = "—";
    console.error(error);
  }
  search.addEventListener("input", render);
  filter.addEventListener("change", render);
});
