import Homey from 'homey';
import { type EstimatedCall, getDepartures } from '../../lib/entur-api';
import {
  MODE_ICONS,
  formatDepartureTime,
  evaluateDepartureTriggers,
  checkLineDepartsWithin,
  checkNextDepartureIsMode,
} from '../../lib/departures';

const CAPABILITY_KEYS = [
  'departure_line_1',
  'departure_line_2',
  'departure_line_3',
] as const;

const MODE_SETTING_KEYS: Record<string, string> = {
  bus: 'filter_bus',
  metro: 'filter_metro',
  tram: 'filter_tram',
  rail: 'filter_rail',
  water: 'filter_water',
  air: 'filter_air',
  coach: 'filter_coach',
};

class StopPlaceDevice extends Homey.Device {
  private pollInterval: NodeJS.Timeout | undefined;
  private firedTriggers = new Set<string>();
  private lastDepartures: EstimatedCall[] = [];

  async onInit() {
    const stopPlaceId = this.getStoreValue('stopPlaceId');
    if (!stopPlaceId) {
      this.error('No stopPlaceId in store');
      return;
    }

    this.log(
      `Monitoring departures for ${this.getStoreValue('stopPlaceName')} (${stopPlaceId})`,
    );

    this.registerFlowCards();

    await this.pollDepartures();
    this.pollInterval = this.homey.setInterval(
      () => this.pollDepartures(),
      10_000,
    );
  }

  async onSettings({
    changedKeys,
  }: {
    oldSettings: Record<string, unknown>;
    newSettings: Record<string, unknown>;
    changedKeys: string[];
  }) {
    if (changedKeys.some((k) => k.startsWith('filter_'))) {
      await this.pollDepartures();
    }
  }

  async onUninit() {
    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
    }
  }

  private registerFlowCards() {
    // --- Trigger: departure_leaving_soon ---
    const departureTrigger = this.homey.flow.getDeviceTriggerCard('departure_leaving_soon');
    departureTrigger.registerRunListener(async (args, state) => {
      return state.minutesUntil <= args.minutes;
    });

    // --- Trigger: line_leaving_soon ---
    const lineTrigger = this.homey.flow.getDeviceTriggerCard('line_leaving_soon');
    lineTrigger.registerRunListener(async (args, state) => {
      return state.lineId === args.line.id && state.minutesUntil <= args.minutes;
    });
    lineTrigger.registerArgumentAutocompleteListener('line', async (query) => {
      return this.getLineAutocompleteResults(query);
    });

    // --- Condition: line_departs_within ---
    const lineCondition = this.homey.flow.getConditionCard('line_departs_within');
    lineCondition.registerRunListener(async (args) => {
      return checkLineDepartsWithin(this.lastDepartures, args.line.id, args.minutes);
    });
    lineCondition.registerArgumentAutocompleteListener('line', async (query) => {
      return this.getLineAutocompleteResults(query);
    });

    // --- Condition: next_departure_is_mode ---
    const modeCondition = this.homey.flow.getConditionCard('next_departure_is_mode');
    modeCondition.registerRunListener(async (args) => {
      return checkNextDepartureIsMode(this.lastDepartures, args.mode);
    });
  }

  private getLineAutocompleteResults(query: string) {
    const seen = new Set<string>();
    const results: Array<{ id: string; name: string; description?: string }> = [];

    for (const d of this.lastDepartures) {
      const code = d.serviceJourney.line.publicCode;
      const dest = d.destinationDisplay.frontText;
      const key = `${code}|${dest}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const icon = MODE_ICONS[d.serviceJourney.line.transportMode] || '';
      results.push({
        id: key,
        name: `${icon} ${code}`,
        description: dest,
      });
    }

    if (!query) return results;
    const q = query.toLowerCase();
    return results.filter(
      (r) => r.name.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q),
    );
  }

  private getEnabledModes(): Set<string> {
    const modes = new Set<string>();
    for (const [mode, settingKey] of Object.entries(MODE_SETTING_KEYS)) {
      if (this.getSetting(settingKey) !== false) {
        modes.add(mode);
      }
    }
    return modes;
  }

  private async pollDepartures() {
    try {
      const stopPlaceId = this.getStoreValue('stopPlaceId');
      const calls = await getDepartures(stopPlaceId);
      const enabledModes = this.getEnabledModes();

      const sorted = calls
        .filter((c) => enabledModes.has(c.serviceJourney.line.transportMode))
        .sort(
          (a, b) => new Date(a.expectedDepartureTime).getTime()
            - new Date(b.expectedDepartureTime).getTime(),
        );

      this.lastDepartures = sorted;

      // Update capability display
      for (let i = 0; i < CAPABILITY_KEYS.length; i++) {
        const key = CAPABILITY_KEYS[i];
        if (sorted[i]) {
          const { label, time } = this.formatDeparture(sorted[i]);
          await this.setCapabilityValue(key, label).catch(this.error);
          await this.setCapabilityOptions(key, { title: time }).catch(
            this.error,
          );
        } else {
          await this.setCapabilityValue(key, '-').catch(this.error);
        }
      }

      // Evaluate flow triggers
      const events = evaluateDepartureTriggers(sorted, this.firedTriggers);
      for (const evt of events) {
        if (evt.type === 'departure_leaving_soon') {
          const tokens = {
            line: evt.lineCode,
            destination: evt.destination,
            mode: evt.mode,
            minutes_until: evt.minutesUntil,
          };
          const state = { minutesUntil: evt.minutesUntil, lineId: evt.lineId };
          this.homey.flow.getDeviceTriggerCard('departure_leaving_soon')
            .trigger(this, tokens, state)
            .catch(this.error);
        } else if (evt.type === 'line_leaving_soon') {
          const tokens = {
            destination: evt.destination,
            mode: evt.mode,
            minutes_until: evt.minutesUntil,
          };
          const state = { minutesUntil: evt.minutesUntil, lineId: evt.lineId };
          this.homey.flow.getDeviceTriggerCard('line_leaving_soon')
            .trigger(this, tokens, state)
            .catch(this.error);
        }
      }
    } catch (err) {
      this.error('Failed to poll departures:', err);
    }
  }

  private static readonly MAX_LEN = 20;

  private formatDeparture(call: EstimatedCall): {
    label: string;
    time: string;
  } {
    const icon = MODE_ICONS[call.serviceJourney.line.transportMode] || '\u{1F68D}';
    const line = call.serviceJourney.line.publicCode;
    const dest = call.destinationDisplay.frontText;

    const { time } = formatDepartureTime(call.expectedDepartureTime, 60);

    // Time is now in the subtitle, so the value only has: "{icon} {line} {dest}"
    // Icon counts as ~2 visible chars
    const fixedLen = 2 + 1 + line.length + 1;
    const available = StopPlaceDevice.MAX_LEN - fixedLen;
    const truncDest = dest.length > available
      ? `${dest.slice(0, Math.max(available - 1, 1))}…`
      : dest;

    return { label: `${icon} ${line} ${truncDest}`, time };
  }
}

module.exports = StopPlaceDevice;
