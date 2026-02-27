import Homey from 'homey';
import { getDepartures, EstimatedCall } from '../../lib/entur-api';

const MODE_ICONS: Record<string, string> = {
  bus: '\u{1F68C}',
  metro: '\u{1F687}',
  tram: '\u{1F68A}',
  rail: '\u{1F682}',
  water: '\u26F4\uFE0F',
  air: '\u2708\uFE0F',
  coach: '\u{1F68C}',
};

const CAPABILITY_KEYS = ['departure_line_1', 'departure_line_2', 'departure_line_3'] as const;

const MODE_SETTING_KEYS: Record<string, string> = {
  bus: 'filter_bus',
  metro: 'filter_metro',
  tram: 'filter_tram',
  rail: 'filter_rail',
  water: 'filter_water',
  air: 'filter_air',
  coach: 'filter_coach',
};

class RuterStopPlaceDevice extends Homey.Device {

  private pollInterval: NodeJS.Timeout | undefined;

  async onInit() {
    const stopPlaceId = this.getStoreValue('stopPlaceId');
    if (!stopPlaceId) {
      this.error('No stopPlaceId in store');
      return;
    }

    this.log(`Monitoring departures for ${this.getStoreValue('stopPlaceName')} (${stopPlaceId})`);

    await this.pollDepartures();
    this.pollInterval = this.homey.setInterval(() => this.pollDepartures(), 10_000);
  }

  async onSettings({ changedKeys }: { oldSettings: Record<string, unknown>; newSettings: Record<string, unknown>; changedKeys: string[] }) {
    if (changedKeys.some((k) => k.startsWith('filter_'))) {
      await this.pollDepartures();
    }
  }

  async onUninit() {
    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
    }
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
          (a, b) => new Date(a.expectedDepartureTime).getTime() - new Date(b.expectedDepartureTime).getTime(),
        );

      for (let i = 0; i < CAPABILITY_KEYS.length; i++) {
        const key = CAPABILITY_KEYS[i];
        if (sorted[i]) {
          const { label, time } = this.formatDeparture(sorted[i]);
          await this.setCapabilityValue(key, label).catch(this.error);
          await this.setCapabilityOptions(key, { title: time }).catch(this.error);
        } else {
          await this.setCapabilityValue(key, '-').catch(this.error);
        }
      }
    } catch (err) {
      this.error('Failed to poll departures:', err);
    }
  }

  private static readonly MAX_LEN = 20;

  private formatDeparture(call: EstimatedCall): { label: string; time: string } {
    const icon = MODE_ICONS[call.serviceJourney.line.transportMode] || '\u{1F68D}';
    const line = call.serviceJourney.line.publicCode;
    const dest = call.destinationDisplay.frontText;

    const now = Date.now();
    const departureMs = new Date(call.expectedDepartureTime).getTime();
    const diffMin = Math.round((departureMs - now) / 60_000);

    let time: string;
    if (diffMin < 1) {
      time = 'now';
    } else if (diffMin < 60) {
      time = `${diffMin} min`;
    } else {
      const d = new Date(call.expectedDepartureTime);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      time = `${hh}:${mm}`;
    }

    // Time is now in the subtitle, so the value only has: "{icon} {line} {dest}"
    // Icon counts as ~2 visible chars
    const fixedLen = 2 + 1 + line.length + 1;
    const available = RuterStopPlaceDevice.MAX_LEN - fixedLen;
    const truncDest = dest.length > available
      ? `${dest.slice(0, Math.max(available - 1, 1))}…`
      : dest;

    return { label: `${icon} ${line} ${truncDest}`, time };
  }

}

module.exports = RuterStopPlaceDevice;
