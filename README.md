# Transport Tycoon: Classroom Edition

Et norsk undervisningsspill inspirert av **Transport Tycoon Deluxe (1995) / OpenTTD (OpenGFX)** for bedriftsøkonomi, logistikk, skatt og aksjemarked i klasserommet.

- **Live Web App (Firebase Hosting)**: [https://tt-classroom-ed-2026.web.app](https://tt-classroom-ed-2026.web.app)
- **GitHub Repository**: [https://github.com/hanselaa-code/transport-tycoon-classroom](https://github.com/hanselaa-code/transport-tycoon-classroom)

## Nøkkelfunksjoner
- **Start-lobby, Lærerpanel (Google Auth) & Flerspiller-verdener**:
  - **Obligatorisk inngangsport**: Elever starter med **4-sifret PIN-kode + Spillnavn + Selskapsnavn**, mens lærer/administrator logger inn med Google (`hanselaa@gmail.com`).
  - **Komplett OpenTTD Verdensoppsett**: Lærer velger kartstørrelse (`64×64`, `96×96`, `128×128`, `160×160`), **Enkeltspiller** (hver elev i egen verden) eller **Flerspiller** (`2–8` elever per delt verden med automatisk fordeling til *Verden 1*, *Verden 2* osv.), AI-konkurrenter på/av (`0–3`), terrengtype, vannmengde/fjorder, by-/industritetthet, startår og tidsgrense (`30`/`45`/`60` min eller ubegrenset).
- **Vei- og Jernbanebruer over vann (`Veibru` 12 000 kr/rute • `Jernbanebru` 18 000 kr/rute)**:
  - 3D betongpilarer, bjelkebru for vei og klassisk rød OpenTTD fagverksbru i stål for jernbane med jevne landkar-ramper på begge bredder.
- **Detaljert OpenTTD / OpenGFX 3D Isometrisk Grafikk** (`Three.js` `OrthographicCamera` + `PCFSoftShadowMap`):
  - Kontinuerlig vanntett terrengmesh med prosedyrisk pikselkunst (`NearestFilter`), steinete klippeskråninger, bølgeteksturer med brenning langs kysten, flersjikts bartrær/løvtrær, planoverganger med blinkende varsellys, buede jernbaneskinner og isometriske solskygger.
  - **15 bybygnings-arketyper (Nivå 1–3)** med saltak, valmtak og mansardtak, samt **6 animerte industrianlegg** og **detaljerte norske lokomotiver (*NSB Type 26*, *Di 3 Nohab*, *El 18*), vogner og lastebiler**.
- **Autentisk OpenTTD Transportøkonomi & Delt Økonomi (Selskap AS vs. Privatøkonomi)**:
  - Realistiske TTD-hastigheter, gradvis lasting på stasjoner, **`Full last`**-ordrevalg, blokksignaler, dedikert **stasjonsvindu** med selvforklarende kundetilfredshet/markedsandel og klassisk **`[?]` Landinformasjon**-verktøy.
  - Selskapslån (`2 000 000 kr` start), resultatregnskap (P&L), månedlig eierlønn med `14,1 %` arbeidsgiveravgift og progressiv personskatt (`20 %` / `30 %` / `42 %`), samt **HQ Nivå 1–5** og **aksjebørs** finansiert med private midler.

## Utvikling, Verifisering og Bygging

```bash
npm install
npm run dev      # Start lokal utviklingsserver (Vite)
npm run verify   # Kjør hodeløs simulerings-, bru-, flerspiller- og 3D-verifisering (42 609 sjekker)
npm run build    # TypeScript-sjekk og produksjonsbygg (tsc -b && vite build)
```

## CI/CD og Publisering
GitHub Actions (`.github/workflows/firebase-deploy.yml`) kjører `npm ci`, `npm run verify` og `npm run build` ved hver push til `main`, og publiserer til Firebase Hosting dersom `FIREBASE_SERVICE_ACCOUNT` eller `FIREBASE_TOKEN` er lagt til under GitHub Repository Secrets.
