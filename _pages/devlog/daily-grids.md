---
layout: page
title: How ten word grids a day get made, checked, and frozen
lead: Notes from building the Linky Words daily puzzle - the packing problem underneath it, the bug that wrote boards nobody could finish, and the time-zone bug that would have handed Santiago the wrong puzzle.
description: How the Linky Words daily puzzle builds its grids, checks every one with an independent solver, and keeps the same puzzle on the same date for everyone.
include_in_header: false
---

Linky Words is a daily word puzzle. Each day has one category and ten small grids: two 3×3, five
4×4 and three 5×5. You find a word by tracing it through touching letters, in any of the eight
directions, never using a tile twice. The rule that shapes everything below is that **every letter on
the board belongs to exactly one word**. There are no filler letters, so a grid is finished when every
tile is used.

![A 4×4 Hospital grid as it is presented, and the same grid solved: GAUZE, ARTERY and SLING, each traced through touching tiles, using all sixteen.]({{ site.baseurl }}/assets/devlog/hospital-board.png)

You can [play today's set in the browser]({{ site.baseurl }}/play/), with no signup.

## It's a packing problem, not a word search

A word search hides words among noise, and anything left over doesn't matter. Here nothing is left
over: a 4×4 grid with GAUZE, ARTERY and SLING is 5 + 6 + 5 = 16 letters on 16 tiles. Each word is a
path of king moves that never revisits a tile, and the paths can't share tiles. So laying out a board
means **tiling a square with disjoint self-avoiding walks** whose lengths are fixed in advance and
whose letters are fixed in order.

That has two consequences.

First, the words for a board have to add up exactly: 9, 16 or 25 letters. A day's word list is cut
into groups that fill each size exactly, with at least two words per board and words of 3 to 9
letters. A 9-letter word can't be a 3×3 on its own.

Second, a group that adds up correctly isn't guaranteed to fit. The lengths can be right and the
geometry wrong.

## Laying out one board

The generator is a backtracking search:

1. Place the first word as a random walk, one letter at a time, backing up whenever it boxes itself in.
2. Look at the tiles still free. The first walk has usually cut them into separate **regions**, and
   a word can't jump between regions. Regions are found by flood fill through edge neighbours, then
   regions that touch only diagonally are joined, since a word can step diagonally. Where two
   diagonals cross, a word can use only one of them, so the generator branches and tries each.
3. Check whether the remaining words can be assigned to regions whose sizes they fill exactly, which
   is a small bin-packing step. If they can't, undo and try the first word somewhere else.
4. Recurse into each region with its own words.

In practice the search almost always succeeds. For this post I sampled 2,952 groups that exactly
fill a board, from 164 word lists, across all three sizes, and every one laid out on the first seed.
But it can give up, and a failure that rare is easy to stop checking for.

## The bug that wrote boards nobody could finish

The generator ends in one of two states: `DoneSuccess` or `DoneFailed`. The batch tool that turned
a word list into a day's ten boards never looked at which one it got. It wrote the board file either
way.

So a group that added up but wouldn't lay out would still have produced a board file, one nobody
could finish. Nothing was checking. And because the generator drew its random numbers from the
engine's global random source, a failure couldn't have been reproduced on a second run.

The fix was to make day creation all or nothing:

- Every board in a day is laid out before any file is written, with up to 32 explicit seeds per board.
- If one board fails, the word list is reshuffled and regrouped, up to 200 times.
- If the day still can't be built, nothing is written. No board files, no day file, no index entry. The
  error tells you to add more words, especially short ones.

The fix landed before the daily relaunched in September. Whether any of the earliest boards were
broken, I can't say; every board in the current run passes the solver below.

The generator itself lives in the app's C# code. To build days without opening the game engine, it
was ported to JavaScript **line for line**, quirks included. It draws two random numbers where one
would do, and reads one value off the wrong copy of the board. Tidying either would change which word
groups lay out at all, and the only way to find out would be players opening boards. Building a full
day now takes about 50 ms.

## Checking with something that doesn't know how the board was made

A board built by a buggy generator, or by a faithful port of one, will pass any check that shares its
assumptions. So the check shares none. `solveBoard()` is a separate solver that knows only the
player's rules:

- every lettered tile must be used, and the letter count must equal the word lengths' total;
- each word must be traceable through king-adjacent tiles;
- no tile may be shared between words.

It tries the longest word first, which prunes hardest, and backtracks.

It runs in two places:

- **A validator** checks every day on disk the way a player would meet it: 153 days, 1,530 boards,
  every file the game loads, in about half a second.
- **The web export** solves every board on the way out, and one failure aborts the whole export, so
  the site never gets half a set.

The validator also rejects any board containing the category's own name, since that word is printed
above the grid as a free answer. Three days from before that check have it: CINEMA in Cinema, OFFICE
in Office, MUSEUM in Museum. They stay as warnings, because those days have already been played.

## Frozen: the same puzzle on the same date, everywhere

A shared daily only means something if the person you send it to gets the puzzle you played. That
rules out one convenient design: the puzzle can't depend on when you installed the app.

So the schedule is global. The day's puzzle is numbered by how many days have passed since 1 September
2026, and the order of the content index is the schedule. A day rolls over at your local midnight. A
shared link opens as soon as that date has started anywhere on Earth. The furthest-ahead clock is UTC+14,
so when someone in Auckland shares Tuesday's puzzle, a friend in California still on Monday can open
it. A date that hasn't started anywhere is refused, so the archive can't be read ahead of time. Search
engines don't see a day's page until its date arrives: a scheduled job on the site releases one day
each morning.

Once a day ships, it doesn't change. A shared link carries a date, not a puzzle, so editing a past day
would silently change what everyone's links point at.

## The DST bug

The first version of the web player worked out the day number by subtracting two local timestamps
and dividing by 86,400,000 ms. That works until a clock changes for daylight saving. A day that is 23
or 25 hours long rounds the wrong way, and every date after the change lands on the wrong day.

A test matrix across time zones caught it before launch. Over the first 73 days, the wrong puzzle
would have been served on:

- 67 days in Santiago,
- 46 in Auckland,
- 39 in Sydney.

Santiago also could never reach the last day at all. Each of those wrong days breaks a shared link,
which is the one thing the daily exists for.

The fix counts calendar days rather than milliseconds. It reads the year, month and day from the
local clock, as the rollover requires, and does the arithmetic in UTC, where every day is exactly
86,400,000 ms. The app never had the bug, because C# subtracts two calendar dates rather than two
moments in time. The time-zone cases are kept as a test of the web player.

## What it's made of, honestly

- **Code.** The app is C# in Unity. The web player is plain JavaScript with no build
  step. Much of the tooling described here, including the JavaScript port, the solver, the validator
  and the web player, was written with an AI coding assistant, and I review and test what ships.
- **Words.** Most daily word lists were drafted with language models. Each one is then cleaned by
  script (length, duplicates, words that name the category) and then reviewed by hand.
- **Icons.** Most category icons were drawn by image models, in one shared medallion style.
- **Not done yet.** The daily content runs to 31 January 2027. There's no cloud save. Missing a day
  still breaks your streak.

If you try it, I'd like to hear which grid stopped you, and whether the 5×5s are fun or just long.
