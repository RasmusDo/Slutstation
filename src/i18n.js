// ============================================================================
// SLUTSTATION, English / Swedish
//
// HOW IT WORKS
//   * Short strings live in the DICT below and are pulled into the page by
//     `data-i18n="key"` (text) or `data-i18n-html="key"` (allows <b>, links).
//     Attributes use `data-i18n-attr="placeholder:key"`.
//   * LONG blocks (the purchase terms, the house rules, the privacy policy)
//     are not in here. They are written twice in the HTML and marked
//     `data-lang="en"` / `data-lang="sv"`, and this file just shows the right
//     one. Legal text is worth having as real prose in the document rather than
//     as string fragments, and it means a lawyer can read the file.
//   * The English text stays in the HTML as the written content, so if this
//     script never runs the page is still a complete English page.
//
// MAINTAINING IT
//   Change English copy → change the Swedish here too, or it silently rots.
//   That is the real cost of a language toggle, and it is on you, not the code.
// ============================================================================

export const LANGS = ["en", "sv"];
const STORE_KEY = "ss-lang";

export const DICT = {
  // ---- chrome ----
  "nav.events":      { en: "Events",        sv: "Event" },
  "nav.about":       { en: "About",         sv: "Om oss" },
  "nav.membership":  { en: "Membership",    sv: "Medlemskap" },
  "nav.info":        { en: "Info",          sv: "Info" },
  "nav.contact":     { en: "Contact",       sv: "Kontakt" },
  "nav.account":     { en: "Account",       sv: "Mitt konto" },
  "nav.tickets":     { en: "Tickets",       sv: "Biljetter" },
  "nav.myaccount":   { en: "My account",    sv: "Mitt konto" },
  "nav.staff":       { en: "Staff",         sv: "Personal" },
  "nav.admin":       { en: "Admin",         sv: "Admin" },
  "nav.menu":        { en: "Menu",          sv: "Meny" },

  "announce.text":   { en: "No upcoming events announced yet.", sv: "Inga event är släppta än." },
  "announce.link":   { en: "Follow us on Instagram →", sv: "Följ oss på Instagram →" },
  // Used the moment an event is announced: the banner rewrites itself from the
  // same feed the front page card reads, so one switch changes both.
  "announce.live":   { en: "{name} · {date}.", sv: "{name} · {date}." },
  "announce.liveLink": { en: "Get tickets →", sv: "Köp biljett →" },
  "announce.dismiss":{ en: "Dismiss",       sv: "Stäng" },

  // ---- hero ----
  "hero.badge":      { en: "Est. 2024 · Stockholm", sv: "Grundat 2024 · Stockholm" },
  "hero.tagline":    {
    en: "<b>Experience underground house music.</b> Access the inaccessible, high production events found no where else in Stockholm.",
    sv: "<b>Upplev underground house.</b> Kom in där andra inte kommer, event med en produktion du inte hittar någon annanstans i Stockholm.",
  },
  "hero.join":       { en: "Become a member", sv: "Bli medlem" },
  "hero.next":       { en: "Next event →",  sv: "Nästa event →" },
  "hero.scroll":     { en: "Scroll to enter", sv: "Scrolla för att komma in" },

  // ---- events ----
  "events.eyebrow":  { en: "Events",        sv: "Event" },
  "events.title":    { en: "Events",        sv: "Event" },
  "events.lead":     {
    en: "Anyone can buy a ticket; attending takes a free membership — join before the night. We announce our events on Instagram, stay tuned.",
    sv: "Vem som helst kan köpa biljett; för att komma in krävs gratis medlemskap — bli medlem innan kvällen. Vi släpper våra event på Instagram, häng med där.",
  },
  "events.upcoming": { en: "Upcoming",      sv: "Kommande" },
  "events.past":     { en: "Past Events",   sv: "Tidigare event" },
  "events.none":     { en: "The next one is being built", sv: "Nästa är under uppbyggnad" },
  "events.noneBody": {
    en: "Members hear first, and our events sell out before they reach anyone else.<br>Joining is free and takes a minute.",
    sv: "Medlemmar får veta först, och våra event blir slutsålda innan de når någon annan.<br>Att gå med är gratis och tar en minut.",
  },
  "events.follow":   { en: "Follow on Instagram", sv: "Följ på Instagram" },
  "events.get":      { en: "Get tickets",   sv: "Köp biljett" },
  "events.from":     { en: "from",          sv: "från" },
  "events.soldout":  { en: "Sold out, see releases", sv: "Slutsålt, se släppen" },
  "events.tba":      { en: "Location revealed to ticket holders", sv: "Platsen släpps till dig som har biljett" },

  // ---- about ----
  "about.eyebrow":   { en: "About",         sv: "Om oss" },
  "about.title":     { en: 'Not quite club, <span class="lead-serif">not quite rave</span>',
                       sv: 'Inte riktigt klubb, <span class="lead-serif">inte riktigt rave</span>' },
  "about.p1":        {
    en: "Slutstation is an independent nightlife collective dedicated to underground music, custom scenography, and community-driven events. Combined with meticulous sound design, carefully selected underground artists, and unique outdoor settings, we create immersive spaces built entirely around connection through music and art.",
    sv: "Slutstation är ett fristående nattlivskollektiv som ägnar sig åt undergroundmusik, egenbyggd scenografi och event som drivs av gemenskapen. Med noggrann ljuddesign, handplockade undergroundartister och unika platser utomhus bygger vi rum som helt och hållet handlar om att mötas genom musik och konst.",
  },
  "about.p2":        {
    en: "Operating on a non-profit basis, our mission is to curate uncompromising sonic and visual experiences that offer a genuine alternative to commercial nightlife. We build our own custom scenography from scratch for every single event, ensuring that no two nights ever look or feel the same.",
    sv: "Vi drivs utan vinstintresse. Uppdraget är att skapa kompromisslösa ljud- och bildupplevelser som är ett verkligt alternativ till det kommersiella nattlivet. Vi bygger ny scenografi från grunden till varje event, två nätter ser aldrig likadana ut.",
  },
  "about.p3":        {
    en: "We prioritize quality over frequency, keeping every event intentional, rare, and memorable.",
    sv: "Vi väljer kvalitet före kvantitet. Varje event ska vara medvetet, sällsynt och värt att minnas.",
  },
  "about.p4":        {
    en: "We are not trying to fix the existing club scene. We are building what comes after.",
    sv: "Vi försöker inte laga klubbscenen som den ser ut. Vi bygger det som kommer efter.",
  },

  // ---- apply ----
  "apply.eyebrow":   { en: "Apply for Access", sv: "Ansök om tillträde" },
  "apply.title":     { en: "Become a member",  sv: "Bli medlem" },
  "apply.lead":      {
    en: "Join kulturföreningen and create your Slutstation account in one step. Membership is free and required to attend our outdoor events.",
    sv: "Gå med i kulturföreningen och skapa ditt Slutstation-konto i ett steg. Medlemskapet är gratis och krävs för att komma på våra utomhusevent.",
  },
  "apply.note":      {
    en: 'Membership is free and runs to the end of the calendar year, everyone renews in January, whenever they joined. Creating your account registers you with <strong>Kulturföreningen Musikbopp</strong>, gives you a tier that grows every time you come, and a tier code the bar and the wardrobe can scan.',
    sv: 'Medlemskapet är gratis och gäller till årsskiftet, alla förnyar i januari, oavsett när man gick med. När du skapar kontot registreras du i <strong>Kulturföreningen Musikbopp</strong>, får en tier som växer varje gång du kommer, och en tier-kod som baren och garderoben kan skanna.',
  },
  "apply.cta":       { en: "Become a member", sv: "Bli medlem" },
  "apply.have":      { en: "I already have an account", sv: "Jag har redan ett konto" },
  "apply.dj":        {
    en: "DJ? There's a toggle on the signup form, apply while you join.",
    sv: "DJ? Det finns en knapp i formuläret, ansök samtidigt som du går med.",
  },

  // ---- gallery / info ----
  "gallery.eyebrow": { en: "Gallery",       sv: "Galleri" },
  "gallery.title":   { en: "Inside the night", sv: "Inifrån natten" },
  "info.eyebrow":    { en: "Info",          sv: "Info" },
  "info.title":      { en: "Good to know",  sv: "Bra att veta" },
  "info.rule1t":     { en: "Quality over quantity", sv: "Kvalitet före kvantitet" },
  "info.rule1b":     {
    en: "We don't do quantity, we do quality. Every event is built from scratch, we don't throw parties just for the sake of it.",
    sv: "Vi gör inte många event, vi gör bra event. Varje kväll byggs från grunden, vi kör inte fest för festens skull.",
  },
  "info.rule2t":     { en: "Aligned with our culture", sv: "I linje med vår kultur" },
  "info.rule2b":     {
    en: "Becoming a member means you're aligned with our culture and values, a nightlife built on sound, trust, and something real.",
    sv: "Att bli medlem betyder att du delar vår kultur och våra värderingar, ett nattliv byggt på ljud, tillit och något äkta.",
  },

  "acc.member.q":    { en: "What does it mean to become a member?", sv: "Vad innebär det att bli medlem?" },
  "acc.member.a":    {
    en: 'Becoming a member means you\'re aligned with our culture and values. Membership gives you access to our outdoor events. It\'s free, always will be, and runs to the end of the calendar year. Join in August and you\'re a member until 1 January; everyone renews in January, whenever they joined. When you sign up you\'ll get a confirmation email, click the link in it to activate your account, and your membership is registered in eBas automatically. You can see your membership status, your tier and your tier code any time at <a href="/account.html" style="color:var(--accent)">your account</a>. The tiers, how many events each one takes, and what each one gives you can change as the association grows; anything already given to you stays yours. If any uncertainty arises, please contact us at <a href="mailto:info@slutstation.se" style="color:var(--accent)">info@slutstation.se</a>.',
    sv: 'Att bli medlem betyder att du delar vår kultur och våra värderingar. Medlemskapet ger dig tillgång till våra utomhusevent. Det är gratis, kommer alltid att vara det, och gäller till årsskiftet. Går du med i augusti är du medlem till 1 januari; alla förnyar i januari, oavsett när man gick med. När du registrerar dig får du ett bekräftelsemejl, klicka på länken för att aktivera kontot, så registreras medlemskapet i eBas automatiskt. Din medlemsstatus, din tier och din tier-kod ser du när som helst på <a href="/account.html" style="color:var(--accent)">ditt konto</a>. Vilka tiers som finns, hur många event varje nivå kräver och vad varje nivå ger kan ändras när föreningen växer; det du redan har fått behåller du. Undrar du något, hör av dig till <a href="mailto:info@slutstation.se" style="color:var(--accent)">info@slutstation.se</a>.',
  },
  "acc.events.q":    { en: "About our events", sv: "Om våra event" },
  "acc.events.a":    {
    en: 'Every event is different. We announce and share information about our events via Instagram. Outdoor events location are only revealed to members with tickets before the event. Buying a ticket means agreeing to our <a href="#info" style="color:var(--accent)">Ticket purchase terms</a>, and attending means agreeing to our <a href="#info" style="color:var(--accent)">Event terms &amp; conduct</a>. Stay tuned!',
    sv: 'Varje event är sitt eget. Vi annonserar och delar information om våra event via Instagram. Platsen för utomhusevent lämnas bara ut till medlemmar med biljett, strax innan. Att köpa biljett innebär att du godkänner våra <a href="#info" style="color:var(--accent)">köpvillkor</a>, och att komma innebär att du godkänner våra <a href="#info" style="color:var(--accent)">ordningsregler</a>. Häng med!',
  },
  "acc.terms.q":     { en: "Ticket purchase terms / Köpvillkor", sv: "Köpvillkor för biljetter" },
  "acc.rules.q":     { en: "Event terms & conduct / Ordningsregler", sv: "Ordningsregler på plats" },
  "acc.privacy.q":   { en: "Bylaws & Personal Data Handling Policy", sv: "Stadgar & behandling av personuppgifter" },

  // ---- contact / footer ----
  "contact.eyebrow": { en: "Contact",       sv: "Kontakt" },
  "contact.title":   { en: "Got questions or<br />want to get involved?<br />", sv: "Frågor, eller vill du<br />vara med och göra det?<br />" },
  "contact.reach":   { en: "Reach us",      sv: "Nå oss" },
  "contact.member":  { en: "Membership",    sv: "Medlemskap" },
  "contact.apply":   { en: "Apply for access", sv: "Ansök om tillträde" },
  "contact.account": { en: "Your account",  sv: "Ditt konto" },
  "contact.bylaws":  { en: "Bylaws & privacy", sv: "Stadgar & integritet" },
  "footer.copy":     { en: "© 2024–2026 Slutstation · Underground House Music · Stockholm",
                       sv: "© 2024–2026 Slutstation · Underground House Music · Stockholm" },

  // ---- cookie banner ----
  "cookie.eyebrow":  { en: "Privacy & Cookies", sv: "Integritet & kakor" },
  "cookie.title":    { en: "We value your privacy", sv: "Vi bryr oss om din integritet" },
  "cookie.lead":     {
    en: "We use cookies to enhance your experience and analyse site traffic. Necessary cookies are always active. You choose whether to allow optional analytics and marketing cookies.",
    sv: "Vi använder kakor för att förbättra upplevelsen och förstå trafiken på sajten. Nödvändiga kakor är alltid på. Du väljer själv om vi får använda kakor för analys och marknadsföring.",
  },
  "cookie.nec":      { en: "Necessary",     sv: "Nödvändiga" },
  "cookie.necB":     { en: "Required for the site to function. Cannot be disabled.", sv: "Krävs för att sajten ska fungera. Kan inte stängas av." },
  "cookie.always":   { en: "Always on",     sv: "Alltid på" },
  "cookie.ana":      { en: "Analytics",     sv: "Analys" },
  "cookie.anaB":     { en: "Help us understand traffic and improve the experience.", sv: "Hjälper oss förstå trafiken och göra sajten bättre." },
  "cookie.mkt":      { en: "Marketing",     sv: "Marknadsföring" },
  "cookie.mktB":     { en: "Allow Meta Pixel and related tools to measure campaigns.", sv: "Tillåt Meta Pixel och liknande verktyg att mäta kampanjer." },
  "cookie.accept":   { en: "Accept all",    sv: "Godkänn alla" },
  "cookie.decline":  { en: "Decline all",   sv: "Neka alla" },
  "cookie.save":     { en: "Save my choices", sv: "Spara mina val" },
  "cookie.change":   { en: "Change preferences anytime via the", sv: "Ändra dina val när som helst via" },
  "cookie.open":     { en: "Open cookie settings", sv: "Öppna kakinställningar" },

  // ---- account page ----
  "acct.eyebrow":    { en: "Members",       sv: "Medlemmar" },
  "acct.title":      { en: "Your account",  sv: "Ditt konto" },
  "acct.lead":       { en: "Sign in to see your membership status, or create an account if you haven't yet.",
                       sv: "Logga in för att se din medlemsstatus, eller skapa ett konto om du inte har ett." },
  "acct.signin":     { en: "Sign in",       sv: "Logga in" },
  "acct.signup":     { en: "Create account", sv: "Skapa konto" },
  "acct.email":      { en: "Email",         sv: "E-post" },
  "acct.password":   { en: "Password",      sv: "Lösenord" },
  "acct.forgot":     { en: "Forgot password?", sv: "Glömt lösenordet?" },
  "acct.first":      { en: "First Name",    sv: "Förnamn" },
  "acct.last":       { en: "Last Name",     sv: "Efternamn" },
  "acct.phone":      { en: "Phone Number",  sv: "Telefonnummer" },
  "acct.dob":        { en: "Date of Birth", sv: "Födelsedatum" },
  "acct.gender":     { en: "Gender",        sv: "Kön" },
  "acct.select":     { en: "Select…",       sv: "Välj…" },
  "acct.female":     { en: "Female",        sv: "Kvinna" },
  "acct.male":       { en: "Male",          sv: "Man" },
  "acct.nonbinary":  { en: "Non-binary",    sv: "Icke-binär" },
  "acct.nosay":      { en: "Prefer not to say", sv: "Vill inte uppge" },
  "acct.city":       { en: "City",          sv: "Ort" },
  "acct.street":     { en: "Street Address", sv: "Gatuadress" },
  "acct.zip":        { en: "Zip Code",      sv: "Postnummer" },
  "acct.pwHint":     { en: "At least 8 characters. You'll use this to sign in.", sv: "Minst 8 tecken. Det är det du loggar in med." },
  "acct.signupNote": {
    en: "Creating an account also registers you as a member of <strong>Kulturföreningen Musikbopp</strong>. Membership is free and runs to the end of the calendar year, everyone renews in January, whenever they joined.",
    sv: "När du skapar ett konto registreras du samtidigt som medlem i <strong>Kulturföreningen Musikbopp</strong>. Medlemskapet är gratis och gäller till årsskiftet, alla förnyar i januari, oavsett när man gick med.",
  },
  "acct.djQ":        { en: "Are you a DJ?", sv: "Är du DJ?" },
  "acct.djB":        {
    en: "Want to play at our next event? Send us your info and a mix. Because of high demand we follow these requirements:<br />- Must be active on social media.<br />- Must have a somewhat established following.<br />- No open-format artists.",
    sv: "Vill du spela på nästa event? Skicka dina uppgifter och en mix. På grund av högt tryck har vi de här kraven:<br />- Du ska vara aktiv på sociala medier.<br />- Du ska ha en någorlunda etablerad publik.<br />- Inga open-format-artister.",
  },
  "acct.artist":     { en: "Artist Name",   sv: "Artistnamn" },
  "acct.artistPh":   { en: "Your stage name", sv: "Ditt artistnamn" },
  "acct.style":      { en: "Your Style",    sv: "Din stil" },
  "acct.stylePh":    { en: "The kind of sound you play", sv: "Vilket sound du spelar" },
  "acct.mix":        { en: "Mix Link",      sv: "Länk till mix" },
  "acct.mixPh":      { en: "SoundCloud, Mixcloud, or YouTube link", sv: "Länk till SoundCloud, Mixcloud eller YouTube" },
  "acct.aboutYou":   { en: "About You",     sv: "Om dig" },
  "acct.aboutPh":    { en: "Tell us about yourself and your style...", sv: "Berätta om dig själv och din stil…" },
  "acct.socials":    { en: "Socials",       sv: "Sociala medier" },
  "acct.socialsPh":  { en: "Instagram, SoundCloud, etc.", sv: "Instagram, SoundCloud, m.m." },
  "acct.genderNone": { en: "Prefer not to say", sv: "Vill inte uppge" },
  "acct.genderF":    { en: "Female",        sv: "Kvinna" },
  "acct.genderM":    { en: "Male",          sv: "Man" },
  "acct.genderX":    { en: "Non-binary / other", sv: "Icke-binär / annat" },
  "acct.finishJoin": { en: "You're signed in. Add your date of birth and address, then save to send your free membership application.",
                       sv: "Du är inloggad. Fyll i ditt födelsedatum och din adress och spara för att skicka in din kostnadsfria medlemsansökan." },
  "contact.become":  { en: "Become a member", sv: "Bli medlem" },
  "acct.emailLbl":   { en: "Email",         sv: "E-post" },
  "acct.passwordLbl":{ en: "Password",      sv: "Lösenord" },
  "acct.resetEyebrow":{ en: "Reset",        sv: "Återställ" },

  // The coming-soon list. It was written straight into the HTML in English,
  // so a Swedish visitor read the whole panel in the wrong language.
  "acct.soon2T":     { en: "Account balance", sv: "Kontosaldo" },
  "acct.soon2B":     { en: "Top up once and spend it on tickets, at the bar and on merch. Usable with us only, and never withdrawable as cash.",
                       sv: "Fyll på en gång och använd det till biljetter, i baren och på merch. Går bara att använda hos oss och kan aldrig tas ut som kontanter." },
  "acct.soon3T":     { en: "Premium membership", sv: "Premiummedlemskap" },
  "acct.soon3B":     { en: "A paid tier on top of the free one, free wardrobe every event, priority entry, and a discount that pays for itself in two nights.",
                       sv: "En betald nivå ovanpå den kostnadsfria: fri garderob varje event, förtur in och en rabatt som betalar sig på två kvällar." },
  "acct.soon4T":     { en: "Referral codes", sv: "Vänkoder" },
  "acct.soon4B":     { en: "Your own code to send friends. They get something off their first ticket, you get credit when they turn up.",
                       sv: "Din egen kod att skicka till vänner. De får rabatt på sin första biljett, du får tillgodo när de dyker upp." },
  "acct.soon5T":     { en: "Passing on a ticket", sv: "Lämna över en biljett" },
  "acct.soon5B":     { en: "Can't make it? Hand your ticket to another member from this page instead of emailing us.",
                       sv: "Kan du inte komma? Lämna över biljetten till en annan medlem här på sidan i stället för att mejla oss." },

  "acct.or":         { en: "or",            sv: "eller" },
  "acct.google":     { en: "Continue with Google", sv: "Fortsätt med Google" },
  "acct.termsFirst": { en: "Tick the membership box to register, it is what makes you a member.",
                       sv: "Kryssa i medlemsrutan för att registrera dig, det är det som gör dig till medlem." },
  "acct.agree":      {
    en: 'I want to register as a member of Slutstation and accept the <a href="/#info" style="color:var(--accent)">Bylaws &amp; Personal Data Handling Policy</a>. Membership is free and required to attend events.',
    sv: 'Jag vill registrera mig som medlem i Slutstation och godkänner <a href="/#info" style="color:var(--accent)">stadgarna och personuppgiftspolicyn</a>. Medlemskapet är gratis och krävs för att komma på våra event.',
  },
  "acct.newsletter": { en: "Email me about upcoming events. (Optional, you can change this any time.)",
                       sv: "Mejla mig om kommande event. (Frivilligt, du kan ändra det när som helst.)" },
  "acct.newsletter2":{ en: "Email me about upcoming events.", sv: "Mejla mig om kommande event." },
  "acct.welcome":    { en: "Welcome back",  sv: "Välkommen tillbaka" },
  "acct.signout":    { en: "Sign out",      sv: "Logga ut" },
  "acct.recheck":    { en: "Re-check",      sv: "Kontrollera igen" },
  "acct.register":   { en: "Register membership", sv: "Registrera medlemskap" },
  "acct.renew":      { en: "Renew membership", sv: "Förnya medlemskap" },
  "acct.tryAgain":   { en: "Try again",     sv: "Försök igen" },
  "acct.tierTitle":  { en: "Your tier",     sv: "Din tier" },
  "acct.tierLead":   { en: "Earned by turning up. Counted over the last 24 months.", sv: "Byggs av att du dyker upp. Räknas över de senaste 24 månaderna." },
  "acct.statWindow": { en: "events, last 24 months", sv: "event, senaste 24 mån" },
  "acct.statTotal":  { en: "events all time", sv: "event totalt" },
  "acct.statFirst":  { en: "first event",   sv: "första eventet" },
  "acct.statLast":   { en: "last event",    sv: "senaste eventet" },
  "acct.ticketsT":   { en: "Your tickets",  sv: "Dina biljetter" },
  "acct.ticketsL":   { en: "Show the QR at the door. Each one scans once.", sv: "Visa QR-koden i dörren. Varje biljett skannas en gång." },
  "acct.qrTitle":    { en: "Your tier code", sv: "Din tier-kod" },
  "acct.qrLead":     { en: "Show this at the wardrobe or the bar. It proves what tier you are and what that is worth tonight.",
                       sv: "Visa den i garderoben eller i baren. Den visar vilken tier du har och vad det är värt i kväll." },
  "acct.qrOffline":  { en: "Works offline once the page has loaded.", sv: "Fungerar offline när sidan har laddats." },
  "acct.detailsT":   { en: "Your details",  sv: "Dina uppgifter" },
  "acct.detailsDone":  { en: "Complete",  sv: "Klart" },
  "acct.detailsTodo":  { en: "Needs you", sv: "Behöver dig" },
  "acct.detailsShow":  { en: "Show your details",  sv: "Visa dina uppgifter" },
  "acct.detailsHide":  { en: "Hide your details",  sv: "Dölj dina uppgifter" },
  "acct.attentionT":   { en: "Your details need finishing",
                         sv: "Dina uppgifter behöver kompletteras" },
  "acct.attentionCta": { en: "Fill them in", sv: "Fyll i dem" },
  // One sentence, and it names the fields rather than saying "some details are
  // missing" — the whole point is that you should not have to open the form to
  // find out what it wants.
  "acct.attentionB":   { en: "We still need your {fields} before we can send your membership application to eBas.",
                         sv: "Vi behöver fortfarande {fields} innan vi kan skicka din medlemsansökan till eBas." },
  "acct.fieldDob":     { en: "date of birth", sv: "födelsedatum" },
  "acct.fieldStreet":  { en: "street address", sv: "gatuadress" },
  "acct.fieldZip":     { en: "postcode", sv: "postnummer" },
  "acct.fieldCity":    { en: "city", sv: "postort" },
  "acct.fieldName":    { en: "name", sv: "namn" },
  "acct.fieldTerms":   { en: "agreement to the bylaws", sv: "godkännande av stadgarna" },
  "acct.listAnd":      { en: "and", sv: "och" },
  "acct.detailsL":   { en: "Kept in sync with your membership in eBas.", sv: "Hålls i synk med ditt medlemskap i eBas." },
  "acct.emailLock":  { en: "Contact info@slutstation.se to change this.", sv: "Mejla info@slutstation.se för att ändra." },
  "acct.save":       { en: "Save changes",  sv: "Spara ändringar" },
  "acct.changePw":   { en: "Change password", sv: "Byt lösenord" },
  "acct.pwCancel":   { en: "Cancel",          sv: "Avbryt" },
  "acct.soonT":      { en: "Coming soon",   sv: "På väg" },
  "acct.soonL":      { en: "What lands on this page next. Roughly in the order we're building it.",
                       sv: "Vad som landar här härnäst. Ungefär i den ordning vi bygger det." },
  "acct.soonAsk":    { en: 'Want something that isn\'t on this list? Tell us, <a href="mailto:info@slutstation.se" style="color:var(--accent)">info@slutstation.se</a>.',
                       sv: 'Saknar du något i listan? Säg till, <a href="mailto:info@slutstation.se" style="color:var(--accent)">info@slutstation.se</a>.' },
  "acct.loading":    { en: "Loading your account…", sv: "Laddar ditt konto…" },
  "acct.resetT":     { en: "Choose a new password", sv: "Välj ett nytt lösenord" },
  "acct.newPw":      { en: "New password",  sv: "Nytt lösenord" },
  "acct.confirmPw":  { en: "Confirm new password", sv: "Bekräfta nytt lösenord" },
  "acct.updatePw":   { en: "Update password", sv: "Uppdatera lösenord" },
  "acct.pwHint2":    { en: "At least 8 characters.", sv: "Minst 8 tecken." },

  // membership card, rendered from JS
  "ms.checking":     { en: "Checking membership…", sv: "Kontrollerar medlemskap…" },
  "ms.checkingB":    { en: "Asking eBas about your membership.", sv: "Frågar eBas om ditt medlemskap." },
  "ms.pendingT":     { en: "Your application is being reviewed", sv: "Din ansökan granskas" },
  "ms.pendingB":     { en: "You're registered with Kulturföreningen Musikbopp. We'll confirm your membership shortly, you'll get an email the moment it's approved, and this page updates on its own.",
                       sv: "Du är registrerad hos Kulturföreningen Musikbopp. Vi bekräftar ditt medlemskap inom kort, du får ett mejl så fort det är godkänt, och sidan uppdateras av sig själv." },
  "ms.activeT":      { en: "Member of Kulturföreningen Musikbopp", sv: "Medlem i Kulturföreningen Musikbopp" },
  "ms.activeB":      { en: "Verified in eBas. Your membership covers {year}, up to 1 January. Everyone renews in January, whenever they joined.",
                       sv: "Verifierat i eBas. Ditt medlemskap gäller {year}, fram till 1 januari. Alla förnyar i januari, oavsett när man gick med." },
  "ms.activeSoon":   { en: "Verified in eBas. Your membership covers {year} and runs out on 1 January, {days} day(s) left. Renewing in January is free and takes a second.",
                       sv: "Verifierat i eBas. Ditt medlemskap gäller {year} och går ut 1 januari, {days} dag(ar) kvar. Att förnya i januari är gratis och tar en sekund." },
  "ms.expiredT":     { en: "Your membership has expired", sv: "Ditt medlemskap har gått ut" },
  "ms.expiredB":     { en: "Your membership covered {year} and ran out on 1 January. Renew below, it's free and takes a second.",
                       sv: "Ditt medlemskap gällde {year} och gick ut 1 januari. Förnya nedan, det är gratis och tar en sekund." },
  "ms.failedT":      { en: "We couldn't register your membership", sv: "Vi kunde inte registrera ditt medlemskap" },
  "ms.failedB":      { en: "Something went wrong talking to eBas. Try again, or email info@slutstation.se.",
                       sv: "Något gick fel i kontakten med eBas. Försök igen, eller mejla info@slutstation.se." },
  "ms.noneT":        { en: "Not a member yet", sv: "Inte medlem än" },
  "ms.noneB":        { en: "Membership is free and required to attend our events. Register below.",
                       sv: "Medlemskapet är gratis och krävs för att komma på våra event. Registrera dig nedan." },
  "ms.topTier":      { en: "<b>Top tier.</b> Nothing left to climb.", sv: "<b>Högsta tier.</b> Inget kvar att klättra." },
  "ms.unlocked":     { en: "<b>Tier unlocked</b>, it updates at your next check-in.", sv: "<b>Tier upplåst</b>, den uppdateras vid nästa incheckning." },
  "ms.toNext":       { en: "<b>{n}</b> more events to Tier {t}", sv: "<b>{n}</b> event kvar till Tier {t}" },
  "ms.toNext1":      { en: "<b>{n}</b> more event to Tier {t}",  sv: "<b>{n}</b> event kvar till Tier {t}" },
  "ms.eventsWord":   { en: "events",        sv: "event" },
  "ms.max":          { en: "max",           sv: "max" },
  "ms.tierAt":       { en: "Tier {t} at {n}", sv: "Tier {t} vid {n}" },
  "ms.scanned":      { en: "scanned",       sv: "skannad" },
  "ms.showDoor":     { en: "Show this at the door", sv: "Visa den i dörren" },

  // ---- errors and the email-limit rescue path ----
  "err.badLogin":    { en: "That email and password don't match.", sv: "E-posten och lösenordet stämmer inte." },
  "err.notConfirmed":{ en: "Confirm your email first, check your inbox, or use the link below to send it again.",
                       sv: "Bekräfta din e-post först, kolla inkorgen, eller använd länken nedan för att skicka igen." },
  "err.exists":      { en: "An account with this email already exists. Try signing in instead.",
                       sv: "Det finns redan ett konto med den e-postadressen. Prova att logga in i stället." },
  // Deliberately explicit. The account almost always exists at this point and
  // only the email is missing, so "try again later" would be wrong advice.
  "err.emailBusy":   { en: "Your account was created, but we're sending a lot of email right now and yours is queued. Wait a few minutes, then use \u201cDidn't get the confirmation email?\u201d below to send it.",
                       sv: "Ditt konto skapades, men vi skickar mycket mejl just nu och ditt ligger på kö. Vänta några minuter och använd \u201dFick du inget bekräftelsemejl?\u201d nedan för att skicka det." },
  "err.tooMany":     { en: "Too many attempts. Please wait a minute and try again.", sv: "För många försök. Vänta en minut och försök igen." },
  "err.captcha":     { en: "The bot check didn't pass. Reload the page and try again.", sv: "Robotkontrollen gick inte igenom. Ladda om sidan och försök igen." },
  "err.password":    { en: "Password must be at least 8 characters.", sv: "Lösenordet måste vara minst 8 tecken." },
  "err.generic":     { en: "Something went wrong. Please try again.", sv: "Något gick fel. Försök igen." },
  "acct.created":    { en: "Account created. Check your inbox to confirm your email, then sign in \u2014 we'll register your membership automatically.",
                       sv: "Kontot \u00e4r skapat. Kolla din inkorg och bekr\u00e4fta din e-post, logga sedan in \u2014 vi registrerar ditt medlemskap automatiskt." },
  "acct.djFailed":   { en: "Your account is created, but your DJ application didn't send. Email your mix and links to info@slutstation.se and we'll pick it up from there.",
                       sv: "Kontot \u00e4r skapat, men din DJ-ans\u00f6kan skickades inte. Mejla din mix och dina l\u00e4nkar till info@slutstation.se s\u00e5 tar vi det d\u00e4rifr\u00e5n." },
  "err.sdkOffline":  { en: "Couldn't load this page, check your connection and reload.",
                       sv: "Kunde inte ladda sidan, kontrollera din uppkoppling och ladda om." },
  "err.noServer":    { en: "We couldn't reach the server. Check your connection and try again.",
                       sv: "Vi kunde inte nå servern. Kontrollera din uppkoppling och försök igen." },

  "acct.resend":     { en: "Didn't get the confirmation email?", sv: "Fick du inget bekräftelsemejl?" },
  "acct.resendNeedEmail": { en: "Enter your email above first, then press this.", sv: "Fyll i din e-post ovan först, tryck sedan här." },
  "acct.resendSending":   { en: "Sending…", sv: "Skickar…" },
  "acct.resendSent": { en: "Sent. Check your inbox, and your spam folder.", sv: "Skickat. Kolla inkorgen, och skräpposten." },
  "acct.resetSent":  { en: "Password reset link sent, check your inbox.", sv: "Länk för återställning skickad, kolla inkorgen." },

  // ---- staged signup + magic link ----
  "acct.step1":      { en: "Account", sv: "Konto" },
  "acct.step2":      { en: "Your details", sv: "Dina uppgifter" },
  "acct.stepOf":     { en: "Step {n} of 2", sv: "Steg {n} av 2" },
  "acct.continue":   { en: "Continue", sv: "Fortsätt" },
  "acct.back":       { en: "Back", sv: "Tillbaka" },
  "acct.detailsWhy": { en: "eBas, the membership register, needs these to register you. They stay between us and it.",
                       sv: "eBas, medlemsregistret, behöver detta för att registrera dig. Det stannar mellan oss och det." },
  "acct.magic":      { en: "Email me a sign-in link", sv: "Mejla mig en inloggningslänk" },
  "acct.magicSent":  { en: "Link sent. Open it on this device and you're signed in.",
                       sv: "Länk skickad. Öppna den på den här enheten så är du inloggad." },
  "err.noAccount":   { en: "No account with that email. Create one first.",
                       sv: "Inget konto med den e-posten. Skapa ett först." },

  // ---- the tier, played as the game it already is ----
  "ms.perkAt":       { en: "Unlocks at {tier}:", sv: "Låses upp vid {tier}:" },
  "ms.topPct":       { en: "Top {p}% of members", sv: "Topp {p} % av medlemmarna" },
  "ms.safeUntil":    { en: "{tier} is yours until at least {date}.",
                       sv: "{tier} är din till åtminstone {date}." },
  "ms.decayWarn":    { en: "A night ages out of your 24-month window on {date} — one more event before then keeps {tier}.",
                       sv: "En kväll faller ur ditt 24-månadersfönster {date} — ett evenemang till innan dess behåller {tier}." },
  "ms.promoT":       { en: "Promoted.", sv: "Uppflyttad." },
  "ms.promoB":       { en: "You reached {tier} on {date}.", sv: "Du nådde {tier} den {date}." },
  "ms.promoBNoDate": { en: "You reached {tier}.", sv: "Du nådde {tier}." },

  // ---- Apple Wallet ----
  "acct.walletAdd1": { en: "Add to", sv: "Lägg till i" },
  "acct.walletAdd2": { en: "Apple Wallet", sv: "Apple Wallet" },
  "acct.walletOk":   { en: "Card downloaded — open it to add it to Wallet. It updates itself when your tier moves.",
                       sv: "Kortet laddades ner — öppna det för att lägga till det i Wallet. Det uppdaterar sig själv när din tier ändras." },
  "acct.walletSoon": { en: "Wallet cards aren't switched on yet — soon.",
                       sv: "Wallet-kort är inte påslaget ännu — snart." },
  "acct.walletFail": { en: "Couldn't fetch the card. Check your connection and try again.",
                       sv: "Kunde inte hämta kortet. Kontrollera uppkopplingen och försök igen." },

  // ---- breadcrumbs + signed-out on-sale preview ----
  "crumb.home":      { en: "Home", sv: "Hem" },
  "tk.previewT":     { en: "On sale right now", sv: "Till försäljning just nu" },

  // ---- tickets page ----
  "tk.eyebrow":      { en: "Tickets",       sv: "Biljetter" },
  "tk.membersT":     { en: "Get your ticket", sv: "Skaffa din biljett" },
  "tk.membersL":     { en: "Tickets are sold through Billetto and open to everyone. Membership is free and required to attend — join before the night, with the same email you buy with, so the night counts toward your tier.",
                       sv: "Biljetter säljs via Billetto och är öppna för alla. Medlemskap är gratis och krävs för att komma in — bli medlem innan kvällen, med samma e-post som du köper med, så räknas kvällen mot din tier." },
  "tk.signinL":      { en: "Already a member? Sign in to see your tickets and your tier.", sv: "Redan medlem? Logga in för att se dina biljetter och din tier." },
  "tk.signinCta":    { en: "Sign in / create account", sv: "Logga in / skapa konto" },
  "tk.onsaleT":      { en: "What's on sale", sv: "Till försäljning" },
  "tk.myTickets":    { en: "My tickets",    sv: "Mina biljetter" },
  "tk.emptyT":       { en: "Nothing on sale right now", sv: "Inget till försäljning just nu" },
  "tk.emptyL":       { en: 'Follow <a href="https://www.instagram.com/slutstation.sthlm/" target="_blank" rel="noopener" style="color:var(--accent)">@slutstation.sthlm</a>, releases are announced there first, and they go fast.',
                       sv: 'Följ <a href="https://www.instagram.com/slutstation.sthlm/" target="_blank" rel="noopener" style="color:var(--accent)">@slutstation.sthlm</a>, släppen annonseras där först, och de går fort.' },
  "tk.loading":      { en: "Loading tickets…", sv: "Laddar biljetter…" },
  "tk.doneT":        { en: "You're in",     sv: "Du är med" },
  "tk.seeAll":       { en: "See all my tickets", sv: "Se alla mina biljetter" },
  "tk.buyMore":      { en: "Buy more",      sv: "Köp fler" },
  "tk.confirming":   { en: "Confirming your payment…", sv: "Bekräftar din betalning…" },
  "tk.pay":          { en: "Pay",           sv: "Betala" },
  "tk.payAmount":    { en: "Pay {amount} kr", sv: "Betala {amount} kr" },
  "tk.total":        { en: "Total price including VAT and all fees. No booking fee. Card and Swish at checkout.",
                       sv: "Totalpris inklusive moms och alla avgifter. Ingen bokningsavgift. Kort och Swish i kassan." },
  "tk.consent":      { en: 'I accept the <a href="/#info" target="_blank" rel="noopener">purchase terms</a> and understand there is <b>no 14-day right of withdrawal</b> on event tickets.',
                       sv: 'Jag godkänner <a href="/#info" target="_blank" rel="noopener">köpvillkoren</a> och vet att det <b>inte finns ångerrätt</b> på evenemangsbiljetter.' },
  "tk.consentSub":   { en: "If we cancel or move the event, you get the full ticket price back, whatever the reason.",
                       sv: "Ställer vi in eller flyttar eventet får du hela biljettpriset tillbaka, oavsett orsak." },
  "tk.mustAgree":    { en: "Accept the purchase terms to continue.", sv: "Godkänn köpvillkoren för att fortsätta." },
  "tk.toStripe":     { en: "Taking you to Stripe…", sv: "Skickar dig till Stripe…" },
  "tk.soldout":      { en: "Sold out",      sv: "Slutsålt" },
  "tk.paused":       { en: "Paused",        sv: "Pausad" },
  "tk.notyet":       { en: "Not yet",       sv: "Inte än" },
  "tk.opens":        { en: "Opens {date}",  sv: "Öppnar {date}" },
  "tk.left":         { en: "{n} left",      sv: "{n} kvar" },
  "tk.addon":        { en: "Add-on",        sv: "Tillval" },
  "tk.needEntry":    { en: "Add an entry ticket to buy this.", sv: "Lägg till en entrébiljett för att köpa den här." },
  "tk.billetto":     {
    en: "Tickets for this one are sold through <strong>Billetto</strong>. The window opens on this page, you'll get your ticket by email from Billetto, and we'll add the night to your account afterwards so it counts towards your tier.",
    sv: "Biljetterna till det här eventet säljs via <strong>Billetto</strong>. Fönstret öppnas på den här sidan, du får biljetten via mejl från Billetto, och vi lägger till kvällen på ditt konto efteråt så att den räknas mot din tier.",
  },
  "tk.openBilletto": { en: "or open it on Billetto", sv: "eller öppna på Billetto" },
  "tk.stillT":       { en: "Payment is still confirming", sv: "Betalningen bekräftas fortfarande" },
  "tk.stillB":       { en: "Your bank hasn't finished confirming yet. Your tickets will appear on your account page, nothing more to do, and nothing is charged twice. If they aren't there in ten minutes, email info@slutstation.se.",
                       sv: "Din bank har inte bekräftat klart än. Biljetterna dyker upp på ditt konto, du behöver inte göra något, och inget dras två gånger. Om de inte är där om tio minuter, mejla info@slutstation.se." },
  "tk.notFoundT":    { en: "We couldn't find that order", sv: "Vi hittar inte den ordern" },
  "tk.notFoundB":    { en: "If you were charged, email info@slutstation.se and we'll sort it immediately.",
                       sv: "Om du blivit debiterad, mejla info@slutstation.se så löser vi det direkt." },
  "tk.paid":         { en: "{n} ticket(s) · {amount} kr paid", sv: "{n} biljett(er) · {amount} kr betalt" },
  "tk.noStart":     { en: "Couldn't start checkout. Try again.", sv: "Kunde inte starta betalningen. Försök igen." },
  "tk.noServer":     { en: "Couldn't reach the server. Check your connection and try again.",
                       sv: "Kunde inte nå servern. Kolla din uppkoppling och försök igen." },

  // ---- countdown, empty state and the photo viewer ----
  "announce.tonight":{ en: "{name} is tonight.", sv: "{name} är i kväll." },
  "announce.tomorrow":{ en: "{name} is tomorrow.", sv: "{name} är i morgon." },
  "announce.inDays": { en: "{name}, doors in {days} days.", sv: "{name}, insläpp om {days} dagar." },
  "events.tonight":  { en: "Tonight",        sv: "I kväll" },
  "events.tomorrow": { en: "Tomorrow",       sv: "I morgon" },
  "events.inDays":   { en: "In {days} days", sv: "Om {days} dagar" },
  "events.join":     { en: "Become a member", sv: "Bli medlem" },
  "gallery.close":   { en: "Close",          sv: "Stäng" },
  "gallery.prev":    { en: "Previous photo", sv: "Föregående bild" },
  "gallery.next":    { en: "Next photo",     sv: "Nästa bild" },

  "acct.qrSave":     { en: "Save it to my photos", sv: "Spara den bland mina bilder" },
  "tier.lead":       { en: "Every tier keeps everything below it. Counted over the last 24 months, so it moves both ways.",
                       sv: "Varje tier behåller allt under sig. Räknas över de senaste 24 månaderna, så den rör sig åt båda hållen." },
  "tier.r1":         { en: "Buy tickets to members-only events.",
                       sv: "Köp biljetter till events endast för medlemmar." },
  "tier.r2":         { en: "The wardrobe is on us, every night you come.",
                       sv: "Garderoben bjuder vi på, varje kväll du kommer." },
  "tier.r4":         { en: "Tickets at our lowest price, always — even on a night that has sold out.",
                       sv: "Biljetter till vårt lägsta pris, alltid — även en kväll som är slutsåld." },
  "tier.r3":         { en: "A soft drink or a Red Bull on us, 20% off your ticket, and the announcement before anyone else.",
                       sv: "En läsk eller en Red Bull på oss, 20% på biljetten, och släppet före alla andra." },
  "tier.change":     { en: "The tiers, and what each one gives you, can change as we grow. A code you have already been given stays yours.",
                       sv: "Tiers, och vad varje nivå ger dig, kan ändras när vi växer. En kod du redan har fått behåller du." },
  // The tier card
  "acct.codesTitle": { en: "Your codes",   sv: "Dina koder" },
  "acct.codeTier3":  { en: "20% off your ticket", sv: "20% på biljetten" },
  "acct.codeTier4":  { en: "Your Tier 4 ticket price", sv: "Ditt Tier 4-biljettpris" },
  "acct.codeShow":   { en: "Show",         sv: "Visa" },
  "acct.codeHide":   { en: "Hide",         sv: "Dölj" },
  "acct.codeCopy":   { en: "Copy",         sv: "Kopiera" },
  "acct.codeCopied": { en: "Copied",       sv: "Kopierad" },
  // Said once, quietly. A code is one person's, and a code posted in a group
  // chat is a code that stops working for the person who earned it.
  // Per-kind, and only ever seen by somebody holding that code. The one thing
  // worth saying is "it works once, so put the whole group on one order" —
  // without it, a member spends their code on a single ticket and finds it
  // dead when their friends want in. It promises no number and no percentage.
  "acct.codeUse3":   { en: "Works once. Put everyone you're bringing on the same order before you check out.",
                       sv: "Fungerar en gång. Lägg alla du tar med på samma order innan du slutför köpet." },
  "acct.codeUse4":   { en: "Your best price, and it works once. Put everyone you're bringing on the same order.",
                       sv: "Ditt bästa pris, och det fungerar en gång. Lägg alla du tar med på samma order." },
  // Demo mode
  "acct.demoTitle":  { en: "Demo mode",      sv: "Demoläge" },
  "acct.demoLead":   { en: "Admins only. Draws the page as a member of that tier would see it. Nothing is saved and no real code is used.",
                       sv: "Endast admin. Ritar sidan som en medlem på den tiern skulle se den. Inget sparas och ingen riktig kod används." },
  "acct.demoOff":    { en: "Off",            sv: "Av" },
  "acct.demoOn":     { en: "DEMO — not real data", sv: "DEMO — inte riktig data" },
  "acct.codeMine":   { en: "Yours alone. Paste it at checkout on Billetto.",
                       sv: "Bara din. Klistra in den i kassan på Billetto." },
  "acct.codeSoon":   { en: "You have earned this — we are preparing your code. It will appear here.",
                       sv: "Du har förtjänat den här — vi förbereder din kod. Den dyker upp här." },
  "acct.perkTitle":  { en: "What your code is worth tonight", sv: "Vad din kod är värd i kväll" },
  "acct.perkWardrobe": { en: "Free wardrobe", sv: "Gratis garderob" },
  "acct.perkDrink":  { en: "A soft drink or a Red Bull", sv: "En läsk eller en Red Bull" },
  "acct.perkClaimed":{ en: "used at {time}", sv: "använd {time}" },
  "acct.perkOpen":   { en: "not used yet", sv: "inte använd än" },
  "acct.perkNone":   { en: "Come to one more night and the wardrobe is on us.",
                       sv: "Kom på en kväll till så bjuder vi på garderoben." },
  // The staff scanner
  "st.tierWord":     { en: "Tier",        sv: "Tier" },
  "st.giveWardrobe": { en: "Free wardrobe",  sv: "Gratis garderob" },
  "st.giveDrink":    { en: "Soft drink / Red Bull", sv: "Läsk / Red Bull" },
  "st.perkDone":     { en: "Handed over",  sv: "Utlämnad" },
  "st.perkAlready":  { en: "Already taken at {time}", sv: "Redan uttagen {time}" },
  "st.perkNotFor":   { en: "Not on Tier {tier}", sv: "Ingår inte i Tier {tier}" },
  "st.perkUndo":     { en: "Undo",         sv: "Ångra" },
  "st.perkNothing":  { en: "Nothing to hand over at this tier.",
                       sv: "Inget att lämna ut på den här tiern." },
  "tier.soon":       { en: "Coming soon",   sv: "Kommer snart" },
  // ---- shifts and the creator dashboard ----
  "shift.title":     { en: "When you work",  sv: "När du jobbar" },
  "shift.lead":      { en: "Your tag opens the staff page 4 hours before doors and closes 6 hours after the event ends. Nothing to remember, nothing to hand back.",
                       sv: "Din tagg öppnar personalsidan 4 timmar före insläpp och stängs 6 timmar efter att eventet slutat. Inget att komma ihåg, inget att lämna tillbaka." },
  "shift.inDH":      { en: "in {d}d {h}h",   sv: "om {d}d {h}h" },
  "shift.inHM":      { en: "in {h}h {m}m",   sv: "om {h}h {m}m" },
  "shift.inM":       { en: "in {m} min",     sv: "om {m} min" },
  "shift.now":       { en: "on now",         sv: "pågår nu" },
  "shift.done":      { en: "done",           sv: "avklarat" },
  "shift.open":      { en: "Open staff page", sv: "Öppna personalsidan" },
  "shift.opens":     { en: "opens {time}",   sv: "öppnar {time}" },

  "promo.title":     { en: "Your code",      sv: "Din kod" },
  "promo.lead":      { en: "Someone counts when they sign up with your code and then turns up to a night. Signing up alone is not enough, which is why the two numbers are different.",
                       sv: "Någon räknas när de registrerar sig med din kod och sedan dyker upp på en kväll. Att bara registrera sig räcker inte, därför skiljer sig de två siffrorna." },
  "promo.live":      { en: "live",           sv: "aktiv" },
  "promo.paused":    { en: "paused",         sv: "pausad" },
  "promo.signups":   { en: "signed up",      sv: "registrerade" },
  "promo.turnedUp":  { en: "turned up",      sv: "dök upp" },
  "promo.waiting":   { en: "not yet",        sv: "inte än" },
  "promo.earned":    { en: "earned",         sv: "intjänat" },
  "promo.week":      { en: "week",           sv: "vecka" },
  "promo.chartTitle":{ en: "Last 12 weeks",  sv: "Senaste 12 veckorna" },
  "promo.chartAlt":  { en: "Signups per week, with the share who came to a night.",
                       sv: "Registreringar per vecka, med andelen som kom på en kväll." },
  "promo.showNumbers": { en: "Show the numbers", sv: "Visa siffrorna" },
  "promo.nothingYet":{ en: "Nobody has used it yet. It starts counting the moment somebody does.",
                       sv: "Ingen har använt den än. Den börjar räkna i samma stund som någon gör det." },
  "promo.foot":      { en: "We never show you who used your code, only how many. When there is something to pay out we arrange it by email.",
                       sv: "Vi visar aldrig vilka som använt din kod, bara hur många. När det finns något att betala ut kommer vi överens via mejl." },

  // ---- work with us ----
  "nav.work":        { en: "Work with us",  sv: "Jobba med oss" },
  "work.eyebrow":    { en: "Work with us",  sv: "Jobba med oss" },
  "work.title":      { en: "Two ways in besides a ticket", sv: "Två vägar in vid sidan av en biljett" },
  "work.lead":       { en: "We build every event ourselves, from the rig to the room. If you want to be part of that, or you have an audience who should be here, this is where you say so.",
                       sv: "Vi bygger varje event själva, från riggen till rummet. Vill du vara med i det, eller har du en publik som borde vara här, är det här du säger till." },
  "work.apply":      { en: "Apply →",       sv: "Ansök →" },
  "work.volPick":    { en: "Work a night, get in free.", sv: "Jobba en kväll, kom in gratis." },
  "work.crePick":    { en: "Bring people, get paid for it.", sv: "Ta med folk, få betalt för det." },
  "work.loading":    { en: "Loading…",      sv: "Laddar…" },
  "work.signinT":    { en: "Sign in first", sv: "Logga in först" },
  "work.signinL":    { en: "Both applications go on your account, so we know who we are talking to and do not have to ask you for a name and a phone number you have already given us.",
                       sv: "Båda ansökningarna hamnar på ditt konto, så vi vet vem vi pratar med och slipper fråga om namn och telefonnummer du redan gett oss." },
  "work.signinCta":  { en: "Sign in or create an account", sv: "Logga in eller skapa konto" },

  "work.volEyebrow": { en: "Volunteer",     sv: "Volontär" },
  "work.volTitle":   { en: "Work a night, get in free", sv: "Jobba en kväll, kom in gratis" },
  "work.volLead":    { en: "Door, bar, building the rig, shooting the night. You get in free on the events you work, you keep your tier, and you are in the room before anyone else is.",
                       sv: "Dörr, bar, bygga riggen, filma kvällen. Du kommer in gratis på de event du jobbar, du behåller din tier, och du är i rummet före alla andra." },
  "work.teaseVol":   { en: "Door, bar, building the rig, shooting the night. You get in free on the events you work and the night still counts towards your tier.",
                       sv: "Dörr, bar, bygga riggen, filma kvällen. Du kommer in gratis på de event du jobbar och kvällen räknas ändå mot din tier." },
  "work.volPerk1":   { en: "Free entry to every event you work.", sv: "Fri entré på varje event du jobbar." },
  "work.volPerk2":   { en: "The nights you work still count towards your tier.", sv: "Kvällarna du jobbar räknas ändå mot din tier." },
  "work.volPerk3":   { en: "First to hear about everything, and a say in what we build next.",
                       sv: "Först att få veta allt, och en röst i vad vi bygger härnäst." },
  "work.volJobs":    { en: "What would you like to do?", sv: "Vad vill du göra?" },
  "work.jobDoor":    { en: "Door, scanning people in", sv: "Dörr, skanna in folk" },
  "work.jobBar":     { en: "Bar",             sv: "Bar" },
  "work.jobBuild":   { en: "Building and striking the rig", sv: "Bygga och riva riggen" },
  "work.jobMedia":   { en: "Photo and video", sv: "Foto och video" },
  "work.jobSocial":  { en: "Social media and design", sv: "Sociala medier och design" },
  "work.jobAny":     { en: "Anything, put me where you need me", sv: "Vad som helst, sätt mig där ni behöver mig" },
  "work.volHow":     { en: "How often could you work?", sv: "Hur ofta skulle du kunna jobba?" },
  "work.freqEvery":  { en: "Every event",     sv: "Varje event" },
  "work.freqMost":   { en: "Most events",     sv: "De flesta event" },
  "work.freqSome":   { en: "A few a year",    sv: "Några gånger om året" },
  "work.freqOnce":   { en: "I want to try one and see", sv: "Jag vill testa en gång och se" },
  "work.volTime":    { en: "Preferred time", sv: "Tid som passar bäst" },
  "work.timeAny":    { en: "Any time",        sv: "När som helst" },
  "work.timeBuild":  { en: "Before doors, building the rig", sv: "Före insläpp, bygga riggen" },
  "work.timeEarly":  { en: "Early, from doors", sv: "Tidigt, från insläpp" },
  "work.timeLate":   { en: "Late, until close", sv: "Sent, fram till stängning" },
  "work.timeStrike": { en: "After close, packing down", sv: "Efter stängning, riva" },
  "work.volExp":     { en: "Have you done anything like this before?", sv: "Har du gjort något liknande förut?" },
  "work.volExpPh":   { en: "Bar work, festivals, sound, security, nothing at all. All fine.",
                       sv: "Barjobb, festivaler, ljud, ordningsvakt, ingenting alls. Allt går bra." },
  "work.volTraining":{ en: "Any relevant training or certificates?", sv: "Någon relevant utbildning eller certifikat?" },
  "work.volTrainingPh": { en: "STAD, first aid, driving license, none.", sv: "STAD, första hjälpen, körkort, inget." },
  "work.volNote":    { en: "Anything we should know?", sv: "Något vi bör veta?" },
  "work.optional":   { en: "Optional.",       sv: "Frivilligt." },
  "work.volAgree":   { en: "I understand this is unpaid volunteering for a non-profit, that shifts are agreed in advance, and that turning up matters more than anything else on this form.",
                       sv: "Jag förstår att det här är ideellt arbete utan lön för en ideell förening, att pass bokas i förväg, och att dyka upp betyder mer än något annat i det här formuläret." },
  "work.volSubmit":  { en: "Apply to volunteer", sv: "Ansök som volontär" },

  "work.creEyebrow": { en: "Creators and promoters", sv: "Kreatörer och promotors" },
  "work.creTitle":   { en: "Bring people, get paid for it", sv: "Ta med folk, få betalt för det" },
  "work.creLead":    { en: "If you make content or you know a room full of the right people, we will give you your own code. You can see exactly what it does, and you get paid on the people who actually turn up.",
                       sv: "Gör du content eller känner du ett rum fullt av rätt folk ger vi dig en egen kod. Du ser exakt vad den gör, och du får betalt för de som faktiskt dyker upp." },
  "work.teaseCre":   { en: "Your own code, your own numbers, and paid on the people who actually turn up. Not per click, not per follower.",
                       sv: "Egen kod, egna siffror, och betalt för de som faktiskt dyker upp. Inte per klick, inte per följare." },
  "work.crePerk1":   { en: "Your own code, on your own page, with real numbers behind it.",
                       sv: "En egen kod, på din egen sida, med riktiga siffror bakom." },
  "work.crePerk2":   { en: "Paid per person who signs up with your code and comes to a night. Not per click, not per follower.",
                       sv: "Betalt per person som registrerar sig med din kod och kommer på en kväll. Inte per klick, inte per följare." },
  "work.crePerk3":   { en: "Guest list for you, and access to shoot at our events.",
                       sv: "Gästlista till dig, och möjlighet att filma på våra event." },
  "work.creKind":    { en: "Which are you?",  sv: "Vad är du?" },
  "work.kindCreator":{ en: "Creator, I make content", sv: "Kreatör, jag gör content" },
  "work.kindPromoter":{ en: "Promoter, I bring people", sv: "Promotor, jag tar med folk" },
  "work.kindBoth":   { en: "Both",            sv: "Båda" },
  "work.creWanted":  { en: "Code you would like", sv: "Kod du vill ha" },
  "work.creWantedPh":{ en: "Letters and numbers, e.g. NOVA", sv: "Bokstäver och siffror, t.ex. NOVA" },
  "work.creWantedHint": { en: "We will use this if it is free. Nothing is decided until we say yes.",
                       sv: "Vi använder den om den är ledig. Inget är bestämt förrän vi säger ja." },
  "work.creChannels":{ en: "Your channels",   sv: "Dina kanaler" },
  "work.creChannelsHint": { en: "Fill in the ones you actually use. Handle and roughly how many followers.",
                       sv: "Fyll i de du faktiskt använder. Användarnamn och ungefär hur många följare." },
  "work.followers":  { en: "Followers",       sv: "Följare" },
  "work.creOther":   { en: "Anywhere else",   sv: "Någon annanstans" },
  "work.creOtherPh": { en: "SoundCloud, Spotify, a newsletter, a group chat.",
                       sv: "SoundCloud, Spotify, ett nyhetsbrev, en gruppchatt." },
  "work.creAudience":{ en: "Who is your audience, and where are they?", sv: "Vilka är din publik, och var finns de?" },
  "work.creAudiencePh": { en: "Age, city, what they are into. Stockholm matters most to us.",
                       sv: "Ålder, stad, vad de gillar. Stockholm betyder mest för oss." },
  "work.crePlan":    { en: "What would you actually do?", sv: "Vad skulle du faktiskt göra?" },
  "work.crePlanPh":  { en: "Post before each event, film the night, bring twenty people, run a group. Be honest, we would rather have small and real.",
                       sv: "Posta inför varje event, filma kvällen, ta med tjugo personer, driva en grupp. Var ärlig, vi tar hellre litet och äkta." },
  "work.creAgree":   { en: "I understand rewards are paid on people who sign up with my code and actually attend, that the rate is agreed with us in writing, and that nothing is owed until a night has happened.",
                       sv: "Jag förstår att ersättning betalas för personer som registrerar sig med min kod och faktiskt kommer, att nivån avtalas skriftligt med er, och att inget är intjänat förrän en kväll har ägt rum." },
  "work.creSubmit":  { en: "Apply for a code", sv: "Ansök om en kod" },
  "work.noBank":     { en: "We never ask for bank details on this site and we never store them. When there is something to pay, we arrange it with you by email.",
                       sv: "Vi frågar aldrig efter bankuppgifter på den här sidan och vi sparar dem aldrig. När det finns något att betala ut kommer vi överens om det via mejl." },

  "work.pickJob":    { en: "Pick at least one thing you would like to do.", sv: "Välj minst en sak du vill göra." },
  "work.needChannel":{ en: "Fill in at least one channel.", sv: "Fyll i minst en kanal." },
  "work.tickAgree":  { en: "Tick the box to send this.", sv: "Kryssa i rutan för att skicka." },
  "work.needSignin": { en: "Sign in first.", sv: "Logga in först." },
  "work.sent":       { en: "Sent. We read every one of these.", sv: "Skickat. Vi läser varenda en." },
  "work.stPendingT": { en: "With us for review", sv: "Hos oss för granskning" },
  "work.stPendingB": { en: "Sent {date}. We will come back to you, and you will see it here first.",
                       sv: "Skickad {date}. Vi hör av oss, och du ser det här först." },
  "work.stApprovedT":{ en: "You're in",       sv: "Du är med" },
  "work.stApprovedB":{ en: "Everything you need is on your account page.", sv: "Allt du behöver finns på din kontosida." },
  "work.stRejectedT":{ en: "Not this time",   sv: "Inte den här gången" },
  "work.stRejectedB":{ en: "It is not a no forever. Send another one whenever something changes.",
                       sv: "Det är inte ett nej för alltid. Skicka en till när något förändras." },

  // ---- invite code and attendance history ----
  "acct.refTitle":   { en: "Your invite code", sv: "Din vänkod" },
  "acct.refLead":    { en: "Give it to someone worth having here. We can see who you brought.",
                       sv: "Ge den till någon som hör hemma här. Vi ser vem du tog med." },
  "acct.refCopy":    { en: "Copy",           sv: "Kopiera" },
  "acct.refCopied":  { en: "Copied",         sv: "Kopierad" },
  "acct.refNone":    { en: "Nobody has used it yet.", sv: "Ingen har använt den än." },
  "acct.refCount":   { en: "{q} turned up, {p} signed up but not yet.",
                       sv: "{q} har dykt upp, {p} har registrerat sig men inte kommit än." },
  "acct.histTitle":  { en: "Your nights",    sv: "Dina kvällar" },
  "acct.histOne":    { en: "One night with us, since {date}.", sv: "En kväll med oss, sedan {date}." },
  "acct.histMany":   { en: "{n} nights with us, since {date}.", sv: "{n} kvällar med oss, sedan {date}." },
  "acct.histTier":   { en: "Reached Tier {t}", sv: "Nådde Tier {t}" },
  "acct.histMore":   { en: "Older nights are counted but not listed.",
                       sv: "Äldre kvällar räknas men listas inte." },
  "acct.notifyEvents": { en: "New events, when they are announced.",
                       sv: "Nya event, när de annonseras." },
  "acct.notifyLast": { en: "Last-minute tickets, on the day itself.",
                       sv: "Sista minuten-biljetter, samma dag." },

  // ---- shared UI verbs and runtime messages ----
  "ui.sending":      { en: "Sending…",    sv: "Skickar…" },
  "ui.signingIn":    { en: "Signing in…", sv: "Loggar in…" },
  "ui.creating":     { en: "Creating account…", sv: "Skapar konto…" },
  "ui.updating":     { en: "Updating…",   sv: "Uppdaterar…" },
  "ui.saving":       { en: "Saving…",     sv: "Sparar…" },
  "ui.saved":        { en: "Saved.",        sv: "Sparat." },
  "ui.checking":     { en: "Checking…",   sv: "Kontrollerar…" },
  "ui.registering":  { en: "Registering…", sv: "Registrerar…" },
  "err.email":       { en: "Please enter a valid email address.", sv: "Fyll i en giltig e-postadress." },
  "err.needPw":      { en: "Please enter your password.", sv: "Fyll i ditt lösenord." },
  "err.required":    { en: "Please complete all required fields.", sv: "Fyll i alla obligatoriska fält." },
  "err.pwMismatch":  { en: "The two passwords don't match.", sv: "Lösenorden stämmer inte överens." },
  "err.needEmailFirst": { en: "Enter your email above first, then press this.",
                       sv: "Fyll i din e-post ovan först, tryck sedan här." },
  "err.notSignedIn": { en: "Not signed in", sv: "Inte inloggad" },
  "err.saveDetails": { en: "Couldn't save your details. Please try again.",
                       sv: "Kunde inte spara dina uppgifter. Försök igen." },
  "acct.pwUpdated":  { en: "Password updated.", sv: "Lösenordet är uppdaterat." },
  "acct.qrFail1":    { en: "Couldn't draw the code,", sv: "Kunde inte rita koden," },
  "acct.qrFail2":    { en: "staff can look you up by name.", sv: "personalen kan söka på ditt namn." },
  "ms.verified":     { en: "Verified in eBas.", sv: "Verifierat i eBas." },
  "tk.less":         { en: "One fewer",     sv: "En färre" },
  "tk.more":         { en: "One more",      sv: "En till" },

  // ---- staff / door page ----
  "st.signout":      { en: "Sign out",      sv: "Logga ut" },
  "st.checking":     { en: "Checking your shift…", sv: "Kollar ditt pass…" },
  "st.noShiftT":     { en: "You're not on shift", sv: "Du har inget pass" },
  "st.back":         { en: "Back to my account", sv: "Tillbaka till mitt konto" },
  "st.scanT":        { en: "Scan codes",    sv: "Skanna koder" },
  "st.camOn":        { en: "Start camera",  sv: "Starta kameran" },
  "st.camOff":       { en: "Stop",          sv: "Stoppa" },
  "st.typeLbl":      { en: "Or type a ticket code", sv: "Eller skriv in en biljettkod" },
  "st.typeHint":     { en: "Printed under the QR on their ticket.", sv: "Står tryckt under QR-koden på biljetten." },
  "st.check":        { en: "Check code",    sv: "Kontrollera" },
  "st.findT":        { en: "Find a member", sv: "Hitta en medlem" },
  "st.searchLbl":    { en: "Search by name", sv: "Sök på namn" },
  "st.inTonightT":   { en: "Checked in tonight", sv: "Incheckade i kväll" },
  "st.doorMode":     { en: "Door mode",     sv: "Dörrläge" },
  "st.doorExit":     { en: "Exit door mode", sv: "Lämna dörrläget" },
  "st.inSoFar":      { en: "in so far",     sv: "inne hittills" },
  "st.offlineGet":   { en: "Download the list for offline", sv: "Ladda ner listan för offline" },
  "st.offlineGetting": { en: "Downloading…", sv: "Laddar ner…" },
  "st.offlineHave":  { en: "{n} names on this phone. Cleared when the shift ends.",
                       sv: "{n} namn i den här telefonen. Rensas när passet är slut." },
  "st.offlineNone":  { en: "Nothing saved yet. Do this before you lose signal.",
                       sv: "Inget sparat än. Gör det innan du tappar täckning." },
  "st.offlineNo":    { en: "No offline list on this phone, and no signal.",
                       sv: "Ingen offlinelista i den här telefonen, och ingen täckning." },
  "st.offlineUsing": { en: "Offline. Searching the copy on this phone.",
                       sv: "Offline. Söker i kopian på den här telefonen." },
  "st.noShiftB":     { en: "Door and bar access is granted per event and opens 4 hours before doors. If you're working tonight and this still says no, ask an admin to check your assignment.",
                       sv: "Dörr- och baråtkomst ges per event och öppnar 4 timmar före insläpp. Jobbar du i kväll och det ändå står nej, be en admin kolla din tilldelning." },
  "st.scanL":        { en: "Works for both: a <b>ticket</b> code (SS-…) admits one ticket, a <b>member</b> code counts them in. Each scans once.",
                       sv: "Fungerar för båda: en <b>biljettkod</b> (SS-…) släpper in en biljett, en <b>medlemskod</b> räknar in personen. Varje kod skannas en gång." },
  "st.findL":        { en: "For when a phone is dead or a code won't scan.",
                       sv: "För när en telefon är död eller en kod inte går att skanna." },
  "st.findLBar":     { en: "Check whether someone is a member and what tier they're on. Charging to a balance arrives with the wallet.",
                       sv: "Kolla om någon är medlem och vilken tier de har. Att dra på saldo kommer med plånboken." },
  "st.searchPh":     { en: "Start typing a name…", sv: "Börja skriva ett namn…" },
  "st.tonight":      { en: "Tonight",       sv: "I kväll" },
  "st.doors":        { en: "doors",         sv: "insläpp" },
  "st.roleDoor":     { en: "Door",          sv: "Dörr" },
  "st.roleBar":      { en: "Bar",           sv: "Bar" },
  "st.notAdmit":     { en: "Not admitted",  sv: "Släpps inte in" },
  "st.generic":      { en: "Something went wrong.", sv: "Något gick fel." },
  "st.badTicket":    { en: "That ticket isn't valid here.", sv: "Den biljetten gäller inte här." },
  "st.ticketWord":   { en: "ticket",        sv: "biljett" },
  "st.holder":       { en: "Ticket holder", sv: "Biljettinnehavare" },
  "st.admit":        { en: "{name}, admit", sv: "{name}, släpp in" },
  "st.alsoHolds":    { en: "also holds {list}", sv: "har även {list}" },
  "st.notActive":    { en: "membership not active", sv: "medlemskapet är inte aktivt" },
  "st.offlineT":     { en: "Saved offline", sv: "Sparad offline" },
  "st.offlineB":     { en: "No signal, this check-in will send itself when you're back online.",
                       sv: "Ingen uppkoppling, incheckningen skickas av sig själv när du är online igen." },
  "st.notIn":        { en: "Not checked in", sv: "Inte incheckad" },
  "st.notMember":    { en: "Membership is not active — send them to the account page.",
                       sv: "Medlemskapet är inte aktivt — hänvisa dem till kontosidan." },
  "st.memberWord":   { en: "Member",        sv: "Medlem" },
  "st.nEvents":      { en: "{n} events",    sv: "{n} event" },
  "st.holds":        { en: "holds {list}",  sv: "har {list}" },
  "st.scannedList":  { en: "{list} already scanned", sv: "{list} redan skannad" },
  "st.noTicketHere": { en: "no ticket bought here", sv: "ingen biljett köpt här" },
  "st.alreadyT":     { en: "{name}, already scanned", sv: "{name}, redan skannad" },
  "st.alreadyB":     { en: "Counted once already tonight.", sv: "Redan räknad en gång i kväll." },
  "st.lapsedT":      { en: "{name}, membership not active", sv: "{name}, medlemskapet är inte aktivt" },
  "st.lapsedB":      { en: "Let them in at your discretion; they can renew at slutstation.se/account.html",
                       sv: "Släpp in om du vill; de kan förnya på slutstation.se/account.html" },
  "st.inT":          { en: "{name}, checked in", sv: "{name}, incheckad" },
  "st.noScanner":    { en: "Couldn't load the scanner, use the search below.",
                       sv: "Kunde inte ladda skannern, använd sökningen nedan." },
  "st.camDenied":    { en: "Camera permission denied, allow it in the browser, or use the search below.",
                       sv: "Kameran nekades, tillåt den i webbläsaren, eller använd sökningen nedan." },
  "st.camNone":      { en: "No camera available, use the search below.",
                       sv: "Ingen kamera tillgänglig, använd sökningen nedan." },
  "st.notOursT":     { en: "Not a Slutstation code", sv: "Inte en Slutstation-kod" },
  "st.notOursB":     { en: "That QR isn't one of ours.", sv: "Den QR-koden är inte vår." },
  "st.shortT":       { en: "Code too short", sv: "Koden är för kort" },
  "st.shortB":       { en: "It looks like SS-XXXX-XXXX.", sv: "Den ser ut så här: SS-XXXX-XXXX." },
  "st.noMatch":      { en: "Nobody by that name.", sv: "Ingen med det namnet." },

  // ---- reporting from the door ----
  "st.reportT":       { en: "Report something", sv: "Rapportera något" },
  "st.reportL":       { en: "Refused entry, an incident, capacity reached. Timestamped and goes straight to the admins.",
                        sv: "Nekad entré, en incident, fullt hus. Tidsstämplas och går direkt till administratörerna." },
  "st.reportKind":    { en: "What happened", sv: "Vad hände" },
  "st.reportRefused": { en: "Refused entry", sv: "Nekad entré" },
  "st.reportIncident":{ en: "Incident", sv: "Incident" },
  "st.reportCapacity":{ en: "Capacity reached", sv: "Fullt hus" },
  "st.reportOther":   { en: "Something else", sv: "Något annat" },
  "st.reportNote":    { en: "A line about it (optional)", sv: "En rad om det (valfritt)" },
  "st.reportSend":    { en: "File it", sv: "Rapportera" },
  "st.reportOk":      { en: "Filed. The admins can see it now.", sv: "Rapporterat. Administratörerna ser det nu." },
  "st.reportFail":    { en: "Couldn't file it — check the connection and try again.",
                        sv: "Kunde inte rapportera — kontrollera uppkopplingen och försök igen." },
  "st.reportNoShift": { en: "You're not on shift right now.", sv: "Du är inte i tjänst just nu." },
  "st.alreadyIn":    { en: "already in",    sv: "redan inne" },
  "st.pillMember":   { en: "member",        sv: "medlem" },
  "st.pillLapsed":   { en: "not active",    sv: "inte aktiv" },
  "st.checkIn":      { en: "Check in",      sv: "Checka in" },
  "st.noneYet":      { en: "Nobody through the door yet.", sv: "Ingen har gått in än." },
  "st.nInTonight":   { en: "{n} in tonight", sv: "{n} inne i kväll" },
  "st.undo":         { en: "Undo",          sv: "Ångra" },
  "st.inTonightL":   { en: "Most recent first. Undo removes a check-in from this event only.",
                       sv: "Senaste först. Ångra tar bort incheckningen bara från det här eventet." },
};
// ---------------------------------------------------------------------------
// current language
// ---------------------------------------------------------------------------
export function getLang() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (LANGS.includes(saved)) return saved;
  } catch (e) {}
  // First visit: follow the browser, but only for Swedish. Everything else
  // gets English, which is what the site is written in.
  const nav = (navigator.language || "").toLowerCase();
  return nav.startsWith("sv") ? "sv" : "en";
}

export function setLang(lang) {
  if (!LANGS.includes(lang)) return;
  try { localStorage.setItem(STORE_KEY, lang); } catch (e) {}
  applyI18n(document, lang);
  document.dispatchEvent(new CustomEvent("ss:lang", { detail: { lang } }));
}

export function t(key, vars) {
  const entry = DICT[key];
  let s = entry ? (entry[getLang()] ?? entry.en) : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

// ---------------------------------------------------------------------------
// apply to the DOM
// ---------------------------------------------------------------------------
export function applyI18n(root = document, lang = getLang()) {
  document.documentElement.lang = lang;

  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const e = DICT[el.dataset.i18n];
    if (!e) return;
    let out = e[lang] ?? e.en;
    // Strings whose text is filled in at runtime (the announcement bar names an
    // event and a date) carry their values on the element, so switching
    // language re-renders them properly instead of printing "{name}".
    if (el.dataset.i18nVars) {
      try {
        const vars = JSON.parse(el.dataset.i18nVars);
        out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
      } catch (err) { /* malformed: fall through to the raw string */ }
    }
    el.textContent = out;
  });

  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const e = DICT[el.dataset.i18nHtml];
    if (e) el.innerHTML = e[lang] ?? e.en;
  });

  // data-i18n-attr="placeholder:acct.mixPh,aria-label:nav.menu"
  root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    el.dataset.i18nAttr.split(",").forEach((pair) => {
      const [attr, key] = pair.split(":").map((x) => x.trim());
      const e = DICT[key];
      if (attr && e) el.setAttribute(attr, e[lang] ?? e.en);
    });
  });

  // Long-form blocks written twice in the HTML, legal text, mostly.
  root.querySelectorAll("[data-lang]").forEach((el) => {
    el.hidden = el.dataset.lang !== lang;
  });

  // Open accordions used to need re-measuring here when their text swapped
  // length; the grid-rows animation in the stylesheet tracks content height
  // on its own, so there is nothing to fix up any more.

  root.querySelectorAll("[data-lang-btn]").forEach((btn) => {
    const on = btn.dataset.langBtn === lang;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", String(on));
  });
}

// ---------------------------------------------------------------------------
// the switch itself
// ---------------------------------------------------------------------------
export function mountLangToggle(container) {
  const host = typeof container === "string" ? document.querySelector(container) : container;
  if (!host || host.querySelector(".lang-switch")) return;

  const wrap = document.createElement("div");
  wrap.className = "lang-switch";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Language");
  wrap.innerHTML = LANGS.map(
    (l) => `<button type="button" data-lang-btn="${l}" aria-pressed="false">${l.toUpperCase()}</button>`
  ).join("");

  wrap.querySelectorAll("[data-lang-btn]").forEach((b) =>
    b.addEventListener("click", () => setLang(b.dataset.langBtn))
  );

  host.prepend(wrap);
}

export function initI18n(toggleContainer = ".nav-cta") {
  mountLangToggle(toggleContainer);
  applyI18n(document, getLang());
}
