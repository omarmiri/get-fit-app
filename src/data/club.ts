/**
 * The home club.
 *
 * Everything here comes from the club's published listing rather than from
 * inference — see `equipment.ts` for the distinction and why it is enforced.
 * Hours and class schedules change; `verifiedOn` records when this was last
 * checked so stale data is visible rather than silently trusted.
 *
 * To point the app at a different club, replace this file. Nothing else
 * references the address, hours or class list.
 */

export interface ClubHours {
  readonly days: string;
  readonly open: string;
  readonly close: string;
}

export interface ClubProfile {
  readonly name: string;
  readonly operator: string;
  readonly clubId: string;
  readonly address: string;
  readonly phone: string;
  readonly hours: readonly ClubHours[];
  /** Amenities as published for this club. */
  readonly amenities: readonly string[];
  /** Group classes offered. Times vary week to week — check the club app. */
  readonly classes: readonly string[];
  /** Things explicitly listed as not available, so you do not go looking. */
  readonly notAvailable: readonly string[];
  /** ISO date this listing was last checked. */
  readonly verifiedOn: string;
  readonly sourceUrl: string;
}

export const CLUB: ClubProfile = {
  name: 'LA Fitness — Wayne',
  operator: 'LA Fitness',
  clubId: '345',
  address: '1070 Hamburg Tpke, Wayne, NJ 07470',
  phone: '(973) 694-0175',
  hours: [
    { days: 'Mon–Thu', open: '5:00 am', close: '11:00 pm' },
    { days: 'Fri', open: '5:00 am', close: '10:00 pm' },
    { days: 'Sat–Sun', open: '8:00 am', close: '8:00 pm' },
  ],
  amenities: [
    'Indoor swimming pool',
    'Spa / whirlpool',
    'Sauna',
    'Basketball court',
    'Racquetball court',
    'Turf area for functional training',
    'Olympic lifting platform',
    'Cardio cinema',
    'Free weights and strength machines',
    'Personal training',
    'Massage chairs',
    'Towel service',
    'Juice bar',
    'Free Wi-Fi',
  ],
  classes: ['Cycle', 'Zumba', 'Yoga', 'Pilates', 'Boot Camp', 'SilverSneakers', 'Brazilian Jiu-Jitsu'],
  notAvailable: ['Childcare', '24-hour access', 'Steam room', 'Cold plunge', 'Tanning'],
  verifiedOn: '2026-07-27',
  sourceUrl: 'https://www.lafitness.com/Pages/clubhome.aspx?clubid=345',
};

/** How long ago the club listing was checked, in whole days. */
export function daysSinceVerified(today: Date = new Date()): number {
  const [year = 0, month = 1, day = 1] = CLUB.verifiedOn.split('-').map(Number);
  const verified = new Date(year, month - 1, day);
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((midnight.getTime() - verified.getTime()) / 86_400_000);
}
