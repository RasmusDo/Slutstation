/**
 * Event Mapper Utility
 * Transforms Billetto API response to application's event structure
 */
import fredagenPoster from '../assets/images/eventposters/Fredagen.png';
import lastpathPoster from '../assets/images/eventposters/Lastpath.png';
import outdoorsPoster from '../assets/images/eventposters/Outdoors.jpg';
import storstaPoster from '../assets/images/eventposters/storsta.png';
import poster0214 from '../assets/images/eventposters/0214.PNG';

/**
 * Map Billetto event to application event format
 * @param {Object} billettoEvent - Event from Billetto API
 * @param {number} index - Index of the event in the list (used for default image selection)
 * @returns {Object} Formatted event for application
 */
export function mapBillettoEvent(billettoEvent, index = 0) {
    // Billetto API uses different field names for different endpoints
    const {
        id,
        name,
        description,
        startdate,     // Public upcoming events use 'startdate'
        starts_at,     // Past events use 'starts_at'
        enddate,       // Public upcoming events use 'enddate'
        ends_at,       // Past events use 'ends_at'
        location,
        image_link,
        ticket_types,
        url,
    } = billettoEvent;

    // Use whichever date field is available
    const eventStartDate = startdate || starts_at;
    const eventEndDate = enddate || ends_at;

    // Format date - handle events with no date
    let formattedDate = '';
    let formattedTime = '';
    let endTime = null;

    if (eventStartDate) {
        const startDate = new Date(eventStartDate);
        if (!isNaN(startDate.getTime())) {  // Check if valid date
            formattedDate = startDate.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });

            formattedTime = startDate.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });

            if (eventEndDate) {
                const endDateTime = new Date(eventEndDate);
                if (!isNaN(endDateTime.getTime())) {
                    endTime = endDateTime.toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false
                    });
                }
            }
        }
    }

    // Get ticket price (use lowest price from ticket types)
    let price = '';
    if (ticket_types && ticket_types.length > 0) {
        const prices = ticket_types
            .filter(t => t.price)
            .map(t => parseFloat(t.price));

        if (prices.length > 0) {
            const minPrice = Math.min(...prices);
            price = `${minPrice} SEK`;
        }
    }

    // Handle location - can be an object or just an ID string
    let locationName = '';
    let locationAddress = '';
    let locationCity = 'Stockholm';

    if (location && typeof location === 'object') {
        // Location is an object with details
        locationName = location.location_name || location.name || 'Stockholm';
        locationAddress = location.address_line || location.address || '';
        locationCity = location.city || 'Stockholm';
    } else if (location && typeof location === 'string') {
        // Location is just an ID - use generic placeholder
        locationName = 'Stockholm';
        locationAddress = 'Stockholm, Sweden';
    }

    // Custom fallback images for past events without images
    const defaultImages = [
        poster0214,
        lastpathPoster,
        outdoorsPoster,
        fredagenPoster,
        storstaPoster,
    ];

    // Determine if event is upcoming (today or future)
    let isUpcoming = false;
    if (eventStartDate) {
        const eventDate = new Date(eventStartDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        isUpcoming = eventDate >= today;
    }

    // Use image_link if available. 
    // If not, use posterNew for upcoming events, or rotate specific past images for past events.
    let eventImage = image_link;

    if (!eventImage) {
        if (isUpcoming) {
            eventImage = poster0214;
        } else {
            eventImage = defaultImages[index % defaultImages.length];
        }
    }

    // Map to application format
    return {
        id: id.toString(),
        title: name || 'Untitled Event',
        date: formattedDate,
        time: endTime ? `${formattedTime} - ${endTime}` : formattedTime,
        price: price,
        location: locationName,
        address: locationAddress,
        city: locationCity,
        image: eventImage,
        description: description || 'Event details coming soon.',
        venue: {
            name: locationName,
            capacity: location?.capacity || 'TBA',
            facilities: ['Bar', 'Cloakroom'], // Default facilities
            accessibility: '18+ only, ID required'
        },
        lineup: [], // Billetto doesn't typically provide lineup in API, keep empty or static
        ticketLink: url || `https://billetto.com/events/${id}`,
        // Add raw date for filtering
        start_date: eventStartDate,
        rawStartDate: eventStartDate
    };
}

/**
 * Map array of Billetto events
 * @param {Array} billettoEvents - Array of events from Billetto API
 * @returns {Array} Array of formatted events
 */
export function mapBillettoEvents(billettoEvents) {
    if (!billettoEvents || !Array.isArray(billettoEvents)) {
        return [];
    }

    return billettoEvents.map(mapBillettoEvent);
}

/**
 * Filter only active/upcoming events
 * @param {Array} events - Array of events
 * @returns {Array} Filtered active events
 */
export function filterActiveEvents(events) {
    const now = new Date();

    return events.filter(event => {
        // Use rawStartDate or start_date which we set in mapBillettoEvent
        const dateStr = event.rawStartDate || event.start_date;

        if (dateStr) {
            // Check if event is today or in future (allow events from today)
            const eventDate = new Date(dateStr);
            const today = new Date();
            today.setHours(0, 0, 0, 0); // Reset time part to compare dates only for today inclusion

            return eventDate >= today;
        }

        // Otherwise just return all events
        return true;
    });
}
