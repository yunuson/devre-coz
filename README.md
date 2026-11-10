# devre-coz

Devreyi çiz, çözümünü adım adım öğren.

`devre-coz`, doğru akım (DC) devrelerini kâğıttaki gibi çözmeyi öğreten, tarayıcıda çalışan bir uygulamadır. Devreni kurarsın, gerilim ve akımları çizimin üstünde görürsün. İstersen aynı devrenin çözümünü sınavda yazacağın biçimde, Türkçe ve adım adım açarsın.

**[Uygulamayı aç →](https://yunuson.github.io/devre-coz/)** Kurulum ya da üyelik gerekmez.

<!-- Ekran görüntüsü buraya: ![devre-coz ekran görüntüsü](docs/ekran-goruntusu.png) -->

## Neden?

CircuitJS, LTspice ve Multisim gibi araçlar devreyi çalıştırıp sonucu verir, ama o sonuca kâğıt üstünde nasıl gidileceğini göstermez. Sınavda istenen ise çözüm yoludur: düğümleri belirlemek, Kirchhoff'un Akım Kanunu ile denklemleri yazmak, denklem sistemini kurup çözmek, varsayımı kontrol etmek.

`devre-coz` bu araçlarla yarışmaz, onları tamamlar: Onlar devrenin nasıl davrandığını, bu uygulama nasıl çözüldüğünü gösterir.

## Nasıl kullanılır?

1. **Devreni kur.** Soldaki araç çubuğundan elemanları çizime sürükle, uçlarından tutup tellerle bağla. Ya da **Örnekler**'den hazır bir devre aç.
2. **Çalıştır'a bas.** Düğüm gerilimleri ve eleman akımları çizimin üstünde görünür. Bir değeri değiştirirsen sonuçlar anında güncellenir.
3. **Adım adım çöz'e bas.** Çözüm sağdaki panelde, kâğıda yazar gibi açılır. Her adımın bir "Neden?" açıklaması vardır.

## Özellikler

### Adım adım çözüm

- Düğümleri belirleme, referans düğümü seçme, bilinen gerilimleri yazma ve gerektiğinde süper düğüm kurma.
- Her düğümde Kirchhoff'un Akım Kanunu üç satırda: kanun, değerler yerine konmuş hâli ve sadeleşmiş hâli.
- Denklemler katman katman çözülür: Tek başına çözülebilen denklem önce alınır, bulunan değer sonrakine konur. Matris yalnızca gerçekten birbirine bağlı kalan bilinmeyenler için kurulur.
- Diyot ve transistörlerde kitaptaki yol izlenir: varsay, çöz, varsayımı kontrol et.
- Transistörlü devrelerde ders kitabındaki bağlantı kalıpları (sabit öngerilim, emiter dirençli, gerilim bölücülü ve Thevenin eşdeğeri) giriş ve çıkış çevreleriyle, Kirchhoff'un Gerilim Kanunu kullanılarak çözülür.
- Eleman akımları ve güçleri, yanlarında hangi formülden geldikleriyle (Ohm Kanunu, Kirchhoff'un Akım Kanunu) yazılır.
- Son adımda sağlama yapılır: Her düğümde kanun sağlanıyor mu, üretilen güç tüketilen güce eşit mi?

### Ders notlarındaki gösterim

- Denklem yazımı varsayılan olarak "giren = çıkan"dır. İstersen "çıkanlar toplamı = 0" biçimine geçebilirsin.
- Kaynaklar `V1`, `I1`, düğümler `VA`, `VB` diye adlandırılır. Ondalık ayırıcı virgüldür: `2,5 V`.
- Bilgisayarların kullandığı MNA biçimi isteğe bağlı olarak açılabilir. Sonuç aynıdır.
- Bütün hesaplar kesin kesirlerle yapılır, yuvarlama hatası birikmez.

### Çizim

- Elemanlar kablonun üstüne bırakılınca araya girer, kablolar taşınan veya döndürülen elemanı takip eder.
- Değer ve ad, çizimdeki yazıya çift tıklanarak düzenlenir (örneğin `2 k`, `1,5`).
- Seçim kutusu, kopyala, kes, yapıştır, geri al ve yinele.
- Yakınlaştırma (Ctrl + tekerlek), kaydırma ve devreyi ekrana sığdırma.
- Atanabilir klavye kısayolları.
- Çizim tarayıcıda otomatik saklanır. **Kaydet** ve **Aç** ile devreyi `.json` dosyası olarak saklayabilir, başka bir bilgisayarda açabilirsin.

### Hatalar ve uyarılar

Çalıştır'a basınca devre kontrol edilir. Toprak yoksa, bir gerilim kaynağı kısa devreyse, bir parça toprağa bağlı değilse ya da op-amp'ın geri beslemesi yoksa ne olduğunu ve nasıl düzeltileceğini anlatan bir mesaj çıkar.

## Elemanlar

| Grup | Eleman | Kısayol |
| --- | --- | --- |
| Temel | Direnç, ayarlı direnç | `R`, `P` |
| | Kondansatör (DC'de açık devre), bobin (DC'de kısa devre) | `C`, `L` |
| Kaynaklar | DC gerilim kaynağı, DC akım kaynağı | `V`, `I` |
| | Gerilim noktası (kitaplardaki tek uçlu "+5 V" gösterimi) | `N` |
| Yarıiletken | Diyot (0,7 V sabit düşümlü model) | `D` |
| | Zener diyot | `Z` |
| | LED | – |
| | NPN ve PNP transistör (VBE = 0,7 V; aktif, doyum ve kesim) | `T`, – |
| Aktif | İdeal op-amp | `O` |
| Bağlantı | Tel, toprak, anahtar | `W`, `G`, `S` |
| Ölçüm | İdeal ampermetre ve voltmetre | `A`, `M` |

Diğer kısayollar: Döndür `Space`, Yönünü çevir `F`, Çalıştır / Durdur `Ctrl+Enter`, Kaydet `Ctrl+S`, Aç `Ctrl+O`. Hepsi **Kısayollar** penceresinden değiştirilebilir.

## Örnek devreler

**Örnekler** menüsünde hazır devreler var:

- **Temel:** gerilim bölücü, iki akım kaynağı, gerilim ve akım kaynağı, süper düğüm
- **Op-amp:** tersleyen yükselteç, terslemeyen yükselteç, gerilim izleyici, toplayıcı yükselteç, fark yükselteci
- **Diyot:** diyotlu seri devre, Zener regülatör, LED'li seri devre
- **Transistör:** sabit öngerilimli transistör, gerilim bölücülü transistör

## Sınırlar

- Yalnızca DC kararlı hâl çözülür. Kondansatör ve bobinin zamanla değişimi, AC ve küçük sinyal analizi yoktur.
- Op-amp idealdir. Çıkış besleme değerini aşarsa sonuç kırpılmaz, yalnızca "doyuma gider" uyarısı çıkar.
- Bir devrede en fazla 10 diyot ve transistör olabilir.
- Arayüz şimdilik yalnızca Türkçedir.

## Yol haritası

- [ ] Link ile devre paylaşımı
- [ ] Bağımlı (kontrollü) kaynaklar
- [ ] Çevre akımları yöntemi, Thevenin ve Norton eşdeğeri, süperpozisyon
- [ ] Sembolik çözüm (örneğin `Vo`'yu `V1` ve `V2` cinsinden bulmak)
- [ ] Öğrencinin kendi çözümünü denetleyen "kontrol et" modu
- [ ] Kısa, adım adım dersler

## Yerelde çalıştırma

[Node.js](https://nodejs.org/) gerekir.

```bash
npm install
```

```bash
npm run dev
```

Testler ve tip kontrolü:

```bash
npm test
```

```bash
npm run typecheck
```

Yayın için derleme (çıktı `dist/` klasörüne yazılır):

```bash
npm run build
```

## Proje yapısı

TypeScript, Vite, Vitest ve KaTeX kullanılıyor. Çatı (framework) yok, çizim SVG ile yapılıyor.

- `src/core/`: Kesin kesirli hesap, devre doğrulama, düğüm gerilimi yöntemi, MNA, diyot ve transistör çözümü, adım üretimi. Tarayıcıdan bağımsızdır.
- `src/ui/editor/`: Çizim editörü (şema, çizim, kablo takibi, seçim, kamera, kayıt, örnekler).
- `src/ui/steps-panel/`: Adımların metne ve denklemlere çevrilmesi.
- `src/i18n/tr.ts`: Bütün arayüz metinleri.
- `tests/`: `core` ve `ui` olarak ikiye ayrılmış testler.

## Katkı

Hata bildirimleri ve öneriler için bir issue açabilirsin. Bir çözüm adımı derste gördüğünden farklıysa ya da yanlışsa, devreyi **Kaydet** ile `.json` olarak kaydedip issue'ya eklemen çok yardımcı olur.

Kod değişikliği göndermeden önce `npm test` ve `npm run build` komutlarının hatasız geçtiğinden emin ol.

- Kod, değişken adları ve commit mesajları İngilizce olur.
- Kullanıcıya görünen her yazı `src/i18n/tr.ts` dosyasında tutulur.
- `src/core/` klasörü arayüzden bağımsız kalmalıdır: içinde `document`, `window` veya DOM türleri kullanılmaz.
- Var olan testler değiştirilmez. Yeni davranış için yeni test eklenir.
- Yeni paket eklemeden önce bir issue açıp konuşalım.

## Lisans

[MIT](LICENSE)
