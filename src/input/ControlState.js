/**
 * ControlState is the single, input-agnostic description of "what the user is
 * doing" that the rest of the app consumes. Camera tracking, the mouse and the
 * demo director all produce the same shape, which is what makes switching
 * inputs seamless (the sword scene never knows where the data came from).
 *
 * Positions are in NDC-like units: x,y in [-1, 1], +y is UP.
 * depth: 0 = far from the viewer, 1 = close.
 * pose: 'open' | 'fist' | 'pinch' | 'point' (index only) | 'two' (index + middle) | 'neutral' | 'none'
 */
export function createHandState(side = 'Right') {
  return {
    side, // 'Left' | 'Right': which physical hand this is (the twin daggers use it)
    present: false,
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    depth: 0.5,
    roll: 0, // radians, 0 = upright, + = clockwise on screen
    pose: 'none',
    spread: 0.5, // 0 = fingers together, 1 = fully spread
    pinch: 0, // 0 = open, 1 = fully pinched
    speed: 0,
    score: 0,
  };
}

export function createControlState() {
  return {
    source: 'none', // 'camera' | 'mouse' | 'demo' | 'none'
    active: false, // any hand/cursor currently driving the scene
    primary: createHandState('Right'),
    secondary: createHandState('Left'),
    buttons: { left: false, right: false }, // mouse buttons held (the twin daggers use them to pick a dagger)
    twoHands: false,
    handsDistance: 0, // NDC distance between the two palms
    handsCenter: { x: 0, y: 0 },
    label: 'NO INPUT',
  };
}

export function resetHandState(h) {
  h.present = false;
  h.pose = 'none';
  h.speed = 0;
  h.vel.x = 0;
  h.vel.y = 0;
  h.pinch = 0;
  h.score = 0;
}

export const POSE_LABELS = {
  open: 'OPEN PALM',
  fist: 'CLOSED FIST',
  pinch: 'PINCH',
  point: 'POINTING',
  two: 'TWO FINGERS',
  neutral: 'TRACKING',
  none: 'NO HAND',
};
