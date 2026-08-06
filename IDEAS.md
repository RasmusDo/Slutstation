# What to build next

Written as a list of recommendations, now half a changelog. Everything under
**Built** is live in the code and, where it touches the database, applied to the
live one. Everything under **Still worth doing** is unchanged from the original
list.

The principle behind most of it, which is worth keeping: **the database already
knows far more about a member than the site ever tells them.** It knows every
event they attended, when they first came, how far off the next tier they are,
who they referred. The cheapest wins are not new systems, they are showing what
you already have.

---

## Built

### Account page

**Your nights.** "5 nights with us, since May 2025", then the list, newest
first: date, event, venue. Nights that pushed them up a tier are marked. It only
appears once they have actually been to something, so a new member does not get
an empty panel.

**The invite code.** It has existed in the database since the first schema and
has never once been on screen. It is now on the tier card with a copy button and
a line saying how many of the people they brought have turned up. There is no
reward attached yet, and that is fine: the code has to be visible before anyone
can use it, and the referrals it collects in the meantime are what make a reward
worth designing later.

**Two email preferences instead of one.** "New events, when they are announced"
and "last-minute tickets, on the day itself" are different messages, and one
tick was covering both. Existing members are opted into both, so nobody silently
loses mail they agreed to.

**The page reorders itself on the day.** When a member holds a ticket for
tonight, tickets and the entry code move above the membership card. At 23:40 in
a queue that is the only reason anyone opens this page.

### Main page

**A countdown.** The banner says "doors in 6 days", "tomorrow" or "tonight"
rather than a date, and the event card carries the same line. A date tells you
when it is; a countdown gives you a reason to come back tomorrow, and it changes
on its own.

**The gallery opens.** It was nine thumbnails you could not click, which is a
strange thing to do with photographs. Full size now, with arrows, swipe and
Escape.

**Past events open their own photos.** A past event card opens the viewer on
that night's pictures. Attribution is one attribute: add `data-night="sunset"`
to a gallery figure and it joins that card's set. Only two are attributed so
far, the two whose subject is not in doubt (Kägelbanan and Kärsön) — the rest
are unassigned on purpose rather than guessed at. Cards with nothing attributed
stay inert instead of pretending to have an album behind them.

**A better empty state.** "No events scheduled yet" was honest and flat, and it
is what every visitor currently sees. Now: "The next one is being built. Members
hear first, and our events sell out before they reach anyone else." With the
join button next to the Instagram link.

### Admin panel

**Tonight.** When an event is today, a strip at the top of the panel says so and
opens straight into it. On the other 360 days a year it renders nothing at all,
rather than sitting there saying "no event today".

**A member timeline.** Open somebody and you now see what happened and when:
joined, approved, every night they came, every tier they reached. Current state
answers "what"; this answers "how did they get here", which is what every
support question is really asking.

**The import returns a receipt.** It told you four numbers. It now also lists
who was recorded, by name, and gives you a one-click copy of every address that
had no account, ready for the Bcc field. A bulk write across other people's
accounts is only trustworthy if you can see exactly what it did and to whom.

### Staff page

**Door mode.** Big result, big colour, everything else out of the way, a running
count of who is inside, and the screen held awake. It is a body class and
nothing more: the same scanner, the same server calls, the same permission
checks. Nothing in it can change who gets in.

### Backend

**Attendance and tier changes are events now, not just state.** `member_events`
is append-only, written by trigger, readable by the member for their own rows
and by admins for everyone's. It is what makes "you reached Tier 3 last
Saturday" possible, and it means a tier has a date attached instead of being
recomputed from a count every time anyone looks. Backfilled from everything that
already happened.

**A weekly digest to ourselves.** Every Monday at 09:00: new accounts, approvals,
check-ins, the next event and whether it is announced. Then the half that
matters — members stuck on a form, eBas failures, welcome emails that never
sent. All of those are currently invisible until somebody complains. Recipients
live in `app_settings.digest_to`, so changing who gets it is a row in the
database rather than a deploy.

**Everything got translated.** The site had roughly sixty strings that were
always English regardless of the switch, most of them on the account page and
all of the runtime messages on the staff page. Those are done. **The admin panel
is deliberately still English** — it is used by two people who both read English
and translating ninety-six strings there buys nothing.

### Crew

**A crew view in the admin panel.** Door and bar tags are per event and expire
on their own, which is the right model and left one blind spot: there was
nowhere to see the people. Three sections now. **Cover** shows every upcoming
event with its door and bar counts and the names already on it, and flags in
red any event with nobody on the door. **Put someone on a shift** searches every
account, not just existing crew, because the point is adding somebody who has
never worked before. **Everyone who works here** lists anyone who has ever held
a tag plus every admin, sorted by who is on right now, then who is on next, then
who worked most recently, each row carrying their door and bar counts and how
many people they have personally scanned in — the one number that says who did
the work rather than who was rostered. Open anyone for their contact details and
every shift they have had, with what they did on each night.

It also turned up a real bug: five tabs would not fit in the admin pill on a
phone, so the row overflowed the viewport and the last tab could not be tapped
at all. It wraps now.

### Working with us

**Two applications, one page.** `/work.html`: volunteer, or creator/promoter.
Both are attached to the signed-in account, so neither asks for a name, phone
number or address we already hold. Volunteers pick what they want to do, how
often and which nights; creators give their channels with follower counts, who
their audience is, what they would actually do, and the code they would like.
Both go into an admin queue with a status the applicant can see, including the
note back from whoever reviewed it.

**Roles are not a column.** Being a volunteer or a creator is "has an approved
application of that kind", which means somebody can be both, the decision keeps
its date and its author, and revoking it is one click back to rejected rather
than a migration.

**Codes with real numbers behind them.** An approved creator gets a code from
the admin panel, with a per-person rate that can stay at zero until it is
decided. On their account page they see how many signed up, how many actually
turned up, how many have not yet, what has been earned, and twelve weeks as a
chart. **They never see who** — counts only. A code qualifies on ATTENDANCE, not
on a purchase, because while Billetto sells the tickets a purchase is not
something we can verify, and paying out on something unverifiable is how this
kind of scheme goes wrong.

**No payment details are stored, anywhere, deliberately.** Not bank accounts,
not Swish numbers. The database records what a code has earned; paying it is
arranged by email between two humans. A table of other people's account numbers
is a liability with no upside at this size.

**Everyone with a tag sees when they work.** Their shifts, with a live countdown
("in 3d 4h", "in 5h 59m", "on now"), the practical info for that night, and the
exact time the staff page opens for them. On the account page and on the staff
page, so "You're not on shift" now answers the question underneath it.

### Shipped from the list below

Since this list was written: **the announcement email** (the announce switch now
reaches inboxes, batched 40 per ten minutes against Loopia's 200/hour ceiling,
exactly-once, and proved to send nothing while nothing is announced); **the
published tier ladder** (skip the queue at 2, first refusal at 3, a free guest
at 4, with your own row lit up); **practical info per event**, shown on the
shift card and in the announcement email; **headcount against capacity** in the
admin panel; **a dry run on the import**; **CSV export** of members and codes;
**an audit log** of every admin decision; **save your entry code to your
photos**; and **offline search at the door** (front end done — the one SQL
statement behind it is deliberately left unapplied, see below).

---

## Still worth doing

The list below is ordered the same way: by what I think buys the most, not by
what is most fun to build. Rough cost is attached to each, because that is
usually the deciding factor.

### Decide first

**Whether the door phone may hold the member list.** `schema-phase9` has one
statement commented out, and it is a judgement call rather than a technical
one. Check-ins already queue offline; lookups do not, so when the signal drops
the fallback for a cracked screen stops working, which in a forest is exactly
when it is wanted. The function is no wider than what staff can already search
for one row at a time (name, membership, tier), and it is gated on being on
shift for an event right now — but it is the whole membership in one response,
landing in a browser on a volunteer's phone. A lost phone becomes a lost list of
names. The front end already treats it as unavailable and carries on, so this is
genuinely optional. Uncomment it if you want the door to work without signal.

**What a creator is actually paid.** The plumbing does not care what the number
is and the rate is frozen onto each signup the moment it qualifies, so changing
it later never rewrites what somebody was already owed. Pick one before the
first code goes out, and put it in writing with the person holding the code.

### For members

**A guest each, vouched for.** Members-only is the pitch and everyone wants to
bring someone. A member-vouched +1, with the member's name attached to the
guest, is how a members-only collective grows without opening the door — and it
fills the referrals table with real data, which is what makes tier rewards worth
designing. It also gives you something to take away from anyone whose guest
causes trouble, which is a more useful sanction than banning the guest. One
table, one form, one line at the door. Two days.

**Passwordless sign-in.** The magic-link template is already built and sitting in
`supabase/email-templates/`. For a nightlife audience opening the site on a
phone at 2am in a queue, a link beats remembering a password, and every password
you do not store is one you cannot leak. An hour of configuration.

**A waiting list when a release sells out.** One button, "tell me if one comes
back", and the returns go to that list before they go public. It converts the
frustration of a sellout into a list of people who have proven they want in. One
table and a reuse of the last-minute email.

**Who played.** After the night: the DJs, in order, with their mixes. You already
collect mix links on the DJ application form and you already have the gallery.
It is the only thing that would make a member open the account page a week after
an event, and it makes the artists' own audiences link to you.

### For crew

**A note on a person, visible at the door.** "Refused last time", "comp,
approved by Axel", "owes the bar". One field, written by an admin, read by door
staff. Worth doing carefully: it is personal data about behaviour, so it needs a
retention rule (say, cleared after twelve months) and it should never be
something a member cannot ask to see. Half a day plus a paragraph in the privacy
policy.

**Report something from the door.** One button that files a timestamped note —
refused entry, incident, capacity reached — straight into the admin panel. It
costs nothing to build and it is the beginning of the incident record that a
serveringstillstånd application and any conversation with the police will
eventually want. Two hours.

**A handover.** Who is on the door now, who is due to relieve them, and a count
of what has happened this shift. Small, and it stops the 01:00 conversation that
starts with "wait, who is on?".

**Bar mode that does something.** Bar staff currently get a lookup and nothing
else. The closed-loop balance is built and dormant; the day it turns on, bar
mode becomes "charge this to their balance" and the tier discount applies itself.
Not now — but it is the reason the bar tag exists, and worth remembering.

### For admin

**What the night cost.** The panel knows what came in and nothing about what
went out. A non-profit has to show a break-even per event to its board and
eventually to Skatteverket, and right now that lives in somebody's spreadsheet.
A small costs table — venue, sound, artists, security — turns the event page
into something you can take to a meeting. A day.

### Housekeeping

**Say how many members there are.** "412 members" under the join button.
Membership is the product and social proof is the entire pitch for a
members-only collective. One count, cached. Deliberately not built yet.

**Move email off Loopia before you need it.** The one I would insist on. The
200/hour ceiling is not a hypothetical, and the night it bites is the night
1,500 people are trying to join. Twenty minutes and about $20 (see GO-LIVE.md).

**Put a real Turnstile key in.** The code is there and dormant. The day someone
points a script at your signup form is the day you wish it had been on.

**Attribute the rest of the gallery.** Two nights of five have photos attached.
The mechanism is built; what is missing is somebody who was there saying which
picture is which.

---

## Things I would deliberately not build

**Full ticketing in-house, for now.** It is built and tested and switched off,
and that is the right place for it. Billetto's fee is worth the hours you would
spend on payment support during your first big event.

**A native app.** Nothing here needs one. The account page saved to a home
screen gets you 90% of it for none of the cost.

**Gamification beyond tiers.** Badges and streaks would feel bolted on to
something that is currently quite restrained and adult. The tier system already
does the job because it maps to something real, which is whether you turn up.
