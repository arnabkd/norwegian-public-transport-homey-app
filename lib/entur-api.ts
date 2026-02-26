const BASE_HEADERS = {
  'ET-Client-Name': 'arnab_homey-app',
};

export interface StopPlace {
  id: string;
  name: string;
  locality: string;
  categories: string[];
}

export interface EstimatedCall {
  realtime: boolean;
  aimedDepartureTime: string;
  expectedDepartureTime: string;
  destinationDisplay: { frontText: string };
  serviceJourney: {
    line: { publicCode: string; transportMode: string };
  };
}

interface GeocoderFeature {
  properties: {
    id: string;
    name: string;
    locality?: string;
    category?: string[];
  };
}

interface GeocoderResponse {
  features: GeocoderFeature[];
}

interface DeparturesResponse {
  data: {
    stopPlace: {
      name: string;
      estimatedCalls: EstimatedCall[];
    } | null;
  };
}

export async function searchStopPlaces(query: string): Promise<StopPlace[]> {
  const url = `https://api.entur.io/geocoder/v1/autocomplete?text=${encodeURIComponent(query)}&lang=en`;
  const res = await fetch(url, { headers: BASE_HEADERS });
  const data = await res.json() as GeocoderResponse;

  return (data.features || [])
    .filter((f) => f.properties.id?.startsWith('NSR:StopPlace:'))
    .map((f) => ({
      id: f.properties.id,
      name: f.properties.name,
      locality: f.properties.locality || '',
      categories: f.properties.category || [],
    }));
}

const DEPARTURES_QUERY = `
query GetDepartures($id: String!) {
  stopPlace(id: $id) {
    name
    estimatedCalls(numberOfDepartures: 20, timeRange: 600) {
      realtime
      aimedDepartureTime
      expectedDepartureTime
      destinationDisplay { frontText }
      serviceJourney {
        line { publicCode transportMode }
      }
    }
  }
}
`;

export async function getDepartures(stopPlaceId: string): Promise<EstimatedCall[]> {
  const res = await fetch('https://api.entur.io/journey-planner/v3/graphql', {
    method: 'POST',
    headers: {
      ...BASE_HEADERS,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: DEPARTURES_QUERY,
      variables: { id: stopPlaceId },
    }),
  });

  const json = await res.json() as DeparturesResponse;
  return json.data?.stopPlace?.estimatedCalls ?? [];
}
