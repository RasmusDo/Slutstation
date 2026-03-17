import { fetchBillettoEvents, fetchPastEvents, fetchUpcomingEvents, fetchBillettoEventById, isConfigured } from '../services/billettoService';
import { mapBillettoEvents, filterActiveEvents } from '../utils/eventMapper';
import { mergeEventData } from '../utils/eventMerger';

// Static fallback events (used if API fails or is not configured)
const staticEvents = [];

/**
 * Custom Event Data
 * Add your custom event content here, indexed by Billetto Event ID
 * This data will be merged with live API data for rich, customizable event pages
 */
const customEventData = {
    '1775961': {
        title: 'Mister French',
        customDescription: 'Join us for an unforgettable night of Tech-house and Minimal house.\n\nTogether with Mister French, we bring the Tech-house sounds of Ibiza to Stockholm for one night only. Experience carefully curated sounds in an vibrant setting where the music takes center stage.\n\nThis is not just another club night, it\'s a journey through sound, atmosphere, and connection.\n\nNo Membership required.',
        customImage: '/images/events/mister-french.jpg',
        lineup: [
            {
                name: 'TOMI & KESH',
                bio: 'Tomi & Kesh are a Stuttgart-based tech house duo delivering raw, hypnotic energy made for ibiza venues and big sound systems. With multiple Beatport #1s and support from scene heavyweights, they’re a go-to act for intense tech-house sets.',
                link: 'https://soundcloud.com/tomi-and-kesh',
                style: 'Tech House'
            },
            {
                name: 'VASA',
                bio: 'Vasa BIO',
                link: 'https://www.instagram.com/vasa.music/',
                style: 'Tech House'
            },
            {
                name: 'DAVVE',
                bio: 'DAVVE BIO',
                link: 'https://www.instagram.com/davveofficial/',
                style: 'Tech House'
            },
            {
                name: 'CATCH A',
                bio: 'CATCH A BIO',
                link: 'https://www.instagram.com/catchadj/',
                style: 'Minimal House'
            },
            {
                name: 'LAZY FOUS',
                bio: 'LAZY FOUS BIO',
                link: 'https://www.instagram.com/lazyfous/',
                style: 'French House'
            },
            {
                name: 'ESSY',
                bio: 'ESSY BIO',
                link: 'https://www.instagram.com/essynachtweij/',
                style: 'Afro House'
            },
        ],
        venue: {
            name: 'Mister French',
            capacity: '750',
            facilities: ['Premium Sound System', 'Custom made stage design', '2 Bars'],
            accessibility: 'Location: Mister French Tullhus 2, Stockholm'
        },
        sections: [
            {
                title: 'House Rules',
                content: '• Respect the space and each other.\n• There will be on-duty security personnel(ordningsvakter).\n• NO BYOB.\n• Zero tolerance for harassment, racism etc.\n• Phones down, eyes up.\n• Strictly forbidden to not have fun!'
            },
            {
                title: 'Getting There',
                content: 'This event is NOT held at a secret location, please refer to the adress above. Keep an eye on our Instagram for more information.'
            }
        ]
    }
};

/**
 * Fetch events from Billetto API
 * @returns {Promise<Array>} Array of events
 */
export async function getEvents() {
    if (!isConfigured()) {
        console.log('Billetto API not configured');
        return [];
    }

    try {
        const billettoEvents = await fetchBillettoEvents();

        if (billettoEvents && billettoEvents.length > 0) {
            const mappedEvents = mapBillettoEvents(billettoEvents);
            const activeEvents = filterActiveEvents(mappedEvents);
            console.log(`Loaded ${activeEvents.length} events from Billetto API`);
            return activeEvents;
        }

        console.log('No events from Billetto API');
        return [];
    } catch (error) {
        console.error('Error fetching events:', error);
        return [];
    }
}

/**
 * Get upcoming/active events from API
 * @returns {Promise<Array>} Array of upcoming events
 */
export async function getUpcomingEvents() {
    if (!isConfigured()) {
        console.log('Billetto API not configured');
        return [];
    }

    try {
        const billettoEvents = await fetchUpcomingEvents();

        if (billettoEvents && billettoEvents.length > 0) {
            const mappedEvents = mapBillettoEvents(billettoEvents);
            const activeEvents = filterActiveEvents(mappedEvents);
            console.log(`Loaded ${activeEvents.length} upcoming events from Billetto API`);
            return activeEvents;
        }

        console.log('No upcoming events from Billetto API');
        return [];
    } catch (error) {
        console.error('Error fetching upcoming events:', error);
        return [];
    }
}

/**
 * Get past/completed events from API
 * @returns {Promise<Array>} Array of past events
 */
export async function getPastEvents() {
    if (!isConfigured()) {
        console.log('Billetto API not configured');
        return [];
    }

    try {
        const billettoEvents = await fetchPastEvents();

        if (billettoEvents && billettoEvents.length > 0) {
            const mappedEvents = mapBillettoEvents(billettoEvents);
            console.log(`Loaded ${mappedEvents.length} past events from Billetto API`);
            return mappedEvents;
        }

        console.log('No past events from Billetto API');
        return [];
    } catch (error) {
        console.error('Error fetching past events:', error);
        return [];
    }
}

/**
 * Get event by ID (checks both API and static data)
 * @param {string} id - Event ID
 * @returns {Promise<Object|null>} Event object or null
 */
export async function getEventById(id) {
    let apiEvent = null;

    if (isConfigured()) {
        // Try direct fetch first (works for active events)
        const billettoEvent = await fetchBillettoEventById(id);

        if (billettoEvent) {
            const mapped = mapBillettoEvents([billettoEvent])[0];
            apiEvent = mapped;
            console.log('Event fetched directly from API');
        } else {
            console.log('Direct fetch returned null, trying event lists...');

            // Fallback: Search in past and upcoming events
            // This is needed because Billetto doesn't allow fetching completed events by ID
            try {
                const [pastEvents, upcomingEvents] = await Promise.all([
                    getPastEvents(),
                    getUpcomingEvents()
                ]);

                const allEvents = [...(upcomingEvents || []), ...(pastEvents || [])];
                apiEvent = allEvents.find(event => event.id === id);

                if (apiEvent) {
                    console.log('Found event in events list');
                } else {
                    console.log('Event not found in any list');
                }
            } catch (listError) {
                console.error('Error fetching event from lists:', listError);
            }
        }
    }

    const customData = customEventData[id];

    console.log('=== EVENT LOADING DEBUG ===');
    console.log('Event ID:', id);
    console.log('API Event:', apiEvent);
    console.log('Custom Data:', customData);

    if (customData || apiEvent) {
        const mergedEvent = mergeEventData(apiEvent, customData);
        console.log('Merged Event:', mergedEvent);
        console.log(`Event ${id}: ${customData ? 'HAS Custom content ✓' : 'NO custom content ✗'} + ${apiEvent ? 'HAS API data ✓' : 'NO API data ✗'}`);
        return mergedEvent;
    }

    return staticEvents.find(event => event.id === id) || null;
}

export const events = staticEvents;
