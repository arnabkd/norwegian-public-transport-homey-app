import Homey from 'homey';
import { searchStopPlaces } from '../../lib/entur-api';

class RuterStopPlaceDriver extends Homey.Driver {

  async onPair(session: Homey.Driver.PairSession) {
    session.setHandler('search', async (query: string) => {
      return searchStopPlaces(query);
    });
  }

}

module.exports = RuterStopPlaceDriver;
