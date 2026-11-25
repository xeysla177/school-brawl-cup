document.addEventListener("DOMContentLoaded", async () => {
  const { request, $, setMessage } = window.SBC;
  const form = $("#registration-form");
  if (!form) return;
  const submit = $("#submit-button");
  const message = $("#form-message");
  const state = $("#registration-state");
  let registrationOpen = false;
  let submissionToken = null;

  try {
    const result = await request("status");
    registrationOpen = Boolean(result.registrationOpen);
    state.textContent = registrationOpen ? "РЕГИСТРАЦИЯ ОТКРЫТА" : "РЕГИСТРАЦИЯ ЗАКРЫТА";
    state.style.color = registrationOpen ? "var(--green)" : "var(--red)";
    if (!registrationOpen) {
      form.classList.add("is-closed");
      submit.disabled = true;
      submit.textContent = "Регистрация закрыта";
      setMessage(message, "Организатор временно закрыл приём заявок.", "error");
    }
  } catch (error) {
    state.textContent = "СТАТУС НЕИЗВЕСТЕН";
    state.style.color = "var(--red)";
    form.classList.add("is-closed");
    submit.disabled = true;
    setMessage(message, "Не удалось проверить статус регистрации. Обновите страницу позже.", "error");
  }

  form.addEventListener("input", () => { if (!submit.disabled) submissionToken = null; });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!registrationOpen || submit.disabled) return;

    const data = Object.fromEntries(new FormData(form).entries());
    const required = ["team_name", "captain_nick", "captain_class", "player2_nick", "player2_class", "player3_nick", "player3_class"];
    for (const key of required) {
      if (!String(data[key] || "").trim()) {
        const field = form.elements.namedItem(key);
        field?.focus();
        setMessage(message, "Заполните все обязательные поля, отмеченные звёздочкой.", "error");
        return;
      }
    }
    if (Boolean(String(data.reserve_nick || "").trim()) !== Boolean(String(data.reserve_class || "").trim())) {
      setMessage(message, "Для запасного игрока заполните и ник, и класс — либо оставьте оба поля пустыми.", "error");
      return;
    }

    submissionToken ||= (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); }));
    data.submission_token = submissionToken;
    submit.disabled = true;
    submit.innerHTML = 'ОТПРАВЛЯЕМ ЗАЯВКУ <span>…</span>';
    setMessage(message, "Отправляем данные организатору…");
    try {
      const result = await request("register", { method: "POST", body: JSON.stringify(data) });
      setMessage(message, result.message || "Заявка успешно отправлена!", "success");
      form.reset();
      submissionToken = null;
      submit.innerHTML = 'ЗАЯВКА ОТПРАВЛЕНА <span>✓</span>';
    } catch (error) {
      setMessage(message, error.message, "error");
      submit.disabled = false;
      submit.innerHTML = 'Отправить заявку <span>↗</span>';
    }
  });
});
