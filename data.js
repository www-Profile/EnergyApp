/* Детерминированная демомодель. Все календарные ключи относятся к местной дате. */
window.EnergyData = (() => {
  "use strict";
  const DAY = 86400000;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  const dayKey = (date = new Date()) =>
    [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  const ordinal = (key) => Math.round(Date.parse(key + "T12:00:00Z") / DAY - 0.5);
  const fromOrdinal = (value) => new Date(value * DAY).toISOString().slice(0, 10);
  const localDate = (key) => new Date(key + "T12:00:00");
  const profile = () => ({ name: "Матвей", surname: "", age: 18, height: 182, weight: 70 });
  const goals = () => ({ steps: 10000, sleep: 8, recovery: 80 });
  const preferences = () => ({ theme: "graphite", accent: "mint", daily: true, reminders: true });
  const storageKey = "energyapp.v1";
  let writable = true;
  function persist(state) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
      writable = true;
    } catch {
      writable = false;
    }
  }
  function noise(n, salt) {
    const sample = Math.sin(n * 41.17 + salt * 17.81) * 9632.73;
    return sample - Math.floor(sample);
  }
  // Один профиль дня определяет взаимосвязанные показатели сна, восстановления и стресса.
  function demoDay(key, seed) {
    const n = ordinal(key) - ordinal(seed);
    const rhythm = 0.54 + 0.27 * Math.sin(n * 1.2 + 0.6) + 0.14 * Math.cos(n * 0.62);
    const sleep = n === 0 ? 504 : Math.round(307 + 229 * rhythm + 33 * noise(n, 1));
    const steps = n === 0 ? 6482 : Math.round(2300 + 9500 * noise(n, 2));
    const workout = n === 0 ? 28 : steps > 6500 ? Math.round(18 + 38 * noise(n, 3)) : 0;
    const stress =
      n === 0 ? 23 : clamp(Math.round(82 - 64 * rhythm + 14 * (noise(n, 4) - 0.5)), 12, 92);
    const recovery =
      n === 0
        ? 92
        : clamp(Math.round(23 + (sleep - 290) * 0.28 + (100 - stress) * 0.11 - workout * 0.09), 16, 98);
    const energy = clamp(
      Math.round(
        recovery * 0.5 + Math.min(100, sleep / 5.1) * 0.25 + (100 - stress) * 0.25 - workout * 0.12
      ),
      0,
      100
    );
    const wake = n === 0 ? 444 : Math.round(408 + 88 * noise(n, 7));
    return {
      key,
      sleep,
      steps,
      workout,
      stress,
      recovery,
      energy,
      wake,
      calories: Math.round(steps * 0.034 + workout * 2.7),
    };
  }
  function sync(state, today = dayKey()) {
    if (state.historyDeleted) {
      state.days = [];
      return;
    }
    const last = ordinal(today);
    const saved = new Map(state.days.map((day) => [day.key, day]));
    state.days = Array.from({ length: 30 }, (_, i) => {
      const key = fromOrdinal(last - 29 + i);
      return saved.get(key) || demoDay(key, state.seed);
    });
  }
  function load() {
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(storageKey));
    } catch {
      /* Хранилище может быть отключено. */
    }
    const state = {
      seed: dayKey(),
      days: [],
      historyDeleted: false,
      signedOut: false,
      seen: "",
      ...saved,
      profile: { ...profile(), ...saved?.profile },
      goals: { ...goals(), ...saved?.goals },
      preferences: { ...preferences(), ...saved?.preferences },
    };
    if (!Array.isArray(state.days)) state.days = [];
    sync(state);
    persist(state);
    return state;
  }
  const level = (n) => (n >= 75 ? "high" : n >= 50 ? "mid" : "low");
  const stressLevel = (n) => (n <= 34 ? "Низкий" : n <= 64 ? "Средний" : "Высокий");
  const energyLevel = (n) =>
    ({ high: "Высокий уровень", mid: "Средний уровень", low: "Низкий уровень" }[level(n)]);
  function recommendations(day, goal) {
    const easy = day.energy < 55 || day.stress > 65;
    return [
      {
        icon: easy ? "leaf" : "footprints",
        tone: "green",
        title: easy
          ? "Спокойный темп"
          : day.steps >= goal.steps
          ? "Цель по шагам достигнута"
          : "Время для прогулки",
        text: easy
          ? "В демоплане сегодня спокойная прогулка и больше пауз."
          : day.steps >= goal.steps
          ? "Шагов на сегодня достаточно для выбранной цели. Оставь вечер свободным."
          : "До твоей цели ещё " +
            (goal.steps - day.steps).toLocaleString("ru-RU") +
            " шагов. Часть можно пройти на прогулке.",
      },
      {
        icon: "wind",
        tone: "amber",
        title: day.stress > 50 ? "Пауза среди дел" : "Сохрани свой ритм",
        text:
          day.stress > 50
            ? "Уровень стресса в демоданных повышен. Оставь между делами время на отдых."
            : "Стресс в демоданных невысокий. Оставь в расписании короткий перерыв.",
      },
      {
        icon: "moon",
        tone: "purple",
        title: day.sleep < goal.sleep * 60 ? "Больше времени на сон" : "Привычный режим сна",
        text:
          day.sleep < goal.sleep * 60
            ? "Этой ночью сна было меньше твоей цели. Запланируй время, когда начнёшь готовиться ко сну."
            : "Цель по длительности сна выполнена. Запланируй отход ко сну в привычное время.",
      },
    ];
  }
  // Непрерывная демонстрационная шкала стадий с суммой, равной длительности сна.
  function phases(day) {
    const cycle = [
      ["light", 6],
      ["deep", 5],
      ["light", 4],
      ["rem", 3],
      ["light", 6],
      ["deep", 4],
      ["rem", 4],
      ["light", 5],
      ["deep", 3],
      ["light", 4],
      ["rem", 5],
      ["light", 3],
      ["rem", 5],
    ];
    const total = cycle.reduce((sum, [, w]) => sum + w, 0);
    let at = 0,
      used = 0;
    return cycle.map(([stage, w]) => {
      used += w;
      const end = Math.round((day.sleep * used) / total);
      const minutes = end - at;
      at = end;
      return { stage, minutes };
    });
  }
  return {
    dayKey,
    ordinal,
    fromOrdinal,
    localDate,
    mean,
    load,
    persist,
    sync,
    preferences,
    goals,
    profile,
    canSave: () => writable,
    level,
    stressLevel,
    energyLevel,
    recommendations,
    phases,
  };
})();
