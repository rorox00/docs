# Algorithm Games

Two games for the activity - pick either one, or show both.

| Game | Algorithm | Style |
|------|-----------|-------|
| `treasure_hunt_game.py` | Binary Search | Graphical, click the chests (recommended) |
| `bubble_sort_game.py` | Bubble Sort | Text based, type S / K in the terminal |

---

# 1. Treasure Hunt (Binary Search) - graphical game

A row of locked treasure chests is buried in **increasing order** and one of
them holds the diamond. You may open only a few chests before the tide comes
in, so opening them one by one never works. Every chest you open answers
**TOO LOW** or **TOO HIGH**, and that answer throws away half of the island
in a single move - which is exactly Binary Search.

### How to run

```bash
python treasure_hunt_game.py
```

It uses **tkinter**, which is already included with Python on Windows, so
nothing has to be installed.

### How to play

- Chests still worth searching sit inside a **glowing blue band**
- Click the **middle chest** of that band - the chest lights up when you point at it
- Blue chest = its number was too low, red chest = too high
- Chests the algorithm has ruled out turn dark and show an `x`
- Find the diamond before your moves run out

### Scoring

| Action | Score |
|--------|-------|
| Opening the exact middle chest | +10 (PERFECT SPLIT) |
| Level completed | +100 |
| Every unused move | +20 |
| Whole level played correctly | +50 |
| Hint | -25 |

### Levels

| Level | Chests | Moves allowed |
|-------|--------|---------------|
| 1 | 8 | 4 |
| 2 | 16 | 5 |
| 3 | 24 | 6 |
| 4 | 32 | 6 |

With 32 chests, Binary Search needs at most 5 moves - so the move limit can
only be met by playing the algorithm properly. Clearing all four levels wins
the game; running out of moves shows GAME OVER and reveals the diamond.
Both screens offer **Play Again**.

---

# 2. Bubble Sort Battle (text version)

An algorithm-based educational game written in Python for
**Activity I – Develop an Algorithm-Based Educational Game**
(Subject: Data Structures and Algorithm, Class: SYBSc (CDS)).

## Algorithm used

**Bubble Sort** (sorting algorithm).

Bubble Sort compares two neighbouring elements at a time. If the left
element is greater than the right one they are swapped, otherwise they
stay as they are. After each complete pass the largest remaining element
"bubbles up" to its correct position at the end of the list. The passes
repeat until a pass needs no swaps at all.

## How to run

```bash
python bubble_sort_game.py
```

Only Python 3 is needed — no extra library has to be installed.

## How to play

The game shows a shuffled list of numbers and points (`^^^`) at the two
numbers that Bubble Sort is currently comparing. For every comparison the
player decides the move:

| Key | Meaning |
|-----|---------|
| `S` | Swap — the left number is greater than the right number |
| `K` | Keep — the two numbers are already in the correct order |
| `H` | Hint (costs 5 points) |
| `Q` | Quit the game |

The game then performs the correct action itself, so the list always
follows the real algorithm and the player can see each step.

## Scoring system

| Action | Score |
|--------|-------|
| Correct move | +10 points |
| 3 or more correct moves in a row | +15 points (streak bonus) |
| Wrong move | −5 points **and one life** |
| Hint used | −5 points |
| Level completed | +20 × level number |

The player starts with **3 lives**. Losing all three lives ends the game.

## Levels

| Level | Numbers | Range |
|-------|---------|-------|
| 1 – Easy | 4 | 1 – 20 |
| 2 – Medium | 6 | 1 – 50 |
| 3 – Hard | 8 | 1 – 99 |

Clearing all three levels wins the game. After every game the final
score, the result and the best score are displayed, and a
**Play Again** option is offered.

## Features covered from the activity instructions

- One algorithm selected from the given list (Bubble Sort)
- Interactive, user-friendly text interface with a visual list of boxes
- Clear objective: sort the list by applying the algorithm yourself
- Player must *apply* the algorithm, the code is not just displayed
- Scoring system with bonuses and penalties
- Three levels of increasing difficulty
- Immediate feedback with the reason for every correct/wrong move
- Algorithm name and explanation displayed inside the game
- Restart / Play Again option
- Clear win, lose and level-completed messages
- Structured, readable and commented source code

## File structure

```
bubble-sort-game/
├── bubble_sort_game.py   # complete game (single file)
└── README.md             # this file
```

Sections inside `bubble_sort_game.py`:

1. Game settings (points, lives, level table)
2. Helper functions for printing and drawing the list
3. Input function with validation
4. `play_level()` – one full Bubble Sort played by the user
5. `play_game()` – all levels, win / game-over handling
6. `main()` – menu, final score and Play Again option
