import { useState, useCallback, useEffect, useRef } from 'react';
import { Map } from './components/Map';
import { Chat } from './components/Chat';
import { MessageSquare } from 'lucide-react';
import { getAIResponse } from './lib/ai';
import { getDirections } from './lib/directions';
import { LatLngExpression } from 'leaflet';
import debounce from 'lodash/debounce';
import { v4 as uuidv4 } from 'uuid';

type Coordinates = [number, number];

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: number;
  status?: 'sending' | 'sent' | 'error';
}

// Removed unused ChatProps interface


interface Marker {
  id: string;
  position: LatLngExpression;
  popup?: string;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      text: "Hello! I can help you find locations and get directions. Try:\n- 'Where is the Eiffel Tower?'\n- 'Show me directions from London to Paris'",
      isUser: false,
      timestamp: Date.now()
    }
  ]);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [mapCenter, setMapCenter] = useState<LatLngExpression>([51.505, -0.09]);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [route, setRoute] = useState<LatLngExpression[]>();
  const [isLoading, setIsLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [zoom, setZoom] = useState(13);
  const [pendingRequests, setPendingRequests] = useState<Set<string>>(new Set());
  const lastRequestTime = useRef<number>(0);
  const REQUEST_COOLDOWN = 1000; // 1 second cooldown

  const validateCoordinates = (lat: number, lng: number): Coordinates => {
    if (isNaN(lat) || isNaN(lng)) throw new Error('Invalid coordinates');
    if (lat < -90 || lat > 90) throw new Error('Latitude out of range');
    if (lng < -180 || lng > 180) throw new Error('Longitude out of range');
    return [lat, lng];
  };

  const calculateZoom = useCallback((bounds: Coordinates[], isRoute: boolean = false) => {
    // For single locations - differentiate between types of locations
    if (!isRoute) {
      const locationTypes = {
        // Buildings, monuments, specific places
        building: ['tower', 'temple', 'museum', 'stadium', 'palace', 'monument', 'building', 'restaurant', 'cafe', 'shop'],
        // Areas, neighborhoods
        area: ['park', 'garden', 'district', 'neighborhood', 'campus', 'complex'],
        // Cities and larger areas
        city: ['city', 'town', 'village']
      };

      const messageText = messages[messages.length - 1]?.text.toLowerCase() || '';
      
      // Check location type from the message
      if (locationTypes.building.some(type => messageText.includes(type))) {
        return 18; // Very close zoom for buildings
      } else if (locationTypes.area.some(type => messageText.includes(type))) {
        return 16; // Medium-close for areas
      } else if (locationTypes.city.some(type => messageText.includes(type))) {
        return 13; // City-level zoom
      }
      return 17; // Default close zoom for unspecified locations
    }

    // For routes - calculate optimal zoom based on distance
    const [start, end] = bounds;
    const R = 6371; // Earth's radius in km
    const dLat = (end[0] - start[0]) * Math.PI / 180;
    const dLon = (end[1] - start[1]) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(start[0] * Math.PI / 180) * Math.cos(end[0] * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;

    // Google Maps-style zoom levels based on route distance
    if (distance < 1) return 15;      // Very close (<1km) - Street level
    if (distance < 5) return 13;      // Local area (<5km)
    if (distance < 20) return 11;     // City area (<20km)
    if (distance < 50) return 10;     // Metropolitan (<50km)
    if (distance < 100) return 9;     // Regional (<100km)
    if (distance < 250) return 7;     // State level (<250km)
    if (distance < 500) return 6;     // Multi-state (<500km)
    if (distance < 1000) return 5;    // Country level (<1000km)
    if (distance < 2500) return 4;    // Continental (<2500km)
    return 3;                         // Intercontinental
  }, [messages]); // Add messages to dependencies

  // Debounced message handler
  const debouncedHandleMessage = useCallback(
    debounce(async (message: string) => {
      const now = Date.now();
      if (now - lastRequestTime.current < REQUEST_COOLDOWN) {
        throw new Error('Please wait a moment before sending another message');
      }
      
      const messageId = uuidv4();
      setPendingRequests(prev => new Set(prev).add(messageId));
      lastRequestTime.current = now;

      if (!message.trim()) return;
      
      // Cancel any pending requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      try {
        setIsLoading(true);  // Move inside try block
        
        setMessages(prev => [...prev, {
          id: messageId,
          text: message,
          isUser: true,
          timestamp: Date.now(),
          status: 'sending'
        }]);

        const aiResponse = await getAIResponse(message);
        const coordsMatches = aiResponse.match(/\[(-?\d+\.?\d*),\s*(-?\d+\.?\d*)\]/g);
        
        // Improve coordinate validation
        const coordinates = coordsMatches?.map(coord => {
          const [lat, lng] = coord.replace(/[\[\]]/g, '').split(',').map(Number);
          return validateCoordinates(lat, lng);
        });

        if ((coordinates?.length ?? 0) >= 2) {
          const [start, end] = coordinates ?? [];
          const newMarkers: Marker[] = [
            { id: uuidv4(), position: start, popup: 'Start' },
            { id: uuidv4(), position: end, popup: 'End' }
          ];
          setMarkers(newMarkers);
          
          try {
            const directions = await getDirections(start, end);
            setRoute(directions.route);
            
            // Set zoom for route
            const newZoom = calculateZoom([start, end], true);
            setZoom(newZoom);
            
            const enhancedResponse = `${aiResponse}\n\nDistance: ${directions.summary.distance.toFixed(1)} km\nEstimated time: ${Math.round(directions.summary.duration)} minutes`;
            setMessages(prev => [...prev, { id: uuidv4(), text: enhancedResponse, isUser: false, timestamp: Date.now() }]);
          } catch (error) {
            console.error('Error getting directions:', error);
            setMessages(prev => [...prev, {
              id: uuidv4(),
              text: `${aiResponse}\n\nI apologize, but I couldn't calculate the detailed route at the moment.`,
              isUser: false,
              timestamp: Date.now()
            }]);
            setRoute([start, end]);
          }
          
          // Calculate bounds properly
          if (coordinates) {
            const latitudes = coordinates.map(([lat]) => lat);
            const longitudes = coordinates.map(([, lng]) => lng);
            const center: LatLngExpression = [
              (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
              (Math.min(...longitudes) + Math.max(...longitudes)) / 2
            ];
            setMapCenter(center);
          }
        } else if (coordinates?.length === 1) {
          const locationName = message.replace(/^(where is|show me|find|locate)\s+/i, '').replace(/[?.!]$/, '');
          setMarkers([{ 
            id: uuidv4(),
            position: coordinates[0],
            popup: locationName
          }]);
          setMapCenter(coordinates[0]);
          // Let calculateZoom determine the appropriate zoom level based on location type
          const newZoom = calculateZoom([coordinates[0], coordinates[0]], false);
          setZoom(newZoom);
          setMessages(prev => [...prev, {
            id: uuidv4(),
            text: aiResponse,
            isUser: false,
            timestamp: Date.now()
          }]);
        } else {
          setMessages(prev => [...prev, { id: uuidv4(), text: aiResponse, isUser: false, timestamp: Date.now() }]);
        }

        // Update message status to 'sent'
        setMessages(prev => 
          prev.map(msg => 
            msg.id === messageId ? { ...msg, status: 'sent' } : msg
          )
        );
      } catch (error) {
        handleError(error);
        setMessages(prev => 
          prev.map(msg => 
            msg.id === messageId ? { ...msg, status: 'error' } : msg
          )
        );
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
        setPendingRequests(prev => {
          const newSet = new Set(prev);
          newSet.delete(messageId);
          return newSet;
        });
      }
    }, 500),
    [calculateZoom]
  );

  const handleError = (error: unknown) => {
    console.error('Error:', error);
    const errorMessage = 'An error occurred. Please try again.';
    setMessages(prev => [...prev, {
      id: uuidv4(),
      text: errorMessage,
      isUser: false,
      timestamp: Date.now()
    }]);
  };

  // Cleanup on unmount
  useEffect(() => {
    const controller = new AbortController();
    return () => {
      controller.abort();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      debouncedHandleMessage.cancel();
      setPendingRequests(new Set());
    };
  }, [debouncedHandleMessage]);

  // Update the map center and zoom when route changes
  useEffect(() => {
    if (route && route.length >= 2) {
      const bounds = route.map(coord => 
        Array.isArray(coord) ? coord as Coordinates : [coord.lat, coord.lng] as Coordinates
      );
      const newZoom = calculateZoom([bounds[0], bounds[bounds.length - 1]]);
      setZoom(newZoom);
      
      // Calculate center point between start and end
      const startPoint = bounds[0];
      const endPoint = bounds[bounds.length - 1];
      const center: LatLngExpression = [
        (startPoint[0] + endPoint[0]) / 2,
        (startPoint[1] + endPoint[1]) / 2
      ];
      setMapCenter(center);
    }
  }, [route, calculateZoom]);

  return (
    <div className="h-screen w-screen flex relative">
      <div className="flex-1 relative w-4/5">
        <Map 
          center={mapCenter} 
          markers={markers} 
          route={route} 
          zoom={zoom}
          onZoomChange={setZoom}
        />
        {pendingRequests.size > 0 && (
          <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm p-3 rounded-lg shadow-lg text-sm font-medium">
            Processing request...
          </div>
        )}
      </div>
      
      <div className={`w-1/5 h-full transition-transform duration-300 transform ${
        isChatOpen ? 'translate-x-0' : 'translate-x-full'
      }`}>
        <div className="h-full bg-white/95 backdrop-blur-sm shadow-lg border-l border-gray-200">
          <Chat
            messages={messages}
            onSendMessage={debouncedHandleMessage}
            isLoading={isLoading}
          />
        </div>
      </div>

      <button
        onClick={() => setIsChatOpen(!isChatOpen)}
        className="absolute top-4 right-4 z-[1000] p-3 bg-white/90 backdrop-blur-sm rounded-full shadow-lg hover:bg-gray-100 transition-all duration-200"
      >
        <MessageSquare size={24} className="text-gray-700" />
      </button>
    </div>
  );
}

export default App;