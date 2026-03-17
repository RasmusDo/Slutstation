import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import emailjs from '@emailjs/browser';

const Ambassador = () => {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '',
        socialMedia: '',
        why: ''
    });

    const [status, setStatus] = useState({
        loading: false,
        success: false,
        error: null
    });

    const handleSubmit = async (e) => {
        e.preventDefault();
        setStatus({ loading: true, success: false, error: null });

        // Temporarily using EmailJS, later to be integrated with Billetto referral service
        const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID;
        const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
        const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;

        if (!serviceId || !templateId || !publicKey) {
            // If keys are not set, you can just simulate success for now
            console.warn("EmailJS is not configured. Simulating success...");
            setTimeout(() => {
                setStatus({ loading: false, success: true, error: null });
                setFormData({
                    name: '',
                    email: '',
                    phone: '',
                    socialMedia: '',
                    why: ''
                });
                setTimeout(() => setStatus(prev => ({ ...prev, success: false })), 5000);
            }, 1000);
            return;
        }

        try {
            const templateParams = {
                to_email: 'info@slutstation.se',
                from_name: formData.name,
                from_email: formData.email,
                phone: formData.phone,
                social_media: formData.socialMedia,
                message: formData.why,
                type_of_inquiry: 'Ambassador Program Application'
            };

            await emailjs.send(serviceId, templateId, templateParams, publicKey);

            setStatus({ loading: false, success: true, error: null });
            setFormData({
                name: '',
                email: '',
                phone: '',
                socialMedia: '',
                why: ''
            });

            // Reset success message after 5 seconds
            setTimeout(() => {
                setStatus(prev => ({ ...prev, success: false }));
            }, 5000);

        } catch (error) {
            console.error('EmailJS Error:', error);
            setStatus({
                loading: false,
                success: false,
                error: "Failed to send application. Please try again later."
            });
        }
    };

    const handleChange = (e) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        });
    };

    const inputStyle = {
        width: '100%',
        padding: '1rem',
        background: 'rgba(255, 255, 255, 0.05)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '8px',
        color: 'var(--text-primary)',
        fontSize: '1rem',
        marginBottom: '1.5rem',
        outline: 'none',
        transition: 'border-color 0.3s ease'
    };

    const labelStyle = {
        display: 'block',
        marginBottom: '0.5rem',
        color: 'var(--accent-color)',
        fontFamily: 'var(--font-primary)',
        fontWeight: 'bold'
    };

    return (
        <div style={{
            minHeight: '100vh',
            padding: '8rem 2rem 4rem',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)'
        }}>
            <div style={{
                maxWidth: '800px',
                margin: '0 auto'
            }}>
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8 }}
                >
                    <h1 style={{
                        fontSize: 'clamp(2.5rem, 5vw, 4rem)',
                        marginBottom: '1.5rem',
                        textAlign: 'center',
                        color: 'var(--accent-color)',
                        fontFamily: 'var(--font-display)',
                        textTransform: 'uppercase',
                        lineHeight: 1.1
                    }}>
                        Become an Ambassador
                    </h1>

                    <p style={{
                        textAlign: 'center',
                        fontSize: '1.2rem',
                        marginBottom: '4rem',
                        color: 'var(--text-muted)',
                        maxWidth: '600px',
                        margin: '0 auto 4rem',
                        lineHeight: 1.6
                    }}>
                        Join our inner circle. Promote our events, bring your friends, and earn rewards through our upcoming referral program. We're looking for passionate individuals who share our vision.
                    </p>

                    <form onSubmit={handleSubmit} style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        padding: '3rem',
                        borderRadius: '16px',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                        backdropFilter: 'blur(10px)'
                    }}>
                        {/* Status Messages */}
                        <AnimatePresence>
                            {status.success && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    style={{
                                        background: 'rgba(76, 175, 80, 0.1)',
                                        border: '1px solid #4CAF50',
                                        color: '#4CAF50',
                                        padding: '1rem',
                                        borderRadius: '8px',
                                        marginBottom: '2rem',
                                        textAlign: 'center'
                                    }}
                                >
                                    Thanks for applying! We'll be in touch soon with more details.
                                </motion.div>
                            )}
                            {status.error && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    style={{
                                        background: 'rgba(244, 67, 54, 0.1)',
                                        border: '1px solid #f44336',
                                        color: '#f44336',
                                        padding: '1rem',
                                        borderRadius: '8px',
                                        marginBottom: '2rem',
                                        textAlign: 'center'
                                    }}
                                >
                                    {status.error}
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <div>
                            <label style={labelStyle}>Full Name</label>
                            <input
                                type="text"
                                name="name"
                                value={formData.name}
                                onChange={handleChange}
                                style={inputStyle}
                                required
                                placeholder="Your name"
                                disabled={status.loading}
                            />
                        </div>

                        <div>
                            <label style={labelStyle}>Email</label>
                            <input
                                type="email"
                                name="email"
                                value={formData.email}
                                onChange={handleChange}
                                style={inputStyle}
                                required
                                placeholder="your@email.com"
                                disabled={status.loading}
                            />
                        </div>

                        <div>
                            <label style={labelStyle}>Phone Number</label>
                            <input
                                type="tel"
                                name="phone"
                                value={formData.phone}
                                onChange={handleChange}
                                style={inputStyle}
                                required
                                placeholder="+46 123 456 789"
                                disabled={status.loading}
                            />
                        </div>

                        <div>
                            <label style={labelStyle}>Social Media</label>
                            <input
                                type="text"
                                name="socialMedia"
                                value={formData.socialMedia}
                                onChange={handleChange}
                                style={inputStyle}
                                required
                                placeholder="Instagram handle, TikTok, etc."
                                disabled={status.loading}
                            />
                        </div>

                        <div>
                            <label style={labelStyle}>Why do you want to be an ambassador?</label>
                            <textarea
                                name="why"
                                value={formData.why}
                                onChange={handleChange}
                                style={{ ...inputStyle, minHeight: '120px', resize: 'vertical' }}
                                placeholder="Tell us a bit about why you'd be a great fit..."
                                disabled={status.loading}
                            />
                        </div>

                        <motion.button
                            type="submit"
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            disabled={status.loading}
                            style={{
                                width: '100%',
                                padding: '1.2rem',
                                background: status.loading ? 'rgba(197, 160, 89, 0.5)' : '#C5A059', // Using their gold accent color
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                fontSize: '1.2rem',
                                fontWeight: 'bold',
                                cursor: status.loading ? 'not-allowed' : 'pointer',
                                marginTop: '1rem',
                                textTransform: 'uppercase',
                                letterSpacing: '1px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                        >
                            {status.loading ? (
                                <>
                                    <span style={{
                                        width: '20px',
                                        height: '20px',
                                        border: '2px solid white',
                                        borderTopColor: 'transparent',
                                        borderRadius: '50%',
                                        marginRight: '10px',
                                        display: 'inline-block',
                                        animation: 'spin 1s linear infinite'
                                    }} />
                                    Sending...
                                </>
                            ) : 'Sign Up as Ambassador'}
                        </motion.button>
                    </form>
                </motion.div>
            </div>
        </div>
    );
};

export default Ambassador;
