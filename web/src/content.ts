// Portfolio copy lives here. Replace the placeholders with your own details.
import type { Vec3 } from './scene/types'

export const profile = {
  name: 'Your Name',
  role: '3D Artist & Developer',
  intro: 'Welcome to Hollow Manor. Drag to look around, scroll to move closer, or pick a room below.',
  email: 'you@example.com',
  links: [
    { label: 'GitHub', href: 'https://github.com/' },
    { label: 'ArtStation', href: 'https://www.artstation.com/' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/' },
  ],
}

export interface Stop {
  title: string
  body: string
  /** A Blender camera from public/scene/viewpoints.json... */
  view?: string
  /** ...or an explicit spot (three.js Y-up metres: eye position + look-at point). */
  spawn?: { position: Vec3; target: Vec3 }
}

/** Each stop flies the camera (orbit) or teleports the player (walk) there. */
export const stops: Stop[] = [
  { view: 'CAM_GreatHall_Walk', title: 'The Approach', body: 'Short intro about you and what you make.' },
  { view: 'CAM_Reference_EyeLevel', title: 'The Gate', body: 'Skills, tools, background.' },
  { view: 'CAM_ThreeQuarter_FrontLeft', title: 'The Manor', body: 'Featured project #1.' },
  { view: 'CAM_ThreeQuarter_Back', title: 'Behind the House', body: 'Featured project #2.' },
  { view: 'CAM_GreatHall_Doorway', title: 'The Great Hall', body: 'How this scene was made / contact.' },
  {
    spawn: { position: [-6, 0.2, -11.4], target: [-1, 0.2, -11.4] },
    title: 'The Tantrik Room',
    body: 'Featured project #3.',
  },
]
