"use strict";
const D = window.EnergyData;
const state = D.load();
const $ = (selector) => document.querySelector(selector);
const sheet = $("#sheet");
const num = (n) => Number(n).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])
  );
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const dateText = (key, options) => D.localDate(key).toLocaleDateString("ru-RU", options);
const shortDate = (key) => dateText(key, { day: "numeric", month: "short" }).replace(/\.$/, "");
const longDate = (key) => cap(dateText(key, { weekday: "long", day: "numeric", month: "long" }));
const duration = (min) => `${Math.floor(Math.round(min) / 60)} ч ${Math.round(min) % 60} мин`;
const clock = (minutes) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const icon = (name, className = "") =>
  `<use href="#i-${name}"></use>`;
const latest = () => state.days.at(-1);
const avg = (days, key) => Math.round(D.mean(days.map((day) => day[key])));
const sum = (days, key) => days.reduce((total, day) => total + day[key], 0);
const delta = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${num(Math.abs(n))}`;
const countDays = (n) =>
  `${n} ${
    n % 10 === 1 && n % 100 !== 11
      ? "день"
      : n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14)
      ? "дня"
      : "дней"
  }`;
const metrics = {
  sleep: {
    title: "Сон",
    icon: "moon",
    tone: "purple",
    color: "#bba5f4",
    format: duration,
    unit: "мин",
  },
  recovery: {
    title: "Восстановление",
    icon: "heart-pulse",
    tone: "green",
    color: "#78dab0",
    format: (v) => `${num(v)}%`,
    unit: "%",
  },
  steps: {
    title: "Активность",
    icon: "footprints",
    tone: "blue",
    color: "#8abbe8",
    format: num,
    unit: "шагов",
  },
  stress: {
    title: "Стресс",
    icon: "waves",
    tone: "amber",
    color: "#edbf78",
    format: (v) => `${num(v)} / 100`,
    unit: "баллов",
  },
};
let page = "energy",
  period = 7,
  historyLimit = 5,
  sheetState = null,
  toastTimer,
  statCharts = [],
  detailChart;
let sessionDay = D.dayKey();
const scrollPositions = { energy: 0, stats: 0, profile: 0 };
function message(s) {
  const el = $("#toast");
  clearTimeout(toastTimer);
  el.textContent = s;
  el.classList.add("show");
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
function save() {
  D.persist(state);
  if (!D.canSave()) message("Браузер сохраняет изменения только до закрытия страницы.");
}
function setTheme() {
  document.documentElement.dataset.theme = state.preferences.theme;
  document.documentElement.dataset.accent = state.preferences.accent;
}
function badgeIcon(name, tone) {
  return `<span class="badge-icon ${tone}">${icon(name)}</span>`;
}
function spark(values, color, bars = false) {
  const max = Math.max(...values),
    min = Math.min(...values),
    w = 91,
    h = 29;
  const y = (v) => h - 3 - ((v - min) / (max - min || 1)) * (h - 8);
  if (bars)
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true">${values
      .map(
        (v, i) =>
          `<rect x="${i * 8.2}" y="${y(v)}" width="4.6" height="${h - y(v)}" fill="${color}" opacity="${
            i === values.length - 1 ? 1 : 0.58
          }" rx="2"/>`
      )
      .join("")}</svg>`;
  const points = values.map((v, i) => [3 + (i * (w - 7)) / Math.max(1, values.length - 1), y(v)]);
  const line = points.map((p) => p.join(",")).join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polygon points="3,${h} ${line} ${
    points.at(-1)[0]
  },${h}" fill="${color}" opacity=".08"/><polyline points="${line}" fill="none" stroke="${color}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${
    points.at(-1)[0]
  }" cy="${points.at(-1)[1]}" r="2" fill="${color}"/></svg>`;
}
function energyRing(day) {
  const value = day.energy,
    radius = 88,
    angle = (Math.PI * 2 * value) / 100 - Math.PI / 2;
  const ticks = Array.from(
    { length: 72 },
    (_, i) =>
      `<line x1="110" y1="5" x2="110" y2="${i % 6 ? 8 : 11}" transform="rotate(${i * 5} 110 110)" opacity="${
        i % 6 ? ".4" : ".9"
      }"/>`
  ).join("");
  return `<div class="gauge ${D.level(
    value
  )}"><svg viewBox="0 0 220 220" aria-hidden="true"><g stroke="currentColor" stroke-width="1">${ticks}</g><circle class="gauge-track" cx="110" cy="110" r="${radius}"/><circle class="gauge-fill" pathLength="100" cx="110" cy="110" r="${radius}" style="--score:${value}" transform="rotate(-90 110 110)"/><circle class="gauge-dot" cx="${
    110 + radius * Math.cos(angle)
  }" cy="${110 + radius * Math.sin(angle)}" r="3.4"/></svg><div class="gauge-label">${icon(
    "zap"
  )}<strong>${value}<small>%</small></strong></div></div>`;
}
function miniWeek(days) {
  return `<div class="mini-week" aria-label="Энергия за последние семь дней">${days
    .slice(-7)
    .map((d, i, a) => {
      const active = i === a.length - 1;
      return `<button data-day="${d.key}" class="mini-day ${active ? "current" : ""}" aria-label="${shortDate(
        d.key
      )}, энергия ${d.energy}%"><span class="mini-bar"><i style="height:${
        d.energy
      }%"></i></span><small>${dateText(d.key, {
        weekday: "short",
      })}</small></button>`;
    })
    .join("")}</div>`;
}
function metricNote(key, d) {
  if (key === "sleep")
    return d.sleep >= state.goals.sleep * 60
      ? "Цель выполнена"
      : "До цели " + duration(state.goals.sleep * 60 - d.sleep);
  if (key === "recovery")
    return d.recovery >= state.goals.recovery ? "Цель выполнена" : `Цель ${state.goals.recovery}%`;
  if (key === "steps") return `из ${num(state.goals.steps)} шагов`;
  return `${d.stress} из 100 баллов`;
}
function updateMetricCard(card, day) {
  const key = card.dataset.metric,
    m = metrics[key];
  let value = m.format(day[key]);
  if (key === "sleep")
    value = Math.floor(day.sleep / 60) + "<small> ч </small>" + (day.sleep % 60) + "<small> мин</small>";
  if (key === "recovery") value = day.recovery + "<small>%</small>";
  if (key === "stress") value = D.stressLevel(day.stress);
  card.querySelector("strong").innerHTML = value;
  card.querySelector(".spark-slot").innerHTML = spark(
    state.days.slice(-11).map((d) => d[key]),
    m.color,
    key === "steps"
  );
  card.querySelector(".metric-note").textContent = metricNote(key, day);
}
function emptyHistory() {
  return `<div class="card empty">${badgeIcon(
    "history",
    "green"
  )}<h2>История очищена</h2><p>Восстанови 30 демонстрационных дней, чтобы снова увидеть показатели и графики.</p><button class="primary" data-action="restore">Восстановить демоданные</button></div>`;
}
const layouts = Object.fromEntries(
  Array.from(document.querySelectorAll(".view"), (view) => [view.id, view.innerHTML])
);
function openLayout(id) {
  const root = $("#" + id);
  root.innerHTML = layouts[id];
  if (!latest() && id !== "profile") root.querySelector(".data-content").innerHTML = emptyHistory();
  return root;
}
function values(root, fields) {
  for (const node of root.querySelectorAll("[data-value]")) {
    if (Object.hasOwn(fields, node.dataset.value)) node.textContent = fields[node.dataset.value];
  }
}
function renderEnergy() {
  const root = openLayout("energy"),
    d = latest(),
    hour = new Date().getHours();
  const greeting =
    hour < 5 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
  values(root, { greeting: greeting + ", " + state.profile.name });
  if (!d) return;
  values(root, { level: D.energyLevel(d.energy) });
  const description = $("#energy-description");
  const descriptions = {
    mid: "Запас энергии умеренный. Распредели дела в течение дня.",
    low: "Запас энергии снижен. Оставь сегодня больше времени на отдых.",
  };
  description.textContent = descriptions[D.level(d.energy)] || "";
  description.hidden = !description.textContent;
  $("#ring-slot").innerHTML = energyRing(d);
  $("#week-slot").innerHTML = miniWeek(state.days);
  root.querySelectorAll("[data-metric]").forEach((card) => updateMetricCard(card, d));
  $("#recommendations").innerHTML = D.recommendations(d, state.goals)
    .map(
      (r) =>
        `<article class="rec">${badgeIcon(r.icon, r.tone)}<div><h3>${r.title}</h3><p>${
          r.text
        }</p></div></article>`
    )
    .join("");
}
const periodTitle = { 1: "за день", 7: "за неделю", 30: "за месяц", 365: "за год" };
function periodData() {
  const all = state.days;
  const end = D.ordinal(latest().key),
    start = end - period + 1;
  const current = all.filter((d) => D.ordinal(d.key) >= start);
  const previous = all.filter((d) => D.ordinal(d.key) < start && D.ordinal(d.key) >= start - period);
  return {
    current,
    previous,
    completeComparison: current.length === period && previous.length === period,
  };
}
function series(days, key, annual = false) {
  if (!annual) return { labels: days.map((d) => shortDate(d.key)), values: days.map((d) => d[key]) };
  const groups = new Map();
  for (const d of days) {
    const month = d.key.slice(0, 7);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(d);
  }
  return {
    labels: [...groups.values()].map((group) => dateText(group[0].key, { month: "short", year: "2-digit" })),
    values: [...groups.values()].map((group) => avg(group, key)),
  };
}
function chart(canvas, data, color, options = {}) {
  const isBar = options.bar;
  const unit = options.unit || "%";
  const axis = !options.small;
  const single = data.values.length === 1;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, axis ? 190 : 75);
  grad.addColorStop(0, color + "52");
  grad.addColorStop(1, color + "04");
  return new Chart(ctx, {
    type: isBar ? "bar" : "line",
    data: {
      labels: data.labels,
      datasets: [
        {
          data: data.values,
          borderColor: color,
          backgroundColor: isBar ? color + "af" : grad,
          borderWidth: isBar ? 0 : 2.4,
          borderRadius: 4,
          maxBarThickness: 30,
          tension: 0.26,
          cubicInterpolationMode: "monotone",
          fill: !isBar,
          pointRadius: single ? 4 : axis && data.values.length <= 8 ? 3 : 0,
          pointHitRadius: 14,
          pointBackgroundColor: color,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: { label: (item) => `${num(item.parsed.y)} ${unit}` },
        },
      },
      scales: {
        x: {
          offset: single || isBar,
          grid: { display: false },
          border: { display: false },
          ticks: {
            display: axis,
            color: "#a0aaa3",
            font: { size: 10 },
            maxTicksLimit: 6,
            maxRotation: 0,
            autoSkip: true,
          },
        },
        y: {
          beginAtZero: true,
          min: 0,
          max: options.max,
          grid: { color: axis ? "#ffffff10" : "transparent", drawTicks: false },
          border: { display: false },
          ticks: {
            display: axis,
            color: "#a0aaa3",
            count: 5,
            padding: 8,
            font: { size: 10 },
            callback: (v) => (unit === "%" ? v + "%" : num(v)),
          },
        },
      },
    },
  });
}
function clearCharts() {
  statCharts.forEach((c) => c.destroy());
  statCharts = [];
}
function row(label, value) {
  return `<div class="data-row"><span>${label}</span><b>${value}</b></div>`;
}
function historyRows(days) {
  return days
    .slice()
    .reverse()
    .slice(0, historyLimit)
    .map(
      (d) =>
        `<button class="history-row" data-day="${d.key}"><span><strong>${longDate(
          d.key
        )}</strong><small>${duration(d.sleep)} сна · ${num(
          d.steps
        )} шагов</small></span><span class="history-score ${D.level(d.energy)}">${d.energy}%</span>${icon(
          "chevron-right",
          "chev"
        )}</button>`
    )
    .join("");
}
// Дневная карточка показывает интервалы внутри одной даты.
function dailyMetric(day, key) {
  if (key === "sleep") {
    const parts = D.phases(day);
    let end = day.wake - day.sleep;
    return { labels: parts.map((p) => clock((end += p.minutes))), values: parts.map((p) => p.minutes) };
  }
  const labels = ["06:00", "09:00", "12:00", "15:00", "18:00", "21:00"];
  if (key === "steps") {
    const shares = [0.03, 0.17, 0.36, 0.62, 0.88, 1];
    let previous = 0;
    return {
      labels,
      values: shares.map((part) => {
        const total = Math.round(day.steps * part);
        const interval = total - previous;
        previous = total;
        return interval;
      }),
    };
  }
  const score = day[key],
    step = Math.min(4, Math.floor(score / 2), Math.floor((100 - score) / 2));
  const offsets = key === "recovery" ? [0, 2, 1, -1, -2, 0] : [-2, -1, 1, 2, 0, 0];
  return { labels, values: offsets.map((n) => score + n * step) };
}
function renderStats() {
  clearCharts();
  const root = openLayout("stats");
  if (!latest()) return;
  const { current, previous, completeComparison } = periodData();
  const average = avg(current, "energy");
  const difference = completeComparison ? avg(current, "energy") - avg(previous, "energy") : null;
  const range =
    current.length === 1
      ? longDate(current[0].key)
      : `${shortDate(current[0].key)} — ${shortDate(current.at(-1).key)}`;
  const coverage = current.length < period ? ` · Данные за ${countDays(current.length)} из ${period}` : "";
  const best = current.reduce((a, b) => (a.energy > b.energy ? a : b));
  const worst = current.reduce((a, b) => (a.energy < b.energy ? a : b));
  const longest = current.reduce((a, b) => (a.sleep > b.sleep ? a : b));
  values(root, {
    period: periodTitle[period],
    average,
    range: range + coverage,
    dayCount: countDays(current.length),
    best: best.energy + "% · " + shortDate(best.key),
    worst: worst.energy + "% · " + shortDate(worst.key),
    mean: average + "%",
    longest: duration(longest.sleep),
    total: num(sum(current, "steps")),
    training: current.filter((d) => d.workout > 0).length + " · " + sum(current, "workout") + " мин",
    calories: num(sum(current, "calories")) + " ккал",
    change: difference === null ? "Мало данных" : delta(difference) + " п. п.",
  });
  for (const [key, m] of Object.entries(metrics)) values(root, { [key]: m.format(avg(current, key)) });
  root
    .querySelectorAll("[data-period]")
    .forEach((b) => b.setAttribute("aria-pressed", Number(b.dataset.period) === period));
  $("#period-change").hidden = difference === null;
  $("#period-change").textContent = difference === null ? "" : delta(difference) + " п. п.";
  $("#annual-note").hidden = period !== 365;
  $("#step-unit").textContent = period === 1 ? "шагов" : "шагов в среднем";
  $("#history-list").innerHTML = historyRows(current);
  root.querySelector("[data-action=more]").hidden = historyLimit >= current.length;
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  let energy = series(current, "energy", period === 365);
  if (period === 1) {
    // Симметричные отклонения оставляют среднее равным показателю дня.
    const step = Math.min(4, Math.floor((100 - average) / 2), Math.floor(average / 2));
    energy = {
      labels: ["06:00", "09:00", "12:00", "15:00", "18:00", "21:00"],
      values: [-1, 1, 2, 0, -2, 0].map((f) => average + f * step),
    };
  }
  statCharts.push(chart($("#energy-chart"), energy, accent, { max: 100 }));
  for (const [key, m] of Object.entries(metrics)) {
    statCharts.push(
      chart(
        $("#chart-" + key),
        period === 1 ? dailyMetric(current[0], key) : series(current, key, period === 365),
        m.color,
        {
          small: true,
          max: ["stress", "recovery"].includes(key) ? 100 : undefined,
          bar: key === "steps",
          unit: m.unit,
        }
      )
    );
  }
}
function renderProfile() {
  const root = openLayout("profile"),
    p = state.profile,
    g = state.goals;
  values(root, {
    initials: [p.name, p.surname]
      .filter(Boolean)
      .map((s) => Array.from(s)[0])
      .join(""),
    name: [p.name, p.surname].filter(Boolean).join(" "),
    age: num(p.age),
    height: num(p.height) + " см",
    weight: num(p.weight) + " кг",
    steps: num(g.steps),
    sleep: num(g.sleep) + " ч",
    recovery: g.recovery + "%",
  });
}
function showSheet(type, arg = "", parent = "") {
  sheetState = { type, arg, parent };
  if (!sheet.open) sheet.showModal();
  renderSheet();
  sheet.scrollTop = 0;
  sheet.querySelector(".sheet-inner").scrollTop = 0;
  sheet.querySelector("[data-action=close]").focus({ preventScroll: true });
}
function sheetHeader(title, sub = "") {
  return `<div class="sheet-head"><div><h2 id="sheet-title">${title}</h2>${
    sub ? `<p class="sub">${sub}</p>` : ""
  }</div><button class="icon-btn" data-action="close" aria-label="Закрыть">${icon("x")}</button></div>`;
}
function field(label, name, value, options = {}) {
  const { type = "text", min, max, step = 1, required = true } = options;
  return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(
    value
  )}" ${required ? "required" : ""} ${
    type === "number"
      ? `min="${min}" max="${max}" step="${step}" inputmode="${step < 1 ? "decimal" : "numeric"}"`
      : 'maxlength="40"'
  }></label>`;
}
function form(name, body) {
  return `<form data-form="${name}">${body}<button class="primary full" type="submit">Сохранить</button></form>`;
}
function toggle(name, title, text) {
  return `<label class="toggle-row"><span><strong>${title}</strong><small>${text}</small></span><input type="checkbox" name="${name}" ${
    state.preferences[name] ? "checked" : ""
  }><i aria-hidden="true"></i></label>`;
}
function preferenceSelect(label, name, options) {
  return `<label class="field"><span>${label}</span><select name="${name}">${Object.entries(options)
    .map(
      ([id, text]) =>
        `<option value="${id}" ${state.preferences[name] === id ? "selected" : ""}>${text}</option>`
    )
    .join("")}</select></label>`;
}
function detailMetric(key, d) {
  const m = metrics[key],
    prior = state.days.find((a) => D.ordinal(a.key) === D.ordinal(d.key) - 1);
  const diff = prior ? d[key] - prior[key] : null;
  let rows = "";
  if (key === "sleep") {
    const phases = D.phases(d),
      names = { deep: "Глубокий", light: "Лёгкий", rem: "Быстрый" };
    rows =
      row("Засыпание", clock(d.wake - d.sleep)) +
      row("Пробуждение", clock(d.wake)) +
      row("Длительность", duration(d.sleep)) +
      row("Качество в демомодели", d.recovery >= 80 ? "Высокое" : d.recovery >= 55 ? "Среднее" : "Низкое");
    rows += `<h3 class="detail-title">Фазы сна</h3><div class="phases" aria-label="Последовательность фаз">${phases
      .map(
        (p) =>
          `<span class="${p.stage}" style="flex:${p.minutes}" title="${names[p.stage]}, ${
            p.minutes
          } мин"></span>`
      )
      .join("")}</div><div class="phase-times"><span>${clock(d.wake - d.sleep)}</span><span>${clock(
      d.wake
    )}</span></div><div class="phase-legend">${Object.entries(names)
      .map(
        ([k, name]) =>
          `<span><i class="${k}"></i>${name} · ${duration(
            phases.filter((p) => p.stage === k).reduce((s, p) => s + p.minutes, 0)
          )}</span>`
      )
      .join("")}</div>`;
  } else if (key === "steps") {
    rows =
      row("Шаги", num(d.steps)) +
      row("Цель", num(state.goals.steps)) +
      row("Выполнено", Math.round((d.steps / state.goals.steps) * 100) + "%") +
      row("Тренировка", d.workout ? d.workout + " мин" : "День без тренировки") +
      row("Активные калории", d.calories + " ккал");
  } else if (key === "recovery") {
    rows =
      row("Оценка восстановления", d.recovery + "%") +
      row("Цель", state.goals.recovery + "%") +
      row("Сон этой ночью", duration(d.sleep)) +
      row("Уровень стресса", D.stressLevel(d.stress));
  } else {
    rows =
      row("Демоиндекс", d.stress + " из 100") +
      row("Уровень", D.stressLevel(d.stress)) +
      row("Сон этой ночью", duration(d.sleep));
  }
  const diffUnit = key === "recovery" ? "п. п." : key === "stress" ? "б." : m.unit;
  const trend = state.days.filter((day) => day.key <= d.key).slice(-7);
  return `${sheetHeader(m.title, longDate(d.key))}<div class="detail-value">${badgeIcon(m.icon, m.tone)}<b>${
    key === "stress" ? D.stressLevel(d.stress) : m.format(d[key])
  }</b></div>${rows}
    ${row("К предыдущему дню", diff === null ? "Мало данных" : delta(diff) + " " + diffUnit)}
    ${
      key !== "sleep"
        ? `<h3 class="detail-title">Динамика за ${countDays(
            trend.length
          )}</h3><div class="detail-chart"><canvas id="detail-chart" role="img" aria-label="${
            m.title
          }, динамика"></canvas></div>`
        : ""
    }
    ${sheetState.parent ? `<button class="more" data-day="${d.key}">Вернуться к сводке дня</button>` : ""}`;
}
function renderSheet() {
  if (detailChart) {
    detailChart.destroy();
    detailChart = null;
  }
  const { type, arg, parent } = sheetState;
  let html = "",
    chartConfig;
  const p = state.profile,
    g = state.goals;
  if (type === "metric") {
    const key = arg,
      d = state.days.find((a) => a.key === parent) || latest();
    html = detailMetric(key, d);
    if (key !== "sleep")
      chartConfig = {
        m: metrics[key],
        key,
        days: state.days.filter((day) => day.key <= d.key).slice(-7),
      };
  } else if (type === "day") {
    const d = state.days.find((item) => item.key === arg);
    if (!d) return;
    html =
      sheetHeader(longDate(d.key), "Сводка дня") +
      `<div class="day-total">${badgeIcon("zap", "green")}<strong>${d.energy}%</strong><span>${D.energyLevel(
        d.energy
      )}</span></div><div class="detail-list">` +
      Object.entries(metrics)
        .map(
          ([key, m]) =>
            `<button class="settings-row" data-metric="${key}" data-for="${d.key}">${badgeIcon(
              m.icon,
              m.tone
            )}<strong>${m.title}</strong><small>${
              key === "stress" ? D.stressLevel(d.stress) : m.format(d[key])
            }</small>${icon("chevron-right", "chev")}</button>`
        )
        .join("") +
      `</div><h3 class="detail-title">Рекомендация на этот день</h3><p class="body-copy">${
        D.recommendations(d, g)[0].text
      }</p>`;
  } else if (type === "edit") {
    html =
      sheetHeader("Редактировать профиль") +
      form(
        "edit",
        field("Имя", "name", p.name) +
          field("Фамилия", "surname", p.surname, { required: false }) +
          `<div class="field-grid">${field("Возраст, лет", "age", p.age, {
            type: "number",
            min: 1,
            max: 120,
          })}${field("Рост, см", "height", p.height, {
            type: "number",
            min: 40,
            max: 250,
            step: 0.1,
          })}${field("Вес, кг", "weight", p.weight, {
            type: "number",
            min: 10,
            max: 350,
            step: 0.1,
          })}</div>`
      );
  } else if (type === "goals") {
    html =
      sheetHeader("Мои цели") +
      form(
        "goals",
        field("Шаги за день", "steps", g.steps, { type: "number", min: 100, max: 100000 }) +
          field("Сон за ночь, часов", "sleep", g.sleep, {
            type: "number",
            min: 1,
            max: 16,
            step: 0.25,
          }) +
          field("Восстановление, %", "recovery", g.recovery, { type: "number", min: 1, max: 100 })
      );
  } else if (type === "appearance") {
    html =
      sheetHeader("Внешний вид") +
      form(
        "appearance",
        preferenceSelect("Тёмная тема", "theme", { graphite: "Графит", forest: "Лес" }) +
          preferenceSelect("Акцент интерфейса", "accent", {
            mint: "Мятный",
            blue: "Ледяной",
            lilac: "Сиреневый",
          })
      );
  } else if (type === "notice-prefs") {
    html =
      sheetHeader("Уведомления", "Сообщения внутри EnergyApp") +
      form(
        "notice-prefs",
        toggle("daily", "Ежедневный отчёт", "Сводка показателей за день") +
          toggle("reminders", "Напоминания", "Подсказка о текущей цели")
      );
  } else if (type === "inbox") {
    const d = latest();
    const items = [];
    if (d && state.preferences.daily)
      items.push([
        "zap",
        "green",
        "Ежедневный отчёт",
        `Энергия ${d.energy}%, сон ${duration(d.sleep)}, восстановление ${d.recovery}%.`,
      ]);
    if (d && state.preferences.reminders) {
      const r = D.recommendations(d, g)[0];
      items.push([r.icon, r.tone, r.title, r.text]);
    }
    html =
      sheetHeader("Уведомления", longDate(D.dayKey())) +
      (items.length
        ? items
            .map(
              ([ic, tone, title, txt]) =>
                `<article class="rec">${badgeIcon(
                  ic,
                  tone
                )}<div><h3>${title}</h3><p>${txt}</p></div></article>`
            )
            .join("")
        : '<p class="body-copy">Новых сообщений нет.</p>') +
      '<button class="more" data-action="notice-prefs">Настроить уведомления</button>';
  } else if (type === "privacy") {
    html =
      sheetHeader("Конфиденциальность") +
      `<p class="body-copy">Профиль, цели и настройки хранятся в этом браузере. Все показатели демонстрационные. EnergyApp работает локально и не запрашивает доступ к датчикам телефона.</p><button class="more" data-action="data">Управление данными</button>`;
  } else if (type === "about") {
    html =
      sheetHeader("Об EnergyApp") +
      `<div class="about-logo"><img src="icon.svg" width="52" height="52" alt=""><b>EnergyApp</b></div><p class="body-copy">Демонстрационный дневник энергии, сна, восстановления, активности и стресса. Проценты рассчитаны по условной модели и служат для знакомства с приложением.</p>${row(
        "Версия",
        "1.0"
      )}${row("Доступная история", countDays(state.days.length))}`;
  } else if (type === "data") {
    html =
      sheetHeader("Данные приложения") +
      row("Тестовая история", countDays(state.days.length)) +
      `<div class="actions">${
        state.historyDeleted
          ? '<button class="secondary" data-action="restore">Восстановить демоданные</button>'
          : '<button class="secondary danger" data-action="clear">Удалить тестовую историю</button>'
      }<button class="secondary" data-action="reset">Сбросить настройки и цели</button></div>`;
  } else {
    const confirm = {
      clear: [
        "Удалить историю?",
        "Все демонстрационные дни будут удалены из этого браузера. Их можно восстановить в разделе данных.",
        "Удалить историю",
      ],
      reset: [
        "Сбросить настройки?",
        "Цели, уведомления и оформление вернутся к исходным значениям.",
        "Сбросить настройки",
      ],
      logout: [
        "Выйти из демопрофиля?",
        "Локальные данные сохранятся. Чтобы продолжить, снова открой демопрофиль.",
        "Выйти",
      ],
    }[type];
    if (!confirm) return;
    html =
      sheetHeader(confirm[0]) +
      `<p class="body-copy">${confirm[1]}</p><div class="actions"><button class="primary" data-confirm="${type}">${confirm[2]}</button><button class="secondary" data-action="close">Отмена</button></div>`;
  }
  $("#sheet-content").innerHTML = html;
  if (chartConfig) {
    const { key, m, days } = chartConfig;
    detailChart = chart($("#detail-chart"), series(days, key), m.color, {
      max: ["recovery", "stress"].includes(key) ? 100 : undefined,
      bar: key === "steps",
      unit: m.unit,
    });
  }
}
function updateBell() {
  const button = document.getElementById("inbox-button");
  if (!button) return;

  button.hidden = state.signedOut;

  const hasUnread =
    !state.signedOut &&
    latest() &&
    (state.preferences.daily || state.preferences.reminders) &&
    state.seen !== D.dayKey();

  button.innerHTML = `
    <svg
      class="icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
      <path d="M10 21a2.3 2.3 0 0 0 4 0" />
    </svg>
    ${hasUnread ? '<i class="unread"></i>' : ""}
  `;
}
function render() {
  setTheme();
  updateBell();
  clearCharts();
  document.querySelector(".dock").hidden = state.signedOut;
  for (const view of document.querySelectorAll(".view")) view.hidden = view.id !== page;
  document.querySelectorAll(".dock button").forEach((b) => {
    if (b.dataset.page === page) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  if (state.signedOut) {
    $(
      "#" + page
    ).innerHTML = `<div class="card empty welcome"><img src="icon.svg" width="64" height="64" alt=""><h1>EnergyApp</h1><p>Открой свой демопрофиль, чтобы посмотреть показатели и историю.</p><button class="primary" data-action="login">Открыть демопрофиль</button></div>`;
    document.title = "EnergyApp";
    return;
  }
  document.title = "EnergyApp — " + { energy: "Энергия", stats: "Статистика", profile: "Профиль" }[page];
  ({ energy: renderEnergy, stats: renderStats, profile: renderProfile })[page]();
}
function navigate(next) {
  if (next === page) return;
  scrollPositions[page] = window.scrollY;
  page = next;
  render();
  window.scrollTo({ top: scrollPositions[next], behavior: "instant" });
}
function doAction(name) {
  if (name === "close") {
    sheet.close();
    return;
  }
  if (name === "more") {
    historyLimit += 10;
    renderStats();
    const rows = document.querySelectorAll(".history-row");
    rows[Math.max(0, historyLimit - 10)]?.focus({ preventScroll: true });
    return;
  }
  if (name === "restore") {
    state.historyDeleted = false;
    D.sync(state);
    save();
    if (sheet.open) sheet.close();
    render();
    message("Демоистория восстановлена");
    return;
  }
  if (name === "login") {
    state.signedOut = false;
    page = "energy";
    save();
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (name === "inbox") {
    state.seen = D.dayKey();
    save();
    updateBell();
  }
  showSheet(name);
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const { page: next, action, day, metric, period: newPeriod, confirm } = btn.dataset;
  if (next) navigate(next);
  else if (action) doAction(action);
  else if (day) showSheet("day", day);
  else if (metric) showSheet("metric", metric, btn.dataset.for || "");
  else if (newPeriod) {
    period = Number(newPeriod);
    historyLimit = 5;
    renderStats();
    document.querySelector(`[data-period="${period}"]`).focus({ preventScroll: true });
  } else if (confirm) {
    if (confirm === "clear") {
      state.historyDeleted = true;
      state.days = [];
    }
    if (confirm === "reset") {
      state.goals = D.goals();
      state.preferences = D.preferences();
    }
    if (confirm === "logout") {
      state.signedOut = true;
      page = "energy";
      scrollPositions.energy = 0;
    }
    save();
    sheet.close();
    render();
    message({ clear: "История удалена", reset: "Настройки сброшены", logout: "Выход выполнен" }[confirm]);
  }
});
sheet.addEventListener("click", (e) => {
  if (e.target === sheet) {
    const r = sheet.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) sheet.close();
  }
});
sheet.addEventListener("close", () => {
  if (detailChart) {
    detailChart.destroy();
    detailChart = null;
  }
  sheetState = null;
});
sheet.addEventListener("submit", (e) => {
  const f = e.target.closest("form");
  if (!f) return;
  e.preventDefault();
  const values = new FormData(f),
    type = f.dataset.form;
  if (type === "edit") {
    const name = values.get("name").trim();
    if (!name) {
      f.elements.name.setCustomValidity("Введи имя");
      f.elements.name.reportValidity();
      return;
    }
    state.profile = {
      name,
      surname: values.get("surname").trim(),
      age: Number(values.get("age")),
      height: Number(values.get("height")),
      weight: Number(values.get("weight")),
    };
  } else if (type === "goals") {
    state.goals = {
      steps: Number(values.get("steps")),
      sleep: Number(values.get("sleep")),
      recovery: Number(values.get("recovery")),
    };
  } else if (type === "notice-prefs") {
    state.preferences.daily = values.has("daily");
    state.preferences.reminders = values.has("reminders");
    state.seen = "";
  } else if (type === "appearance") {
    state.preferences.theme = values.get("theme");
    state.preferences.accent = values.get("accent");
  }
  save();
  sheet.close();
  render();
  message(D.canSave() ? "Изменения сохранены" : "Изменения доступны до закрытия страницы");
});
sheet.addEventListener("input", (e) => {
  if (e.target.name === "name") e.target.setCustomValidity("");
});
function checkDate() {
  const today = D.dayKey();
  if (document.hidden || today === sessionDay) return;
  sessionDay = today;
  D.sync(state, today);
  save();
  if (sheet.open) sheet.close();
  render();
}
document.addEventListener("visibilitychange", checkDate);
window.addEventListener("focus", checkDate);
window.addEventListener("storage", (event) => {
  if (event.key !== "energyapp.v1" || !event.newValue) return;
  // Получив изменения соседней вкладки, обновляем экран без обратной записи.
  const fresh = JSON.parse(event.newValue);
  Object.assign(state, fresh);
  if (sheet.open) sheet.close();
  render();
});
render();
if (!D.canSave()) message("Сохранение в браузере недоступно. Данные будут доступны до закрытия страницы.");
