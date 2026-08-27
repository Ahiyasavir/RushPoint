---
publishDate: 2026-08-24T00:00:00Z
language: en
slug: what-a-bad-signal-teaches-you
title: What a bad signal teaches you about field games
excerpt: Every assumption a field game makes about connectivity gets tested by one basement, one stone courtyard, or one crowded square.
category: Running a game
tags:
  - reliability
  - running a game
---

Somewhere in every game there is a spot with no reception. A stone courtyard, an underpass, the inside of a building, or a square with two thousand people on the same cell tower.

You cannot design that away. What you can do is decide in advance what happens there.

## The failure that looks like a bug

A team submits an answer. The screen spins. They press again. Nothing. They walk twenty metres, it goes through, and now they have submitted twice.

Every part of that is predictable, and none of it is the player's fault. It is what happens when software assumes the network is a yes or no question rather than something that comes and goes.

## Three things worth deciding early

**A blocking check must fail open.** If the app thinks it is offline and refuses to send, it has to be wrong in the direction that still lets the player through. The server validates everything anyway, so a refused submission that would have worked is a pure loss.

**A repeated submission must be harmless.** The second press of a button should reach the same state as the first, not a second score. This is the server's job, not the player's.

**A lost position fix is not a permanent failure.** GPS drops. The right response is to try again shortly, not to give up until the app is restarted. A task that checks arrival automatically has no manual fallback, so giving up there strands the team completely.

## Why this matters more than it sounds

None of these show up in a test. They show up on a Saturday afternoon with thirty people outside and no way to fix anything.

The thing worth internalising is that a field game is not an app that happens to be used outdoors. Outdoors is the environment it is designed for, and an unreliable network is a normal condition rather than an error state.
