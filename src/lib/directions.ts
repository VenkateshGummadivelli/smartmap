import { decode } from '@googlemaps/polyline-codec';
import { LatLngExpression } from 'leaflet';

interface DirectionsResponse {
  route: LatLngExpression[];
  summary: {
    distance: number;
    duration: number;
  };
}

export async function getDirections(
  start: [number, number],
  end: [number, number]
): Promise<DirectionsResponse> {
  // Using OSRM (Open Source Routing Machine) service
  const response = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=polyline`
  );

  if (!response.ok) {
    throw new Error('Failed to fetch directions');
  }

  const data = await response.json();

  if (!data.routes || data.routes.length === 0) {
    throw new Error('No route found');
  }

  const route = data.routes[0];
  // Decode the polyline to get array of coordinates
  const decodedRoute = decode(route.geometry).map(([lat, lng]) => [lat, lng] as LatLngExpression);

  return {
    route: decodedRoute,
    summary: {
      distance: route.distance / 1000, // Convert to kilometers
      duration: route.duration / 60, // Convert to minutes
    },
  };
}