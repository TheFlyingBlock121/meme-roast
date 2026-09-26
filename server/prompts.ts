// Built-in prompts. @PLAYER is replaced with the player being roasted.
// Hosts can edit the list in the lobby (see the prompt editor in the client).

export const CLASSIC_PROMPTS = [
  '@PLAYER when he gets his first job',
  '@PLAYER when his paycheck arrives',
  '@PLAYER trying to flirt',
  '@PLAYER at 4 AM',
  '@PLAYER after saying "I\'m only having one drink"',
  '@PLAYER when someone says "skill issue"',
  '@PLAYER after losing his wallet',
  '@PLAYER when his mom calls',
  '@PLAYER finding out the group chat has been talking about him',
  '@PLAYER pretending to understand the math',
  '@PLAYER when the Wi-Fi drops mid-game',
  '@PLAYER opening the fridge for the 5th time',
];

// Chaotic and embarrassing, but nothing hateful or cruel.
export const WILD_PROMPTS = [
  '@PLAYER explaining to the police why there is a goat in the car',
  '@PLAYER finding out the "quick call" is a 3-hour meeting',
  '@PLAYER reading their old search history out loud at their wedding',
  '@PLAYER after texting "I\'m on my way" while still in bed',
  '@PLAYER when the group project is due in 10 minutes',
  '@PLAYER realizing they were on mute for the whole presentation',
  '@PLAYER after one bite of gas station sushi',
  '@PLAYER winning an argument with a toddler',
  '@PLAYER as a medieval knight who is afraid of horses',
  '@PLAYER at 3 AM googling "is it normal to..."',
  '@PLAYER trying to look casual after setting off the fire alarm',
  '@PLAYER on their first day as a villain\'s assistant',
  '@PLAYER when the "reply all" goes to the whole company',
  '@PLAYER being told "we need to talk" by a raccoon',
  '@PLAYER pretending not to hear the ice cream truck',
  '@PLAYER when the waiter says "enjoy your meal" and they answer "you too"',
];

export const DEFAULT_PROMPTS = [...CLASSIC_PROMPTS, ...WILD_PROMPTS];
