# Nuvio TV pentru Xbox Series X|S (`NuvioXbox`)

Această variantă adaptează interfața oficială Smart TV **NuvioTVSmart** într-o aplicație nativă **UWP (`x64`) + WebView2 + MediaPlayer** pentru **Xbox Developer Mode**, conectată la serverele oficiale Nuvio (QR login, sincronizare profil/addon-uri Stremio & Debrid).

---

## 1. Compilarea pachetului `.msix` de pe macOS (prin GitHub Actions)

Pentru că pachetele UWP pentru Xbox necesită Windows SDK + MSBuild, proiectul include workflow-ul automat `.github/workflows/build-xbox-msix.yml`:

1. Creează un repository privat sau public pe contul tău de GitHub și încarcă acest folder (`/Users/andreraul/.gemini/antigravity/scratch/NuvioXbox`).
2. Intră pe GitHub în tab-ul **Actions** -> **Build NuvioXbox (Xbox Series X|S UWP MSIX)** (pornește automat la `push` sau manual din **Run workflow**).
3. După terminarea build-ului (~3-4 minute), descarcă arhiva **`NuvioXbox-XboxSeries-x64`** din secțiunea **Artifacts** și dezarhiveaz-o pe Mac. Vei găsi:
   - fișierul `.msix` (sau `.appx`) principal (`NuvioXbox_..._x64.msix`),
   - folderul `Dependencies-x64/` (bibliotecile UWP C++/WinUI necesare la prima instalare),
   - certificatul `NuvioXbox.cer`.

---

## 2. Activarea Xbox Developer Mode (Gratuit)

Microsoft a făcut conturile **Individual Developer** gratuite:

1. Intră pe [Microsoft Partner Center / Windows Developer Registration](https://developer.microsoft.com/store/register) și înregistrează un cont **Individual** (verificare cu act de identitate, fără taxă).
2. Pe Xbox Series X|S, deschide Microsoft Store, caută și instalează aplicația oficială **Xbox Dev Mode**.
3. Deschide **Xbox Dev Mode**, urmează activarea consolei în contul tău și repornește în **Dev Mode**.
4. Pe ecranul **Dev Home**, notează adresa IP a consolei (ex: `https://192.168.1.50:11443`) și activează **Device Portal** (cu username/parolă dacă vrei).

---

## 3. Instalarea aplicației pe Xbox din browserul de pe Mac

1. Deschide Safari / Chrome pe Mac și intră la `https://<IP-XBOX>:11443` (acceptă avertismentul de certificat self-signed).
2. Mergi la **My games & apps** -> **Add**.
3. La **Install app**, alege fișierul `.msix` (sau `.appx`) din `NuvioXbox-XboxSeries-x64`.
4. La pasul următor (**Specify dependencies**), adaugă **toate** fișierele `.appx` / `.msix` din folderul `Dependencies-x64/`.
5. Apasă **Start** / **Done** și așteaptă finalizarea instalării.

---

## 4. Setare recomandată pe Xbox pentru 4K HDR și memorie completă

Implicit, aplicațiile UWP rulează cu o limită redusă de RAM în Xbox Dev Mode. Pentru redare 4K / REMUX fluentă prin Debrid:

1. Pe consolă, în **Dev Home**, selectează aplicația **Nuvio TV**.
2. Apasă butonul **Menu** (`☰`) pe controller -> **View details**.
3. Schimbă **App type** din **`App`** în **`Game`**.

---

## 5. Controale Xbox Controller & Conectare Nuvio

- **D-Pad / Stick stânga**: navigare în interfață (`FocusEngine`).
- **A**: Selectare / Play / Deschidere tastatură virtuală pe câmpurile de text.
- **B**: Înapoi (cu protecție ca să nu închidă accidental aplicația; ieșirea completă se face din meniul aplicației).
- **X / Menu (în player)**: Play / Pause.
- **LB / RB**: Derulare înapoi / înainte.
- **Conectare cont Nuvio**: La pornire, scanează codul QR de pe ecran (`nuvio.tv/tv-login`) de pe telefon pentru a sincroniza addon-urile Stremio și contul tău Real-Debrid / TorBox / AllDebrid.
- **Redare stream-uri Debrid**:
  - `.m3u8` / `.mpd` -> `hls.js` / `dash.js` (cu fallback nativ).
  - `.mkv` / audio AC3 / EAC3 / HEVC -> player nativ Xbox (`MediaPlayer` hardware-accelerated sub interfața WebView2), cu fallback automat la HTML5 `<video>`.
