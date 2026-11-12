# Transport Tycoon: Classroom Edition

Et norsk undervisningsspill inspirert av OpenTTD for bedriftsøkonomi, logistikk, skatt og aksjemarked i klasserommet.

## Funksjoner
- **3D Voxel Isometrisk Kart** (Three.js OrthographicCamera) med terreng, vann, byer, primær- og sekundærindustrier.
- **Transportnettverk**: Jernbane med blokksignaler, veitransport, busser og varelevering med OpenTTD-inspirert fraktbetaling.
- **Delt økonomi (Selskap vs. Privatøkonomi)**: Bedriftslån, likviditetsstyring, arbeidsgiveravgift (14,1 %), trinnskatt/inntektsskatt på eierlønn, og oppgradering av hovedkontor (HQ Tiers 1–5) med egne midler.
- **AI-konkurrenter & Aksjebørs**: Tidsstyrte AI-selskaper, aksjehandel i 10 %-poster opptil 75 % og kvartalsvise utbytter.
- **Klasseromsmodus (Firebase Firestore)**: Sanntids ledertavle på projektor med 4-sifret PIN-kode uten krav om innlogging.

## Utvikling og Bygging

```bash
npm install
npm run dev      # Start utviklingsserver
npm run verify   # Kjør hodeløs simulerings- og formelverifisering
npm run build    # TypeScript-sjekk og produksjonsbygg
```
