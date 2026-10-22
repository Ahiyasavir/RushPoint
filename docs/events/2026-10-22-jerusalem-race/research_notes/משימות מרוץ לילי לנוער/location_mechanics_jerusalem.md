# Location as the mechanic: patterns from location-based games, and Jerusalem night content to build missions on

Scope: (a) design patterns where the physical place itself is the puzzle, and (b) verifiable, night-visible details in central Jerusalem, from the Central Bus Station to Yemin Moshe. The event runs Thursday 2026-10-22, 19:00-22:15. East Jerusalem and the Muslim Quarter are out of bounds. Research budget: about 23 tool calls. Several items I went looking for could not be verified. They are listed under Gaps, not presented as facts.

## Q1. Location-game patterns where the place itself is the mechanic

### Takeaway
The strongest patterns make the player do something only the real place can answer: read a plaque, match a photo, narrow a hidden zone with yes/no questions, or reach a staffed checkpoint while being hunted. Most of them already fit RushPoint's primitives (hidden mission plus search area, geofence or arrival unseal, quiz or numeric answer, photo, sequence, timed windows, flash missions). Jet Lag's question economy and JTTEOTN's chasers are the two mechanics with no direct RushPoint equivalent.

### Cited Findings
**Ingress / Pokémon GO: the landmark is the game node**
- Ingress turns real landmarks (statues, towers, plaques, murals) into its key play spots, and Pokémon GO uses the same approach — [Wikipedia: Ingress](https://en.wikipedia.org/wiki/Ingress_(video_game)); [Vice](https://develop.vice.com/en/article/what-pokemon-go-owes-ingress/)
- PokéStops and Gyms were taken from Ingress's location database — [Game Informer](https://gameinformer.com/b/features/archive/2015/09/10/take-a-look-at-what-pok%C3%A9mon-go-partners-niantic-labs-have-done-before); [Quartz](https://qz.com/738737/pokemon-gos-predecessor-ingress-has-never-been-more-popular)
- Players submitted the portals and Niantic moderated them. By July 2016, 15M had been submitted and 5M accepted. Submissions were paused in Sept 2015 because of the backlog, and the "Portal Recon" voting tool followed — [TechCrunch](https://techcrunch.com/2016/11/17/niantics-invite-only-portal-recon-tool-lets-players-vote-new-real-world-locations-into-ingress); [Quartz](https://qz.com/738737/pokemon-gos-predecessor-ingress-has-never-been-more-popular)
- The Niantic idea that every playable location supplies what players need was quoted second-hand, from a fan letter rather than a primary source — [KRWG](https://www.krwg.org/post/letter-pok-mon-go-players-ingress-fan)

**Geocaching: fake coordinates, multi-stage chains, night caches**
- Puzzle (Mystery) caches usually post fake coordinates, and players solve a puzzle to get the real ones. Puzzles can be images with coordinates hidden in them — [Geocaching Wiki (fandom)](https://geocaching.fandom.com/wiki/Mystery_cache?oldid=5347)
- "Mystery" is a catch-all category with no formal sub-types. Puzzle caches, challenge caches and night caches are common informal kinds — [Geocaching Wiki](https://geocaching.fandom.com/wiki/Mystery_cache?oldid=5347)
- Multi-caches have 2+ locations. Stage 1 gives a clue to stage 2, and the last stage is the physical container — [govalleykids](https://govalleykids.com/geocache-types/); [The Escape Roomer](https://theescaperoomer.com/a-brief-guide-to-geocaching/)
- Bonus caches hide their clues inside other caches by the same owner. In partial-coordinate designs, each cache holds one piece of the final coordinates — [Geocaching Wiki](https://geocaching.fandom.com/wiki/Mystery_cache?oldid=5347); [tocr.com](https://tocr.com/?p=2329)
- Caveat: these are community sources, not Groundspeak's official guidelines.

**Jet Lag: Hide+Seek, a hidden zone narrowed by questions**
- Seekers ask questions from six fixed categories to narrow down where the hider is. Card rewards include time bonuses and "curses" that restrict the seekers — [Ride with DATA (DART adaptation)](https://ridewithdata.substack.com/p/get-ready-for-jet-lag-the-game-hide); [MRT wiki](https://wiki.minecartrapidtransit.net/index.php/Hide_%2B_Seek)
- Thermometer: the seeker moves and is told "warmer" or "colder". The line splits the map at the perpendicular bisector of the two points — [Reddit r/JetLagTheGame](https://nyc1.lr.ggtyler.dev/r/JetLagTheGame/comments/1i9u0ys/very_confused_about_thermometer)
- Radar: "is the hider within X of me?" answered hit or miss (example: a 10,000 radar from Central Park returns a hit) — [MRT wiki](https://wiki.minecartrapidtransit.net/index.php/Hide_%2B_Seek)
- Hiding zone: in a city-scale adaptation, the hider stays within ½ mile of a chosen light-rail station and gets 30 min to hide. In the endgame, once seekers enter the zone, the hider must stay in place — [Ride with DATA](https://ridewithdata.substack.com/p/get-ready-for-jet-lag-the-game-hide); [MRT wiki](https://wiki.minecartrapidtransit.net/index.php/Hide_%2B_Seek)
- The rules ship in three scales (nation, large city, small city), and hiding time and bonus values change with scale — [MRT wiki](https://wiki.minecartrapidtransit.net/index.php/Hide_%2B_Seek)

**Journey to the End of the Night (JTTEOTN): checkpoints and growing chasers**
- Runners carry a manifest of about 6 checkpoints and must reach them in order without being tagged. Movement is on foot or public transit only — [Wikipedia](https://en.wikipedia.org/wiki/Journey_to_the_End_of_the_Night_(game)); [sf.funcheap](https://sf.funcheap.com/?p=581840)
- Everyone holds a runner ribbon and a chaser ribbon. A tagged runner becomes a chaser, so the hunters multiply as the night goes on. Checkpoints are staffed by volunteers or art crews — [Ludocity](https://ludocity.org/wiki/Journey); [GGWash](https://ggwash.org/view/amp/1626)
- In SF 2011, about 100 of roughly 1,300 starters reached the end — [Wikipedia](https://en.wikipedia.org/wiki/Journey_to_the_End_of_the_Night_(game))
- The game is published under Creative Commons — [Ludocity](https://ludocity.org/wiki/Journey)

**Actionbound / Questo: app-driven outdoor escape games**
- Actionbound combines GPS coordinates with pre-placed codes and mysteries. Its own guidance is to create sections where players check their location, and to hide permanent QR codes that players scan to confirm where they are — [Actionbound blog](https://en.actionbound.com/blog?tag=tips); [actionbound.com](https://actionbound.com)
- Questo markets itself as escape rooms played outdoors. I found no public detail on how its clues reveal locations — [App Store](https://apps.apple.com/au/app/id1216630504)

**Night-specific precedent (Jerusalem)**
- A commercial "Jerusalem after dark" tour of Mahane Yehuda street art already exists. The painted shutters become the attraction once the stalls close — [ToursByLocals](https://www.toursbylocals.com/tours/israel/jerusalem/tour-details/jerusalem-after-dark-machane-yehuda-graffiti-and-street-art-tour-6abdea8ad1a656284c5f9b86)
- Israel ScaVentures runs a Nachlaot scavenger hunt, including finding a synagogue door carved with the symbols of the 12 tribes (Hesed V'Rachamim synagogue). This is the operator's claim, not checked independently — [israel21c](https://www.israel21c.org/?p=64831); [Inbal Hotel](https://www.inbalhotel.com/?p=3500)

### Inferences
These are my mappings, not sourced claims:
- **Fake coordinates → solve → real pin.** This maps onto a `locationHidden` mission with `searchArea`, unsealed by arrival. The clue is the puzzle, and the circle stops it from becoming hopeless.
- **Multi-cache chain.** This maps onto a `sequence` mission, or a stage where each mission's answer is a number that appears at the next spot ("the year on the plaque × 2 = the gate number you need").
- **Jet Lag thermometer and radar.** The cheap version is a flash mission or a paid hint: "the next spot is closer to X than to Y", or "within 300 m of the Davidka: yes or no", priced like `hintPenalty`. A real shrinking-circle mechanic would need product work.
- **JTTEOTN chasers.** Staff or a "hunter team" tagging runners, who then lose points or must do a penalty mission. For minors at night, tagging should mean a photo of the other team's bib, not physical contact.
- **Photo-match ("where was this taken?").** Media on a hidden task, plus a photo submission at the spot. This works especially well with Souza shutters, since each one is unique and only visible at night.
- **Read-the-place answers** (a date on a plaque, the number of lions, a verse) are the cheapest way to prove a team was physically there without trusting GPS. They complement `reportArrival`.
- **Timed windows.** The Teddy Park fountain show, if it runs in October, is a natural "be here at 20:00" flash mission.

### Gaps
- I found no official Jet Lag Hide+Seek rulebook text, so the six category names and costs (matching, measuring, radar, thermometer, tentacles, photo) are unconfirmed. The adaptations cited say "six categories" without listing them all.
- Nothing came back on Shinteki or Midnight Madness (not searched, for budget). Questo's clue mechanics are undocumented publicly.

## Q2. Central Jerusalem: quirky, verifiable, night-visible details (Central Bus Station to Yemin Moshe)

### Takeaway
There is plenty of verifiable material along the route. The best night-proof anchors are always visible: the Souza shutters (visible ONLY once stalls close), the Davidka monument and its verse, the Jaffa Gate breach, the Chords Bridge, the Lion Fountain, the Montefiore windmill, the Finger of Og column, and Zion Square's cinema origin. Interiors (Hurva, Cardo shops) are mostly closed by 19:00. Thursday night is the shuk's busiest bar night, which matters for a youth event.

### Cited Findings
**Chords Bridge (Gesher HaMeitarim), city entrance, next to the Central Bus Station**
- 66 steel cables. Mast about 118 m (sources range from 118 to 120). Longest span 160 m, total length 360 m. Opened 25 June 2008. Carries the light rail's Red Line plus a glass-sided pedestrian walkway — [Wikipedia](https://en.wikipedia.org/wiki/Chords_Bridge); [Structurae](https://structurae.net/en/structures/chords-bridge)
- The cables are where the harp-inspired name comes from. Time gives a 140 m figure, which conflicts with the others — [Time](https://content.time.com/time/specials/2007/article/0,28804,1642444_1849541_1849538,00.html)
- At night it is lit and visible. Possible mission: "count the cables you can see from one side" (expected answer 66 total; one side shows only part). Do not send minors onto the roadway.

**Mahane Yehuda: Solomon Souza shutter portraits**
- Souza is a British-Israeli artist, born 1993, who spray-paints portraits of historical and contemporary figures on the market's metal shutters. They are visible only when stalls are closed — [Wikipedia](https://en.wikipedia.org/wiki/Solomon_Souza)
- Berel Hahn conceived the project. Souza worked weeknights after the stalls closed, with the owners' permission — [The Tower / ISRAEL21c](https://www.thetower.org/?p=58773)
- More than 250 of the 360 shutters were painted by July 2018. He paints 1 to 4 per night, each taking 2 to 4 hours — [Wikipedia](https://en.wikipedia.org/wiki/Solomon_Souza); [FIU ArtSpeak](https://artspeak.fiu.edu/interviews/solomon-souza/)
- Subjects include Einstein, Gandhi, Begin, Yossi Banai, Ben-Gurion (painted UPSIDE DOWN, reportedly a nod to his headstand), and about a dozen rabbis (Maimonides, Ovadia Yosef, Kaduri…) — [Wikipedia](https://en.wikipedia.org/wiki/Solomon_Souza)
- A Nikki Haley portrait was painted in 2019 — [JPost](https://www.jpost.com/Israel-News/Nikki-Haley-immortalized-in-graffiti-at-Jerusalems-Mahane-Yehuda-Market-593661)
- **Night caveat:** on Thursday night many bar and restaurant stalls are OPEN, so their shutters are rolled up. Fewer portraits are visible than on other nights, and alleys are crowded (see below).

**Mahane Yehuda: Thursday night**
- Thursday is the market's big night out (the start of the Israeli weekend). Bars spill into the alleys, with live music. Named venues include Beer Bazaar, Jimmy's Parliament (one of the oldest bars), Tap N' Tail and Machneyuda — [Inbal Hotel](https://www.inbalhotel.com/exploring-bars-in-the-market-after-dark/); [israel.travel](https://israel.travel/jerusalem-market/)
- Yalla Basta runs a Thursday bar tour starting at 20:30 — [israel.travel](https://israel.travel/jerusalem-market/)
- Azura (Iraqi/Turkish home-style cooking) was opened in 1952 by Ezra Scherpler, a Turkish immigrant who started as a dishwasher in a shuk restaurant. He died aged 86 — [JPost](https://jpost.com/israel-news/article-724910); [Time Out](https://www.timeout.com/israel/restaurants/azura)

**Nachlaot**
- A cluster of about 23 courtyard neighbourhoods around Mahane Yehuda, begun in the 1870s, known for narrow lanes, hidden courtyards and many small synagogues — [DBpedia: Nachlaot](https://dbpedia.org/page/Nachlaot)
- Batei Milner, in the courtyard area beside Batei Ungarin, was built by Shlomo Milner (described as a pioneer of the tahini industry). The project began in 1892, it was dedicated in 1898, and it had 35 apartments sold cheaply to the poor — [Hamichlol: Batei Milner](https://www.hamichlol.org.il/בתי_מילנר). This is possibly what was meant by "Feingold".
- The carved 12-tribes door at Hesed V'Rachamim synagogue is a scavenger-hunt claim; see Q1.

**Davidka Square (Jaffa Rd × HaNevi'im × Pines)**
- The square holds a small memorial to the Davidka, the improvised 1948 mortar — [Wikipedia: Davidka Square](https://en.wikipedia.org/wiki/Davidka_Square)
- The Davidka monument's inscription is "וגנותי על העיר הזאת להושיעה" (2 Kings 19:34, with a parallel in Isaiah 37:35). Wikipedia does not say whether this is the Jerusalem or the Safed monument, so verify on site — [Wikipedia: Davidka](https://en.wikipedia.org/wiki/Davidka)
- The mortar was first used on 13 March 1948 — [israeled.org](https://israeled.org/davidka-mortar-first-used)

**Russian Compound: the "Finger of Og" column**
- A huge Herodian-era column, partly carved and still attached to bedrock, lies between the cathedral and the police building. It was abandoned, apparently because of a natural crack — [BAR library](https://library.biblicalarchaeology.org/?p=127259); [Approaching Jerusalem](https://approachingjerusalem.substack.com/p/russian-compound-plateau)
- Discovery date conflicts: 1860 or 1871, and the sources may describe different objects — same sources
- Czar Alexander II bought the land after the Crimean War (not Nicholas) — [Wikipedia: Russian Compound](https://en.wikipedia.org/wiki/Russian_Compound)
- The compound also holds the Museum of Underground Prisoners (cells and the gallows used against the Jewish underground). It is closed at night — [Jewish Virtual Library](https://WWW.JEWISHVIRTUALLIBRARY.ORG/russian-compound)
- The column sits in a sunken, fenced pit. At night it is visible only if street lighting reaches it (unverified).

**Zion Square (Kikar Tzion)**
- Named after the Zion Cinema (Zion Hall), which stood in a hut on the site from about 1912. The hut collapsed under snow around 1920 and was rebuilt as a larger theatre. Israel21c dates the theatre to 1916 instead — [Wikipedia](https://en.wikipedia.org/wiki/Zion_Square); [Israel21c](https://archive.israel21c.org/?p=87779)
- In 1930, the first movie with sound and music shown in Jerusalem was screened at the Zion Theater — [ICC Jerusalem](https://www.iccjer.co.il/en/?p=1567)
- Originally called "Zion Circus". It is a Mandate-era triangle bounded by Jaffa Rd, Ben Yehuda and King George, on land bought from the Greek Orthodox Patriarchate — [Wikipedia](https://en.wikipedia.org/wiki/Zion_Square)
- A 2015 plan proposed renaming it "Tolerance Square" after Shira Banki. Whether it was carried out is unconfirmed — [Yeshiva World](https://www.theyeshivaworld.com/news/headlines-breaking-stories/390097/jerusalem-city-hall-kikar-tzion-zion-square-to-become-a-landmark-of-tolerance.html)

**Jaffa Gate: the 1898 breach**
- The Ottomans opened the wall beside Jaffa Gate ahead of Kaiser Wilhelm II's 1898 visit, so carriages and horses could enter. Today it is the car entrance to the Old City — [Wikipedia: Jaffa Gate](https://en.wikipedia.org/wiki/Jaffa_Gate)
- The moat at the foot of the Citadel was filled in and a road was built to the gate — [Israel Antiquities Authority](https://antiquities.org.il/jerusalemwalls/preservation_e05jaffa_hstry.asp)
- Myth-buster: one writer argues that only about 5 or 6 courses of stone had to be removed, and that most of the work was filling the moat, so the popular claim that "they knocked down the wall for the Kaiser" is overstated. Single source — [Approaching Jerusalem](https://approachingjerusalem.substack.com/p/breadcrumbs-at-jaffa-gate)
- The Tower of David runs an evening "Night Spectacular" show (paid, ticketed) — [Planetware](https://www.planetware.com/jerusalem/jewish-quarter-isr-jr-jjq.htm)

**Jewish Quarter**
- The Cardo has a reproduction of the Madaba Map (the original is in St George's church, Madaba, Jordan). It is part of 10 mosaics unveiled in 2016, displayed in the underground part of the Cardo — [IJN](https://www.ijn.com/art-mosaics-returns-jerusalems-old-city/); [Wikipedia: Cardo](https://en.wikipedia.org/wiki/The_Cardo_(Jerusalem))
- Hurva Synagogue: guided visits only, Sun-Thu 09:00-17:00, so CLOSED during the event window — [Culture Trip](https://www.theculturetrip.com/asia/israel/articles/the-best-things-to-see-and-do-in-jerusalems-jewish-quarter)
- Western Wall Tunnels: guided, pre-booked, about 75 min, Sun-Thu "until late at night" (undated listing) — [Arrival Guides](https://www.arrivalguides.com/en/Travelguide/JERUSALEM/old-city/western-wall-tunnels-125590)
- Night access to the Madaba replica is unconfirmed. If it sits in an open, public part of the Cardo street it may be viewable; verify on a walk-through.

**Yemin Moshe / Mishkenot Sha'ananim / Bloomfield Garden**
- The Montefiore windmill was built in 1857 at Sir Moses Montefiore's initiative so poor Jews could get cheaper flour or bread — [Jewish Chronicle](https://www.thejc.com/news/israel/jerusalems-yemin-moshe-windmill-to-work-again-geo2i9ck)
- **Disputed fact, good for a "true or false" mission:** the Jerusalem Foundation says it "never functioned properly" because it was too low in the landscape; legend blames a spell cast from the Old City. Ynet says it worked at least 18 years, and Boas says it turned until 1878, when steam milling replaced it — [Jerusalem Foundation](https://jerusalemfoundation.org/old-project/montefiore-windmill/); [Ynet](https://www.ynetnews.com/articles/0,7340,L-3251209,00.html); [Adrian Boas](https://www.adrianjboas.com/post/on-where-not-to-build-a-mill)
- Mishkenot Sha'ananim is described as the first neighbourhood outside the walls; its first building was completed in 1860 — [Jerusalem Foundation](https://jerusalemfoundation.org/old-project/montefiore-windmill/)
- **Lion Fountain** (Bloomfield Garden, near the windmill): designed by Gernot (and Barbara) Rumpf and given by West Germany in 1989. A tree of life with three branches (the three religions) is surrounded by bronze lions, with mice and doves at their feet and Noah's dove on top. It is described as Jerusalem's first fountain (a claim, one source) — [Israel Public Art](https://israelpublicart.com/collection/the-lions-fountain/); [Jerusalem Foundation](https://jerusalemfoundation.org/old-project/bloomfield-garden/); [Israel21c](https://archive.israel21c.org/?p=85099)
- Possible mission: "count the mice" or "what animal sits at the very top?" (Noah's dove). Count on site before the event; I found no published count.

**Teddy Park (beside Jaffa Gate / Mamilla)**
- Evening fountain show (water, lights, music) at 20:00, with an extra 21:00 show in summer. The park is open until 23:00. Lonely Planet also lists 22:00, and iGoogledIsrael says there is no show on Fridays — [iTravelJerusalem](https://www.itraveljerusalem.com/attraction/teddy-park); [Time Out](https://www.timeout.com/israel/attractions/teddy-kollek-park); [igoogledisrael](https://igoogledisrael.com/?p=18253)
- Whether the show runs on 22 October (after summer) is UNCONFIRMED. It needs a check with the Jerusalem Foundation or the park.

### Inferences
- The route runs naturally west to east and then south: Chords Bridge → Central Bus Station → Jaffa Rd → Mahane Yehuda and Nachlaot → Davidka → Russian Compound → Zion Square and Ben Yehuda → Safra Square → Mamilla → Jaffa Gate and Teddy Park → Jewish Quarter → Yemin Moshe.
- "Read the place" answers that are verifiable and permanent:
  - Davidka verse (verify on site)
  - Jaffa Gate breach year (1898)
  - Windmill year (1857)
  - Lion Fountain gift year (1989)
  - Chords Bridge cable count (66)
  - Zion Square "what used to stand here?" (a cinema)
- The windmill's working-life dispute and the overstated Jaffa Gate demolition are good "myth or truth" missions, because the honest answer is interesting.
- Thursday crowds and bars in the shuk, with minors present, argue for keeping shuk missions to the market's open streets (Agripas / Jaffa side) early in the evening, and for avoiding bar alleys after about 20:30.
- Sunset on 22 Oct 2026 should be around 17:30-17:40 (Israel is still on daylight time until 25 Oct). So the whole event runs in full dark; this is unsourced astronomy, so check it. Lighting at each spot matters more than daytime photos suggest.

### Gaps
- **"Feingold houses / courtyard"**: I found no source for a Jerusalem site under that name (two Hebrew searches). It may be confused with Batei Milner or another courtyard. Needs a local check before it is used.
- **Bullet holes**: no source tied bullet holes to the Russian Compound or the Finger of Og. Not confirmed anywhere on the route.
- **Safra Square, Ben Yehuda, Mamilla specific quirks** (sculptures, plaques, odd street names), **Marzipan rugelach history**, and urban legends: not found or not searched within budget.
- **2025-2026 changes**: Blue Line works close King George and Strauss to public transport between Ben Yehuda and HaNevi'im, with a 2 km tunnel at the Jaffa-Strauss junction, running until about 2029. Both streets are planned to become pedestrian promenades — [Ynet](https://www.ynetnews.com/real-estate/article/syry00mhjgx). Separately, in 2025 nine Red Line stations closed for about 14 weeks to connect the Red and Green lines — [Times of Israel](https://www.timesofisrael.com/9-jerusalem-light-rail-stops-closed-for-months-causing-significant-disruptions/). Whether these works are still active in October 2026, and which sidewalks are fenced off, is UNKNOWN. A site walk is needed.
- I found no new 2025-2026 street art or murals in the area.
- Night opening of the Cardo's Madaba replica, and whether the Finger of Og is lit, are unconfirmed.
