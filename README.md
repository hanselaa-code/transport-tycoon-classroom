# Transport Tycoon: Classroom Edition

Et norsk undervisningsspill inspirert av OpenTTD for bedriftsøkonomi, logistikk, skatt og aksjemarked i klasserommet.

- **Live Web App (Firebase Hosting)**: [https://tt-classroom-ed-2026.web.app](https://tt-classroom-ed-2026.web.app)
- **GitHub Repository**: [https://github.com/hanselaa-code/transport-tycoon-classroom](https://github.com/hanselaa-code/transport-tycoon-classroom)

## Nøkkelfunksjoner
- **3D Voxel Isometrisk Kart** (`Three.js` `OrthographicCamera`) med terrenghøyder, kyst/fjord, 8 norske byer, primær- og sekundærindustrier (`COAL_MINE -> POWER_PLANT`, `FOREST -> SAWMILL -> GOODS`, `FARM -> FOOD_PLANT -> FOOD`).
- **Transportnettverk**: Jernbane med blokksignaler, veitransport, busser og varelevering basert på autentiske OpenTTD C++-formler for fraktbetaling, stigningsmotstand og stasjonsvurdering.
- **Delt økonomi (Selskap AS vs. Privatøkonomi)**:
  - Selskapet starter med `2 000 000 kr` i kontanter og lån (justerbart i trinn på `100 000 kr`), likviditetsvarsel ved negativ kassebeholdning og resultatregnskap (P&L).
  - Månedlig eierlønn trekker bruttolønn + `14,1 %` arbeidsgiveravgift fra selskapet, beregner progressiv personskatt (`20 %` / `30 %` / `42 %`) og utbetaler nettolønn til eierens privatkonto.
  - Oppgradering av hovedkontor (**HQ Nivå 1–5**) finansieres utelukkende med **private midler**, gir `-0,5 %` lavere lånerente per nivå og `+5 %` bonus på stasjonsvurdering i nærheten.
- **Tidsstyrte AI-konkurrenter & Aksjebørs**: *Nordic Rail & Cargo* (måned 12), *FjordExpress AS* (måned 24) og *Sørlandet Transport* (måned 36) bygger ruter og børsnoteres. Elever kan kjøpe og selge aksjeposter på `10 %` (opptil `75 %`) med private midler og motta kvartalsvise utbytter.
- **Klasseromsmodus (Firebase Firestore)**: Sanntids ledertavle for lærer/projektor med 4-sifret PIN-kode uten krav om elevinnlogging.

## Utvikling, Verifisering og Bygging

```bash
npm install
npm run dev      # Start lokal utviklingsserver (Vite)
npm run verify   # Kjør hodeløs simulerings- og formelverifisering (tsx scripts/verify-sim.ts)
npm run build    # TypeScript-sjekk og produksjonsbygg (tsc -b && vite build)
```

## CI/CD og Publisering
GitHub Actions (`.github/workflows/firebase-deploy.yml`) kjører `npm ci`, `npm run verify` og `npm run build` ved hver push til `main`, og publiserer til Firebase Hosting dersom `FIREBASE_SERVICE_ACCOUNT` eller `FIREBASE_TOKEN` er lagt til under GitHub Repository Secrets.
