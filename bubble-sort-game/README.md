# Bubble Sort Battle

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
