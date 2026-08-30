# CandyBoost Planner

[日本語版 README](README.ja.md)

CandyBoost Planner is a small web tool to plan Candy Boost allocation in **Pokémon Sleep**.

## Live

- `https://jb-sk.github.io/candy_boost_planner/`

## Features

- Multi-Pokémon Candy Boost planning with Dream Shards cap checks
- Sleep EXP planning, long range: GSD, event bonuses, and Growth Incense placement
- Pokémon Box with filtering and quick apply-to-calculator
- Import compatible with Nitoyon export format (unofficial)
- JP / EN UI toggle

## Development

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Data update (maintainers)

Master DB (recommended entrypoint):

```bash
pnpm run update:all
```

`update:all` fast-forwards the local `pokesleep-tool` clone with `git pull --ff-only`, runs the interactive Master DB update, verifies form mappings, regenerates the Master DB and English names from the canonical mappings, checks ingredient labels, and builds the app. Run it in a TTY because the first generation step may prompt for input. It uses `../../External/pokesleep-tool` by default; use `--pokesleep-tool <path>` or `POKESLEEP_TOOL_PATH` for a different location. Event and full-moon outputs are maintained separately: `auto-update-events.yml` handles events, while regular CI verifies the full-moon table.

Other generators:

```bash
npm run generate:tables
npm run generate:terms
npm run generate:pokemon-en-names
```

Event multipliers (writes `src/domain/pokesleep/boost-config.ts`):

```bash
npm run set:boost -- --mini-exp 2 --mini-shards 4 --full-exp 2 --full-shards 5
```

## Configuration (optional)

These are injected at build time (Vite env vars). For GitHub Pages, set them as **Repository variables**.

- `VITE_CF_WEB_ANALYTICS_TOKEN`

## Data sources / attribution

The in-app help screen lists only the main sources (Nitoyon, RaenonX, wikiwiki). The full list is below.

### Data sources (sites)

| Source | Data used | Generated output |
|---|---|---|
| [Pokémon Sleep Strategy & Research Wiki (WikiWiki)](https://wikiwiki.jp/poke_sleep/) | Pokémon list, berries, multilingual terms, level/growth tables, event list | `pokemon-db`, `pokemon-master`, `terms`, `tables`, `sleep-exp-events` |
| [RaenonX](https://pks.raenonx.cc/) | EXP tables ([XP table](https://pks.raenonx.cc/en/xp/table)) | `tables` |
| [IV Calc (pokesleep-tool)](https://nitoyon.github.io/pokesleep-tool/iv/) | Pokémon data and export/import format (MIT, unofficial integration). Generation cross-checks against a local clone of [nitoyon/pokesleep-tool](https://github.com/nitoyon/pokesleep-tool) | `pokemon-names`, `candy-family`, form mapping |
| [PokeAPI](https://pokeapi.co/) | English Pokémon names | `pokemon-name-en` |
| [PokéSleep Super Wiki](https://wiki.pokesleep.com/en/events) | English event names | `event-name-en` |
| [Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/List_of_events_in_Pok%C3%A9mon_Sleep) | English event names (fills gaps left by Super Wiki) | `event-name-en` |
| [Pokémon Sleep official site](https://www.pokemonsleep.net/) / [official news](https://www.pokemonsleep.net/news/) | Confirming event multipliers and periods (per-event URLs recorded in `scripts/events-overrides.json`) | `sleep-exp-events` |

### Libraries used for calculation / generation

| Library | Purpose |
|---|---|
| [Astronomy Engine](https://github.com/cosinekitty/astronomy) (MIT) | Full-moon dates for Good Sleep Day detection. Used **at build time only**; at runtime the app reads the generated `_generated/full-moon-dates.ts` table (2023-01-01 to 2046-12-31). `verify:runtime-bundle` checks it never ends up in the bundle |
| [cheerio](https://cheerio.js.org/) | HTML parsing in the generator scripts |
| [Vue](https://vuejs.org/) / [Vue I18n](https://vue-i18n.intlify.dev/) | App framework and localization |

### Other external dependencies

- [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/): the beacon loads only when `VITE_CF_WEB_ANALYTICS_TOKEN` is set (optional)

## Disclaimer

This project is **unofficial** and is not affiliated with Nintendo / The Pokémon Company / Pokémon Sleep.
For official information, see the [Pokémon Sleep official site](https://www.pokemonsleep.net/).

## License

MIT.
