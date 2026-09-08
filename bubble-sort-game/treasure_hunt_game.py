"""
=================================================================
   TREASURE HUNT  -  A Binary Search Game  (graphical version)
=================================================================

Subject : Data Structures and Algorithm
Class   : SYBSc (CDS)
Activity: I - Develop an Algorithm-Based Educational Game
Algorithm chosen : BINARY SEARCH (Searching Algorithm)

THE STORY
---------
A row of locked treasure chests is buried on the island. The chests
are buried in INCREASING ORDER of the number written inside them.
Only one chest holds the diamond and the map tells you its number.

You may open only a few chests before the tide comes in, so opening
them one by one will never work. Every chest you open shouts
"TOO LOW!" or "TOO HIGH!", and that answer throws away half of the
island at once - this is exactly BINARY SEARCH.

Open the MIDDLE chest of the glowing area every time and you can
find the diamond among 32 chests in only 5 or 6 moves.

This game uses tkinter, which already comes with Python.
Run it with:

        python treasure_hunt_game.py
=================================================================
"""

import random
import tkinter as tk

# -----------------------------------------------------------------
# SECTION 1 : SETTINGS - colours, sizes and level design
# -----------------------------------------------------------------
COLOUR_BACKGROUND = "#0d2b3e"       # deep sea blue
COLOUR_PANEL = "#12405c"            # lighter blue for the panels
COLOUR_TEXT = "#eaf4fb"             # almost white
COLOUR_TEXT_DIM = "#9fc0d4"         # dim text for explanations
COLOUR_CHEST = "#e0a531"            # closed chest - gold
COLOUR_CHEST_DARK = "#a8761c"       # the lid of the chest
COLOUR_GLOW = "#1d5f85"             # background of the active area
COLOUR_LOW = "#3f7fbf"              # opened chest, number too low
COLOUR_HIGH = "#b0504f"             # opened chest, number too high
COLOUR_FOUND = "#3ec46d"            # the chest with the diamond
COLOUR_DEAD = "#22394a"             # chest thrown away by the algorithm
COLOUR_HINT = "#f6e05e"             # colour used to show the hint

CHEST_WIDTH = 96                    # size of one chest on the screen
CHEST_HEIGHT = 78
CHEST_GAP = 10
CHESTS_PER_ROW = 8

# Level design : (level number, how many chests, how many moves allowed)
LEVELS = [
    (1, 8, 4),
    (2, 16, 5),
    (3, 24, 6),
    (4, 32, 6),
]

POINTS_LEVEL = 100                  # for completing a level
POINTS_PER_SAVED_MOVE = 20          # for every move not used
POINTS_PERFECT_SPLIT = 10           # for opening the exact middle chest
POINTS_PERFECT_LEVEL = 50           # for a level played fully correctly
HINT_COST = 25                      # points lost when a hint is used
OVERLAY_DELAY = 900                 # milliseconds before the result panel
MIN_BOARD_HEIGHT = 210              # keeps room for the result panel


# -----------------------------------------------------------------
# SECTION 2 : THE ALGORITHM PART (kept separate so it is easy to read)
# -----------------------------------------------------------------
def middle_index(low, high):
    """The index Binary Search would look at: the middle of the range."""
    return (low + high) // 2


def new_range(low, high, opened_index, opened_value, target):
    """
    This is the heart of Binary Search.

    A chest at 'opened_index' was opened and its number is
    'opened_value'. Compare it with the target and return the part of
    the row that is still worth searching.

        number too small -> the diamond must be on the RIGHT side
        number too big   -> the diamond must be on the LEFT side

    Returns the new (low, high) pair.
    """
    if opened_value < target:
        return opened_index + 1, high        # throw away the left half
    else:
        return low, opened_index - 1         # throw away the right half


# -----------------------------------------------------------------
# SECTION 3 : THE GAME WINDOW
# -----------------------------------------------------------------
class TreasureHuntGame:

    def __init__(self, window):
        self.window = window
        self.window.title("Treasure Hunt - A Binary Search Game")
        self.window.configure(bg=COLOUR_BACKGROUND)
        self.window.resizable(False, False)

        self.build_screen()
        self.start_new_game()

    # -------------------------------------------------------------
    # 3.1  Build all the parts of the screen once
    # -------------------------------------------------------------
    def build_screen(self):
        # ---- title and the explanation of the algorithm ----
        header = tk.Frame(self.window, bg=COLOUR_PANEL)
        header.pack(fill="x")

        tk.Label(header, text="TREASURE  HUNT", bg=COLOUR_PANEL,
                 fg=COLOUR_CHEST, font=("Segoe UI", 22, "bold")
                 ).pack(pady=(10, 0))

        tk.Label(header, text="Algorithm used :  BINARY  SEARCH",
                 bg=COLOUR_PANEL, fg=COLOUR_TEXT,
                 font=("Segoe UI", 12, "bold")).pack()

        tk.Label(header,
                 text="The chests are buried in increasing order. Open the "
                      "MIDDLE chest of the glowing area:\nthe answer TOO LOW "
                      "or TOO HIGH throws away half of the remaining chests "
                      "in a single move.",
                 bg=COLOUR_PANEL, fg=COLOUR_TEXT_DIM,
                 font=("Segoe UI", 10), justify="center").pack(pady=(2, 10))

        # ---- score board ----
        self.hud = tk.Label(self.window, bg=COLOUR_BACKGROUND, fg=COLOUR_TEXT,
                            font=("Segoe UI", 13, "bold"))
        self.hud.pack(pady=(8, 0))

        # ---- the mission (which number to look for) ----
        self.mission = tk.Label(self.window, bg=COLOUR_BACKGROUND,
                                fg=COLOUR_CHEST,
                                font=("Segoe UI", 16, "bold"))
        self.mission.pack(pady=(4, 6))

        # ---- the island : all the chests are drawn here ----
        board_width = CHESTS_PER_ROW * (CHEST_WIDTH + CHEST_GAP) + CHEST_GAP
        board_height = 4 * (CHEST_HEIGHT + CHEST_GAP) + CHEST_GAP
        self.canvas = tk.Canvas(self.window, width=board_width,
                                height=board_height, bg=COLOUR_BACKGROUND,
                                highlightthickness=0)
        self.canvas.pack(padx=14)
        self.canvas.bind("<Button-1>", self.on_click)
        self.canvas.bind("<Motion>", self.on_mouse_move)
        self.board_height = board_height
        self.chest_ids = {}          # chest number -> its shapes on screen
        self.hovered = None          # chest the mouse is resting on

        # ---- feedback line ----
        self.message = tk.Label(self.window, bg=COLOUR_BACKGROUND,
                                fg=COLOUR_TEXT, font=("Segoe UI", 12, "bold"))
        self.message.pack(pady=(6, 0))

        self.range_label = tk.Label(self.window, bg=COLOUR_BACKGROUND,
                                    fg=COLOUR_TEXT_DIM,
                                    font=("Segoe UI", 10))
        self.range_label.pack()

        # ---- buttons ----
        buttons = tk.Frame(self.window, bg=COLOUR_BACKGROUND)
        buttons.pack(pady=10)

        self.hint_button = tk.Button(
            buttons, text="HINT  (-{} points)".format(HINT_COST),
            command=self.show_hint, width=18, relief="flat",
            bg=COLOUR_PANEL, fg=COLOUR_TEXT, activebackground=COLOUR_GLOW,
            font=("Segoe UI", 10, "bold"), cursor="hand2")
        self.hint_button.grid(row=0, column=0, padx=6)

        tk.Button(buttons, text="RESTART  GAME", command=self.start_new_game,
                  width=18, relief="flat", bg=COLOUR_PANEL, fg=COLOUR_TEXT,
                  activebackground=COLOUR_GLOW, font=("Segoe UI", 10, "bold"),
                  cursor="hand2").grid(row=0, column=1, padx=6)

        tk.Button(buttons, text="QUIT", command=self.window.destroy,
                  width=12, relief="flat", bg=COLOUR_PANEL, fg=COLOUR_TEXT,
                  activebackground=COLOUR_HIGH, font=("Segoe UI", 10, "bold"),
                  cursor="hand2").grid(row=0, column=2, padx=6)

    # -------------------------------------------------------------
    # 3.2  Starting a new game and a new level
    # -------------------------------------------------------------
    def start_new_game(self):
        self.score = 0
        self.level_position = 0          # which entry of LEVELS we are on
        self.game_over = False
        self.start_level()

    def start_level(self):
        self.level, chest_count, self.moves_allowed = \
            LEVELS[self.level_position]

        # Numbers inside the chests: random but SORTED, because Binary
        # Search only works on sorted data.
        self.numbers = sorted(random.sample(range(10, 100), chest_count))
        self.target = random.choice(self.numbers)

        self.low = 0                     # first chest still in the game
        self.high = chest_count - 1      # last chest still in the game
        self.moves_left = self.moves_allowed
        self.state = ["closed"] * chest_count    # state of every chest
        self.perfect_level = True        # did the player always pick middle?
        self.hint_index = None
        self.level_finished = False
        self.hovered = None

        # make the island exactly as tall as this level needs
        rows_used = (chest_count + CHESTS_PER_ROW - 1) // CHESTS_PER_ROW
        self.board_height = max(rows_used * (CHEST_HEIGHT + CHEST_GAP)
                                + CHEST_GAP, MIN_BOARD_HEIGHT)
        self.canvas.config(height=self.board_height)

        self.mission.config(
            text="MISSION :  find the chest holding  {}".format(self.target))
        self.message.config(text="Level {} started - open the middle chest "
                                 "of the glowing area.".format(self.level),
                            fg=COLOUR_TEXT)
        self.hint_button.config(state="normal")
        self.draw_board()
        self.update_hud()

    # -------------------------------------------------------------
    # 3.3  Drawing
    # -------------------------------------------------------------
    def chest_position(self, index):
        """Return the top-left corner (x, y) of the chest on the screen."""
        row = index // CHESTS_PER_ROW
        column = index % CHESTS_PER_ROW

        # how many rows does this level need, and where do they start
        rows_used = (len(self.numbers) + CHESTS_PER_ROW - 1) // CHESTS_PER_ROW
        used_height = rows_used * (CHEST_HEIGHT + CHEST_GAP) - CHEST_GAP
        top = (self.board_height - used_height) / 2

        x = CHEST_GAP + column * (CHEST_WIDTH + CHEST_GAP)
        y = top + row * (CHEST_HEIGHT + CHEST_GAP)
        return x, y

    def draw_board(self):
        """Draw every chest according to its current state."""
        self.canvas.delete("all")
        self.chest_ids = {}

        for index in range(len(self.numbers)):
            x, y = self.chest_position(index)
            state = self.state[index]

            # ---- the glowing area = the part still being searched ----
            if state == "closed" and self.low <= index <= self.high:
                self.canvas.create_rectangle(
                    x - 4, y - 4, x + CHEST_WIDTH + 4, y + CHEST_HEIGHT + 4,
                    fill=COLOUR_GLOW, outline="")

            # ---- choose the colour for this chest ----
            if state == "closed":
                body, lid = COLOUR_CHEST, COLOUR_CHEST_DARK
                label = "?"
            elif state == "low":
                body, lid = COLOUR_LOW, COLOUR_LOW
                label = str(self.numbers[index])
            elif state == "high":
                body, lid = COLOUR_HIGH, COLOUR_HIGH
                label = str(self.numbers[index])
            elif state == "found":
                body, lid = COLOUR_FOUND, COLOUR_FOUND
                label = str(self.numbers[index])
            else:                                    # "dead"
                body, lid = COLOUR_DEAD, COLOUR_DEAD
                label = "x"

            # the hint paints a border around the correct middle chest
            border = COLOUR_HINT if index == self.hint_index else "#08202e"

            # ---- the chest itself : a box with a lid ----
            body_id = self.canvas.create_rectangle(
                x, y, x + CHEST_WIDTH, y + CHEST_HEIGHT,
                fill=body, outline=border, width=3)
            lid_id = self.canvas.create_rectangle(
                x, y, x + CHEST_WIDTH, y + 22,
                fill=lid, outline=border, width=3)
            self.chest_ids[index] = (body_id, lid_id, border)

            text_colour = "#123" if state == "closed" else COLOUR_TEXT
            self.canvas.create_text(x + CHEST_WIDTH / 2, y + 50, text=label,
                                    fill=text_colour,
                                    font=("Segoe UI", 20, "bold"))

            # small number of the chest position (1, 2, 3 ...)
            self.canvas.create_text(x + CHEST_WIDTH / 2, y + 12,
                                    text=str(index + 1), fill="#f7e7c4",
                                    font=("Segoe UI", 9, "bold"))

        self.show_range()

    def show_range(self):
        """Write how many chests are still left to search."""
        if self.level_finished:
            return
        remaining = self.high - self.low + 1
        self.range_label.config(
            text="Still searching chests {} to {}   ({} chests left)"
                 .format(self.low + 1, self.high + 1, remaining))

    def update_hud(self):
        self.hud.config(text="LEVEL {} / {}      SCORE {}      MOVES LEFT {}"
                             .format(self.level, len(LEVELS), self.score,
                                     self.moves_left))

    # -------------------------------------------------------------
    # 3.4  What happens when the player clicks a chest
    # -------------------------------------------------------------
    def chest_at(self, point_x, point_y):
        """Which chest is at this point on the screen? None if no chest."""
        for index in range(len(self.numbers)):
            x, y = self.chest_position(index)
            if x <= point_x <= x + CHEST_WIDTH and \
               y <= point_y <= y + CHEST_HEIGHT:
                return index
        return None

    def on_click(self, event):
        """Convert the mouse position into a chest number, then open it."""
        index = self.chest_at(event.x, event.y)
        if index is not None:
            self.open_chest(index)

    def on_mouse_move(self, event):
        """Light up the chest under the mouse so the board feels alive."""
        index = self.chest_at(event.x, event.y)

        # a chest can only be highlighted while it can still be opened
        if index is not None and (self.state[index] != "closed" or
                                  not self.low <= index <= self.high or
                                  self.level_finished or self.game_over):
            index = None

        if index == self.hovered:
            return

        self.paint_border(self.hovered, hovering=False)
        self.paint_border(index, hovering=True)
        self.hovered = index
        self.canvas.config(cursor="hand2" if index is not None else "")

    def paint_border(self, index, hovering):
        """Change only the border colour of one chest (no full redraw)."""
        if index is None or index not in self.chest_ids:
            return
        body_id, lid_id, normal_border = self.chest_ids[index]
        colour = COLOUR_TEXT if hovering else normal_border
        for shape in (body_id, lid_id):
            self.canvas.itemconfig(shape, outline=colour)

    def open_chest(self, index):
        """Open one chest and let Binary Search cut the row in half."""
        if self.game_over or self.level_finished:
            return

        # A chest that is already gone cannot be opened again
        if self.state[index] != "closed":
            self.message.config(text="That chest is already out of the game!",
                                fg=COLOUR_HINT)
            return
        if not (self.low <= index <= self.high):
            self.message.config(
                text="The algorithm already threw that chest away - it "
                     "cannot hold the diamond.", fg=COLOUR_HINT)
            return

        self.hint_index = None
        self.moves_left -= 1
        value = self.numbers[index]

        # ---- did the player open the exact middle chest? ----
        was_middle = (index == middle_index(self.low, self.high))
        if was_middle:
            self.score += POINTS_PERFECT_SPLIT
        else:
            self.perfect_level = False

        # ---- FOUND IT ----
        if value == self.target:
            self.state[index] = "found"
            self.finish_level()
            return

        # ---- not found : mark the chest and cut the row ----
        self.state[index] = "low" if value < self.target else "high"
        old_low, old_high = self.low, self.high
        self.low, self.high = new_range(self.low, self.high, index, value,
                                        self.target)

        # every chest that fell out of the range is now dead
        thrown_away = 0
        for i in range(old_low, old_high + 1):
            if not (self.low <= i <= self.high) and self.state[i] == "closed":
                self.state[i] = "dead"
                thrown_away += 1

        if value < self.target:
            text = "TOO LOW!  {} is smaller than {}  ->  {} chests thrown " \
                   "away.".format(value, self.target, thrown_away)
        else:
            text = "TOO HIGH!  {} is bigger than {}  ->  {} chests thrown " \
                   "away.".format(value, self.target, thrown_away)
        if was_middle:
            text += "   PERFECT SPLIT +{}".format(POINTS_PERFECT_SPLIT)

        self.message.config(text=text,
                            fg=COLOUR_LOW if value < self.target
                            else COLOUR_HIGH)

        self.draw_board()
        self.update_hud()

        # ---- out of moves : the tide comes in ----
        if self.moves_left == 0:
            self.end_game(False)

    # -------------------------------------------------------------
    # 3.5  Level finished / game finished
    # -------------------------------------------------------------
    def finish_level(self):
        self.level_finished = True

        saved = self.moves_left * POINTS_PER_SAVED_MOVE
        self.score += POINTS_LEVEL + saved
        bonus_text = ""
        if self.perfect_level:
            self.score += POINTS_PERFECT_LEVEL
            bonus_text = "  PERFECT BINARY SEARCH +{}!".format(
                POINTS_PERFECT_LEVEL)

        self.draw_board()
        self.update_hud()
        self.message.config(
            text="DIAMOND FOUND!  Level bonus +{}, saved moves +{}.{}"
                 .format(POINTS_LEVEL, saved, bonus_text), fg=COLOUR_FOUND)
        self.range_label.config(text="")
        self.hint_button.config(state="disabled")

        # wait a moment before covering the board, so the player can
        # actually see the green chest that held the diamond
        if self.level_position == len(LEVELS) - 1:
            self.window.after(OVERLAY_DELAY, lambda: self.end_game(True))
        else:
            self.window.after(OVERLAY_DELAY, lambda: self.show_overlay(
                "LEVEL {} CLEARED".format(self.level),
                "Score so far : {}".format(self.score),
                "NEXT LEVEL", self.next_level))

    def next_level(self):
        self.level_position += 1
        self.start_level()

    def end_game(self, player_won):
        self.game_over = True
        self.hint_button.config(state="disabled")

        if player_won:
            self.show_overlay("YOU WIN!",
                              "All {} levels cleared.   Final score : {}"
                              .format(len(LEVELS), self.score),
                              "PLAY AGAIN", self.start_new_game)
        else:
            # reveal where the diamond really was
            self.state[self.numbers.index(self.target)] = "found"
            self.level_finished = True
            self.draw_board()
            self.range_label.config(text="")
            self.message.config(
                text="OUT OF MOVES!  The diamond was in chest {} "
                     "(shown in green).".format(
                         self.numbers.index(self.target) + 1),
                fg=COLOUR_HIGH)
            self.window.after(OVERLAY_DELAY, lambda: self.show_overlay(
                "GAME OVER - the tide came in",
                "The diamond was in chest {}.   Score : {}"
                .format(self.numbers.index(self.target) + 1, self.score),
                "PLAY AGAIN", self.start_new_game))

    def show_overlay(self, title_text, detail_text, button_text, action):
        """A dark panel in the middle of the island with one button on it."""
        width = int(self.canvas["width"])
        height = int(self.canvas["height"])

        self.canvas.create_rectangle(0, 0, width, height, fill="#000000",
                                     stipple="gray50", outline="",
                                     tags="overlay")
        self.canvas.create_rectangle(width / 2 - 235, height / 2 - 80,
                                     width / 2 + 235, height / 2 + 80,
                                     fill=COLOUR_PANEL, outline=COLOUR_CHEST,
                                     width=3, tags="overlay")
        self.canvas.create_text(width / 2, height / 2 - 42, text=title_text,
                                fill=COLOUR_CHEST,
                                font=("Segoe UI", 20, "bold"), tags="overlay")
        self.canvas.create_text(width / 2, height / 2 - 5, text=detail_text,
                                fill=COLOUR_TEXT, font=("Segoe UI", 12),
                                tags="overlay")

        button = tk.Button(self.canvas, text=button_text, command=action,
                           bg=COLOUR_CHEST, fg="#14202a", relief="flat",
                           font=("Segoe UI", 12, "bold"), width=16,
                           cursor="hand2")
        self.canvas.create_window(width / 2, height / 2 + 45, window=button,
                                  tags="overlay")

    # -------------------------------------------------------------
    # 3.6  Hint
    # -------------------------------------------------------------
    def show_hint(self):
        """Mark the chest that Binary Search would open next."""
        if self.game_over or self.level_finished:
            return
        self.score -= HINT_COST
        self.perfect_level = False
        self.hint_index = middle_index(self.low, self.high)
        self.message.config(
            text="HINT : Binary Search would open chest number {} "
                 "(the middle one).".format(self.hint_index + 1),
            fg=COLOUR_HINT)
        self.draw_board()
        self.update_hud()


# -----------------------------------------------------------------
# SECTION 4 : START THE GAME
# -----------------------------------------------------------------
def main():
    window = tk.Tk()
    TreasureHuntGame(window)
    window.mainloop()


if __name__ == "__main__":
    main()
