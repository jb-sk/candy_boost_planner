# CandyBoost Planner

[日本語版 README](README.ja.md)

CandyBoost Planner is a small web tool to plan Candy Boost allocation in **Pokémon Sleep**.

## Live

- `https://jb-sk.github.io/candy_boost_planner/`

## Features

- Multi-Pokémon Candy Boost planning with Dream Shards cap checks
- Pokémon Box with filtering and quick apply-to-calculator
- Import compatible with Nitoyon export format (unofficial)
- JP / EN UI toggle
- Support links (OFUSE / Buy Me a Coffee)

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
npm run generate:master
```

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

- `VITE_OFUSE_URL`
- `VITE_BMAC_URL`
- `VITE_CF_WEB_ANALYTICS_TOKEN`

## Data sources / attribution

- Pokémon list & some terms: [WikiWiki](https://wikiwiki.jp/poke_sleep/)
- English Pokémon names: [PokeAPI](https://pokeapi.co/)
- EXP tables: [RaenonX](https://pks.raenonx.cc/)
- Nitoyon export format: compatible with [Nitoyon's tool](https://nitoyon.github.io/pokesleep-tool/iv/) (MIT, unofficial integration)

## Disclaimer

This project is **unofficial** and is not affiliated with Nintendo / The Pokémon Company / Pokémon Sleep.

## License

MIT.
