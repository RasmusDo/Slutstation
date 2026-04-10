import React, { useState, useEffect } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getEventById } from '../data/events';
import { fetchEventTicketTypes } from '../services/billettoService';
import './EventDetail.css';

const EventDetail = () => {
    const { eventId } = useParams();
    const location = useLocation();
    const [event, setEvent] = useState(null);
    const [loading, setLoading] = useState(true);
    const [ticketTypes, setTicketTypes] = useState([]);
    const billettoLink = 'https://billetto.se/e/slutstation-biljetter-1775961';

    useEffect(() => {
        async function loadEvent() {
            setLoading(true);
            try {
                // Always call getEventById to ensure custom data merging
                const fetchedEvent = await getEventById(eventId);
                setEvent(fetchedEvent);

                if (fetchedEvent) {
                    const tickets = await fetchEventTicketTypes(eventId);
                    if (tickets) {
                        setTicketTypes(tickets);
                    }
                }
            } catch (error) {
                console.error('Error loading event:', error);
                setEvent(null);
            } finally {
                setLoading(false);
            }
        }

        loadEvent();
    }, [eventId]);

    if (loading) {
        return (
            <div style={{ paddingTop: '120px', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="container"
                    style={{ textAlign: 'center' }}
                >
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        style={{
                            fontSize: '1.2rem',
                            marginBottom: '1rem',
                            color: '#fff'
                        }}
                    >
                        Loading event...
                    </motion.div>
                    <motion.div
                        animate={{ rotate: 360 }}
                        transition={{
                            repeat: Infinity,
                            duration: 1,
                            ease: "linear"
                        }}
                        style={{
                            width: '40px',
                            height: '40px',
                            border: '3px solid rgba(255, 107, 53, 0.2)',
                            borderTop: '3px solid var(--accent-color)',
                            borderRadius: '50%',
                            margin: '0 auto',
                        }}
                    />
                </motion.div>
            </div>
        );
    }


    if (!event) {
        return (
            <div style={{ paddingTop: '120px', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="container" style={{ textAlign: 'center' }}>
                    <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '3rem', marginBottom: '2rem' }}>Event Not Found</h1>
                    <Link to="/events" className="btn">Back to Events</Link>
                </div>
            </div>
        );
    }

    return (
        <div style={{ paddingTop: 'var(--nav-height)', minHeight: '100vh' }}>
            {/* Hero Section */}
            <div style={{
                height: '',
                position: 'relative',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'flex-end'
            }}>

                <div className="container" style={{ position: 'relative', zIndex: 1, paddingBottom: '4rem' }}>
                    <motion.div
                        initial={{ opacity: 0, y: 50 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8 }}
                    >
                        <h1 className="event-title">
                            {event.title}
                        </h1>
                        <div className="event-hero-meta">
                            <span>{event.date}</span>
                            <span>{event.time}</span>
                            <span>{event.location}</span>
                        </div>
                    </motion.div>
                </div>
            </div>

            {/* Content */}
            <div className="container event-detail-content">
                <div className="event-detail-grid">
                    {/* RIGHT SIDE - Event Details (Now on Left) */}
                    <div>
                        {/* Description */}
                        <motion.section
                            initial={{ opacity: 0, y: 30 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.6 }}
                            viewport={{ once: true }}
                            style={{ marginBottom: '4rem' }}
                        >
                            <h2 style={{
                                fontFamily: 'var(--font-display)',
                                fontSize: '2rem',
                                marginBottom: '1.5rem',
                                textTransform: 'uppercase',
                                color: '#fff'
                            }}>
                                About
                            </h2>
                            <p style={{
                                fontFamily: 'var(--font-body)',
                                fontSize: '1.1rem',
                                lineHeight: 1.8,
                                color: '#aaa',
                                whiteSpace: 'pre-line'
                            }}>
                                {event.description}
                            </p>
                        </motion.section>

                        {/* Lineup */}
                        {event.lineup && event.lineup.length > 0 && (
                            <motion.section
                                initial={{ opacity: 0, y: 30 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.6 }}
                                viewport={{ once: true }}
                                style={{ marginBottom: '4rem' }}
                            >
                                <h2 style={{
                                    fontFamily: 'var(--font-display)',
                                    fontSize: '2rem',
                                    marginBottom: '2rem',
                                    textTransform: 'uppercase',
                                    color: '#fff'
                                }}>
                                    Lineup
                                </h2>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                    {event.lineup.map((artist, index) => (
                                        <motion.div
                                            key={index}
                                            initial={{ opacity: 0, x: -20 }}
                                            whileInView={{ opacity: 1, x: 0 }}
                                            transition={{ duration: 0.4, delay: index * 0.1 }}
                                            viewport={{ once: true }}
                                            style={{
                                                padding: '1.5rem 0',
                                                borderBottom: '1px solid rgba(197, 160, 89, 0.1)',
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center'
                                            }}
                                        >
                                            <div>
                                                <span style={{
                                                    fontFamily: 'var(--font-body)',
                                                    color: 'var(--accent-color)',
                                                    fontSize: '1.3rem',
                                                    fontWeight: 600,
                                                    display: 'block',
                                                    marginBottom: '0.25rem'
                                                }}>
                                                    {artist.name}
                                                </span>
                                                {artist.style && (
                                                    <span style={{ fontSize: '0.9rem', color: '#666' }}>{artist.style}</span>
                                                )}
                                            </div>
                                            {artist.link && artist.link !== '#' && (
                                                <a
                                                    href={artist.link}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{
                                                        color: 'var(--accent-color)',
                                                        fontSize: '0.9rem',
                                                        textTransform: 'uppercase',
                                                        letterSpacing: '0.1em',
                                                        transition: 'opacity 0.3s ease',
                                                        textDecoration: 'none'
                                                    }}
                                                    onMouseOver={(e) => e.target.style.opacity = '0.7'}
                                                    onMouseOut={(e) => e.target.style.opacity = '1'}
                                                >
                                                    Listen →
                                                </a>
                                            )}
                                        </motion.div>
                                    ))}
                                </div>
                            </motion.section>
                        )}

                        {/* Venue */}
                        {event.venue && (
                            <motion.section
                                initial={{ opacity: 0, y: 30 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.6 }}
                                viewport={{ once: true }}
                                style={{ marginBottom: '4rem' }}
                            >
                                <h2 style={{
                                    fontFamily: 'var(--font-display)',
                                    fontSize: '2rem',
                                    marginBottom: '1.5rem',
                                    textTransform: 'uppercase',
                                    color: '#fff'
                                }}>
                                    Venue
                                </h2>
                                <div style={{
                                    fontFamily: 'var(--font-body)',
                                    color: '#aaa',
                                    lineHeight: 1.8
                                }}>
                                    <p style={{ fontSize: '1.3rem', marginBottom: '1rem', color: 'white' }}>{event.venue.name}</p>
                                    {event.venue.capacity && <p>Capacity: {event.venue.capacity}</p>}
                                    {event.venue.facilities && <p style={{ marginTop: '1rem' }}>Facilities: {event.venue.facilities.join(', ')}</p>}
                                    {event.venue.accessibility && <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: '#666' }}>{event.venue.accessibility}</p>}
                                </div>
                            </motion.section>
                        )}

                        {/* Custom Sections */}
                        {event.sections && event.sections.length > 0 && event.sections.map((section, index) => (
                            <motion.section
                                key={index}
                                initial={{ opacity: 0, y: 30 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.6, delay: index * 0.1 }}
                                viewport={{ once: true }}
                                style={{ marginBottom: '4rem' }}
                            >
                                <h2 style={{
                                    fontFamily: 'var(--font-display)',
                                    fontSize: '2rem',
                                    marginBottom: '1.5rem',
                                    textTransform: 'uppercase',
                                    color: '#fff'
                                }}>
                                    {section.title}
                                </h2>
                                <div style={{
                                    fontFamily: 'var(--font-body)',
                                    fontSize: '1.1rem',
                                    lineHeight: 1.8,
                                    color: '#aaa',
                                    whiteSpace: 'pre-line'
                                }}>
                                    {section.content}
                                </div>
                            </motion.section>
                        ))}
                    </div>

                    {/* EVENT INFO SIDEBAR (Now on Right & Sticky) */}
                    <motion.div
                        className="event-info-sidebar"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.6, delay: 0.2 }}
                    >
                        <h3 style={{
                            fontFamily: 'var(--font-display)',
                            fontSize: '1.3rem',
                            marginBottom: '1.5rem',
                            textTransform: 'uppercase',
                            color: 'var(--accent-color)',
                            letterSpacing: '0.05em'
                        }}>
                            Event Info
                        </h3>

                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '1.5rem',
                            marginBottom: '2rem'
                        }}>
                            <div>
                                <p style={{ fontSize: '0.75rem', color: '#fff', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Date</p>
                                <p style={{ fontSize: '1.1rem', fontWeight: '500', color: '#fff' }}>{event.date}</p>
                            </div>
                            <div>
                                <p style={{ fontSize: '0.75rem', color: '#fff', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Time</p>
                                <p style={{ fontSize: '1.1rem', fontWeight: '500', color: '#fff' }}>{event.time}</p>
                            </div>
                            <div>
                                <p style={{ fontSize: '0.75rem', color: '#fff', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Location</p>
                                <p style={{ fontSize: '1.1rem', fontWeight: '500', color: '#fff' }}>{event.location}</p>
                            </div>
                            <div style={{ paddingTop: '1rem', borderTop: '1px solid rgba(197, 160, 89, 0.2)' }}>
                                <p style={{ fontSize: '0.75rem', color: '#fff', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Price</p>
                                {ticketTypes && ticketTypes.length > 0 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        {ticketTypes.map((ticket, idx) => (
                                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ fontSize: '0.9rem', color: '#ccc' }}>{ticket.name}</span>
                                                <span style={{ fontSize: '1.2rem', color: '#fff', fontWeight: '600' }}>
                                                    {ticket.price > 0 ? `${ticket.price / 100} ${ticket.currency || 'SEK'}` : 'Free'}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p style={{ fontSize: '1.8rem', color: '#fff', fontWeight: '600' }}>{event.price || '195 SEK'}</p>
                                )}
                            </div>
                        </div>

                        <a
                            href={event.ticketLink || billettoLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                                display: 'block',
                                width: '100%',
                                padding: '1rem',
                                textAlign: 'center',
                                backgroundColor: 'var(--accent-color)',
                                color: '#000',
                                textDecoration: 'none',
                                fontFamily: 'var(--font-display)',
                                fontSize: '1.5rem',
                                textTransform: 'uppercase',
                                letterSpacing: '0.1em',
                                borderRadius: '4px',
                                transition: 'all 0.3s ease',
                                cursor: 'pointer'
                            }}
                            onMouseOver={(e) => e.target.style.transform = 'translateY(-2px)'}
                            onMouseOut={(e) => e.target.style.transform = 'translateY(0)'}
                        >
                            Get Tickets →
                        </a>
                    </motion.div>
                </div>
            </div>
        </div>
    );
};

export default EventDetail;
