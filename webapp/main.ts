import {
  type EstimatedCall,
  type StopPlace,
  getDepartures,
  searchStopPlaces,
} from '@lib/entur-api';

const MODE_ICONS: Record<string, string> = {
  bus: '🚌',
  metro: '🚇',
  tram: '🚊',
  rail: '🚂',
  water: '⛴️',
  air: '✈️',
  coach: '🚌',
};

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

const config = {
  displayCount: 3,
  refreshInterval: 10,
  timeWindow: 10,
};

let selectedStop: StopPlace | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let activeModes = new Set<string>();
let cachedCalls: EstimatedCall[] = [];

const searchInput = document.getElementById('search') as HTMLInputElement;
const resultsList = document.getElementById('results') as HTMLUListElement;
const selectedInfo = document.getElementById('selected-info') as HTMLElement;
const modeFiltersEl = document.getElementById('mode-filters') as HTMLElement;
const departuresEl = document.getElementById('departures') as HTMLElement;
const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement;
const cfgCount = document.getElementById('cfg-count') as HTMLInputElement;
const cfgRefresh = document.getElementById('cfg-refresh') as HTMLInputElement;
const cfgWindow = document.getElementById('cfg-window') as HTMLInputElement;
const refreshIndicator = document.getElementById('refresh-indicator') as HTMLElement;
const refreshRingFg = document.querySelector('.refresh-ring-fg') as SVGCircleElement;

// --- Functions (defined before use) ---

function formatDeparture(call: EstimatedCall): {
  icon: string;
  line: string;
  dest: string;
  time: string;
  realtime: boolean;
} {
  const icon = MODE_ICONS[call.serviceJourney.line.transportMode] || '🚍';
  const line = call.serviceJourney.line.publicCode;
  const dest = call.destinationDisplay.frontText;

  const now = Date.now();
  const departureMs = new Date(call.expectedDepartureTime).getTime();
  const diffMin = Math.round((departureMs - now) / 60_000);

  let time: string;
  if (diffMin < 1) {
    time = 'now';
  } else if (diffMin < 15) {
    time = `${diffMin} min`;
  } else {
    const d = new Date(call.expectedDepartureTime);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    time = `${hh}:${mm}`;
  }

  return {
    icon, line, dest, time, realtime: call.realtime,
  };
}

function renderDepartures(calls: EstimatedCall[]) {
  if (calls.length === 0) {
    departuresEl.innerHTML = '<div class="no-departures">No upcoming departures</div>';
    return;
  }

  departuresEl.innerHTML = calls
    .map((call) => {
      const {
        icon, line, dest, time, realtime,
      } = formatDeparture(call);
      return `<div class="departure-row">
        <span class="dep-icon">${icon}</span>
        <span class="dep-line">${line}</span>
        <span class="dep-dest">${dest}</span>
        <span class="dep-time ${time === 'now' ? 'dep-now' : ''}">${time}</span>
        ${realtime ? '<span class="dep-rt" title="Realtime">⚡</span>' : '<span class="dep-rt"></span>'}
      </div>`;
    })
    .join('');
}

function renderFilteredDepartures() {
  const filtered = cachedCalls
    .filter((call) => activeModes.has(call.serviceJourney.line.transportMode))
    .slice(0, config.displayCount);
  renderDepartures(filtered);
}

async function fetchAndRender() {
  if (!selectedStop) return;

  try {
    const numDepartures = Math.max(20, config.displayCount * 5);
    const timeRange = config.timeWindow * 60;
    const calls = await getDepartures(selectedStop.id, numDepartures, timeRange);
    cachedCalls = calls.sort(
      (a, b) => new Date(a.expectedDepartureTime).getTime() - new Date(b.expectedDepartureTime).getTime(),
    );
    renderFilteredDepartures();
    if (pollTimer) restartRefreshAnimation();
  } catch (err) {
    console.error('Failed to fetch departures:', err); // eslint-disable-line no-console
    departuresEl.innerHTML = '<div class="error">Failed to fetch departures</div>';
  }
}

function createModeToggle(mode: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = `mode-btn${activeModes.has(mode) ? ' active' : ''}`;
  btn.innerHTML = `<span class="mode-icon">${MODE_ICONS[mode] || '📍'}</span> ${mode}`;
  btn.addEventListener('click', () => {
    if (activeModes.has(mode)) {
      activeModes.delete(mode);
    } else {
      activeModes.add(mode);
    }
    btn.classList.toggle('active');
    renderFilteredDepartures();
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

function restartRefreshAnimation() {
  refreshRingFg.style.animation = 'none';
  // Force reflow to restart the animation
  // eslint-disable-next-line no-unused-expressions
  refreshRingFg.getBoundingClientRect();
  refreshRingFg.style.animation = `refresh-countdown ${config.refreshInterval}s linear infinite`;
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  refreshIndicator.classList.remove('hidden');
  restartRefreshAnimation();
  pollTimer = setInterval(
    () => fetchAndRender(),
    config.refreshInterval * 1000,
  ) as unknown as ReturnType<typeof setInterval>;
}

function restartPolling() {
  if (!selectedStop) return;
  startPolling();
}

function selectStop(stop: StopPlace) {
  selectedStop = stop;
  resultsList.innerHTML = '';
  searchInput.value = '';

  selectedInfo.classList.remove('hidden');
  selectedInfo.querySelector('.stop-title')!.textContent = `${stop.name} — ${stop.locality}`;
  selectedInfo.querySelector('.stop-id-display')!.textContent = stop.id;

  // Derive available modes from stop categories
  const modes = [...new Set(stop.categories.map((c) => CATEGORY_TO_MODE[c]).filter(Boolean))];
  activeModes = new Set(modes);
  renderModeFilters(modes);

  fetchAndRender().catch(() => { });
  startPolling();
}

async function handleSearch(query: string) {
  if (query.length < 2) {
    resultsList.innerHTML = '';
    return;
  }

  try {
    const stops = await searchStopPlaces(query);
    resultsList.innerHTML = '';
    for (const stop of stops) {
      const li = document.createElement('li');
      const icon = stop.categories.map((c) => CATEGORY_ICONS[c] || '📍').join(' ');
      li.innerHTML = `<span class="stop-icon">${icon}</span>
        <span class="stop-name">${stop.name}</span>
        <span class="stop-locality">${stop.locality}</span>
        <span class="stop-id">${stop.id}</span>`;
      li.addEventListener('click', () => selectStop(stop));
      resultsList.appendChild(li);
    }
  } catch (err) {
    console.error('Search failed:', err); // eslint-disable-line no-console
  }
}

// --- Event listeners ---

cfgCount.addEventListener('change', () => {
  config.displayCount = Math.max(1, Math.min(10, Number(cfgCount.value) || 3));
  cfgCount.value = String(config.displayCount);
  renderFilteredDepartures();
});

cfgRefresh.addEventListener('change', () => {
  config.refreshInterval = Math.max(5, Math.min(60, Number(cfgRefresh.value) || 10));
  cfgRefresh.value = String(config.refreshInterval);
  restartPolling();
});

cfgWindow.addEventListener('change', () => {
  config.timeWindow = Math.max(5, Math.min(60, Number(cfgWindow.value) || 10));
  cfgWindow.value = String(config.timeWindow);
  fetchAndRender().catch(() => { });
});

let debounceTimer: ReturnType<typeof setTimeout>;
searchInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    () => handleSearch(searchInput.value.trim()),
    300,
  );
});

clearBtn.addEventListener('click', () => {
  selectedStop = null;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  cachedCalls = [];
  selectedInfo.classList.add('hidden');
  modeFiltersEl.classList.add('hidden');
  modeFiltersEl.innerHTML = '';
  refreshIndicator.classList.add('hidden');
  refreshRingFg.style.animation = 'none';
  departuresEl.innerHTML = '';
  searchInput.value = '';
  searchInput.focus();
});
