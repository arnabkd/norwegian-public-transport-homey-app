import {
  type EstimatedCall,
  type StopPlace,
  getDepartures,
  searchStopPlaces,
  planTrip,
} from '@lib/entur-api';
import {
  MODE_ICONS,
  formatDepartureTime,
  evaluateDepartureTriggers,
  checkLineDepartsWithin,
  checkNextDepartureIsMode,
  type TriggerEvent,
} from '@lib/departures';
import {
  computeLeaveTime,
  shouldFireCommuteTrigger,
} from '@lib/commute';

// ==================== Helpers ====================

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ==================== Constants ====================

const CATEGORY_ICONS: Record<string, string> = {
  onstreetBus: '🚌',
  metroStation: '🚇',
  tramStop: '🚊',
  railStation: '🚂',
  busStation: '🚌',
  ferryStop: '⛴️',
  airport: '✈️',
};

const CATEGORY_TO_MODE: Record<string, string> = {
  onstreetBus: 'bus',
  busStation: 'bus',
  metroStation: 'metro',
  tramStop: 'tram',
  railStation: 'rail',
  ferryStop: 'water',
  airport: 'air',
};

// ==================== State ====================

const depConfig = {
  displayCount: 3,
  refreshInterval: 10,
  timeWindow: 10,
  triggerThreshold: 15,
};

let depSelectedStop: StopPlace | null = null;
let depPollTimer: ReturnType<typeof setInterval> | null = null;
let depActiveModes = new Set<string>();
let depCachedCalls: EstimatedCall[] = [];
const depFiredTriggers = new Set<string>();

let commuteOrigin: StopPlace | null = null;
let commuteDest: StopPlace | null = null;
let commutePollTimer: ReturnType<typeof setInterval> | null = null;
let commuteFiredKey: string | null = null;

// ==================== DOM refs ====================

// Tabs
const tabBtns = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
const tabContents = document.querySelectorAll<HTMLElement>('.tab-content');

// Departures tab
const depSearch = document.getElementById('dep-search') as HTMLInputElement;
const depResults = document.getElementById('dep-results') as HTMLUListElement;
const depSelectedInfo = document.getElementById('dep-selected-info') as HTMLElement;
const modeFiltersEl = document.getElementById('mode-filters') as HTMLElement;
const departuresEl = document.getElementById('departures') as HTMLElement;
const depClearBtn = document.getElementById('dep-clear-btn') as HTMLButtonElement;
const cfgCount = document.getElementById('cfg-count') as HTMLInputElement;
const cfgRefresh = document.getElementById('cfg-refresh') as HTMLInputElement;
const cfgWindow = document.getElementById('cfg-window') as HTMLInputElement;
const cfgTriggerThreshold = document.getElementById('cfg-trigger-threshold') as HTMLInputElement;
const depRefreshIndicator = document.getElementById('dep-refresh-indicator') as HTMLElement;
const depRefreshRingFg = depRefreshIndicator.querySelector('.refresh-ring-fg') as SVGCircleElement;
const depConditions = document.getElementById('dep-conditions') as HTMLElement;

// Condition testers
const ctLineSelect = document.getElementById('ct-line-select') as HTMLSelectElement;
const ctLineMinutes = document.getElementById('ct-line-minutes') as HTMLInputElement;
const ctLineEval = document.getElementById('ct-line-eval') as HTMLButtonElement;
const ctLineResult = document.getElementById('ct-line-result') as HTMLElement;
const ctModeSelect = document.getElementById('ct-mode-select') as HTMLSelectElement;
const ctModeEval = document.getElementById('ct-mode-eval') as HTMLButtonElement;
const ctModeResult = document.getElementById('ct-mode-result') as HTMLElement;

// Commute tab
const commuteOriginSearch = document.getElementById('commute-origin-search') as HTMLInputElement;
const commuteOriginResults = document.getElementById('commute-origin-results') as HTMLUListElement;
const commuteOriginSelected = document.getElementById('commute-origin-selected') as HTMLElement;
const commuteOriginClear = document.getElementById('commute-origin-clear') as HTMLButtonElement;
const commuteDestSearch = document.getElementById('commute-dest-search') as HTMLInputElement;
const commuteDestResults = document.getElementById('commute-dest-results') as HTMLUListElement;
const commuteDestSelected = document.getElementById('commute-dest-selected') as HTMLElement;
const commuteDestClear = document.getElementById('commute-dest-clear') as HTMLButtonElement;
const commuteArrival = document.getElementById('commute-arrival') as HTMLInputElement;
const commuteBuffer = document.getElementById('commute-buffer') as HTMLInputElement;
const commuteTriggerMinutes = document.getElementById('commute-trigger-minutes') as HTMLInputElement;
const commuteResultEl = document.getElementById('commute-result') as HTMLElement;
const commuteLeaveAtEl = document.getElementById('commute-leave-at') as HTMLElement;
const commuteLineEl = document.getElementById('commute-line') as HTMLElement;
const commuteTravelTimeEl = document.getElementById('commute-travel-time') as HTMLElement;
const commuteRefreshIndicator = document.getElementById('commute-refresh-indicator') as HTMLElement;
const commuteRefreshRingFg = commuteRefreshIndicator.querySelector('.refresh-ring-fg') as SVGCircleElement;

// Flow log
const flowLog = document.getElementById('flow-log') as HTMLElement;

// ==================== Tab switching ====================

for (const btn of tabBtns) {
  btn.addEventListener('click', () => {
    for (const b of tabBtns) b.classList.remove('active');
    for (const c of tabContents) c.classList.remove('active');
    btn.classList.add('active');
    const tab = btn.dataset.tab!;
    document.getElementById(`tab-${tab}`)!.classList.add('active');
  });
}

// ==================== Flow log ====================

function appendLog(type: 'trigger' | 'condition', name: string, detail: string) {
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  const now = new Date();
  const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.textContent = ts;
  const typeSpan = document.createElement('span');
  typeSpan.className = `log-type ${type}`;
  typeSpan.textContent = name;
  const detailSpan = document.createElement('span');
  detailSpan.className = 'log-tokens';
  detailSpan.textContent = detail;
  entry.append(timeSpan, typeSpan, detailSpan);

  flowLog.prepend(entry);
  // Keep max 100 entries
  while (flowLog.children.length > 100) flowLog.lastChild?.remove();
}

// ==================== Search helper ====================

function renderSearchResults(
  list: HTMLUListElement,
  stops: StopPlace[],
  onSelect: (stop: StopPlace) => void,
) {
  list.innerHTML = '';
  for (const stop of stops) {
    const li = document.createElement('li');
    const icon = stop.categories.map((c) => CATEGORY_ICONS[c] || '📍').join(' ');
    li.innerHTML = `<span class="stop-icon">${icon}</span>
      <span class="stop-name">${esc(stop.name)}</span>
      <span class="stop-locality">${esc(stop.locality)}</span>`;
    li.addEventListener('click', () => onSelect(stop));
    list.appendChild(li);
  }
}

function makeSearchHandler(
  input: HTMLInputElement,
  list: HTMLUListElement,
  onSelect: (stop: StopPlace) => void,
) {
  let timer: ReturnType<typeof setTimeout>;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 2) { list.innerHTML = ''; return; }
      try {
        const stops = await searchStopPlaces(q);
        renderSearchResults(list, stops, onSelect);
      } catch (err) {
        console.error('Search failed:', err); // eslint-disable-line no-console
      }
    }, 300);
  });
}

// ==================== Departures ====================

function formatDeparture(call: EstimatedCall): {
  icon: string; line: string; dest: string; time: string; realtime: boolean;
} {
  const icon = MODE_ICONS[call.serviceJourney.line.transportMode] || '🚍';
  const line = call.serviceJourney.line.publicCode;
  const dest = call.destinationDisplay.frontText;
  const { time } = formatDepartureTime(call.expectedDepartureTime, 15);
  return { icon, line, dest, time, realtime: call.realtime };
}

function renderDepartures(calls: EstimatedCall[]) {
  if (calls.length === 0) {
    departuresEl.innerHTML = '<div class="no-departures">No upcoming departures</div>';
    return;
  }
  departuresEl.innerHTML = calls
    .map((call) => {
      const { icon, line, dest, time, realtime } = formatDeparture(call);
      return `<div class="departure-row">
        <span class="dep-icon">${icon}</span>
        <span class="dep-line">${esc(line)}</span>
        <span class="dep-dest">${esc(dest)}</span>
        <span class="dep-time ${time === 'now' ? 'dep-now' : ''}">${esc(time)}</span>
        ${realtime ? '<span class="dep-rt" title="Realtime">⚡</span>' : '<span class="dep-rt"></span>'}
      </div>`;
    })
    .join('');
}

function getFilteredDepartures(): EstimatedCall[] {
  return depCachedCalls
    .filter((call) => depActiveModes.has(call.serviceJourney.line.transportMode))
    .slice(0, depConfig.displayCount);
}

function renderFilteredDepartures() {
  renderDepartures(getFilteredDepartures());
}

function updateLineSelectOptions() {
  const seen = new Set<string>();
  ctLineSelect.innerHTML = '<option value="">Select line...</option>';
  for (const d of depCachedCalls) {
    if (!depActiveModes.has(d.serviceJourney.line.transportMode)) continue;
    const code = d.serviceJourney.line.publicCode;
    const dest = d.destinationDisplay.frontText;
    const key = `${code}|${dest}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const icon = MODE_ICONS[d.serviceJourney.line.transportMode] || '';
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = `${icon} ${code} → ${dest}`;
    ctLineSelect.appendChild(opt);
  }
}

async function fetchAndRender() {
  if (!depSelectedStop) return;
  const stopId = depSelectedStop.id;
  try {
    const numDepartures = Math.max(20, depConfig.displayCount * 5);
    const timeRange = depConfig.timeWindow * 60;
    const calls = await getDepartures(stopId, numDepartures, timeRange);
    // Discard result if stop changed while awaiting
    if (!depSelectedStop || depSelectedStop.id !== stopId) return;
    depCachedCalls = calls.sort(
      (a, b) => new Date(a.expectedDepartureTime).getTime() - new Date(b.expectedDepartureTime).getTime(),
    );
    renderFilteredDepartures();
    updateLineSelectOptions();
    if (depPollTimer) restartDepRefreshAnimation();

    // Evaluate triggers against all departures (not just display slice)
    const events = evaluateDepartureTriggers(depCachedCalls, depFiredTriggers);
    for (const evt of events) {
      logTriggerEvent(evt);
    }
  } catch (err) {
    console.error('Failed to fetch departures:', err); // eslint-disable-line no-console
    departuresEl.innerHTML = '<div class="error">Failed to fetch departures</div>';
  }
}

function logTriggerEvent(evt: TriggerEvent) {
  if (evt.type === 'departure_leaving_soon') {
    appendLog(
      'trigger',
      'departure_leaving_soon',
      `${MODE_ICONS[evt.mode] || ''} ${evt.lineCode} → ${evt.destination} (${evt.minutesUntil} min)`,
    );
  } else {
    appendLog(
      'trigger',
      'line_leaving_soon',
      `${MODE_ICONS[evt.mode] || ''} ${evt.lineCode} → ${evt.destination} (${evt.minutesUntil} min)`,
    );
  }
}

function createModeToggle(mode: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = `mode-btn${depActiveModes.has(mode) ? ' active' : ''}`;
  btn.innerHTML = `<span class="mode-icon">${MODE_ICONS[mode] || '📍'}</span> ${mode}`;
  btn.addEventListener('click', () => {
    if (depActiveModes.has(mode)) depActiveModes.delete(mode);
    else depActiveModes.add(mode);
    btn.classList.toggle('active');
    renderFilteredDepartures();
    updateLineSelectOptions();
  });
  return btn;
}

function renderModeFilters(modes: string[]) {
  if (modes.length <= 1) {
    modeFiltersEl.classList.add('hidden');
    return;
  }
  modeFiltersEl.classList.remove('hidden');
  modeFiltersEl.innerHTML = '';
  for (const mode of modes) {
    modeFiltersEl.appendChild(createModeToggle(mode));
  }
}

function restartDepRefreshAnimation() {
  depRefreshRingFg.style.animation = 'none';
  depRefreshRingFg.getBoundingClientRect(); // force reflow
  depRefreshRingFg.style.animation = `refresh-countdown ${depConfig.refreshInterval}s linear infinite`;
}

function startDepPolling() {
  if (depPollTimer) clearInterval(depPollTimer);
  depRefreshIndicator.classList.remove('hidden');
  restartDepRefreshAnimation();
  depPollTimer = setInterval(() => fetchAndRender(), depConfig.refreshInterval * 1000) as unknown as ReturnType<typeof setInterval>;
}

function selectDepStop(stop: StopPlace) {
  depSelectedStop = stop;
  depResults.innerHTML = '';
  depSearch.value = '';
  depFiredTriggers.clear();

  depSelectedInfo.classList.remove('hidden');
  depSelectedInfo.querySelector('.stop-title')!.textContent = `${stop.name} — ${stop.locality}`;
  depSelectedInfo.querySelector('.stop-id-display')!.textContent = stop.id;

  const modes = [...new Set(stop.categories.map((c) => CATEGORY_TO_MODE[c]).filter(Boolean))];
  depActiveModes = new Set(modes);
  renderModeFilters(modes);
  depConditions.classList.remove('hidden');

  fetchAndRender().catch(() => {});
  startDepPolling();
}

function clearDepStop() {
  depSelectedStop = null;
  if (depPollTimer) clearInterval(depPollTimer);
  depPollTimer = null;
  depCachedCalls = [];
  depFiredTriggers.clear();
  depSelectedInfo.classList.add('hidden');
  modeFiltersEl.classList.add('hidden');
  modeFiltersEl.innerHTML = '';
  depRefreshIndicator.classList.add('hidden');
  depRefreshRingFg.style.animation = 'none';
  departuresEl.innerHTML = '';
  depConditions.classList.add('hidden');
  depSearch.value = '';
  depSearch.focus();
}

// Departures search
makeSearchHandler(depSearch, depResults, selectDepStop);
depClearBtn.addEventListener('click', clearDepStop);

// Departures settings
cfgCount.addEventListener('change', () => {
  depConfig.displayCount = Math.max(1, Math.min(10, Number(cfgCount.value) || 3));
  cfgCount.value = String(depConfig.displayCount);
  renderFilteredDepartures();
});
cfgRefresh.addEventListener('change', () => {
  depConfig.refreshInterval = Math.max(5, Math.min(60, Number(cfgRefresh.value) || 10));
  cfgRefresh.value = String(depConfig.refreshInterval);
  if (depSelectedStop) startDepPolling();
});
cfgWindow.addEventListener('change', () => {
  depConfig.timeWindow = Math.max(5, Math.min(60, Number(cfgWindow.value) || 10));
  cfgWindow.value = String(depConfig.timeWindow);
  fetchAndRender().catch(() => {});
});
cfgTriggerThreshold.addEventListener('change', () => {
  depConfig.triggerThreshold = Math.max(1, Math.min(60, Number(cfgTriggerThreshold.value) || 15));
  cfgTriggerThreshold.value = String(depConfig.triggerThreshold);
});

// Condition: line_departs_within
ctLineEval.addEventListener('click', () => {
  const lineId = ctLineSelect.value;
  const minutes = Number(ctLineMinutes.value) || 10;
  if (!lineId) { ctLineResult.textContent = '—'; ctLineResult.className = 'result-badge pending'; return; }
  const filtered = depCachedCalls.filter((c) => depActiveModes.has(c.serviceJourney.line.transportMode));
  const result = checkLineDepartsWithin(filtered, lineId, minutes);
  ctLineResult.textContent = result ? 'TRUE' : 'FALSE';
  ctLineResult.className = `result-badge ${result}`;
  appendLog('condition', 'line_departs_within', `${lineId} within ${minutes} min → ${result}`);
});

// Condition: next_departure_is_mode
ctModeEval.addEventListener('click', () => {
  const mode = ctModeSelect.value;
  const filtered = depCachedCalls.filter((c) => depActiveModes.has(c.serviceJourney.line.transportMode));
  const result = checkNextDepartureIsMode(filtered, mode);
  ctModeResult.textContent = result ? 'TRUE' : 'FALSE';
  ctModeResult.className = `result-badge ${result}`;
  appendLog('condition', 'next_departure_is_mode', `${MODE_ICONS[mode] || ''} ${mode} → ${result}`);
});

// ==================== Commute ====================

function showCommuteOriginSelected(stop: StopPlace) {
  commuteOriginSelected.classList.remove('hidden');
  commuteOriginSelected.querySelector('.stop-title')!.textContent = `${stop.name} — ${stop.locality}`;
  commuteOriginSearch.value = '';
  commuteOriginResults.innerHTML = '';
}

function showCommuteDestSelected(stop: StopPlace) {
  commuteDestSelected.classList.remove('hidden');
  commuteDestSelected.querySelector('.stop-title')!.textContent = `${stop.name} — ${stop.locality}`;
  commuteDestSearch.value = '';
  commuteDestResults.innerHTML = '';
}

function restartCommuteRefreshAnimation() {
  commuteRefreshRingFg.style.animation = 'none';
  commuteRefreshRingFg.getBoundingClientRect();
  commuteRefreshRingFg.style.animation = 'refresh-countdown 60s linear infinite';
}

async function fetchCommute() {
  if (!commuteOrigin || !commuteDest) return;
  const originId = commuteOrigin.id;
  const destId = commuteDest.id;

  const timeStr = commuteArrival.value;
  if (!timeStr) return;
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return;

  const now = new Date();
  const arrival = new Date(now);
  arrival.setHours(parseInt(match[1], 10), parseInt(match[2], 10), 0, 0);

  try {
    const patterns = await planTrip(originId, destId, arrival.toISOString());
    // Discard result if origin/dest changed while awaiting
    if (!commuteOrigin || !commuteDest || commuteOrigin.id !== originId || commuteDest.id !== destId) return;
    if (patterns.length === 0) {
      commuteLeaveAtEl.textContent = 'No trips';
      commuteLineEl.textContent = '—';
      commuteTravelTimeEl.textContent = '—';
      return;
    }

    const bufferMinutes = Number(commuteBuffer.value) || 5;
    const result = computeLeaveTime(patterns[0], bufferMinutes);
    if (!result) return;

    commuteResultEl.classList.remove('hidden');
    commuteLeaveAtEl.textContent = result.leaveAtStr;
    commuteLineEl.textContent = result.lineDisplay;
    commuteTravelTimeEl.textContent = `${result.travelMinutes} min`;

    // Evaluate trigger
    const triggerResult = shouldFireCommuteTrigger(result.leaveAt, commuteFiredKey);
    const triggerMinutesSetting = Number(commuteTriggerMinutes.value) || 30;
    if (triggerResult.shouldFire && triggerResult.minutesBefore <= triggerMinutesSetting) {
      commuteFiredKey = triggerResult.dedupKey;
      appendLog(
        'trigger',
        'need_to_leave_for_work',
        `Leave at ${result.leaveAtStr}, ${result.lineDisplay}, ${result.travelMinutes} min travel, ${triggerResult.minutesBefore} min before`,
      );
    }
  } catch (err) {
    console.error('Failed to fetch commute:', err); // eslint-disable-line no-console
  }
}

function startCommutePolling() {
  if (commutePollTimer) clearInterval(commutePollTimer);
  commuteRefreshIndicator.classList.remove('hidden');
  restartCommuteRefreshAnimation();
  commutePollTimer = setInterval(() => fetchCommute(), 60_000) as unknown as ReturnType<typeof setInterval>;
}

function tryStartCommute() {
  if (commuteOrigin && commuteDest) {
    commuteFiredKey = null;
    fetchCommute().catch(() => {});
    startCommutePolling();
  }
}

makeSearchHandler(commuteOriginSearch, commuteOriginResults, (stop) => {
  commuteOrigin = stop;
  showCommuteOriginSelected(stop);
  tryStartCommute();
});

makeSearchHandler(commuteDestSearch, commuteDestResults, (stop) => {
  commuteDest = stop;
  showCommuteDestSelected(stop);
  tryStartCommute();
});

commuteOriginClear.addEventListener('click', () => {
  commuteOrigin = null;
  commuteOriginSelected.classList.add('hidden');
  commuteResultEl.classList.add('hidden');
  if (commutePollTimer) { clearInterval(commutePollTimer); commutePollTimer = null; }
  commuteRefreshIndicator.classList.add('hidden');
  commuteRefreshRingFg.style.animation = 'none';
  commuteOriginSearch.focus();
});

commuteDestClear.addEventListener('click', () => {
  commuteDest = null;
  commuteDestSelected.classList.add('hidden');
  commuteResultEl.classList.add('hidden');
  if (commutePollTimer) { clearInterval(commutePollTimer); commutePollTimer = null; }
  commuteRefreshIndicator.classList.add('hidden');
  commuteRefreshRingFg.style.animation = 'none';
  commuteDestSearch.focus();
});

commuteArrival.addEventListener('change', () => { commuteFiredKey = null; tryStartCommute(); });
commuteBuffer.addEventListener('change', () => { commuteFiredKey = null; tryStartCommute(); });
