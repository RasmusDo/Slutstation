import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { getUpcomingEvents, getPastEvents } from '../data/events';


const EventList = () => {
    const [hoveredId, setHoveredId] = useState(null);
    const [upcomingEvents, setUpcomingEvents] = useState([]);
    const [pastEvents, setPastEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

    // Handle window resize for responsive layout
    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth <= 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Fetch events on component mount
    useEffect(() => {
        async function loadEvents() {
            setLoading(true);
            try {
                const [upcoming, past] = await Promise.all([
                    getUpcomingEvents(),
                    getPastEvents()
                ]);
                setUpcomingEvents(upcoming);
                setPastEvents(past);
            } catch (error) {
                console.error('Error loading events:', error);
                setUpcomingEvents([]);
                setPastEvents([]);
            } finally {
                setLoading(false);
            }
        }

        loadEvents();
    }, []);

    // Show loading state
    if (loading) {
        return (
            <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                minHeight: '400px',
                color: 'var(--text-muted)'
            }}>
                <div style={{
                    textAlign: 'center',
                    fontFamily: 'var(--font-primary)'
                }}>
                    <div style={{
                        fontSize: '1.2rem',
                        marginBottom: '1rem'
                    }}>
                        Loading events...
                    </div>
                    <div style={{
                        width: '40px',
                        height: '40px',
                        border: '3px solid rgba(255, 107, 53, 0.2)',
                        borderTop: '3px solid var(--accent-color)',
                        borderRadius: '50%',
                        margin: '0 auto',
                        animation: 'spin 1s linear infinite'
                    }} />
                </div>
            </div>
        );
    }

    // Show message if no events at all
    if (!upcomingEvents || upcomingEvents.length === 0 && !pastEvents || pastEvents.length === 0) {
        return (
            <div style={{
                textAlign: 'center',
                padding: '4rem 2rem',
                color: 'var(--text-muted)'
            }}>
                <p style={{
                    fontFamily: 'var(--font-primary)',
                    fontSize: '1.2rem'
                }}>
                    No events available at the moment. Check back soon!
                </p>
            </div>
        );
    }

    return (
        <div style={{
            width: '100%',
            position: 'relative',
        }}>

            {/* Upcoming Events Section */}
            <div style={{ marginBottom: '4rem' }}>
                <h2 style={{
                    fontSize: '2rem',
                    marginBottom: '2rem',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-heading)',
                    textTransform: 'uppercase',
                    letterSpacing: '4px',
                    fontWeight: '300',
                    borderBottom: '2px solid var(--accent-color)',
                    paddingBottom: '1rem',
                    background: 'none',
                    WebkitTextFillColor: 'initial',
                }}>
                    Upcoming Events
                </h2>

                {upcomingEvents && upcomingEvents.length > 0 ? (
                    <div className="event-container" style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '1.5rem'
                    }}>
                        {upcomingEvents.map((event, index) => renderEventCard(event, index))}
                    </div>
                ) : (
                    <div style={{
                        padding: '3rem',
                        textAlign: 'center',
                        background: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                    }}>
                        <h3 style={{ fontSize: '1.5rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>Stay Tuned</h3>
                        <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>We are currently working on the next event. Check back soon or keep an eye on our Instagram.</p>
                        <a href="https://www.instagram.com/slutstation.sthlm/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-color)', textDecoration: 'none', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 'bold' }}>Follow on Instagram →</a>
                    </div>
                )}
            </div>

            {/* Past Events Section */}
            {pastEvents && pastEvents.length > 0 && (
                <div>
                    <h2 style={{
                        fontSize: '1.8rem',
                        marginBottom: '2rem',
                        marginTop: '4rem',
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-heading)',
                        textTransform: 'uppercase',
                        letterSpacing: '4px',
                        fontWeight: '300',
                        borderBottom: '1px solid var(--card-border, rgba(255, 255, 255, 0.1))',
                        paddingBottom: '1rem'
                    }}>
                        Past Events
                    </h2>

                    <div className="event-container" style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '1.5rem'
                    }}>
                        {pastEvents.map((event, index) => renderEventCard(event, index, true))}
                    </div>
                </div>
            )}
        </div>
    );

    // Helper function to render event cards
    function renderEventCard(event, index, isPast = false) {
        const cardContent = (
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
                viewport={{ once: true }}
                onMouseEnter={() => !isMobile && !isPast && setHoveredId(event.id)}
                onMouseLeave={() => !isMobile && setHoveredId(null)}
                className="event-card"
                style={{
                    display: 'flex',
                    flexDirection: isMobile ? 'column' : 'row',
                    alignItems: isMobile ? 'stretch' : 'center',
                    gap: isMobile ? '1.5rem' : '2rem',
                    padding: isMobile ? '1.5rem' : '1.5rem 2rem',
                    border: '1px solid var(--card-border, rgba(255, 255, 255, 0.1))',
                    borderRadius: '0px', // Sharper corners for Pacha look
                    background: hoveredId === event.id && !isPast ? 'var(--card-hover-bg, rgba(255, 255, 255, 0.05))' : 'var(--card-bg, transparent)',
                    boxShadow: hoveredId === event.id && !isPast ? 'var(--card-shadow, 0 8px 32px rgba(0, 0, 0, 0.1))' : 'none',
                    transition: 'all 0.3s ease',
                    cursor: isPast ? 'default' : 'pointer',
                    ...(hoveredId === event.id && !isPast && !isMobile && {
                        borderColor: 'var(--accent-color)',
                        transform: 'translateX(8px)'
                    })
                }}
            >
                {/* Event Image - Compact */}
                <div style={{
                    width: isMobile ? '100%' : '120px',
                    minWidth: isMobile ? 'auto' : '120px',
                    height: isMobile ? 'auto' : '160px',
                    aspectRatio: isMobile ? '3/4' : 'auto',
                    maxWidth: isMobile ? '200px' : 'none',
                    margin: isMobile ? '0 auto' : '0',
                    borderRadius: '0px', // Sharp
                    overflow: 'hidden',
                    backgroundColor: 'rgba(0,0,0,0.1)',
                }}>
                    <img
                        src={event.image}
                        alt={event.title}
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            filter: isPast ? 'grayscale(100%)' : 'none', // Optional: make past events grayscale
                            opacity: isPast ? 0.7 : 1
                        }}
                    />
                </div>

                {/* Event Details */}
                <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                    textAlign: isMobile ? 'center' : 'left'
                }}>
                    {/* Event Title */}
                    <h3 style={{
                        fontSize: isMobile ? '1.3rem' : '1.8rem', // Larger title
                        margin: 0,
                        color: hoveredId === event.id && !isPast ? 'var(--accent-color)' : 'var(--text-primary)',
                        fontFamily: 'var(--font-heading)',
                        fontWeight: '600',
                        letterSpacing: '0px',
                        transition: 'color 0.3s ease',
                        lineHeight: '1.2',
                        textTransform: 'uppercase'
                    }}>
                        {event.title}
                    </h3>

                    {/* Event Meta - Inline */}
                    <div style={{
                        display: 'flex',
                        flexDirection: isMobile ? 'column' : 'row',
                        flexWrap: 'wrap',
                        gap: isMobile ? '0.6rem' : '2rem',
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-primary)',
                        fontSize: '1rem',
                        justifyContent: isMobile ? 'center' : 'flex-start',
                        marginTop: '0.5rem'
                    }}>
                        {event.date && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: isMobile ? 'center' : 'flex-start' }}>
                                <span style={{ color: 'var(--accent-color)', fontWeight: '600', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>DATE</span>
                                <span>{event.date}</span>
                            </div>
                        )}
                        {event.time && event.time !== 'Time TBA' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: isMobile ? 'center' : 'flex-start' }}>
                                <span style={{ color: 'var(--accent-color)', fontWeight: '600', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>TIME</span>
                                <span>{event.time}</span>
                            </div>
                        )}
                        {event.location && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: isMobile ? 'center' : 'flex-start' }}>
                                <span style={{ color: 'var(--accent-color)', fontWeight: '600', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>LOC</span>
                                <span>{event.location}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Price - Right aligned */}
                <div style={{
                    minWidth: 'fit-content',
                    fontSize: '1.3rem',
                    fontWeight: '700',
                    color: 'var(--text-primary)', // Standard text color, maybe accent
                    fontFamily: 'var(--font-heading)',
                    textAlign: isMobile ? 'center' : 'right',
                    letterSpacing: '0.5px'
                }}>
                    {event.price}
                </div>
            </motion.div>
        );

        if (isPast) {
            return (
                <div key={event.id} style={{ display: 'block' }}>
                    {cardContent}
                </div>
            );
        }

        return (
            <Link
                key={event.id}
                to={`/event/${event.id}`}
                state={{ eventData: event }}
                style={{
                    textDecoration: 'none',
                    color: 'inherit',
                    display: 'block'
                }}
            >
                {cardContent}
            </Link>
        );
    }
};

export default EventList;

