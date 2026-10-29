// Congratulation lines for a ball that lands in the bin. Pure data + a
// picker; the app passes in what happened and gets back { title, sub, big }.

const POOLS = {
  swish: ['Swish!', 'Nothing but bin!', 'Clean!', 'Perfect toss!', 'Bullseye!', 'Textbook!', 'Like a pro!', 'Smooth!', 'Buttery!', 'Chef’s kiss!'],
  bank: ['Bank shot!', 'Off the lid!', 'Lid assist!', 'Called it!', 'Off the glass!'],
  rim: ['Rim shot… in!', 'Rattled in!', 'Phew, that was close!', 'Rolled around and in!', 'Teased the rim!'],
  side: ['Off the side… in!', 'Kissed the bin!', 'Lucky bounce!', 'Ricochet!'],
  bounced: ['Bounced in!', 'Skipped in!', 'Off the floor!', 'Trick shot!', 'One-bounce wonder!'],
  clutch: ['Clutch!', 'Last-second save!', 'Ice in your veins!', 'Under pressure!', 'Saved it!'],
  long: ['From downtown!', 'Long range!', 'Sniper!', 'Across the room!'],
  corner: ['Corner shot!', 'From the side!', 'Wild angle!'],
  streak: ['On fire!', 'Unstoppable!', 'Heating up!', 'Can’t miss!', 'Machine!'],
};

const SUBS = [
  'Into the {trash} it goes.',
  'Bye-bye, {name}.',
  'One less file to worry about.',
  'Decluttering champion.',
  'Your desktop thanks you.',
  'So long, {name}.',
  'Tidy!',
  'The bin approves.',
];

const recent = new Map(); // pool -> last few picks, to avoid repeats

function pick(pool, key) {
  const used = recent.get(key) || [];
  const fresh = pool.filter((line) => !used.includes(line));
  const choice = (fresh.length ? fresh : pool)[Math.floor(Math.random() * (fresh.length || pool.length))];
  recent.set(key, [...used, choice].slice(-Math.min(3, pool.length - 1)));
  return choice;
}

function shorten(name, max = 28) {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

/**
 * @param {{ touchedLid: boolean, touchedRim: boolean, touchedCan: boolean, bounces: number,
 *   throwNumber: number, maxThrows: number, distance: number, lateral: number,
 *   streak: number, bestStreak: number, newBest: boolean, fill: number,
 *   isFolder: boolean, name: string, trashName: string }} c
 * @returns {{ title: string, sub: string, big: boolean }}
 */
export function pickCheer(c) {
  // Title: the most remarkable thing about this shot wins.
  let pool = 'swish';
  if (c.touchedLid) pool = 'bank';
  else if (c.touchedRim) pool = 'rim';
  else if (c.touchedCan) pool = 'side';
  else if (c.bounces > 0) pool = 'bounced';
  if (c.distance > 4.5) pool = 'long';
  if (Math.abs(c.lateral) > 1.0) pool = 'corner';
  if (c.streak >= 3) pool = 'streak';
  if (c.throwNumber === c.maxThrows && c.maxThrows > 1) pool = 'clutch';
  const title = pick(POOLS[pool], pool);

  // Sub-line: the best bit of context, else a friendly send-off.
  let sub;
  if (c.newBest && c.streak >= 2) sub = `🏆 New best: ${c.streak} in a row!`;
  else if (c.streak >= 2) sub = `🔥 ${c.streak} in a row!`;
  else if (c.throwNumber === 1 && pool === 'swish') sub = 'First try, no touch!';
  else if (c.throwNumber === 1) sub = 'First try!';
  else if (c.fill > 0.85) sub = 'Squeezed it in. That bin is stuffed!';
  else if (c.isFolder) sub = 'A whole folder, gone!';
  else sub = pick(SUBS, 'subs').replace('{trash}', c.trashName).replace('{name}', shorten(c.name));

  const big = pool === 'clutch' || pool === 'streak' || pool === 'long' || pool === 'corner' || c.newBest;
  return { title, sub, big };
}

/** Headline for the end-of-round summary when everything went in. */
export function perfectRoundTitle(n, allFirstTry) {
  if (allFirstTry && n > 1) return pick(['Flawless round!', 'Perfect game!', 'All first try!'], 'perfect');
  if (allFirstTry) return pick(['First try!', 'One and done!', 'Nailed it!'], 'one');
  return n === 1 ? pick(['In the bin!', 'Got it!', 'Done and dusted!'], 'single') : `All ${n} in the bin!`;
}
