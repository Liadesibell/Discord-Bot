<<<<<<< HEAD
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=
SESSION_SECRET=
PORT=3000
TICKET_CATEGORY_NAME=
TICKET_SUPPORT_ROLE_ID=
OWNER_DISCORD_ID=
.env oluşturulup içerisine eklenmelidir. 
nodejs frameworku bulunuyor node start atılması lazım backend calısması için.

# Control Center

Discord botu ve Discord OAuth2 web kontrol paneli. Kanal oluşturma, 24 saatlik davet üretip panel kullanıcısına DM gönderme, sunucu içi özel ticket açma ve ticket kapatma özelliklerini içerir.

## Kurulum

1. Node.js 18.17 veya daha yenisini kur.
2. Discord Developer Portal'da bir uygulama oluştur. Bot tokenini al, **Message Content Intent** ve **Server Members Intent** seçeneklerini aç. Ayrılma afişlerinin çalışması için özellikle **Server Members Intent** açık olmalı.
3. OAuth2 Redirects bölümüne `http://localhost:3000/auth/callback` ekle.
4. Botu `Manage Channels`, `Create Instant Invite`, `Send Messages`, `View Channels`, `Read Message History`, `View Audit Log` ve `Ban Members` izinleriyle sunucuna ekle. Vanity URL denetimi için bot rolünü, banlayacağı üyelerin rollerinin üstüne taşı.
5. `.env.example` dosyasını `.env` olarak kopyala ve değerleri doldur.
6. `npm install` ve `npm start` çalıştır. Panel: `http://localhost:3000`.

Windows'ta daha kolay kullanım için `start.bat` dosyasına çift tıklayabilirsin. İlk çalıştırmada `.env` dosyasını oluşturur; Discord bilgilerini girdikten sonra tekrar çalıştırman yeterlidir.

## Ayarlar

`TICKET_SUPPORT_ROLE_ID` başlangıç destek rolüdür; sunucu sahibi bunu `/ayar destek-rolu` ile değiştirebilir. Ticket kayıtları `data/store.json` içinde tutulur; üretimde bu klasörü kalıcı disk/volume ile sakla.

## Discord komutları

`/panel` sunucu kontrol panelini açar. `/yardim` veya `help` komutu tüm komutları menü halinde gösterir ve o sunucudaki eski slash komutlarını temizleyerek güncel komut listesini yeniden kaydeder.

- Ticket: `/ticket`, `/ticket-panel`, `/ticket-kapat`, `/ticket-ekle`, `/ticket-cikar`
- Moderasyon: `/timeout`, `/timeout-kaldir`, `/kick`, `/ban`, `/ban-kaldir`, `/ses-sustur`, `/ses-susturma-kaldir`, `/sagirlestir`, `/sagirliligi-kaldir`, `/sil`, `/kanal-sil`, `/rol-ekle`, `/rol-ver`
- Ayarlar: `/ayar kategori`, `/ayar destek-rolu`, `/ayar hosgeldin`, `/ayar ayrilma`, `/ayar ayrilma-mesaji`, `/ayar moderasyon-logu`, `/ayar otomatik-rol`, `/ayar vanity-rol-ekle`, `/ayar vanity-rol-cikar`
- Bilgi: `/sunucu-bilgi`

Sunucu ayarlarını yalnızca sunucu sahibi değiştirebilir. Web panelinde OAuth ile giriş yapan kullanıcı yalnızca sahibi olduğu sunucuları görebilir; giriş/çıkış ve moderasyon-log kanallarını panelden seçebilir veya kapatabilir. `/ayar hosgeldin` ve `/ayar ayrilma` ile de kanallar seçilebilir. Giriş/çıkış afişlerinde büyük profil fotoğrafı, kullanıcı adı, takma ad, hesap oluşturulma zamanı, sunucuya katılma zamanı ve sunucu bilgileri yer alır; Discord mesajında afiş dışında ayrıca metin gönderilmez. Hoş geldin afişindeki metin sabittir; ayrılma metni `/ayar ayrilma-mesaji` ile değiştirilebilir. Mesaj şablonlarında `{kullanici}`, `{takma_ad}`, `{sunucu}`, `{uye_sayisi}` yer tutucuları kullanılabilir. `/ayar moderasyon-logu` ile seçilen metin kanalında botun moderasyon ve ticket yönetimi işlemleri kayıt altına alınır. Botun ilgili kanallarda **Kanalı Görüntüle** ve **Mesaj Gönder**; görsel kanallarında ayrıca **Dosya Ekle**, moderasyon log kanalında **Bağlantı Yerleştir** izinleri olmalıdır.

Bot açıldığında önce eski global slash komutları ve her sunucudaki eski komutlar kaldırılır, ardından güncel komut listesi sunucuya bir kez kaydedilir. `/yardim` komutunu çalıştırmak da aynı sunucudaki komut listesini yeniler. Giriş afişi `/ayar hosgeldin` ile kanal seçilerek etkinleştirilir; karşılama yazısı afişte sabittir. Ayrılma afişi metni ayrıca `/ayar ayrilma-mesaji` ile değiştirilebilir. Komutlar hâlâ yineleniyorsa botun güncel `src/index.js` dosyasıyla yeniden başlatıldığını ve PM2 günlüklerinde `Eski global slash komutları temizlendi` mesajını kontrol et.

`/ayar destek-rolu` ile seçilen rol moderasyon komutlarında kullanılabilir. `/timeout` ve `/timeout-kaldir` zaman aşımını açar/kaldırır; `/ban` sunucu yasağını uygular, `/ban-kaldir` ise yasaklı kişi sunucuda olmadığı için `kullanici_id` parametresiyle Discord kullanıcı ID'si alarak yasağı kaldırır. Kullanıcı ID'sini kopyalamak için Discord Geliştirici Modu açık olmalıdır. `/ses-sustur`, `/ses-susturma-kaldir`, `/sagirlestir` ve `/sagirliligi-kaldir` sunucu genelindeki ses susturma/sağırlaştırma durumunu değiştirir. Ses işlemi için hedef üye bir ses kanalında olmalı ve botta **Üyeleri Sustur**, **Üyeleri Sağırlaştır** izinleri bulunmalıdır. Timeout, kick ve ban komutları sebep alır, sunucu sahibini/işlemi yapanı hedef olarak reddeder ve rol hiyerarşisini kontrol eder. Botta ilgili **Üyelere Zaman Aşımı Uygula**, **Üyeleri At** veya **Üyeleri Yasakla** izni bulunmalı; bot rolü hedef üyenin rollerinden yukarıda olmalıdır. Mesaj silme, kanal silme, rol ekleme ve ticket yönetimi için de botta ilgili yönetim izinleri bulunmalıdır.

Ticket düğmesi konu ve açıklama formu açar. Panelden veya ticket içindeki düğmeyle kapatma; ticket kaydını günceller ve moderasyon loguna işler. Ticket kanalı elle silinirse açık kayıt da otomatik kapatılır.

Vanity URL denetiminde sunucu sahibi `/ayar vanity-rol-ekle` ile URL değiştirmesine izin verilen rolleri tanımlar; `/ayar vanity-rol-cikar` rolün iznini kaldırır. İzinli rollerden hiçbiri olmayan biri vanity URL'yi değiştirirse bot audit log üzerinden yapanı bulup banlamaya çalışır. Bunun için **Denetim Kaydını Görüntüle** ve **Üyeleri Yasakla** izinleri gerekir.

Discord bot API'si vanity URL'yi değiştirmeye veya geri almaya izin vermiyor ve değişikliği ancak gerçekleştikten sonra bildiriyor. Bu nedenle bot URL işlemini engelleyemez ya da otomatik geri alamaz; URL değişebilir ve sahibinin Discord sunucu ayarlarından düzeltmesi gerekebilir. Audit log'da yapan kişi bulunamazsa ban da uygulanamaz.

`/ticket-panel` komutu bir kanala ticket düğmesi gönderir. Kullanıcı düğmeye bastığında `ticket-0001` gibi, sadece kullanıcı, bot ve destek rolünün görebildiği özel kanal açılır. Ticket DM üzerinden açılmaz.

## 7/24 çalıştırma

VPS'te PM2 ile çalıştırmak için proje klasöründe:

```bash
npm ci --omit=dev
npm install --global pm2
pm2 start src/index.js --name discord-bot
pm2 save
pm2 startup
```

`pm2 startup` komutu ekranda bir başlangıç komutu verir; onu da çalıştır ki sunucu yeniden başlatıldığında bot otomatik açılsın. `.env` dosyası proje kökünde bulunmalı. Güncelleme yaptıktan sonra `pm2 restart discord-bot --update-env`, logları görmek için `pm2 logs discord-bot` kullan.

Paneli internetten güvenli açmak için alan adını VPS'e yönlendirip Nginx veya Caddy ile uygulamanın `3000` portuna reverse proxy ve HTTPS kur. `DISCORD_REDIRECT_URI` değerini `https://alanadin/auth/callback` yap ve aynı adresi Discord Developer Portal'daki OAuth2 Redirects listesine ekle. Uygulama portunu internete doğrudan açma. `data` klasörünün kalıcı olduğundan emin ol; ticket ve sunucu ayarları burada saklanır.

Windows sunucuda PM2 kullanıyorsan `pm2 startup` yerel Windows servisini kendiliğinden kurmaz; Windows başlangıcında PM2'yi çalıştıracak bir Görev Zamanlayıcı görevi de oluştur. Docker, Render, Railway veya Fly.io alternatif dağıtım seçenekleridir.

## Güvenlik

`.env` dosyanı, bot tokenini ve OAuth secret değerini Git'e gönderme. Token sızarsa Discord Developer Portal'dan yenile. Bu proje temel paneldir; çok kullanıcılı üretim ortamında rol tabanlı erişim, CSRF koruması ve Redis tabanlı session store eklenmelidir.
 1ca2a38 (Update Discord Bot)
