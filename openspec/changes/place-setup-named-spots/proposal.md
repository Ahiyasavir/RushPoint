# place-setup-named-spots

## Why
Ahiya, 3.11, on a composed game with two places:
- "I don't like that every time again it says לכו ל... Mix it: sometimes תגיעו ל..., and other forms."
- "If you already wrote לכו ל... in the first part of the stage and every mission is in the same area,
  why do you write it again in every mission?"
- "With so many located missions, ask for a location for every PLACE we named, with the option to add
  several forests, several parks and so on, and then you put the missions' locations in. Much easier."
- "For each place they should choose a name, and then לכו ל... uses the name they chose."
- "Add a place option for youth movements creating an activity: סניף."
- "Remember these locations, so when the app is used a lot it already knows where there is a forest,
  a mall and so on."

Today every composer-pinned mission has its own map screen, and every mission bound to one of two
places starts with the same "לכו ל<kind>." line.

## What changes
- Every mission of a placed stage carries its place kind (`Task.placeTrack`), not only the two-set stages.
- The go-to line moves to the STAGE: one line in the stage's opening card, only where the place changes
  from the previous stage, in a rotating form (לכו ל / תגיעו ל / ממשיכים ל / השלב הזה ב). A two-set stage
  keeps a line per mission (a team plays one set and the stage cannot name one place), rotating too.
- The setup walk opens with one screen per place kind ("Where is the park?"): one or more spots, each
  with a name and a pin. The walk then pins every composer-placed mission itself: a stage takes one spot
  of its kind (spots rotate across the stages of that kind), missions sit in a small ring around it, and
  those missions' own map screens drop out of the walk. The lines use the spot's name.
- New place kind `branch` (סניף). A mission fits a branch when it fits a school.
- The spots are stored on the game (`Game.placeSpots`): kind, name, point. That is the memory to learn
  from later; `memorablePlaceSpots` drops `home`, so a private address never feeds it.

## Not in this change
Suggesting a remembered spot to another creator (needs a server aggregate and a privacy review).
