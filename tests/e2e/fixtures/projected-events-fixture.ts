import { type Page } from '@playwright/test';

/**
 * Generated event data used only by the wiring E2E. The route replaces the generated
 * module before Vite evaluates the application, so these assertions do not depend on
 * the repository's current event-generation output.
 */
export const PROJECTED_EVENTS_FIXTURE_MODULE = `
export const sleepExpEventSegments = [
  { name: "2周年記念フェスティバル", from: "2026-07-20", to: "2026-07-26", multiplier: 1.5, source: "wiki" },
  { name: "fixture event", from: "2027-07-12", to: "2027-07-18", multiplier: 1.5, source: "wiki" },
];
export const sleepExpEventAnchors = [
  { match: "周年記念フェスティバル", month: 7, day: 17 },
];
export const sleepExpEventFlowers = [
  { match: "周年記念フェスティバル", days: 7 },
  { match: "fixture event", days: 7 },
];
export const eventHistory = [
  { name: "fixture event", from: "2027-07-12", to: "2027-07-18", sleepExp: { multiplier: 1.5, from: "2027-07-12", to: "2027-07-18" } },
  { name: "4周年記念フェスティバル", from: "2028-07-17", to: "2028-07-23", boost: "mini" },
];
export const wikiKnownThrough = "2028-07-23";
`;

export const EVENT_NAME_EN_FIXTURE_MODULE = `
export const eventNameJaToEnByPeriod = {
  "2周年記念フェスティバル@2026-07-20": "Second Anniversary Fest",
  "fixture event@2027-07-12": "Fixture Event",
  "4周年記念フェスティバル@2028-07-17": "Fourth Anniversary Fest",
};
export const eventNameJaToEn = {
  "2周年記念フェスティバル": "Second Anniversary Fest",
  "fixture event": "Fixture Event",
  "4周年記念フェスティバル": "Fourth Anniversary Fest",
};
`;

export async function installProjectedEventsFixture(page: Page): Promise<void> {
  await page.route('**/event-name-en.ts*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: EVENT_NAME_EN_FIXTURE_MODULE,
    });
  });
  await page.route('**/sleep-exp-events.ts*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: PROJECTED_EVENTS_FIXTURE_MODULE,
    });
  });
}
