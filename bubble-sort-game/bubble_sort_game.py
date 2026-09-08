"""
=============================================================
  BUBBLE SORT BATTLE - An Algorithm Based Educational Game
=============================================================

Subject : Data Structures and Algorithm
Class   : SYBSc (CDS)
Activity: I - Develop an Algorithm-Based Educational Game
Algorithm chosen : BUBBLE SORT (Sorting Algorithm)

HOW THE GAME WORKS
------------------
The computer gives the player a shuffled list of numbers.
The game then walks through the list exactly the way Bubble Sort
does, and at every comparison the PLAYER must decide the move:

        SWAP  -> if the left number is greater than the right one
        KEEP  -> if the two numbers are already in correct order

So the player is not just watching the algorithm, the player IS
the algorithm. Correct moves earn points, wrong moves cost a life.

Requires only Python 3 (no external library). Run with:

        python bubble_sort_game.py
=============================================================
"""

import random

# -------------------------------------------------------------
# GAME SETTINGS (change these numbers to make the game easier
# or harder - they are kept in one place on purpose)
# -------------------------------------------------------------
POINTS_CORRECT = 10      # points earned for one correct decision
POINTS_WRONG = 5         # points lost for one wrong decision
HINT_COST = 5            # points lost when the player asks for a hint
STARTING_LIVES = 3       # wrong moves allowed before the game is over
LEVEL_BONUS = 20         # bonus = LEVEL_BONUS * level number

# Level design: (level number, how many numbers, largest number)
LEVELS = [
    (1, 4, 20),          # Level 1 - Easy    : 4 small numbers
    (2, 6, 50),          # Level 2 - Medium  : 6 numbers
    (3, 8, 99),          # Level 3 - Hard    : 8 numbers
]


# -------------------------------------------------------------
# SECTION 1 : SMALL HELPER FUNCTIONS (screen / printing)
# -------------------------------------------------------------
def line(character="=", width=61):
    """Print a horizontal line, used to make the screen readable."""
    print(character * width)


def title(text):
    """Print a heading inside a box."""
    line()
    print(text.center(61))
    line()


def show_algorithm_info():
    """
    Requirement: the game must display the algorithm name and a
    brief explanation of it inside the game itself.
    """
    title("ALGORITHM : BUBBLE SORT")
    print("Bubble Sort compares two NEIGHBOURING elements at a time.")
    print("If the left element is GREATER than the right element they")
    print("are swapped, otherwise they are left as they are. After")
    print("one complete pass the largest remaining element has moved")
    print("(bubbled up) to its correct place at the end of the list.")
    print("The passes are repeated until no swap is needed any more.")
    print()
    print("RULE YOU MUST FOLLOW IN THIS GAME:")
    print("    left > right  ->  SWAP  (press S)")
    print("    left <= right ->  KEEP  (press K)")
    line("-")
    print()


def draw_array(numbers, left_index, right_index, locked_from):
    """
    Draw the list of numbers on the screen.

    numbers      : the current list
    left_index   : index of the first number being compared
    right_index  : index of the second number being compared
    locked_from  : elements from this index onwards are already
                   sorted (they are shown with a lock symbol)
    """
    boxes = ""      # the row that shows the numbers
    marks = ""      # the row that shows which pair is compared

    for index, value in enumerate(numbers):
        if index >= locked_from:
            boxes += "[{:>3}]*".format(value)     # * = already sorted
        else:
            boxes += "[{:>3}] ".format(value)

        if index == left_index or index == right_index:
            marks += "  ^^^ "                      # points to the pair
        else:
            marks += "      "

    print("   " + boxes)
    print("   " + marks)
    print("   (* = already in its final sorted position)")


# -------------------------------------------------------------
# SECTION 2 : INPUT FUNCTION
# -------------------------------------------------------------
def ask_player_move():
    """
    Ask the player for a move and keep asking until the answer is
    valid. Returns one of: 'S', 'K', 'H' (hint) or 'Q' (quit).
    """
    while True:
        answer = input("   Your move  [S]wap / [K]eep / [H]int / [Q]uit : ")
        answer = answer.strip().upper()
        if answer in ("S", "K", "H", "Q"):
            return answer
        print("   !! Invalid input. Please type S, K, H or Q.")


# -------------------------------------------------------------
# SECTION 3 : ONE LEVEL OF THE GAME
# -------------------------------------------------------------
def play_level(level_number, size, biggest_number, score, lives):
    """
    Play one complete level (one full Bubble Sort done by the player).

    Returns a tuple (score, lives, finished) where 'finished' is
    True only if the player sorted the list without losing all
    lives and without quitting.
    """
    # Create a random list of different numbers and shuffle it
    numbers = random.sample(range(1, biggest_number + 1), size)

    title("LEVEL {}  -  {} NUMBERS".format(level_number, size))
    print("Sort the list in ASCENDING order using Bubble Sort rules.")
    print("Score: {}    Lives: {}".format(score, "@" * lives))
    line("-")

    total_elements = len(numbers)
    streak = 0          # number of correct answers one after another

    # ---- OUTER LOOP : one repetition = one pass of Bubble Sort ----
    for pass_number in range(total_elements - 1):

        swapped_in_this_pass = False
        # elements at the end that are already sorted
        locked_from = total_elements - pass_number

        print()
        print(">>> PASS {} of {}".format(pass_number + 1, total_elements - 1))

        # ---- INNER LOOP : compare every neighbouring pair ----
        for j in range(total_elements - 1 - pass_number):

            print()
            draw_array(numbers, j, j + 1, locked_from)
            print("   Comparing  {}  and  {}".format(numbers[j], numbers[j + 1]))

            # What does Bubble Sort actually say here?
            correct_move = "S" if numbers[j] > numbers[j + 1] else "K"

            move = ask_player_move()

            # ---- player wants to quit ----
            if move == "Q":
                print("\n   You left the game. See you next time!")
                return score, lives, False

            # ---- player asks for a hint (only the first one costs) ----
            hint_already_used = False
            while move == "H":
                if hint_already_used:
                    print("   You already used the hint for this pair.")
                else:
                    score -= HINT_COST
                    streak = 0
                    hint_already_used = True
                    print("   HINT: Is {} greater than {} ? If yes -> SWAP, "
                          "if no -> KEEP.  (-{} points)"
                          .format(numbers[j], numbers[j + 1], HINT_COST))
                move = ask_player_move()

            # ---- player wants to quit after taking a hint ----
            if move == "Q":
                print("\n   You left the game. See you next time!")
                return score, lives, False

            # ---- check the player's decision : immediate feedback ----
            if move == correct_move:
                streak += 1
                earned = POINTS_CORRECT + (5 if streak >= 3 else 0)
                score += earned
                if streak >= 3:
                    print("   CORRECT! +{} points  (streak bonus x{})"
                          .format(earned, streak))
                else:
                    print("   CORRECT! +{} points".format(earned))
            else:
                streak = 0
                score -= POINTS_WRONG
                lives -= 1
                if correct_move == "S":
                    reason = "{} is GREATER than {}, so they must be swapped."\
                             .format(numbers[j], numbers[j + 1])
                else:
                    reason = "{} is NOT greater than {}, so they stay as "\
                             "they are.".format(numbers[j], numbers[j + 1])
                print("   WRONG! -{} points and one life lost."
                      .format(POINTS_WRONG))
                print("   Why: " + reason)

                if lives == 0:
                    return score, lives, False

            # ---- the algorithm always performs the correct action ----
            if correct_move == "S":
                numbers[j], numbers[j + 1] = numbers[j + 1], numbers[j]
                swapped_in_this_pass = True

            print("   List now : {}".format(numbers))
            print("   Score: {}    Lives: {}".format(score, "@" * lives))

        # ---- Bubble Sort improvement : stop early if nothing swapped ----
        if not swapped_in_this_pass:
            print()
            print("   No swap was needed in this whole pass, so the list is")
            print("   already sorted. Bubble Sort stops here (early exit).")
            break

    # ---- the level is completed ----
    bonus = LEVEL_BONUS * level_number
    score += bonus
    print()
    line("-")
    print("   SORTED LIST : {}".format(numbers))
    print("   LEVEL {} COMPLETED!  Level bonus +{} points".format(
        level_number, bonus))
    line("-")
    return score, lives, True


# -------------------------------------------------------------
# SECTION 4 : ONE FULL GAME (all the levels)
# -------------------------------------------------------------
def play_game():
    """Play all levels one after another and return the final score."""
    score = 0
    lives = STARTING_LIVES

    for level_number, size, biggest_number in LEVELS:
        score, lives, finished = play_level(
            level_number, size, biggest_number, score, lives)

        if not finished:
            # The player either lost all lives or quit the game
            if lives == 0:
                title("GAME OVER - ALL LIVES LOST")
                print("You were on Level {}.".format(level_number))
                print("Tip: always compare only the two marked numbers.")
            return score, False

        if level_number != LEVELS[-1][0]:
            input("\n   Press ENTER to start the next level...")

    # If the loop finished, every level was cleared
    title("CONGRATULATIONS - YOU WON THE GAME!")
    print("You correctly played Bubble Sort on all {} levels."
          .format(len(LEVELS)))
    return score, True


# -------------------------------------------------------------
# SECTION 5 : MAIN PROGRAM (menu + play again option)
# -------------------------------------------------------------
def main():
    best_score = 0

    title("WELCOME TO  ' BUBBLE SORT BATTLE '")
    print("An educational game on the Bubble Sort algorithm.")
    print()

    playing = True
    while playing:
        show_algorithm_info()
        input("Press ENTER to start the game...")

        score, won = play_game()

        if score > best_score:
            best_score = score

        title("FINAL SCORE : {}".format(score))
        print("Result      : {}".format("WON" if won else "NOT COMPLETED"))
        print("Best score  : {}".format(best_score))

        # ---- Restart / Play Again option ----
        again = input("\nDo you want to play again? (Y/N) : ").strip().upper()
        if again != "Y":
            playing = False

    title("THANK YOU FOR PLAYING!")


# The program starts here
if __name__ == "__main__":
    main()
