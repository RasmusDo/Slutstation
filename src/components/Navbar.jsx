import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import './Navbar.css';
import logoImage from '../assets/images/logoslutstation3.webp';

const Navbar = () => {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [scrolled, setScrolled] = useState(false);
    const location = useLocation();




    // Handle scroll effect
    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > window.innerHeight - 100); // Trigger slightly before the fold
        };

        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // Lock body scroll when mobile menu is open
    useEffect(() => {
        if (mobileMenuOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
    }, [mobileMenuOpen]);

    const toggleMobileMenu = () => setMobileMenuOpen(!mobileMenuOpen);

    const closeMobileMenu = () => setMobileMenuOpen(false);

    const navLinks = [
        { name: 'Home!!!', path: '/' },
        { name: 'Events', path: '/events' },
        { name: 'Membership', path: '/membership' },
        { name: 'Info', path: '/info' },
        //{ name: 'Ambassador', path: '/ambassador' }
    ];

    return (
        <>
            <motion.nav
                className={`navbar ${scrolled ? 'scrolled' : ''}`}
                initial={{ y: -100 }}
                animate={{ y: 0 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
                <div className="navbar-container">
                    {/* Logo */}
                    <Link to="/" className="navbar-logo" onClick={closeMobileMenu}>
                        <motion.div
                            whileHover={{ scale: 1.05 }}
                            transition={{ duration: 0.2 }}
                        >
                            <img
                                src={logoImage}
                                alt="Slutstation Logo"
                                className="logo-image"
                                style={{ height: '40px', width: 'auto' }}
                            />
                        </motion.div>
                    </Link>

                    {/* Desktop Navigation */}
                    <ul className="navbar-menu">
                        {navLinks.map((link, index) => (
                            <motion.li
                                key={link.name}
                                initial={{ opacity: 0, y: -20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.1 * index, duration: 0.4 }}
                            >
                                <Link to={link.path} className="navbar-link">
                                    <span className="link-text">{link.name}</span>
                                    <span className="link-underline"></span>
                                </Link>
                            </motion.li>
                        ))}
                    </ul>

                    {/* Mobile Menu Button */}
                    <button
                        className={`mobile-menu-button ${mobileMenuOpen ? 'open' : ''}`}
                        onClick={toggleMobileMenu}
                        aria-label="Toggle menu"
                    >
                        <span></span>
                        <span></span>
                    </button>
                </div>
            </motion.nav>

            {/* Mobile Menu Overlay */}
            <AnimatePresence>
                {mobileMenuOpen && (
                    <>
                        {/* Backdrop */}
                        <motion.div
                            className="mobile-menu-backdrop"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={closeMobileMenu}
                        />

                        {/* Menu Content */}
                        <motion.div
                            className="mobile-menu"
                            initial={{ x: '100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '100%' }}
                            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                        >
                            <div className="mobile-menu-content">
                                <nav className="mobile-nav">
                                    {navLinks.map((link, index) => (
                                        <motion.div
                                            key={link.name}
                                            initial={{ opacity: 0, x: 50 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: 0.1 + index * 0.1, duration: 0.4 }}
                                        >
                                            <Link
                                                to={link.path}
                                                className="mobile-nav-link"
                                                onClick={closeMobileMenu}
                                            >
                                                <span className="mobile-link-number">0{index + 1}</span>
                                                <span className="mobile-link-text">{link.name}</span>
                                            </Link>
                                        </motion.div>
                                    ))}
                                </nav>

                                <motion.div
                                    className="mobile-menu-footer"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.5, duration: 0.4 }}
                                >
                                    <p>Underground House Music</p>
                                    <p>Stockholm • 2024</p>
                                </motion.div>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </>
    );
};

export default Navbar;
