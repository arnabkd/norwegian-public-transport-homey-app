import Homey from 'homey';
import { searchStopPlaces, type StopPlace } from '../../lib/entur-api';

class CommuteDriver extends Homey.Driver {

  async onPair(session: Homey.Driver.PairSession) {
    let origin: StopPlace | null = null;
    let destination: StopPlace | null = null;

    session.setHandler('search', async (query: string) => {
      return searchStopPlaces(query);
    });

    session.setHandler('selectOrigin', async (stop: StopPlace) => {
      origin = stop;
    });

    session.setHandler('selectDestination', async (stop: StopPlace) => {
      destination = stop;
      if (!origin) throw new Error('Please select an origin first');
      return {
        name: `${origin.name} → ${destination.name}`,
        data: { id: `${origin.id}_${destination.id}` },
        store: {
          originId: origin.id,
          originName: origin.name,
          destinationId: destination.id,
          destinationName: destination.name,
        },
      };
    });
  }

}

module.exports = CommuteDriver;
