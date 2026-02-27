import Homey from 'homey';
import { searchStopPlaces, getDepartures } from '../../lib/entur-api';

class RuterStopPlaceDriver extends Homey.Driver {

  async onPair(session: Homey.Driver.PairSession) {
    session.setHandler('search', async (query: string) => {
      return searchStopPlaces(query);
    });

    session.setHandler('getStopModes', async (stopPlaceId: string) => {
      const calls = await getDepartures(stopPlaceId);
      const modes = new Set(calls.map((c) => c.serviceJourney.line.transportMode));
      return Array.from(modes);
    });
  }

}

module.exports = RuterStopPlaceDriver;
