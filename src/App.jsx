import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Home from './pages/Home';
import Events from './pages/Events';
import Membership from './pages/Membership';
import EventDetail from './pages/EventDetail';
import Info from './pages/Info';
import PosterLanding from './pages/PosterLanding';
import Home2 from './pages/Home2';
import PrivacyPolicy from './pages/PrivacyPolicy';
import DJApplication from './pages/DJApplication';
import Ambassador from './pages/Ambassador';
import ScrollToTop from './components/ScrollToTop';
import PageTransition from './components/PageTransition';


const AnimatedRoutes = () => {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<PageTransition><Home2 /></PageTransition>} />
        <Route path="/home-old" element={<PageTransition><Home /></PageTransition>} />
        <Route path="/events" element={<PageTransition><Events /></PageTransition>} />
        <Route path="/event/:eventId" element={<PageTransition><EventDetail /></PageTransition>} />
        <Route path="/membership" element={<PageTransition><Membership /></PageTransition>} />
        <Route path="/info" element={<PageTransition><Info /></PageTransition>} />
        <Route path="/minimal" element={<PageTransition><PosterLanding /></PageTransition>} />
        <Route path="/privacy-policy" element={<PageTransition><PrivacyPolicy /></PageTransition>} />
        <Route path="/dj-application" element={<PageTransition><DJApplication /></PageTransition>} />
        {/*         <Route path="/ambassador" element={<PageTransition><Ambassador /></PageTransition>} /> */}
      </Routes>
    </AnimatePresence>
  );
};

function App() {
  return (
    <Router basename="/">
      <ScrollToTop />
      {/* Foolproof Dark Background Layer */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: '#111111',
        zIndex: -9999,
        pointerEvents: 'none'
      }} />
      <div className="app-wrapper">
        <Navbar />
        <main className="main-content">
          <AnimatedRoutes />
        </main>
        <Footer />
      </div>
    </Router>
  );
}

export default App;
