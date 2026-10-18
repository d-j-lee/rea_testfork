// Unified input: keyboard + mouse, touch (virtual stick and buttons are fed
// in by the touch UI through setVirtual*), and the standard Gamepad mapping.
// The game samples `state()` once per frame.

export interface InputState {
  mx: number;
  my: number;
  attack: boolean;
  shoot: boolean;
  dodge: boolean;
  /** Skill pressed since the last sample: 1-4 slots, 5 = 노인성 일섬, 0 none. */
  skill: number;
  /** Interact pressed since the last sample. */
  interact: boolean;
  /** Aim offset in screen px from the player (mouse), if any. */
  aim: { x: number; y: number } | null;
}

export type UiCommand =
  | "chat"
  | "character"
  | "inventory"
  | "map"
  | "nation"
  | "chronicle"
  | "help"
  | "menu"
  | "mute";

const KEY_COMMANDS: Readonly<Record<string, UiCommand>> = {
  Enter: "chat",
  KeyC: "character",
  KeyI: "inventory",
  KeyM: "map",
  KeyN: "nation",
  // T = 연대기 (chronicle); L stays a dodge key next to Shift.
  KeyT: "chronicle",
  F1: "help",
  Slash: "help",
  Escape: "menu",
  KeyO: "mute",
};

export class Input {
  readonly #down = new Set<string>();
  #skill = 0;
  #interact = false;
  #mouseAttack = false;
  #mouseShoot = false;
  #mouse: { x: number; y: number } | null = null;
  #virtualMove = { x: 0, y: 0 };
  readonly #virtualButtons = new Set<"attack" | "shoot" | "dodge">();
  #enabled = true;
  readonly #commandHandlers: ((command: UiCommand) => void)[] = [];
  /** Screen position of the player, used to turn the mouse into aim. */
  playerScreen = { x: 0, y: 0 };

  constructor(target: HTMLElement) {
    window.addEventListener("keydown", (event) => this.#onKey(event, true));
    window.addEventListener("keyup", (event) => this.#onKey(event, false));
    window.addEventListener("blur", () => this.reset());
    target.addEventListener("contextmenu", (event) => event.preventDefault());
    target.addEventListener("mousedown", (event) => {
      if (!this.#enabled) return;
      if (event.button === 0) this.#mouseAttack = true;
      if (event.button === 2) this.#mouseShoot = true;
      this.#mouse = { x: event.clientX, y: event.clientY };
    });
    window.addEventListener("mouseup", (event) => {
      if (event.button === 0) this.#mouseAttack = false;
      if (event.button === 2) this.#mouseShoot = false;
    });
    target.addEventListener("mousemove", (event) => {
      this.#mouse = { x: event.clientX, y: event.clientY };
    });
    target.addEventListener("mouseleave", () => {
      this.#mouse = null;
    });
  }

  /** While typing in chat or a dialog has focus, gameplay keys are ignored. */
  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    if (!enabled) this.reset();
  }

  onCommand(handler: (command: UiCommand) => void): void {
    this.#commandHandlers.push(handler);
  }

  setVirtualMove(x: number, y: number): void {
    this.#virtualMove = { x, y };
  }

  setVirtualButton(button: "attack" | "shoot" | "dodge", held: boolean): void {
    if (held) this.#virtualButtons.add(button);
    else this.#virtualButtons.delete(button);
  }

  pressSkill(slot: number): void {
    this.#skill = slot;
  }

  pressInteract(): void {
    this.#interact = true;
  }

  reset(): void {
    this.#down.clear();
    this.#mouseAttack = false;
    this.#mouseShoot = false;
    this.#virtualButtons.clear();
    this.#virtualMove = { x: 0, y: 0 };
  }

  #onKey(event: KeyboardEvent, down: boolean): void {
    const typing =
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement;
    if (typing) return;
    if (down && !event.repeat) {
      const command = KEY_COMMANDS[event.code];
      if (command) {
        if (command !== "menu" || this.#enabled) event.preventDefault();
        for (const handler of this.#commandHandlers) handler(command);
        return;
      }
    }
    if (!this.#enabled) return;
    if (down) {
      // Skills and interact are presses, not holds: keyboard auto-repeat
      // must not re-fire them (each press is sent to the host at once).
      if (!event.repeat) {
        // 1-4: skill slots; 5 (or R): 노인성 일섬.
        if (/^Digit[1-5]$/.test(event.code))
          this.#skill = Number(event.code.slice(5));
        else if (/^Numpad[1-5]$/.test(event.code))
          this.#skill = Number(event.code.slice(6));
        else if (event.code === "KeyR") this.#skill = 5;
        if (event.code === "KeyE" || event.code === "KeyF") this.#interact = true;
      }
      this.#down.add(event.code);
    } else this.#down.delete(event.code);
    if (
      ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
        event.code,
      )
    )
      event.preventDefault();
  }

  state(): InputState {
    const key = (...codes: string[]) =>
      codes.some((code) => this.#down.has(code));
    let mx =
      (key("KeyD", "ArrowRight") ? 1 : 0) - (key("KeyA", "ArrowLeft") ? 1 : 0);
    let my =
      (key("KeyS", "ArrowDown") ? 1 : 0) - (key("KeyW", "ArrowUp") ? 1 : 0);
    let attack =
      key("KeyJ", "Space") ||
      this.#mouseAttack ||
      this.#virtualButtons.has("attack");
    let shoot =
      key("KeyK") || this.#mouseShoot || this.#virtualButtons.has("shoot");
    let dodge =
      key("ShiftLeft", "ShiftRight", "KeyL") ||
      this.#virtualButtons.has("dodge");
    let skill = this.#skill;
    let interact = this.#interact;
    if (this.#virtualMove.x !== 0 || this.#virtualMove.y !== 0) {
      mx = this.#virtualMove.x;
      my = this.#virtualMove.y;
    }
    const pad = this.#enabled ? readGamepad() : null;
    if (pad) {
      if (Math.hypot(pad.x, pad.y) > 0.2) {
        mx = pad.x;
        my = pad.y;
      }
      attack ||= pad.attack;
      shoot ||= pad.shoot;
      dodge ||= pad.dodge;
      interact ||= pad.interact;
      skill ||= pad.skill;
    }
    const length = Math.hypot(mx, my);
    if (length > 1) {
      mx /= length;
      my /= length;
    }
    this.#skill = 0;
    this.#interact = false;
    const aim =
      this.#mouse && (this.#mouseAttack || this.#mouseShoot)
        ? {
            x: this.#mouse.x - this.playerScreen.x,
            y: this.#mouse.y - this.playerScreen.y,
          }
        : null;
    if (!this.#enabled)
      return {
        mx: 0,
        my: 0,
        attack: false,
        shoot: false,
        dodge: false,
        skill: 0,
        interact: false,
        aim: null,
      };
    return { mx, my, attack, shoot, dodge, skill, interact, aim };
  }
}

const padEdges = new Map<number, boolean>();
function readGamepad(): {
  x: number;
  y: number;
  attack: boolean;
  shoot: boolean;
  dodge: boolean;
  interact: boolean;
  skill: number;
} | null {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return null;
  const pad = [...navigator.getGamepads()].find(
    (candidate) => candidate?.connected,
  );
  if (!pad) return null;
  const pressed = (index: number) => pad.buttons[index]?.pressed ?? false;
  const edge = (index: number) => {
    const now = pressed(index);
    const before = padEdges.get(index) ?? false;
    padEdges.set(index, now);
    return now && !before;
  };
  let skill = 0;
  [4, 5, 6, 7].forEach((button, slot) => {
    if (edge(button)) skill = slot + 1;
  });
  return {
    x: pad.axes[0] ?? 0,
    y: pad.axes[1] ?? 0,
    attack: pressed(0),
    shoot: pressed(2),
    dodge: pressed(1),
    interact: edge(3),
    skill,
  };
}
