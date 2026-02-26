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

  async onUninit() {
    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
    }
  }

  private async pollDepartures() {
    try {
      const stopPlaceId = this.getStoreValue('stopPlaceId');
      const calls = await getDepartures(stopPlaceId);

      const sorted = calls.sort(
        (a, b) => new Date(a.expectedDepartureTime).getTime() - new Date(b.expectedDepartureTime).getTime(),
      );

      for (let i = 0; i < CAPABILITY_KEYS.length; i++) {
        const value = sorted[i] ? this.formatDeparture(sorted[i]) : '-';
        await this.setCapabilityValue(CAPABILITY_KEYS[i], value).catch(this.error);
      }
    } catch (err) {
      this.error('Failed to poll departures:', err);
    }
  }

  private formatDeparture(call: EstimatedCall): string {
    const icon = MODE_ICONS[call.serviceJourney.line.transportMode] || '\u{1F68D}';
    const line = call.serviceJourney.line.publicCode;
    const dest = call.destinationDisplay.frontText;

    const now = Date.now();
    const departureMs = new Date(call.expectedDepartureTime).getTime();
    const diffMin = Math.round((departureMs - now) / 60_000);

    let timeStr: string;
    if (diffMin < 1) {
      timeStr = 'now';
    } else if (diffMin < 15) {
      timeStr = `${diffMin} min`;
    } else {
      const d = new Date(call.expectedDepartureTime);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      timeStr = `${hh}:${mm}`;
    }

    return `${icon} ${line} ${dest} - ${timeStr}`;
  }

}

module.exports = RuterStopPlaceDevice;
