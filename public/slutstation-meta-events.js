

(function () {
  'use strict';

  var PIXEL_ID    = '2603527350082130';
  var CONSENT_KEY = 'ss-cookie-consent';
  var CURRENCY    = 'SEK';

  var MEMBER_VALUE = 250;

  

  function marketingConsent() {
    try {
      var raw = localStorage.getItem(CONSENT_KEY);
      if (!raw) return false;
      return JSON.parse(raw).marketing === true;
    } catch (e) { return false; }
  }

  var booted = false;

  function boot() {
    if (booted || !marketingConsent()) return;
    booted = true;

    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0';
      n.queue = []; t = b.createElement(e); t.async = !0;
      t.src = v; s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

    fbq('init', PIXEL_ID);
    fbq('track', 'PageView');
    start();
  }

  boot();
  if (!booted) {
    var tries = 0;
    var poll = setInterval(function () {
      boot();
      if (booted || ++tries > 120) clearInterval(poll);
    }, 1000);
    document.addEventListener('click', function () { setTimeout(boot, 100); }, true);
  }

  

  function eid(name) {
    return name + '.' + Date.now() + '.' + Math.random().toString(36).slice(2, 10);
  }

  function track(name, params, userData) {
    if (!booted) return;
    if (userData) fbq('init', PIXEL_ID, userData);
    fbq('track', name, params || {}, { eventID: eid(name) });
    if (window.__ssPixelDebug) console.log('[Meta]', name, params || {});
  }

  function trackCustom(name, params) {
    if (!booted) return;
    fbq('trackCustom', name, params || {}, { eventID: eid(name) });
    if (window.__ssPixelDebug) console.log('[Meta:custom]', name, params || {});
  }

  var fired = {};
  function once(key, fn) { if (fired[key]) return; fired[key] = true; fn(); }

  function cardOf(el) {
    return el && el.closest ? el.closest('.event-card') : null;
  }
  function cardTitle(card) {
    if (!card) return null;
    var h = card.querySelector('.info h4, h4, h3');
    return h ? h.innerText.trim() : null;
  }

  

  function start() {

    
    
    var events = document.getElementById('events');
    if (events && 'IntersectionObserver' in window) {
      var dwell = null;
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting && en.intersectionRect.height >= 120) {
            if (dwell) return;
            dwell = setTimeout(function () {
              once('viewcontent', function () {
                track('ViewContent', {
                  content_name: 'Events listing',
                  content_category: 'events',
                  content_type: 'product'
                });
              });
              io.disconnect();
            }, 1200);
          } else if (dwell) {
            clearTimeout(dwell);
            dwell = null;
          }
        });
      }, { threshold: 0, rootMargin: '0px 0px -25% 0px' });
      io.observe(events);
    }

    
    document.addEventListener('click', function (e) {
      var node = e.target;
      var a = node.closest ? node.closest('a, button') : null;
      var href = (a && a.getAttribute && a.getAttribute('href')) || '';
      var text = (a && a.innerText || '').trim();

      
      var ticketish = node.closest &&
        node.closest('a[href*="billetto"], [class*="billetto"], [id*="billetto"], [data-billetto]');
      if (ticketish || /billetto/i.test(href)) {
        var tCard = cardOf(node);
        track('InitiateCheckout', {
          content_name: cardTitle(tCard) || text || 'Tickets',
          content_category: 'ticket',
          content_type: 'product',
          currency: CURRENCY
        });
        return;
      }

      
      var card = cardOf(node);
      if (card) {
        var title = cardTitle(card);
        if (title) {
          track('ViewContent', {
            content_name: title,
            content_category: 'event',
            content_type: 'product'
          });
        }
        return;
      }

      if (!a) return;

      
      if (href === '#apply' ||
          /^(become a member|apply for access|bli medlem)$/i.test(text)) {
        trackCustom('MembershipIntent', { source: text || 'apply link' });
        return;
      }

      
      if (href.indexOf('mailto:') === 0) {
        track('Contact', { method: 'email' });
        return;
      }

      
      if (/instagram\.com|tiktok\.com/i.test(href)) {
        trackCustom('SocialClick', {
          network: /instagram/i.test(href) ? 'instagram' : 'tiktok'
        });
      }
    }, true);

    
    var success = document.getElementById('formSuccess');
    var form = document.getElementById('applyForm');

    function readUserData() {
      if (!form) return null;
      function v(n) {
        var el = form.querySelector('[name="' + n + '"]');
        return el && el.value ? String(el.value).trim() : '';
      }
      var phone = v('phone').replace(/\D/g, '').replace(/^0+/, '');
      if (phone && phone.indexOf('46') !== 0) phone = '46' + phone;
      var dob = v('dob').replace(/\D/g, '');
      var gender = v('gender').trim().toLowerCase();
      var ud = {
        em: v('email').toLowerCase(),
        fn: v('first').toLowerCase(),
        ln: v('last').toLowerCase(),
        ct: v('city').toLowerCase().replace(/\s/g, ''),
        zp: v('zip').replace(/\s/g, ''),
        country: 'se'
      };
      if (phone) ud.ph = phone;
      if (dob.length === 8) ud.db = dob;
      if (gender === 'male' || gender === 'man' || gender === 'm') ud.ge = 'm';
      else if (gender === 'female' || gender === 'kvinna' || gender === 'f') ud.ge = 'f';
      Object.keys(ud).forEach(function (k) { if (!ud[k]) delete ud[k]; });
      return ud;
    }

    function registrationComplete() {
      once('completeregistration', function () {
        var params = {
          content_name: 'Membership application',
          status: true,
          currency: CURRENCY
        };
        if (MEMBER_VALUE != null) params.value = MEMBER_VALUE;
        track('CompleteRegistration', params, readUserData());
        var leadParams = { content_name: 'Membership application', currency: CURRENCY };
        if (MEMBER_VALUE != null) leadParams.value = MEMBER_VALUE;
        track('Lead', leadParams);
      });
    }

    if (success) {
      var visible = function (el) {
        return el.offsetParent !== null &&
               getComputedStyle(el).display !== 'none' &&
               getComputedStyle(el).visibility !== 'hidden';
      };
      if (visible(success)) registrationComplete();
      new MutationObserver(function () {
        if (visible(success)) registrationComplete();
      }).observe(success, { attributes: true, attributeFilter: ['style', 'class'] });
      if (success.parentNode) {
        new MutationObserver(function () {
          var s = document.getElementById('formSuccess');
          if (s && visible(s)) registrationComplete();
        }).observe(success.parentNode, { childList: true, subtree: true });
      }
    } else if (form) {
      form.addEventListener('submit', function () { setTimeout(registrationComplete, 1500); });
    }
  }

  window.__ssPixelBoot = boot;
})();
