// Pose tables for the paper-doll humanoid: per view, animation, frame and
// attack style, where the hands are, how the weapon is held and how the body
// moves. Coordinates are body-local for the normal build (16 × 24 box, feet
// at y = 23); humanoid.ts adapts them to other builds.

import type { Anim } from "../../shared/sprites.ts";
import type { WeaponKind } from "./costume-types.ts";
import type { EyeState, View } from "./humanoid-head.ts";

export type LegPose =
  | "stand"
  | "walk0"
  | "walk1"
  | "walk2"
  | "walk3"
  | "brace"
  | "lunge"
  | "kneel";

/** Draw layer of the held weapon relative to body parts. */
export type WeaponLayer = "back" | "body" | "top";

export interface Pt {
  x: number;
  y: number;
}

export interface Pose {
  bob: number;
  headDy: number;
  lean: number;
  legs: LegPose;
  /** Weapon (near) hand, top-left of the 2 × 2 hand. */
  near: Pt;
  far: Pt;
  angle: number;
  slide: number;
  scale: number;
  layer: WeaponLayer;
  eyes: EyeState;
  mouth: boolean;
  bowDraw: boolean;
  arrow: boolean;
  flash: boolean;
  hideWeapon: boolean;
  lying: boolean;
}

export type Style = "slash" | "thrust" | "swing" | "shot" | "gun" | "punch";
export type Grip = "blade" | "pole" | "bow" | "gun" | "none";

export function gripOf(w: WeaponKind): Grip {
  switch (w) {
    case "sword":
    case "curved":
    case "longsword":
    case "sabre":
    case "cane":
    case "fan":
    case "warfan":
      return "blade";
    case "spear":
    case "trident":
    case "bamboo":
    case "staff":
    case "monkstaff":
    case "hoe":
      return "pole";
    case "bow":
      return "bow";
    case "musket":
    case "rifle":
      return "gun";
    case "none":
      return "none";
  }
}

export function styleOf(w: WeaponKind): Style {
  switch (gripOf(w)) {
    case "blade":
      return "slash";
    case "pole":
      return w === "staff" || w === "monkstaff" || w === "hoe" ? "swing" : "thrust";
    case "bow":
      return "shot";
    case "gun":
      return "gun";
    case "none":
      return "punch";
  }
}

const p = (x: number, y: number): Pt => ({ x, y });

/** Frames per animation and their durations (ms). */
export const ANIM_FRAMES: Readonly<Record<Anim, readonly number[]>> = {
  idle: [700, 700],
  walk: [130, 130, 130, 130],
  attack: [90, 80, 150],
  shoot: [140, 90, 160],
  cast: [140, 400],
  hurt: [110, 160],
  dead: [160, 1],
};

export const ANIM_LOOPS: Readonly<Record<Anim, boolean>> = {
  idle: true,
  walk: true,
  attack: false,
  shoot: false,
  cast: false,
  hurt: false,
  dead: false,
};

function idlePose(view: View, grip: Grip): Pose {
  const pose: Pose = {
    bob: 0,
    headDy: 0,
    lean: 0,
    legs: "stand",
    near: view === "down" ? p(2, 16) : view === "up" ? p(12, 16) : p(7, 16),
    far: view === "down" ? p(12, 16) : view === "up" ? p(2, 16) : p(6, 16),
    angle: 90,
    slide: 0,
    scale: 1,
    layer: "top",
    eyes: "open",
    mouth: false,
    bowDraw: false,
    arrow: false,
    flash: false,
    hideWeapon: grip === "none",
    lying: false,
  };
  switch (grip) {
    case "blade":
      pose.angle = view === "down" ? 100 : view === "up" ? 80 : 60;
      pose.layer = view === "up" ? "body" : "top";
      break;
    case "pole":
    case "gun":
      pose.near = view === "down" ? p(1, 15) : view === "up" ? p(13, 15) : p(9, 15);
      pose.angle = -90;
      pose.layer = view === "right" ? "body" : "top";
      break;
    case "bow":
      pose.angle = view === "down" ? 180 : view === "up" ? 0 : 0;
      pose.near = view === "right" ? p(8, 15) : pose.near;
      break;
    case "none":
      break;
  }
  return pose;
}

export function poseFor(
  view: View,
  anim: Anim,
  frame: number,
  weapon: WeaponKind,
): Pose {
  const grip = gripOf(weapon);
  const style = styleOf(weapon);
  const pose = idlePose(view, grip);
  switch (anim) {
    case "idle":
      if (frame === 1) pose.headDy = 1;
      return pose;
    case "walk":
      return walkPose(pose, view, frame, grip);
    case "attack":
      return attackPose(pose, view, frame, style === "shot" ? "shot" : style === "gun" ? "thrust" : style);
    case "shoot":
      return attackPose(
        pose,
        view,
        frame,
        style === "shot" || style === "gun" ? style : style === "punch" ? "punch" : style,
      );
    case "cast":
      return castPose(pose, view, frame, grip);
    case "hurt":
      return hurtPose(pose, view, frame, grip);
    case "dead":
      return deadPose(pose, view, frame, grip);
  }
}

function walkPose(pose: Pose, view: View, f: number, grip: Grip): Pose {
  pose.legs = (["walk0", "walk1", "walk2", "walk3"] as const)[f % 4] as LegPose;
  pose.bob = f % 2 === 1 ? -1 : 0;
  const carry = grip === "pole" || grip === "gun";
  if (view === "right") {
    const swing = [2, 0, -2, 0][f % 4] as number;
    if (!carry) pose.near = p(pose.near.x + swing, pose.near.y);
    pose.far = p(pose.far.x - swing, pose.far.y);
  } else {
    const a = [1, 0, -1, 0][f % 4] as number;
    if (!carry) pose.near = p(pose.near.x, pose.near.y - a);
    pose.far = p(pose.far.x, pose.far.y + a);
  }
  return pose;
}

function attackPose(pose: Pose, view: View, f: number, style: Style): Pose {
  pose.legs = f === 0 ? "brace" : "lunge";
  const set = (near: Pt, far: Pt, angle: number, layer: WeaponLayer, lean = 0) => {
    pose.near = near;
    pose.far = far;
    pose.angle = angle;
    pose.layer = layer;
    pose.lean = lean;
  };
  switch (style) {
    case "slash":
    case "swing": {
      const long = style === "swing";
      if (view === "right") {
        if (f === 0) set(p(4, 9), p(8, 14), long ? -125 : -140, "body", -1);
        else if (f === 1) set(p(11, 12), p(9, 14), long ? 5 : -10, "top", 1);
        else set(p(11, 16), p(8, 16), long ? 40 : 45, "top", 1);
      } else if (view === "down") {
        if (f === 0) set(p(0, 9), p(11, 15), -115, "top");
        else if (f === 1) set(p(5, 14), p(11, 16), 10, "top");
        else set(p(10, 17), p(12, 15), 70, "top");
      } else {
        if (f === 0) set(p(14, 9), p(3, 15), -65, "top");
        else if (f === 1) set(p(7, 12), p(3, 15), -170, "back");
        else set(p(3, 15), p(2, 16), 150, "back");
      }
      pose.mouth = f === 1;
      break;
    }
    case "thrust": {
      if (view === "right") {
        if (f === 0) set(p(5, 15), p(3, 15), 0, "top", -1);
        else if (f === 1) set(p(10, 15), p(7, 15), 0, "top", 1);
        else set(p(8, 15), p(5, 15), 0, "top");
        pose.slide = [-5, 2, -1][f] as number;
      } else if (view === "down") {
        if (f === 0) set(p(3, 13), p(6, 13), 90, "top");
        else if (f === 1) set(p(4, 16), p(6, 15), 90, "top");
        else set(p(3, 15), p(6, 14), 90, "top");
        pose.slide = [-6, 2, -2][f] as number;
        pose.scale = 0.65;
      } else {
        if (f === 0) set(p(12, 13), p(9, 14), -90, "top");
        else if (f === 1) set(p(12, 11), p(9, 12), -90, "top");
        else set(p(12, 13), p(9, 13), -90, "top");
        pose.slide = [-6, 2, -2][f] as number;
        pose.scale = 0.65;
      }
      pose.mouth = f === 1;
      break;
    }
    case "punch": {
      if (view === "right") {
        if (f === 0) set(p(6, 14), p(9, 14), 0, "top", -1);
        else if (f === 1) set(p(12, 12), p(7, 15), 0, "top", 1);
        else set(p(10, 14), p(8, 15), 0, "top");
      } else if (view === "down") {
        if (f === 0) set(p(3, 13), p(10, 14), 90, "top");
        else if (f === 1) set(p(5, 17), p(11, 14), 90, "top");
        else set(p(3, 15), p(11, 15), 90, "top");
      } else {
        if (f === 0) set(p(12, 13), p(4, 14), -90, "top");
        else if (f === 1) set(p(10, 9), p(3, 15), -90, "top");
        else set(p(12, 14), p(3, 15), -90, "top");
      }
      pose.mouth = f === 1;
      break;
    }
    case "shot": {
      pose.legs = "brace";
      pose.bowDraw = f < 2;
      pose.arrow = f < 2;
      if (view === "right") set(p(11, 12), f === 0 ? p(8, 12) : f === 1 ? p(5, 12) : p(4, 11), 0, "top");
      else if (view === "down") set(p(7, 17), f === 0 ? p(7, 14) : f === 1 ? p(7, 12) : p(9, 11), 90, "top");
      else set(p(7, 7), f === 0 ? p(7, 10) : f === 1 ? p(7, 12) : p(9, 13), -90, "top");
      break;
    }
    case "gun": {
      pose.legs = "brace";
      pose.flash = f === 1;
      if (view === "right") {
        set(p(8, 12), p(11, 12), f === 2 ? -15 : 0, "top", f === 1 ? -1 : 0);
        pose.slide = f === 1 ? -2 : -1;
      } else if (view === "down") {
        set(p(5, 12), p(7, 15), 90, "top");
        pose.slide = f === 1 ? -3 : -2;
        pose.scale = 0.7;
      } else {
        set(p(12, 11), p(10, 9), -90, "top");
        pose.slide = f === 1 ? -3 : -2;
        pose.scale = 0.7;
      }
      break;
    }
  }
  return pose;
}

function castPose(pose: Pose, view: View, f: number, grip: Grip): Pose {
  pose.mouth = f === 1;
  pose.layer = "top";
  if (f === 0) {
    pose.near = view === "down" ? p(5, 13) : view === "up" ? p(9, 13) : p(9, 13);
    pose.far = view === "down" ? p(9, 13) : view === "up" ? p(5, 13) : p(8, 13);
    pose.angle = grip === "blade" ? -60 : -90;
    if (view === "up") pose.layer = "back";
  } else {
    pose.near = view === "down" ? p(0, 7) : view === "up" ? p(14, 7) : p(9, 6);
    pose.far = view === "down" ? p(14, 7) : view === "up" ? p(0, 7) : p(6, 7);
    pose.angle = view === "right" ? -80 : view === "down" ? -100 : -80;
    pose.slide = grip === "pole" || grip === "gun" ? -4 : 0;
    pose.headDy = -1;
  }
  if (grip === "bow") pose.angle = view === "down" ? 180 : 0;
  return pose;
}

function hurtPose(pose: Pose, view: View, f: number, grip: Grip): Pose {
  pose.eyes = "wince";
  if (f === 0) {
    pose.legs = "brace";
    pose.lean = -1;
    pose.headDy = 0;
    if (view === "right") {
      pose.near = p(4, 14);
      pose.far = p(4, 13);
    } else if (view === "down") {
      pose.near = p(1, 14);
      pose.far = p(13, 14);
    } else {
      pose.near = p(13, 14);
      pose.far = p(1, 14);
    }
    if (grip === "blade") pose.angle = view === "right" ? 110 : pose.angle;
  }
  return pose;
}

function deadPose(pose: Pose, view: View, f: number, grip: Grip): Pose {
  pose.eyes = "shut";
  if (f === 0) {
    pose.legs = "kneel";
    pose.bob = 3;
    pose.headDy = 1;
    pose.near = view === "down" ? p(2, 17) : view === "up" ? p(12, 17) : p(8, 17);
    pose.far = view === "down" ? p(12, 17) : view === "up" ? p(2, 17) : p(6, 17);
    pose.angle = grip === "blade" ? 120 : grip === "pole" || grip === "gun" ? -60 : pose.angle;
    if (grip === "pole" || grip === "gun") pose.layer = "back";
  } else {
    pose.lying = true;
    pose.hideWeapon = true;
    pose.near = p(2, 16);
    pose.far = p(12, 16);
  }
  return pose;
}
