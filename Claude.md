## TODOs meant to be read by Claude

### Onboarding procedure
Start by creating a device with the following onboarding procedure:
- Let the user choose a device with label `Ruter stop place`
- Let them search for a stop place using the autocomplete API https://developer.entur.org/pages-geocoder-intro. Set the ET-Client-Name to `arnab_homey-app`. The results you get back, will follow this kind of structure: https://api.entur.io/geocoder/v1/autocomplete?text=H%C3%B8yenhall&lang=en
- This should generate a list of points of interest. In the example above, the stop place with id: `NSR:StopPlace:58250` is a multi-modal stop place, meaning it serves both metro and bus (in this specific case)
- The user should then be able to choose amongst this list and configure the device so it monitors departures from the stop place that has been chosen.

### Monitoring departures

The API that needs to be polled is: https://api.entur.io/journey-planner/v3/graphql
Here is an example query that you should modify to take a stopPlace as input:
```
{
  trip(
    from: {
      place: "NSR:StopPlace:3247", 
      name: "Asker stasjon, Asker"
    }, 
    to: {
      place: "NSR:StopPlace:269", 
      name: "Oslo lufthavn, Ullensaker"
    }, 
    numTripPatterns: 3, 
  ) {
    tripPatterns {
      startTime
      duration
      walkDistance
      legs {
        mode
        distance
        line {
          id
          publicCode
          authority {
            name
          }
        }
        fromEstimatedCall {
          quay {
            id 
            name
          }
          realtime
          aimedDepartureTime
          expectedDepartureTime
          actualDepartureTime
        }
        toEstimatedCall {
          quay {
            id 
            name
          }
          aimedDepartureTime
          expectedDepartureTime
          actualDepartureTime
        }
        intermediateEstimatedCalls {
          aimedArrivalTime
          expectedArrivalTime
          actualArrivalTime
          aimedDepartureTime
          expectedDepartureTime
          actualDepartureTime
          quay {
            id 
            name
          }
        }
      }
    }
  }
}
```
It also contains some fields that are not necessary for our purpose, so please prune the query as required.

This query should be executed every 10 seconds and in addition, you should provide `searchWindow` as 10 minutes (just specify 10).

### Displaying updated info

The device should show a total of 3 departures, sorted by which leaves first. The departures should have an icon indicating the mode of transport, the name of the line and departure time. The departure time should either be number of minutes until departure if it leaves in less than 15 minutes, and otherwise just the time at which it leaves in the format HH:MM
    