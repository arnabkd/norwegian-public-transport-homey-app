const { getDepartures } = require('../../lib/entur-api');

module.exports = {
  async getDepartures({ homey, query }) {
    const { deviceId } = query;
    if (!deviceId) {
      throw new Error('No deviceId provided');
    }

    const driver = homey.drivers.getDriver('norwegian-public-transport');
    const devices = driver.getDevices();

    // deviceId from widget is the Homey internal UUID
    // Match against getData().id (NSR ID) or the Homey device ID
    const device = devices.find(
      (d) => d.getData().id === deviceId || d.__id === deviceId,
    );

    if (!device) {
      throw new Error('Device not found');
    }

    const stopPlaceId = device.getStoreValue('stopPlaceId');
    const stopPlaceName = device.getStoreValue('stopPlaceName') || '';
    const calls = await getDepartures(stopPlaceId);

    const sorted = calls.sort(
      (a, b) => new Date(a.expectedDepartureTime).getTime()
				- new Date(b.expectedDepartureTime).getTime(),
    );

    return {
      stopPlaceName,
      departures: sorted.slice(0, 10),
    };
  },
};
