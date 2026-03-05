import Homey from 'homey';
import { planTrip } from '../../lib/entur-api';
import { computeLeaveTime, shouldFireCommuteTrigger } from '../../lib/commute';

const DAY_SETTINGS = ['day_sun', 'day_mon', 'day_tue', 'day_wed', 'day_thu', 'day_fri', 'day_sat'];

class CommuteDevice extends Homey.Device {
  private pollInterval: NodeJS.Timeout | undefined;
  private firedToday: string | null = null;

  async onInit() {
    const originId = this.getStoreValue('originId');
    const destinationId = this.getStoreValue('destinationId');
    if (!originId || !destinationId) {
      this.error('Missing origin or destination in store');
      return;
    }

    this.log(
      `Commute: ${this.getStoreValue('originName')} → ${this.getStoreValue('destinationName')}`,
    );

    this.registerFlowCards();

    await this.poll();
    this.pollInterval = this.homey.setInterval(() => this.poll(), 60_000);
  }

  async onSettings({
    changedKeys,
  }: {
    oldSettings: Record<string, unknown>;
    newSettings: Record<string, unknown>;
    changedKeys: string[];
  }) {
    if (changedKeys.length > 0) {
      await this.poll();
    }
  }

  async onUninit() {
    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
    }
  }

  private registerFlowCards() {
    const trigger = this.homey.flow.getDeviceTriggerCard('need_to_leave_for_work');
    trigger.registerRunListener(async (args, state) => {
      return state.minutesBefore <= args.minutes_before;
    });
  }

  private isTodayActive(): boolean {
    const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon, ...
    const settingKey = DAY_SETTINGS[dayOfWeek];
    return this.getSetting(settingKey) !== false;
  }

  private getArrivalDateTime(): Date | null {
    const timeStr = this.getSetting('arrival_time') as string;
    if (!timeStr) return null;

    const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;

    const now = new Date();
    const arrival = new Date(now);
    arrival.setHours(parseInt(match[1], 10), parseInt(match[2], 10), 0, 0);
    return arrival;
  }

  private isWithinPollingWindow(): boolean {
    const arrival = this.getArrivalDateTime();
    if (!arrival) return false;

    const now = new Date();
    const msUntilArrival = arrival.getTime() - now.getTime();
    // Poll from 2 hours before arrival until arrival time
    return msUntilArrival > 0 && msUntilArrival <= 2 * 60 * 60_000;
  }

  private async poll() {
    try {
      if (!this.isTodayActive() || !this.isWithinPollingWindow()) {
        return;
      }

      const originId = this.getStoreValue('originId');
      const destinationId = this.getStoreValue('destinationId');
      const arrival = this.getArrivalDateTime();
      if (!arrival) return;

      const arriveByStr = arrival.toISOString();
      const patterns = await planTrip(originId, destinationId, arriveByStr);

      if (patterns.length === 0) {
        await this.setCapabilityValue('commute_leave_at', 'No trips found').catch(this.error);
        await this.setCapabilityValue('commute_line', '-').catch(this.error);
        await this.setCapabilityValue('commute_travel_time', '-').catch(this.error);
        return;
      }

      const bufferMinutes = (this.getSetting('buffer_minutes') as number) || 5;
      const result = computeLeaveTime(patterns[0], bufferMinutes);
      if (!result) return;

      await this.setCapabilityValue('commute_leave_at', `Leave at ${result.leaveAtStr}`).catch(this.error);
      await this.setCapabilityValue('commute_line', result.lineDisplay).catch(this.error);
      await this.setCapabilityValue('commute_travel_time', `${result.travelMinutes} min`).catch(this.error);

      // Evaluate trigger
      const triggerResult = shouldFireCommuteTrigger(result.leaveAt, this.firedToday);
      if (triggerResult.shouldFire) {
        this.firedToday = triggerResult.dedupKey;

        const destinationName = this.getStoreValue('destinationName') as string;
        const tokens = {
          leave_at: result.leaveAtStr,
          line: result.lineCode,
          mode: result.mode,
          travel_time: result.travelMinutes,
          destination: destinationName,
        };
        const state = { minutesBefore: triggerResult.minutesBefore };

        this.homey.flow.getDeviceTriggerCard('need_to_leave_for_work')
          .trigger(this, tokens, state)
          .catch(this.error);
      }
    } catch (err) {
      this.error('Failed to poll trip:', err);
    }
  }
}

module.exports = CommuteDevice;
