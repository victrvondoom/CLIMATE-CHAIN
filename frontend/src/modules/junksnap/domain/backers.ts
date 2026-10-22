// Port of backend/server/src/domain/sites/Backers.ts (JunkSnap). Pure: no React, no DOM.

// Fixed by the site contract (backers.needed is const 10), so it is not a setting.
export const BACKERS_NEEDED = 10;

export interface BackerPeople {
  readonly photoPeople: readonly string[];
  readonly yesPeople: readonly string[];
  readonly noPeople: readonly string[];
  // REJECT_MARGIN: no-voters ahead of the backers by this many reject an unverified site.
  readonly rejectMargin: number;
}

export interface BackersView {
  readonly count: number;
  readonly needed: number;
  readonly photoPeople: number;
  readonly votePeople: number;
}

// People backing a site by a photo or a yes vote, each counted once.
export function countBackers(photoPeople: readonly string[], yesPeople: readonly string[]): number {
  return new Set([...photoPeople, ...yesPeople]).size;
}

// A site with this many backers is verified (the count alone, for a stored site).
export function verifiedAt(count: number): boolean {
  return count >= BACKERS_NEEDED;
}

// 10 backers verify the site. Otherwise, rejectMargin more no-voters than backers reject it.
// A person who sent a photo backs the site whatever their latest vote says, so their no is ignored.
export function backerOutcome(people: BackerPeople): 'verified' | 'rejected' | null {
  const count = countBackers(people.photoPeople, people.yesPeople);
  if (count >= BACKERS_NEEDED) {
    return 'verified';
  }
  const photo = new Set(people.photoPeople);
  const no = new Set(people.noPeople.filter((person) => !photo.has(person)));
  return no.size - count >= people.rejectMargin ? 'rejected' : null;
}

// A verified site never shows fewer backers than it had when it became verified.
export function backersView(people: BackerPeople, frozen: number | null): BackersView {
  const count = Math.max(countBackers(people.photoPeople, people.yesPeople), frozen ?? 0);
  return {
    count,
    needed: BACKERS_NEEDED,
    photoPeople: new Set(people.photoPeople).size,
    votePeople: new Set(people.yesPeople).size,
  };
}
