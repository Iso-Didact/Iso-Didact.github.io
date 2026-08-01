"use strict";

const API_URL = "https://pgos-plant-monitor.mich960831.chatgpt.site/api/readings?limit=200";
const REFRESH_MS = 5000;
const state = {
  data: { deviceId: "pgos-esp32-01", latest: null, readings: [] },
  range: 200,
  enabled: { temperature: true, light: true, gas: true },
  installPrompt: null,
  refreshing: false,
};

const $ = (id) => document.getElementById(id);
const elements = {
  statusChip: $("statusChip"), refreshButton: $("refreshButton"), lastReading: $("lastReading"),
  errorAlert: $("errorAlert"), errorText: $("errorText"), temperatureValue: $("temperatureValue"),
  lightValue: $("lightValue"), gasValue: $("gasValue"), soilValue: $("soilValue"), soilUnit: $("soilUnit"),
  temperatureState: $("temperatureState"), lightState: $("lightState"), gasState: $("gasState"),
  temperatureDot: $("temperatureDot"), lightDot: $("lightDot"), gasDot: $("gasDot"),
  soilState: $("soilState"), deviceName: $("deviceName"), stationStatus: $("stationStatus"),
  rssiValue: $("rssiValue"), sampleCount: $("sampleCount"), uptimeValue: $("uptimeValue"),
  soilConnection: $("soilConnection"), chart: $("historyChart"), chartEmpty: $("chartEmpty"),
  chartStart: $("chartStart"), chartEnd: $("chartEnd"), temperatureRange: $("temperatureRange"),
  lightAverage: $("lightAverage"), gasPeak: $("gasPeak"), wifiAverage: $("wifiAverage"),
  readingRows: $("readingRows"), installButton: $("installButton"), exportButton: $("exportButton"),
};

function parseDate(value) {
  if (!value) return null;
  return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

function ageText(value) {
  const date = parseDate(value);
  if (!date) return "Waiting for the first reading";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 8) return "Just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  return `${Math.floor(seconds / 3600)} hours ago`;
}

function formatClock(value) {
  const date = parseDate(value);
  return date ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
}

function formatUptime(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function numberValues(readings, key, validator = Number.isFinite) {
  return readings.map((reading) => Number(reading[key])).filter(validator);
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function setCondition(element, dot, label, tone) {
  element.textContent = label;
  dot.className = tone;
}

function temperatureCondition(value) {
  if (!Number.isFinite(value)) return ["No reading", ""];
  if (value < 10 || value > 38) return ["Outside plant-safe range", "danger"];
  if (value < 18) return ["Cool growing conditions", "warn"];
  if (value > 30) return ["Warm growing conditions", "warn"];
  return ["Comfortable range", "good"];
}

function lightCondition(value) {
  if (!Number.isFinite(value)) return ["No reading", ""];
  if (value < 20) return ["Low light level", "warn"];
  if (value > 90) return ["Very bright light", "warn"];
  return ["Useful growing light", "good"];
}

function gasCondition(value, alarm) {
  if (!Number.isFinite(value)) return ["No reading", ""];
  if (alarm) return ["Gas threshold detected", "danger"];
  if (value > 55) return ["Elevated air signal", "warn"];
  return ["Sensor normal", "good"];
}

function currentReadings() {
  return state.data.readings.slice(-state.range);
}

function renderStatus() {
  const latest = state.data.latest;
  const date = latest && parseDate(latest.createdAt);
  const online = Boolean(date && Date.now() - date.getTime() < 90000 && elements.errorAlert.hidden);
  elements.statusChip.className = `status-chip ${online ? "online" : latest ? "offline" : "waiting"}`;
  elements.statusChip.querySelector("span").textContent = online ? "ESP32 online" : latest ? "Reading delayed" : "Connecting";
  elements.stationStatus.textContent = online ? "ONLINE" : latest ? "DELAYED" : "CONNECTING";
  elements.lastReading.textContent = latest ? `${ageText(latest.createdAt)} · ${formatClock(latest.createdAt)}` : "Waiting for the sensor…";
}

function renderMetrics() {
  const latest = state.data.latest;
  if (!latest) return;
  const temperature = Number(latest.temperature);
  const light = Number(latest.lightPercent);
  const gas = Number(latest.gasPercent);
  const soil = Number(latest.soilPercent);
  elements.temperatureValue.textContent = Number.isFinite(temperature) ? temperature.toFixed(1) : "—";
  elements.lightValue.textContent = Number.isFinite(light) ? Math.round(light) : "—";
  elements.gasValue.textContent = Number.isFinite(gas) ? Math.round(gas) : "—";
  const [temperatureLabel, temperatureTone] = temperatureCondition(temperature);
  const [lightLabel, lightTone] = lightCondition(light);
  const [gasLabel, gasTone] = gasCondition(gas, latest.gasAlarm);
  setCondition(elements.temperatureState, elements.temperatureDot, temperatureLabel, temperatureTone);
  setCondition(elements.lightState, elements.lightDot, lightLabel, lightTone);
  setCondition(elements.gasState, elements.gasDot, gasLabel, gasTone);
  if (Number.isFinite(soil) && soil >= 0) {
    elements.soilValue.textContent = Math.round(soil);
    elements.soilUnit.textContent = "%";
    elements.soilState.textContent = soil < 30 ? "Water may be needed" : soil > 75 ? "Soil is very wet" : "Moisture in target";
    elements.soilConnection.textContent = "Connected";
  } else {
    elements.soilValue.textContent = "—";
    elements.soilUnit.textContent = "";
    elements.soilState.textContent = "Probe not installed";
    elements.soilConnection.textContent = "Not installed";
  }
}

function renderStation() {
  const latest = state.data.latest;
  const readings = currentReadings();
  elements.deviceName.textContent = state.data.deviceId || "pgos-esp32-01";
  elements.rssiValue.textContent = Number.isFinite(Number(latest?.rssi)) ? Math.round(Number(latest.rssi)) : "—";
  elements.sampleCount.textContent = String(readings.length);
  elements.uptimeValue.textContent = formatUptime(Number(latest?.uptimeSeconds));
}

function renderStatistics() {
  const readings = currentReadings();
  const temperatures = numberValues(readings, "temperature");
  const light = numberValues(readings, "lightPercent");
  const gas = numberValues(readings, "gasPercent");
  const rssi = numberValues(readings, "rssi");
  elements.temperatureRange.textContent = temperatures.length ? `${Math.min(...temperatures).toFixed(1)}–${Math.max(...temperatures).toFixed(1)} °C` : "—";
  elements.lightAverage.textContent = light.length ? `${Math.round(average(light))}%` : "—";
  elements.gasPeak.textContent = gas.length ? `${Math.round(Math.max(...gas))}%` : "—";
  elements.wifiAverage.textContent = rssi.length ? `${Math.round(average(rssi))} dBm` : "—";
}

function renderTable() {
  const readings = currentReadings().slice(-8).reverse();
  elements.readingRows.replaceChildren();
  if (!readings.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5; cell.className = "table-empty"; cell.textContent = "Waiting for ESP32 readings…";
    row.append(cell); elements.readingRows.append(row); return;
  }
  readings.forEach((reading) => {
    const values = [
      formatClock(reading.createdAt),
      Number.isFinite(Number(reading.temperature)) ? `${Number(reading.temperature).toFixed(1)} °C` : "—",
      Number.isFinite(Number(reading.lightPercent)) ? `${Math.round(Number(reading.lightPercent))}%` : "—",
      Number.isFinite(Number(reading.gasPercent)) ? `${Math.round(Number(reading.gasPercent))}%` : "—",
      Number.isFinite(Number(reading.rssi)) ? `${Math.round(Number(reading.rssi))} dBm` : "—",
    ];
    const row = document.createElement("tr");
    values.forEach((value) => { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); });
    elements.readingRows.append(row);
  });
}

function drawChart() {
  const canvas = elements.chart;
  const readings = currentReadings();
  const hasData = readings.length > 1;
  elements.chartEmpty.hidden = hasData;
  if (!hasData) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const width = rect.width;
  const height = rect.height;
  const pad = { top: 12, right: 9, bottom: 12, left: 9 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#dfe1d8";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 6]);
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotHeight * i / 4);
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
  }
  ctx.setLineDash([]);

  const definitions = [
    { key: "temperature", field: "temperature", color: "#ce7962", normalize: (value) => Math.max(0, Math.min(1, value / 50)) },
    { key: "light", field: "lightPercent", color: "#d6a148", normalize: (value) => Math.max(0, Math.min(1, value / 100)) },
    { key: "gas", field: "gasPercent", color: "#5d98aa", normalize: (value) => Math.max(0, Math.min(1, value / 100)) },
  ];

  definitions.filter((series) => state.enabled[series.key]).forEach((series) => {
    ctx.beginPath();
    ctx.strokeStyle = series.color;
    ctx.lineWidth = 2.4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    let started = false;
    readings.forEach((reading, index) => {
      const value = Number(reading[series.field]);
      if (!Number.isFinite(value)) return;
      const x = pad.left + (index / (readings.length - 1)) * plotWidth;
      const y = pad.top + (1 - series.normalize(value)) * plotHeight;
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    if (started) ctx.stroke();

    const latest = readings[readings.length - 1];
    const latestValue = Number(latest?.[series.field]);
    if (Number.isFinite(latestValue)) {
      const y = pad.top + (1 - series.normalize(latestValue)) * plotHeight;
      ctx.fillStyle = series.color;
      ctx.beginPath(); ctx.arc(width - pad.right, y, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 2; ctx.stroke();
    }
  });

  elements.chartStart.textContent = formatClock(readings[0]?.createdAt);
  elements.chartEnd.textContent = formatClock(readings[readings.length - 1]?.createdAt);
}

function render() {
  renderStatus(); renderMetrics(); renderStation(); renderStatistics(); renderTable(); drawChart();
}

async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  elements.refreshButton.classList.add("loading");
  try {
    const response = await fetch(`${API_URL}&_=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The PGOS cloud did not respond");
    state.data = data;
    elements.errorAlert.hidden = true;
    render();
  } catch (error) {
    elements.errorText.textContent = error instanceof Error ? error.message : "Unable to load readings.";
    elements.errorAlert.hidden = false;
    renderStatus();
  } finally {
    state.refreshing = false;
    elements.refreshButton.classList.remove("loading");
  }
}

function exportCsv() {
  const readings = currentReadings();
  if (!readings.length) return;
  const header = ["timestamp_utc", "temperature_c", "light_percent", "air_percent", "gas_alarm", "soil_percent", "wifi_dbm", "uptime_seconds"];
  const lines = readings.map((reading) => [reading.createdAt, reading.temperature, reading.lightPercent, reading.gasPercent, reading.gasAlarm, reading.soilPercent, reading.rssi, reading.uptimeSeconds].join(","));
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `PGOS-readings-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

document.querySelectorAll("[data-range]").forEach((button) => {
  button.addEventListener("click", () => {
    state.range = Number(button.dataset.range);
    document.querySelectorAll("[data-range]").forEach((item) => item.classList.toggle("active", item === button));
    render();
  });
});

document.querySelectorAll("[data-series]").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.series;
    state.enabled[key] = !state.enabled[key];
    button.classList.toggle("active", state.enabled[key]);
    drawChart();
  });
});

elements.refreshButton.addEventListener("click", refresh);
$("retryButton").addEventListener("click", refresh);
elements.exportButton.addEventListener("click", exportCsv);
window.addEventListener("resize", drawChart);
window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); state.installPrompt = event; elements.installButton.disabled = false; });
elements.installButton.addEventListener("click", async () => {
  if (!state.installPrompt) return;
  await state.installPrompt.prompt();
  await state.installPrompt.userChoice;
  state.installPrompt = null;
  elements.installButton.disabled = true;
  elements.installButton.textContent = "PGOS is ready on this device";
});
if (!state.installPrompt) { elements.installButton.disabled = true; elements.installButton.textContent = "Use browser menu · Install app"; }
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));

refresh();
setInterval(refresh, REFRESH_MS);
setInterval(renderStatus, 5000);
